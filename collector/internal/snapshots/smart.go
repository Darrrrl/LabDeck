package snapshots

import "time"

type SmartSnapshot struct {
	SchemaVersion string      `json:"schemaVersion"`
	GeneratedAt   time.Time   `json:"generatedAt"`
	Disks         []SmartDisk `json:"disks"`
}

type SmartSelfTest struct {
	State            string            `json:"state"`
	RemainingPercent *uint64           `json:"remainingPercent"`
	ShortMinutes     *uint64           `json:"shortMinutes"`
	ExtendedMinutes  *uint64           `json:"extendedMinutes"`
	History          []SmartTestResult `json:"history"`
}
type SmartTestResult struct {
	Type          string  `json:"type"`
	Result        string  `json:"result"`
	LifetimeHours *uint64 `json:"lifetimeHours"`
}
type SmartDisk struct {
	SelfTest      *SmartSelfTest `json:"selfTest"`
	ID            string         `json:"id"`
	Label         string         `json:"label"`
	State         string         `json:"state"`
	ObservedAt    time.Time      `json:"observedAt"`
	Identity      string         `json:"identity"`
	SerialSuffix  string         `json:"serialSuffix"`
	Protocol      string         `json:"protocol"`
	Model         string         `json:"model"`
	CapacityBytes *uint64        `json:"capacityBytes"`
	TemperatureC  *float64       `json:"temperatureCelsius"`
	Health        string         `json:"health"`
	PowerOnHours  *uint64        `json:"powerOnHours"`
	ATA           *SmartATA      `json:"ata"`
	NVMe          *SmartNVMe     `json:"nvme"`
	SCSI          *SmartSCSI     `json:"scsi"`
}
type SmartATA struct {
	Reallocated   string `json:"reallocated"`
	Pending       string `json:"pending"`
	Uncorrectable string `json:"uncorrectable"`
}
type SmartNVMe struct {
	CriticalWarning *uint64 `json:"criticalWarning"`
	AvailableSpare  *uint64 `json:"availableSparePercent"`
	PercentageUsed  *uint64 `json:"percentageUsed"`
	MediaErrors     string  `json:"mediaErrors"`
	ErrorLogEntries string  `json:"errorLogEntries"`
}
type SmartSCSI struct {
	GrownDefects    string `json:"grownDefects"`
	ReadUncorrected string `json:"readUncorrected"`
}
