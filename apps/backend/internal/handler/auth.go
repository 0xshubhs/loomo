package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
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

	id := uuid.New()
	now := time.Now()

	_, err = h.pool.Exec(r.Context(),
		`INSERT INTO users (id, email, name, password_hash, auth_provider, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, 'email', $5, $5)`,
		id, req.Email, req.Name, string(hash), now,
	)
	if err != nil {
		h.error(w, http.StatusConflict, "email already registered")
		return
	}

	accessToken, refreshToken, err := h.generateTokens(r.Context(), id.String())
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to generate tokens")
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	h.json(w, http.StatusCreated, authResponse{
		User: userResponse{
			ID:        id.String(),
			Email:     req.Email,
			Name:      req.Name,
			AvatarURL: nil,
			CreatedAt: now.Format(time.RFC3339),
		},
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

	var id, name, passwordHash string
	var avatarURL *string
	var createdAt time.Time

	err := h.pool.QueryRow(r.Context(),
		`SELECT id, name, password_hash, avatar_url, created_at FROM users WHERE email = $1`,
		req.Email,
	).Scan(&id, &name, &passwordHash, &avatarURL, &createdAt)
	if err != nil {
		h.error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		h.error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	accessToken, refreshToken, err := h.generateTokens(r.Context(), id)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to generate tokens")
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	h.json(w, http.StatusOK, authResponse{
		User: userResponse{
			ID:        id,
			Email:     req.Email,
			Name:      name,
			AvatarURL: avatarURL,
			CreatedAt: createdAt.Format(time.RFC3339),
		},
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

	var userID string
	var expiresAt time.Time
	var tokenID string
	err := h.pool.QueryRow(r.Context(),
		`SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = $1`,
		tokenHash,
	).Scan(&tokenID, &userID, &expiresAt)
	if err != nil {
		h.error(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	if time.Now().After(expiresAt) {
		h.pool.Exec(r.Context(), `DELETE FROM refresh_tokens WHERE id = $1`, tokenID)
		h.error(w, http.StatusUnauthorized, "refresh token expired")
		return
	}

	// Delete old token (rotation)
	h.pool.Exec(r.Context(), `DELETE FROM refresh_tokens WHERE id = $1`, tokenID)

	// Get user
	var email, name string
	var avatarURL *string
	var createdAt time.Time
	err = h.pool.QueryRow(r.Context(),
		`SELECT email, name, avatar_url, created_at FROM users WHERE id = $1`,
		userID,
	).Scan(&email, &name, &avatarURL, &createdAt)
	if err != nil {
		h.error(w, http.StatusUnauthorized, "user not found")
		return
	}

	accessToken, refreshToken, err := h.generateTokens(r.Context(), userID)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "internal error")
		return
	}

	h.json(w, http.StatusOK, authResponse{
		User: userResponse{
			ID:        userID,
			Email:     email,
			Name:      name,
			AvatarURL: avatarURL,
			CreatedAt: createdAt.Format(time.RFC3339),
		},
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

	_, err = h.pool.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(h.config.RefreshTokenTTL),
	)
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
