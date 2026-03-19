package usecase

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
	"time"

	"github.com/rendis/mock-loom/apps/api/internal/adapters/cloudstorage"
	"github.com/rendis/mock-loom/apps/api/internal/adapters/sqlite"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// BackupResult holds the outcome of a save operation.
type BackupResult struct {
	Bytes     int64         `json:"bytes"`
	ElapsedMs int64         `json:"elapsed_ms"`
}

// BackupService orchestrates database backup, restore, and config management.
type BackupService struct {
	dbRef      *sqlite.DBRef
	dbFilePath string
	migrDir    string
	configRepo ports.BackupConfigRepository

	mu      sync.Mutex
	storage ports.BucketStorage

	periodicMu sync.Mutex
	stopCh     chan struct{}
}

// NewBackupService creates a new backup service.
func NewBackupService(
	dbRef *sqlite.DBRef,
	dbFilePath string,
	migrDir string,
	storage ports.BucketStorage,
	configRepo ports.BackupConfigRepository,
) *BackupService {
	return &BackupService{
		dbRef:      dbRef,
		dbFilePath: dbFilePath,
		migrDir:    migrDir,
		storage:    storage,
		configRepo: configRepo,
	}
}

// SetStorage updates the current storage adapter.
func (s *BackupService) SetStorage(storage ports.BucketStorage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.storage = storage
}

// Save creates a consistent backup and uploads it to the configured bucket.
func (s *BackupService) Save(ctx context.Context) (*BackupResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.storage == nil {
		return nil, fmt.Errorf("backup storage not configured")
	}

	start := time.Now()

	tmpPath := s.dbFilePath + ".backup-tmp"
	defer os.Remove(tmpPath)

	if _, err := s.dbRef.Get().ExecContext(ctx, `VACUUM INTO ?`, tmpPath); err != nil {
		return nil, fmt.Errorf("vacuum into: %w", err)
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("open backup file: %w", err)
	}
	defer f.Close()

	written, err := s.storage.Upload(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("upload: %w", err)
	}

	return &BackupResult{
		Bytes:     written,
		ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}

// Restore downloads a backup from the bucket and hot-swaps the database.
func (s *BackupService) Restore(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.storage == nil {
		return fmt.Errorf("backup storage not configured")
	}

	reader, err := s.storage.Download(ctx)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer reader.Close()

	tmpPath := s.dbFilePath + ".restore-tmp"
	defer os.Remove(tmpPath)

	f, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	if _, err := io.Copy(f, reader); err != nil {
		f.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	f.Close()

	newDB, err := sqlite.Open(tmpPath + "?_pragma=foreign_keys(1)")
	if err != nil {
		return fmt.Errorf("open restored db: %w", err)
	}

	if err := sqlite.RunMigrations(newDB, s.migrDir); err != nil {
		newDB.Close()
		return fmt.Errorf("run migrations on restored db: %w", err)
	}

	if err := s.dbRef.Swap(newDB); err != nil {
		return fmt.Errorf("swap db: %w", err)
	}

	if err := os.Rename(tmpPath, s.dbFilePath); err != nil {
		return fmt.Errorf("move restored file: %w", err)
	}

	return nil
}

// Download creates a consistent copy of the database and returns a reader.
// The caller must close the returned ReadCloser.
func (s *BackupService) Download(ctx context.Context) (io.ReadCloser, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tmpPath := s.dbFilePath + ".download-tmp"

	if _, err := s.dbRef.Get().ExecContext(ctx, `VACUUM INTO ?`, tmpPath); err != nil {
		return nil, 0, fmt.Errorf("vacuum into: %w", err)
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		os.Remove(tmpPath)
		return nil, 0, fmt.Errorf("open download file: %w", err)
	}

	info, err := f.Stat()
	if err != nil {
		f.Close()
		os.Remove(tmpPath)
		return nil, 0, err
	}

	return &downloadReadCloser{file: f, path: tmpPath}, info.Size(), nil
}

// GetConfig returns the persisted backup config.
func (s *BackupService) GetConfig(ctx context.Context) (*entity.BackupConfig, error) {
	cfg, err := s.configRepo.Get(ctx)
	if errors.Is(err, ports.ErrNotFound) {
		return &entity.BackupConfig{
			ObjectKey: "mock-loom.db",
			S3Region:  "us-east-1",
		}, nil
	}
	return cfg, err
}

// UpdateConfig persists new backup config, rebuilds the storage adapter,
// and restarts the periodic ticker if the interval changed.
func (s *BackupService) UpdateConfig(ctx context.Context, cfg *entity.BackupConfig) error {
	cfg.UpdatedAt = time.Now().UTC()
	if err := s.configRepo.Upsert(ctx, cfg); err != nil {
		return err
	}

	if cfg.Provider != "" && cfg.Bucket != "" {
		newStorage, err := cloudstorage.New(cfg.Provider, cfg.Bucket, cfg.ObjectKey, cfg.S3Region)
		if err != nil {
			return fmt.Errorf("create storage adapter: %w", err)
		}
		s.SetStorage(newStorage)
	} else {
		s.SetStorage(nil)
	}

	s.StopPeriodicSave()
	if cfg.SyncInterval != "" && cfg.SyncInterval != "0" {
		if d, err := time.ParseDuration(cfg.SyncInterval); err == nil && d > 0 {
			s.StartPeriodicSave(context.Background(), d)
		}
	}

	return nil
}

// StartPeriodicSave launches a background goroutine that saves at the given interval.
func (s *BackupService) StartPeriodicSave(ctx context.Context, interval time.Duration) {
	s.periodicMu.Lock()
	defer s.periodicMu.Unlock()

	if s.stopCh != nil {
		return
	}

	s.stopCh = make(chan struct{})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		log.Printf("backup: periodic save started (interval=%s)", interval)
		for {
			select {
			case <-ticker.C:
				var result *BackupResult
				var err error
				for attempt := 0; attempt < 3; attempt++ {
					result, err = s.Save(ctx)
					if err == nil {
						break
					}
					if attempt < 2 {
						time.Sleep(2 * time.Second)
					}
				}
				if err != nil {
					log.Printf("backup: periodic save failed after retries: %v", err)
				} else {
					log.Printf("backup: periodic save complete (%d bytes, %dms)", result.Bytes, result.ElapsedMs)
				}
			case <-s.stopCh:
				log.Println("backup: periodic save stopped")
				return
			}
		}
	}()
}

// StopPeriodicSave stops the periodic save goroutine if running.
func (s *BackupService) StopPeriodicSave() {
	s.periodicMu.Lock()
	defer s.periodicMu.Unlock()

	if s.stopCh != nil {
		close(s.stopCh)
		s.stopCh = nil
	}
}

// SaveOnShutdown performs a final save before the server shuts down.
func (s *BackupService) SaveOnShutdown(ctx context.Context) {
	s.mu.Lock()
	hasStorage := s.storage != nil
	s.mu.Unlock()

	if !hasStorage {
		return
	}

	log.Println("backup: saving on shutdown...")
	result, err := s.Save(ctx)
	if err != nil {
		log.Printf("backup: shutdown save failed: %v", err)
		return
	}
	log.Printf("backup: shutdown save complete (%d bytes, %dms)", result.Bytes, result.ElapsedMs)
}

type downloadReadCloser struct {
	file *os.File
	path string
}

func (r *downloadReadCloser) Read(p []byte) (int, error) {
	return r.file.Read(p)
}

func (r *downloadReadCloser) Close() error {
	err := r.file.Close()
	os.Remove(r.path)
	return err
}
