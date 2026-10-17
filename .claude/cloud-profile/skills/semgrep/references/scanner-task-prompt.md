# Scanner Subagent Task Prompt

Use this bounded prompt in Step 4 with an available general-purpose worker when delegation is authorized, or for direct execution when workers are unavailable or delegation is not authorized. Inspect current-host tools; no exact scanner-agent type is required.

## Template

```
You are a Semgrep scanner for [LANGUAGE_CATEGORY].

## Task
Run Semgrep scans for [LANGUAGE] files and save results to [OUTPUT_DIR]/raw.

## Approved Engine: [ENGINE: Pro/OSS]; local availability evidence: [EVIDENCE]

## Scan Mode: [SCAN_MODE: run-all/important-only]

## APPROVED RULESETS (from user-confirmed plan)
[LIST EXACT RULESETS USER APPROVED - DO NOT SUBSTITUTE]

## APPROVED NETWORK/PROVIDER ACTIONS
[EXACT AUTHORIZED REGISTRY LOOKUPS, CLONES, PRO/LICENSE VALIDATION, OR LOCAL-ONLY]
Do not install tools, contact a registry or use Pro/provider access beyond this authority. Stop on an unavailable approved engine or ruleset; do not silently substitute.

Example:
- p/python
- p/django
- p/security-audit
- p/secrets
- https://github.com/trailofbits/semgrep-rules

## Commands to Run (in parallel)

### Track every approved scan and its expected artifacts:
```bash
source {baseDir}/scripts/scan-status.sh
```

Use a supported Bash shell and local Python 3 for result validation; if either is unavailable, report the missing capability before execution. Do not install implicitly. Use unique, fresh absolute JSON/SARIF paths for each approved ruleset and keep the batch within current-host concurrency limits.

### Clone GitHub URL rulesets first:
```bash
mkdir -p [OUTPUT_DIR]/repos
# For each GitHub URL ruleset, clone into [OUTPUT_DIR]/repos/[name]:
git clone --depth 1 https://github.com/org/repo [OUTPUT_DIR]/repos/repo-name
```

### Generate commands for EACH approved ruleset:
```bash
start_semgrep_scan [OUTPUT_DIR]/raw/[lang]-[ruleset].json [OUTPUT_DIR]/raw/[lang]-[ruleset].sarif env SEMGREP_ENABLE_VERSION_CHECK=0 semgrep [--pro if approved] --metrics=off [SEVERITY_FLAGS] [INCLUDE_FLAGS] --config [RULESET] --json -o [OUTPUT_DIR]/raw/[lang]-[ruleset].json --sarif-output=[OUTPUT_DIR]/raw/[lang]-[ruleset].sarif [TARGET] || SEMGREP_SCAN_LAUNCH_FAILED=1
```

Wait for every recorded PID and validate every expected fresh JSON/SARIF pair. The helper remembers launch failures and rejects nonzero exits, missing/invalid outputs and JSON-reported scan errors:
```bash
wait_semgrep_scans [APPROVED_SCAN_COUNT] || exit 1
```

Do not merge or report successful completion after a failed batch. Preserve raw diagnostics and report the incomplete coverage, even if some result files exist.

### Clean up cloned repos:
```bash
[ -n "[OUTPUT_DIR]" ] && rm -rf [OUTPUT_DIR]/repos
```

## Critical Rules
- Use ONLY the rulesets listed above - do not add or remove any
- Always use --metrics=off (prevents sending telemetry to Semgrep servers)
- Use --pro only for the approved Pro engine; report failure instead of silently falling back
- If scan mode is **important-only**, add `--severity MEDIUM --severity HIGH --severity CRITICAL` to every command
- If scan mode is **run-all**, do NOT add severity flags
- Bound parallel rulesets to current-host resource and repository coordinator limits
- Require `wait_semgrep_scans` to pass before reporting the scanner task complete; bare `wait` does not preserve every child status
- For GitHub URL rulesets, always clone into [OUTPUT_DIR]/repos/ and use the local path as --config (do NOT pass URLs directly to semgrep — its URL handling is unreliable for repos with non-standard YAML)
- Add `--include` flags for language-specific rulesets (e.g., `--include="*.py"` for p/python). Do NOT add `--include` to cross-language rulesets like p/security-audit, p/secrets, or third-party repos
- After all scans complete, delete [OUTPUT_DIR]/repos/ to avoid leaving cloned repos behind

## Output
Report:
- Number of findings per ruleset
- Any scan errors
- File paths of JSON results (in [OUTPUT_DIR]/raw/)
- [If Pro] Note any cross-file findings detected
```

## Variable Substitutions

| Variable | Description | Example |
|----------|-------------|---------|
| `[LANGUAGE_CATEGORY]` | Language group being scanned | Python, JavaScript, Docker |
| `[LANGUAGE]` | Specific language | Python, TypeScript, Go |
| `[OUTPUT_DIR]` | Output directory (absolute path, resolved in Step 1) | /path/to/static_analysis_semgrep_1 |
| `[ENGINE]` / `[EVIDENCE]` | Approved engine and observed local capability evidence | Pro / installed metadata, usability unverified |
| `[APPROVED_SCAN_COUNT]` | Number of exact approved scan jobs assigned to this worker, fixed before launch | 5 |
| `[SEVERITY_FLAGS]` | Severity pre-filter flags | *(empty)* for run-all, `--severity MEDIUM --severity HIGH --severity CRITICAL` for important-only |
| `[INCLUDE_FLAGS]` | File extension filter for language-specific rulesets | `--include="*.py"` for Python rulesets, *(empty)* for cross-language rulesets like p/security-audit, p/secrets, or third-party repos |
| `[RULESET]` | Semgrep ruleset identifier or local clone path | p/python, [OUTPUT_DIR]/repos/semgrep-rules |
| `[TARGET]` | Absolute path to directory to scan | /path/to/codebase |

## Example: Python Scanner Task

```
You are a Semgrep scanner for Python.

## Task
Run Semgrep scans for Python files and save results to /path/to/static_analysis_semgrep_1/raw.

## Approved Engine: Pro; usability established only by authorized execution

## Scan Mode: run-all

## APPROVED RULESETS (from user-confirmed plan)
- p/python
- p/django
- p/security-audit
- p/secrets
- https://github.com/trailofbits/semgrep-rules

## APPROVED NETWORK/PROVIDER ACTIONS
- Fetch the listed registry rulesets and clone the listed Trail of Bits repository
- Use the approved Pro engine; no installation or additional provider actions

## Commands to Run (in parallel)

### Track expected result pairs:
```bash
source {baseDir}/scripts/scan-status.sh
```

### Clone GitHub URL rulesets first:
```bash
mkdir -p /path/to/static_analysis_semgrep_1/repos
git clone --depth 1 https://github.com/trailofbits/semgrep-rules /path/to/static_analysis_semgrep_1/repos/trailofbits
```

### Run scans:
```bash
start_semgrep_scan /path/to/static_analysis_semgrep_1/raw/python-python.json /path/to/static_analysis_semgrep_1/raw/python-python.sarif env SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --pro --metrics=off --include="*.py" --config p/python --json -o /path/to/static_analysis_semgrep_1/raw/python-python.json --sarif-output=/path/to/static_analysis_semgrep_1/raw/python-python.sarif /path/to/codebase || SEMGREP_SCAN_LAUNCH_FAILED=1
start_semgrep_scan /path/to/static_analysis_semgrep_1/raw/python-django.json /path/to/static_analysis_semgrep_1/raw/python-django.sarif env SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --pro --metrics=off --include="*.py" --config p/django --json -o /path/to/static_analysis_semgrep_1/raw/python-django.json --sarif-output=/path/to/static_analysis_semgrep_1/raw/python-django.sarif /path/to/codebase || SEMGREP_SCAN_LAUNCH_FAILED=1
start_semgrep_scan /path/to/static_analysis_semgrep_1/raw/python-security-audit.json /path/to/static_analysis_semgrep_1/raw/python-security-audit.sarif env SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --pro --metrics=off --config p/security-audit --json -o /path/to/static_analysis_semgrep_1/raw/python-security-audit.json --sarif-output=/path/to/static_analysis_semgrep_1/raw/python-security-audit.sarif /path/to/codebase || SEMGREP_SCAN_LAUNCH_FAILED=1
start_semgrep_scan /path/to/static_analysis_semgrep_1/raw/python-secrets.json /path/to/static_analysis_semgrep_1/raw/python-secrets.sarif env SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --pro --metrics=off --config p/secrets --json -o /path/to/static_analysis_semgrep_1/raw/python-secrets.json --sarif-output=/path/to/static_analysis_semgrep_1/raw/python-secrets.sarif /path/to/codebase || SEMGREP_SCAN_LAUNCH_FAILED=1
start_semgrep_scan /path/to/static_analysis_semgrep_1/raw/python-trailofbits.json /path/to/static_analysis_semgrep_1/raw/python-trailofbits.sarif env SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --pro --metrics=off --config /path/to/static_analysis_semgrep_1/repos/trailofbits --json -o /path/to/static_analysis_semgrep_1/raw/python-trailofbits.json --sarif-output=/path/to/static_analysis_semgrep_1/raw/python-trailofbits.sarif /path/to/codebase || SEMGREP_SCAN_LAUNCH_FAILED=1
wait_semgrep_scans 5 || exit 1
```

### Clean up cloned repos:
```bash
rm -rf /path/to/static_analysis_semgrep_1/repos
```

## Critical Rules
- Use ONLY the rulesets listed above - do not add or remove any
- Always use --metrics=off
- Use --pro only for the approved Pro engine; stop on failure rather than substituting
- Bound parallel rulesets to current-host resource and repository coordinator limits
- Every recorded PID and expected JSON/SARIF pair must pass the helper before completion; never merge a successful subset
- Clone GitHub URL rulesets into the output dir repos/ subfolder, use local path as --config
- Add --include="*.py" to language-specific rulesets (p/python, p/django) but NOT to p/security-audit, p/secrets, or third-party repos
- Delete repos/ after scanning

## Output
Report:
- Number of findings per ruleset
- Any scan errors
- File paths of JSON results (in raw/ subdirectory)
- Note any cross-file findings detected
```
