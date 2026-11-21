package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/xuzuxing/podry/internal/httpx"
)

type actorKey struct{}

func Current(ctx context.Context) Actor { a, _ := ctx.Value(actorKey{}).(Actor); return a }
func (s *Service) RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			httpx.WriteError(w, r, unauthorized())
			return
		}
		a, err := s.Authenticate(r.Context(), parts[1])
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, a)))
	})
}
func (s *Service) Register(r chi.Router) {
	r.With(httprate.Limit(10, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP), httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.Fail(429, "rate_limited", "登录请求过于频繁"))
	}))).Post("/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var in LoginInput
		if err := httpx.Decode(w, r, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		result, err := s.Login(r.Context(), in)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, 200, result)
	})
	r.Group(func(r chi.Router) {
		r.Use(s.RequireUser)
		r.Get("/auth/me", func(w http.ResponseWriter, r *http.Request) { httpx.JSON(w, 200, Current(r.Context()).User) })
		r.Post("/auth/logout", func(w http.ResponseWriter, r *http.Request) {
			if err := s.Logout(r.Context(), Current(r.Context()), middleware.GetReqID(r.Context())); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			w.WriteHeader(204)
		})
	})
}
