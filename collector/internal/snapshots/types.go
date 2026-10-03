package snapshots

import "time"

const SchemaVersion = "1"

type Snapshot struct {
	SchemaVersion    string       `json:"schemaVersion"`
	CollectorVersion string       `json:"collectorVersion"`
	HostID           string       `json:"hostId"`
	BootID           string       `json:"bootId"`
	Generation       string       `json:"generation"`
	Sequence         uint64       `json:"sequence"`
	GeneratedAt      time.Time    `json:"generatedAt"`
	Capabilities     Capabilities `json:"capabilities"`
}

type Capabilities struct {
	Summary     Capability[HostSummary]        `json:"summary"`
	Filesystems Capability[[]Filesystem]       `json:"filesystems"`
	Interfaces  Capability[[]NetworkInterface] `json:"interfaces"`
	BlockIO     Capability[[]BlockDeviceIO]    `json:"blockIo"`
	Docker      *Capability[DockerInventory]   `json:"docker,omitempty"`
	FileShares  *Capability[[]FileShare]       `json:"fileShares,omitempty"`
	Tailscale   *Capability[TailscaleStatus]   `json:"tailscale,omitempty"`
}

type Capability[T any] struct {
	Status       string    `json:"status"`
	ObservedAt   time.Time `json:"observedAt"`
	Completeness string    `json:"completeness"`
	Data         *T        `json:"data,omitempty"`
	ErrorCode    string    `json:"errorCode,omitempty"`
}

func Success[T any](at time.Time, data T) Capability[T] {
	return Capability[T]{Status: "ok", ObservedAt: at, Completeness: "complete", Data: &data}
}

func Failure[T any](at time.Time, code string) Capability[T] {
	return Capability[T]{Status: "error", ObservedAt: at, Completeness: "complete", ErrorCode: code}
}

type HostSummary struct {
	Hostname      string  `json:"hostname"`
	UptimeSeconds float64 `json:"uptimeSeconds"`
	CPU           CPU     `json:"cpu"`
	Load          Load    `json:"load"`
	Memory        Memory  `json:"memory"`
	Swap          Swap    `json:"swap"`
}

type CPU struct {
	Model              string   `json:"model"`
	LogicalProcessors  int      `json:"logicalProcessors"`
	UtilizationPercent *float64 `json:"utilizationPercent"`
}

type Load struct {
	One     float64 `json:"one"`
	Five    float64 `json:"five"`
	Fifteen float64 `json:"fifteen"`
}

type Memory struct {
	TotalBytes     uint64 `json:"totalBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}
type Swap struct {
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
	FreeBytes  uint64 `json:"freeBytes"`
}
type Filesystem struct {
	ID             string  `json:"id"`
	Path           string  `json:"path"`
	Source         string  `json:"source"`
	FSType         string  `json:"fsType"`
	MountIdentity  string  `json:"mountIdentity"`
	TotalBytes     uint64  `json:"totalBytes"`
	FreeBytes      uint64  `json:"freeBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	ReservedBytes  uint64  `json:"reservedBytes"`
	UsedRatio      float64 `json:"usedRatio"`
}
type FileShare struct {
	ID             string    `json:"id"`
	Path           string    `json:"path"`
	Kind           string    `json:"kind"`
	State          string    `json:"state"`
	ObservedAt     time.Time `json:"observedAt"`
	TotalBytes     *uint64   `json:"totalBytes"`
	AvailableBytes *uint64   `json:"availableBytes"`
}
type NetworkInterface struct {
	ID                     string   `json:"id"`
	Name                   string   `json:"name"`
	ReceiveBytesPerSecond  *float64 `json:"receiveBytesPerSecond"`
	TransmitBytesPerSecond *float64 `json:"transmitBytesPerSecond"`
}
type BlockDeviceIO struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	ReadBytesPerSecond  *float64 `json:"readBytesPerSecond"`
	WriteBytesPerSecond *float64 `json:"writeBytesPerSecond"`
}
type DockerInventory struct {
	APIVersion        string            `json:"apiVersion"`
	InventoryComplete bool              `json:"inventoryComplete"`
	Containers        []DockerContainer `json:"containers"`
}
type DockerContainer struct {
	ComposeProject   *string    `json:"composeProject,omitempty"`
	ComposeService   *string    `json:"composeService,omitempty"`
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Image            string     `json:"image"`
	CreatedAt        *time.Time `json:"createdAt"`
	StartedAt        *time.Time `json:"startedAt"`
	State            string     `json:"state"`
	Health           string     `json:"health"`
	RestartCount     *uint64    `json:"restartCount"`
	CPUPercent       *float64   `json:"cpuPercent"`
	MemoryBytes      *uint64    `json:"memoryBytes"`
	MemoryLimitBytes *uint64    `json:"memoryLimitBytes"`
	MemoryKind       string     `json:"memoryKind"`
	StatsObservedAt  *time.Time `json:"statsObservedAt"`
}

type TailscaleStatus struct {
	Version           string          `json:"version"`
	BackendState      string          `json:"backendState"`
	SelfName          string          `json:"selfName"`
	SelfIPs           []string        `json:"selfIPs"`
	InventoryComplete bool            `json:"inventoryComplete"`
	Peers             []TailscalePeer `json:"peers"`
}
type TailscalePeer struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	IPs      []string   `json:"ips"`
	Online   bool       `json:"online"`
	LastSeen *time.Time `json:"lastSeen"`
}
