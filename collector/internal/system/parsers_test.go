package system

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func fixture(t *testing.T, name string) string {
	t.Helper()
	value, err := os.ReadFile(filepath.Join("..", "..", "testdata", "proc", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(value)
}

func TestParsersReadSanitizedLinuxFixtures(t *testing.T) {
	cpu, err := ParseCPUStat(fixture(t, "stat"))
	if err != nil {
		t.Fatal(err)
	}
	if cpu.Total != 1110 || cpu.Idle != 850 {
		t.Fatalf("unexpected CPU: %+v", cpu)
	}
	memory, err := ParseMeminfo(fixture(t, "meminfo"))
	if err != nil {
		t.Fatal(err)
	}
	if memory.Total != 16*1024*1024 || memory.Available != 9*1024*1024 {
		t.Fatalf("unexpected memory: %+v", memory)
	}
	network, err := ParseNetwork(fixture(t, "net_dev"))
	if err != nil {
		t.Fatal(err)
	}
	if network["eth0"].Transmit != 54321 {
		t.Fatalf("unexpected network: %+v", network)
	}
	disks, err := ParseDiskstats(fixture(t, "diskstats"))
	if err != nil {
		t.Fatal(err)
	}
	if disks["sda"].ReadSectors != 300 || disks["sda"].WriteSectors != 700 {
		t.Fatalf("unexpected disks: %+v", disks)
	}
	mounts, err := ParseMountinfo(fixture(t, "mountinfo"))
	if err != nil {
		t.Fatal(err)
	}
	if mounts["/srv/media"].FSType != "ext4" || mounts["/srv/media"].Identity != "8:1|/media" {
		t.Fatalf("unexpected mounts: %+v", mounts)
	}
}

func TestRatesRejectFirstSampleResetAndZeroInterval(t *testing.T) {
	if counterRate(1, 2, 0) != nil {
		t.Fatal("zero interval should be unknown")
	}
	if counterRate(2, 1, time.Second) != nil {
		t.Fatal("counter reset should be unknown")
	}
	if value := counterRate(100, 300, 2*time.Second); value == nil || *value != 100 {
		t.Fatalf("unexpected rate: %v", value)
	}
	if value := sectorRate(10, 12, time.Second); value == nil || *value != 1024 {
		t.Fatalf("unexpected sector rate: %v", value)
	}
}

func TestCPUUtilizationRejectsFirstSampleAndReset(t *testing.T) {
	current := CPUCounters{Total: 100, Idle: 60}
	if cpuUtilization(nil, current, time.Second) != nil {
		t.Fatal("first sample should be unknown")
	}
	previous := CPUCounters{Total: 200, Idle: 100}
	if cpuUtilization(&previous, current, time.Second) != nil {
		t.Fatal("reset should be unknown")
	}
	previous = CPUCounters{Total: 50, Idle: 30}
	value := cpuUtilization(&previous, current, time.Second)
	if value == nil || *value != 40 {
		t.Fatalf("unexpected utilization: %v", value)
	}
}
