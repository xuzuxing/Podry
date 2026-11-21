package kubernetes

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/httpx"
)

// ResourceWrite uses create, optimistic full replacement or conditional deletion.
// The boolean reports an ambiguous remote outcome; callers must not repeat it.
func (c *Client) ResourceWrite(ctx context.Context, method, path string, input map[string]any, dry bool) (map[string]any, bool, error) {
	if (method != "POST" && method != "PUT" && method != "DELETE") || !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "?#\\") || strings.Contains(path, "..") || strings.Contains(path, "//") {
		return nil, false, httpx.Invalid("Kubernetes 写入路径无效")
	}
	raw, err := json.Marshal(input)
	if err != nil || len(raw) > 1<<20 {
		return nil, false, httpx.Invalid("Kubernetes 写入对象无效或过大")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	target := c.server + path + "?fieldValidation=Strict"
	if dry {
		target += "&dryRun=All"
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(raw))
	if err != nil {
		return nil, false, Error(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Podry/1")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return nil, true, Error(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 && response.StatusCode != 201 && !(method == "DELETE" && response.StatusCode == 202) {
		code := response.StatusCode
		switch code {
		case 409:
			return nil, false, httpx.Fail(409, "resource_version_changed", "资源身份、名称或版本已变化，请重新预览")
		case 400, 422:
			return nil, false, httpx.Fail(422, "resource_manifest_rejected", "Kubernetes 拒绝资源文档；请检查字段及准入策略")
		case 403:
			return nil, false, httpx.Fail(403, "kubernetes_forbidden", "集群执行身份缺少 Kubernetes 写入权限")
		}
		return nil, code >= 500 || code == 408 || code < 400, StatusError(code)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	var out map[string]any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err != nil || len(data) > 8<<20 || !json.Valid(data) || decoder.Decode(&out) != nil || out == nil {
		return nil, true, httpx.Fail(503, "kubernetes_invalid_response", "Kubernetes 写入响应无效，结果需核对")
	}
	return out, false, nil
}
