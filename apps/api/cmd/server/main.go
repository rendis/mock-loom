package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	httpserver "github.com/rendis/mock-loom/apps/api/internal/adapters/http"
	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/middleware"
	"github.com/rendis/mock-loom/apps/api/internal/adapters/sqlite"
	"github.com/rendis/mock-loom/apps/api/internal/config"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"

	"github.com/rendis/mock-loom/apps/api/internal/adapters/cloudstorage"
)

func main() {
	cfg := config.Load()

	ctx := context.Background()
	if err := cfg.Auth.DiscoverOIDC(ctx); err != nil {
		log.Fatalf("oidc discovery failed: %v", err)
	}
	cfg.ValidateAuth()
	if err := cfg.ValidateImportTools(); err != nil {
		log.Fatalf("import tool validation failed: %v", err)
	}

	dbPath := config.DBFilePathFromDSN(cfg.Database.DSN)

	// Pre-open restore from bucket if enabled.
	var envStorage ports.BucketStorage
	if cfg.Backup.Enabled && cfg.Backup.Provider != "" && cfg.Backup.Bucket != "" {
		var err error
		envStorage, err = cloudstorage.New(cfg.Backup.Provider, cfg.Backup.Bucket, cfg.Backup.ObjectKey, cfg.Backup.S3Region)
		if err != nil {
			log.Fatalf("create backup storage: %v", err)
		}

		if shouldRestore(cfg.Backup, dbPath) {
			restoreFromBucket(ctx, envStorage, dbPath)
		}
	}

	db, err := sqlite.Open(cfg.Database.DSN)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}

	dbRef := sqlite.NewDBRef(db)

	if err := sqlite.RunMigrations(dbRef.Get(), cfg.Database.MigrationsDir); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	txManager := sqlite.NewTxManager(dbRef)
	userRepo := sqlite.NewUserRepository(dbRef)
	systemRoleRepo := sqlite.NewSystemRoleRepository(dbRef)
	workspaceRepo := sqlite.NewWorkspaceRepository(dbRef)
	memberRepo := sqlite.NewWorkspaceMemberRepository(dbRef)
	integrationRepo := sqlite.NewIntegrationRepository(dbRef)
	endpointRepo := sqlite.NewEndpointRepository(dbRef)
	dataSourceRepo := sqlite.NewDataSourceRepository(dbRef)

	authService := usecase.NewAuthService(cfg, txManager, userRepo, systemRoleRepo, memberRepo)
	authzService := usecase.NewAuthorizationService(workspaceRepo, memberRepo, integrationRepo)
	workspaceService := usecase.NewWorkspaceService(workspaceRepo, memberRepo)
	memberService := usecase.NewMemberService(userRepo, memberRepo)
	integrationService := usecase.NewIntegrationService(txManager, integrationRepo, endpointRepo, dataSourceRepo, cfg.Import)
	authMockService := usecase.NewAuthMockService(integrationRepo)
	dataSourceService := usecase.NewDataSourceService(txManager, integrationRepo, dataSourceRepo, cfg.DataSources)
	dataDebuggerService := usecase.NewDataDebuggerService(txManager, integrationRepo, dataSourceRepo)
	runtimeGatewayService := usecase.NewRuntimeGatewayService(txManager, integrationRepo, endpointRepo, dataSourceRepo, authMockService)

	authMiddleware, err := middleware.NewAuthMiddleware(cfg)
	if err != nil {
		log.Fatalf("init auth middleware: %v", err)
	}

	deps := httpserver.Dependencies{
		AuthMiddleware:     authMiddleware,
		AuthService:        authService,
		AuthzService:       authzService,
		AuthMockService:    authMockService,
		WorkspaceService:   workspaceService,
		MemberService:      memberService,
		IntegrationService: integrationService,
		DataSourceService:  dataSourceService,
		DataDebugger:       dataDebuggerService,
		RuntimeGateway:     runtimeGatewayService,
		ImportMaxBytes:     cfg.Import.MaxBytes,
		DataSourceMaxBytes: cfg.DataSources.BaselineMaxBytes,
	}

	// Setup backup service if enabled.
	var backupService *usecase.BackupService
	if cfg.Backup.Enabled {
		backupConfigRepo := sqlite.NewBackupConfigRepository(dbRef)
		backupService = usecase.NewBackupService(dbRef, dbPath, cfg.Database.MigrationsDir, envStorage, backupConfigRepo)

		// Try to load stored config and apply it.
		storedCfg, err := backupConfigRepo.Get(ctx)
		if err != nil && !errors.Is(err, ports.ErrNotFound) {
			log.Printf("warn: failed to load stored backup config: %v", err)
		}
		if storedCfg != nil && storedCfg.Provider != "" && storedCfg.Bucket != "" {
			if stored, err := cloudstorage.New(storedCfg.Provider, storedCfg.Bucket, storedCfg.ObjectKey, storedCfg.S3Region); err == nil {
				backupService.SetStorage(stored)
			}
			if storedCfg.SyncInterval != "" && storedCfg.SyncInterval != "0" {
				if d, parseErr := time.ParseDuration(storedCfg.SyncInterval); parseErr == nil && d > 0 {
					backupService.StartPeriodicSave(ctx, d)
				}
			}
		} else if cfg.Backup.SyncInterval > 0 {
			backupService.StartPeriodicSave(ctx, cfg.Backup.SyncInterval)
		}

		deps.BackupService = backupService
	}

	app := httpserver.NewServer(deps)

	// Graceful shutdown with backup save.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("shutdown signal received")

		if backupService != nil {
			backupService.StopPeriodicSave()
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			backupService.SaveOnShutdown(shutdownCtx)
		}

		if err := app.Shutdown(); err != nil {
			log.Printf("shutdown error: %v", err)
		}
	}()

	addr := fmt.Sprintf(":%s", cfg.Server.Port)
	log.Printf("mock-loom API listening on %s", addr)
	if err := app.Listen(addr); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func shouldRestore(cfg config.BackupConfig, dbPath string) bool {
	if cfg.RestoreOnStart {
		return true
	}
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		log.Println("backup: local DB not found, attempting restore from bucket")
		return true
	}
	return false
}

func restoreFromBucket(ctx context.Context, storage ports.BucketStorage, dbPath string) {
	exists, err := storage.Exists(ctx)
	if err != nil {
		log.Fatalf("backup: check bucket object: %v", err)
	}
	if !exists {
		log.Println("backup: no backup found in bucket, starting fresh")
		return
	}

	log.Println("backup: restoring from bucket...")
	reader, err := storage.Download(ctx)
	if err != nil {
		log.Fatalf("backup: download failed: %v", err)
	}
	defer reader.Close()

	f, err := os.Create(dbPath)
	if err != nil {
		log.Fatalf("backup: create db file: %v", err)
	}
	written, err := io.Copy(f, reader)
	if err != nil {
		f.Close()
		log.Fatalf("backup: write db file: %v", err)
	}
	f.Close()
	log.Printf("backup: restored %d bytes from bucket", written)
}
