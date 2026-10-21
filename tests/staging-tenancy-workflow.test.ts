import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
    expect(workflow).toMatch(
      /^ {8}id: harness\n {8}if: \$\{\{ steps\.resolve\.outcome == 'success' && steps\.resolve\.outputs\.relation != 'superseded' \}\}\n {8}continue-on-error: \$\{\{ github\.event_name == 'schedule' \}\}$/m,
    );
    expect(workflow).toContain("harness: ${{ steps.harness.outcome }}");
    // The routing job must read the step outcome, since a continue-on-error step leaves the job
    // result at success and would otherwise close the issue on a failed night.
    expect(workflow).toContain(
      "HARNESS_RESULT: ${{ needs.cross-tenant.result == 'success' && needs.cross-tenant.outputs.harness || needs.cross-tenant.result }}",
    );
    // Two soft steps on the schedule only: the version check and the harness itself.
    expect(workflow.match(/^ {8}continue-on-error:/gm)).toHaveLength(2);
    expect(workflow.match(/continue-on-error: \$\{\{ github\.event_name == 'schedule' \}\}/g)).toHaveLength(2);
  });

  // A hung scheduled harness must die as a failed step (continue-on-error), not a job cancel.
  it("caps a scheduled harness below the job timeout so a hang stays a soft step failure", () => {
    expect(workflow).toMatch(/timeout-minutes:\s*60/);
    expect(workflow).toContain("timeout 15m npm run test:cross-tenant:staging");
  });

  // timeout 15m can SIGTERM before writeEvidence; missing evidence must not re-fail the schedule.
  it("warns on missing evidence when nothing ran, and stays strict on dispatch", () => {
    expect(workflow).toContain(
      "if-no-files-found: ${{ github.event_name == 'workflow_dispatch' && 'error' || 'warn' }}",
    );
  });

  // #3113: an exact main-HEAD rule never passed on a schedule, so nothing was ever tested. The
  // resolver decides what may be proven before the harness touches staging.
  // A dispatched release proof that meets a newer staging commit failed; only a passing resolve is benign.
  it("treats a superseded staging commit as harmless only when the resolve step passed", () => {
    expect(workflow).toContain('elif [ "$RESOLVE" = "success" ] && [ "$RELATION" = "superseded" ]; then');
    expect(workflow).toContain(
      'if (process.env.RELATION === "superseded" && process.env.RESOLVE_RESULT === "success") {',
    );
  });

  it("resolves the staging deployment before the harness, strict only on dispatch", () => {
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("id: resolve");
    expect(workflow).toContain(
      "if: ${{ steps.resolve.outcome == 'success' && steps.resolve.outputs.relation != 'superseded' }}",
    );
    expect(workflow).toContain(
      "push) node scripts/resolve-staging-deployment.mjs --allow-equivalent --wait-seconds 1800 ;;",
    );
    expect(workflow).toContain(
      "schedule) node scripts/resolve-staging-deployment.mjs --allow-equivalent --wait-seconds 900 ;;",
    );
    expect(workflow).toContain("*) node scripts/resolve-staging-deployment.mjs ;;");
    expect(workflow).toContain("CROSS_TENANT_EXPECTED_DEPLOYED_SHA: ${{ steps.resolve.outputs.deployed_sha }}");
    expect(workflow).toContain("CROSS_TENANT_DEPLOYMENT_RELATION: ${{ steps.resolve.outputs.relation }}");
  });

  it("says plainly on every run whether separation was proven", () => {
    expect(workflow).toContain("Two-user separation PROVEN on staging");
    expect(workflow).toContain("Two-user separation NOT proven");
    expect(workflow).toContain("::warning title=Separation NOT proven::");
  });

  // The staging gate runs on exactly the pushes that redeploy the app, so the two lists must agree.
  it("gates every main push that would redeploy the app, and no other", () => {
    const parsed = createRequire(import.meta.url)("js-yaml").load(workflow) as {
      on: { push: { branches: string[]; paths: string[] } };
    };
    const railway = JSON.parse(readFileSync(new URL("../railway.app.json", import.meta.url), "utf8")) as {
      build: { watchPatterns: string[] };
    };
    expect(parsed.on.push.branches).toEqual(["main"]);
    expect(parsed.on.push.paths).toEqual(
      railway.build.watchPatterns.map((pattern) => pattern.replace(/^(!?)\//, "$1")),
    );
  });

  // Railway Wait for CI is ON for the live services, so a failing gate skips a live deploy. The gate
  // must stay inert until the owner switches it on, and an inert push must not touch the issue.
  it("starts nothing on a push until STAGING_GATE_ENFORCE is switched on", () => {
    expect(workflow).toContain("if: ${{ github.event_name != 'push' || vars.STAGING_GATE_ENFORCE == 'true' }}");
    expect(workflow).toContain(
      "if: ${{ !cancelled() && github.ref == 'refs/heads/main' && needs.cross-tenant.result != 'skipped' }}",
    );
  });

  it("does not re-mention the owner for every failing merge while staging is down", () => {
    expect(workflow).toMatch(/if \(context\.eventName === "push"\) \{[\s\S]*?return;/);
  });
});
