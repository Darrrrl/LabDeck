package system

import (
	"bufio"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type CPUCounters struct{ Total, Idle uint64 }
type MemoryCounters struct{ Total, Available, SwapTotal, SwapFree uint64 }
type NetworkCounters struct{ Receive, Transmit uint64 }
type DiskCounters struct{ ReadSectors, WriteSectors uint64 }
type Mount struct{ MountPoint, Identity, Source, FSType string }

func ParseCPUStat(source string) (CPUCounters, error) {
	line, _, _ := strings.Cut(source, "\n")
	fields := strings.Fields(line)
	if len(fields) < 9 || fields[0] != "cpu" {
		return CPUCounters{}, errors.New("invalid cpu stat")
	}
	values := make([]uint64, len(fields)-1)
	for i, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return CPUCounters{}, errors.New("invalid cpu counter")
		}
		values[i] = value
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	return CPUCounters{Total: total, Idle: values[3] + values[4]}, nil
}

func ParseMeminfo(source string) (MemoryCounters, error) {
	values := map[string]uint64{}
	scanner := bufio.NewScanner(strings.NewReader(source))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		if key != "MemTotal" && key != "MemAvailable" && key != "SwapTotal" && key != "SwapFree" {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || value > ^uint64(0)/1024 {
			return MemoryCounters{}, errors.New("invalid memory counter")
		}
		values[key] = value * 1024
	}
	if values["MemTotal"] == 0 || values["MemAvailable"] > values["MemTotal"] || values["SwapFree"] > values["SwapTotal"] {
		return MemoryCounters{}, errors.New("incomplete memory counters")
	}
	return MemoryCounters{Total: values["MemTotal"], Available: values["MemAvailable"], SwapTotal: values["SwapTotal"], SwapFree: values["SwapFree"]}, nil
}

func ParseNetwork(source string) (map[string]NetworkCounters, error) {
	result := map[string]NetworkCounters{}
	scanner := bufio.NewScanner(strings.NewReader(source))
	for scanner.Scan() {
		line := scanner.Text()
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		name := strings.TrimSpace(line[:colon])
		fields := strings.Fields(line[colon+1:])
		if len(fields) < 16 {
			return nil, errors.New("invalid network counters")
		}
		rx, err1 := strconv.ParseUint(fields[0], 10, 64)
		tx, err2 := strconv.ParseUint(fields[8], 10, 64)
		if err1 != nil || err2 != nil {
			return nil, errors.New("invalid network counters")
		}
		result[name] = NetworkCounters{Receive: rx, Transmit: tx}
	}
	return result, scanner.Err()
}

func ParseDiskstats(source string) (map[string]DiskCounters, error) {
	result := map[string]DiskCounters{}
	scanner := bufio.NewScanner(strings.NewReader(source))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 14 {
			continue
		}
		read, err1 := strconv.ParseUint(fields[5], 10, 64)
		write, err2 := strconv.ParseUint(fields[9], 10, 64)
		if err1 != nil || err2 != nil {
			return nil, errors.New("invalid disk counters")
		}
		result[fields[2]] = DiskCounters{ReadSectors: read, WriteSectors: write}
	}
	return result, scanner.Err()
}

func ParseLoad(source string) ([3]float64, error) {
	fields := strings.Fields(source)
	var result [3]float64
	if len(fields) < 3 {
		return result, errors.New("invalid load average")
	}
	for i := range 3 {
		value, err := strconv.ParseFloat(fields[i], 64)
		if err != nil {
			return result, errors.New("invalid load average")
		}
		result[i] = value
	}
	return result, nil
}

func ParseCPUInfo(source string) (string, int, error) {
	model := ""
	processors := 0
	for _, line := range strings.Split(source, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name", "Hardware", "Processor":
			if model == "" {
				model = strings.TrimSpace(value)
			}
		case "processor":
			processors++
		}
	}
	if model == "" || processors == 0 {
		return "", 0, errors.New("incomplete cpu info")
	}
	return model, processors, nil
}

func ParseMountinfo(source string) (map[string]Mount, error) {
	result := map[string]Mount{}
	scanner := bufio.NewScanner(strings.NewReader(source))
	for scanner.Scan() {
		parts := strings.SplitN(scanner.Text(), " - ", 2)
		if len(parts) != 2 {
			return nil, errors.New("invalid mountinfo")
		}
		left, right := strings.Fields(parts[0]), strings.Fields(parts[1])
		if len(left) < 6 || len(right) < 2 {
			return nil, errors.New("invalid mountinfo")
		}
		mountPoint := unescapeMount(left[4])
		root := unescapeMount(left[3])
		result[mountPoint] = Mount{MountPoint: mountPoint, Identity: fmt.Sprintf("%s|%s", left[2], root), FSType: right[0], Source: unescapeMount(right[1])}
	}
	return result, scanner.Err()
}

func unescapeMount(value string) string {
	replacer := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	return replacer.Replace(value)
}
