package smart

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	value, err := os.ReadFile("../../testdata/smart/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func selected() config.SmartDisk {
	return config.SmartDisk{ID: "disk-a", Label: "Data disk", Path: "/dev/disk/by-id/example", DeviceType: "auto"}
}

func TestATAProjectionAndExitBitmask(t *testing.T) {
	at := time.Now().UTC()
	result := Normalize(fixture(t, "ata"), 0, selected(), at)
	if result.Protocol != "ATA" || result.Health != "warning" || result.ATA == nil || result.ATA.Reallocated != "2" || result.ATA.Pending != "1" || result.ATA.Uncorrectable != "0" {
		t.Fatalf("incorrect ATA projection: %#v", result)
	}
	if result.Identity == "" || result.SerialSuffix != "1234" {
		t.Fatalf("missing safe identity: %#v", result)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "SMART_SECRET_CANARY") || strings.Contains(string(encoded), "SYNTHETIC-ATA-") {
		t.Fatal("raw secret or serial escaped")
	}
	failing := Normalize(fixture(t, "ata"), 8, selected(), at)
	if failing.Health != "failed" {
		t.Fatal("SMART failure bit ignored")
	}
	warning := Normalize(fixture(t, "ata"), 64, selected(), at)
	if warning.Health != "warning" {
		t.Fatal("error evidence bit ignored")
	}
	commandWarning := Normalize(fixture(t, "ata"), 4, selected(), at)
	if commandWarning.Health != "warning" {
		t.Fatal("SMART command failure bit ignored")
	}
}
func TestLargeCounterAndNegativeTemperature(t *testing.T) {
	value := Normalize([]byte(`{"device":{"protocol":"NVMe"},"temperature":{"current":-5.5},"nvme_smart_health_information_log":{"media_errors":"340282366920938463463374607431768211455"}}`), 0, selected(), time.Now().UTC())
	if value.NVMe == nil || value.NVMe.MediaErrors != "340282366920938463463374607431768211455" || value.TemperatureC == nil || *value.TemperatureC != -5.5 {
		t.Fatalf("large counter or temperature lost: %#v", value)
	}
}
func TestNVMeAndSCSIProjection(t *testing.T) {
	at := time.Now().UTC()
	nvme := Normalize(fixture(t, "nvme"), 0, selected(), at)
	if nvme.Protocol != "NVME" || nvme.Health != "warning" || nvme.NVMe == nil || nvme.NVMe.MediaErrors != "18446744073709551615" || nvme.NVMe.AvailableSpare == nil || *nvme.NVMe.AvailableSpare != 92 {
		t.Fatalf("bad NVMe projection: %#v", nvme)
	}
	scsi := Normalize(fixture(t, "scsi"), 0, selected(), at)
	if scsi.Protocol != "SCSI" || scsi.SCSI == nil || scsi.SCSI.GrownDefects != "3" || scsi.SCSI.ReadUncorrected != "0" {
		t.Fatalf("bad SCSI projection: %#v", scsi)
	}
}
func TestStandbyUnsupportedPermissionAndMalformed(t *testing.T) {
	at := time.Now().UTC()
	if value := Normalize([]byte(`{"power_mode":{"current":"STANDBY"}}`), 3, selected(), at); value.State != "asleep" {
		t.Fatalf("standby misclassified: %#v", value)
	}
	if value := Normalize([]byte(`{"smartctl":{"messages":[{"string":"Permission denied"}]}}`), 2, selected(), at); value.State != "permission-denied" {
		t.Fatalf("permission misclassified: %#v", value)
	}
	if value := Normalize([]byte(`{"device":{"protocol":"unknown"}}`), 0, selected(), at); value.State != "unsupported" {
		t.Fatalf("unsupported misclassified: %#v", value)
	}
	if value := Normalize([]byte(`{invalid`), 0, selected(), at); value.State != "read-failed" {
		t.Fatalf("malformed misclassified: %#v", value)
	}
	if err := validateDevice("/tmp/fake-device"); err == nil {
		t.Fatal("unapproved device accepted")
	}
}
