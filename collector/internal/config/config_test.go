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

func TestSmartAllowlistRejectsTraversalTypeAndSharedOutput(t *testing.T) {
	base := Config{HostID: "server", OutputDirectory: "/var/lib/labdeck-collector/public/system", SmartOutputDirectory: "/var/lib/labdeck-collector/public/smart", Filesystems: []Filesystem{{ID: "root", Path: "/"}}, Interfaces: []Entity{{ID: "lan", Name: "eth0"}}, SmartDisks: []SmartDisk{{ID: "disk-a", Path: "/dev/disk/by-id/ata-example", DeviceType: "sat"}}}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Config){
		func(value *Config) { value.SmartDisks[0].Path = "/dev/disk/by-id/../sda" },
		func(value *Config) { value.SmartDisks[0].Path = "/dev/sda" },
		func(value *Config) { value.SmartDisks[0].DeviceType = "-x" },
		func(value *Config) { value.SmartOutputDirectory = value.OutputDirectory },
		func(value *Config) { value.SmartDisks = append(value.SmartDisks, value.SmartDisks[0]) },
	} {
		candidate := base
		candidate.SmartDisks = append([]SmartDisk(nil), base.SmartDisks...)
		mutate(&candidate)
		if err := candidate.Validate(); err == nil {
			t.Fatalf("invalid SMART configuration accepted: %#v", candidate)
		}
	}
}
