package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/labdeck/labdeck/collector/internal/snapshots"
)

const socketPath = "/var/run/docker.sock"
const maxBody = 2 << 20
const maxContainers = 100

var safeID = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Collector struct {
	client   *http.Client
	previous map[string]snapshots.DockerContainer
}

func New() *Collector {
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "unix", socketPath)
	}}
	return &Collector{client: &http.Client{Transport: transport, Timeout: 5 * time.Second}, previous: map[string]snapshots.DockerContainer{}}
}

// NewWithClient is used by fake Engine tests; production always uses the fixed local socket.
func NewWithClient(client *http.Client) *Collector {
	return &Collector{client: client, previous: map[string]snapshots.DockerContainer{}}
}

type version struct {
	APIVersion    string `json:"ApiVersion"`
	MinAPIVersion string `json:"MinAPIVersion"`
}
type listing struct {
	ID      string   `json:"Id"`
	Names   []string `json:"Names"`
	Image   string   `json:"Image"`
	State   string   `json:"State"`
	Created int64    `json:"Created"`
}
type inspect struct {
	RestartCount uint64 `json:"RestartCount"`
	State        struct {
		Status    string `json:"Status"`
		StartedAt string `json:"StartedAt"`
		Health    *struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
}
type stats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint64 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats *struct {
		Usage uint64            `json:"usage"`
		Limit uint64            `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
}

func (c *Collector) Collect(now time.Time) (snapshots.Capability[snapshots.DockerInventory], error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var v version
	if err := c.get(ctx, "/version", &v); err != nil {
		return snapshots.Capability[snapshots.DockerInventory]{}, err
	}
	api, err := negotiate(v)
	if err != nil {
		return snapshots.Capability[snapshots.DockerInventory]{}, err
	}
	var raw []listing
	if err := c.get(ctx, "/v"+api+"/containers/json?all=1", &raw); err != nil {
		return snapshots.Capability[snapshots.DockerInventory]{}, err
	}
	complete := len(raw) <= maxContainers
	selected := make([]listing, 0, min(len(raw), maxContainers))
	seen := map[string]bool{}
	for _, candidate := range raw {
		if !safeID.MatchString(candidate.ID) || seen[candidate.ID] {
			complete = false
			continue
		}
		if len(selected) >= maxContainers {
			complete = false
			break
		}
		selected = append(selected, candidate)
		seen[candidate.ID] = true
	}
	raw = selected
	items := make([]snapshots.DockerContainer, len(raw))
	jobs := make(chan int)
	var wg sync.WaitGroup
	partial := !complete
	var mu sync.Mutex
	for worker := 0; worker < 2; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				item, ok := c.project(ctx, api, raw[index], now)
				items[index] = item
				if !ok {
					mu.Lock()
					partial = true
					mu.Unlock()
				}
			}
		}()
	}
	for index := range raw {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	data := snapshots.DockerInventory{APIVersion: api, InventoryComplete: complete, Containers: items}
	capability := snapshots.Success(now, data)
	if partial {
		capability.Completeness = "partial"
	}
	if complete {
		next := make(map[string]snapshots.DockerContainer, len(items))
		for _, item := range items {
			next[item.ID] = item
		}
		c.previous = next
	} else {
		for _, item := range items {
			c.previous[item.ID] = item
		}
	}
	return capability, nil
}

func (c *Collector) project(ctx context.Context, api string, raw listing, now time.Time) (snapshots.DockerContainer, bool) {
	item := snapshots.DockerContainer{ID: raw.ID, Name: safeName(raw.Names, raw.ID), Image: safeText(raw.Image, 160), CreatedAt: fromUnix(raw.Created), State: state(raw.State), Health: "no-healthcheck", MemoryKind: "unknown"}
	prior, hasPrior := c.previous[raw.ID]
	var detail inspect
	if err := c.get(ctx, "/v"+api+"/containers/"+raw.ID+"/json", &detail); err != nil {
		item.Health = "unknown"
		if hasPrior {
			item.RestartCount = prior.RestartCount
			item.StartedAt = prior.StartedAt
		}
		return item, false
	}
	item.RestartCount = &detail.RestartCount
	item.StartedAt = parseTime(detail.State.StartedAt)
	if detail.State.Health != nil {
		item.Health = health(detail.State.Health.Status)
	}
	if item.State != "running" {
		return item, true
	}
	var sample stats
	if err := c.get(ctx, "/v"+api+"/containers/"+raw.ID+"/stats?stream=false", &sample); err != nil {
		if hasPrior && prior.State == "running" {
			retainStats(&item, prior)
		}
		return item, false
	}
	if sample.MemoryStats == nil {
		if hasPrior && prior.State == "running" {
			retainStats(&item, prior)
		}
		return item, false
	}
	item.StatsObservedAt = &now
	item.CPUPercent = cpuPercent(sample)
	if sample.MemoryStats.Limit > 0 {
		item.MemoryLimitBytes = &sample.MemoryStats.Limit
	}
	usage := sample.MemoryStats.Usage
	item.MemoryKind = "raw"
	if cache, ok := sample.MemoryStats.Stats["inactive_file"]; ok && cache <= usage {
		usage -= cache
		item.MemoryKind = "working-set"
	} else if cache, ok := sample.MemoryStats.Stats["total_inactive_file"]; ok && cache <= usage {
		usage -= cache
		item.MemoryKind = "working-set"
	}
	item.MemoryBytes = &usage
	return item, true
}

func retainStats(item *snapshots.DockerContainer, prior snapshots.DockerContainer) {
	item.CPUPercent = prior.CPUPercent
	item.MemoryBytes = prior.MemoryBytes
	item.MemoryLimitBytes = prior.MemoryLimitBytes
	item.MemoryKind = prior.MemoryKind
	item.StatsObservedAt = prior.StatsObservedAt
}

func (c *Collector) get(ctx context.Context, path string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("docker read failed")
	}
	if resp.ContentLength > maxBody {
		return errors.New("docker body too large")
	}
	bytes, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil || len(bytes) > maxBody {
		return errors.New("docker body too large")
	}
	if err := json.Unmarshal(bytes, target); err != nil {
		return errors.New("docker invalid response")
	}
	return nil
}

func negotiate(v version) (string, error) {
	parse := func(value string) (int, int, error) {
		parts := strings.Split(value, ".")
		if len(parts) != 2 {
			return 0, 0, errors.New("invalid Docker API version")
		}
		major, e1 := strconv.Atoi(parts[0])
		minor, e2 := strconv.Atoi(parts[1])
		if e1 != nil || e2 != nil || major != 1 || minor < 0 {
			return 0, 0, errors.New("invalid Docker API version")
		}
		return major, minor, nil
	}
	_, maximum, err := parse(v.APIVersion)
	if err != nil {
		return "", err
	}
	minimum := 0
	if v.MinAPIVersion != "" {
		_, minimum, err = parse(v.MinAPIVersion)
		if err != nil {
			return "", err
		}
	}
	if maximum < 40 || minimum > 45 {
		return "", errors.New("unsupported Docker API version")
	}
	if maximum > 45 {
		maximum = 45
	}
	return fmt.Sprintf("1.%d", maximum), nil
}

func safeText(value string, max int) string {
	if len(value) > max {
		return value[:max]
	}
	return value
}
func safeName(names []string, id string) string {
	if len(names) > 0 {
		return safeText(strings.TrimPrefix(names[0], "/"), 128)
	}
	if len(id) >= 12 {
		return id[:12]
	}
	return "unknown"
}
func fromUnix(value int64) *time.Time {
	if value <= 0 {
		return nil
	}
	at := time.Unix(value, 0).UTC()
	return &at
}
func parseTime(value string) *time.Time {
	at, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || at.Year() <= 1 {
		return nil
	}
	at = at.UTC()
	return &at
}
func state(value string) string {
	switch value {
	case "created", "running", "paused", "restarting", "exited", "dead":
		return value
	default:
		return "unknown"
	}
}
func health(value string) string {
	switch value {
	case "healthy", "unhealthy", "starting":
		return value
	default:
		return "unknown"
	}
}
func cpuPercent(value stats) *float64 {
	current, prior := value.CPUStats.CPUUsage.TotalUsage, value.PreCPUStats.CPUUsage.TotalUsage
	system, oldSystem := value.CPUStats.SystemCPUUsage, value.PreCPUStats.SystemCPUUsage
	if current <= prior || system <= oldSystem || value.CPUStats.OnlineCPUs == 0 {
		return nil
	}
	percent := float64(current-prior) / float64(system-oldSystem) * float64(value.CPUStats.OnlineCPUs) * 100
	if percent < 0 || percent > 100000 {
		return nil
	}
	return &percent
}
