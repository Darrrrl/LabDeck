package snapshots

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSharedFixtureMatchesGoProtocol(t *testing.T) {
	value, err := os.ReadFile(filepath.Join("..", "..", "..", "tests", "fixtures", "host", "system-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(value, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != SchemaVersion || snapshot.HostID != "synthetic-server" || snapshot.Capabilities.Summary.Data == nil {
		t.Fatalf("unexpected fixture: %+v", snapshot)
	}
}

func TestWriteAtomicUsesFixedPrivateFile(t *testing.T) {
	directory := t.TempDir()
	snapshot := Snapshot{SchemaVersion: SchemaVersion, CollectorVersion: "test", HostID: "server", BootID: "boot", Generation: "generation", Sequence: 1, GeneratedAt: time.Unix(1, 0).UTC()}
	if err := WriteAtomic(directory, snapshot); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(directory, Filename))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != Filename {
		t.Fatalf("unexpected entries: %v", entries)
	}
}

func TestWriteAtomicRejectsSymlinkDirectory(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target")
	link := filepath.Join(root, "link")
	if err := os.Mkdir(target, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := WriteAtomic(link, Snapshot{}); err == nil {
		t.Fatal("expected symlink rejection")
	}
}
