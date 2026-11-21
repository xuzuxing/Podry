package bootstrap

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func awaitSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("lifecycle did not reach the expected state")
	}
}

func awaitServe(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("server shutdown blocked")
		return nil
	}
}

func testListener(t *testing.T) net.Listener {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
	return l
}

func TestServeDrainsHTTPAndWorkersBeforeClosingResources(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	l := testListener(t)
	requestEntered, responseAllowed := make(chan struct{}), make(chan struct{})
	defer close(responseAllowed)
	handlerDone := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestEntered)
		select {
		case <-responseAllowed:
		case <-r.Context().Done():
		}
		_, _ = io.WriteString(w, "pong")
		close(handlerDone)
	})}
	started, draining, completed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var workCanceled, closedTooEarly atomic.Bool
	worker := func(drain, work context.Context) {
		close(started)
		<-drain.Done()
		close(draining)
		<-handlerDone
		workCanceled.Store(work.Err() != nil)
		close(completed)
	}
	done := make(chan error, 1)
	go func() {
		done <- serveListener(ctx, srv, l, 3*time.Second, func() {
			select {
			case <-completed:
			default:
				closedTooEarly.Store(true)
			}
		}, worker)
	}()
	awaitSignal(t, started)
	response := make(chan string, 1)
	go func() {
		client := &http.Client{Timeout: 4 * time.Second}
		resp, err := client.Get("http://" + l.Addr().String())
		if err != nil {
			response <- "request failed"
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		response <- string(body)
	}()
	awaitSignal(t, requestEntered)
	stop()
	awaitSignal(t, draining)
	select {
	case err := <-done:
		t.Fatalf("server returned before active request completed: %v", err)
	default:
	}
	responseAllowed <- struct{}{}
	if err := awaitServe(t, done); err != nil {
		t.Fatal(err)
	}
	if body := <-response; body != "pong" || workCanceled.Load() || closedTooEarly.Load() {
		t.Fatal("drain interrupted active work or closed dependencies prematurely", body)
	}
}

func TestServeOneDeadlineCancelsHTTPAndAllWorkers(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	l := testListener(t)
	requestEntered, requestCanceled := make(chan struct{}), make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestEntered)
		<-r.Context().Done()
		close(requestCanceled)
	})}
	var closed atomic.Bool
	started := make(chan struct{}, 2)
	canceled := make(chan struct{}, 2)
	worker := func(drain, work context.Context) {
		started <- struct{}{}
		<-work.Done()
		canceled <- struct{}{}
	}
	done := make(chan error, 1)
	go func() {
		done <- serveListener(ctx, srv, l, 200*time.Millisecond, func() { closed.Store(true) }, worker, worker)
	}()
	awaitSignal(t, started)
	awaitSignal(t, started)
	requestDone := make(chan struct{})
	go func() {
		defer close(requestDone)
		client := &http.Client{Timeout: 3 * time.Second}
		if r, err := client.Get("http://" + l.Addr().String()); err == nil {
			r.Body.Close()
		}
	}()
	awaitSignal(t, requestEntered)
	start := time.Now()
	stop()
	err := awaitServe(t, done)
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 2*time.Second || closed.Load() {
		t.Fatal("shutdown did not preserve its common deadline", err)
	}
	awaitSignal(t, canceled)
	awaitSignal(t, canceled)
	awaitSignal(t, requestCanceled)
	awaitSignal(t, requestDone)
}

func TestServeBlockedDependencyCannotHoldProcessOpen(t *testing.T) {
	for _, blocked := range []string{"worker", "database"} {
		t.Run(blocked, func(t *testing.T) {
			ctx, stop := context.WithCancel(context.Background())
			defer stop()
			started, unblock, exited := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var closed atomic.Bool
			closeResources := func() {
				closed.Store(true)
				if blocked == "database" {
					<-unblock
					close(exited)
				}
			}
			worker := func(drain, work context.Context) {
				close(started)
				if blocked == "worker" {
					<-unblock // Simulate an adapter ignoring context cancellation.
					close(exited)
				}
			}
			done := make(chan error, 1)
			l := testListener(t)
			go func() { done <- serveListener(ctx, &http.Server{}, l, 200*time.Millisecond, closeResources, worker) }()
			awaitSignal(t, started)
			stop()
			err := awaitServe(t, done)
			close(unblock)
			awaitSignal(t, exited)
			if !errors.Is(err, context.DeadlineExceeded) || closed.Load() != (blocked == "database") {
				t.Fatal("blocked dependency broke shutdown ownership", err)
			}
		})
	}
}

func TestServeBindFailureStartsNoWorkers(t *testing.T) {
	l := testListener(t)
	var started, closed atomic.Bool
	err := serve(context.Background(), &http.Server{Addr: l.Addr().String()}, time.Second, func() { closed.Store(true) }, func(context.Context, context.Context) { started.Store(true) })
	if err == nil || started.Load() || !closed.Load() {
		t.Fatal("bind failure started work or leaked runtime resources")
	}
}
