package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Filesystem struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}
type Entity struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type SmartDisk struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Path       string `json:"path"`
	DeviceType string `json:"deviceType"`
}
type DockerProject struct {
	ID          string `json:"id"`
	ComposeFile string `json:"composeFile"`
}
type Config struct {
	HostID                  string          `json:"hostId"`
	OutputDirectory         string          `json:"outputDirectory"`
	IntervalSeconds         int             `json:"intervalSeconds"`
	Filesystems             []Filesystem    `json:"filesystems"`
	Interfaces              []Entity        `json:"interfaces"`
	BlockDevices            []Entity        `json:"blockDevices"`
	Docker                  bool            `json:"docker"`
	DockerControlDirectory  string          `json:"dockerControlDirectory"`
	DockerControlContainers []string        `json:"dockerControlContainers"`
	DockerControlProjects   []DockerProject `json:"dockerControlProjects"`
	FileShares              []Filesystem    `json:"fileShares"`
	Tailscale               bool            `json:"tailscale"`
	SmartOutputDirectory    string          `json:"smartOutputDirectory"`
	SmartDisks              []SmartDisk     `json:"smartDisks"`
}

var safeID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
var safeDevice = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$`)
var safeDockerName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)

func Load(path string) (Config, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Config{}, fmt.Errorf("open config: %w", err)
	}
	if info.Mode().Perm()&0o022 != 0 {
		return Config{}, errors.New("config must not be writable by group or other users")
	}
	file, err := os.Open(path)
	if err != nil {
		return Config{}, fmt.Errorf("open config: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.DisallowUnknownFields()
	var value Config
	if err := decoder.Decode(&value); err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	if err := ensureEOF(decoder); err != nil {
		return Config{}, err
	}
	if err := value.Validate(); err != nil {
		return Config{}, err
	}
	return value, nil
}

func ensureEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err == io.EOF {
		return nil
	}
	return errors.New("config must contain exactly one JSON document")
}

func (c *Config) Validate() error {
	if !safeID.MatchString(c.HostID) {
		return errors.New("hostId must be a stable safe identifier")
	}
	if !filepath.IsAbs(c.OutputDirectory) {
		return errors.New("outputDirectory must be absolute")
	}
	if c.IntervalSeconds == 0 {
		c.IntervalSeconds = 5
	}
	if c.IntervalSeconds < 1 || c.IntervalSeconds > 300 {
		return errors.New("intervalSeconds must be between 1 and 300")
	}
	if len(c.Filesystems) == 0 {
		return errors.New("at least one filesystem must be selected")
	}
	if len(c.Interfaces) == 0 {
		return errors.New("at least one interface must be selected")
	}
	ids := map[string]bool{}
	paths := map[string]bool{}
	for i := range c.Filesystems {
		item := &c.Filesystems[i]
		item.Path = filepath.Clean(item.Path)
		if !safeID.MatchString(item.ID) || !filepath.IsAbs(item.Path) {
			return errors.New("filesystem IDs must be safe and paths absolute")
		}
		if ids[item.ID] || paths[item.Path] {
			return errors.New("filesystem IDs and paths must be unique")
		}
		ids[item.ID], paths[item.Path] = true, true
	}
	for _, group := range [][]Entity{c.Interfaces, c.BlockDevices} {
		for _, item := range group {
			if !safeID.MatchString(item.ID) || !safeDevice.MatchString(item.Name) {
				return errors.New("entity IDs and names must be safe")
			}
			if ids[item.ID] {
				return errors.New("entity IDs must be unique across the snapshot")
			}
			ids[item.ID] = true
		}
	}
	if len(c.FileShares) > 4 {
		return errors.New("too many file shares")
	}
	sharePaths := map[string]bool{}
	for _, item := range c.FileShares {
		if !safeID.MatchString(item.ID) || ids[item.ID] || len(item.Path) > 512 || !filepath.IsAbs(item.Path) || filepath.Clean(item.Path) != item.Path || sharePaths[item.Path] {
			return errors.New("invalid file share")
		}
		ids[item.ID], sharePaths[item.Path] = true, true
	}
	if len(c.SmartDisks) > 16 {
		return errors.New("too many SMART disks")
	}
	if len(c.SmartDisks) > 0 && (!filepath.IsAbs(c.SmartOutputDirectory) || filepath.Clean(c.SmartOutputDirectory) == filepath.Clean(c.OutputDirectory)) {
		return errors.New("SMART output directory must be separate and absolute")
	}
	pathsSmart := map[string]bool{}
	for _, item := range c.SmartDisks {
		if !safeID.MatchString(item.ID) || ids[item.ID] || len(item.Label) > 128 || item.Path == "" || !filepath.IsAbs(item.Path) || !strings.HasPrefix(item.Path, "/dev/disk/by-id/") || filepath.Clean(item.Path) != item.Path || pathsSmart[item.Path] {
			return errors.New("SMART disk identity, label or path is invalid")
		}
		if strings.ContainsAny(item.Label, "\r\n\x00") {
			return errors.New("SMART disk label is invalid")
		}
		switch item.DeviceType {
		case "auto", "ata", "nvme", "scsi", "sat":
		default:
			return errors.New("SMART device type is unsupported")
		}
		ids[item.ID], pathsSmart[item.Path] = true, true
	}
	if len(c.DockerControlContainers) > 100 || len(c.DockerControlProjects) > 20 {
		return errors.New("too many Docker control targets")
	}
	if len(c.DockerControlContainers)+len(c.DockerControlProjects) > 0 && (!c.Docker || !filepath.IsAbs(c.DockerControlDirectory) || filepath.Clean(c.DockerControlDirectory) == filepath.Clean(c.OutputDirectory) || filepath.Clean(c.DockerControlDirectory) == filepath.Clean(c.SmartOutputDirectory)) {
		return errors.New("Docker control requires Docker observation and a separate absolute directory")
	}
	controls := map[string]bool{}
	for _, name := range c.DockerControlContainers {
		if !safeDockerName.MatchString(name) || controls["container:"+name] {
			return errors.New("invalid Docker control container")
		}
		controls["container:"+name] = true
	}
	for _, project := range c.DockerControlProjects {
		if !safeDockerName.MatchString(project.ID) || controls["project:"+project.ID] || !strings.HasPrefix(project.ComposeFile, "/etc/labdeck/compose/") || filepath.Clean(project.ComposeFile) != project.ComposeFile {
			return errors.New("invalid Docker control project")
		}
		controls["project:"+project.ID] = true
	}
	return nil
}
