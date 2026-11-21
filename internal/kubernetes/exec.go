package kubernetes

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/httpx"
	"k8s.io/apimachinery/pkg/util/httpstream"
	streamspdy "k8s.io/apimachinery/pkg/util/httpstream/spdy"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

// Exec is a single, non-retrying POST. It reuses the validated inline TLS and
// identity of the REST client and cannot consult local kubeconfig/plugins.
func (c *Client) Exec(ctx context.Context, namespace, name, container string, command []string, options remotecommand.StreamOptions) error {
	// The caller validates names; defend the transport boundary too.
	for _, v := range []string{namespace, name, container} {
		if v == "" || strings.ContainsAny(v, "/\\%?#\x00\r\n") || strings.Contains(v, "..") {
			return httpx.Invalid("终端目标无效")
		}
	}
	u, err := url.Parse(c.server + "/api/v1/namespaces/" + namespace + "/pods/" + name + "/exec")
	if err != nil {
		return Error(err)
	}
	values := url.Values{"container": {container}, "command": command, "stdin": {"true"}, "stdout": {"true"}, "stderr": {"true"}, "tty": {"false"}}
	if options.Tty {
		values.Set("tty", "true")
		values.Set("stderr", "false")
	}
	u.RawQuery = values.Encode()
	cfg := &rest.Config{Host: c.server, BearerToken: c.token, UserAgent: "Podry/exec"}
	// Use the exact CA/mTLS/insecure policy already checked by New. A separate
	// streaming transport is necessary because ordinary HTTP cannot multiplex SPDY.
	return c.execWithTLS(ctx, cfg, u, options)
}

func (c *Client) execWithTLS(ctx context.Context, cfg *rest.Config, u *url.URL, options remotecommand.StreamOptions) error {
	// SPDY's TLS dialer accepts the TLS config directly, including client certs.
	upgrade, err := streamspdy.NewRoundTripperWithConfig(streamspdy.RoundTripperConfig{TLS: c.transport.TLSClientConfig.Clone(), Proxier: http.ProxyFromEnvironment, PingPeriod: 5 * time.Second})
	if err != nil {
		return Error(err)
	}
	upgrade.Dialer = &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	bounded := &execTransport{dialer: upgrade}
	defer bounded.close()
	wrapped, err := rest.HTTPWrappersForConfig(cfg, bounded)
	if err != nil {
		return Error(err)
	}
	executor, err := remotecommand.NewSPDYExecutorRejectRedirects(wrapped, bounded, http.MethodPost, u)
	if err != nil {
		return Error(err)
	}
	// Keep exit errors for the caller's numeric exit frame. Other upstream
	// errors are sanitized by the terminal bridge, never rendered verbatim.
	return executor.StreamWithContext(ctx, options)
}

// The locked SDK's SPDY RoundTrip reads headers without a context watcher and
// its error parser reads an unbounded body. Bound the handshake and keep the
// raw connection cancelable, including before protocol negotiation completes.
type execTransport struct {
	dialer *streamspdy.SpdyRoundTripper
	conn   net.Conn
	stop   func() bool
}

func (t *execTransport) close() {
	if t.stop != nil {
		t.stop()
	}
	if t.conn != nil {
		_ = t.conn.Close()
	}
}

func (t *execTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "SPDY/3.1")
	conn, err := t.dialer.Dial(req)
	if err != nil {
		return nil, err
	}
	t.conn = conn
	t.stop = context.AfterFunc(req.Context(), func() { _ = conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	response, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		t.close()
		return nil, err
	}
	return response, nil
}

func (t *execTransport) NewConnection(response *http.Response) (httpstream.Connection, error) {
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.close()
		return nil, StatusError(response.StatusCode)
	}
	if !strings.Contains(strings.ToLower(response.Header.Get("Connection")), "upgrade") || !strings.EqualFold(response.Header.Get("Upgrade"), "SPDY/3.1") {
		t.close()
		return nil, httpx.Fail(503, "exec_upgrade_failed", "Kubernetes 终端升级失败")
	}
	_ = t.conn.SetDeadline(time.Time{})
	return streamspdy.NewClientConnectionWithPings(t.conn, 5*time.Second)
}
