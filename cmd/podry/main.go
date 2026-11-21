package main

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	root "github.com/xuzuxing/podry"
	"github.com/xuzuxing/podry/internal/bootstrap"
	"github.com/xuzuxing/podry/internal/config"
	"github.com/xuzuxing/podry/internal/server"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	// Local DX only: load apps/api/.env if present. Real env wins
	// (Load does not override), missing file is ignored (prod/Coolify).
	_ = godotenv.Load()

	cfg := config.Load()
	commandCtx, cancelCommand := context.WithTimeout(context.Background(), 30*time.Second)
	handled, err := bootstrap.RunCommand(commandCtx, cfg, os.Args[1:], os.Stdin, os.Stdout)
	cancelCommand()
	if handled || err != nil {
		return err
	}
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 10*time.Second)
	runtime, err := bootstrap.Open(startupCtx, cfg)
	cancelStartup()
	if err != nil {
		return err
	}

	// 启动期 fail-fast:内嵌前端必须含 index.html,否则运行期白屏(空/错误 web/dist 也能编过)。
	webFS := root.WebFS()
	if _, err := fs.Stat(webFS, "index.html"); err != nil {
		runtime.Pool.Close()
		return fmt.Errorf("The `web/dist` directory is missing `index.html` (did the frontend build fail?): %w", err)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(webFS, runtime.Dependencies),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		// WriteTimeout 置 0:SSE 长连接(/api/runs/{id}/events)不可被写超时切断;
		// 各非流式 handler 自身在合理时间内完成,慢响应风险由 ReadTimeout/IdleTimeout 兜底。
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	timeout, _ := cfg.ShutdownGrace() // Open validated the configuration.
	return runtime.Serve(ctx, srv, timeout)
}
