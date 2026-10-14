import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  analyzeFailureText,
  buildWorkflowPlan,
  classifyRisks,
  extractOperatorItemsFromText,
  providerCommandPattern,
} from "../scripts/productivity-core.mjs";
import { resolveExternalWorkflow, workflowRootCandidates } from "../scripts/external-workflow.mjs";

const workflowScript = path.resolve(process.cwd(), "scripts", "productivity-workflow.mjs");

function runWorkflow(args: string[]) {
  return spawnSync(process.execPath, [workflowScript, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("productivity workflow planning", () => {
  it("classifies UI, retrieval, clinical, and privacy risk from changed paths", () => {
    const risks = classifyRisks([
      "src/components/ClinicalDashboard.tsx",
      "src/lib/retrieval-selection.ts",
      "src/lib/owner-scope.ts",
    ]);

    expect(risks.ui).toBe(true);
    expect(risks.retrieval).toBe(true);
    expect(risks.clinical).toBe(true);
    expect(risks.privacy).toBe(true);
  });

  it("never places provider commands in the executable local plan", () => {
    const plan = buildWorkflowPlan("flightplan", [
      "src/app/api/answer/route.ts",
      "supabase/migrations/20260717000000_example.sql",
    ]);

    expect(plan.localChecks.some((item: { command: string }) => providerCommandPattern.test(item.command))).toBe(false);
    expect(plan.approvalRequired.map((item: { command: string }) => item.command)).toContain(
      "npm run check:supabase-project",
    );
    expect(plan.approvalRequired.map((item: { command: string }) => item.command)).toContain(
      "npm run eval:retrieval:quality",
    );
    expect(providerCommandPattern.test("git push origin feature")).toBe(true);
    expect(providerCommandPattern.test("glab mr merge 123")).toBe(true);
  });

  it("treats answer routes as database-scoped without needing a migration path", () => {
    const files = ["src/app/api/answer/route.ts"];
    const plan = buildWorkflowPlan("flightplan", files);

    expect(classifyRisks(files).database).toBe(true);
    expect(plan.approvalRequired.map((item: { command: string }) => item.command)).toContain(
      "npm run check:supabase-project",
    );
  });

  it.each(["differentials", "eval-cases", "health", "medications", "registry", "setup-status"])(
    "treats the %s API route as database-scoped",
    (route) => {
      const plan = buildWorkflowPlan("flightplan", [`src/app/api/${route}/route.ts`]);

      expect(plan.risks.database).toBe(true);
      expect(plan.approvalRequired.map((item: { command: string }) => item.command)).toContain(
        "npm run check:supabase-project",
      );
    },
  );

  it("preserves database and clinical approval gates in the RAG lab", () => {
    const plan = buildWorkflowPlan("rag-lab", ["src/app/api/answer/route.ts"]);
    const commands = plan.approvalRequired.map((item: { command: string }) => item.command);

    expect(commands).toContain("npm run check:supabase-project");
    expect(commands).toContain("npm run check:production-readiness");
    expect(commands).toContain("npm run eval:retrieval:quality");
  });

  it("keeps the design sweep local and covers the established breakpoint proof", () => {
    const plan = buildWorkflowPlan("design-sweep", ["src/components/ClinicalDashboard.tsx"]);

    expect(plan.approvalRequired).toEqual([]);
    expect(plan.localChecks.map((item: { command: string }) => item.command)).toContain("npm run verify:ui");
    expect(plan.proof.join(" ")).toContain("320, 390, 639, 768, 1440, and 1920");
  });

  it("treats the binding instruction continuation as a workflow change rather than docs-only", () => {
    const plan = buildWorkflowPlan("flightplan", ["PROJECT-INSTRUCTIONS-CONTINUATION.md"]);

    expect(plan.risks).toMatchObject({ workflow: true, docsOnly: false });
  });

  it("treats repository skill instructions as workflow changes rather than docs-only", () => {
    const plan = buildWorkflowPlan("flightplan", [".agents/skills/database-flightplan/SKILL.md"]);

    expect(plan.risks).toMatchObject({ workflow: true, docsOnly: false });
    expect(plan.localChecks.map((item: { command: string }) => item.command)).toContain("npm run verify:pr-local");
  });

  it("routes ordinary handoff through one broad gate and requires decisive proof", () => {
    const plan = buildWorkflowPlan("flightplan", ["src/lib/example.ts"]);

    expect(plan.localChecks.map((item: { command: string }) => item.command)).toEqual(["npm run verify:pr-local"]);
    expect(plan.proof.join(" ")).toContain("decisive output line");
    expect(plan.proof.join(" ")).toContain("Do not stack broad gates");
  });

  it("orders app startup, a focused browser journey, then the PR-local gate for UI flightplans", () => {
    const plan = buildWorkflowPlan("flightplan", ["src/components/SomeComponent.tsx"]);

    const commands = plan.localChecks.map((item: { command: string }) => item.command);
    expect(commands).toEqual(["npm run ensure", "npm run test:e2e:critical", "npm run verify:pr-local"]);
  });

  it("makes concurrent branch and index proof explicit at handoff", () => {
    const plan = buildWorkflowPlan("lifecycle", [], { phase: "handoff" });

    expect(plan.proof.join(" ")).toContain("before staging");
    expect(plan.proof.join(" ")).toContain("foreign index changes");
    expect(plan.proof.join(" ")).toContain("never pipe push output");
  });

  it("rejects unknown lifecycle phases", () => {
    expect(() => buildWorkflowPlan("lifecycle", [], { phase: "publish-everything" })).toThrow(
      "Unknown lifecycle phase",
    );
  });

  it("keeps reconciliation inventory local and gates the remote refresh", () => {
    const plan = buildWorkflowPlan("lifecycle", [], { phase: "reconcile" });

    expect(plan.localChecks.map((item: { command: string }) => item.command)).toEqual([
      "node scripts/reconciliation-preflight.mjs",
      "node scripts/reconciliation-evidence-pack.mjs --output .local/reconciliation-evidence/pack.json",
    ]);
    expect(plan.approvalRequired.map((item: { command: string }) => item.command)).toEqual([
      "git fetch --prune origin",
    ]);
    expect(plan.proof.join(" ")).toContain("never print raw process command lines");
    expect(plan.proof.join(" ")).toContain("evidence pack");
  });

  it("plans a cooperative primary-checkout lease check for start and cleanup", () => {
    for (const phase of ["start", "cleanup"] as const) {
      const plan = buildWorkflowPlan("lifecycle", [], { phase });
      expect(plan.localChecks.map((item: { command: string }) => item.command)).toEqual([
        "node scripts/primary-checkout-lease.mjs --check",
      ]);
      expect(plan.proof.join(" ")).toContain("independent feature worktrees");
    }
  });

  it("classifies common failure signatures", () => {
    expect(analyzeFailureText("Error: Cannot find module 'workflow-status.mjs'").category).toBe("environment");
    expect(analyzeFailureText("OPENAI_API_KEY missing").category).toBe("provider-or-configuration");
    expect(analyzeFailureText("AssertionError: expected 2 received 3").category).toBe("probable-regression");
    expect(analyzeFailureText("TypeError: value is not iterable").category).toBe("probable-regression");
    expect(analyzeFailureText("Error: worker timed out after 300000ms").category).toBe("environment-or-timeout");
  });

  it("does not misclassify a completed answer-quality regression as a timeout from configuration text", () => {
    const completedAnswerQualityRegression = [
      "Running 36 golden retrieval case(s). mode=quality caseTimeoutMs=none",
      "# Retrieval Quality Report",
      "",
      "## Threshold Status",
      "",
      "Blocking failures:",
      "",
      "- RAG source_backed_review_fallback unaccounted: clozapine-monitoring",
      "",
      "Accepted metadata-debt failures:",
      "",
      "- None",
    ].join("\n");

    expect(analyzeFailureText(completedAnswerQualityRegression)).toMatchObject({
      category: "probable-regression",
      confidence: "high",
      reason: "A completed answer-quality evaluation reported blocking threshold failures.",
    });
    expect(analyzeFailureText("Running 36 golden retrieval case(s). mode=quality caseTimeoutMs=none")).toMatchObject({
      category: "unclassified",
    });
    expect(analyzeFailureText("caseTimeoutMs=none").category).toBe("unclassified");
  });

  it("recognizes underscore-delimited and camelCase timeout markers", () => {
    expect(analyzeFailureText("generation_fallback:provider_timeout")).toMatchObject({
      category: "environment-or-timeout",
    });
    expect(analyzeFailureText("model_timeout")).toMatchObject({
      category: "environment-or-timeout",
    });
    expect(analyzeFailureText("TimeoutError")).toMatchObject({
      category: "environment-or-timeout",
    });
  });

  it("distinguishes historical eval-canary provider failures from a completed golden regression", () => {
    const july7OwnerMismatch = [
      "Golden retrieval eval summary:",
      "  cases=36",
      "  retrieval_layer_counts={}",
      "  failed_cases=36",
    ].join("\n");
    const july10ProviderThrottle = "Error: 429 Too Many Requests while creating an embedding";
    const completedGoldenRegression = [
      "Golden retrieval eval summary:",
      "  cases=36",
      '  retrieval_layer_counts={"lexical":72,"hybrid_vector":36}',
      "  failed_cases=3",
    ].join("\n");

    expect(analyzeFailureText(july7OwnerMismatch)).toMatchObject({
      category: "provider-or-configuration",
      confidence: "high",
    });
    expect(analyzeFailureText(july10ProviderThrottle)).toMatchObject({
      category: "provider-or-configuration",
      confidence: "high",
    });
    expect(analyzeFailureText(completedGoldenRegression)).toMatchObject({
      category: "probable-regression",
      confidence: "high",
    });
  });

  it("extracts only actionable operator markers", () => {
    const items = extractOperatorItemsFromText(
      "# Heading\n| Live gate | ⏳ pending | run later |\n- Operator-only: rotate key\n- completed",
      "docs/example.md",
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ source: "docs/example.md", line: 2 });
  });
});

describe("productivity workflow CLI", () => {
  it("rejects option flags where a required value is missing", () => {
    const result = runWorkflow(["flightplan", "--files", "--json"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Missing value for --files");
  });

  it("rejects JSON execution before any local checks can write mixed output", () => {
    const result = runWorkflow(["flightplan", "--files", "docs/example.md", "--json", "--run"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--json cannot be combined with --run");
  });

  it("keeps JSON evidence output parseable and cleans its test artifact", () => {
    const evidenceDirectory = path.join(process.cwd(), ".local", "workflow-evidence");
    const before = new Set(fs.existsSync(evidenceDirectory) ? fs.readdirSync(evidenceDirectory) : []);

    try {
      const result = runWorkflow(["flightplan", "--files", "docs/example.md", "--json", "--write-evidence"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const payload = JSON.parse(result.stdout);
      expect(payload.evidencePath).toMatch(/workflow-evidence/);
      expect(fs.existsSync(payload.evidencePath)).toBe(true);
    } finally {
      if (fs.existsSync(evidenceDirectory)) {
        for (const entry of fs.readdirSync(evidenceDirectory)) {
          if (!before.has(entry)) fs.rmSync(path.join(evidenceDirectory, entry), { force: true });
        }
      }
    }
  });
});

describe("external workflow portability", () => {
  it("derives the shared workflow directory from the Git common directory", () => {
    const root = path.parse(process.cwd()).root;
    const cwd = path.join(root, "tmp", "codex", "worktrees", "1234", "Database");
    const gitCommonDir = path.join(root, "workspace", "Apps", "Database", ".git");
    const candidates = workflowRootCandidates(cwd, gitCommonDir, { NODE_ENV: "test" });
    const expected = path.join(root, "workspace", "Apps", ".local-dev");

    expect(candidates).toContain(path.normalize(expected));
  });

  it("rejects unknown shared workflow names", () => {
    expect(() => resolveExternalWorkflow("unknown", process.cwd(), "", { NODE_ENV: "test" })).toThrow(
      "Unknown external workflow",
    );
  });
});
