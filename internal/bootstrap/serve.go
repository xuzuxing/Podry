package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// Serve owns the runtime after Open. The pool closes only after HTTP handlers
// and both workers exit. A deadline failure returns without waiting on Pool.Close,
// which itself waits for borrowed connections; the caller must exit the process.
func (r *Runtime) Serve(ctx context.Context, srv *http.Server, timeout time.Duration) error {
	return serve(ctx, srv, timeout, r.Pool.Close, r.Builds.RunDraining, r.Releases.RunDraining)
}

func serve(ctx context.Context, srv *http.Server, timeout time.Duration, closeResources func(), workers ...func(context.Context, context.Context)) error {
	if timeout <= 0 {
		closeResources()
		return errors.New("shutdown timeout must be positive")
	}
	// Bind before starting workers, so a failed HTTP startup cannot submit work.
	listener, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		closeResources()
		return err
	}
	return serveListener(ctx, srv, listener, timeout, closeResources, workers...)
}

func serveListener(ctx context.Context, srv *http.Server, listener net.Listener, timeout time.Duration, closeResources func(), workers ...func(context.Context, context.Context)) error {
	drain, stopClaims := context.WithCancel(ctx)
	defer stopClaims()
	work, cancelWork := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelWork()
	// HTTP requests and streams may finish during drain, then receive cancellation
	// when the same deadline that bounds worker shutdown expires.
	srv.BaseContext = func(net.Listener) context.Context { return work }
	var wg sync.WaitGroup
	for _, run := range workers {
		wg.Go(func() { run(drain, work) })
	}
	workerDone := make(chan struct{})
	go func() { wg.Wait(); close(workerDone) }()
	serverDone := make(chan error, 1)
	go func() { serverDone <- srv.Serve(listener) }()
	slog.Info("listening", "addr", listener.Addr().String())

	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-serverDone:
		if errors.Is(serveErr, http.ErrServerClosed) {
			serveErr = nil
		}
	}
	stopClaims()
	slog.Info("shutting down", "timeout", timeout.String())
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), timeout)
	defer cancelShutdown()
	httpDone := make(chan error, 1)
	go func() { httpDone <- srv.Shutdown(shutdown) }()
	// A single deadline covers HTTP, workers, and database close together.
	for httpDone != nil || workerDone != nil {
		select {
		case err := <-httpDone:
			httpDone = nil
			if err != nil {
				cancelWork()
				_ = srv.Close()
				return errors.Join(serveErr, fmt.Errorf("HTTP shutdown: %w", err))
			}
		case <-workerDone:
			workerDone = nil
		case <-shutdown.Done():
			cancelWork()
			_ = srv.Close()
			return errors.Join(serveErr, fmt.Errorf("shutdown exceeded %s: %w", timeout, shutdown.Err()))
		}
	}
	closed := make(chan struct{})
	go func() { closeResources(); close(closed) }()
	select {
	case <-closed:
		return serveErr
	case <-shutdown.Done():
		return errors.Join(serveErr, fmt.Errorf("database close exceeded shutdown deadline: %w", shutdown.Err()))
	}
}
