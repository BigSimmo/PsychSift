import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROVIDER_COMMAND_PATTERN =
  /(?:check:supabase-project|check:production-readiness|verify:release(?:\s|$)|eval:retrieval:quality|eval:rag(?:\s|$)|eval:quality(?:\s|$)|git\s+(?:fetch|ls-remote|pull|push)(?:\s|$)|gh\s|glab\s|railway\s|supabase\s)/i;

const RISK_PATTERNS = {
  ui: [
    /^src\/app\/(?!api\/)/,
    "src/components",
    "src/styles",
    "public",
    /^tests\/ui-.*\.spec\.ts$/,
    /^playwright.*\.ts$/,
  ],
  database: [
    "supabase",
    "src/lib/supabase",
    /^src\/app\/api\/(?:answer|differentials|documents|eval-cases|health|images|ingestion|jobs|medications|registry|search|setup-status|upload)/,
  ],
  retrieval: [
    /^src\/lib\/(?:rag|retrieval|ranking|clinical-search|smart-rag|citations|evidence|source|chunking)/,
    /^src\/app\/api\/(?:answer|search)/,
    /^scripts\/(?:eval-|compare-retrieval|retrieval-|profile-retrieval|tune-search)/,
    /^tests\/(?:rag|retrieval|answer|citation|evidence|source|clinical-safety)/,
  ],
  clinical: [
    /^src\/app\/api\/(?:answer|differentials|documents|ingestion|medications|registry|search)/,
    /^src\/lib\/(?:rag|retrieval|clinical|answer|citation|evidence|source|owner-scope|query-privacy)/,
    /^supabase\//,
    /^docs\/(?:clinical-governance|privacy-impact|samd-|source-governance)/,
  ],
  privacy: [
    /(?:auth|permission|privacy|private|owner-scope|query-privacy|rls|security)/i,
    /^src\/app\/api\/(?:documents|images|upload)/,
  ],
  deployment: [
    "Dockerfile",
    "Dockerfile.worker",
    "railway.app.json",
    "railway.worker.json",
    ".github/workflows",
    "next.config.ts",
  ],
  dependency: ["package.json", "package-lock.json", ".npmrc"],
  workflow: [
    "AGENTS.md",
    // The rules AGENTS.md used to carry inline now live in docs/agents/**; they
    // stay workflow-scoped rather than dropping to docs-only.
    "docs/agents",
    ".agents/skills",
    ".claude/skills",
    "scripts/productivity-core.mjs",
    "scripts/productivity-workflow.mjs",
    "scripts/external-workflow.mjs",
  ],
};

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

function matches(file, pattern) {
  if (typeof pattern === "string") return file === pattern || file.startsWith(`${pattern}/`);
  return pattern.test(file);
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function check(command, reason) {
  return { command, reason };
}

export function normalizeFiles(files = []) {
  return [...new Set(files.map(normalizePath).filter(Boolean))].sort();
}

export function classifyRisks(files = []) {
  const normalized = normalizeFiles(files);
  const risks = Object.fromEntries(
    Object.entries(RISK_PATTERNS).map(([name, patterns]) => [
      name,
      normalized.some((file) => patterns.some((pattern) => matches(file, pattern))),
    ]),
  );
  risks.docsOnly =
    normalized.length > 0 && normalized.every((file) => /(?:^docs\/|\.mdx?$)/i.test(file)) && !risks.workflow;
  return risks;
}

function baseLocalChecks(risks) {
  if (risks.docsOnly) {
    return [
      check("npm run format:check", "Confirm repository formatting."),
      check("npm run docs:check-links", "Validate documentation links."),
      check("npm run docs:check-scripts", "Validate documented package commands."),
    ];
  }

  if (risks.ui) {
    return [
      check("npm run ensure", "Start the verified app and use the printed URL before any browser check."),
      check("npm run test:e2e:critical", "Exercise the focused critical UI journeys in Chromium."),
      check(
        "npm run verify:pr-local",
        "Run the single fail-closed, risk-routed PR gate after browser proof; add --extended only when shared UI foundations require the full Chromium matrix.",
      ),
    ];
  }

  return [
    check(
      "npm run verify:pr-local",
      "Run the single fail-closed, risk-routed PR gate; inspect its dry-run when scope is uncertain.",
    ),
  ];
}

function approvalChecks(risks) {
  const approvals = [];
  if (risks.database) {
    approvals.push(
      check("npm run check:supabase-project", "Confirm the live Supabase target after explicit approval."),
    );
  }
  if (risks.retrieval) {
    approvals.push(
      check(
        "npm run eval:retrieval:quality",
        "Run the live 36-case golden retrieval evaluation after explicit approval.",
      ),
    );
  }
  if (risks.clinical) {
    approvals.push(
      check(
        "npm run check:production-readiness",
        "Run the production/provider readiness gate after explicit approval.",
      ),
    );
  }
  if (risks.retrieval && risks.clinical) {
    approvals.push(check("npm run eval:rag -- --limit 15", "Sample live answer generation after explicit approval."));
    approvals.push(
      check("npm run eval:quality -- --rag-only", "Check live grounded-answer invariants after explicit approval."),
    );
  }
  if (risks.deployment) {
    approvals.push(
      check("npm run verify:release", "Run the complete release gate only after confirming its provider effects."),
    );
  }
  return approvals;
}

function workflowSummary(workflow) {
  return {
    flightplan: "Risk-scoped change and verification plan",
    triage: "Focused failure diagnosis and repair loop",
    "clinical-proof": "Clinical governance and evidence plan",
    "design-sweep": "Live route, responsive, and accessibility sweep",
    "rag-lab": "Offline-first retrieval and answer validation lab",
    "operator-closeout": "Approval-gated operator backlog batch",
    lifecycle: "Safe task start, handoff, merge-proof, and cleanup lifecycle",
  }[workflow];
}

export function buildWorkflowPlan(workflow, files = [], options = {}) {
  const normalized = normalizeFiles(files);
  const risks = classifyRisks(normalized);
  let localChecks = baseLocalChecks(risks);
  let approvalRequired = approvalChecks(risks);
  const proof = [
    "Record exact commands, exit codes, and the decisive output line; exit 0 alone is not proof.",
    "Preserve unrelated staged, unstaged, and untracked work.",
    "Do not stack broad gates unless each covers a distinct plausible failure class.",
  ];

  if (workflow === "triage") {
    localChecks = [];
    proof.push(
      "Reproduce the smallest failing target before changing code.",
      "Rerun that target after each fix before widening verification.",
    );
  } else if (workflow === "clinical-proof") {
    localChecks = uniqueBy(
      [check("npm run eval:rag:offline", "Prove the code-backed offline clinical contract."), ...localChecks],
      "command",
    );
    proof.push(
      "Complete the Clinical Governance Preflight in .github/pull_request_template.md.",
      "Document source, privacy, owner-scope, rollback, and SaMD implications.",
    );
  } else if (workflow === "design-sweep") {
    localChecks = [
      check("npm run ensure", "Start the verified app and use the printed URL."),
      check("npm run test:e2e:critical", "Prove primary flows before the broad sweep."),
      check("npm run test:e2e:accessibility", "Run the focused accessibility gate."),
      check("npm run verify:ui", "Run the full local Chromium matrix."),
      check("npm run verify:cheap", "Verify source changes after UI fixes."),
    ];
    approvalRequired = [];
    proof.push(
      "Cover 320, 390, 639, 768, 1440, and 1920 px.",
      "Check overflow, scroll ownership, keyboard use, focus, reduced motion, and forced colors.",
    );
  } else if (workflow === "rag-lab") {
    localChecks = [
      check(
        "npm run test -- tests/retrieval-selection.test.ts tests/rag-routing.test.ts tests/rag-offline-contract.test.ts",
        "Run focused retrieval and answer contract tests.",
      ),
      check("npm run eval:rag:offline", "Run the provider-free golden RAG preflight."),
      check("npm run verify:cheap", "Catch cross-cutting lint, typecheck, and unit regressions."),
    ];
    approvalRequired = uniqueBy(
      [
        ...approvalRequired,
        check("npm run eval:retrieval:quality", "Require 36/36 against the live corpus after explicit approval."),
        check("npm run eval:rag -- --limit 15", "Sample live answer generation after explicit approval."),
        check("npm run eval:quality -- --rag-only", "Compare grounded-answer invariants after explicit approval."),
      ],
      "command",
    );
    proof.push(
      "Compare recall, MRR, grounded support, citation failure, and numeric-grounding failure with the accepted baseline.",
    );
  } else if (workflow === "operator-closeout") {
    localChecks = [];
    approvalRequired = [];
    proof.push(
      "Deduplicate stale or already-completed actions before requesting approval.",
      "Capture pre-state, command, post-state, and rollback evidence for every approved action.",
    );
  } else if (workflow === "lifecycle") {
    const phase = options.phase || "status";
    if (!new Set(["status", "start", "reconcile", "handoff", "landed", "cleanup"]).has(phase)) {
      throw new Error(`Unknown lifecycle phase: ${phase}`);
    }
    localChecks =
      phase === "handoff"
        ? [check("npm run verify:pr-local", "Complete the local handoff gate.")]
        : phase === "reconcile"
          ? [
              check(
                "node scripts/reconciliation-preflight.mjs",
                "Inventory cached base, primary checkout, worktrees, dirty state, and Git operations without fetching.",
              ),
              check(
                "node scripts/reconciliation-evidence-pack.mjs --output .local/reconciliation-evidence/pack.json",
                "Write one deterministic secret-safe local evidence pack without fetching or deleting.",
              ),
            ]
          : phase === "start" || phase === "cleanup"
            ? [
                check(
                  "node scripts/primary-checkout-lease.mjs --check",
                  "Refuse primary checkout writes/switches/sync while another owner or dirty/operation state exists.",
                ),
              ]
            : [];
    approvalRequired =
      phase === "handoff"
        ? [
            check("git push -u origin <feature-branch>", "Publishing requires explicit user authorization."),
            check("gh pr create --base main", "GitHub interaction requires explicit user authorization."),
          ]
        : phase === "landed"
          ? [
              check(
                "gh pr view <pr> --json state,mergeCommit,mergedAt",
                "GitHub interaction requires explicit user authorization.",
              ),
            ]
          : phase === "reconcile"
            ? [check("git fetch --prune origin", "Refresh remote truth only after explicit GitHub authorization.")]
            : [];
    proof.push(
      "Verify branch and worktree state at every transition.",
      "Use content equality for squash-merge proof before cleanup.",
    );
    if (phase === "start" || phase === "cleanup") {
      proof.push(
        "Keep read-only commands and independent feature worktrees unblocked; only primary writes need the cooperative lease.",
      );
    }
    if (phase === "handoff") {
      proof.push(
        "Record branch and HEAD before staging, immediately before commit, and after commit; stop on unexpected movement or foreign index changes.",
        "Verify the commit message and exact path list are yours before push; never pipe push output through a status-masking command.",
      );
    }
    if (phase === "reconcile") {
      proof.push(
        "Use a dedicated clean integration worktree; never integrate from a dirty primary checkout.",
        "Filter candidates by ownership, open PRs, ledger, and ancestry before expensive patch comparison.",
        "Preserve unmerged content before cleanup and never print raw process command lines.",
        "Record dispositions, operation markers, archive refs, bundle verification, and local/base equality in the evidence pack.",
      );
    }
  }

  if (localChecks.some((item) => PROVIDER_COMMAND_PATTERN.test(item.command))) {
    throw new Error(`Unsafe workflow definition: ${workflow} placed a provider-backed command in localChecks.`);
  }

  return {
    workflow,
    summary: workflowSummary(workflow),
    files: normalized,
    risks,
    localChecks: uniqueBy(localChecks, "command"),
    approvalRequired: uniqueBy(approvalRequired, "command"),
    proof,
  };
}

export function analyzeFailureText(text = "", knownFlakes = []) {
  const value = String(text);
  const lower = value.toLowerCase();
  const goldenCaseCount = Number.parseInt(lower.match(/(?:^|\n)\s*cases=(\d+)/)?.[1] ?? "", 10);
  const goldenFailureCount = Number.parseInt(lower.match(/(?:^|\n)\s*failed_cases=(\d+)/)?.[1] ?? "", 10);
  const retrievalLayers = lower.match(/(?:^|\n)\s*retrieval_layer_counts=(\{[^\n]*\})/)?.[1];
  const answerQualityBlockingSection = lower
    .match(
      /(?:^|\n)blocking failures:\s*\n([\s\S]*?)(?=\naccepted metadata-debt failures:|\nall threshold failures:|$)/,
    )?.[1]
    ?.trim();
  const knownFlake = knownFlakes.find((entry) => entry.pattern && lower.includes(String(entry.pattern).toLowerCase()));
  if (knownFlake) return { category: "known-flake", confidence: "high", reason: knownFlake.id || knownFlake.pattern };
  if (/module_not_found|cannot find module|enoent|not recognized as an internal|command not found/.test(lower)) {
    return { category: "environment", confidence: "high", reason: "Missing executable, module, or path." };
  }
  if (
    Number.isInteger(goldenCaseCount) &&
    goldenCaseCount > 0 &&
    goldenFailureCount === goldenCaseCount &&
    retrievalLayers === "{}"
  ) {
    return {
      category: "provider-or-configuration",
      confidence: "high",
      reason:
        "Every golden case failed without any retrieval layer; verify eval owner, corpus scope, and live retrieval health.",
    };
  }
  if (
    /missing.*(?:api[_ -]?key|secret|credential)|(?:api[_ -]?key|secret|credential)\s+(?:is\s+)?missing|unauthorized|forbidden|unregistered api key|insufficient[_ -]?quota|quota|billing|\b429\b|rate[_ -]?limit|too many requests|supabase project/.test(
      lower,
    )
  ) {
    return {
      category: "provider-or-configuration",
      confidence: "high",
      reason: "Credentials, authorization, quota, or live-provider configuration.",
    };
  }
  if (Number.isInteger(goldenFailureCount) && goldenFailureCount > 0) {
    return {
      category: "probable-regression",
      confidence: "high",
      reason: `A completed golden evaluation reported ${goldenFailureCount} failed case(s).`,
    };
  }
  if (answerQualityBlockingSection && !/^(?:-\s*)?none[.!]?$/.test(answerQualityBlockingSection)) {
    return {
      category: "probable-regression",
      confidence: "high",
      reason: "A completed answer-quality evaluation reported blocking threshold failures.",
    };
  }
  // Match timeout as an identifier token (provider_timeout, model_timeout, TimeoutError)
  // without treating camelCase config names like caseTimeoutMs=none as timeouts (#628).
  if (
    /(?:^|[^a-z0-9])(?:timed?\s*out|etimedout)(?:[^a-z0-9]|$)|(?:^|[^a-z])timeout(?:error)?(?:[^a-z]|$)|browser has been closed|worker.*exited/.test(
      lower,
    )
  ) {
    return {
      category: "environment-or-timeout",
      confidence: "medium",
      reason: "Timeout or runtime process failure; inspect active processes and artifacts.",
    };
  }
  if (/assertionerror|expected .* received|tests? failed|type ?error|eslint.*error|syntaxerror/.test(lower)) {
    return {
      category: "probable-regression",
      confidence: "medium",
      reason: "A deterministic code or test assertion failed.",
    };
  }
  return {
    category: "unclassified",
    confidence: "low",
    reason: "Reproduce the smallest target and capture its complete error output.",
  };
}

export function extractOperatorItemsFromText(text, source = "unknown") {
  return String(text)
    .split(/\r?\n/)
    .map((line, index) => ({ source, line: index + 1, text: line.trim() }))
    .filter(({ text: line }) =>
      /(?:⏳\s*pending|operator[- ]only|operator follow-up|confirmation-required|remaining operator items)/i.test(line),
    )
    .filter(({ text: line }) => !/^#/.test(line));
}

export function scanOperatorBacklog(repoRoot = process.cwd()) {
  const sources = ["docs/operator-backlog.md", "docs/process-hardening.md"];
  const items = sources.flatMap((source) => {
    const absolute = path.join(repoRoot, source);
    return fs.existsSync(absolute) ? extractOperatorItemsFromText(fs.readFileSync(absolute, "utf8"), source) : [];
  });
  return uniqueBy(items, "text");
}

export function readChangeScope(files, repoRoot = process.cwd()) {
  const args = ["scripts/ci-change-scope.mjs", "--json"];
  if (files?.length) args.push("--files", normalizeFiles(files).join(","));
  const output = execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output);
}

export function runLocalChecks(checks, repoRoot = process.cwd()) {
  for (const item of checks) {
    console.log(`\n[workflow] ${item.command}`);
    const result =
      process.platform === "win32"
        ? spawnSync("cmd.exe", ["/d", "/s", "/c", item.command], { cwd: repoRoot, stdio: "inherit", windowsHide: true })
        : spawnSync("sh", ["-lc", item.command], { cwd: repoRoot, stdio: "inherit" });
    if (result.status !== 0) return { status: result.status ?? 1, failed: item.command };
  }
  return { status: 0 };
}

export function writeWorkflowEvidence(plan, repoRoot = process.cwd()) {
  const directory = path.join(repoRoot, ".local", "workflow-evidence");
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(directory, `${timestamp}-${plan.workflow}.json`);
  fs.writeFileSync(target, `${JSON.stringify({ ...plan, createdAt: new Date().toISOString() }, null, 2)}\n`);
  return target;
}

export const providerCommandPattern = PROVIDER_COMMAND_PATTERN;
