import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8").replace(/\r\n/g, "\n");
const workflow = read(".github/workflows/ranking-snapshot-refresh.yml");
const canary = read(".github/workflows/eval-canary.yml");
const freshnessTest = read("tests/ranking-snapshot-provenance.test.ts");

describe("ranking snapshot refresh workflow", () => {
  it("runs after the Eval Canary on main and on manual dispatch", () => {
    expect(workflow).toMatch(/workflow_run:\n\s+workflows: \["Eval Canary"\]\n\s+types: \[completed\]/);
    expect(canary).toMatch(/^name: Eval Canary$/m);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it("names the canary steps exactly as eval-canary.yml does", () => {
    // The pick step matches steps by name. A renamed canary step would make every run
    // look unusable, and the snapshot would silently expire again.
    for (const step of ["Golden retrieval eval (live corpus)", "Validate ranking-config override"]) {
      expect(workflow).toContain(`"${step}"`);
      expect(canary).toContain(`- name: ${step}`);
    }
    expect(canary).toContain("--json-out .local/eval-canary/golden-retrieval.json");
    expect(canary).toContain("name: eval-canary-output");
    expect(workflow).toContain(".local/canary/golden-retrieval.json");
  });

  it("never rebuilds from a run that evaluated staged ranking weights", () => {
    expect(workflow).toContain('override && override.conclusion !== "skipped"');
  });

  it("refreshes well inside the 30-day freshness window", () => {
    expect(freshnessTest).toContain("const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;");
    const days = Number(/REFRESH_AFTER_DAYS: "(\d+)"/.exec(workflow)?.[1]);
    // Weekly canary: the PR lands by day `days + 7`, which must leave time to merge it.
    expect(days + 7).toBeLessThanOrEqual(23);
  });

  it("makes no provider calls and holds no provider secrets", () => {
    expect(workflow).not.toMatch(/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
    expect(workflow).not.toMatch(/eval:retrieval|eval:quality|repository_dispatch/);
  });

  it("opens a reviewed PR with CI running, and never merges or writes main", () => {
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.GH_TOKEN }}");
    expect(workflow).toContain('branch="chore/ranking-snapshot-$RUN_ID"');
    expect(workflow).toContain("gh pr create");
    expect(workflow).toContain("RAG impact: no retrieval behaviour change.");
    expect(workflow).not.toMatch(/gh pr merge|--auto|refs\/heads\/main|contents: write/);
  });
});
