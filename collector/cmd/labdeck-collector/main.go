package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
	"github.com/labdeck/labdeck/collector/internal/snapshots"
	"github.com/labdeck/labdeck/collector/internal/system"
)

const version = "0.1.0"

func main() {
	configPath := flag.String("config", "/etc/labdeck/collector.json", "path to root-owned collector configuration")
	once := flag.Bool("once", false, "write one snapshot and exit")
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
	bootID, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		fail("unable to read host boot identity")
	}
	generation, err := randomID()
	if err != nil {
		fail("unable to initialize collector")
	}
	sampler := system.NewSampler()
	var sequence uint64
	collect := func() {
		sequence++
		now := time.Now().UTC()
		snapshot := snapshots.Snapshot{SchemaVersion: snapshots.SchemaVersion, CollectorVersion: version, HostID: value.HostID, BootID: strings.TrimSpace(string(bootID)), Generation: generation, Sequence: sequence, GeneratedAt: now, Capabilities: sampler.Collect(value, now)}
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
