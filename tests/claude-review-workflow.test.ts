import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { yamlBlock } from "../scripts/yaml-contract.mjs";

const WORKFLOW = path.join(process.cwd(), ".github/workflows/claude-review.yml");

/**
 * Mimic the YAML 1.1 plain-scalar rule that truncates at an unquoted `#`
 * (the failure mode measured on Claude review after #2981).
 */
function truncatePlainScalarAtHash(line: string): string {
  const hash = line.search(/(^|[^'])#/);
  if (hash < 0) return line;
  return line.slice(0, hash).trimEnd();
}

describe("Claude review workflow", () => {
  it("keeps #NNAWDT inside a block-scalar report-step run script", () => {
    const raw = readFileSync(WORKFLOW, "utf8");
    const report = yamlBlock(raw, "- name: Report a review that could not run", 6);
    expect(report, "missing report step").toContain("Report a review that could not run");
    expect(report).toMatch(/^\s+run:\s*\|\s*$/m);
    expect(report).toContain("#NNAWDT");
    expect(report).toMatch(/echo "::warning title=Claude review::/);
  });

  it("documents the inline-run YAML comment trap that painted red after #2981", () => {
    const truncated = truncatePlainScalarAtHash('run: echo "Tracked as #NNAWDT."');
    expect(truncated).toBe('run: echo "Tracked as');
    expect(truncated).not.toContain("#NNAWDT");
    expect(truncated.endsWith('"')).toBe(false);
  });

  it("keeps continue-on-error on the review step only, not the job", () => {
    const raw = readFileSync(WORKFLOW, "utf8");
    const job = yamlBlock(raw, "review:", 2);
    expect(job.split(/\r?\n/)[0]).toBe("  review:");
    expect(job).not.toMatch(/^ {4}continue-on-error:\s*true\s*$/m);
    const review = yamlBlock(job, "- name: Review the pull request", 6);
    expect(review).toContain("continue-on-error: true");
  });

  it("names the reason a review failed from the saved transcript without printing the transcript", () => {
    const raw = readFileSync(WORKFLOW, "utf8");
    const report = yamlBlock(raw, "- name: Report a review that could not run", 6);
    // Reads the action's own saved output, passed through env rather than
    // interpolated into the script.
    expect(report).toContain("EXECUTION_FILE: ${{ steps.review.outputs.execution_file }}");
    const script = report.slice(report.search(/^\s+run:\s*\|/m));
    expect(script).not.toContain("${{ steps.review.outputs.execution_file }}");
    // Anything long enough to be a credential is replaced before printing,
    // and the printed reason is capped.
    expect(report).toContain("[redacted]");
    expect(report).toContain("cut -c1-300");
    // The whole-transcript remedy stays off in a public repository.
    expect(raw).not.toMatch(/^\s*show_full_output:\s*true/m);
  });

  it("disables project MCP servers via settings and claude_args override (#V1NYQ0)", () => {
    const raw = readFileSync(WORKFLOW, "utf8");
    const review = yamlBlock(raw, "- name: Review the pull request", 6);
    expect(review).toContain("settings: '{\"enableAllProjectMcpServers\": false}'");
    expect(review).toMatch(
      /claude_args:\s*['"]?--settings\s*'{1,2}\{"enableAllProjectMcpServers":\s*false\}'{1,2}['"]?/,
    );
  });
});
