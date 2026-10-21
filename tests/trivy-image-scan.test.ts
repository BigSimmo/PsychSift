import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateTrivySummaryText,
  isCompatibleLocalTrivyVersion,
  TRIVY_IMAGE,
  TRIVY_VERSION,
  cachedTrivyDbNeedsRefresh,
  trivyDbNeedsRefresh,
  trivyDockerMounts,
  validateTrivyReportJson,
  trivyFindingDetails,
  applyTrivySuppressions,
  parseTrivySuppressions,
} from "../scripts/trivy-image-scan.mjs";

describe("bounded actionable Trivy finding logs", () => {
  it("retains high/critical package and fixed-version metadata without affecting the strict summary", () => {
    const report = {
      Results: [
        {
          Type: "debian",
          Vulnerabilities: [
            {
              Severity: "HIGH",
              PkgName: "library",
              InstalledVersion: "1.0",
              FixedVersion: "1.1",
              VulnerabilityID: "CVE-2026-1234",
            },
            { Severity: "LOW", PkgName: "unrelated" },
            { Severity: "CRITICAL", PkgName: "other", VulnerabilityID: "CVE-2026-5678" },
          ],
        },
      ],
    };
    const details = trivyFindingDetails(report);
    expect(details.total).toBe(2);
    expect(details.truncated).toBe(false);
    expect(details.rows[0]).toMatchObject({ package: "library", installed: "1.0", fixed: "1.1", cve: "CVE-2026-1234" });
    expect(details.rows[1].severity).toBe("CRITICAL");
    expect(validateTrivyReportJson(JSON.stringify({ SchemaVersion: 2, ...report }))).toMatchObject({
      counts: { HIGH: 1, CRITICAL: 1, LOW: 1 },
    });
  });

  it("bounds diagnostics, neutralizes control characters and accepts optional/malformed inventory sections", () => {
    const details = trivyFindingDetails(
      {
        Results: [
          {
            Vulnerabilities: [
              { Severity: "HIGH", PkgName: "\n::error::injected\u001b" },
              { Severity: "HIGH", PkgName: "second" },
            ],
          },
        ],
      },
      1,
    );
    expect(details.total).toBe(2);
    expect(details.truncated).toBe(true);
    expect(details.rows).toHaveLength(1);
    expect(details.rows[0].package).not.toMatch(/[\n\r\u001b]/);
    for (const report of [{}, { Results: {} }, { Results: [null, { Vulnerabilities: {} }] }]) {
      expect(trivyFindingDetails(report).rows).toEqual([]);
    }
    expect(() => trivyFindingDetails({}, 513)).toThrow(RangeError);
  });
});

describe("Trivy retained scanner evidence", () => {
  it.skipIf(process.platform === "win32").each(["local", "docker"])(
    "persists a >1MiB report through the %s scanner path without suppressing findings",
    (scanner) => {
      const dir = mkdtempSync(join(tmpdir(), "trivy-evidence-"));
      try {
        const bin = join(dir, "bin");
        mkdirSync(bin);
        const fixture = join(dir, "fixture.json");
        const output = join(dir, "report.json");
        const invocation = join(dir, "args.json");
        const raw = {
          SchemaVersion: 2,
          Metadata: { OS: { Family: "debian", Name: "12" } },
          Results: [
            {
              Type: "debian",
              Vulnerabilities: [{ VulnerabilityID: "CVE-2026-0001", Severity: "HIGH" }],
              Packages: Array.from({ length: 300 }, (_, i) => ({
                Name: `library-${i}`,
                Version: "1.0",
                InstalledFiles: Array.from(
                  { length: 60 },
                  (_, j) =>
                    `/usr/lib/python3.11/site-packages/library_${i}/tests/data/representative-resource-file-${j}.json`,
                ),
              })),
            },
          ],
        };
        expect(Buffer.byteLength(JSON.stringify(raw))).toBeGreaterThan(1024 * 1024);
        writeFileSync(fixture, JSON.stringify(raw));
        writeFileSync(
          join(bin, "trivy"),
          `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) { console.log("Version: 0.59.1"); }
else { fs.writeFileSync(process.env.TRIVY_TEST_ARGS, JSON.stringify(process.argv.slice(2))); process.stdout.write(fs.readFileSync(process.env.TRIVY_TEST_FIXTURE)); }
`,
          { mode: 0o755 },
        );
        const cache = join(dir, "cache");
        if (scanner === "docker") {
          // Local fixtures replace Docker and Trivy: no daemon, downloads or network.
          writeFileSync(join(bin, "which"), "#!/usr/bin/env node\nprocess.exit(1);\n", { mode: 0o755 });
          writeFileSync(
            join(bin, "docker"),
            `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "save") fs.writeFileSync(args[args.indexOf("-o") + 1], "fixture");
else { fs.writeFileSync(process.env.TRIVY_TEST_ARGS, JSON.stringify(args)); process.stdout.write(fs.readFileSync(process.env.TRIVY_TEST_FIXTURE)); }
`,
            { mode: 0o755 },
          );
          for (const [subdir, dbFile] of [
            ["db", "trivy.db"],
            ["java-db", "trivy-java.db"],
          ]) {
            mkdirSync(join(cache, subdir), { recursive: true });
            writeFileSync(join(cache, subdir, dbFile), "fixture");
            writeFileSync(join(cache, subdir, "metadata.json"), JSON.stringify({ NextUpdate: "2099-01-01T00:00:00Z" }));
          }
        }
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL("../scripts/trivy-image-scan.mjs", import.meta.url)),
            "fixture:ci",
            "--report",
            output,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
              TRIVY_PREFER_LOCAL: "1",
              TRIVY_CACHE_DIR: cache,
              TRIVY_TEST_FIXTURE: fixture,
              TRIVY_TEST_ARGS: invocation,
            },
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("STATUS=ok HIGH=1 CRITICAL=0");
        expect(result.stdout).not.toContain("Trivy finding:");
        expect(result.stderr).toContain('"cve":"CVE-2026-0001"');
        expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(raw);
        expect(JSON.parse(readFileSync(invocation, "utf8"))).toContain("--list-all-pkgs");
        expect(evaluateTrivySummaryText(result.stdout, ["fixture:ci"])).toMatchObject({
          assessed: true,
          ok: false,
          high: 1,
          reason: "high_or_critical_vulnerabilities_found",
        });
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );
});

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

  it.each([
    ["missing HIGH", "HIGH=0 ", ""],
    ["missing CRITICAL", "CRITICAL=0 ", ""],
    ["negative count", "HIGH=0", "HIGH=-1"],
    ["decimal count", "HIGH=0", "HIGH=0.5"],
    ["partial count", "HIGH=0", "HIGH=0x"],
    ["non-numeric count", "CRITICAL=0", "CRITICAL=NaN"],
    ["unsafe count", "HIGH=0", "HIGH=9007199254740992"],
    ["duplicate field", "HIGH=0", "HIGH=0 HIGH=0"],
  ])("rejects %s instead of treating the scan as clean", (_name, before, after) => {
    const clean =
      "Trivy scan completed (clinical-kb-app:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0\n" +
      "Trivy scan completed (clinical-kb-worker:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0";
    // Each image must independently carry valid evidence.
    for (const line of [0, 1]) {
      const records = clean.split("\n");
      records[line] = records[line].replace(before, after);
      expect(evaluateTrivySummaryText(records.join("\n"))).toMatchObject({ assessed: false, ok: false });
    }
  });

  it("rejects duplicate images and aggregate overflow", () => {
    const app = "Trivy scan completed (clinical-kb-app:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0";
    const worker = app.replace("clinical-kb-app:ci", "clinical-kb-worker:ci");
    expect(evaluateTrivySummaryText(`${app}\n${worker}\n${app}`)).toMatchObject({ assessed: false, ok: false });
    expect(
      evaluateTrivySummaryText(
        `${app.replace("HIGH=0", "HIGH=9007199254740991")}\n${worker.replace("HIGH=0", "HIGH=1")}`,
      ),
    ).toMatchObject({ assessed: false, ok: false, reason: "count_overflow" });
  });

  it.each([
    ["push", 0, 0, 0],
    ["schedule", 0, 0, 0],
    ["push", 2, 1, 1],
    ["schedule", 2, 1, 1],
    ["workflow_dispatch", 2, 1, 1],
    ["pull_request", 2, 1, 0],
    ["merge_group", 2, 1, 0],
  ])("evaluates actual CLI policy for %s with HIGH=%i CRITICAL=%i", (event, high, critical, exitCode) => {
    const dir = mkdtempSync(join(tmpdir(), "trivy-evaluation-"));
    try {
      const summary = join(dir, "summary.txt");
      writeFileSync(
        summary,
        `Trivy scan completed (clinical-kb-app:ci): STATUS=ok HIGH=${high} CRITICAL=${critical} MEDIUM=0 LOW=0 UNKNOWN=0\n` +
          "Trivy scan completed (clinical-kb-worker:ci): STATUS=ok HIGH=0 CRITICAL=0 MEDIUM=0 LOW=0 UNKNOWN=0\n",
      );
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../scripts/trivy-image-scan.mjs", import.meta.url)),
          "--evaluate-summary",
          summary,
          event,
        ],
        { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: join(dir, "job-summary.md"), PATH: "" } },
      );
      expect(result.status, result.stderr).toBe(exitCode);
      expect(result.stdout).toContain(`HIGH=${high} CRITICAL=${critical}`);
      if (high || critical)
        expect(result.stdout + result.stderr).toContain(exitCode === 0 ? "::warning::" : "::error::");
      expect(readFileSync(join(dir, "job-summary.md"), "utf8")).toContain("clinical-kb-worker:ci");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.each(["pull_request", "merge_group", "push", "schedule"])(
    "fails closed on missing and malformed CLI evidence for %s",
    (event) => {
      const dir = mkdtempSync(join(tmpdir(), "trivy-unassessed-"));
      try {
        const summary = join(dir, "summary.txt");
        const run = () =>
          spawnSync(
            process.execPath,
            [
              fileURLToPath(new URL("../scripts/trivy-image-scan.mjs", import.meta.url)),
              "--evaluate-summary",
              summary,
              event,
            ],
            { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "", PATH: "" } },
          );
        for (const text of [
          null,
          "",
          "Trivy scan completed (clinical-kb-app:ci): STATUS=ok\nTrivy scan completed (clinical-kb-worker:ci): STATUS=ok",
        ]) {
          if (text !== null) writeFileSync(summary, text);
          const result = run();
          expect(result.status).toBe(1);
          expect(result.stderr).toContain("::error::Trivy scan unassessed:");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );

  it("uses the strict Node evaluator in docker-image.yml without an arithmetic fallback", () => {
    const workflow = readFileSync(new URL("../.github/workflows/docker-image.yml", import.meta.url), "utf8");
    expect(workflow).toContain('--evaluate-summary trivy-scan-summary.txt "$SCAN_EVENT_NAME"');
    expect(workflow).toContain("SCAN_EVENT_NAME: ${{ github.event_name }}");
    expect(workflow).not.toContain("| bc");
    const evaluation = workflow.slice(
      workflow.indexOf("      - name: Fail on HIGH/CRITICAL"),
      workflow.indexOf("      - name: Admit complete bounded"),
    );
    expect(evaluation).toContain("if: always()");
    expect(evaluation).not.toContain("continue-on-error:");
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

describe("Trivy vulnerability database freshness", () => {
  const now = new Date("2026-10-17T00:00:00Z");

  it("refreshes a missing, unreadable or undated database", () => {
    expect(trivyDbNeedsRefresh(null, now)).toBe(true);
    expect(trivyDbNeedsRefresh("not json", now)).toBe(true);
    expect(trivyDbNeedsRefresh(JSON.stringify({ Version: 2 }), now)).toBe(true);
  });

  it("refreshes a cached database whose NextUpdate has passed", () => {
    expect(trivyDbNeedsRefresh(JSON.stringify({ NextUpdate: "2026-10-16T18:00:00Z" }), now)).toBe(true);
  });

  it("reuses a cached database that is still current", () => {
    expect(trivyDbNeedsRefresh(JSON.stringify({ NextUpdate: "2026-10-17T06:00:00Z" }), now)).toBe(false);
  });
});

describe("Trivy cache directory freshness", () => {
  const now = new Date("2026-10-17T00:00:00Z");
  const current = JSON.stringify({ NextUpdate: "2026-10-17T06:00:00Z" });

  function cacheWith({ dbFile, metadata }: { dbFile: boolean; metadata: string | null }) {
    const cacheDir = mkdtempSync(join(tmpdir(), "trivy-cache-test-"));
    mkdirSync(join(cacheDir, "db"), { recursive: true });
    if (dbFile) writeFileSync(join(cacheDir, "db", "trivy.db"), "");
    if (metadata !== null) writeFileSync(join(cacheDir, "db", "metadata.json"), metadata);
    return cacheDir;
  }

  it("downloads when the database file is missing even though its metadata is current", () => {
    expect(cachedTrivyDbNeedsRefresh(cacheWith({ dbFile: false, metadata: current }), "db", "trivy.db", now)).toBe(
      true,
    );
  });

  it("downloads when the metadata is missing", () => {
    expect(cachedTrivyDbNeedsRefresh(cacheWith({ dbFile: true, metadata: null }), "db", "trivy.db", now)).toBe(true);
  });

  it("reuses a complete, current cache", () => {
    expect(cachedTrivyDbNeedsRefresh(cacheWith({ dbFile: true, metadata: current }), "db", "trivy.db", now)).toBe(
      false,
    );
  });
});

describe("trivy suppressions", () => {
  const suppressionsPath = fileURLToPath(new URL("../scripts/trivy-suppressions.json", import.meta.url));
  const suppressions = parseTrivySuppressions(readFileSync(suppressionsPath, "utf8"));
  const componentsDir = fileURLToPath(new URL("../worker/native/components/", import.meta.url));
  const components = readdirSync(componentsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(componentsDir, name), "utf8")));

  it("only suppresses exact image/package/version/CVE matches", () => {
    const vuln = (PkgName: string, InstalledVersion: string, VulnerabilityID: string) => ({
      PkgName,
      InstalledVersion,
      VulnerabilityID,
      Severity: "HIGH",
    });
    const report = {
      SchemaVersion: 2,
      Results: [
        {
          Type: "debian",
          Vulnerabilities: [
            vuln("pkg", "1.0+psychsift1", "CVE-2026-1"),
            vuln("pkg", "1.0+psychsift2", "CVE-2026-1"),
            vuln("pkg", "1.0+psychsift1", "CVE-2026-2"),
          ],
        },
      ],
    };
    const rows = [
      { image: "img:ci", package: "pkg", installed: "1.0+psychsift1", cve: "CVE-2026-1" },
      { image: "other:ci", package: "pkg", installed: "1.0+psychsift1", cve: "CVE-2026-2" },
    ];
    const applied = applyTrivySuppressions(report, "img:ci", rows);
    expect(applied.suppressed.map((v) => v.VulnerabilityID)).toEqual(["CVE-2026-1"]);
    expect(validateTrivyReportJson(JSON.stringify(applied.report)).counts?.HIGH).toBe(2);
    expect(report.Results[0].Vulnerabilities).toHaveLength(3);
  });

  it("rejects suppressions without justification or removal condition", () => {
    expect(() =>
      parseTrivySuppressions(
        JSON.stringify({
          schema_version: 1,
          suppressions: [{ image: "a", package: "b", installed: "c", cve: "CVE-1-1", justification: "x" }],
        }),
      ),
    ).toThrow(/remove_when/);
  });

  it("ties every +psychsift1 suppression to a current backport build and a patched CVE", () => {
    for (const row of suppressions.filter((s) => s.installed.includes("+psychsift"))) {
      const component = components.find((c) => c.runtime_packages.includes(row.package));
      expect(component, row.package).toBeDefined();
      expect(row.installed.endsWith(component.backport_version), `${row.package} ${row.installed}`).toBe(true);
      const patched = JSON.stringify(component.patches) + component.change_summary;
      expect(patched, `${row.cve} for ${row.package}`).toContain(row.cve);
    }
  });

  it("never suppresses CVEs the backports explicitly leave unresolved or unpatched", () => {
    for (const cve of ["CVE-2026-6653", "CVE-2026-86139", "CVE-2026-78409"]) {
      expect(suppressions.some((s) => s.cve === cve)).toBe(false);
    }
  });

  it("limits Pillow suppressions to the Docling-locked version", () => {
    const lock = readFileSync(fileURLToPath(new URL("../eval/docling/requirements.txt", import.meta.url)), "utf8");
    const locked = /^pillow==(\S+)/m.exec(lock)?.[1];
    for (const row of suppressions.filter((s) => s.package === "pillow")) {
      expect(row.installed).toBe(locked);
    }
  });
});

describe("worker native pinned-source tracking", () => {
  it("lists every component's pinned and built version in worker/native/README.md", () => {
    const readme = readFileSync(fileURLToPath(new URL("../worker/native/README.md", import.meta.url)), "utf8");
    const dir = fileURLToPath(new URL("../worker/native/components/", import.meta.url));
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const c = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const row = new RegExp(
        `^\\|\\s*${esc(c.source)}\\s*\\|\\s*${esc(c.source_version)}\\s*\\|\\s*${esc(c.backport_version)}\\s*\\|`,
        "m",
      );
      expect(readme, c.source).toMatch(row);
    }
  });
});
