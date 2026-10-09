import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/staging-tenancy.yml", import.meta.url), "utf8");

describe("staging tenancy workflow", () => {
  // The scheduled harness failed every night from at least 2026-09-21 to 2026-09-25 and nobody was
  // told (ledger #TN512M: a red run only sends an unread email). The routing job is the fix, so it
  // is the part worth pinning.
  it("routes a failing main run to a pinned, assigned issue", () => {
    expect(workflow).toContain("tenancy-routing:");
    expect(workflow).toContain("needs: cross-tenant");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('const title = "Staging tenancy isolation check failing"');
    expect(workflow).toContain("issues.create(");
    expect(workflow).toContain("addAssignees(");
  });

  it("finds the existing issue by label so a retitle cannot start a second one", () => {
    expect(workflow).toContain('const label = "staging-tenancy-failure"');
    expect(workflow).toMatch(/listForRepo\(\{[\s\S]*?labels: label,/);
  });

  it("closes the issue on the next green run", () => {
    expect(workflow).toMatch(/if \(result === "success"\)/);
    expect(workflow).toContain('state: "closed"');
  });

  // The harness job holds staging credentials; the issue-writing job must not.
  it("keeps issues: write out of the job that runs the harness", () => {
    const harnessSection = workflow
      .slice(workflow.indexOf("  cross-tenant:"), workflow.indexOf("  tenancy-routing:"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(harnessSection).not.toContain("issues: write");
    expect(harnessSection).toContain("CROSS_TENANT_SERVICE_ROLE_KEY");
    const routingSection = workflow.slice(workflow.indexOf("  tenancy-routing:"));
    expect(routingSection).not.toContain("secrets.");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  // Railway "Wait for CI" skips a deploy when any run on the waiting commit fails, and this
  // scheduled run is red every night until staging tracks main (#057). Scheduled failures must
  // report through the pinned issue without failing the run; dispatched runs stay blocking.
  it("lets a scheduled harness failure report without failing the run", () => {
    expect(workflow).toMatch(/^ {8}id: harness\n {8}continue-on-error: \$\{\{ github\.event_name == 'schedule' \}\}$/m);
    expect(workflow).toContain("harness: ${{ steps.harness.outcome }}");
    // The routing job must read the step outcome, since a continue-on-error step leaves the job
    // result at success and would otherwise close the issue on a failed night.
    expect(workflow).toContain(
      "HARNESS_RESULT: ${{ needs.cross-tenant.result == 'success' && needs.cross-tenant.outputs.harness || needs.cross-tenant.result }}",
    );
    expect(workflow.match(/continue-on-error:/g)).toHaveLength(1);
  });
});
