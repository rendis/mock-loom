#!/usr/bin/env sh
set -eu

POSTMAN_CLI="${MOCK_LOOM_IMPORT_POSTMAN_CLI_PATH:-p2o}"
CURL_CLI="${MOCK_LOOM_IMPORT_CURL_CLI_PATH:-curlconverter}"

if ! command -v "$POSTMAN_CLI" >/dev/null 2>&1; then
	echo "missing import converter CLI: $POSTMAN_CLI" >&2
	exit 1
fi

if ! command -v "$CURL_CLI" >/dev/null 2>&1; then
	echo "missing import converter CLI: $CURL_CLI" >&2
	exit 1
fi

exec /app/mock-loom-api
