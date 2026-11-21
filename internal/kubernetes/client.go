// Package kubernetes provides bounded, read-only Kubernetes REST access.
package kubernetes

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/httpx"
)

type Client struct {
	server, token string
	http          *http.Client
	transport     *http.Transport
}

func New(payload map[string]any) (*Client, error) {
	p, err := credential.ParseKubernetes(payload)
	if err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: p.InsecureSkipTLSVerify}
	if len(p.CAData) > 0 {
		tlsConfig.RootCAs = x509.NewCertPool()
		tlsConfig.RootCAs.AppendCertsFromPEM(p.CAData)
	}
	if len(p.ClientCertificate.Certificate) > 0 {
		tlsConfig.Certificates = []tls.Certificate{p.ClientCertificate}
	}
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment, DialContext: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext, TLSClientConfig: tlsConfig, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxIdleConns: 8, IdleConnTimeout: 30 * time.Second, ForceAttemptHTTP2: true}
	return &Client{strings.TrimRight(p.APIServer, "/"), p.Token, &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, transport}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func Error(err error) error {
	if err == nil {
		return nil
	}
	var api *httpx.Error
	if errors.As(err, &api) {
		return api
	}
	return httpx.Fail(503, "cluster_unavailable", "Kubernetes 连接、TLS 或上游读取失败")
}
func StatusError(status int) error {
	switch status {
	case 401:
		return httpx.Fail(503, "cluster_auth_failed", "Kubernetes 拒绝集群凭据")
	case 403:
		return httpx.Fail(403, "kubernetes_forbidden", "集群执行身份缺少 Kubernetes 读取权限")
	case 404:
		return httpx.Fail(404, "resource_not_found", "Kubernetes 资源不存在")
	case 410:
		return httpx.Fail(410, "continue_expired", "Kubernetes 分页已过期，请重新查询")
	case 400, 422:
		return httpx.Fail(422, "kubernetes_invalid_query", "Kubernetes 不接受该查询参数")
	case 429:
		return httpx.Fail(503, "cluster_rate_limited", "Kubernetes 暂时限制请求，请稍后重试")
	default:
		return httpx.Fail(503, "cluster_unavailable", "Kubernetes 上游读取失败")
	}
}
func (c *Client) Open(ctx context.Context, path string, query url.Values) (io.ReadCloser, error) {
	// Paths are built exclusively from validated GVR, namespace and object names.
	if !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "?#\\") || strings.Contains(path, "..") || strings.Contains(path, "//") {
		return nil, httpx.Invalid("Kubernetes 资源路径无效")
	}
	u := c.server + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, Error(err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Podry/1")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return nil, Error(err)
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		return nil, StatusError(response.StatusCode)
	}
	return response.Body, nil
}
func (c *Client) Get(ctx context.Context, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	body, err := c.Open(ctx, path, query)
	if err != nil {
		return err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, (8<<20)+1))
	if err != nil {
		return Error(err)
	}
	if len(data) > 8<<20 {
		return httpx.Fail(503, "resource_read_limit", "Kubernetes 响应超过读取预算")
	}
	if json.Unmarshal(data, out) != nil {
		return httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 返回了无效的资源数据")
	}
	return nil
}

// Write is reserved for platform-owned execution objects. Resource-browser
// handlers continue to use the GET-only Open/Get paths.
func (c *Client) Write(ctx context.Context, method, path string, input, output any) error {
	if (method != http.MethodPost && method != http.MethodPatch) || !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "?#\\") || strings.Contains(path, "..") || strings.Contains(path, "//") {
		return httpx.Invalid("Kubernetes 执行请求无效")
	}
	raw, err := json.Marshal(input)
	if err != nil || len(raw) > 1<<20 {
		return httpx.Invalid("Kubernetes 执行对象过大或无效")
	}
	req, err := http.NewRequestWithContext(ctx, method, c.server+path, bytes.NewReader(raw))
	if err != nil {
		return Error(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if method == http.MethodPatch {
		req.Header.Set("Content-Type", "application/merge-patch+json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("User-Agent", "Podry/1")
	response, err := c.http.Do(req)
	if err != nil {
		return Error(err)
	}
	defer response.Body.Close()
	if response.StatusCode == 409 {
		return httpx.Fail(409, "kubernetes_conflict", "Kubernetes 对象身份或版本冲突")
	}
	if response.StatusCode != 200 && response.StatusCode != 201 {
		return StatusError(response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if err != nil {
		return Error(err)
	}
	if len(data) > 8<<20 || json.Unmarshal(data, output) != nil {
		return httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 执行响应无效")
	}
	return nil
}
