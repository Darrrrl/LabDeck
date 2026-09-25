package tailscale

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestSafeProjection(t *testing.T) {
	fixture, err := os.ReadFile("../../testdata/tailscale/status.json")
	if err != nil {
		t.Fatal(err)
	}
	result, err := Normalize(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if result.BackendState != "Running" || result.SelfName != "lab-server" || len(result.Peers) != 2 || result.Peers[0].LastSeen != nil || result.Peers[1].LastSeen == nil || !result.Peers[0].Online || result.Peers[1].Online {
		t.Fatalf("wrong status projection: %#v", result)
	}
	encoded, _ := json.Marshal(result)
	for _, secret := range []string{"TS_SECRET_CANARY", "private@example.test", "ProfilePicURL", "nodekey:"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("private field escaped: %s", secret)
		}
	}
}

func TestEmptyAndPartialPeerInventory(t *testing.T) {
	empty, err := Normalize([]byte(`{"Version":"1.90","BackendState":"Running","Peer":{}}`))
	if err != nil || !empty.InventoryComplete || len(empty.Peers) != 0 {
		t.Fatalf("empty peer inventory invalid: %#v %v", empty, err)
	}
	var source struct {
		Version      string
		BackendState string
		Peer         map[string]peerRaw
	}
	source.Version, source.BackendState, source.Peer = "1.90", "Running", map[string]peerRaw{}
	for i := 0; i < 300; i++ {
		source.Peer[fmt.Sprintf("key-%03d", i)] = peerRaw{ID: fmt.Sprintf("n-peer-%03d", i), HostName: "synthetic"}
	}
	encoded, _ := json.Marshal(source)
	partial, err := Normalize(encoded)
	if err != nil || partial.InventoryComplete || len(partial.Peers) != maxPeers {
		t.Fatalf("partial inventory invalid: %#v %v", partial, err)
	}
	if _, err := Normalize([]byte(`{"Version":"1"}{"Version":"2"}`)); err == nil {
		t.Fatal("accepted multiple JSON documents")
	}
}
