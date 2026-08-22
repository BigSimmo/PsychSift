import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendReceipt,
  OUTCOME_AFFECTING_ENV_VARS,
  parseRawDiff,
  computeInputSignature,
  consultGateReceipt,
  environmentSignature,
  fileInScope,
  loadStore,
  MAX_RECEIPTS_PER_GATE,
  receiptKey,
  receiptsEnabled,
  recordGateReceipt,
  typecheckScopeAlias,
  withGateReceipt,
} from "../scripts/gate-receipts.mjs";

const temporaryRoots: string[] = [];

/**
 * Explicit environment for every test that exercises record/reuse behaviour.
 *
 * These calls default to `process.env`, and receipts are disabled whenever `CI` is set —
 * by design, since CI must never reuse a receipt. Depending on the ambient environment
 * therefore made the suite pass locally and fail on GitHub, where the reuse assertions
 * became unreachable. CI caught it on PR #2216. Pass this wherever reuse is the subject;
 * the CI-refusal itself is asserted separately in "reuse boundaries".
 */
const RECEIPTS_ENABLED: Record<string, string | undefined> = {};

/** A throwaway git worktree, so signature behaviour is proven against real git plumbing. */
function gitFixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "gate-receipts-"));
  temporaryRoots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(root, name), contents);
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return { root, git, write: (name: string, contents: string) => writeFileSync(path.join(root, name), contents) };
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { recursive: true, force: true, maxRetries: 3 });
});

describe("gate receipts — reuse boundaries", () => {
  it("never reuses a receipt in CI, because CI is the authoritative merge gate", () => {
    expect(receiptsEnabled({ CI: "true" }).enabled).toBe(false);
    expect(receiptsEnabled({ CI: "1", GATE_RECEIPTS: "on" }).enabled).toBe(false);
  });

  it("honours the explicit off and refresh switches", () => {
    expect(receiptsEnabled({ GATE_RECEIPTS: "off" }).enabled).toBe(false);
    expect(receiptsEnabled({ GATE_RECEIPTS: "false" }).enabled).toBe(false);
    expect(receiptsEnabled({ GATE_RECEIPTS: "refresh" })).toMatchObject({ enabled: true, refresh: true });
    expect(receiptsEnabled({})).toMatchObject({ enabled: true, refresh: false });
  });

  it("treats an unlisted gate as not memoisable", () => {
    const decision = consultGateReceipt({ projectRoot: process.cwd(), gate: "build", args: [] });
    expect(decision.reuse).toBe(false);
    expect(decision.key).toBeNull();
  });

  it("maps both typecheck wrappers onto one scope", () => {
    expect(typecheckScopeAlias("typecheck:source:internal")).toBe("typecheck:internal");
    expect(typecheckScopeAlias("lint:internal")).toBe("lint:internal");
  });
});

describe("gate receipts — input signature", () => {
  it("changes when tracked content changes and returns to the earlier hash when it is restored", () => {
    const { root, write } = gitFixture({ "a.ts": "export const a = 1;\n" });
    const before = computeInputSignature(root, null);
    write("a.ts", "export const a = 2;\n");
    const modified = computeInputSignature(root, null);
    write("a.ts", "export const a = 1;\n");
    const restored = computeInputSignature(root, null);

    expect(before?.hash).toBeTruthy();
    expect(modified?.hash).not.toBe(before?.hash);
    expect(restored?.hash).toBe(before?.hash);
  });

  it("counts an unstaged edit, so an uncommitted change can never be memoised away", () => {
    const { root, write } = gitFixture({ "a.ts": "1\n", "b.ts": "2\n" });
    const before = computeInputSignature(root, null);
    write("b.ts", "2 // edited\n");
    expect(computeInputSignature(root, null)?.hash).not.toBe(before?.hash);
  });

  it("counts a new untracked file", () => {
    const { root, write } = gitFixture({ "a.ts": "1\n" });
    const before = computeInputSignature(root, null);
    write("new.ts", "export const added = true;\n");
    const after = computeInputSignature(root, null);
    expect(after?.hash).not.toBe(before?.hash);
    expect(after?.fileCount).toBe((before?.fileCount ?? 0) + 1);
  });

  it("counts a deletion", () => {
    const { root } = gitFixture({ "a.ts": "1\n", "b.ts": "2\n" });
    const before = computeInputSignature(root, null);
    rmSync(path.join(root, "b.ts"));
    const after = computeInputSignature(root, null);
    expect(after?.hash).not.toBe(before?.hash);
    expect(after?.fileCount).toBe((before?.fileCount ?? 0) - 1);
  });

  it("restricts the signature to a declared scope", () => {
    const { root, write } = gitFixture({ "src.ts": "1\n", "docs.md": "unrelated\n" });
    const scoped = computeInputSignature(root, ["src.ts"]);
    write("docs.md", "still unrelated, but different\n");
    expect(computeInputSignature(root, ["src.ts"])?.hash).toBe(scoped?.hash);
    expect(computeInputSignature(root, null)?.hash).not.toBe(computeInputSignature(root, ["src.ts"])?.hash);
  });

  it("fails open rather than reusing when the directory is not a git worktree", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "gate-receipts-nogit-"));
    temporaryRoots.push(root);
    expect(computeInputSignature(root, null)).toBeNull();
  });

  it("fails open when a declared scope resolves to no files", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    expect(computeInputSignature(root, ["nonexistent/"])).toBeNull();
  });

  it("matches directory scopes by path segment, not bare string prefix", () => {
    expect(fileInScope("src/lib/rag/rag.ts", ["src/"])).toBe(true);
    expect(fileInScope("srcx/other.ts", ["src/"])).toBe(false);
    expect(fileInScope("package.json", ["package.json"])).toBe(true);
    expect(fileInScope("docs/package.json", ["package.json"])).toBe(false);
  });
});

describe("gate receipts — file modes (Codex review, PR #2216)", () => {
  it("changes the signature when only the INDEX mode changes", () => {
    // `git update-index --chmod=+x` is the exact remediation AGENTS.md prescribes for a
    // hook committed as 100644, and it leaves the blob SHA untouched. A SHA-only
    // signature let that fix reuse the pre-fix pass of the very test that guards it.
    const { root, git } = gitFixture({ "hook.sh": "#!/bin/bash\necho hi\n" });
    const before = computeInputSignature(root, null)?.hash;
    git("update-index", "--chmod=+x", "hook.sh");
    expect(computeInputSignature(root, null)?.hash).not.toBe(before);
  });

  it.skipIf(process.platform === "win32")("changes the signature when only the WORKING-TREE mode changes", () => {
    const { root } = gitFixture({ "hook.sh": "#!/bin/bash\necho hi\n" });
    const before = computeInputSignature(root, null)?.hash;
    chmodSync(path.join(root, "hook.sh"), 0o755);
    expect(computeInputSignature(root, null)?.hash).not.toBe(before);
  });

  it.skipIf(process.platform === "win32")("keeps both modes, so one cannot cancel the other", () => {
    const { root, git } = gitFixture({ "hook.sh": "#!/bin/bash\necho hi\n" });
    const plain = computeInputSignature(root, null)?.hash;
    git("update-index", "--chmod=+x", "hook.sh");
    const indexOnly = computeInputSignature(root, null)?.hash;
    chmodSync(path.join(root, "hook.sh"), 0o755);
    const both = computeInputSignature(root, null)?.hash;
    expect(new Set([plain, indexOnly, both]).size).toBe(3);
  });

  it("parses `git diff --raw -z` into destination modes", () => {
    expect(parseRawDiff([":100644 100755 abc123 0000000 M", "hook.sh"]).get("hook.sh")).toBe("100755");
    expect(parseRawDiff([":100644 000000 abc123 0000000 D", "gone.ts"]).get("gone.ts")).toBe("000000");
    expect(parseRawDiff([]).size).toBe(0);
  });
});

describe("gate receipts — outcome-affecting environment (Codex review, PR #2216)", () => {
  it("keys on FAST_CHECK_SEED, so reproducing a property failure is never memoised away", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const base = environmentSignature(root, {});
    const seeded = environmentSignature(root, { FAST_CHECK_SEED: "123" });
    const other = environmentSignature(root, { FAST_CHECK_SEED: "424242" });
    expect(new Set([base, seeded, other]).size).toBe(3);
  });

  it("declares the seed and the locale/runtime variables that move verdicts", () => {
    for (const name of ["FAST_CHECK_SEED", "TZ", "LANG", "NODE_OPTIONS", "ALLOW_PROVIDER_TESTS"]) {
      expect(OUTCOME_AFFECTING_ENV_VARS).toContain(name);
    }
    // Performance-only knobs must stay out: they would churn receipts for no verdict change.
    expect(OUTCOME_AFFECTING_ENV_VARS).not.toContain("VITEST_MAX_WORKERS");
  });

  it("does not reuse a receipt recorded under a different seed", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const first = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: {} });
    recordGateReceipt({ projectRoot: root, decision: first, exitCode: 0, env: {} });
    const seeded = consultGateReceipt({
      projectRoot: root,
      gate: "vitest",
      args: ["run"],
      env: { FAST_CHECK_SEED: "123" },
    });
    expect(seeded.reuse).toBe(false);
  });
});

describe("gate receipts — coverage-enabling argument forms (Codex review, PR #2216)", () => {
  const memoisable = (argumentList: string[]) => {
    const source = readFileSync("scripts/run-vitest.mjs", "utf8");
    const pattern = /const NON_MEMOISABLE_ARGUMENT = (\/.*\/);/.exec(source)?.[1];
    expect(pattern).toBeTruthy();
    const rx = new RegExp(pattern!.slice(1, pattern!.lastIndexOf("/")));
    return !argumentList.some((argument) => argument === "-u" || rx.test(argument));
  };

  it("refuses every accepted coverage form, not just the bare flag", () => {
    // Vitest 4.1.10 documents `--coverage.enabled`; an exact-match list memoised it and
    // would then skip a later run, leaving `coverage/` stale for the gates that read it.
    for (const form of ["--coverage", "--coverage.enabled", "--coverage=true", "--coverage.provider=v8"]) {
      expect(memoisable(["run", form]), form).toBe(false);
    }
  });

  it("refuses watch, snapshot-update and UI runs in every form", () => {
    for (const form of ["--watch", "--watch=true", "--update", "-u", "--ui"]) {
      expect(memoisable(["run", form]), form).toBe(false);
    }
  });

  it("still memoises ordinary runs", () => {
    expect(memoisable(["run"])).toBe(true);
    expect(memoisable(["run", "tests/x.test.ts", "--reporter=dot"])).toBe(true);
    expect(memoisable(["run", "--no-coverage"])).toBe(true);
  });
});

describe("gate receipts — keying", () => {
  it("separates gate, arguments, inputs and toolchain", () => {
    const base = { gate: "vitest", args: ["run"], inputHash: "i", environmentHash: "e" };
    const keys = new Set([
      receiptKey(base),
      receiptKey({ ...base, gate: "lint:internal" }),
      receiptKey({ ...base, args: ["run", "tests/x.test.ts"] }),
      receiptKey({ ...base, inputHash: "i2" }),
      receiptKey({ ...base, environmentHash: "e2" }),
    ]);
    expect(keys.size).toBe(5);
  });

  it("includes the install stamp, so a reinstall invalidates every receipt", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const before = environmentSignature(root);
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".package-lock.json"), JSON.stringify({ packages: {} }));
    expect(environmentSignature(root)).not.toBe(before);
  });
});

describe("gate receipts — recording", () => {
  it("never memoises a failure", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const decision = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: RECEIPTS_ENABLED });
    expect(recordGateReceipt({ projectRoot: root, decision, exitCode: 1, env: RECEIPTS_ENABLED }).recorded).toBe(false);
    expect(loadStore(root).gates.vitest ?? []).toHaveLength(0);
  });

  it("refuses to record when the tree changed while the gate was running", () => {
    const { root, write } = gitFixture({ "a.ts": "1\n" });
    const decision = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: RECEIPTS_ENABLED });
    write("a.ts", "2\n"); // the edit a session makes while the suite is still running
    const result = recordGateReceipt({ projectRoot: root, decision, exitCode: 0, env: RECEIPTS_ENABLED });
    expect(result.recorded).toBe(false);
    expect(result.reason).toContain("changed while the gate ran");
  });

  it("records a pass and reuses it for an identical tree", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const first = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: RECEIPTS_ENABLED });
    expect(first.reuse).toBe(false);
    expect(recordGateReceipt({ projectRoot: root, decision: first, exitCode: 0, env: RECEIPTS_ENABLED }).recorded).toBe(
      true,
    );

    const second = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: RECEIPTS_ENABLED });
    expect(second.reuse).toBe(true);
    expect(second.message).toContain("reused receipt, not a fresh run");
  });

  it("caps stored history per gate", () => {
    const store = { gates: {} as Record<string, { key: string; recordedAt: string }[]> };
    for (let index = 0; index < MAX_RECEIPTS_PER_GATE + 5; index += 1) {
      appendReceipt(store, "vitest", { key: `k${index}`, recordedAt: "2026-01-01T00:00:00.000Z" });
    }
    expect(store.gates.vitest).toHaveLength(MAX_RECEIPTS_PER_GATE);
  });
});

describe("gate receipts — wrapper contract", () => {
  it("runs once, then elides the second identical invocation", async () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    let runs = 0;
    const run = async () => {
      runs += 1;
      return 0;
    };
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);

    expect(
      await withGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], run, env: RECEIPTS_ENABLED, log }),
    ).toBe(0);
    expect(
      await withGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], run, env: RECEIPTS_ENABLED, log }),
    ).toBe(0);
    expect(runs).toBe(1);
    expect(logs.some((line) => line.includes("REUSED"))).toBe(true);
  });

  it("re-runs after a failure instead of serving the earlier pass", async () => {
    const { root, write } = gitFixture({ "a.ts": "1\n" });
    let runs = 0;
    const failing = async () => {
      runs += 1;
      return 1;
    };
    await withGateReceipt({
      projectRoot: root,
      gate: "vitest",
      args: ["run"],
      run: failing,
      env: RECEIPTS_ENABLED,
      log: () => {},
    });
    write("a.ts", "2\n");
    await withGateReceipt({
      projectRoot: root,
      gate: "vitest",
      args: ["run"],
      run: failing,
      env: RECEIPTS_ENABLED,
      log: () => {},
    });
    expect(runs).toBe(2);
  });

  it("re-runs everything under GATE_RECEIPTS=refresh", async () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    let runs = 0;
    const run = async () => {
      runs += 1;
      return 0;
    };
    const env = { GATE_RECEIPTS: "refresh" };
    await withGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], run, env, log: () => {} });
    await withGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], run, env, log: () => {} });
    expect(runs).toBe(2);
  });
});

describe("gate receipts — repository wiring", () => {
  it("passes its own self-test against this checkout", () => {
    const output = execFileSync(process.execPath, ["scripts/gate-receipts.mjs", "--self-test"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output).toContain("self-test OK");
  });

  it("keeps the receipt store inside node_modules so it is never committed", async () => {
    const { RECEIPT_STORE_RELATIVE_PATH } = await import("../scripts/gate-receipts.mjs");
    expect(RECEIPT_STORE_RELATIVE_PATH.replaceAll("\\", "/")).toMatch(/^node_modules\//);
  });

  it("wires the consult/record pair into both heavy runners", async () => {
    const { readFileSync } = await import("node:fs");
    for (const runner of ["scripts/run-heavy.mjs", "scripts/run-vitest.mjs"]) {
      const source = readFileSync(runner, "utf8");
      expect(source).toContain("consultGateReceipt");
      expect(source).toContain("recordGateReceipt");
    }
  });
});
