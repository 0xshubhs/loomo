package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type visitor struct {
	tokens    float64
	lastSeen  time.Time
	mu        sync.Mutex
}

type rateLimiter struct {
	visitors sync.Map
	rate     float64 // tokens per second
	burst    float64 // max tokens (bucket size)
}

func newRateLimiter(requestsPerMinute int) *rateLimiter {
	rl := &rateLimiter{
		rate:  float64(requestsPerMinute) / 60.0,
		burst: float64(requestsPerMinute),
	}

	// Clean up stale entries every minute
	go func() {
		for {
			time.Sleep(time.Minute)
			rl.visitors.Range(func(key, value any) bool {
				v := value.(*visitor)
				v.mu.Lock()
				if time.Since(v.lastSeen) > 3*time.Minute {
					rl.visitors.Delete(key)
				}
				v.mu.Unlock()
				return true
			})
		}
	}()

	return rl
}

func (rl *rateLimiter) allow(ip string) bool {
	val, _ := rl.visitors.LoadOrStore(ip, &visitor{
		tokens:   rl.burst,
		lastSeen: time.Now(),
	})
	v := val.(*visitor)

	v.mu.Lock()
	defer v.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(v.lastSeen).Seconds()
	v.lastSeen = now

	// Refill tokens
	v.tokens += elapsed * rl.rate
	if v.tokens > rl.burst {
		v.tokens = rl.burst
	}

	if v.tokens < 1.0 {
		return false
	}

	v.tokens -= 1.0
	return true
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the chain
		if i := net.ParseIP(xff); i != nil {
			return xff
		}
	}

	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimit returns middleware that limits requests per minute per IP address.
// When the limit is exceeded, it responds with 429 Too Many Requests.
func RateLimit(requestsPerMinute int) func(http.Handler) http.Handler {
	limiter := newRateLimiter(requestsPerMinute)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)

			if !limiter.allow(ip) {
				http.Error(w, `{"error":"too many requests"}`, http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
