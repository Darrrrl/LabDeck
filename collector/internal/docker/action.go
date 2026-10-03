package docker

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
	"strings"
	"syscall"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
)

type ActionRequest struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Action string `json:"action"`
}
type ActionResponse struct {
	Status string `json:"status"`
}

const dockerCLI = "/usr/bin/docker"

// ServeActions accepts only configured container names or Compose projects.
// The web app never sees Docker's socket or Compose file paths.
func ServeActions(ctx context.Context, directory string, containers []string, projects []config.DockerProject) error {
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 {
		return errors.New("invalid Docker control directory")
	}
	lock, err := os.OpenFile(filepath.Join(directory, "control.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return errors.New("Docker control already running")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	path := filepath.Join(directory, "control.sock")
	if existing, err := os.Lstat(path); err == nil {
		if existing.Mode()&os.ModeSocket == 0 {
			return errors.New("invalid Docker control socket")
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
		handleAction(connection, containers, projects)
	}
}

func handleAction(connection net.Conn, containers []string, projects []config.DockerProject) {
	defer connection.Close()
	connection.SetDeadline(time.Now().Add(75 * time.Second))
	decoder := json.NewDecoder(io.LimitReader(connection, 1025))
	decoder.DisallowUnknownFields()
	var request ActionRequest
	if decoder.Decode(&request) != nil {
		actionReply(connection, "invalid-request")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		actionReply(connection, "invalid-request")
		return
	}
	if request.Action != "start" && request.Action != "stop" && request.Action != "restart" {
		actionReply(connection, "invalid-request")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var err error
	switch request.Kind {
	case "container":
		if !safeID.MatchString(request.ID) {
			actionReply(connection, "invalid-request")
			return
		}
		err = runContainerAction(ctx, request, containers)
	case "project":
		if !safeComposeName.MatchString(request.ID) {
			actionReply(connection, "invalid-request")
			return
		}
		err = runProjectAction(ctx, request, projects)
	default:
		actionReply(connection, "invalid-request")
		return
	}
	status := "completed"
	if err != nil {
		status = "rejected"
	}
	log.Printf("Docker action kind=%s id=%s action=%s outcome=%s", request.Kind, request.ID, request.Action, status)
	actionReply(connection, status)
}

func runContainerAction(ctx context.Context, request ActionRequest, allowed []string) error {
	inspect := exec.CommandContext(ctx, dockerCLI, "container", "inspect", "--format", "{{.Id}} {{.Name}}", request.ID)
	inspect.Stderr = io.Discard
	output, err := inspect.Output()
	if err != nil || len(output) > 256 {
		return errors.New("container inspect failed")
	}
	fields := strings.Fields(string(output))
	if len(fields) != 2 || fields[0] != request.ID {
		return errors.New("container identity changed")
	}
	name := strings.TrimPrefix(fields[1], "/")
	approved := false
	for _, candidate := range allowed {
		if candidate == name {
			approved = true
			break
		}
	}
	if !approved {
		return errors.New("container not allowlisted")
	}
	command := exec.CommandContext(ctx, dockerCLI, "container", request.Action, request.ID)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	return command.Run()
}

func runProjectAction(ctx context.Context, request ActionRequest, allowed []config.DockerProject) error {
	var path string
	for _, candidate := range allowed {
		if candidate.ID == request.ID {
			path = candidate.ComposeFile
			break
		}
	}
	if path == "" {
		return errors.New("project not allowlisted")
	}
	if !trustedComposePath(path) {
		return errors.New("untrusted Compose file")
	}
	command := exec.CommandContext(ctx, dockerCLI, "compose", "-f", path, "-p", request.ID, request.Action)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	return command.Run()
}

func trustedComposePath(path string) bool {
	if !strings.HasPrefix(path, "/etc/labdeck/compose/") || filepath.Clean(path) != path {
		return false
	}
	for current := path; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 {
			return false
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != 0 {
			return false
		}
		if current == path && !info.Mode().IsRegular() {
			return false
		}
		if current != path && !info.IsDir() {
			return false
		}
		if current == "/" {
			return true
		}
	}
}

func actionReply(connection net.Conn, status string) {
	_ = json.NewEncoder(connection).Encode(ActionResponse{Status: status})
}
