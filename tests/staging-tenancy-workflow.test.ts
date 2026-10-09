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
});
