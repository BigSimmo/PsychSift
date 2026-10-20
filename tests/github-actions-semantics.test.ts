import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  actionlintRelease,
  actionlintResultStatus,
  assertSemanticFixtures,
  ensureActionlint,
  semanticArguments,
  semanticFixtures,
  verifyActionlintChecksum,
} from "../scripts/check-github-actions-semantics.mjs";

describe("pinned Actions semantic validator", () => {
  it("pins both the official archive and the executable rather than trusting PATH or mutable checksums", () => {
    expect(actionlintRelease).toMatchObject({
      version: "1.7.7",
      asset: "actionlint_1.7.7_linux_amd64.tar.gz",
      checksumsUrl: "https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_checksums.txt",
    });
    expect(actionlintRelease.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(actionlintRelease.executableSha256).toMatch(/^[a-f0-9]{64}$/);
    const bytes = Buffer.from("verified fixture");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    expect(() => verifyActionlintChecksum(bytes, checksum, "fixture")).not.toThrow();
    expect(() => verifyActionlintChecksum(Buffer.from("tampered fixture"), checksum, "fixture")).toThrow(
      /SHA-256 mismatch/,
    );
  });

  it("requires explicit installation permission and rejects a tampered cached executable before running it", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;
    const directory = mkdtempSync(path.join(tmpdir(), "actionlint-missing-"));
    try {
      await expect(ensureActionlint({ root: directory })).rejects.toThrow(/rerun with --install/);
      expect(existsSync(path.join(directory, "output"))).toBe(false);
      const cachedDirectory = path.join(directory, "output/tooling/actionlint", actionlintRelease.version, "linux-x64");
      mkdirSync(cachedDirectory, { recursive: true });
      writeFileSync(path.join(cachedDirectory, "actionlint"), "tampered binary");
      await expect(ensureActionlint({ root: directory })).rejects.toThrow(
        /Cached actionlint executable SHA-256 mismatch/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("checks real semantic negative controls without suppressing workflow diagnostics", () => {
    expect(semanticArguments).toEqual(["-no-color", "-oneline", "-shellcheck=", "-pyflakes="]);
    expect(semanticFixtures.map((probe: { name: string }) => probe.name)).toEqual([
      "valid workflow",
      "unknown expression context",
      "missing step implementation",
    ]);
    const execute = (source: string) =>
      source.includes("unknown_context")
        ? { status: 1, stdout: "undefined variable unknown_context", stderr: "" }
        : source.includes("missing implementation")
          ? { status: 1, stdout: "step requires run or uses", stderr: "" }
          : { status: 0, stdout: "", stderr: "" };
    expect(() => assertSemanticFixtures(execute)).not.toThrow();
    expect(() => assertSemanticFixtures(() => ({ status: 0, stdout: "", stderr: "" }))).toThrow(
      /unknown expression context/,
    );
    expect(() => assertSemanticFixtures(() => ({ status: 1, stdout: "download failed", stderr: "" }))).toThrow(
      /valid workflow/,
    );
  });

  it("propagates semantic failures and fails closed on execution errors or interrupted checks", () => {
    expect(actionlintResultStatus({ status: 1 })).toBe(1);
    expect(actionlintResultStatus({ status: 0 })).toBe(0);
    expect(() => actionlintResultStatus({ status: null, signal: "SIGTERM" })).toThrow(/SIGTERM/);
    expect(() => actionlintResultStatus({ status: null })).toThrow(/missing exit status/);
    expect(() => actionlintResultStatus({})).toThrow(/missing exit status/);
    expect(() => actionlintResultStatus({ error: new Error("cannot execute") })).toThrow(/cannot execute/);
  });
});

describe("required Actions semantic gate wiring", () => {
  const load = createRequire(import.meta.url)("js-yaml").load;
  const workflow = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;

  it("runs the pinned semantic helper after the blocking pin check for the same workflow scope", () => {
    const job = workflow.jobs["static-pr"];
    const steps = job.steps as { name?: string; run?: string; if?: string; "continue-on-error"?: boolean }[];
    const pins = steps.find((step) => step.run === "npm run check:github-actions")!;
    const semantics = steps.find((step) => step.run === "npm run check:github-actions:semantics")!;
    expect(pins).toBeDefined();
    expect(semantics).toBeDefined();
    expect(semantics.if).toBe("needs.changes.outputs.workflow_changed == 'true'");
    expect(semantics.if).toBe(pins.if);
    expect(steps.indexOf(semantics)).toBe(steps.indexOf(pins) + 1);
    expect(semantics["continue-on-error"]).not.toBe(true);
    expect(job["continue-on-error"]).not.toBe(true);
    expect(scripts["check:github-actions:semantics"]).toBe("node scripts/check-github-actions-semantics.mjs --install");
    expect(
      scripts["test:ci-workflows"]
        .split(" ")
        .filter((token: string) => token === "tests/github-actions-semantics.test.ts"),
    ).toHaveLength(1);
  });

  it.each(["scripts/check-github-actions-semantics.mjs", "scripts/actionlint-release.json"])(
    "selects the semantic gate when %s changes",
    (file) => {
      const result = JSON.parse(
        execFileSync(process.execPath, ["scripts/ci-change-scope.mjs", "--files", file, "--json"], {
          encoding: "utf8",
        }),
      );
      expect(result.workflow_changed).toBe(true);
    },
  );
});
