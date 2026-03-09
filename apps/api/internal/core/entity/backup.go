package entity

import "time"

// BackupConfig holds cloud backup configuration.
type BackupConfig struct {
	Provider       string    `json:"provider"`
	Bucket         string    `json:"bucket"`
	ObjectKey      string    `json:"object_key"`
	S3Region       string    `json:"s3_region"`
	SyncInterval   string    `json:"sync_interval"`
	RestoreOnStart bool      `json:"restore_on_start"`
	UpdatedAt      time.Time `json:"updated_at"`
}
