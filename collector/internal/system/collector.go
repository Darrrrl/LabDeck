package system

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/labdeck/labdeck/collector/internal/config"
	"github.com/labdeck/labdeck/collector/internal/snapshots"
)

const maxSafeInteger = uint64(9_007_199_254_740_991)

type Sampler struct {
	previousCPUAt     time.Time
	previousNetworkAt time.Time
	previousDiskAt    time.Time
	previousCPU       *CPUCounters
	previousNetwork   map[string]NetworkCounters
	previousDisk      map[string]DiskCounters
}

func NewSampler() *Sampler { return &Sampler{} }

func (s *Sampler) Collect(value config.Config, now time.Time) snapshots.Capabilities {
	capabilities := snapshots.Capabilities{}
	cpu, summary, err := collectSummary(s.previousCPU, now.Sub(s.previousCPUAt))
	if err != nil {
		capabilities.Summary = snapshots.Failure[snapshots.HostSummary](now, "read-failed")
	} else {
		capabilities.Summary = snapshots.Success(now, summary)
		s.previousCPU = &cpu
		s.previousCPUAt = now
	}
	filesystems, err := collectFilesystems(value.Filesystems)
	if err != nil {
		capabilities.Filesystems = snapshots.Failure[[]snapshots.Filesystem](now, "read-failed")
	} else {
		capabilities.Filesystems = snapshots.Success(now, filesystems)
	}
	networkCounters, interfaces, err := collectInterfaces(value.Interfaces, s.previousNetwork, now.Sub(s.previousNetworkAt))
	if err != nil {
		capabilities.Interfaces = snapshots.Failure[[]snapshots.NetworkInterface](now, "read-failed")
	} else {
		capabilities.Interfaces = snapshots.Success(now, interfaces)
		s.previousNetwork = networkCounters
		s.previousNetworkAt = now
	}
	diskCounters, blockIO, err := collectBlockIO(value.BlockDevices, s.previousDisk, now.Sub(s.previousDiskAt))
	if err != nil {
		capabilities.BlockIO = snapshots.Failure[[]snapshots.BlockDeviceIO](now, "read-failed")
	} else {
		capabilities.BlockIO = snapshots.Success(now, blockIO)
		s.previousDisk = diskCounters
		s.previousDiskAt = now
	}
	return capabilities
}

func collectSummary(previous *CPUCounters, elapsed time.Duration) (CPUCounters, snapshots.HostSummary, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	stat, err := read("/proc/stat")
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	cpu, err := ParseCPUStat(stat)
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	cpuInfo, err := read("/proc/cpuinfo")
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	model, processors, err := ParseCPUInfo(cpuInfo)
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	memSource, err := read("/proc/meminfo")
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	memory, err := ParseMeminfo(memSource)
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	uptimeSource, err := read("/proc/uptime")
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	uptimeFields := strings.Fields(uptimeSource)
	if len(uptimeFields) == 0 {
		return CPUCounters{}, snapshots.HostSummary{}, errors.New("invalid uptime")
	}
	uptime, err := strconv.ParseFloat(uptimeFields[0], 64)
	if err != nil || uptime < 0 {
		return CPUCounters{}, snapshots.HostSummary{}, errors.New("invalid uptime")
	}
	loadSource, err := read("/proc/loadavg")
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	load, err := ParseLoad(loadSource)
	if err != nil {
		return CPUCounters{}, snapshots.HostSummary{}, err
	}
	return cpu, snapshots.HostSummary{
		Hostname: hostname, UptimeSeconds: uptime,
		CPU:    snapshots.CPU{Model: model, LogicalProcessors: processors, UtilizationPercent: cpuUtilization(previous, cpu, elapsed)},
		Load:   snapshots.Load{One: load[0], Five: load[1], Fifteen: load[2]},
		Memory: snapshots.Memory{TotalBytes: memory.Total, UsedBytes: memory.Total - memory.Available, AvailableBytes: memory.Available},
		Swap:   snapshots.Swap{TotalBytes: memory.SwapTotal, UsedBytes: memory.SwapTotal - memory.SwapFree, FreeBytes: memory.SwapFree},
	}, nil
}

func cpuUtilization(previous *CPUCounters, current CPUCounters, elapsed time.Duration) *float64 {
	if previous == nil || elapsed <= 0 || current.Total <= previous.Total || current.Idle < previous.Idle {
		return nil
	}
	totalDelta, idleDelta := current.Total-previous.Total, current.Idle-previous.Idle
	if idleDelta > totalDelta {
		return nil
	}
	value := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
	return &value
}

func collectFilesystems(selected []config.Filesystem) ([]snapshots.Filesystem, error) {
	mountSource, err := read("/proc/self/mountinfo")
	if err != nil {
		return nil, err
	}
	mounts, err := ParseMountinfo(mountSource)
	if err != nil {
		return nil, err
	}
	result := make([]snapshots.Filesystem, 0, len(selected))
	identities := map[string]bool{}
	for _, item := range selected {
		mount, ok := mounts[item.Path]
		if !ok {
			return nil, fmt.Errorf("configured filesystem unavailable")
		}
		if identities[mount.Identity] {
			return nil, errors.New("duplicate filesystem identity")
		}
		identities[mount.Identity] = true
		var stat syscall.Statfs_t
		if err := syscall.Statfs(item.Path, &stat); err != nil {
			return nil, err
		}
		blockSize := uint64(stat.Bsize)
		total := stat.Blocks * blockSize
		free := stat.Bfree * blockSize
		available := stat.Bavail * blockSize
		if total > maxSafeInteger || free > total || available > free {
			return nil, errors.New("filesystem counters out of range")
		}
		used, reserved := total-free, free-available
		ratio := 0.0
		if total > 0 {
			ratio = float64(used) / float64(total)
		}
		result = append(result, snapshots.Filesystem{ID: item.ID, Path: item.Path, Source: mount.Source, FSType: mount.FSType, MountIdentity: mount.Identity, TotalBytes: total, FreeBytes: free, AvailableBytes: available, UsedBytes: used, ReservedBytes: reserved, UsedRatio: ratio})
	}
	return result, nil
}

func collectInterfaces(selected []config.Entity, previous map[string]NetworkCounters, elapsed time.Duration) (map[string]NetworkCounters, []snapshots.NetworkInterface, error) {
	source, err := read("/proc/net/dev")
	if err != nil {
		return nil, nil, err
	}
	counters, err := ParseNetwork(source)
	if err != nil {
		return nil, nil, err
	}
	result := make([]snapshots.NetworkInterface, 0, len(selected))
	for _, item := range selected {
		current, ok := counters[item.Name]
		if !ok {
			return nil, nil, errors.New("configured interface unavailable")
		}
		entry := snapshots.NetworkInterface{ID: item.ID, Name: item.Name}
		if prior, ok := previous[item.Name]; ok {
			entry.ReceiveBytesPerSecond = counterRate(prior.Receive, current.Receive, elapsed)
			entry.TransmitBytesPerSecond = counterRate(prior.Transmit, current.Transmit, elapsed)
		}
		result = append(result, entry)
	}
	return counters, result, nil
}

func collectBlockIO(selected []config.Entity, previous map[string]DiskCounters, elapsed time.Duration) (map[string]DiskCounters, []snapshots.BlockDeviceIO, error) {
	source, err := read("/proc/diskstats")
	if err != nil {
		return nil, nil, err
	}
	counters, err := ParseDiskstats(source)
	if err != nil {
		return nil, nil, err
	}
	result := make([]snapshots.BlockDeviceIO, 0, len(selected))
	for _, item := range selected {
		current, ok := counters[item.Name]
		if !ok {
			return nil, nil, errors.New("configured block device unavailable")
		}
		entry := snapshots.BlockDeviceIO{ID: item.ID, Name: item.Name}
		if prior, ok := previous[item.Name]; ok {
			entry.ReadBytesPerSecond = sectorRate(prior.ReadSectors, current.ReadSectors, elapsed)
			entry.WriteBytesPerSecond = sectorRate(prior.WriteSectors, current.WriteSectors, elapsed)
		}
		result = append(result, entry)
	}
	return counters, result, nil
}

func counterRate(previous, current uint64, elapsed time.Duration) *float64 {
	if elapsed <= 0 || current < previous {
		return nil
	}
	value := float64(current-previous) / elapsed.Seconds()
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return nil
	}
	return &value
}
func sectorRate(previous, current uint64, elapsed time.Duration) *float64 {
	rate := counterRate(previous, current, elapsed)
	if rate == nil {
		return nil
	}
	value := *rate * 512
	return &value
}
func read(path string) (string, error) {
	value, err := os.ReadFile(filepath.Clean(path))
	return string(value), err
}
