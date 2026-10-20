import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failedTestcasesFromJunit } from "../scripts/classify-playwright-failures.mjs";
import {
  collectBrowserTests,
  loadFlakeLedger,
  matchFlake,
  validateCollectedQuarantines,
  validateFlakeLedgerEntries,
} from "../scripts/flake-ledger.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function isoDate(offsetDays: number, now = Date.now()) {
  return new Date(now + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validEntry(overrides: Record<string, string> = {}) {
  return {
    id: "sample-flake",
    title: "exact flaky journey @quarantine",
    spec: "tests/sample.spec.ts",
    reason: "Reproduced fail/pass variation on the same SHA.",
    owner: "test-infrastructure",
    reproduction: "npm run test:e2e:advisory -- --grep exact --repeat-each=3",
    firstSeen: isoDate(-2),
    lastSeen: isoDate(-1),
    expires: isoDate(20),
    tracking: "docs/process-hardening.md#known-flakes",
    ...overrides,
  };
}

function temporarySpec(source: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "clinical-kb-flake-ledger-test-"));
  temporaryDirectories.push(root);
  mkdirSync(path.join(root, "tests"));
  writeFileSync(path.join(root, "tests", "sample.spec.ts"), source);
  return root;
}

describe("flake ledger", () => {
  it("allows an empty ledger", () => {
    expect(validateFlakeLedgerEntries([])).toEqual([]);
  });

  it("collects the actual repository config without a server or project-identity request", () => {
    const tests = collectBrowserTests();
    expect(tests.length).toBeGreaterThan(100);
    expect(tests.some((test: { spec: string }) => test.spec === "tests/ui-smoke.spec.ts")).toBe(true);
    const ledger = loadFlakeLedger();
    const quarantines = validateCollectedQuarantines(ledger, tests);
    const identities = (entries: Array<{ spec: string; title: string }>) =>
      entries.map(({ spec, title }) => JSON.stringify([spec, title])).sort();
    expect(identities(quarantines)).toEqual(identities(ledger));
  });

  it("reports nonzero collection status and JSON stdout even when stderr is empty", () => {
    const run = vi.fn().mockReturnValue({
      status: 1,
      signal: null,
      stderr: "",
      stdout: '{"errors":[{"message":"no matching collected tests"}]}',
    });
    expect(() => collectBrowserTests({ run })).toThrow(/status=1, signal=none.*no matching collected tests/);
  });

  it("matches only the exact case-insensitive spec and title identity", () => {
    const flakes = [validEntry()];
    expect(matchFlake("tests/sample.spec.ts", "EXACT FLAKY JOURNEY @QUARANTINE", flakes)?.id).toBe("sample-flake");
    expect(matchFlake("tests/sample.spec.ts", "prefix exact flaky journey @quarantine", flakes)).toBeNull();
    expect(matchFlake("tests/other.spec.ts", "exact flaky journey @quarantine", flakes)).toBeNull();
    expect(matchFlake("", "")).toBeNull();
  });

  it("requires exact quarantined titles and complete ownership metadata", () => {
    expect(() => validateFlakeLedgerEntries([validEntry({ title: "" })])).toThrow(/missing: title/);
    expect(() => validateFlakeLedgerEntries([validEntry({ owner: "" })])).toThrow(/missing: owner/);
  });

  it("rejects critical overlap and expiry beyond 30 days", () => {
    const now = Date.now();
    expect(() => validateFlakeLedgerEntries([validEntry({ title: "unsafe @quarantine @critical" })])).toThrow(
      /cannot be both @quarantine and @critical/,
    );
    expect(() => validateFlakeLedgerEntries([validEntry({ expires: isoDate(31, now) })], { now })).toThrow(
      /within 30 days/,
    );
    const root = temporarySpec('test("exact flaky journey @quarantine", () => {});');
    expect(validateFlakeLedgerEntries([validEntry({ expires: isoDate(30, now) })], { root, now })).toHaveLength(1);
  });

  it("rejects calendar-invalid ledger dates", () => {
    expect(() => validateFlakeLedgerEntries([validEntry({ firstSeen: "2026-02-30" })])).toThrow(/not a valid date/);
  });

  it("requires the exact title to exist in the referenced spec", () => {
    const entry = validEntry();
    const root = temporarySpec(`test(${JSON.stringify(entry.title)}, () => {});`);
    expect(validateFlakeLedgerEntries([entry], { root })).toHaveLength(1);
    expect(() => validateCollectedQuarantines([validEntry({ title: "missing @quarantine" })], [])).toThrow(
      /exact title is not present/,
    );
  });

  it("reconciles actual title-only and inherited tags and refuses the empty-ledger bypass", () => {
    const root = temporarySpec(`import { test } from "playwright/test";
      test("title only @quarantine", () => { throw new Error("collection must not execute tests"); });
      test("suffix @quarantine-extra", () => {});
      test.describe("group", { tag: "@quarantine" }, () => {
        test("inherited", () => {});
        test("explicit", { tag: "@quarantine" }, () => {});
      });`);
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"), "junction");
    writeFileSync(
      path.join(root, "playwright.config.ts"),
      `const config = { testDir: "./tests", projects: [
      { name: "chromium", grepInvert: /@mockup/ },
      { name: "chromium-mockups", testMatch: /ui-only-mockup.spec.ts/, grep: /@mockup/ }
    ], webServer: { command: "exit 99", url: "http://127.0.0.1:9" } };
    if (process.argv.includes("--list")) {
      for (const project of config.projects) { delete project.grep; delete project.grepInvert; }
    }
    export default config;`,
    );
    const tests = collectBrowserTests({ root });
    expect(tests.map((test: { title: string }) => test.title)).toEqual([
      "title only @quarantine",
      "suffix @quarantine-extra",
      "group › inherited",
      "group › explicit",
    ]);
    expect(() => validateCollectedQuarantines([], tests)).toThrow(/unregistered @quarantine/);
    const flakes = tests.map((test: { title: string }, index: number) =>
      validEntry({ id: `flake-${index}`, title: test.title }),
    );
    validateFlakeLedgerEntries(flakes, { root });
    // Production PR grep-invert uses substring regexes, not token equality.
    expect(/@quarantine|@mockup/.test(tests[1].title)).toBe(true);
    expect(() => validateCollectedQuarantines([], [tests[1]])).toThrow(/unregistered @quarantine/);
    expect(validateCollectedQuarantines(flakes, tests)).toEqual(tests);
    expect(() => validateCollectedQuarantines(flakes, tests.slice(1))).toThrow(/stale ledger entry/);
    expect(() => validateCollectedQuarantines(flakes, [{ ...tests[0], tags: ["@critical", "@quarantine"] }])).toThrow(
      /both @quarantine and @critical/,
    );
    expect(() => validateCollectedQuarantines([flakes[0], { ...flakes[0], id: "duplicate" }], tests)).toThrow(
      /duplicate flake-ledger identity/,
    );
    writeFileSync(
      path.join(root, "tests/sample.spec.ts"),
      `import { test } from "playwright/test";
      test.describe("critical parent", { tag: "@critical-extra" }, () => {
        test("quarantined child", { tag: "@quarantine" }, () => {});
      });`,
    );
    expect(() => validateCollectedQuarantines([], collectBrowserTests({ root }))).toThrow(
      /both @quarantine and @critical/,
    );
    writeFileSync(
      path.join(root, "tests/sample.spec.ts"),
      `import { test } from "playwright/test";
      test("mixed @quarantine @mockup", () => { throw new Error("must not execute"); });`,
    );
    const mixed = collectBrowserTests({ root });
    expect(mixed.map((test: { title: string }) => test.title)).toEqual(["mixed @quarantine @mockup"]);
    expect(() => validateCollectedQuarantines([], mixed)).toThrow(/unregistered @quarantine/);
    expect(() => validateCollectedQuarantines([validEntry({ title: mixed[0].title })], mixed)).toThrow(
      /no advisory project route/,
    );
  });

  it("rejects expired registrations and traversal spec identities", () => {
    expect(() => validateFlakeLedgerEntries([validEntry({ expires: isoDate(-1), lastSeen: isoDate(-2) })])).toThrow(
      /expired/,
    );
    expect(() => validateFlakeLedgerEntries([validEntry({ spec: "tests/../other.spec.ts" })])).toThrow(
      /repository browser spec/,
    );
  });

  it("extracts only exact failed testcase identities from JUnit", () => {
    const failures = failedTestcasesFromJunit(`
      <testsuite>
        <testcase name="exact flaky journey @quarantine" classname="sample.spec.ts">
          <failure message="failed" />
        </testcase>
        <testcase name="passing journey" classname="tests/sample.spec.ts"></testcase>
        <testcase name="diagnostic journey" classname="tests/sample.spec.ts">
          <system-out><![CDATA[diagnostic text containing <failure> but no failure element]]></system-out>
          <!-- <error>diagnostic comment</error> -->
        </testcase>
      </testsuite>
    `);
    expect(failures).toEqual([{ spec: "tests/sample.spec.ts", title: "exact flaky journey @quarantine" }]);
    const flakes = [validEntry()];
    expect(matchFlake(failures[0]?.spec, failures[0]?.title, flakes)?.id).toBe("sample-flake");
    expect(matchFlake("tests/other.spec.ts", failures[0]?.title, flakes)).toBeNull();
  });
});
