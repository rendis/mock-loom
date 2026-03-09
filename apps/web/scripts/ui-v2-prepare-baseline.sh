#!/usr/bin/env bash
set -euo pipefail

DATE_TAG="${DATE_TAG:-$(date +%F)}"
BUNDLE="${BUNDLE:-a}"
STATE="${STATE:-ready}"

function map_baseline() {
  case "${BUNDLE}:${STATE}" in
    a:ready) echo "docs/desing/screen_a_ready/screen.png" ;;
    a:empty) echo "docs/desing/screen_a_empty_integrations/screen.png" ;;
    a:access-error) echo "docs/desing/screen_a_access_error/screen.png" ;;
    b:ready) echo "docs/desing/screen_b_ready/screen.png" ;;
    b:empty) echo "docs/desing/screen_b_empty_routes/screen.png" ;;
    b:import-error) echo "docs/desing/screen_b_import_error/screen.png" ;;
    c:contract-ready) echo "docs/desing/screen_c_contract_ready/screen.png" ;;
    c:scenarios-editing) echo "docs/desing/screen_c_scenarios_editing/screen.png" ;;
    c:traffic-streaming) echo "docs/desing/screen_c_live_traffic_streaming/screen.png" ;;
    c:traffic-error) echo "docs/desing/screen_c_live_traffic_streaming/screen.png" ;;
    d:ready) echo "docs/desing/screen_d_ready/screen.png" ;;
    d:empty) echo "docs/desing/screen_d_empty_state/screen.png" ;;
    d:upload-error) echo "docs/desing/screen_d_upload_error/screen.png" ;;
    e:ready) echo "docs/desing/screen_e_data_debugger_ready/screen.png" ;;
    e:timeline-details) echo "docs/desing/screen_e_entity_timeline_details/screen.png" ;;
    e:rollback-confirmation) echo "docs/desing/screen_e_rollback_confirmation/screen.png" ;;
    *)
      echo "Unknown bundle/state mapping: ${BUNDLE}:${STATE}" >&2
      exit 1
      ;;
  esac
}

BASELINE_SRC="$(map_baseline)"
if [[ ! -f "$BASELINE_SRC" ]]; then
  echo "Baseline source not found: $BASELINE_SRC" >&2
  exit 1
fi

ROOT_DIR="docs/evidence/ui-v2/${DATE_TAG}/bundle-${BUNDLE}/${STATE}"
VIEWPORTS=("375x812" "768x1024" "1280x900" "1920x1080")

for vp in "${VIEWPORTS[@]}"; do
  target_dir="${ROOT_DIR}/${vp}"
  mkdir -p "$target_dir"
  cp "$BASELINE_SRC" "$target_dir/baseline.png"
done

echo "Baseline prepared from ${BASELINE_SRC} -> ${ROOT_DIR}"
