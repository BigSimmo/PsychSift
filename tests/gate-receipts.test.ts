import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendReceipt,
  OUTCOME_AFFECTING_ENV_VARS,
  parseRawDiff,
  pythonIdentityProgram,
  pythonToolchainSignature,
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

const syntheticPython = vi.hoisted(() => ({
  command: "gate-receipts-synthetic-python",
  identity: {
    executable: process.execPath,
    executableHash: "a".repeat(64),
    version: "3.12.0 synthetic",
    prefix: process.cwd(),
    path: ["synthetic-site-packages"],
    prerequisites: Object.fromEntries(
      ["fitz", "pymupdf", "PIL", "pytesseract"].map((name) => [
        name,
        { available: false, error: "ModuleNotFoundError", missing: name },
      ]),
    ),
    distributions: [],
  },
}));

// General receipt semantics must not depend on the host's Python installation,
// PATH or site-packages. Only this explicit synthetic command is intercepted;
// missing-runtime and executable-fixture regressions still use real subprocesses.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) =>
      args[0] === syntheticPython.command
        ? { status: 0, signal: null, stdout: JSON.stringify(syntheticPython.identity), stderr: "" }
        : Reflect.apply(actual.spawnSync, actual, args),
  };
});

/**
 * Explicit environment for every test that exercises record/reuse behaviour.
 *
 * These calls default to `process.env`, and receipts are disabled whenever `CI` is set —
 * by design, since CI must never reuse a receipt. Depending on the ambient environment
 * therefore made the suite pass locally and fail on GitHub, where the reuse assertions
 * became unreachable. CI caught it on PR #2216. Pass this wherever reuse is the subject;
 * the CI-refusal itself is asserted separately in "reuse boundaries".
 */
const RECEIPTS_ENABLED: Record<string, string | undefined> = { PYTHON_BIN: syntheticPython.command };

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

  it("changes the signature when only the WORKING-TREE mode changes", () => {
    const { root } = gitFixture({ "hook.sh": "#!/bin/bash\necho hi\n" });
    const hookPath = path.join(root, "hook.sh");
    chmodSync(hookPath, 0o755);
    if ((statSync(hookPath).mode & 0o111) === 0) {
      // Primary workstation is Windows / Dev Drive with core.fileMode=false where chmod is a no-op on disk.
      return;
    }
    const before = computeInputSignature(root, null)?.hash;
    chmodSync(hookPath, 0o644);
    expect(computeInputSignature(root, null)?.hash).not.toBe(before);
  });

  it("keeps both modes, so one cannot cancel the other", () => {
    const { root, git } = gitFixture({ "hook.sh": "#!/bin/bash\necho hi\n" });
    const hookPath = path.join(root, "hook.sh");
    chmodSync(hookPath, 0o755);
    if ((statSync(hookPath).mode & 0o111) === 0) {
      // Primary workstation is Windows / Dev Drive with core.fileMode=false where chmod is a no-op on disk.
      return;
    }
    const plain = computeInputSignature(root, null)?.hash;
    git("update-index", "--chmod=+x", "hook.sh");
    const indexOnly = computeInputSignature(root, null)?.hash;
    chmodSync(hookPath, 0o644);
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
    for (const name of ["FAST_CHECK_SEED", "TZ", "LANG", "NODE_OPTIONS", "ALLOW_PROVIDER_TESTS", "PYTHON_BIN"]) {
      expect(OUTCOME_AFFECTING_ENV_VARS).toContain(name);
    }
    // Performance-only knobs must stay out: they would churn receipts for no verdict change.
    expect(OUTCOME_AFFECTING_ENV_VARS).not.toContain("VITEST_MAX_WORKERS");
  });

  it("does not reuse a receipt recorded under a different seed", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const first = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: RECEIPTS_ENABLED });
    expect(recordGateReceipt({ projectRoot: root, decision: first, exitCode: 0, env: RECEIPTS_ENABLED }).recorded).toBe(
      true,
    );
    const seeded = consultGateReceipt({
      projectRoot: root,
      gate: "vitest",
      args: ["run"],
      env: { ...RECEIPTS_ENABLED, FAST_CHECK_SEED: "123" },
    });
    expect(seeded.reuse).toBe(false);
  });
});

describe("gate receipts — external Python identity", () => {
  const identity = () => ({
    executable: path.resolve("synthetic-python"),
    executableHash: "a".repeat(64),
    version: "3.12.0 synthetic",
    prefix: path.resolve("synthetic-prefix"),
    path: ["synthetic-site-packages"],
    prerequisites: Object.fromEntries(
      ["fitz", "pymupdf", "PIL", "pytesseract"].map((name) => [
        name,
        {
          available: true,
          version: "1.0",
          path: path.resolve("synthetic-site-packages", name),
        },
      ]),
    ),
    distributions: [["PyMuPDF", "1.0"]],
  });
  const signature = (payload: unknown) =>
    pythonToolchainSignature(
      process.cwd(),
      {},
      {
        probe: (() => ({ status: 0, signal: null, stdout: JSON.stringify(payload) })) as unknown as typeof spawnSync,
      },
    );

  it("fingerprints executable, interpreter and prerequisite availability/version independently", () => {
    const base = identity();
    const signatures = [
      signature(base),
      signature({ ...base, executable: path.resolve("other-python") }),
      signature({ ...base, executableHash: "b".repeat(64) }),
      signature({ ...base, version: "3.13.0 synthetic" }),
      signature({
        ...base,
        prerequisites: { ...base.prerequisites, fitz: { available: false, error: "ModuleNotFoundError" } },
      }),
      signature({
        ...base,
        prerequisites: { ...base.prerequisites, fitz: { ...base.prerequisites.fitz, version: "2.0" } },
      }),
      signature({ ...base, distributions: [["PyMuPDF", "2.0"]] }),
    ];
    expect(signatures.every(Boolean)).toBe(true);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("uses a bounded shell-free probe and refuses failed, malformed or unidentifiable output", () => {
    const probe = vi.fn(() => ({ status: 0, signal: null, stdout: JSON.stringify(identity()) }));
    expect(
      pythonToolchainSignature(
        process.cwd(),
        { PYTHON_BIN: " synthetic-python " },
        {
          probe: probe as unknown as typeof spawnSync,
        },
      ),
    ).toBeTruthy();
    expect(probe.mock.calls[0]).toEqual([
      "synthetic-python",
      ["-c", expect.any(String)],
      expect.objectContaining({ timeout: 5000, maxBuffer: 1024 * 1024, shell: false, killSignal: "SIGKILL" }),
    ]);
    expect(signature({ ...identity(), prerequisites: {} })).toBeNull();
    expect(signature({ ...identity(), version: "" })).toBeNull();
    for (const result of [
      { status: 1, stdout: JSON.stringify(identity()) },
      { status: null, signal: "SIGKILL", stdout: JSON.stringify(identity()) },
      { status: 0, error: new Error("probe failed"), stdout: JSON.stringify(identity()) },
      { status: 0, stdout: "not JSON" },
    ]) {
      expect(
        pythonToolchainSignature(
          process.cwd(),
          {},
          {
            probe: (() => result) as unknown as typeof spawnSync,
          },
        ),
      ).toBeNull();
    }
  });

  it("executes the Python probe with importable modules that lack metadata or file identity", ({ skip }) => {
    const python = process.env.PYTHON_BIN?.trim() || (process.platform === "win32" ? "python" : "python3");
    const controlledImports = `
import importlib, importlib.metadata, types
paths = {"fitz": "/synthetic/fitz.py", "pymupdf": None, "PIL": "/synthetic/PIL.py"}
def controlled_import(name):
    if name == "pytesseract":
        return types.SimpleNamespace()
    return types.SimpleNamespace(__file__=paths[name])
def controlled_version(name):
    if name == "PyMuPDF" or name == "pytesseract":
        raise importlib.metadata.PackageNotFoundError(name)
    return "1.0-synthetic"
importlib.import_module = controlled_import
importlib.metadata.version = controlled_version
importlib.metadata.distributions = lambda: []
`;
    const options = {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8" as const,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      shell: false,
    };
    const execute = (program: string) => spawnSync(python, ["-c", program], options);
    const first = execute(controlledImports + pythonIdentityProgram);
    if (first.error && "code" in first.error && first.error.code === "ENOENT")
      return skip("Python is unavailable for the actual probe regression");
    expect(first.error).toBeUndefined();
    expect(first.status, first.stderr).toBe(0);
    const observed = JSON.parse(first.stdout);
    expect(observed.prerequisites.fitz).toMatchObject({
      available: false,
      imported: true,
      error: "PrerequisiteIdentityUnavailable",
      version: null,
      pathError: null,
      metadataError: "PackageNotFoundError",
    });
    expect(observed.prerequisites.fitz.path).toContain("fitz.py");
    expect(observed.prerequisites.pymupdf).toMatchObject({
      available: false,
      path: null,
      pathError: "ModulePathUnavailable",
      metadataError: "PackageNotFoundError",
    });
    expect(observed.prerequisites.pytesseract).toMatchObject({
      available: false,
      path: null,
      pathError: "ModulePathUnavailable",
      metadataError: "PackageNotFoundError",
    });
    expect(observed.prerequisites.PIL).toMatchObject({ available: true, version: "1.0-synthetic" });
    const firstSignature = signature(observed);
    expect(firstSignature).toBeTruthy();
    const repeat = execute(controlledImports + pythonIdentityProgram);
    expect(repeat.status, repeat.stderr).toBe(0);
    expect(signature(JSON.parse(repeat.stdout))).toBe(firstSignature);
    const repairedMetadata = execute(
      controlledImports + '\nimportlib.metadata.version = lambda name: "1.0-synthetic"\n' + pythonIdentityProgram,
    );
    expect(repairedMetadata.status, repairedMetadata.stderr).toBe(0);
    const repaired = JSON.parse(repairedMetadata.stdout);
    expect(repaired.prerequisites.fitz.available).toBe(true);
    expect(repaired.prerequisites.pymupdf).toMatchObject({
      available: false,
      version: "1.0-synthetic",
      pathError: "ModulePathUnavailable",
      metadataError: null,
    });
    expect(signature(repaired)).not.toBe(firstSignature);
    // A valid prerequisite state must still not rescue an invalid runtime.
    expect(signature({ ...observed, executableHash: "" })).toBeNull();
  });

  it("executes the Python probe with damaged distribution metadata without losing other identities", ({ skip }) => {
    const python = process.env.PYTHON_BIN?.trim() || (process.platform === "win32" ? "python" : "python3");
    const controlledDistributions = `
import importlib, importlib.metadata, types
importlib.import_module = lambda name: types.SimpleNamespace(__file__="/synthetic/" + name + ".py")
importlib.metadata.version = lambda name: "1.0-synthetic"
class RaisingDistribution:
    _path = "/synthetic/raising.dist-info"
    @property
    def metadata(self):
        raise OSError("synthetic metadata failure")
    @property
    def version(self):
        raise ValueError("synthetic version failure")
inventory = [
    types.SimpleNamespace(metadata={"Name": "healthy-package"}, version="1.0", _path="/synthetic/healthy.dist-info"),
    types.SimpleNamespace(metadata={}, version=None, _path="/synthetic/missing.dist-info"),
    RaisingDistribution(),
    types.SimpleNamespace(metadata={"Name": " "}, version="", _path="/synthetic/blank.dist-info"),
    types.SimpleNamespace(metadata={"Name": 17}, version={}, _path="/synthetic/nonstring.dist-info"),
]
importlib.metadata.distributions = lambda: inventory
`;
    const execute = (extra = "") =>
      spawnSync(python, ["-c", controlledDistributions + extra + pythonIdentityProgram], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        shell: false,
      });
    const first = execute();
    if (first.error && "code" in first.error && first.error.code === "ENOENT")
      return skip("Python is unavailable for the actual probe regression");
    expect(first.error).toBeUndefined();
    expect(first.status, first.stderr).toBe(0);
    const observed = JSON.parse(first.stdout);
    expect(observed.distributions).toContainEqual(["healthy-package", "1.0"]);
    const unidentified = observed.distributions.filter((entry: unknown) => !Array.isArray(entry)) as Array<{
      identified: boolean;
      name: string | null;
      version: string | null;
      path: string | null;
      nameError: string | null;
      versionError: string | null;
      pathError: string | null;
    }>;
    expect(unidentified).toHaveLength(4);
    expect(
      unidentified.every((entry) => entry.identified === false && entry.name === null && entry.version === null),
    ).toBe(true);
    expect(new Set(unidentified.map((entry) => entry.path)).size).toBe(4);
    expect(unidentified.find((entry) => entry.path?.endsWith("missing.dist-info"))).toMatchObject({
      nameError: "KeyError",
      versionError: "DistributionVersionUnavailable",
    });
    expect(unidentified.find((entry) => entry.path?.endsWith("raising.dist-info"))).toMatchObject({
      nameError: "OSError",
      versionError: "ValueError",
    });
    for (const suffix of ["blank.dist-info", "nonstring.dist-info"]) {
      expect(unidentified.find((entry) => entry.path?.endsWith(suffix))).toMatchObject({
        nameError: "DistributionNameUnavailable",
        versionError: "DistributionVersionUnavailable",
      });
    }
    const firstSignature = signature(observed);
    expect(firstSignature).toBeTruthy();
    const reverse = execute("\ninventory.reverse()\n");
    expect(reverse.status, reverse.stderr).toBe(0);
    expect(signature(JSON.parse(reverse.stdout))).toBe(firstSignature);
    const repaired = execute('\ninventory[1].metadata = {"Name": "repaired-package"}\ninventory[1].version = "2.0"\n');
    expect(repaired.status, repaired.stderr).toBe(0);
    const repairedIdentity = JSON.parse(repaired.stdout);
    expect(repairedIdentity.distributions).toContainEqual(["repaired-package", "2.0"]);
    expect(signature(repairedIdentity)).not.toBe(firstSignature);
    expect(signature({ ...observed, executableHash: "" })).toBeNull();
    expect(signature({ ...observed, distributions: [{ identified: false }] })).toBeNull();
    expect(
      signature({ ...observed, distributions: [{ ...unidentified[0], path: null, pathError: "OSError" }] }),
    ).toBeNull();
    expect(signature({ ...observed, distributions: [{ ...unidentified[0], path: "relative.dist-info" }] })).toBeNull();
  });

  it("does not depend on Python availability for lint or typecheck receipts", () => {
    const { root } = gitFixture({ "a.ts": "1\n" });
    const env = { PYTHON_BIN: path.join(root, "missing-python") };
    for (const gate of ["lint:internal", "typecheck:internal"]) {
      const first = consultGateReceipt({ projectRoot: root, gate, env });
      expect(recordGateReceipt({ projectRoot: root, decision: first, exitCode: 0, env }).recorded).toBe(true);
      expect(consultGateReceipt({ projectRoot: root, gate, env }).reuse).toBe(true);
    }
    const vitest = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env });
    expect(vitest.reuse).toBe(false);
    expect(vitest.key).toBeNull();
    expect(recordGateReceipt({ projectRoot: root, decision: vitest, exitCode: 0, env }).recorded).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "invalidates real receipts when an external prerequisite changes without a source edit",
    () => {
      const { root } = gitFixture({ "a.ts": "1\n" });
      const external = path.join(root, "node_modules");
      mkdirSync(external);
      const python = path.join(external, "synthetic-python");
      const payload = path.join(external, "identity.json");
      writeFileSync(
        python,
        `#!${process.execPath}\nconst fs = require('node:fs'); process.stdout.write(fs.readFileSync(${JSON.stringify(payload)}));\n`,
      );
      chmodSync(python, 0o755);
      const base = identity();
      writeFileSync(payload, JSON.stringify(base));
      const env = { PYTHON_BIN: python };
      const first = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env });
      expect(recordGateReceipt({ projectRoot: root, decision: first, exitCode: 0, env }).recorded).toBe(true);
      expect(consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env }).reuse).toBe(true);
      for (const changed of [
        { ...base, version: "3.13.0 synthetic" },
        { ...base, prerequisites: { ...base.prerequisites, fitz: { ...base.prerequisites.fitz, version: "2.0" } } },
        { ...base, prerequisites: { ...base.prerequisites, fitz: { available: false, error: "ImportError" } } },
      ]) {
        writeFileSync(payload, JSON.stringify(changed));
        const after = consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env });
        expect(after.inputHash).toBe(first.inputHash);
        expect(after.reuse).toBe(false);
        expect(recordGateReceipt({ projectRoot: root, decision: first, exitCode: 0, env }).recorded).toBe(false);
      }
      const missingEnv = { PYTHON_BIN: path.join(external, "missing-python") };
      expect(consultGateReceipt({ projectRoot: root, gate: "vitest", args: ["run"], env: missingEnv }).reuse).toBe(
        false,
      );
    },
  );
});

describe("gate receipts — coverage-enabling argument forms (Codex review, PR #2216)", () => {
  // Exercise the runner's real decision rather than scraping its source text, so a
  // reformat of scripts/run-vitest.mjs cannot silently blind these assertions.
  const memoisable = async (argumentList: string[]) => {
    const { vitestRunIsMemoisable } = await import("../scripts/run-vitest.mjs");
    return vitestRunIsMemoisable(argumentList) as boolean;
  };

  it("refuses every accepted coverage form, not just the bare flag", async () => {
    // Vitest 4.1.10 documents `--coverage.enabled`; an exact-match list memoised it and
    // would then skip a later run, leaving `coverage/` stale for the gates that read it.
    for (const form of ["--coverage", "--coverage.enabled", "--coverage=true", "--coverage.provider=v8"]) {
      expect(await memoisable(["run", form]), form).toBe(false);
    }
  });

  it("refuses watch, snapshot-update and UI runs in every form", async () => {
    for (const form of ["--watch", "--watch=true", "--update", "-u", "--ui"]) {
      expect(await memoisable(["run", form]), form).toBe(false);
    }
  });

  it("still memoises ordinary runs", async () => {
    expect(await memoisable(["run"])).toBe(true);
    expect(await memoisable(["run", "tests/x.test.ts", "--reporter=dot"])).toBe(true);
    expect(await memoisable(["run", "--no-coverage"])).toBe(true);
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
    const env = { ...RECEIPTS_ENABLED, GATE_RECEIPTS: "refresh" };
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
