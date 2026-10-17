# Source from a supported Bash shell after exact-plan approval. No scanners run on source.
# The caller owns approved commands, absolute output paths and concurrency limits.
SEMGREP_SCAN_PIDS=()
SEMGREP_SCAN_JSON=()
SEMGREP_SCAN_SARIF=()
SEMGREP_SCAN_LAUNCH_FAILED=0

start_semgrep_scan() {
  local json="$1" sarif="$2" existing
  shift 2
  if [ "$#" -eq 0 ] || [ "$json" = "$sarif" ]; then
    printf '%s\n' 'scan-status: command and distinct JSON/SARIF outputs are required' >&2
    SEMGREP_SCAN_LAUNCH_FAILED=1
    return 1
  fi
  for existing in "${SEMGREP_SCAN_JSON[@]}" "${SEMGREP_SCAN_SARIF[@]}"; do
    if [ "$existing" = "$json" ] || [ "$existing" = "$sarif" ]; then
      printf '%s\n' 'scan-status: duplicate result path; use unique outputs for each approved scan' >&2
      SEMGREP_SCAN_LAUNCH_FAILED=1
      return 1
    fi
  done
  if [ -e "$json" ] || [ -L "$json" ] || [ -e "$sarif" ] || [ -L "$sarif" ]; then
    printf '%s\n' 'scan-status: result already exists; preserve it and select fresh output paths' >&2
    SEMGREP_SCAN_LAUNCH_FAILED=1
    return 1
  fi
  "$@" &
  SEMGREP_SCAN_PIDS+=("$!")
  SEMGREP_SCAN_JSON+=("$json")
  SEMGREP_SCAN_SARIF+=("$sarif")
}

wait_semgrep_scans() {
  local failed="$SEMGREP_SCAN_LAUNCH_FAILED" index status expected="${1:-}"
  if [ "${#SEMGREP_SCAN_PIDS[@]}" -eq 0 ]; then
    printf '%s\n' 'scan-status: no approved scans were launched' >&2
    return 1
  fi
  if [[ ! "$expected" =~ ^[1-9][0-9]*$ ]] || [ "$expected" != "${#SEMGREP_SCAN_PIDS[@]}" ]; then
    failed=1
    printf '%s\n' 'scan-status: launched scan count differs from the exact approved plan' >&2
  fi
  # Await every PID even after a failure; bare `wait` can discard a failed child's status.
  for ((index = 0; index < ${#SEMGREP_SCAN_PIDS[@]}; index++)); do
    if wait "${SEMGREP_SCAN_PIDS[$index]}"; then
      status=0
    else
      status=$?
      failed=1
      printf 'scan-status: scan %s failed with exit %s\n' "$((index + 1))" "$status" >&2
    fi
    if ! python3 - "${SEMGREP_SCAN_JSON[$index]}" "${SEMGREP_SCAN_SARIF[$index]}" <<'PY'
import json
import os
import sys

try:
    documents = []
    for filename in sys.argv[1:]:
        if os.path.islink(filename) or not os.path.isfile(filename):
            raise ValueError("missing or linked output")
        with open(filename, encoding="utf-8") as stream:
            documents.append(json.load(stream))
    result, sarif = documents
    if not isinstance(result, dict) or not isinstance(result.get("results"), list):
        raise ValueError("invalid scan JSON")
    errors = result.get("errors")
    if not isinstance(errors, list):
        raise ValueError("invalid scan errors")
    error_count = 0
    warning_count = 0
    for error in errors:
        if isinstance(error, dict) and error.get("level") == "warn":
            warning_count += 1
        else:
            # Only an explicitly classified warning is non-blocking. Missing
            # or unknown levels cannot prove that analysis completed.
            error_count += 1
    if warning_count:
        print(f"scan-status: ignoring {warning_count} warning-level scan diagnostics", file=sys.stderr)
    if error_count:
        raise ValueError("scan JSON reports error-level incomplete analysis")
    if not isinstance(sarif, dict) or not isinstance(sarif.get("runs"), list) or not sarif["runs"]:
        raise ValueError("invalid or empty SARIF runs")
    for run in sarif["runs"]:
        if not isinstance(run, dict) or not isinstance(run.get("tool"), dict):
            raise ValueError("invalid SARIF run")
        driver = run["tool"].get("driver")
        if not isinstance(driver, dict):
            raise ValueError("invalid SARIF run structure")
        # SARIF permits absent rules/results for an empty run, and the merger
        # uses these same empty-list defaults. Present malformed values fail.
        rules = driver.get("rules", [])
        results = run.get("results", [])
        if not isinstance(rules, list) or not isinstance(results, list):
            raise ValueError("invalid SARIF run structure")
        if any(not isinstance(rule, dict) for rule in rules):
            raise ValueError("invalid SARIF rule")
        if any(not isinstance(item, dict) for item in results):
            raise ValueError("invalid SARIF result")
        for item in results:
            locations = item.get("locations", [])
            if not isinstance(locations, list) or any(not isinstance(location, dict) for location in locations):
                raise ValueError("invalid SARIF result locations")
except (OSError, ValueError, TypeError):
    print("scan-status: expected fresh JSON/SARIF pair is missing, invalid or incomplete", file=sys.stderr)
    sys.exit(1)
PY
    then
      failed=1
    fi
  done
  if [ "$failed" -ne 0 ]; then
    printf '%s\n' 'scan-status: incomplete scan batch; preserve diagnostics and do not report or merge a successful subset' >&2
    return 1
  fi
  printf 'scan-status: %s approved scans completed with valid JSON/SARIF pairs\n' "${#SEMGREP_SCAN_PIDS[@]}"
}
