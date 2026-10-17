import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateTrivySummaryText,
  isCompatibleLocalTrivyVersion,
  TRIVY_IMAGE,
  TRIVY_VERSION,
  trivyDockerMounts,
  validateTrivyReportJson,
} from "../scripts/trivy-image-scan.mjs";

describe("Trivy image scan evidence validation (R13)", () => {
  it("rejects empty stdout, invalid JSON, and JSON missing SchemaVersion or Results/Metadata", () => {
    expect(validateTrivyReportJson("")).toEqual({
      ok: false,
      reason: "invalid_trivy_json",
    });
    expect(validateTrivyReportJson("not-json")).toEqual({
      ok: false,
      reason: "invalid_trivy_json",
    });
    expect(validateTrivyReportJson("{}")).toEqual({
      ok: false,
      reason: "invalid_trivy_json",
    });
    expect(validateTrivyReportJson(JSON.stringify({ SchemaVersion: 2 }))).toEqual({
      ok: false,
      reason: "invalid_trivy_json",
    });
    expect(validateTrivyReportJson(JSON.stringify({ Results: [] }))).toEqual({
      ok: false,
      reason: "invalid_trivy_json",
    });
  });

  it("accepts valid Trivy JSON reports and tallies vulnerability severities accurately", () => {
    const cleanReport = JSON.stringify({
      SchemaVersion: 2,
      Metadata: { ImageID: "sha256:1234" },
      Results: [{ Target: "debian", Vulnerabilities: [] }],
    });

    const cleanResult = validateTrivyReportJson(cleanReport);
    expect(cleanResult.ok).toBe(true);
    if (cleanResult.ok) {
      expect(cleanResult.counts).toEqual({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        UNKNOWN: 0,
      });
      expect(cleanResult.totalVulnerabilities).toBe(0);
    }

    const vulnReport = JSON.stringify({
      SchemaVersion: 2,
      Results: [
        {
          Target: "python-pkg",
          Vulnerabilities: [
            { VulnerabilityID: "CVE-2026-0001", Severity: "HIGH" },
            { VulnerabilityID: "CVE-2026-0002", Severity: "CRITICAL" },
            { VulnerabilityID: "CVE-2026-0003", Severity: "HIGH" },
          ],
        },
      ],
    });

    const vulnResult = validateTrivyReportJson(vulnReport);
    expect(vulnResult.ok).toBe(true);
    if (vulnResult.ok) {
      expect(vulnResult.counts?.HIGH).toBe(2);
      expect(vulnResult.counts?.CRITICAL).toBe(1);
      expect(vulnResult.totalVulnerabilities).toBe(3);
    }
  });

  it("checks local trivy version compatibility against the pinned 0.59.1 version", () => {
    expect(TRIVY_VERSION).toBe("0.59.1");
    expect(TRIVY_IMAGE).toContain("aquasec/trivy:0.59.1@sha256:");
    expect(isCompatibleLocalTrivyVersion("Version: 0.59.1\nVulnerability DB:\n")).toBe(true);
    expect(isCompatibleLocalTrivyVersion("Version: 0.50.0\n")).toBe(false);
    expect(isCompatibleLocalTrivyVersion("")).toBe(false);
  });

  it("fails closed when summary is empty, contains STATUS=unassessed, or is missing either image", () => {
    expect(evaluateTrivySummaryText("")).toMatchObject({
      assessed: false,
      ok: false,
      reason: "empty_summary",
    });

    expect(
      evaluateTrivySummaryText(
        "Trivy scan completed (clinical-kb-app:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0\n" +
          "Trivy scan failed (clinical-kb-worker:ci): STATUS=unassessed reason=invalid_trivy_json",
      ),
    ).toMatchObject({
      assessed: false,
      ok: false,
      reason: "contains_unassessed_status",
    });

    expect(
      evaluateTrivySummaryText(
        "Trivy scan completed (clinical-kb-app:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0",
      ),
    ).toMatchObject({
      assessed: false,
      ok: false,
      reason: "missing_status_ok_for_clinical-kb-worker:ci",
    });

    expect(
      evaluateTrivySummaryText(
        "Trivy scan completed (clinical-kb-app:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0\n" +
          "Trivy scan completed (clinical-kb-worker:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=1 LOW=2 UNKNOWN=0",
      ),
    ).toEqual({
      assessed: true,
      ok: true,
      high: 0,
      critical: 0,
      reason: null,
    });
  });

  it("enforces fail-closed STATUS=ok checks for both images in docker-image.yml", () => {
    const workflow = readFileSync(new URL("../.github/workflows/docker-image.yml", import.meta.url), "utf8");

    expect(workflow).toContain("STATUS=unassessed");
    expect(workflow).toContain("Trivy scan completed (clinical-kb-app:ci): STATUS=ok");
    expect(workflow).toContain("Trivy scan completed (clinical-kb-worker:ci): STATUS=ok");
    expect(workflow).toContain("Trivy scan unassessed:");
  });
});

describe("Trivy container mounts", () => {
  it("keeps the image tarball read-only and makes only the throwaway database cache writable", () => {
    expect(trivyDockerMounts({ workDir: "/tmp/w", cacheDir: "/tmp/c", outputDir: "/tmp/o" })).toEqual([
      "-v",
      "/tmp/w:/work:ro",
      "-v",
      "/tmp/c:/cache",
      "-v",
      "/tmp/o:/out",
    ]);
    expect(trivyDockerMounts({ workDir: "/tmp/w" })).toEqual(["-v", "/tmp/w:/work:ro"]);
  });
});
