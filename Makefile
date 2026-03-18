SHELL := /bin/bash
.DEFAULT_GOAL := help

ENV_FILE ?= .env
API_DIR := apps/api
WEB_DIR := apps/web
MCP_DIR := apps/mcp
API_BUILD_BIN := $(API_DIR)/bin/mock-loom-api
MCP_BUILD_BIN := $(MCP_DIR)/bin/mock-loom-mcp
WEB_DEV_HOST ?= 127.0.0.1
WEB_DEV_PORT ?= 5173
WEB_RUN_HOST ?= 127.0.0.1
WEB_RUN_PORT ?= 4173
DUMMY_API_PORT ?= 18081
DUMMY_WEB_PORT ?= 4173
DUMMY_AUTH_EMAIL ?= admin@mockloom.local
DUMMY_AUTH_SUBJECT ?= dummy-admin

ifeq (,$(wildcard $(ENV_FILE)))
$(error Missing $(ENV_FILE). Create it in repository root)
endif

include $(ENV_FILE)
.EXPORT_ALL_VARIABLES:

.PHONY: help install check-tools check-runtime-tools check-dev-tools clean build build-api build-web build-mcp api web run dev run-dummy dev-dummy smoke smoke-dummy login-dummy

help:
	@echo "Targets:"
	@echo "  make install      Install JS dependencies"
	@echo "  make check-tools  Validate required CLIs"
	@echo "  make check-dev-tools Validate dev-only CLIs"
	@echo "  make build        Build API binary + web assets"
	@echo "  make api          Build and run API binary"
	@echo "  make web          Build and preview web app"
	@echo "  make run          Build both projects and run in foreground"
	@echo "  make dev          Build first, then run with auto-rebuild on changes"
	@echo "  make run-dummy    Build and run API+web in dummy auth mode (no credentials)"
	@echo "  make dev-dummy    Run API+web in watch mode with dummy auth (no credentials)"
	@echo "  make build-mcp    Build MCP server binary"
	@echo "  make clean        Remove build artifacts"
	@echo "  make smoke        Quick API smoke checks"
	@echo "  make smoke-dummy  Quick API smoke checks against dummy-auth port/profile"
	@echo "  make login-dummy  Print browser snippet for dummy auth token"
	@echo "  make qa-baseline  Copy v2 baseline screenshots into evidence tree (requires BUNDLE/STATE)"
	@echo "  make qa-capture   Capture current screenshots with agent-browser (requires ROUTE_PATH, optional AUTH_TOKEN)"

install:
	@pnpm install

check-tools:
	@command -v go >/dev/null || (echo "go not found"; echo "Install Go: https://go.dev/dl/"; exit 1)
	@command -v pnpm >/dev/null || (echo "pnpm not found"; echo "Install pnpm: corepack enable && corepack prepare pnpm@latest --activate"; exit 1)
	@command -v p2o >/dev/null || (echo "p2o not found"; echo "Install p2o: npm install -g postman-to-openapi@3.0.1"; exit 1)
	@command -v curlconverter >/dev/null || (echo "curlconverter not found"; echo "Install curlconverter: npm install -g curlconverter@4.12.0"; exit 1)

check-runtime-tools:
	@command -v go >/dev/null || (echo "go not found"; echo "Install Go: https://go.dev/dl/"; exit 1)
	@command -v pnpm >/dev/null || (echo "pnpm not found"; echo "Install pnpm: corepack enable && corepack prepare pnpm@latest --activate"; exit 1)

check-dev-tools:
	@command -v air >/dev/null || (echo "air not found"; echo "Install air: go install github.com/air-verse/air@latest"; echo "If needed add to PATH: export PATH=\"$$HOME/go/bin:$$PATH\""; exit 1)

clean:
	@rm -rf "$(API_DIR)/bin" "$(WEB_DIR)/dist" "$(MCP_DIR)/bin"

build: check-tools build-api build-web

build-api:
	@mkdir -p "$(API_DIR)/bin"
	@cd "$(API_DIR)" && go build -o "bin/mock-loom-api" ./cmd/server

build-mcp:
	@mkdir -p "$(MCP_DIR)/bin"
	@cd "$(MCP_DIR)" && go build -o "bin/mock-loom-mcp" ./cmd/mock-loom-mcp

build-web:
	@pnpm --filter @mock-loom/web build

api: check-tools build-api
	@cd "$(API_DIR)" && ./bin/mock-loom-api

web: check-tools build-web
	@cd "$(WEB_DIR)" && pnpm preview --host "$(WEB_RUN_HOST)" --port "$(WEB_RUN_PORT)"

run: check-tools build
	@bash -lc 'set -euo pipefail; \
	  cd "$(CURDIR)"; \
	  ./$(API_BUILD_BIN) & \
	  API_PID=$$!; \
	  (cd "$(WEB_DIR)" && pnpm preview --host "$(WEB_RUN_HOST)" --port "$(WEB_RUN_PORT)") & \
	  WEB_PID=$$!; \
	  cleanup() { \
	    kill $$API_PID $$WEB_PID 2>/dev/null || true; \
	    wait $$API_PID 2>/dev/null || true; \
	    wait $$WEB_PID 2>/dev/null || true; \
	  }; \
	  trap cleanup EXIT INT TERM; \
	  echo "API: http://127.0.0.1:$${MOCK_LOOM_SERVER_PORT}"; \
	  echo "Web: http://$(WEB_RUN_HOST):$(WEB_RUN_PORT)"; \
	  echo "Dummy login snippet (browser console):"; \
	  echo "localStorage.setItem(\"mock_loom_access_token\",\"dummy-token\"); location.reload();"; \
	  while true; do \
	    if ! kill -0 $$API_PID 2>/dev/null; then echo "API process exited"; exit 1; fi; \
	    if ! kill -0 $$WEB_PID 2>/dev/null; then echo "Web process exited"; exit 1; fi; \
	    sleep 1; \
	  done'

dev: check-tools check-dev-tools build
	@bash -lc 'set -euo pipefail; \
	  (cd "$(API_DIR)" && air --build.cmd "go build -o ./bin/mock-loom-api-dev ./cmd/server" --build.bin "./bin/mock-loom-api-dev") & \
	  API_WATCH_PID=$$!; \
	  (cd "$(WEB_DIR)" && pnpm dev --host "$(WEB_DEV_HOST)" --port "$(WEB_DEV_PORT)") & \
	  WEB_PID=$$!; \
	  cleanup() { \
	    kill $$API_WATCH_PID $$WEB_PID 2>/dev/null || true; \
	    wait $$API_WATCH_PID 2>/dev/null || true; \
	    wait $$WEB_PID 2>/dev/null || true; \
	  }; \
	  trap cleanup EXIT INT TERM; \
	  echo "API: http://127.0.0.1:$${MOCK_LOOM_SERVER_PORT}"; \
	  echo "Web (watch): http://$(WEB_DEV_HOST):$(WEB_DEV_PORT)"; \
	  echo "Dummy login snippet (browser console):"; \
	  echo "localStorage.setItem(\"mock_loom_access_token\",\"dummy-token\"); location.reload();"; \
	  while true; do \
	    if ! kill -0 $$API_WATCH_PID 2>/dev/null; then echo "API watch process exited"; exit 1; fi; \
	    if ! kill -0 $$WEB_PID 2>/dev/null; then echo "Web dev process exited"; exit 1; fi; \
	    sleep 1; \
	  done'

run-dummy: export VITE_API_BASE_URL = http://127.0.0.1:$(DUMMY_API_PORT)/api/v1
run-dummy: check-runtime-tools build-api build-web
	@bash -lc 'set -euo pipefail; \
	  cd "$(CURDIR)"; \
	  export MOCK_LOOM_SERVER_PORT="$(DUMMY_API_PORT)" \
	         MOCK_LOOM_AUTH_DISCOVERY_URL="" \
	         MOCK_LOOM_AUTH_ISSUER="" \
	         MOCK_LOOM_AUTH_JWKS_URL="" \
	         MOCK_LOOM_DUMMY_AUTH_ENABLED="true" \
	         MOCK_LOOM_DUMMY_AUTH_EMAIL="$(DUMMY_AUTH_EMAIL)" \
	         MOCK_LOOM_DUMMY_AUTH_SUBJECT="$(DUMMY_AUTH_SUBJECT)" \
	         MOCK_LOOM_BOOTSTRAP_ENABLED="true" \
	         MOCK_LOOM_BOOTSTRAP_ALLOWED_EMAILS="$(DUMMY_AUTH_EMAIL)"; \
	  (cd "$(API_DIR)" && ./bin/mock-loom-api) & \
	  API_PID=$$!; \
	  (cd "$(WEB_DIR)" && VITE_API_BASE_URL="http://127.0.0.1:$(DUMMY_API_PORT)/api/v1" pnpm preview --host "$(WEB_RUN_HOST)" --port "$(DUMMY_WEB_PORT)") & \
	  WEB_PID=$$!; \
	  cleanup() { \
	    kill $$API_PID $$WEB_PID 2>/dev/null || true; \
	    wait $$API_PID 2>/dev/null || true; \
	    wait $$WEB_PID 2>/dev/null || true; \
	  }; \
	  trap cleanup EXIT INT TERM; \
	  echo "API (dummy auth): http://127.0.0.1:$(DUMMY_API_PORT)"; \
	  echo "Web: http://$(WEB_RUN_HOST):$(DUMMY_WEB_PORT)"; \
	  echo "Go to /login and click Continue to Workspace (no credentials required)."; \
	  while true; do \
	    if ! kill -0 $$API_PID 2>/dev/null; then echo "API process exited"; exit 1; fi; \
	    if ! kill -0 $$WEB_PID 2>/dev/null; then echo "Web process exited"; exit 1; fi; \
	    sleep 1; \
	  done'

dev-dummy: export VITE_API_BASE_URL = http://127.0.0.1:$(DUMMY_API_PORT)/api/v1
dev-dummy: check-runtime-tools check-dev-tools build-api build-web
	@bash -lc 'set -euo pipefail; \
	  cd "$(CURDIR)"; \
	  (cd "$(API_DIR)" && MOCK_LOOM_SERVER_PORT="$(DUMMY_API_PORT)" MOCK_LOOM_AUTH_DISCOVERY_URL="" MOCK_LOOM_AUTH_ISSUER="" MOCK_LOOM_AUTH_JWKS_URL="" MOCK_LOOM_DUMMY_AUTH_ENABLED="true" MOCK_LOOM_DUMMY_AUTH_EMAIL="$(DUMMY_AUTH_EMAIL)" MOCK_LOOM_DUMMY_AUTH_SUBJECT="$(DUMMY_AUTH_SUBJECT)" MOCK_LOOM_BOOTSTRAP_ENABLED="true" MOCK_LOOM_BOOTSTRAP_ALLOWED_EMAILS="$(DUMMY_AUTH_EMAIL)" air --build.cmd "go build -o ./bin/mock-loom-api-dev ./cmd/server" --build.bin "./bin/mock-loom-api-dev") & \
	  API_WATCH_PID=$$!; \
	  (cd "$(WEB_DIR)" && VITE_API_BASE_URL="http://127.0.0.1:$(DUMMY_API_PORT)/api/v1" pnpm dev --host "$(WEB_DEV_HOST)" --port "$(DUMMY_WEB_PORT)") & \
	  WEB_PID=$$!; \
	  cleanup() { \
	    kill $$API_WATCH_PID $$WEB_PID 2>/dev/null || true; \
	    wait $$API_WATCH_PID 2>/dev/null || true; \
	    wait $$WEB_PID 2>/dev/null || true; \
	  }; \
	  trap cleanup EXIT INT TERM; \
	  echo "API (dummy auth watch): http://127.0.0.1:$(DUMMY_API_PORT)"; \
	  echo "Web (watch): http://$(WEB_DEV_HOST):$(DUMMY_WEB_PORT)"; \
	  echo "Go to /login and click Continue to Workspace (no credentials required)."; \
	  while true; do \
	    if ! kill -0 $$API_WATCH_PID 2>/dev/null; then echo "API watch process exited"; exit 1; fi; \
	    if ! kill -0 $$WEB_PID 2>/dev/null; then echo "Web dev process exited"; exit 1; fi; \
	    sleep 1; \
	  done'

smoke:
	@curl -fsS "http://127.0.0.1:$${MOCK_LOOM_SERVER_PORT}/health"
	@echo
	@curl -fsS "http://127.0.0.1:$${MOCK_LOOM_SERVER_PORT}/api/v1/auth/config"
	@echo
	@curl -fsS "http://127.0.0.1:$${MOCK_LOOM_SERVER_PORT}/api/v1/auth/me"
	@echo

smoke-dummy:
	@curl -fsS "http://127.0.0.1:$(DUMMY_API_PORT)/health"
	@echo
	@AUTH_CONFIG="$$(curl -fsS "http://127.0.0.1:$(DUMMY_API_PORT)/api/v1/auth/config")"; \
	  echo "$$AUTH_CONFIG"; \
	  echo "$$AUTH_CONFIG" | grep -q '"dummyAuth":true' || (echo "dummyAuth is not enabled on auth/config"; exit 1)
	@echo
	@curl -fsS "http://127.0.0.1:$(DUMMY_API_PORT)/api/v1/auth/me"
	@echo

login-dummy:
	@echo "localStorage.setItem('mock_loom_access_token','dummy-token'); location.reload();"

qa-baseline:
	@BUNDLE="$${BUNDLE:?Set BUNDLE (a|b|c|d|e)}" \
	STATE="$${STATE:?Set STATE (e.g. ready, empty, access-error)}" \
	DATE_TAG="$${DATE_TAG:-$$(date +%F)}" \
	./$(WEB_DIR)/scripts/ui-v2-prepare-baseline.sh

qa-capture:
	@BUNDLE="$${BUNDLE:?Set BUNDLE (a|b|c|d|e)}" \
	STATE="$${STATE:?Set STATE (e.g. ready, empty, access-error)}" \
	ROUTE_PATH="$${ROUTE_PATH:?Set ROUTE_PATH (e.g. /workspace)}" \
	BASE_URL="$${BASE_URL:-http://127.0.0.1:5173}" \
	AUTH_TOKEN="$${AUTH_TOKEN:-}" \
	DATE_TAG="$${DATE_TAG:-$$(date +%F)}" \
	./$(WEB_DIR)/scripts/ui-v2-capture.sh
