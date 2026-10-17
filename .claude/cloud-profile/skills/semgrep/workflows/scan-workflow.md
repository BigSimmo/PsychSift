# Semgrep Scan Workflow

Complete 5-step scan execution process. Read from start to finish and follow each step in order.

## Task System Enforcement

Use the current host's supported task tracker if available; otherwise record these steps as a short checklist with the same dependencies. Tool names below describe tracking actions, not required APIs:

```
1. Detect languages and local engine evidence
2. Select scan mode and rulesets — depends on Step 1
3. Present exact plan, obtain missing approval — depends on Step 2
4. Execute approved scans — depends on Step 3
5. Merge results and report — depends on Step 4
```

### Mandatory Gate

| Task | Gate Type | Cannot Proceed Until |
|------|-----------|---------------------|
| Step 3 | **HARD GATE** | User explicitly approves rulesets + plan |

Mark Step 3 as `completed` ONLY after user says "yes", "proceed", "approved", or equivalent.

---

## Step 1: Resolve Output Directory, Detect Languages and Pro Availability

> **Entry:** User has specified or confirmed the target directory.
> **Exit:** `OUTPUT_DIR` resolved and created; language list with file counts produced; local engine evidence recorded, with Pro usability unverified until authorized execution.

### Resolve Output Directory

If the user specified an output directory in their prompt, use it as `OUTPUT_DIR`. Otherwise, auto-increment. In both cases, **always `mkdir -p`** to ensure the directory exists.

```bash
if [ -n "$USER_SPECIFIED_DIR" ]; then
  OUTPUT_DIR="$USER_SPECIFIED_DIR"
else
  BASE="static_analysis_semgrep"
  N=1
  while [ -e "${BASE}_${N}" ]; do
    N=$((N + 1))
  done
  OUTPUT_DIR="${BASE}_${N}"
fi
mkdir -p "$OUTPUT_DIR/raw" "$OUTPUT_DIR/results"
echo "Output directory: $OUTPUT_DIR"
```

`$OUTPUT_DIR` is used by all subsequent steps. Pass its **absolute path** to scanner subagents. Scanners write raw output to `$OUTPUT_DIR/raw/`; merged/filtered results go to `$OUTPUT_DIR/results/`.

**Discover the local CLI** (use a supported shell):

```bash
if ! command -v semgrep >/dev/null 2>&1; then
  echo "ERROR: semgrep is not installed. Install from https://semgrep.dev/docs/getting-started/"
  exit 1
fi
SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --metrics=off --version
```

Inspect existing local installation metadata for Pro if useful; do not read or print credentials. Record installed, absent or unverified evidence without claiming license usability. **Before Step 3 approval, do not resolve registry configs, browse registries, clone rulesets, install tools or run Pro/license/network probes.** A version check is not scan or engine validation. Include any required registry/Pro/network validation in the plan for authorization, then run it only after Step 3.

**Detect languages** using supported file-search tools (a glob tool when available, or `rg --files` with equivalent filters). Apply these patterns to the target directory and count matches:

`**/*.py`, `**/*.js`, `**/*.ts`, `**/*.tsx`, `**/*.jsx`, `**/*.go`, `**/*.rb`, `**/*.java`, `**/*.php`, `**/*.c`, `**/*.cpp`, `**/*.rs`, `**/Dockerfile`, `**/*.tf`

Also check for framework markers: `package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `Cargo.toml`, `pom.xml`. Use supported file-reading tools to inspect framework dependencies (e.g., read `package.json` to detect React, Express, Next.js; read `pyproject.toml` for Django, Flask, FastAPI).

Map findings to categories:

| Detection | Category |
|-----------|----------|
| `.py`, `pyproject.toml` | Python |
| `.js`, `.ts`, `package.json` | JavaScript/TypeScript |
| `.go`, `go.mod` | Go |
| `.rb`, `Gemfile` | Ruby |
| `.java`, `pom.xml` | Java |
| `.php` | PHP |
| `.c`, `.cpp` | C/C++ |
| `.rs`, `Cargo.toml` | Rust |
| `Dockerfile` | Docker |
| `.tf` | Terraform |
| k8s manifests | Kubernetes |

---

## Step 2: Select Scan Mode and Rulesets

> **Entry:** Step 1 complete — languages detected, local CLI evidence and Pro uncertainty recorded.
> **Exit:** Scan mode selected; structured rulesets JSON compiled for all detected languages.

**First, select scan mode.** Preserve an explicit requested mode; otherwise ask using a supported user-input tool or ordinary chat:

```
header: "Scan Mode"
question: "Which scan mode should be used?"
multiSelect: false
options:
  - label: "Run all (Recommended)"
    description: "Full coverage — all rulesets, all severity levels"
  - label: "Important only"
    description: "Security vulnerabilities only — medium-high confidence and impact, no code quality"
```

Record the selected mode. It affects Steps 4 and 5.

**Then, select rulesets.** Using the detected languages and frameworks from Step 1, follow the **Ruleset Selection Algorithm** in [rulesets.md](../references/rulesets.md).

The algorithm covers:
1. Security baseline (always included)
2. Language-specific rulesets
3. Framework rulesets (if detected)
4. Infrastructure rulesets
5. **Required** third-party rulesets (Trail of Bits, 0xdea, Decurity — NOT optional)
6. Propose registry verification for after Step 3 approval; do not contact a registry during selection

**Output:** Structured JSON passed to Step 3 for user review:

```json
{
  "baseline": ["p/security-audit", "p/secrets"],
  "python": ["p/python", "p/django"],
  "javascript": ["p/javascript", "p/react", "p/nodejs"],
  "docker": ["p/dockerfile"],
  "third_party": ["https://github.com/trailofbits/semgrep-rules"]
}
```

---

## Step 3: CRITICAL GATE — Present Plan and Get Approval

> **Entry:** Step 2 complete — scan mode and rulesets selected.
> **Exit:** User has explicitly approved the plan (quoted confirmation).

> **⛔ MANDATORY CHECKPOINT — DO NOT SKIP**
>
> This step requires explicit user approval before proceeding.
> User may modify rulesets before approving.

Present plan to user with **explicit ruleset listing**:

```
## Semgrep Scan Plan

**Target:** /path/to/codebase
**Output directory:** $OUTPUT_DIR
**Engine:** Semgrep Pro (cross-file analysis) | Semgrep OSS (single-file)
**Engine evidence:** Local version/metadata; license usability unverified where applicable
**Network/provider actions:** Exact registry lookups, ruleset downloads/clones and any Pro/license validation; or explicitly local-only
**Execution:** Available authorized general worker(s), or bounded direct execution if workers are unavailable or delegation is not authorized
**Scan mode:** Run all | Important only (security vulns, medium-high confidence/impact)

### Detected Languages/Technologies:
- Python (1,234 files) - Django framework detected
- JavaScript (567 files) - React detected
- Dockerfile (3 files)

### Rulesets to Run:

**Security Baseline (always included):**
- [x] `p/security-audit` - Comprehensive security rules
- [x] `p/secrets` - Hardcoded credentials, API keys

**Python (1,234 files):**
- [x] `p/python` - Python security patterns
- [x] `p/django` - Django-specific vulnerabilities

**JavaScript (567 files):**
- [x] `p/javascript` - JavaScript security patterns
- [x] `p/react` - React-specific issues
- [x] `p/nodejs` - Node.js server-side patterns

**Docker (3 files):**
- [x] `p/dockerfile` - Dockerfile best practices

**Third-party (auto-included for detected languages):**
- [x] Trail of Bits rules - https://github.com/trailofbits/semgrep-rules

**Want to modify rulesets?** Tell me which to add or remove.
**Ready to scan?** Say "proceed" or "yes".
```

**⛔ STOP: Await explicit user approval.**

1. **If user wants to modify rulesets:** Add/remove as requested, re-present the updated plan, return to waiting.
2. **Use a supported user-input tool or ordinary chat** when exact-plan authorization is missing:
   ```
   "I've prepared the scan plan with N rulesets (including Trail of Bits). Proceed with scanning?"
   Options: ["Yes, run scan", "Modify rulesets first"]
   ```
3. **Valid approval:** "yes", "proceed", "approved", "go ahead", "looks good", "run it"
4. **NOT approval:** A generic request ("scan this codebase"), silence, questions about the plan. Reuse an existing explicit approval of the exact target, rulesets, engine, mode and network/provider actions; do not ask for it again.

### Pre-Scan Checklist

Before marking Step 3 complete:
- [ ] Target directory shown to user
- [ ] Engine type (Pro/OSS) displayed
- [ ] Languages detected and listed
- [ ] **All rulesets explicitly listed with checkboxes**
- [ ] User given opportunity to modify rulesets
- [ ] User explicitly approved (quote their confirmation)
- [ ] **Final ruleset list captured for Step 4**
- [ ] Registry/Pro/network validation, downloads and provider actions explicitly listed and authorized
- [ ] Supported execution path listed; any delegation separately authorized

### Log Approved Rulesets

After approval, write the approved rulesets to `$OUTPUT_DIR/rulesets.txt`:

```bash
cat > "$OUTPUT_DIR/rulesets.txt" << RULESETS
# Semgrep Scan — Approved Rulesets
# Generated: $(date -Iseconds)
# Scan mode: <run-all|important-only>

## Rulesets:
<one ruleset per line, e.g.:>
p/security-audit
p/secrets
p/python
p/django
https://github.com/trailofbits/semgrep-rules
RULESETS
```

---

## Step 4: Spawn Parallel Scan Tasks

> **Entry:** Step 3 approved — user explicitly confirmed the plan.
> **Exit:** All scan Tasks completed; result files exist in `$OUTPUT_DIR/raw/`.

**Use `$OUTPUT_DIR` resolved in Step 1.** It already exists; no need to create it again. Scanners write all output to `$OUTPUT_DIR/raw/`.

Inspect current-host worker capabilities. When delegation is authorized, use available general-purpose workers with shell/file access, dispatching independent language tasks together. A specialist scanner may be used only if actually exposed by the host; this seed requires no exact agent type. If workers are unavailable or delegation is not authorized, execute the bounded approved tasks directly. Report that fallback and retain host concurrency limits.

Use the scanner task prompt template from [scanner-task-prompt.md](../references/scanner-task-prompt.md).
Use its [scan-status helper](../scripts/scan-status.sh) for every approved scan. It records each PID and expected fresh JSON/SARIF pair. A nonzero exit, launch failure, missing artifact, invalid output or JSON-reported scan error makes the whole batch incomplete; bare `wait` and a successful subset are not completion evidence. Preserve all diagnostics and report the uncompleted rulesets instead of merging partial success.

**Mode-dependent scanner flags:**
- **Run all**: No additional flags
- **Important only**: Add `--severity MEDIUM --severity HIGH --severity CRITICAL` to every `semgrep` command

**Example — 3 Language Scan (with approved rulesets):**

When supported and authorized, dispatch these 3 independent tasks together; otherwise run the same approved tasks directly:

1. **Task: Python Scanner** — Rulesets: p/python, p/django, p/security-audit, p/secrets, trailofbits → `$OUTPUT_DIR/raw/python-*.json`
2. **Task: JavaScript Scanner** — Rulesets: p/javascript, p/react, p/nodejs, p/security-audit, p/secrets, trailofbits → `$OUTPUT_DIR/raw/js-*.json`
3. **Task: Docker Scanner** — Rulesets: p/dockerfile → `$OUTPUT_DIR/raw/docker-*.json`

### Operational Notes

- Always use **absolute paths** for `[TARGET]` — subagents can't resolve relative paths
- Run registry/Pro/network validation and ruleset downloads only when included in Step 3 authorization; `--metrics=off` disables telemetry, not registry access. Keep version checking disabled with `SEMGREP_ENABLE_VERSION_CHECK=0` during execution too.
- If the approved engine or ruleset is unavailable, stop and report it. Obtain approval for a changed plan rather than silently substituting engines, rulesets or network access.
- Clone GitHub URL rulesets into `$OUTPUT_DIR/repos/` — never pass URLs directly to `--config` (semgrep's URL handling fails on repos with non-standard YAML)
- Delete `$OUTPUT_DIR/repos/` after all scans complete
- Bound parallel ruleset execution to current-host resource and repository coordinator limits
- Use `--include="*.py"` for language-specific rulesets, but NOT for cross-language rulesets (p/security-audit, p/secrets, third-party repos)

---

## Step 5: Merge Results and Report

> **Entry:** Step 4 complete — every scanner task reports `wait_semgrep_scans` passed for all approved rulesets and expected JSON/SARIF pairs. An incomplete task blocks success and merging even when other tasks produced results.
> **Exit:** `results.sarif` exists in `$OUTPUT_DIR/results/` and is valid JSON.

**Important-only mode: Post-filter before merge.** Apply the filter from [scan-modes.md](../references/scan-modes.md) ("Filter All Result Files in a Directory" section) to each result JSON in `$OUTPUT_DIR/raw/`. The filter creates `*-important.json` files alongside the originals — the originals are preserved unmodified.

**Generate merged SARIF** using the merge script. The resolved path is in SKILL.md's "Merge command" section — use that exact path:

```bash
uv run {baseDir}/scripts/merge_sarif.py $OUTPUT_DIR/raw $OUTPUT_DIR/results/results.sarif
```

- **Run-all mode:** The script merges all `*.sarif` files from `$OUTPUT_DIR/raw/`.
- **Important-only mode:** Run the post-filter first (creates `*-important.json` in `raw/`), then run the merge script. Raw SARIF files are unaffected by the JSON post-filter, so the merge operates on the unfiltered SARIF. For SARIF-level filtering, apply the jq post-filter from scan-modes.md to `$OUTPUT_DIR/results/results.sarif` after merge.

**Verify merged SARIF is valid:**

```bash
python -c "import json; d=json.load(open('$OUTPUT_DIR/results/results.sarif')); print(f'{sum(len(r.get(\"results\",[]))for r in d.get(\"runs\",[]))} findings in merged SARIF')"
```

If verification fails, the merge script produced invalid output — investigate before reporting.

**Report to user:**

```
## Semgrep Scan Complete

**Scanned:** 1,804 files
**Rulesets used:** 9 (including Trail of Bits)
**Total findings:** 156

### By Severity:
- ERROR: 5
- WARNING: 18
- INFO: 9

### By Category:
- SQL Injection: 3
- XSS: 7
- Hardcoded secrets: 2
- Insecure configuration: 12
- Code quality: 8

Results written to:
- $OUTPUT_DIR/results/results.sarif (merged SARIF)
- $OUTPUT_DIR/raw/ (per-scan raw results, unfiltered)
- $OUTPUT_DIR/rulesets.txt (approved rulesets)
```

**Verify** before reporting: confirm `results.sarif` exists and is valid JSON.
