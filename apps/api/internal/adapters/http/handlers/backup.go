package handlers

import (
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// BackupHandler exposes backup management endpoints.
type BackupHandler struct {
	service *usecase.BackupService
}

// NewBackupHandler returns BackupHandler.
func NewBackupHandler(service *usecase.BackupService) *BackupHandler {
	return &BackupHandler{service: service}
}

// TriggerBackup handles POST /admin/backup.
func (h *BackupHandler) TriggerBackup(c *fiber.Ctx) error {
	result, err := h.service.Save(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("backup failed: %v", err),
		})
	}
	return c.JSON(fiber.Map{
		"status":     "ok",
		"bytes":      result.Bytes,
		"elapsed_ms": result.ElapsedMs,
	})
}

// TriggerRestore handles POST /admin/backup/restore.
func (h *BackupHandler) TriggerRestore(c *fiber.Ctx) error {
	if err := h.service.Restore(c.Context()); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("restore failed: %v", err),
		})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// DownloadDB handles GET /admin/backup/download.
func (h *BackupHandler) DownloadDB(c *fiber.Ctx) error {
	reader, size, err := h.service.Download(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("download failed: %v", err),
		})
	}
	defer reader.Close()

	c.Set("Content-Type", "application/x-sqlite3")
	c.Set("Content-Disposition", "attachment; filename=\"mock-loom.db\"")
	c.Set("Content-Length", fmt.Sprintf("%d", size))
	return c.SendStream(reader, int(size))
}

// GetConfig handles GET /admin/backup/config.
func (h *BackupHandler) GetConfig(c *fiber.Ctx) error {
	cfg, err := h.service.GetConfig(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("get config failed: %v", err),
		})
	}
	return c.JSON(cfg)
}

// UpdateConfig handles PUT /admin/backup/config.
func (h *BackupHandler) UpdateConfig(c *fiber.Ctx) error {
	var body entity.BackupConfig
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	body.Provider = strings.TrimSpace(body.Provider)
	body.Bucket = strings.TrimSpace(body.Bucket)
	body.ObjectKey = strings.TrimSpace(body.ObjectKey)
	body.S3Region = strings.TrimSpace(body.S3Region)
	body.SyncInterval = strings.TrimSpace(body.SyncInterval)

	if body.Provider != "" && body.Provider != "gcs" && body.Provider != "s3" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "provider must be 'gcs' or 's3'",
		})
	}
	if body.Provider != "" && body.Bucket == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "bucket is required when provider is set",
		})
	}
	if body.ObjectKey == "" {
		body.ObjectKey = "mock-loom.db"
	}
	if body.S3Region == "" {
		body.S3Region = "us-east-1"
	}

	if err := h.service.UpdateConfig(c.Context(), &body); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("update config failed: %v", err),
		})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}
