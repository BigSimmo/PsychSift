import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/live-domain-monitor.yml", import.meta.url), "utf8");

describe("live domain monitor workflow", () => {
  it("accepts descriptive server-rendered titles that retain the PsychSift brand", () => {
    expect(workflow).toContain("grep -Eq '<title>[^<]*PsychSift[^<]*</title>'");
  });

  // Every probe in this workflow was green throughout the seven-day search outage, because all of
  // them measured status codes and a search returning nothing is a 200. The step that asserts
  // results must not be quietly dropped, and it needs its script on disk to run at all.
  it("asserts live search results, not just status codes", () => {
    expect(workflow).toContain("run: node scripts/check-live-search-results.mjs");
    // The sparse checkout is what puts it on disk; listing only its sibling would fail at runtime.
    expect(workflow).toMatch(/sparse-checkout: \|\n(?:\s+scripts\/\S+\n)*\s+scripts\/check-live-search-results\.mjs\n/);
  });

  // The freshness check reads the app service's watch patterns so a gap of docs-only merges, which
  // Railway rightly never deploys, is not reported as a stranded deploy (#3685).
  it("puts the app service's Railway config on disk for the deployment freshness check", () => {
    expect(workflow).toMatch(/sparse-checkout: \|\n(?:\s+\S+\n)*\s+railway\.app\.json\n/);
  });

  /**
   * DELIVERY, NOT DETECTION. This workflow's header used to say "a red run is the alert", and that
   * was true only if a red run reached somebody. Measured 2026-09-18: it failed on every one of
   * eight consecutive scheduled runs from 2026-09-16T18:34 to 2026-09-18T12:40, correctly
   * reporting that Forms, Services and Medications were serving the in-bundle catalogue on the
   * live site, and nobody acted for 42 hours — the owner confirmed the failure emails arrive and
   * are not read (ledger #TN512M). The routing job below is the whole fix, so it is the part most
   * worth pinning: a probe nobody hears from is the state this returns to if it is removed.
   */
  it("routes a failing run to a pinned issue, which is the only delivery path it has", () => {
    expect(workflow).toContain("monitor-routing:");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain('const title = "Live domain monitor failing"');
    expect(workflow).toContain("issues.create(");
  });

  // Found by label, not by title alone: a human retitling the issue must not orphan it and start a
  // second thread that nobody recognises as the same alarm.
  it("finds the existing issue by label so a retitle cannot start a second thread", () => {
    expect(workflow).toContain('const label = "live-monitor-failure"');
    expect(workflow).toMatch(/listForRepo\(\{[\s\S]*?labels: label,/);
  });

  /**
   * An alert that never clears becomes wallpaper, which is the failure mode this exists to end.
   * A green run must close the issue, so an open issue always means the live site is degraded now.
   */
  it("closes the issue on the next green run", () => {
    expect(workflow).toMatch(/if \(result === "success"\)/);
    expect(workflow).toContain('state: "closed"');
  });

  /**
   * `issues: write` must stay scoped to a job that never executes repository code. The probe job
   * runs curl against a public domain and keeps `contents: read`, matching live-drift.yml.
   */
  it("keeps issues: write out of the job that probes the live domain", () => {
    // Comment lines are stripped first: the prose above monitor-routing explains the scoping and
    // so contains the literal "issues: write", which a raw text slice reads as the grant itself.
    const probeSection = workflow
      .slice(workflow.indexOf("  probe:"), workflow.indexOf("  monitor-routing:"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(probeSection).not.toContain("issues: write");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  // The issue is useless if it only says "something failed". Each probe carries a stable id so the
  // routing job can name the ones that broke without parsing logs.
  it("names which probes failed rather than only that the run was red", () => {
    for (const id of ["root_shell", "health", "routes", "www_tls", "deployment_freshness", "catalogue_search"]) {
      expect(workflow).toContain(`id: ${id}`);
    }
    expect(workflow).toContain("findings: ${{ steps.findings.outputs.findings }}");
  });
});
