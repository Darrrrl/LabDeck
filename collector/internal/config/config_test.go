package config

import "testing"

func TestValidateRequiresExplicitSelections(t *testing.T) {
	value := Config{HostID: "server", OutputDirectory: "/var/lib/labdeck-collector/public/system"}
	if err := value.Validate(); err == nil {
		t.Fatal("expected missing selections to fail")
	}
}

func TestValidateRejectsDuplicateMounts(t *testing.T) {
	value := Config{HostID: "server", OutputDirectory: "/tmp/output", Filesystems: []Filesystem{{ID: "root", Path: "/"}, {ID: "root-copy", Path: "/"}}, Interfaces: []Entity{{ID: "lan", Name: "eth0"}}}
	if err := value.Validate(); err == nil {
		t.Fatal("expected duplicate mount path to fail")
	}
}
