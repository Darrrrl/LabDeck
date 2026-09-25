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

func TestSelfTestProgressResultsAndBounds(t *testing.T) {
	raw := []byte(`{"device":{"protocol":"ATA"},"ata_smart_data":{"self_test":{"status":{"value":249,"remaining_percent":90},"polling_minutes":{"short":2,"extended":600}}},"ata_smart_self_test_log":{"standard":{"table":[{"type":{"value":2},"status":{"value":112,"string":"SECRET_CANARY"},"lifetime_hours":300},{"type":{"value":1},"status":{"value":0},"lifetime_hours":200},{"status":{"value":16}},{"status":{"value":32}},{"status":{"value":240}},{"status":{"value":0}}]}}}`)
	result := Normalize(raw, 0, selected(), time.Now().UTC())
	test := result.SelfTest
	if test == nil || test.State != "running" || test.RemainingPercent == nil || *test.RemainingPercent != 90 || len(test.History) != 5 || test.History[0].Result != "failed" || test.History[1].Result != "passed" || test.History[2].Result != "aborted" || test.History[3].Result != "interrupted" || test.History[4].Result != "running" {
		t.Fatalf("bad self-test projection: %#v", test)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "SECRET_CANARY") {
		t.Fatal("vendor text leaked")
	}
	unknown := Normalize([]byte(`{"device":{"protocol":"ATA"},"ata_smart_data":{"self_test":{"status":{"value":999,"remaining_percent":110}}}}`), 0, selected(), time.Now().UTC())
	if unknown.SelfTest.State != "unknown" || unknown.SelfTest.RemainingPercent != nil {
		t.Fatal("invalid status made progress")
	}
	absent := Normalize([]byte(`{"device":{"protocol":"ATA"}}`), 0, selected(), time.Now().UTC())
	if absent.SelfTest != nil {
		t.Fatal("missing test evidence invented")
	}
}
