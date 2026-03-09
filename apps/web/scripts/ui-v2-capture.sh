#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:5173}"
DATE_TAG="${DATE_TAG:-$(date +%F)}"
BUNDLE="${BUNDLE:-a}"
STATE="${STATE:-ready}"
ROUTE_PATH="${ROUTE_PATH:-/workspace}"
QA_STATE="${QA_STATE:-}"
SESSION="${SESSION:-ui-v2-${BUNDLE}-${STATE}}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

ROOT_DIR="docs/evidence/ui-v2/${DATE_TAG}/bundle-${BUNDLE}/${STATE}"
VIEWPORTS=("375x812" "768x1024" "1280x900" "1920x1080")

mkdir -p "$ROOT_DIR"

route_with_query="$ROUTE_PATH"
if [[ -n "$QA_STATE" ]]; then
  delimiter='?'
  if [[ "$route_with_query" == *"?"* ]]; then
    delimiter='&'
  fi
  route_with_query="${route_with_query}${delimiter}qaState=${QA_STATE}"
fi

echo "Capturing bundle=${BUNDLE} state=${STATE} route=${route_with_query}"

for vp in "${VIEWPORTS[@]}"; do
  width="${vp%x*}"
  height="${vp#*x}"
  target_dir="${ROOT_DIR}/${vp}"
  mkdir -p "$target_dir"

  echo "- viewport ${vp}"
  agent-browser --session "$SESSION" set viewport "$width" "$height"
  agent-browser --session "$SESSION" open "${BASE_URL}"

  if [[ -n "$AUTH_TOKEN" ]]; then
    agent-browser --session "$SESSION" storage local set mock_loom_access_token "$AUTH_TOKEN"
  fi

  agent-browser --session "$SESSION" open "${BASE_URL}${route_with_query}"
  agent-browser --session "$SESSION" wait --load networkidle
  agent-browser --session "$SESSION" snapshot > "$target_dir/agent-browser-snapshot.txt"
  agent-browser --session "$SESSION" screenshot "$target_dir/current.png"
done

agent-browser --session "$SESSION" close || true

echo "Capture complete: ${ROOT_DIR}"
