package smart

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
)

type testRequest struct {
	DiskID string `json:"diskId"`
	Type   string `json:"type"`
}

type testResponse struct {
	Status string `json:"status"`
}

// ServeTests exposes only the two fixed self-test starts for configured disks.
// The socket directory is root-owned; the socket's group controls admission.
func ServeTests(ctx context.Context, directory string, disks []config.SmartDisk) error {
	info, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || owner.Uid != 0 || info.Mode().Perm()&0o022 != 0 {
		return errors.New("SMART directory must be root-owned and not writable by group or others")
	}
	lock, err := os.OpenFile(filepath.Join(directory, "control.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return errors.New("SMART control is already running")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	lastPath := filepath.Join(directory, "control-last.json")
	last, err := loadLast(lastPath)
	if err != nil {
		return err
	}
	active := map[string]time.Time{}
	for _, disk := range disks {
		if at, ok := last[disk.ID]; ok {
			active[disk.ID] = at
		}
	}
	last = active
	path := filepath.Join(directory, "control.sock")
	if existing, err := os.Lstat(path); err == nil {
		if existing.Mode()&os.ModeSocket == 0 {
			return errors.New("control path is not a socket")
		}
		if err := os.Remove(path); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(path)
	if err := os.Chmod(path, 0o660); err != nil {
		return err
	}
	go func() { <-ctx.Done(); listener.Close() }()
	for {
		connection, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		handleTest(connection, disks, last, lastPath)
	}
}

func handleTest(connection net.Conn, disks []config.SmartDisk, last map[string]time.Time, lastPath string) {
	defer connection.Close()
	connection.SetDeadline(time.Now().Add(35 * time.Second))
	decoder := json.NewDecoder(io.LimitReader(connection, 1025))
	decoder.DisallowUnknownFields()
	var request testRequest
	if err := decoder.Decode(&request); err != nil {
		respond(connection, "invalid-request")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		respond(connection, "invalid-request")
		return
	}
	if request.Type != "short" && request.Type != "extended" {
		respond(connection, "invalid-request")
		return
	}
	var selected *config.SmartDisk
	for i := range disks {
		if disks[i].ID == request.DiskID {
			selected = &disks[i]
			break
		}
	}
	if selected == nil {
		respond(connection, "unknown-disk")
		return
	}
	if time.Since(last[request.DiskID]) < 10*time.Minute {
		respond(connection, "rate-limited")
		return
	}
	if err := validateDevice(selected.Path); err != nil {
		respond(connection, "device-unavailable")
		return
	}
	preflightContext, stopPreflight := context.WithTimeout(context.Background(), 20*time.Second)
	output, exitStatus, readError := run(preflightContext, *selected)
	stopPreflight()
	if readError != nil {
		respond(connection, "device-unavailable")
		return
	}
	evidence := Normalize(output, exitStatus, *selected, time.Now())
	if evidence.State != "ok" || evidence.Protocol != "ATA" {
		respond(connection, "device-unavailable")
		return
	}
	if evidence.SelfTest != nil && evidence.SelfTest.State == "running" {
		respond(connection, "already-running")
		return
	}
	commandType := request.Type
	if commandType == "extended" {
		commandType = "long"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, smartctlPath, "-t", commandType, "-d", selected.DeviceType, selected.Path)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	last[request.DiskID] = time.Now()
	if err := saveLast(lastPath, last); err != nil {
		respond(connection, "rejected")
		return
	}
	if err := command.Run(); err != nil {
		log.Printf("SMART self-test request disk=%s type=%s outcome=rejected", selected.ID, request.Type)
		respond(connection, "rejected")
		return
	}
	log.Printf("SMART self-test request disk=%s type=%s outcome=started", selected.ID, request.Type)
	respond(connection, "started")
}

func respond(connection net.Conn, status string) {
	_ = json.NewEncoder(connection).Encode(testResponse{Status: status})
}

func loadLast(path string) (map[string]time.Time, error) {
	last := map[string]time.Time{}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return last, nil
	}
	if err != nil || len(data) > 4096 {
		return nil, errors.New("invalid SMART control state")
	}
	var recorded map[string]int64
	if err := json.Unmarshal(data, &recorded); err != nil {
		return nil, errors.New("invalid SMART control state")
	}
	if len(recorded) > 256 {
		return nil, errors.New("invalid SMART control state")
	}
	for id, at := range recorded {
		last[id] = time.UnixMilli(at)
	}
	return last, nil
}

func saveLast(path string, last map[string]time.Time) error {
	recorded := map[string]int64{}
	for id, at := range last {
		recorded[id] = at.UnixMilli()
	}
	data, err := json.Marshal(recorded)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".control-last-*")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	defer temporary.Close()
	if err := temporary.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), path)
}
