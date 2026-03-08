package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/dittoo/backend/internal/database"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type signupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type authResponse struct {
	User         userResponse `json:"user"`
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
}

type userResponse struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url"`
	CreatedAt string  `json:"created_at"`
}

func (h *Handler) Signup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		h.error(w, http.StatusBadRequest, "email, password, and name are required")
		return
	}

	if len(req.Password) < 8 {
		h.error(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to hash password")
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	user, err := h.db.CreateUser(r.Context(), database.CreateUserParams{
		Email:        req.Email,
		Name:         req.Name,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
		AuthProvider: "email",
	})
	if err != nil {
		// Unique constraint violation on email
		h.error(w, http.StatusConflict, "email already registered")
		return
	}

	accessToken, refreshToken, err := h.generateTokens(r.Context(), uuidToString(user.ID))
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to generate tokens")
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	h.json(w, http.StatusCreated, authResponse{
		User:         userToResponse(user),
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" {
		h.error(w, http.StatusBadRequest, "email and password are required")
		return
	}

	user, err := h.db.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		h.error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !user.PasswordHash.Valid {
		h.error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(req.Password)); err != nil {
		h.error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	accessToken, refreshToken, err := h.generateTokens(r.Context(), uuidToString(user.ID))
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to generate tokens")
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	h.json(w, http.StatusOK, authResponse{
		User:         userToResponse(user),
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	})
}

func (h *Handler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tokenHash := hashToken(req.RefreshToken)

	rt, err := h.db.GetRefreshTokenByHash(r.Context(), tokenHash)
	if err != nil {
		h.error(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	// Delete old token (rotation)
	_ = h.db.DeleteRefreshToken(r.Context(), rt.ID)

	// Get user
	user, err := h.db.GetUserByID(r.Context(), rt.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		h.error(w, http.StatusUnauthorized, "user not found")
		return
	}
	if err != nil {
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	accessToken, refreshToken, err := h.generateTokens(r.Context(), uuidToString(user.ID))
	if err != nil {
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	h.json(w, http.StatusOK, authResponse{
		User:         userToResponse(user),
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	})
}

func (h *Handler) generateTokens(ctx context.Context, userID string) (string, string, error) {
	// Access token
	claims := jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(h.config.AccessTokenTTL).Unix(),
		"iat": time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	accessToken, err := token.SignedString([]byte(h.config.JWTSecret))
	if err != nil {
		return "", "", err
	}

	// Refresh token
	refreshToken := uuid.New().String()
	tokenHash := hashToken(refreshToken)

	uid := parseUUID(userID)
	_, err = h.db.CreateRefreshToken(ctx, database.CreateRefreshTokenParams{
		UserID:    uid,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(h.config.RefreshTokenTTL), Valid: true},
	})
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func uuidToString(id pgtype.UUID) string {
	u, _ := uuid.FromBytes(id.Bytes[:])
	return u.String()
}

func parseUUID(s string) pgtype.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: u, Valid: true}
}

func userToResponse(u database.User) userResponse {
	resp := userResponse{
		ID:    uuidToString(u.ID),
		Email: u.Email,
		Name:  u.Name,
	}
	if u.AvatarUrl.Valid {
		resp.AvatarURL = &u.AvatarUrl.String
	}
	if u.CreatedAt.Valid {
		resp.CreatedAt = u.CreatedAt.Time.Format(time.RFC3339)
	}
	return resp
}
