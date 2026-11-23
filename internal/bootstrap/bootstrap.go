package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/application"
	"github.com/xuzuxing/podry/internal/audit"
	"github.com/xuzuxing/podry/internal/auth"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/cleanup"
	"github.com/xuzuxing/podry/internal/config"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/database"
	"github.com/xuzuxing/podry/internal/gitremote"
	"github.com/xuzuxing/podry/internal/platform"
	"github.com/xuzuxing/podry/internal/project"
	"github.com/xuzuxing/podry/internal/release"
	"github.com/xuzuxing/podry/internal/resource"
	"github.com/xuzuxing/podry/internal/server"
)

type Runtime struct {
	Pool         *pgxpool.Pool
	Dependencies server.Dependencies
	Builds       *build.Service
	Releases     *release.Service
	Resources    *resource.Service
	Cleanup      *cleanup.Service
}

func Open(ctx context.Context, cfg config.Config) (*Runtime, error) {
	if err := cfg.ValidateServer(); err != nil {
		return nil, err
	}
	vault, err := credential.New(cfg.CredentialKey)
	if err != nil {
		return nil, err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	if err = database.CheckSchema(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	ttl, _ := cfg.AccessTTL()
	builds := build.New(pool, vault, cfg.Build)
	releases := release.New(pool, vault, cfg.Release, release.NewHelm())
	reader := gitremote.New(nil).WithURLPolicy(cfg.URLPolicy)
	resources := resource.New(pool, vault, cfg.JWTSecret)
	resources.WritesEnabled = cfg.ResourceWritesEnabled
	resources.PublicOrigin = cfg.PublicOrigin
	apps := application.New(pool, vault, reader, cfg.JWTSecret).UseBuilds(builds).UseReleases(releases).WithURLPolicy(cfg.URLPolicy)
	apps.HealthPollingEnabled = cfg.HealthPollingEnabled
	return &Runtime{Pool: pool, Builds: builds, Releases: releases, Resources: resources, Cleanup: cleanup.New(pool, builds, releases, cfg.Cleanup), Dependencies: server.Dependencies{Auth: auth.New(pool, cfg.JWTSecret, ttl), Project: project.New(pool), Audit: audit.New(pool), Platform: platform.New(pool, vault).WithURLPolicy(cfg.URLPolicy), Application: apps, Resource: resources}}, nil
}

const Usage = `Usage:
  podry [serve]
  podry migrate up|down
  podry admin init --email EMAIL --name NAME --password-stdin
  podry users create --email EMAIL --name NAME --password-stdin
  podry users disable --email EMAIL
  podry users reset-password --email EMAIL --password-stdin

Migrations are explicit. Accounts have no default password. Passwords are read
from stdin, never from command arguments. DATABASE_MIGRATION_URL selects the
migration role; DATABASE_URL selects the service/account-management connection.
`

func RunCommand(ctx context.Context, cfg config.Config, args []string, stdin io.Reader, stdout io.Writer) (bool, error) {
	if len(args) == 0 || (len(args) == 1 && args[0] == "serve") {
		return false, nil
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		_, err := io.WriteString(stdout, Usage)
		return true, err
	}
	if len(args) == 2 && args[0] == "migrate" && (args[1] == "up" || args[1] == "down") {
		if cfg.MigrationURL() == "" {
			return true, errors.New("DATABASE_MIGRATION_URL or DATABASE_URL is required")
		}
		if err := database.Migrate(cfg.MigrationURL(), args[1] == "down"); err != nil {
			return true, err
		}
		_, err := fmt.Fprintln(stdout, "Migrations complete.")
		return true, err
	}
	if len(args) < 2 {
		return true, errors.New(Usage)
	}
	command := args[0] + " " + args[1]
	switch command {
	case "admin init", "users create", "users disable", "users reset-password":
	default:
		return true, errors.New(Usage)
	}
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	email := fs.String("email", "", "existing account email")
	var name *string
	if command == "admin init" || command == "users create" {
		name = fs.String("name", "", "display name")
	}
	passwordStdin := fs.Bool("password-stdin", false, "read one password from stdin")
	if err := fs.Parse(args[2:]); err != nil {
		return true, errors.New("invalid account command flags; use podry --help")
	}
	if fs.NArg() != 0 {
		return true, errors.New("unexpected command arguments")
	}
	password := ""
	if command != "users disable" {
		if !*passwordStdin {
			return true, errors.New("--password-stdin is required")
		}
		data, err := io.ReadAll(io.LimitReader(stdin, 1025))
		if err != nil {
			return true, errors.New("could not read password")
		}
		if len(data) > 1024 {
			return true, errors.New("password input is too long")
		}
		password = strings.TrimSuffix(strings.TrimSuffix(string(data), "\n"), "\r")
	} else if *passwordStdin {
		return true, errors.New("disable does not accept password input")
	}
	if cfg.DatabaseURL == "" {
		return true, errors.New("DATABASE_URL is required")
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return true, err
	}
	defer pool.Close()
	if err = database.CheckSchema(ctx, pool); err != nil {
		return true, err
	}
	accounts := auth.New(pool, "", 15*time.Minute)
	var user auth.User
	if name != nil {
		user, err = accounts.CreateUser(ctx, *email, *name, password, command == "admin init")
	} else {
		user, err = accounts.ChangeAccount(ctx, *email, password, command == "users disable")
	}
	if err != nil {
		return true, err
	}
	return true, json.NewEncoder(stdout).Encode(user)
}
