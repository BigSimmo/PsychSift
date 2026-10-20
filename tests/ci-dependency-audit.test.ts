import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { auditVerdict, runDependencyAudit } from "../scripts/ci-dependency-audit.mjs";

function report(high = 0, critical = 0) {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical, total: high + critical } },
  });
}

describe("blocking dependency audit retries", () => {
  it("accepts a complete clean report once", async () => {
    const run = vi.fn(() => ({ status: 0, stdout: report() }));
    const wait = vi.fn();
    expect(await runDependencyAudit({ run, wait, log: vi.fn() })).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each(["high", "critical"])("fails a valid %s finding immediately", async (severity) => {
    const run = vi.fn(() => ({
      status: 1,
      stdout: report(severity === "high" ? 1 : 0, severity === "critical" ? 1 : 0),
    }));
    const wait = vi.fn();
    expect(await runDependencyAudit({ run, wait, log: vi.fn() })).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries infrastructure failures at most three times with no final sleep", async () => {
    const run = vi.fn(() => ({ status: 1, stdout: '{"error":{"code":"E503"}}' }));
    const wait = vi.fn();
    expect(await runDependencyAudit({ run, wait, log: vi.fn() })).toBe(1);
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10_000], [10_000]]);
  });

  it("recovers after an infrastructure failure", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: "registry unavailable" })
      .mockReturnValueOnce({ status: 0, stdout: report() });
    const wait = vi.fn();
    expect(await runDependencyAudit({ run, wait, log: vi.fn() })).toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it.each([
    "",
    "null",
    "[]",
    "{}",
    '{"metadata":{"vulnerabilities":{"high":0}}}',
    report().replace('"total":0', '"total":1'),
  ])("does not accept incomplete evidence: %s", (stdout) => {
    expect(auditVerdict({ status: 0, stdout })).toBe("unassessed");
  });

  it.each([-1, 0.5, "0", null])("rejects a malformed severity count: %s", (high) => {
    const value = JSON.parse(report());
    value.metadata.vulnerabilities.high = high;
    expect(auditVerdict({ status: 0, stdout: JSON.stringify(value) })).toBe("unassessed");
  });

  it("uses the bounded helper in the dependency-change workflow gate", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const gate = workflow.slice(
      workflow.indexOf("      - name: Dependency audit"),
      workflow.indexOf("      - name: Edge function typecheck"),
    );
    expect(gate).toContain("if: needs.changes.outputs.lockfile_changed == 'true'");
    expect(gate).toContain("run: node scripts/ci-dependency-audit.mjs");
    expect(gate).not.toContain("npm audit");
  });

  it("does not turn a failed process with a zero-count report into a pass", () => {
    expect(auditVerdict({ status: 1, stdout: report() })).toBe("unassessed");
    expect(auditVerdict({ status: 0, stdout: report(), signal: "SIGTERM" })).toBe("unassessed");
    expect(auditVerdict({ status: 0, stdout: null })).toBe("unassessed");
  });
});
