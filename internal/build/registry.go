package build

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/httpx"
)

func registryRepository(spec ExecutionSpec) string {
	u, _ := url.Parse(spec.RegistryEndpoint)
	return u.Host + "/" + spec.ImageRepository
}
func (s *Service) verifyDigest(ctx context.Context, spec ExecutionSpec, digest string) error {
	fail := func() error {
		return httpx.Fail(503, "artifact_verification_unavailable", "Registry 产物复核尚未完成")
	}
	endpoint, e := url.Parse(spec.RegistryEndpoint)
	if e != nil || credential.WebURL(spec.RegistryEndpoint, true, spec.RegistryHTTPAllowed) != nil {
		return fail()
	}
	client := &http.Client{Transport: s.RegistryTransport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	// Keep authentication scoped to the configured registry. Cross-origin token
	// services may receive anonymous requests, never this registry's password.
	user, password := "", ""
	if spec.RegistryCredential != nil {
		p, e := s.Secret(ctx, *spec.RegistryCredential)
		if e != nil {
			return e
		}
		user, _ = p["username"].(string)
		password, _ = p["password"].(string)
	}
	target := strings.TrimRight(spec.RegistryEndpoint, "/") + "/v2/" + spec.ImageRepository + "/manifests/" + digest
	request := func(token string) (*http.Response, error) {
		req, e := http.NewRequestWithContext(ctx, "GET", target, nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("Accept", "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		} else if user != "" {
			req.SetBasicAuth(user, password)
		}
		return client.Do(req)
	}
	response, e := request("")
	if e != nil {
		return fail()
	}
	if response.StatusCode == 401 {
		challenge := response.Header.Get("WWW-Authenticate")
		response.Body.Close()
		if !strings.HasPrefix(strings.ToLower(challenge), "bearer ") {
			return fail()
		}
		attrs := map[string]string{}
		for _, m := range regexp.MustCompile(`([a-z]+)="([^"\r\n]*)"`).FindAllStringSubmatch(challenge, -1) {
			attrs[m[1]] = m[2]
		}
		realm, e := url.Parse(attrs["realm"])
		if e != nil || (realm.Scheme != "https" && !(spec.RegistryHTTPAllowed && endpoint.Scheme == "http" && realm.Scheme == "http" && strings.EqualFold(realm.Host, endpoint.Host))) || realm.Host == "" || realm.User != nil || realm.Fragment != "" {
			return fail()
		}
		query := realm.Query()
		query.Set("service", attrs["service"])
		query.Set("scope", "repository:"+spec.ImageRepository+":pull")
		realm.RawQuery = query.Encode()
		req, _ := http.NewRequestWithContext(ctx, "GET", realm.String(), nil)
		if realm.Scheme == endpoint.Scheme && strings.EqualFold(realm.Host, endpoint.Host) && user != "" {
			req.SetBasicAuth(user, password)
		}
		authResp, e := client.Do(req)
		if e != nil {
			return fail()
		}
		var result struct {
			Token       string `json:"token"`
			AccessToken string `json:"access_token"`
		}
		raw, e := io.ReadAll(io.LimitReader(authResp.Body, 65537))
		authResp.Body.Close()
		if e != nil || len(raw) > 65536 || authResp.StatusCode != 200 || json.Unmarshal(raw, &result) != nil {
			return fail()
		}
		if result.Token == "" {
			result.Token = result.AccessToken
		}
		if result.Token == "" || strings.ContainsAny(result.Token, "\r\n") {
			return fail()
		}
		response, e = request(result.Token)
		if e != nil {
			return fail()
		}
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fail()
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if e != nil || len(raw) > 8<<20 {
		return fail()
	}
	sum := sha256.Sum256(raw)
	if "sha256:"+hex.EncodeToString(sum[:]) != digest {
		return httpx.Fail(503, "artifact_digest_mismatch", "Registry 内容与构建 digest 不一致")
	}
	if header := response.Header.Get("Docker-Content-Digest"); header != "" && header != digest {
		return httpx.Fail(503, "artifact_digest_mismatch", "Registry digest 头不一致")
	}
	if !json.Valid(raw) {
		return fail()
	}
	return nil
}
