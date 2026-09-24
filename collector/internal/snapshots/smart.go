package snapshots

import "time"

type SmartSnapshot struct {
	SchemaVersion string      `json:"schemaVersion"`
	GeneratedAt   time.Time   `json:"generatedAt"`
	Disks         []SmartDisk `json:"disks"`
}

type SmartDisk struct {
	ID            string     `json:"id"`
	Label         string     `json:"label"`
	State         string     `json:"state"`
	ObservedAt    time.Time  `json:"observedAt"`
	Identity      string     `json:"identity"`
	SerialSuffix  string     `json:"serialSuffix"`
	Protocol      string     `json:"protocol"`
	Model         string     `json:"model"`
	CapacityBytes *uint64    `json:"capacityBytes"`
	TemperatureC  *float64   `json:"temperatureCelsius"`
	Health        string     `json:"health"`
	PowerOnHours  *uint64    `json:"powerOnHours"`
	ATA           *SmartATA  `json:"ata"`
	NVMe          *SmartNVMe `json:"nvme"`
	SCSI          *SmartSCSI `json:"scsi"`
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
