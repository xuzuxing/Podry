// Package registry resolves configured image references to verified content digests.
package registry

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/httpx"
)

const accept = "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json"

var digestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var repositoryPattern = regexp.MustCompile(`^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$`)
var tagPattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)

type Source struct {
	Endpoint, ImageRef, Username, Password string
	AllowHTTP                              bool
}
type Resolved struct{ ImageRepository, Digest string }
type Client struct{ Transport http.RoundTripper }

// Require the configured authority explicitly; repository/tag text cannot select
// another server, escape the v2 path, or smuggle URL credentials/query parameters.
func Reference(endpoint, imageRef string) (repository, reference string, err error) {
	invalid := httpx.Invalid("imageRef 必须包含所选 Registry 主机、仓库路径及合法 tag 或 sha256 digest")
	u, e := url.Parse(endpoint)
	if e != nil || u.Host == "" || len(imageRef) > 1024 || strings.ContainsAny(imageRef, "\\?#%\x00\r\n\t ") {
		return "", "", invalid
	}
	authority, rest, ok := strings.Cut(imageRef, "/")
	if !ok || !strings.EqualFold(authority, u.Host) {
		return "", "", invalid
	}
	repository = rest
	if i := strings.IndexByte(rest, '@'); i >= 0 {
		repository, reference = rest[:i], rest[i+1:]
		if !digestPattern.MatchString(reference) {
			return "", "", invalid
		}
	} else if i := strings.LastIndexByte(rest, ':'); i >= 0 {
		repository, reference = rest[:i], rest[i+1:]
		if !tagPattern.MatchString(reference) {
			return "", "", invalid
		}
	} else {
		reference = "latest"
	}
	if len(repository) > 255 || !repositoryPattern.MatchString(repository) {
		return "", "", invalid
	}
	return repository, reference, nil
}

func unavailable() error {
	return httpx.Fail(503, "registry_unavailable", "Registry 镜像解析暂不可用")
}
func registryStatus(status int) error {
	switch status {
	case 200:
		return nil
	case 401, 403:
		return httpx.Fail(422, "registry_authentication_failed", "Registry 未授予镜像读取权限")
	case 404:
		return httpx.Fail(422, "registry_manifest_not_found", "Registry 中不存在该镜像引用")
	case 429:
		return httpx.Fail(503, "registry_rate_limited", "Registry 读取频率受限，请稍后重试")
	default:
		return unavailable()
	}
}

func (c *Client) Resolve(ctx context.Context, source Source) (Resolved, error) {
	if err := credential.WebURL(source.Endpoint, true, source.AllowHTTP); err != nil {
		return Resolved{}, err
	}
	repo, ref, err := Reference(source.Endpoint, source.ImageRef)
	if err != nil {
		return Resolved{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := &http.Client{Transport: c.Transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	base := strings.TrimRight(source.Endpoint, "/") + "/v2/" + repo + "/manifests/"
	token := ""
	request := func(reference string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", base+reference, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", accept)
		req.Header.Set("Accept-Encoding", "identity")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		} else if source.Username != "" {
			req.SetBasicAuth(source.Username, source.Password)
		}
		return client.Do(req)
	}
	response, err := request(ref)
	if err != nil {
		return Resolved{}, unavailable()
	}
	if response.StatusCode == 401 {
		challenge := response.Header.Get("WWW-Authenticate")
		response.Body.Close()
		token, err = accessToken(ctx, client, source, repo, challenge)
		if err != nil {
			return Resolved{}, err
		}
		response, err = request(ref)
		if err != nil {
			return Resolved{}, unavailable()
		}
	}
	digest, err := manifest(response, ref)
	if err != nil {
		return Resolved{}, err
	}
	// Pin a tag only if the exact content can also be fetched by its digest.
	if !digestPattern.MatchString(ref) {
		pinned, err := request(digest)
		if err != nil {
			return Resolved{}, unavailable()
		}
		if _, err = manifest(pinned, digest); err != nil {
			return Resolved{}, err
		}
	}
	u, _ := url.Parse(source.Endpoint)
	return Resolved{ImageRepository: u.Host + "/" + repo, Digest: digest}, nil
}

func accessToken(ctx context.Context, client *http.Client, source Source, repo, challenge string) (string, error) {
	if !strings.HasPrefix(strings.ToLower(challenge), "bearer ") {
		return "", httpx.Fail(422, "registry_authentication_failed", "Registry 认证失败")
	}
	attrs := map[string]string{}
	for _, m := range regexp.MustCompile(`([a-z]+)="([^"\r\n]*)"`).FindAllStringSubmatch(challenge, -1) {
		if _, duplicate := attrs[m[1]]; duplicate {
			return "", unavailable()
		}
		attrs[m[1]] = m[2]
	}
	realm, err := url.Parse(attrs["realm"])
	endpoint, _ := url.Parse(source.Endpoint)
	if err != nil || realm.Host == "" || realm.User != nil || realm.Fragment != "" || realm.Opaque != "" || (realm.Scheme != "https" && !(source.AllowHTTP && endpoint.Scheme == "http" && realm.Scheme == "http" && strings.EqualFold(realm.Host, endpoint.Host))) {
		return "", unavailable()
	}
	q := realm.Query()
	q.Set("service", attrs["service"])
	q.Set("scope", "repository:"+repo+":pull")
	realm.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", realm.String(), nil)
	if err != nil {
		return "", unavailable()
	}
	// Registry passwords are sent only to this registry's exact origin. An
	// external HTTPS token service receives an anonymous token request.
	if realm.Scheme == endpoint.Scheme && strings.EqualFold(realm.Host, endpoint.Host) && source.Username != "" {
		req.SetBasicAuth(source.Username, source.Password)
	}
	response, err := client.Do(req)
	if err != nil {
		return "", unavailable()
	}
	defer response.Body.Close()
	if err = registryStatus(response.StatusCode); err != nil {
		return "", err
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	var result struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err != nil || len(raw) > 65536 || json.Unmarshal(raw, &result) != nil {
		return "", unavailable()
	}
	if result.Token == "" {
		result.Token = result.AccessToken
	}
	if result.Token == "" || strings.ContainsAny(result.Token, "\r\n") {
		return "", unavailable()
	}
	return result.Token, nil
}

func manifest(response *http.Response, expected string) (string, error) {
	defer response.Body.Close()
	if err := registryStatus(response.StatusCode); err != nil {
		return "", err
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if err != nil || len(raw) > 8<<20 {
		return "", unavailable()
	}
	sum := sha256.Sum256(raw)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	if (digestPattern.MatchString(expected) && expected != digest) || (response.Header.Get("Docker-Content-Digest") != "" && response.Header.Get("Docker-Content-Digest") != digest) {
		return "", httpx.Fail(503, "artifact_digest_mismatch", "Registry 返回的内容与 digest 不一致")
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil {
		return "", invalidManifest()
	}
	if !validManifest(raw, media) {
		return "", invalidManifest()
	}
	return digest, nil
}
func invalidManifest() error {
	return httpx.Fail(422, "registry_manifest_invalid", "仅支持合法 OCI 或 Docker schema 2 镜像 manifest/index")
}

type descriptor struct {
	MediaType string `json:"mediaType"`
	Digest    string `json:"digest"`
	Size      *int64 `json:"size"`
}

func validDescriptor(d descriptor) bool {
	return d.MediaType != "" && digestPattern.MatchString(d.Digest) && d.Size != nil && *d.Size >= 0
}
func manifestMedia(s string) bool {
	return s == "application/vnd.oci.image.manifest.v1+json" || s == "application/vnd.docker.distribution.manifest.v2+json"
}
func indexMedia(s string) bool {
	return s == "application/vnd.oci.image.index.v1+json" || s == "application/vnd.docker.distribution.manifest.list.v2+json"
}
func validManifest(raw []byte, media string) bool {
	var doc struct {
		SchemaVersion int          `json:"schemaVersion"`
		MediaType     string       `json:"mediaType"`
		ArtifactType  string       `json:"artifactType"`
		Config        descriptor   `json:"config"`
		Layers        []descriptor `json:"layers"`
		Manifests     []descriptor `json:"manifests"`
	}
	if json.Unmarshal(raw, &doc) != nil || doc.SchemaVersion != 2 || (doc.MediaType != "" && doc.MediaType != media) || doc.ArtifactType != "" {
		return false
	}
	if manifestMedia(media) {
		if !validDescriptor(doc.Config) || (doc.Config.MediaType != "application/vnd.oci.image.config.v1+json" && doc.Config.MediaType != "application/vnd.docker.container.image.v1+json") || doc.Layers == nil {
			return false
		}
		for _, d := range doc.Layers {
			if !validDescriptor(d) {
				return false
			}
		}
		return true
	}
	if indexMedia(media) && len(doc.Manifests) > 0 && len(doc.Manifests) <= 1000 {
		for _, d := range doc.Manifests {
			if !validDescriptor(d) || (!manifestMedia(d.MediaType) && !indexMedia(d.MediaType)) {
				return false
			}
		}
		return true
	}
	return false
}
