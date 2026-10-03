package shares

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
	"github.com/labdeck/labdeck/collector/internal/snapshots"
	"github.com/labdeck/labdeck/collector/internal/system"
)

// Probe runs in a disposable child process: a remote Statfs can block in the
// kernel, so it must never stall the ordinary collector indefinitely.
func Probe(selected config.Filesystem, now time.Time) snapshots.FileShare {
	result := snapshots.FileShare{ID: selected.ID, Path: selected.Path, Kind: "unknown", State: "offline", ObservedAt: now}
	contents, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		result.State = "read-failed"
		return result
	}
	mounts, err := system.ParseMountinfo(string(contents))
	if err != nil {
		result.State = "read-failed"
		return result
	}
	mount, ok := mounts[selected.Path]
	if !ok {
		return result
	}
	if mount.FSType != "nfs" && mount.FSType != "nfs4" && mount.FSType != "cifs" && mount.FSType != "smb3" {
		result.State = "unsupported"
		return result
	}
	result.Kind = mount.FSType
	var stat syscall.Statfs_t
	if err := syscall.Statfs(selected.Path, &stat); err != nil {
		result.State = "read-failed"
		return result
	}
	if stat.Bsize <= 0 || stat.Blocks > ^uint64(0)/uint64(stat.Bsize) || stat.Bavail > ^uint64(0)/uint64(stat.Bsize) {
		result.State = "read-failed"
		return result
	}
	total := stat.Blocks * uint64(stat.Bsize)
	available := stat.Bavail * uint64(stat.Bsize)
	if total > 9_007_199_254_740_991 || available > total {
		result.State = "read-failed"
		return result
	}
	result.State, result.TotalBytes, result.AvailableBytes = "ok", &total, &available
	return result
}

func Collect(ctx context.Context, configPath string, selected []config.Filesystem, now time.Time) snapshots.Capability[[]snapshots.FileShare] {
	executable, err := os.Executable()
	if err != nil {
		return snapshots.Failure[[]snapshots.FileShare](now, "read-failed")
	}
	items := make([]snapshots.FileShare, len(selected))
	var group sync.WaitGroup
	for index, item := range selected {
		group.Add(1)
		go func(index int, item config.Filesystem) {
			defer group.Done()
			entry := snapshots.FileShare{ID: item.ID, Path: item.Path, Kind: "unknown", State: "timeout", ObservedAt: now}
			probeContext, cancel := context.WithTimeout(ctx, 5*time.Second)
			command := exec.CommandContext(probeContext, executable, "-config", configPath, "-share-probe-id", item.ID)
			command.WaitDelay = time.Second
			output, runError := command.Output()
			if probeContext.Err() == nil && runError == nil && len(output) < 4096 {
				var observed snapshots.FileShare
				if json.Unmarshal(output, &observed) == nil && observed.ID == item.ID && observed.Path == item.Path {
					entry = observed
				}
			} else if probeContext.Err() == nil {
				entry.State = "read-failed"
			}
			cancel()
			items[index] = entry
		}(index, item)
	}
	group.Wait()
	return snapshots.Success(now, items)
}
