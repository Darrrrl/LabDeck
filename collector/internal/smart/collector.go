package smart

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
	"github.com/labdeck/labdeck/collector/internal/snapshots"
)

const smartctlPath = "/usr/sbin/smartctl"
const maxOutput = 2 << 20
const maxSafeInteger = uint64(9_007_199_254_740_991)

type cappedBuffer struct{ bytes.Buffer }

func (value *cappedBuffer) Write(chunk []byte) (int, error) {
	if value.Len()+len(chunk) > maxOutput {
		return 0, errors.New("SMART output too large")
	}
	return value.Buffer.Write(chunk)
}

func Collect(ctx context.Context, disks []config.SmartDisk, now time.Time) snapshots.SmartSnapshot {
	result := snapshots.SmartSnapshot{SchemaVersion: snapshots.SchemaVersion, GeneratedAt: now, Disks: make([]snapshots.SmartDisk, 0, len(disks))}
	for _, selected := range disks {
		at := time.Now().UTC()
		entry := snapshots.SmartDisk{ID: selected.ID, Label: selected.Label, State: "read-failed", Health: "unknown", Protocol: "unknown", ObservedAt: at}
		if entry.Label == "" {
			entry.Label = selected.ID
		}
		if ctx.Err() != nil {
			entry.State = "timeout"
			result.Disks = append(result.Disks, entry)
			continue
		}
		if err := validateDevice(selected.Path); err != nil {
			if errors.Is(err, os.ErrPermission) {
				entry.State = "permission-denied"
			} else {
				entry.State = "unsupported"
			}
			result.Disks = append(result.Disks, entry)
			continue
		}
		diskCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		output, status, err := run(diskCtx, selected)
		if diskCtx.Err() != nil {
			entry.State = "timeout"
		} else if err != nil {
			entry.State = "read-failed"
		} else {
			entry = Normalize(output, status, selected, at)
		}
		cancel()
		result.Disks = append(result.Disks, entry)
	}
	return result
}

func validateDevice(path string) error {
	if !strings.HasPrefix(path, "/dev/disk/by-id/") || filepath.Clean(path) != path {
		return errors.New("unapproved device path")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(resolved, "/dev/") || strings.HasPrefix(resolved, "/dev/disk/by-id/") {
		return errors.New("device resolves outside approved tree")
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeDevice == 0 || info.Mode()&os.ModeCharDevice != 0 {
		return errors.New("device is not a block device")
	}
	return nil
}

func run(ctx context.Context, selected config.SmartDisk) ([]byte, int, error) {
	args := []string{"-a", "-j", "-n", "standby,3", "-d", selected.DeviceType, selected.Path}
	command := exec.CommandContext(ctx, smartctlPath, args...)
	var output cappedBuffer
	command.Stdout = &output
	command.Stderr = io.Discard
	err := command.Run()
	if err == nil {
		return output.Bytes(), 0, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return output.Bytes(), exit.ExitCode(), nil
	}
	return nil, 0, err
}

func Normalize(output []byte, exitStatus int, selected config.SmartDisk, observedAt time.Time) snapshots.SmartDisk {
	result := snapshots.SmartDisk{ID: selected.ID, Label: selected.Label, State: "read-failed", Health: "unknown", Protocol: "unknown", ObservedAt: observedAt}
	if result.Label == "" {
		result.Label = selected.ID
	}
	if len(output) == 0 || len(output) > maxOutput || exitStatus < 0 || exitStatus > 255 {
		return result
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.UseNumber()
	var raw map[string]any
	if err := decoder.Decode(&raw); err != nil || raw == nil {
		return result
	}
	if mode := strings.ToLower(stringAt(raw, "power_mode", "current")); mode == "standby" || mode == "sleep" {
		result.State = "asleep"
		return result
	}
	if hasPermissionMessage(raw) {
		result.State = "permission-denied"
		return result
	}
	if exitStatus&1 != 0 || exitStatus&2 != 0 && stringAt(raw, "device", "protocol") == "" {
		result.State = "unsupported"
		return result
	}
	protocol := strings.ToUpper(stringAt(raw, "device", "protocol"))
	switch protocol {
	case "ATA", "NVME", "SCSI":
		result.Protocol = protocol
	default:
		result.State = "unsupported"
		return result
	}
	result.State = "ok"
	result.Model = safeText(stringAt(raw, "model_name"), 128)
	if result.Model == "" {
		result.Model = safeText(stringAt(raw, "product"), 128)
	}
	serial := stringAt(raw, "serial_number")
	if serial != "" {
		hash := sha256.Sum256([]byte(serial))
		result.Identity = hex.EncodeToString(hash[:16])
		if len(serial) > 4 {
			result.SerialSuffix = serial[len(serial)-4:]
		} else {
			result.SerialSuffix = serial
		}
	}
	result.CapacityBytes = safeUint(valueAt(raw, "user_capacity", "bytes"))
	result.TemperatureC = safeTemperature(valueAt(raw, "temperature", "current"))
	result.PowerOnHours = safeUint(valueAt(raw, "power_on_time", "hours"))
	if passed, ok := valueAt(raw, "smart_status", "passed").(bool); ok {
		if passed {
			result.Health = "passed"
		} else {
			result.Health = "failed"
		}
	}
	if exitStatus&8 != 0 {
		result.Health = "failed"
	} else if exitStatus&(4|16|32|64|128) != 0 && result.Health != "failed" {
		result.Health = "warning"
	}
	switch protocol {
	case "ATA":
		result.SelfTest = selfTests(raw)
		attributes := valueAt(raw, "ata_smart_attributes", "table")
		result.ATA = &snapshots.SmartATA{Reallocated: attribute(attributes, 5), Pending: attribute(attributes, 197), Uncorrectable: attribute(attributes, 198)}
		if positive(result.ATA.Pending) || positive(result.ATA.Uncorrectable) {
			if result.Health != "failed" {
				result.Health = "warning"
			}
		}
	case "NVME":
		result.NVMe = &snapshots.SmartNVMe{CriticalWarning: safeUint(valueAt(raw, "nvme_smart_health_information_log", "critical_warning")), AvailableSpare: safeUint(valueAt(raw, "nvme_smart_health_information_log", "available_spare")), PercentageUsed: safeUint(valueAt(raw, "nvme_smart_health_information_log", "percentage_used")), MediaErrors: decimal(valueAt(raw, "nvme_smart_health_information_log", "media_errors")), ErrorLogEntries: decimal(valueAt(raw, "nvme_smart_health_information_log", "num_err_log_entries"))}
		if result.TemperatureC == nil {
			result.TemperatureC = safeTemperature(valueAt(raw, "nvme_smart_health_information_log", "temperature"))
		}
		if result.PowerOnHours == nil {
			result.PowerOnHours = safeUint(valueAt(raw, "nvme_smart_health_information_log", "power_on_hours"))
		}
		if result.NVMe.CriticalWarning != nil && *result.NVMe.CriticalWarning > 0 && result.Health != "failed" {
			result.Health = "warning"
		}
	case "SCSI":
		result.SCSI = &snapshots.SmartSCSI{GrownDefects: decimal(valueAt(raw, "scsi_grown_defect_list")), ReadUncorrected: decimal(valueAt(raw, "scsi_error_counter_log", "read", "total_uncorrected_errors"))}
	}
	return result
}

func valueAt(source any, path ...string) any {
	current := source
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}
func stringAt(source any, path ...string) string {
	value, _ := valueAt(source, path...).(string)
	return value
}
func decimal(value any) string {
	var raw string
	switch typed := value.(type) {
	case json.Number:
		raw = typed.String()
	case string:
		raw = typed
	}
	if raw == "" || len(raw) > 39 {
		return ""
	}
	for _, digit := range raw {
		if digit < '0' || digit > '9' {
			return ""
		}
	}
	number, ok := new(big.Int).SetString(raw, 10)
	if !ok || number.BitLen() > 128 {
		return ""
	}
	return number.String()
}
func safeUint(value any) *uint64 {
	text := decimal(value)
	if text == "" {
		return nil
	}
	number, err := strconv.ParseUint(text, 10, 64)
	if err != nil || number > maxSafeInteger {
		return nil
	}
	return &number
}
func safeTemperature(value any) *float64 {
	if value == nil {
		return nil
	}
	var text string
	switch typed := value.(type) {
	case json.Number:
		text = typed.String()
	case string:
		text = typed
	default:
		return nil
	}
	number, err := strconv.ParseFloat(text, 64)
	if err != nil || number < -100 || number > 200 {
		return nil
	}
	return &number
}
func attribute(value any, id int) string {
	items, ok := value.([]any)
	if !ok {
		return ""
	}
	for _, item := range items {
		raw, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if number := safeUint(raw["id"]); number != nil && *number == uint64(id) {
			return decimal(valueAt(raw, "raw", "value"))
		}
	}
	return ""
}
func positive(value string) bool {
	number, err := strconv.ParseUint(value, 10, 64)
	return err == nil && number > 0
}
func safeText(value string, max int) string {
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, value)
	if len(value) > max {
		return value[:max]
	}
	return value
}
func hasPermissionMessage(raw map[string]any) bool {
	messages, ok := valueAt(raw, "smartctl", "messages").([]any)
	if !ok {
		return false
	}
	for _, item := range messages {
		text := strings.ToLower(stringAt(item, "string"))
		if strings.Contains(text, "permission denied") {
			return true
		}
	}
	return false
}

// ATA status codes are projected to fixed labels; vendor strings never leave the helper.
func selfTests(raw map[string]any) *snapshots.SmartSelfTest {
	status := safeUint(valueAt(raw, "ata_smart_data", "self_test", "status", "value"))
	log := valueAt(raw, "ata_smart_self_test_log", "standard")
	if status == nil && log == nil {
		return nil
	}
	result := &snapshots.SmartSelfTest{State: "unknown", History: []snapshots.SmartTestResult{},
		ShortMinutes:    safeUint(valueAt(raw, "ata_smart_data", "self_test", "polling_minutes", "short")),
		ExtendedMinutes: safeUint(valueAt(raw, "ata_smart_data", "self_test", "polling_minutes", "extended"))}
	if status != nil && *status <= 255 {
		result.State = "idle"
		if *status>>4 == 15 {
			result.State = "running"
			remaining := safeUint(valueAt(raw, "ata_smart_data", "self_test", "status", "remaining_percent"))
			if remaining != nil && *remaining <= 100 {
				result.RemainingPercent = remaining
			}
		}
	}
	rows, _ := valueAt(log, "table").([]any)
	for _, row := range rows {
		if len(result.History) == 5 {
			break
		}
		entry := snapshots.SmartTestResult{Type: "other", Result: "unknown", LifetimeHours: safeUint(valueAt(row, "lifetime_hours"))}
		if kind := safeUint(valueAt(row, "type", "value")); kind != nil {
			switch *kind {
			case 1, 129:
				entry.Type = "short"
			case 2, 130:
				entry.Type = "extended"
			}
		}
		if code := safeUint(valueAt(row, "status", "value")); code != nil && *code <= 255 {
			switch *code >> 4 {
			case 0:
				entry.Result = "passed"
			case 1:
				entry.Result = "aborted"
			case 2:
				entry.Result = "interrupted"
			case 3, 4, 5, 6, 7, 8:
				entry.Result = "failed"
			case 15:
				entry.Result = "running"
			}
		}
		result.History = append(result.History, entry)
	}
	return result
}
