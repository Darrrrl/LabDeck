package docker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (fn roundTrip) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func fake(t *testing.T, handler func(*http.Request) (int, string)) (*Collector, *[]string) {
	t.Helper()
	paths := []string{}
	var pathsMu sync.Mutex
	client := &http.Client{Transport: roundTrip(func(request *http.Request) (*http.Response, error) {
		pathsMu.Lock()
		paths = append(paths, request.URL.RequestURI())
		pathsMu.Unlock()
		if request.Method != http.MethodGet {
			t.Errorf("unexpected method %s", request.Method)
		}
		status, body := handler(request)
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: ioNopCloser(body), ContentLength: int64(len(body)), Request: request}, nil
	})}
	return NewWithClient(client), &paths
}

type stringCloser struct{ *strings.Reader }

func (value stringCloser) Close() error     { return nil }
func ioNopCloser(value string) stringCloser { return stringCloser{strings.NewReader(value)} }

func TestProjectionAndAllowedPaths(t *testing.T) {
	id := strings.Repeat("a", 64)
	c, paths := fake(t, func(request *http.Request) (int, string) {
		switch request.URL.Path {
		case "/version":
			return 200, `{"ApiVersion":"1.50","MinAPIVersion":"1.40"}`
		case "/v1.45/containers/json":
			return 200, fmt.Sprintf(`[{"Id":"%s","Names":["/media"],"Image":"example:1","State":"running","Created":1700000000,"Labels":{"secret":"CANARY_SECRET","com.docker.compose.project":"media-stack","com.docker.compose.service":"jellyfin"}}]`, id)
		case "/v1.45/containers/" + id + "/json":
			return 200, `{"RestartCount":2,"State":{"Status":"running","StartedAt":"2026-09-24T10:00:00Z","Health":{"Status":"healthy","Log":[{"Output":"CANARY_SECRET"}]}},"Config":{"Env":["PASSWORD=CANARY_SECRET"]}}`
		case "/v1.45/containers/" + id + "/stats":
			return 200, `{"cpu_stats":{"cpu_usage":{"total_usage":200},"system_cpu_usage":1000,"online_cpus":4},"precpu_stats":{"cpu_usage":{"total_usage":100},"system_cpu_usage":500},"memory_stats":{"usage":1000,"limit":2000,"stats":{"inactive_file":200}}}`
		default:
			t.Errorf("unexpected path %s", request.URL.Path)
			return 404, `{}`
		}
	})
	result, err := c.Collect(time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "ok" || result.Data == nil || len(result.Data.Containers) != 1 {
		t.Fatalf("bad inventory: %#v", result)
	}
	item := result.Data.Containers[0]
	if item.CPUPercent == nil || *item.CPUPercent != 80 || item.MemoryBytes == nil || *item.MemoryBytes != 800 || item.MemoryKind != "working-set" {
		t.Fatalf("bad stats: %#v", item)
	}
	if item.ComposeProject == nil || *item.ComposeProject != "media-stack" || item.ComposeService == nil || *item.ComposeService != "jellyfin" {
		t.Fatal("Compose labels missing")
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "CANARY_SECRET") {
		t.Fatal("secret escaped projection")
	}
	if len(*paths) != 4 || (*paths)[1] != "/v1.45/containers/json?all=1" || (*paths)[3] != "/v1.45/containers/"+id+"/stats?stream=false" {
		t.Fatalf("unexpected routes: %v", *paths)
	}
}

func TestFiftyContainersBoundConcurrency(t *testing.T) {
	active, maximum := 0, 0
	var mu sync.Mutex
	c, _ := fake(t, func(request *http.Request) (int, string) {
		if request.URL.Path == "/version" {
			return 200, `{"ApiVersion":"1.40"}`
		}
		if request.URL.Path == "/v1.40/containers/json" {
			var entries []map[string]any
			for index := 0; index < 50; index++ {
				entries = append(entries, map[string]any{"Id": fmt.Sprintf("%064x", index), "Names": []string{fmt.Sprintf("/container-%d", index)}, "Image": "example", "State": "exited"})
			}
			encoded, _ := json.Marshal(entries)
			return 200, string(encoded)
		}
		mu.Lock()
		active++
		if active > maximum {
			maximum = active
		}
		mu.Unlock()
		time.Sleep(time.Millisecond)
		mu.Lock()
		active--
		mu.Unlock()
		return 200, `{"RestartCount":0,"State":{"Status":"exited"}}`
	})
	result, err := c.Collect(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Data.Containers) != 50 || maximum > 2 {
		t.Fatalf("count=%d concurrency=%d", len(result.Data.Containers), maximum)
	}
}

func TestUnsupportedAndMissingStats(t *testing.T) {
	if _, err := negotiate(version{APIVersion: "1.39"}); err == nil {
		t.Fatal("accepted unsupported API")
	}
	if _, err := negotiate(version{APIVersion: "1.50", MinAPIVersion: "1.46"}); err == nil {
		t.Fatal("accepted too-new minimum")
	}
	if cpuPercent(stats{}) != nil {
		t.Fatal("first sample must be unknown")
	}
}

func TestComposeLabelValidation(t *testing.T) {
	for _, value := range []string{"", "invalid space", "../path", strings.Repeat("a", 129)} {
		if composeName(value) != nil {
			t.Errorf("accepted invalid label %q", value)
		}
	}
	if composeName("web-1.frontend") == nil {
		t.Fatal("rejected safe Compose name")
	}
}
