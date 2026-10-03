package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
	"github.com/labdeck/labdeck/collector/internal/docker"
	"github.com/labdeck/labdeck/collector/internal/shares"
	"github.com/labdeck/labdeck/collector/internal/smart"
	"github.com/labdeck/labdeck/collector/internal/snapshots"
	"github.com/labdeck/labdeck/collector/internal/system"
	"github.com/labdeck/labdeck/collector/internal/tailscale"
)

const version = "0.1.0"

func main() {
	configPath := flag.String("config", "/etc/labdeck/collector.json", "path to root-owned collector configuration")
	once := flag.Bool("once", false, "write one snapshot and exit")
	smartOnce := flag.Bool("smart-once", false, "run fixed SMART reads and write the separate SMART snapshot")
	smartControl := flag.Bool("smart-control", false, "serve fixed SMART self-test starts on a local socket")
	dockerControl := flag.Bool("docker-control", false, "serve allowlisted Docker actions on a local socket")
	shareProbeID := flag.String("share-probe-id", "", "probe one configured remote share in an isolated process")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if runtime.GOOS != "linux" {
		fail("collector requires Linux")
	}
	value, err := config.Load(*configPath)
	if err != nil {
		fail("invalid collector configuration")
	}
	if *shareProbeID != "" {
		for _, item := range value.FileShares {
			if item.ID == *shareProbeID {
				_ = json.NewEncoder(os.Stdout).Encode(shares.Probe(item, time.Now().UTC()))
				return
			}
		}
		fail("unknown share")
	}
	if *dockerControl {
		if *once || *smartOnce || *smartControl || !value.Docker || len(value.DockerControlContainers)+len(value.DockerControlProjects) == 0 {
			fail("Docker control requires an explicit allowlist")
		}
		info, err := os.Lstat(*configPath)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			fail("Docker control configuration must be a regular file")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			fail("Docker control configuration must be root-owned")
		}
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()
		if err := docker.ServeActions(ctx, value.DockerControlDirectory, value.DockerControlContainers, value.DockerControlProjects); err != nil {
			fail("unable to serve Docker actions")
		}
		return
	}
	if *smartOnce || *smartControl {
		if *once || (*smartOnce && *smartControl) || os.Geteuid() != 0 || len(value.SmartDisks) == 0 {
			fail("SMART mode requires root and configured disks")
		}
		info, err := os.Lstat(*configPath)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			fail("SMART configuration must be a regular file")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			fail("SMART configuration must be root-owned")
		}
		if *smartControl {
			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()
			if err := smart.ServeTests(ctx, value.SmartOutputDirectory, value.SmartDisks); err != nil {
				fail("unable to serve SMART test requests")
			}
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := snapshots.WriteSmartAtomic(value.SmartOutputDirectory, smart.Collect(ctx, value.SmartDisks, time.Now().UTC())); err != nil {
			fail("unable to publish SMART snapshot")
		}
		return
	}
	bootID, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		fail("unable to read host boot identity")
	}
	generation, err := randomID()
	if err != nil {
		fail("unable to initialize collector")
	}
	sampler := system.NewSampler()
	var dockerCollector *docker.Collector
	var dockerCapability *snapshots.Capability[snapshots.DockerInventory]
	var lastDocker time.Time
	var tailscaleCapability *snapshots.Capability[snapshots.TailscaleStatus]
	var lastTailscale time.Time
	var shareCapability *snapshots.Capability[[]snapshots.FileShare]
	var lastShares time.Time
	if value.Docker {
		dockerCollector = docker.New()
	}
	var sequence uint64
	collect := func() {
		sequence++
		now := time.Now().UTC()
		capabilities := sampler.Collect(value, now)
		if dockerCollector != nil {
			if dockerCapability == nil || now.Sub(lastDocker) >= 15*time.Second {
				lastDocker = now
				observed, err := dockerCollector.Collect(now)
				if err != nil {
					failed := snapshots.Failure[snapshots.DockerInventory](now, "read-failed")
					dockerCapability = &failed
				} else {
					dockerCapability = &observed
				}
			}
			capabilities.Docker = dockerCapability
		}
		if value.Tailscale {
			if tailscaleCapability == nil || now.Sub(lastTailscale) >= 30*time.Second {
				lastTailscale = now
				observed := tailscale.Collect(now)
				tailscaleCapability = &observed
			}
			capabilities.Tailscale = tailscaleCapability
		}
		if len(value.FileShares) > 0 {
			if shareCapability == nil || now.Sub(lastShares) >= 30*time.Second {
				lastShares = now
				observed := shares.Collect(context.Background(), *configPath, value.FileShares, now)
				shareCapability = &observed
			}
			capabilities.FileShares = shareCapability
		}
		snapshot := snapshots.Snapshot{SchemaVersion: snapshots.SchemaVersion, CollectorVersion: version, HostID: value.HostID, BootID: strings.TrimSpace(string(bootID)), Generation: generation, Sequence: sequence, GeneratedAt: now, Capabilities: capabilities}
		if err := snapshots.WriteAtomic(value.OutputDirectory, snapshot); err != nil {
			fail("unable to publish host snapshot")
		}
	}
	collect()
	if *once {
		return
	}
	ticker := time.NewTicker(time.Duration(value.IntervalSeconds) * time.Second)
	defer ticker.Stop()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(stop)
	for {
		select {
		case <-ticker.C:
			collect()
		case <-stop:
			return
		}
	}
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
