package smart

import (
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
)

func TestControlRejectsUnlistedAndInvalidRequests(t *testing.T) {
	disks := []config.SmartDisk{{ID: "disk-a", Path: "/dev/disk/by-id/ata-example", DeviceType: "sat"}}
	for _, test := range []struct{ request, status string }{
		{`{"diskId":"other","type":"short"}`, "unknown-disk"},
		{`{"diskId":"disk-a","type":"erase"}`, "invalid-request"},
		{`{"diskId":"disk-a","type":"short","path":"/dev/sda"}`, "invalid-request"},
	} {
		listener, err := net.Listen("unix", filepath.Join(t.TempDir(), "control.sock"))
		if err != nil {
			t.Fatal(err)
		}
		client, err := net.Dial("unix", listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		server, err := listener.Accept()
		if err != nil {
			t.Fatal(err)
		}
		done := make(chan struct{})
		go func() {
			handleTest(server, disks, map[string]time.Time{}, filepath.Join(t.TempDir(), "last.json"))
			close(done)
		}()
		if _, err := client.Write([]byte(test.request)); err != nil {
			t.Fatal(err)
		}
		if err := client.(*net.UnixConn).CloseWrite(); err != nil {
			t.Fatal(err)
		}
		var response testResponse
		if err := json.NewDecoder(client).Decode(&response); err != nil {
			t.Fatal(err)
		}
		if response.Status != test.status {
			t.Fatalf("got %s, want %s", response.Status, test.status)
		}
		client.Close()
		listener.Close()
		<-done
	}
}
