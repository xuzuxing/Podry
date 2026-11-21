package credential

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"strings"

	"github.com/xuzuxing/podry/internal/httpx"
)

// KubernetesPayload is a restricted connection description, never raw kubeconfig.
// Inline credentials avoid exec/auth-provider plugins and local file references.
type KubernetesPayload struct {
	APIServer             string
	CAData                []byte
	Token                 string
	ClientCertificate     tls.Certificate
	InsecureSkipTLSVerify bool
}

func ParseKubernetes(p map[string]any) (KubernetesPayload, error) {
	var out KubernetesPayload
	invalid := httpx.Invalid("Kubernetes 凭据需要 HTTPS 地址及 Token 或匹配的客户端证书/私钥")
	allowed := map[string]bool{"apiServer": true, "certificateAuthorityData": true, "token": true, "clientCertificateData": true, "clientKeyData": true, "insecureSkipTLSVerify": true}
	for key, value := range p {
		if !allowed[key] {
			return out, invalid
		}
		if key == "insecureSkipTLSVerify" {
			v, ok := value.(bool)
			if !ok {
				return out, invalid
			}
			out.InsecureSkipTLSVerify = v
			continue
		}
		s, ok := value.(string)
		if !ok || len(s) > 65536 || strings.ContainsAny(s, "\x00\r\n") {
			return out, invalid
		}
	}
	text := func(k string) string { s, _ := p[k].(string); return s }
	for _, field := range []string{"token", "clientCertificateData", "clientKeyData", "certificateAuthorityData"} {
		if value, exists := p[field]; exists && value == "" {
			return out, invalid
		}
	}
	out.APIServer = text("apiServer")
	if HTTPSURL(out.APIServer, true) != nil {
		return out, invalid
	}
	ca, err := base64.StdEncoding.DecodeString(text("certificateAuthorityData"))
	if err != nil || len(ca) > 0 && !x509.NewCertPool().AppendCertsFromPEM(ca) {
		return out, httpx.Invalid("certificateAuthorityData 必须是 Base64 PEM CA")
	}
	if !out.InsecureSkipTLSVerify && len(ca) == 0 {
		return out, httpx.Invalid("启用 TLS 校验时必须提供 certificateAuthorityData")
	}
	out.CAData = ca
	out.Token = text("token")
	cert, key := text("clientCertificateData"), text("clientKeyData")
	if out.Token != "" {
		if _, exists := p["clientCertificateData"]; exists {
			return out, invalid
		}
		if _, exists := p["clientKeyData"]; exists {
			return out, invalid
		}
		if cert != "" || key != "" {
			return out, invalid
		}
		return out, nil
	}
	if cert == "" || key == "" {
		return out, invalid
	}
	certPEM, err := base64.StdEncoding.DecodeString(cert)
	if err != nil {
		return out, invalid
	}
	keyPEM, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		return out, invalid
	}
	out.ClientCertificate, err = tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return out, httpx.Invalid("客户端证书/私钥格式无效或不匹配")
	}
	return out, nil
}
