package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"slices"
	"time"
)

// Cached in the working directory so a browser's trust decision survives
// restarts instead of facing a new certificate every launch.
const (
	selfSignedCertFile = "epanet-web-tls.crt"
	selfSignedKeyFile  = "epanet-web-tls.key"
)

// setupTLS resolves the HTTPS certificate: an explicit PEM pair when both paths
// are given, otherwise a cached or freshly generated self-signed one. The
// returned string describes the source for the startup banner.
func setupTLS(certFile, keyFile string) (tls.Certificate, string, error) {
	if certFile != "" || keyFile != "" {
		if certFile == "" || keyFile == "" {
			return tls.Certificate{}, "", fmt.Errorf("-tls-cert 与 -tls-key 必须同时指定")
		}
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return tls.Certificate{}, "", fmt.Errorf("加载证书失败: %w", err)
		}
		return cert, fmt.Sprintf("证书 %s", certFile), nil
	}
	cert, err := selfSignedCert()
	if err != nil {
		return tls.Certificate{}, "", err
	}
	return cert, fmt.Sprintf("自签名证书 %s", selfSignedCertFile), nil
}

// selfSignedCert reuses the cached certificate while it is still valid and
// covers this machine's current names and addresses.
func selfSignedCert() (tls.Certificate, error) {
	hosts, ips := localSANs()
	if cert, ok := loadCachedCert(hosts, ips); ok {
		return cert, nil
	}
	return createSelfSignedCert(hosts, ips)
}

func loadCachedCert(hosts []string, ips []net.IP) (tls.Certificate, bool) {
	cert, err := tls.LoadX509KeyPair(selfSignedCertFile, selfSignedKeyFile)
	if err != nil {
		return tls.Certificate{}, false
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return tls.Certificate{}, false
	}
	if time.Now().Add(30 * 24 * time.Hour).After(leaf.NotAfter) {
		return tls.Certificate{}, false
	}
	if !coversSANs(leaf, hosts, ips) {
		return tls.Certificate{}, false
	}
	cert.Leaf = leaf
	return cert, true
}

func coversSANs(leaf *x509.Certificate, hosts []string, ips []net.IP) bool {
	for _, h := range hosts {
		if !slices.Contains(leaf.DNSNames, h) {
			return false
		}
	}
	for _, ip := range ips {
		if !slices.ContainsFunc(leaf.IPAddresses, ip.Equal) {
			return false
		}
	}
	return true
}

func createSelfSignedCert(hosts []string, ips []net.IP) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("生成私钥失败: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("生成序列号失败: %w", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "epanet-web",
			Organization: []string{"epanet-web self-signed"},
		},
		NotBefore: time.Now().Add(-time.Hour),
		// 825 days is the longest validity macOS still accepts for a locally
		// trusted TLS server certificate.
		NotAfter:              time.Now().AddDate(0, 0, 825),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		DNSNames:              hosts,
		IPAddresses:           ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("签发证书失败: %w", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("编码私钥失败: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(selfSignedCertFile, certPEM, 0o644); err != nil {
		return tls.Certificate{}, fmt.Errorf("写入 %s 失败: %w", selfSignedCertFile, err)
	}
	if err := os.WriteFile(selfSignedKeyFile, keyPEM, 0o600); err != nil {
		return tls.Certificate{}, fmt.Errorf("写入 %s 失败: %w", selfSignedKeyFile, err)
	}
	return tls.X509KeyPair(certPEM, keyPEM)
}

// localSANs lists the names and addresses a browser may use to reach this
// machine, so LAN clients get a matching certificate rather than a name error.
func localSANs() (hosts []string, ips []net.IP) {
	hosts = []string{"localhost"}
	if h, err := os.Hostname(); err == nil && h != "" {
		hosts = append(hosts, h)
	}
	ips = []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return hosts, ips
	}
	for _, a := range addrs {
		var ip net.IP
		switch v := a.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
			continue
		}
		ips = append(ips, ip)
	}
	return hosts, ips
}
