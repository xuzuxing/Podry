package database

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuzuxing/podry/internal/database/sqlcdb"
)

//go:embed migrations/*.sql
var migrations embed.FS

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	cfg.MaxConns = 10
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "15000"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, errors.New("could not create database pool")
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("database connection failed")
	}
	return pool, nil
}

// Migrate is explicit; starting the API never runs DDL or seeds accounts.
func Migrate(url string, down bool) error {
	source, err := iofs.New(migrations, "migrations")
	if err != nil {
		return err
	}
	// The pgx migrate driver uses its own scheme while DATABASE_URL stays standard PostgreSQL.
	_, err = pgx.ParseConfig(url)
	if err != nil {
		return errors.New("invalid migration database URL")
	}
	driverURL := url
	if len(driverURL) >= 11 && driverURL[:11] == "postgres://" {
		driverURL = "pgx5://" + driverURL[11:]
	} else if len(driverURL) >= 13 && driverURL[:13] == "postgresql://" {
		driverURL = "pgx5://" + driverURL[13:]
	} else {
		return errors.New("migration URL must use postgres:// or postgresql://")
	}
	m, err := migrate.NewWithSourceInstance("iofs", source, driverURL)
	if err != nil {
		return errors.New("could not open migration database")
	}
	defer m.Close()
	if down {
		err = m.Steps(-1)
	} else {
		err = m.Up()
	}
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}
	return nil
}

func CheckSchema(ctx context.Context, pool *pgxpool.Pool) error {
	var version int
	var dirty bool
	if err := pool.QueryRow(ctx, "SELECT version,dirty FROM schema_migrations").Scan(&version, &dirty); err != nil {
		return errors.New("database schema is missing; run podry migrate up")
	}
	if version != 20 || dirty {
		return errors.New("database schema is incompatible or dirty; run explicit migrations")
	}
	return nil
}

func Tx[T any](ctx context.Context, pool *pgxpool.Pool, fn func(*sqlcdb.Queries) (T, error)) (result T, err error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	result, err = fn(sqlcdb.New(pool).WithTx(tx))
	if err != nil {
		return result, err
	}
	err = tx.Commit(ctx)
	return result, err
}
