---
name: semgrep
description: >-
  Run Semgrep static analysis on a codebase with capability-checked workers.
  Supports two scan modes — "run all" (full ruleset coverage) and "important
  only" (high-confidence security vulnerabilities). Records local Semgrep Pro
  evidence and uses the approved engine. Use when asked
  to scan code for vulnerabilities, run a security audit with Semgrep, find
  bugs, or perform static analysis. Uses parallel workers when authorized and
  supported, with bounded direct execution as a fallback.
---

# Semgrep Security Scan

Run a Semgrep scan with local language detection, supported execution tools, and merged SARIF output. Inspect current-host capabilities; this seed does not install a scanner agent or prove hosted tool availability.

## Essential Principles

1. **Always use `--metrics=off`** — Semgrep sends telemetry by default; `--config auto` also phones home. Every `semgrep` command must include `--metrics=off`. This disables telemetry, not registry or provider access; those actions still need authorization.
2. **User must approve the scan plan (Step 3 is a hard gate)** — A generic "scan this codebase" request does not approve an unspecified plan. Present exact rulesets, target, engine, mode and network/provider actions before execution. Preserve existing explicit authorization for that exact plan; ask only for missing authority.
3. **Third-party rulesets are required, not optional** — Trail of Bits, 0xdea, and Decurity rules catch vulnerabilities absent from the official registry. Include them whenever the detected language matches.
4. **Use supported execution capabilities** — When delegation is authorized and workers are available, dispatch independent language tasks together using the bounded scanner prompt. Otherwise execute the same approved tasks directly within current-host limits. Do not invent an agent type, tool or delegation authority.
5. **Record engine evidence honestly** — Inspect only local binary/version/installation metadata before approval. Pro supports cross-file analysis; installed metadata does not prove a usable license. Any Pro, registry or network validation belongs after Step 3 authorization. Stop on an unavailable approved engine; do not silently substitute OSS.

## When to Use

- Security audit of a codebase
- Finding vulnerabilities before code review
- Scanning for known bug patterns
- First-pass static analysis

## When NOT to Use

- Binary analysis → Use binary analysis tools
- Already have Semgrep CI configured → Use existing pipeline
- Need cross-file analysis but no Pro license → Consider CodeQL as alternative
- Creating custom Semgrep rules → Use `semgrep-rule-creator` skill
- Porting existing rules to other languages → Use `semgrep-rule-variant-creator` skill

## Output Directory

All scan results, SARIF files, and temporary data are stored in a single output directory.

- **If the user specifies an output directory** in their prompt, use it as `OUTPUT_DIR`.
- **If not specified**, default to `./static_analysis_semgrep_1`. If that already exists, increment to `_2`, `_3`, etc.

In both cases, **always create the directory** with `mkdir -p` before writing any files.

```bash
# Resolve output directory
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
```

The output directory is resolved **once** at the start of Step 1 and used throughout all subsequent steps.

```
$OUTPUT_DIR/
├── rulesets.txt                 # Approved rulesets (logged after Step 3)
├── raw/                         # Per-scan raw output (unfiltered)
│   ├── python-python.json
│   ├── python-python.sarif
│   ├── python-django.json
│   ├── python-django.sarif
│   └── ...
└── results/                     # Final merged output
    └── results.sarif
```

## Prerequisites

**Required:** Semgrep CLI. Discover it locally with `command -v semgrep` and `SEMGREP_ENABLE_VERSION_CHECK=0 semgrep --metrics=off --version`. If absent, report the missing capability; installation needs applicable authority. See [Semgrep installation docs](https://semgrep.dev/docs/getting-started/).

**Optional:** Semgrep Pro — enables cross-file taint tracking, inter-procedural analysis, and additional languages (Apex, C#, Elixir). Read local installation metadata if available and record Pro as installed, absent or unverified. Do not use a registry ruleset or a Pro/license/network probe as an availability check before approval. Pro usability is established only by authorized execution; a failed probe is not evidence of OSS-only availability.

**Limitations:** OSS mode cannot track data flow across files. Pro mode uses `-j 1` for cross-file analysis (slower per ruleset, but parallel rulesets compensate).
The bundled scan-status helper requires a supported Bash shell and local Python 3 to validate each fresh JSON/SARIF pair. Check these local capabilities before execution; missing tooling does not authorize installation.

## Scan Modes

Select mode in Step 2 of the workflow. Mode affects both scanner flags and post-processing.

| Mode | Coverage | Findings Reported |
|------|----------|-------------------|
| **Run all** | All rulesets, all severity levels | Everything |
| **Important only** | All rulesets, pre- and post-filtered | Security vulns only, medium-high confidence/impact |

**Important only** applies two filter layers:
1. **Pre-filter**: `--severity MEDIUM --severity HIGH --severity CRITICAL` (CLI flag)
2. **Post-filter**: JSON metadata — keeps only `category=security`, `confidence∈{MEDIUM,HIGH}`, `impact∈{MEDIUM,HIGH}`

See [scan-modes.md](references/scan-modes.md) for metadata criteria and jq filter commands.

## Orchestration Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ MAIN AGENT (this skill)                                          │
│ Step 1: Detect languages + inspect local engine evidence        │
│ Step 2: Select scan mode + rulesets (ref: rulesets.md)           │
│ Step 3: Present plan + rulesets, get approval [⛔ HARD GATE]     │
│ Step 4: Execute approved scans via workers or directly          │
│ Step 5: Merge results and report                                 │
└──────────────────────────────────────────────────────────────────┘
         │ Step 4
         ▼
┌─────────────────┐
│ Scan Tasks      │
│ (parallel)      │
├─────────────────┤
│ Python scanner  │
│ JS/TS scanner   │
│ Go scanner      │
│ Docker scanner  │
└─────────────────┘
```

## Workflow

**Follow the detailed workflow in [scan-workflow.md](workflows/scan-workflow.md).** Summary:

| Step | Action | Gate | Key Reference |
|------|--------|------|---------------|
| 1 | Resolve output dir, detect languages + local engine evidence | Local only | Supported file search and local metadata |
| 2 | Select scan mode + rulesets | — | [rulesets.md](references/rulesets.md) |
| 3 | Present plan, get explicit approval | ⛔ HARD | Supported user-input tool or ordinary chat |
| 4 | Execute approved scans via supported workers or directly | Approved actions only | [scanner-task-prompt.md](references/scanner-task-prompt.md) |
| 5 | Merge results and report | — | Merge script (below) |

**Task tracking:** Use the host's supported task tracker for the five ordered steps when available, with each step depending on the previous. Otherwise keep a short checklist. Step 3 is a HARD GATE regardless of tracking tools; mark it complete only with explicit authorization for the exact plan.

**Merge command (Step 5):**

```bash
uv run {baseDir}/scripts/merge_sarif.py $OUTPUT_DIR/raw $OUTPUT_DIR/results/results.sarif
```

## Execution capability

Use an available general-purpose worker with shell/file access and the bounded [scanner task prompt](references/scanner-task-prompt.md) when delegation is authorized. A specialist scanner is optional only when the current host actually exposes it; the repository bundles no exact scanner-agent dependency. If workers are unavailable or delegation is not authorized, use direct execution of the same approved task with bounded concurrency. Report the execution path actually used.

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "User asked for scan, that's approval" | A generic scan request does not specify a plan. Obtain missing exact-plan authority; preserve an existing explicit approval |
| "Step 3 task is blocking, just mark complete" | Lying about task status defeats enforcement. Only mark complete after real approval |
| "I already know what they want" | Assumptions cause scanning wrong directories/rulesets. Present plan for verification |
| "Just use default rulesets" | User must see and approve exact rulesets before scan |
| "Add extra rulesets without asking" | Modifying approved list without consent breaks trust |
| "Third-party rulesets are optional" | Trail of Bits, 0xdea, Decurity catch vulnerabilities not in official registry — REQUIRED |
| "Use --config auto" | Sends metrics; less control over rulesets |
| "A missing scanner agent blocks every scan" | Use a supported general worker when authorized, or execute the bounded approved tasks directly |
| "Change the engine without asking" | Pro and OSS have different coverage; preserve the approved engine or obtain a changed plan |
| "Semgrep handles GitHub URLs natively" | URL handling fails on repos with non-standard YAML; always clone first |
| "Cleanup is optional" | Cloned repos pollute the user's workspace and accumulate across runs |
| "Use `.` or relative path as target" | Subagents need absolute paths to avoid ambiguity |
| "Let the user pick an output dir later" | Output directory must be resolved at Step 1, before any files are created |

## Reference Index

| File | Content |
|------|---------|
| [rulesets.md](references/rulesets.md) | Complete ruleset catalog and selection algorithm |
| [scan-modes.md](references/scan-modes.md) | Pre/post-filter criteria and jq commands |
| [scanner-task-prompt.md](references/scanner-task-prompt.md) | Template for spawning scanner subagents |

| Workflow | Purpose |
|----------|---------|
| [scan-workflow.md](workflows/scan-workflow.md) | Complete 5-step scan execution process |

## Success Criteria

- [ ] Output directory resolved (user-specified or auto-incremented default)
- [ ] All generated files stored inside `$OUTPUT_DIR`
- [ ] Languages detected with file counts; local engine evidence and Pro uncertainty recorded
- [ ] Scan mode selected by user (run all / important only)
- [ ] Rulesets include third-party rules for all detected languages
- [ ] User explicitly approved the scan plan (Step 3 gate passed)
- [ ] Approved scans completed via supported authorized workers or bounded direct execution
- [ ] Every approved scan's PID/status and fresh JSON/SARIF pair passed `wait_semgrep_scans`; no incomplete batch or successful subset is reported as complete
- [ ] Every `semgrep` command used `--metrics=off`
- [ ] Approved rulesets logged to `$OUTPUT_DIR/rulesets.txt`
- [ ] Raw per-scan outputs stored in `$OUTPUT_DIR/raw/`
- [ ] `results.sarif` exists in `$OUTPUT_DIR/results/` and is valid JSON
- [ ] Important-only mode: post-filter applied before merge; unfiltered results preserved in `raw/`
- [ ] Results summary reported with severity and category breakdown
- [ ] Cloned repos (if any) cleaned up from `$OUTPUT_DIR/repos/`
