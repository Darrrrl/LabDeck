package tailscale

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/labdeck/labdeck/collector/internal/snapshots"
)

const binary = "/usr/bin/tailscale"
const maxOutput = 2 << 20
const maxPeers = 250

type boundedBuffer struct{ bytes.Buffer }

func (b *boundedBuffer) Write(value []byte) (int, error) {
	if b.Len()+len(value) > maxOutput {
		return 0, errors.New("status output too large")
	}
	return b.Buffer.Write(value)
}

type peerRaw struct {
	ID       string   `json:"ID"`
	HostName string   `json:"HostName"`
	DNSName  string   `json:"DNSName"`
	IPs      []string `json:"TailscaleIPs"`
	Online   bool     `json:"Online"`
	LastSeen string   `json:"LastSeen"`
}
type statusRaw struct {
	Version      string             `json:"Version"`
	BackendState string             `json:"BackendState"`
	Self         *peerRaw           `json:"Self"`
	IPs          []string           `json:"TailscaleIPs"`
	Peer         map[string]peerRaw `json:"Peer"`
}

func Collect(now time.Time) snapshots.Capability[snapshots.TailscaleStatus] {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "status", "--json")
	var output boundedBuffer
	var stderr boundedBuffer
	cmd.Stdout, cmd.Stderr = &output, &stderr
	err := cmd.Run()
	if err != nil {
		code := "read-failed"
		if strings.Contains(strings.ToLower(stderr.String()), "permission denied") || strings.Contains(strings.ToLower(stderr.String()), "access denied") {
			code = "permission-denied"
		}
		return snapshots.Failure[snapshots.TailscaleStatus](now, code)
	}
	value, err := Normalize(output.Bytes())
	if err != nil {
		return snapshots.Failure[snapshots.TailscaleStatus](now, "invalid-response")
	}
	result := snapshots.Success(now, value)
	if !value.InventoryComplete {
		result.Completeness = "partial"
	}
	return result
}

func Normalize(output []byte) (snapshots.TailscaleStatus, error) {
	if len(output) == 0 || len(output) > maxOutput {
		return snapshots.TailscaleStatus{}, errors.New("invalid status size")
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	var raw statusRaw
	if err := decoder.Decode(&raw); err != nil {
		return snapshots.TailscaleStatus{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return snapshots.TailscaleStatus{}, errors.New("multiple status documents")
	}
	if raw.Version == "" || len(raw.Version) > 128 || raw.BackendState == "" || len(raw.BackendState) > 32 {
		return snapshots.TailscaleStatus{}, errors.New("missing status fields")
	}
	result := snapshots.TailscaleStatus{Version: safeText(raw.Version, 128), BackendState: safeText(raw.BackendState, 32), InventoryComplete: len(raw.Peer) <= maxPeers, Peers: []snapshots.TailscalePeer{}, SelfIPs: safeIPs(raw.IPs)}
	if raw.Self != nil {
		result.SelfName = safeText(raw.Self.HostName, 128)
		if result.SelfName == "" {
			result.SelfName = safeText(strings.TrimSuffix(raw.Self.DNSName, "."), 128)
		}
		if len(result.SelfIPs) == 0 {
			result.SelfIPs = safeIPs(raw.Self.IPs)
		}
	}
	keys := make([]string, 0, len(raw.Peer))
	for key := range raw.Peer {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	seen := map[string]bool{}
	for _, key := range keys {
		if len(result.Peers) >= maxPeers {
			break
		}
		item := raw.Peer[key]
		if item.ID == "" || len(item.ID) > 64 || !safeID(item.ID) || seen[item.ID] {
			result.InventoryComplete = false
			continue
		}
		seen[item.ID] = true
		name := safeText(item.HostName, 128)
		if name == "" {
			name = safeText(strings.TrimSuffix(item.DNSName, "."), 128)
		}
		var lastSeen *time.Time
		if item.LastSeen != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, item.LastSeen); err == nil && !parsed.IsZero() {
				utc := parsed.UTC()
				lastSeen = &utc
			}
		}
		result.Peers = append(result.Peers, snapshots.TailscalePeer{ID: item.ID, Name: name, IPs: safeIPs(item.IPs), Online: item.Online, LastSeen: lastSeen})
	}
	if len(result.Peers) < len(raw.Peer) {
		result.InventoryComplete = false
	}
	return result, nil
}

func safeID(value string) bool {
	for _, char := range value {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
			return false
		}
	}
	return true
}
func safeText(value string, limit int) string {
	value = strings.Map(func(char rune) rune {
		if char < 32 || char == 127 {
			return -1
		}
		return char
	}, value)
	if len(value) > limit {
		value = value[:limit]
	}
	return value
}
func safeIPs(values []string) []string {
	result := make([]string, 0, 2)
	for _, value := range values {
		if len(result) >= 2 {
			break
		}
		if ip := net.ParseIP(value); ip != nil {
			result = append(result, ip.String())
		}
	}
	return result
}
