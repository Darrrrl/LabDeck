package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

type Filesystem struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}
type Entity struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Config struct {
	HostID          string       `json:"hostId"`
	OutputDirectory string       `json:"outputDirectory"`
	IntervalSeconds int          `json:"intervalSeconds"`
	Filesystems     []Filesystem `json:"filesystems"`
	Interfaces      []Entity     `json:"interfaces"`
	BlockDevices    []Entity     `json:"blockDevices"`
}

var safeID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
var safeDevice = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$`)

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
	return nil
}
