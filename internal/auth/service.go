package auth

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
	"github.com/xuzuxing/podry/internal/httpx"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	IsSuperAdmin bool   `json:"isSuperAdmin"`
}
type Actor struct {
	User
	TokenVersion int64
	ExpiresAt    time.Time
}
type Service struct {
	pool      *pgxpool.Pool
	queries   *sqlcdb.Queries
	secret    []byte
	ttl       time.Duration
	dummyHash []byte
}
type claims struct {
	Version int64 `json:"ver"`
	jwt.RegisteredClaims
}
type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type LoginResult struct {
	AccessToken string    `json:"accessToken"`
	ExpiresAt   time.Time `json:"expiresAt"`
	User        User      `json:"user"`
}

func New(pool *pgxpool.Pool, secret string, ttl time.Duration) *Service {
	dummy, _ := bcrypt.GenerateFromPassword([]byte("dummy password for unknown accounts"), bcrypt.DefaultCost)
	return &Service{pool, sqlcdb.New(pool), []byte(secret), ttl, dummy}
}
func Public(u sqlcdb.User) User { return User{u.ID, u.Email, u.Name, u.IsSuperAdmin} }
func NormalizeEmail(email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	a, e := mail.ParseAddress(email)
	if e != nil || a.Address != email || len(email) > 254 || !strings.Contains(email, "@") {
		return "", httpx.Invalid("邮箱格式无效")
	}
	return email, nil
}
func HashPassword(password string) (string, error) {
	if len(password) < 12 || len(password) > 72 {
		return "", httpx.Invalid("密码长度必须为 12–72 字节")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}
func (s *Service) Login(ctx context.Context, in LoginInput) (LoginResult, error) {
	var result LoginResult
	email, err := NormalizeEmail(in.Email)
	if err != nil {
		return result, httpx.Fail(401, "invalid_credentials", "邮箱或密码错误")
	}
	u, err := s.queries.GetUserByEmail(ctx, email)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	hash := s.dummyHash
	if err == nil {
		hash = []byte(u.PasswordHash)
	}
	matched := bcrypt.CompareHashAndPassword(hash, []byte(in.Password)) == nil
	if !matched || err != nil || u.DisabledAt != nil {
		return result, httpx.Fail(401, "invalid_credentials", "邮箱或密码错误")
	}
	now := time.Now().UTC().Truncate(time.Second)
	expires := now.Add(s.ttl)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{u.TokenVersion, jwt.RegisteredClaims{Issuer: "podry", Subject: u.ID, Audience: jwt.ClaimStrings{"podry-api"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expires)}})
	signed, err := token.SignedString(s.secret)
	if err != nil {
		return result, err
	}
	return LoginResult{signed, expires, Public(u)}, nil
}
func (s *Service) Authenticate(ctx context.Context, raw string) (Actor, error) {
	var a Actor
	token, err := jwt.ParseWithClaims(raw, &claims{}, func(*jwt.Token) (any, error) { return s.secret, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("podry"), jwt.WithAudience("podry-api"), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !token.Valid {
		return a, unauthorized()
	}
	c, ok := token.Claims.(*claims)
	if !ok || httpx.UUID(c.Subject) != nil {
		return a, unauthorized()
	}
	u, err := s.queries.GetUser(ctx, c.Subject)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, unauthorized()
	}
	if err != nil {
		return a, err
	}
	if u.DisabledAt != nil || u.TokenVersion != c.Version {
		return a, unauthorized()
	}
	return Actor{User: Public(u), TokenVersion: u.TokenVersion, ExpiresAt: c.ExpiresAt.Time}, nil
}
func unauthorized() error {
	return httpx.Fail(401, "unauthorized", "登录已失效，请重新登录")
}

// LockActor serializes a mutation with account disable/password changes.
func LockActor(ctx context.Context, q *sqlcdb.Queries, a Actor) error {
	u, err := q.LockUser(ctx, a.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return unauthorized()
	}
	if err != nil {
		return err
	}
	if u.DisabledAt != nil || u.TokenVersion != a.TokenVersion {
		return unauthorized()
	}
	return nil
}
func (s *Service) Logout(ctx context.Context, a Actor, requestID string) error {
	_, err := database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (bool, error) {
		// Acquire the write lock directly: two simultaneous logouts must not upgrade shared locks.
		u, e := q.LockUserForUpdate(ctx, a.Email)
		if e != nil {
			return false, e
		}
		if u.TokenVersion != a.TokenVersion || u.DisabledAt != nil {
			return false, unauthorized()
		}
		if _, e = q.InvalidateTokens(ctx, a.ID); e != nil {
			return false, e
		}
		return true, q.RecordAudit(ctx, sqlcdb.RecordAuditParams{ActorID: &a.ID, Action: "auth.logout", Target: []byte(`{}`), RequestID: requestID, Result: "succeeded"})
	})
	return err
}

// Account commands require host/database access and never accept HTTP self-registration.
func (s *Service) CreateUser(ctx context.Context, email, name, password string, initialize bool) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	name, err = httpx.Name(name)
	if err != nil {
		return User{}, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (User, error) {
		if e := q.LockAccountAdministration(ctx); e != nil {
			return User{}, e
		}
		if initialize {
			n, e := q.CountSuperAdmins(ctx)
			if e != nil {
				return User{}, e
			}
			if n > 0 {
				return User{}, httpx.Fail(409, "already_initialized", "平台管理员已初始化")
			}
		}
		u, e := q.CreateUser(ctx, sqlcdb.CreateUserParams{Email: email, Name: name, PasswordHash: hash, IsSuperAdmin: initialize})
		if e != nil {
			return User{}, e
		}
		action := "users.create"
		if initialize {
			action = "admin.init"
		}
		if e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{Action: action, Target: []byte(`{"userId":"` + u.ID + `"}`), RequestID: "cli", Result: "succeeded"}); e != nil {
			return User{}, e
		}
		return Public(u), nil
	})
}
func (s *Service) ChangeAccount(ctx context.Context, email, password string, disable bool) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	var hash string
	if !disable {
		hash, err = HashPassword(password)
		if err != nil {
			return User{}, err
		}
	}
	return database.Tx(ctx, s.pool, func(q *sqlcdb.Queries) (User, error) {
		if e := q.LockAccountAdministration(ctx); e != nil {
			return User{}, e
		}
		u, e := q.LockUserForUpdate(ctx, email)
		if e != nil {
			return User{}, e
		}
		action := "users.reset_password"
		if disable {
			if u.IsSuperAdmin && u.DisabledAt == nil {
				n, e := q.CountSuperAdmins(ctx)
				if e != nil {
					return User{}, e
				}
				if n <= 1 {
					return User{}, httpx.Fail(409, "last_admin", "不能停用最后一个平台管理员")
				}
			}
			u, e = q.DisableUser(ctx, u.ID)
			action = "users.disable"
		} else {
			u, e = q.ResetPassword(ctx, sqlcdb.ResetPasswordParams{ID: u.ID, PasswordHash: hash})
		}
		if e != nil {
			return User{}, e
		}
		if e = q.RecordAudit(ctx, sqlcdb.RecordAuditParams{Action: action, Target: []byte(`{"userId":"` + u.ID + `"}`), RequestID: "cli", Result: "succeeded"}); e != nil {
			return User{}, e
		}
		return Public(u), nil
	})
}
