import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childProcessExitCode, childProcessFailureSummary } from "../scripts/child-process-result.mjs";
import {
  offlineTestEnvironment,
  offlineUrlValues,
  providerFreeCloudLiveTestGap,
  providerEnvironmentKeys,
  requireProviderTestPermission,
} from "../scripts/test-environment.mjs";
import { acquireHeavyRunLock, testRunLockInternals } from "../scripts/test-run-lock.mjs";
import { typescriptBuildInfoPath, vitestCacheDirectory } from "../scripts/test-cache-path.mjs";
import { vitestLeaseMode } from "../scripts/test-run-selection.mjs";
import { redactSensitiveText } from "../scripts/sensitive-text.mjs";
import { recursiveRemovalRetryOptions, removePathSync } from "../scripts/retryable-fs.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) removePathSync(directory, { recursive: true });
});

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return /\.(?:test|spec)\.[jt]sx?$/.test(entry.name) ? [filePath] : [];
  });
}

function propertyAssignment(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return objectLiteral.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name,
  );
}

function isRmSyncCall(expression: ts.LeftHandSideExpression) {
  return (
    (ts.isIdentifier(expression) && expression.text === "rmSync") ||
    (ts.isPropertyAccessExpression(expression) && expression.name.text === "rmSync")
  );
}

function scriptKindFor(filePath: string) {
  switch (path.extname(filePath)) {
    case ".js":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function unsafeRecursiveRmSyncCalls(sourceText: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const unsafe: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isRmSyncCall(node.expression)) {
      const options = node.arguments[1];
      if (options && ts.isObjectLiteralExpression(options)) {
        const recursive = propertyAssignment(options, "recursive");
        if (recursive?.initializer.kind === ts.SyntaxKind.TrueKeyword) {
          const retries = propertyAssignment(options, "maxRetries");
          const retryCount =
            retries && ts.isNumericLiteral(retries.initializer) ? Number(retries.initializer.text) : Number.NaN;
          if (!Number.isFinite(retryCount) || retryCount <= 0) unsafe.push(node.getText(sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return unsafe;
}

function requireLeasePath(lease: { path?: string }) {
  if (!lease.path) throw new Error("Expected an acquired test lease to have a path");
  return lease.path;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for coordinator test condition");
}

describe("child process results", () => {
  it("never treats a missing status, signal, or launch error as success", () => {
    expect(childProcessExitCode({ status: null, signal: "SIGTERM" })).toBe(1);
    expect(childProcessExitCode({ status: null, signal: null })).toBe(1);
    expect(childProcessExitCode({ status: null, error: new Error("launch failed") })).toBe(1);
    expect(childProcessExitCode({ status: 0 })).toBe(0);
    expect(childProcessExitCode({ status: 7 })).toBe(7);
    expect(childProcessFailureSummary({ status: null, signal: "SIGTERM" })).toBe("missing exit status, signal SIGTERM");
  });

  it("maps a real missing executable launch to failure", () => {
    const result = spawnSync(`clinical-kb-missing-command-${Date.now()}`, []);
    expect(result.error).toBeTruthy();
    expect(childProcessExitCode(result)).toBe(1);
  });
});

describe("temporary path cleanup", () => {
  it("uses Windows-tolerant recursive removal for ephemeral runner state", () => {
    expect(recursiveRemovalRetryOptions).toEqual({ maxRetries: 5, retryDelay: 100 });
    const directory = temporaryDirectory("clinical-kb-retryable-removal-");
    writeFileSync(path.join(directory, "artifact.txt"), "temporary", "utf8");
    removePathSync(directory, { recursive: true });
    expect(existsSync(directory)).toBe(false);
  });

  it("retries transient file removal failures that Node only retries recursively", () => {
    let calls = 0;
    removePathSync(
      "ignored",
      {},
      {
        remove() {
          calls += 1;
          if (calls < 3) throw Object.assign(new Error("handle retained"), { code: "EPERM" });
        },
      },
    );
    expect(calls).toBe(3);
  });

  it("keeps lock and browser runners on the shared cleanup path", () => {
    for (const runner of ["test-run-lock.mjs", "run-playwright.mjs", "run-lighthouse-budget.mjs"]) {
      const source = readFileSync(new URL(`../scripts/${runner}`, import.meta.url), "utf8");
      expect(source).toContain('import { removePathSync } from "./retryable-fs.mjs";');
      expect(source).not.toContain("rmSync(");
    }
  });

  it("scopes retry validation to each rmSync options object regardless of option order", () => {
    const sourceText = `
    rmSync("unsafe", { recursive: true }); // maxRetries: 5
    "maxRetries: 5";
    rmSync("safe", { maxRetries: 5, recursive: true });
    fs.rmSync("also-safe", { recursive: true, maxRetries: 5 });
  `;
    expect(unsafeRecursiveRmSyncCalls(sourceText, "fixture.ts")).toEqual(['rmSync("unsafe", { recursive: true })']);
  });

  it("requires bounded retries for every recursive test-fixture cleanup", () => {
    const testsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
    for (const filePath of sourceFiles(testsRoot)) {
      const unsafe = unsafeRecursiveRmSyncCalls(readFileSync(filePath, "utf8"), filePath);
      expect(unsafe, `${filePath}\n${unsafe.join("\n")}`).toEqual([]);
    }
  });
});

describe("repository-wide heavyweight lock", () => {
  it("lets exclusive work queue through long browser or build leases without making focused runs wait indefinitely", () => {
    expect(testRunLockInternals.defaultWaitTimeoutFor("shared")).toBe(30_000);
    expect(testRunLockInternals.defaultWaitTimeoutFor("exclusive")).toBe(15 * 60_000);
  });

  it("uses a workspace-local identity only when a packaged build context has no Git metadata", () => {
    const projectRoot = temporaryDirectory("clinical-kb-no-git-");
    const baseDirectory = temporaryDirectory("clinical-kb-no-git-lock-");
    writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "prompt-for-codex-medical-knowledge-base" }),
    );

    const lock = acquireHeavyRunLock({ projectRoot, baseDirectory, environment: {}, command: "docker build" });
    const expectedIdentity = path.resolve(projectRoot);
    expect(lock.owner.repositoryIdentity).toBe(
      process.platform === "win32" ? expectedIdentity.toLowerCase() : expectedIdentity,
    );
    lock.release();
  });

  it("waits for a newly-created ownerless coordinator root instead of entering partial state", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-initializing-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const lockPath = testRunLockInternals.lockPathFor(repositoryIdentity, baseDirectory);
    mkdirSync(lockPath, { recursive: true });

    expect(() =>
      acquireHeavyRunLock({
        projectRoot: path.join(baseDirectory, "worktree-a"),
        repositoryIdentity,
        baseDirectory,
        environment: {},
        command: "focused-a",
        mode: "shared",
        waitTimeoutMs: 0,
      }),
    ).toThrow(/coordinator is being initialized/);
  });

  it("does not bypass a live legacy single-owner lock", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-legacy-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const lockPath = testRunLockInternals.lockPathFor(repositoryIdentity, baseDirectory);
    const legacyOwner = {
      pid: process.pid,
      token: "legacy-owner",
      command: "legacy full suite",
      worktree: path.join(baseDirectory, "legacy-worktree"),
      repositoryIdentity,
      startedAt: new Date().toISOString(),
    };
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify(legacyOwner, null, 2)}\n`, "utf8");

    expect(() =>
      acquireHeavyRunLock({
        projectRoot: path.join(baseDirectory, "worktree-a"),
        repositoryIdentity,
        baseDirectory,
        environment: {},
        command: "focused-a",
        mode: "shared",
        waitTimeoutMs: 0,
      }),
    ).toThrow(/focused-test capacity is full/);
    expect(readFileSync(path.join(lockPath, "owner.json"), "utf8")).toContain("legacy-owner");
  });

  it("blocks another worktree but permits a nested child with the owner token", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const first = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "first",
    });

    expect(() =>
      acquireHeavyRunLock({
        projectRoot: path.join(baseDirectory, "worktree-b"),
        repositoryIdentity,
        baseDirectory,
        environment: {},
        command: "second",
        waitTimeoutMs: 0,
      }),
    ).toThrow(/Another Database heavyweight command is active/);

    const nested = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-b"),
      repositoryIdentity,
      baseDirectory,
      environment: first.environment,
      command: "nested",
    });
    expect(nested.reentrant).toBe(true);
    nested.release();
    first.release();
  });

  it("fails a blocked Playwright run instead of accepting an empty pass-with-no-tests result", () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const baseDirectory = temporaryDirectory("clinical-kb-playwright-admission-");
    const repositoryIdentity = testRunLockInternals.resolveRepositoryIdentity(projectRoot);
    const blockingLock = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "other-worktree"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "other worktree Playwright run",
    });
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      HEAVY_RUN_WAIT_TIMEOUT_MS: "0",
      TEMP: baseDirectory,
      TMP: baseDirectory,
      TMPDIR: baseDirectory,
      // The runner must reach lease admission before attempting a browser launch.
      // A real browser is deliberately unnecessary because the foreign lease
      // rejects this invocation first.
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.execPath,
    };
    delete childEnvironment[testRunLockInternals.tokenEnvironmentKey];
    delete childEnvironment[testRunLockInternals.pathEnvironmentKey];

    try {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/run-playwright.mjs",
          "--project=chromium",
          "--grep",
          "clinical-kb-never-matches",
          "--pass-with-no-tests",
        ],
        { cwd: projectRoot, encoding: "utf8", env: childEnvironment },
      );
      const output = `${result.stdout}${result.stderr}`;

      expect(childProcessExitCode(result)).toBe(75);
      expect(output).toContain("DATABASE_HEAVY_RUN_ADMISSION_BUSY");
      expect(output).toContain("Playwright did not run: Another Database heavyweight command is active");
      expect(output).toContain("Wait for the active heavyweight run to finish, then retry this command.");
      expect(output).not.toContain("Building isolated production Playwright app");
      expect(output).not.toMatch(/\b0 passed\b/);
    } finally {
      blockingLock.release();
    }
  });

  it("does not mistake a mismatched inherited lease for admission contention", () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const baseDirectory = temporaryDirectory("clinical-kb-playwright-inherited-mismatch-");
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      TEMP: baseDirectory,
      TMP: baseDirectory,
      TMPDIR: baseDirectory,
      // A real browser is unnecessary: the mismatched inherited lease throws
      // before any launch attempt.
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.execPath,
      // Point the inherited lock env vars at a path/token that cannot belong to
      // this repository's coordinator. This reproduces a configuration error
      // (a stale or foreign inherited lease), not admission contention — the
      // busy matcher must not swallow it into a "wait and retry" exit.
      [testRunLockInternals.tokenEnvironmentKey]: "mismatched-token",
      [testRunLockInternals.pathEnvironmentKey]: path.join(baseDirectory, "unrelated-lease-path"),
    };

    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-playwright.mjs",
        "--project=chromium",
        "--grep",
        "clinical-kb-never-matches",
        "--pass-with-no-tests",
      ],
      { cwd: projectRoot, encoding: "utf8", env: childEnvironment },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(childProcessExitCode(result)).toBe(1);
    expect(output).not.toContain("DATABASE_HEAVY_RUN_ADMISSION_BUSY");
    expect(output).toContain("The inherited Database heavyweight-run lease does not match this repository.");
    expect(output).not.toContain("Wait for the active heavyweight run to finish, then retry this command.");
  });

  it("admits two focused leases from different worktrees while keeping heavyweight work exclusive", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-shared-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const first = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "focused-a",
      mode: "shared",
    });
    const second = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-b"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "focused-b",
      mode: "shared",
    });

    try {
      expect(first.owner.mode).toBe("shared");
      expect(second.owner.mode).toBe("shared");
      expect(first.path).not.toBe(second.path);
      const sentinel = JSON.parse(readFileSync(path.join(first.coordinatorPath, "owner.json"), "utf8")) as {
        pid: number;
        holderPid: number;
        coordinator: boolean;
      };
      expect(sentinel.coordinator).toBe(true);
      expect(sentinel.holderPid).toBe(process.pid);
      expect(testRunLockInternals.processIsAlive(sentinel.pid)).toBe(true);
      expect(() =>
        acquireHeavyRunLock({
          projectRoot: path.join(baseDirectory, "worktree-c"),
          repositoryIdentity,
          baseDirectory,
          environment: {},
          command: "focused-c",
          mode: "shared",
          waitTimeoutMs: 0,
        }),
      ).toThrow(/focused-test capacity is full/);
      expect(() =>
        acquireHeavyRunLock({
          projectRoot: path.join(baseDirectory, "worktree-c"),
          repositoryIdentity,
          baseDirectory,
          environment: {},
          command: "full-suite",
          waitTimeoutMs: 0,
        }),
      ).toThrow(/Another Database heavyweight command is active/);

      const nested = acquireHeavyRunLock({
        projectRoot: path.join(baseDirectory, "worktree-b"),
        repositoryIdentity,
        baseDirectory,
        environment: second.environment,
        command: "nested",
        mode: "shared",
      });
      expect(nested.reentrant).toBe(true);

      first.release();
      const replacement = acquireHeavyRunLock({
        projectRoot: path.join(baseDirectory, "worktree-c"),
        repositoryIdentity,
        baseDirectory,
        environment: {},
        command: "focused-c",
        mode: "shared",
        waitTimeoutMs: 0,
      });
      replacement.release();
    } finally {
      first.release();
      second.release();
    }
  });

  it("does not admit overlapping focused runs from the same worktree", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-same-worktree-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const projectRoot = path.join(baseDirectory, "worktree-a");
    const first = acquireHeavyRunLock({
      projectRoot,
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "focused-a",
      mode: "shared",
    });
    try {
      expect(() =>
        acquireHeavyRunLock({
          projectRoot,
          repositoryIdentity,
          baseDirectory,
          environment: {},
          command: "focused-a-second",
          mode: "shared",
          waitTimeoutMs: 0,
        }),
      ).toThrow(/focused-test capacity is full/);
    } finally {
      first.release();
    }
  });

  it("gives a queued heavyweight process priority over later focused work", async () => {
    const baseDirectory = temporaryDirectory("clinical-kb-fair-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const first = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "focused-a",
      mode: "shared",
    });
    const lockModuleUrl = new URL("../scripts/test-run-lock.mjs", import.meta.url).href;
    const childSource = `
      import path from "node:path";
      import { acquireHeavyRunLock } from ${JSON.stringify(lockModuleUrl)};
      const lock = acquireHeavyRunLock({
        projectRoot: path.join(process.env.COORDINATOR_TEST_BASE, "worktree-exclusive"),
        repositoryIdentity: process.env.COORDINATOR_TEST_IDENTITY,
        baseDirectory: process.env.COORDINATOR_TEST_BASE,
        environment: {},
        command: "full-suite",
        waitTimeoutMs: 5000,
      });
      console.log("exclusive-acquired");
      await new Promise((resolve) => setTimeout(resolve, 50));
      lock.release();
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
      env: {
        ...process.env,
        COORDINATOR_TEST_BASE: baseDirectory,
        COORDINATOR_TEST_IDENTITY: repositoryIdentity,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const childResult = new Promise<number>((resolve) => child.on("close", (status) => resolve(status ?? 1)));

    try {
      const queueDirectory = testRunLockInternals.coordinatorPaths(first.coordinatorPath).queue;
      // A file this poll cannot parse is not a ticket yet — keep waiting rather
      // than throwing. The coordinator's own reader has always been tolerant
      // here (`readJson` returns null and `queueRecords` filters it out); this
      // predicate was the only reader that treated a torn read as fatal, which
      // is how an IO-timing artefact surfaced as `SyntaxError: Unexpected end of
      // JSON input` instead of the priority assertion below. `writeJson` now
      // publishes via rename so the torn read cannot happen at all; this stays
      // because the test should measure ordering, not write timing.
      await waitForCondition(() =>
        readdirSync(queueDirectory).some((file) => {
          try {
            const ticket = JSON.parse(readFileSync(path.join(queueDirectory, file), "utf8")) as { mode: string };
            return ticket.mode === "exclusive";
          } catch {
            return false;
          }
        }),
      );
      expect(() =>
        acquireHeavyRunLock({
          projectRoot: path.join(baseDirectory, "worktree-b"),
          repositoryIdentity,
          baseDirectory,
          environment: {},
          command: "focused-b",
          mode: "shared",
          waitTimeoutMs: 0,
        }),
      ).toThrow(/focused-test capacity is full/);
    } finally {
      first.release();
    }

    expect(await childResult, stderr).toBe(0);
    expect(stdout).toContain("exclusive-acquired");
  });

  it("recovers a dead owner without allowing the old token to release the replacement", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-stale-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const stale = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      processId: 2_147_483_647,
      command: "dead",
    });
    const replacement = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-b"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "replacement",
    });

    stale.release();
    expect(readFileSync(path.join(requireLeasePath(replacement), "owner.json"), "utf8")).toContain(
      replacement.owner.token,
    );
    replacement.release();
  });

  it("allows an explicit force-lock-release to replace a live owner", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-force-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const first = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "first",
    });

    const replacement = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-b"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: "replacement",
      forceLockRelease: true,
    });

    expect(replacement.owner.token).not.toBe(first.owner.token);
    expect(readFileSync(path.join(requireLeasePath(replacement), "owner.json"), "utf8")).toContain(
      replacement.owner.token,
    );
    first.release();
    replacement.release();
  });

  it("keeps a live owner's lock even when startedAt is older than five minutes", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-live-old-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const first = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      processId: process.pid,
      command: "long-running",
    });

    try {
      const ownerPath = path.join(requireLeasePath(first), "owner.json");
      const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as {
        pid: number;
        token: string;
        command: string;
        worktree: string;
        repositoryIdentity: string;
        startedAt: string;
      };
      owner.startedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");

      expect(() =>
        acquireHeavyRunLock({
          projectRoot: path.join(baseDirectory, "worktree-b"),
          repositoryIdentity,
          baseDirectory,
          environment: {},
          command: "second",
          waitTimeoutMs: 0,
        }),
      ).toThrow(/Another Database heavyweight command is active/);

      const retained = JSON.parse(readFileSync(ownerPath, "utf8")) as { token: string; pid: number };
      expect(retained.token).toBe(first.owner.token);
      expect(retained.pid).toBe(process.pid);
    } finally {
      first.release();
    }
  });

  it("never persists or repeats credentials embedded in a command", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-secret-lock-");
    const repositoryIdentity = path.join(baseDirectory, "shared.git");
    const exposed = ["crsr", "example_worker_credential_123456789"].join("_");
    const openAiExample = ["sk", "example-secret-123456"].join("-");
    const first = acquireHeavyRunLock({
      projectRoot: path.join(baseDirectory, "worktree-a"),
      repositoryIdentity,
      baseDirectory,
      environment: {},
      command: `worker --api-key ${exposed} OPENAI_API_KEY=${openAiExample}`,
    });

    try {
      const ownerText = readFileSync(path.join(requireLeasePath(first), "owner.json"), "utf8");
      expect(ownerText).not.toContain(exposed);
      expect(ownerText).not.toContain(openAiExample);
      expect(ownerText).toContain("[REDACTED]");
      expect(() =>
        acquireHeavyRunLock({
          projectRoot: path.join(baseDirectory, "worktree-b"),
          repositoryIdentity,
          baseDirectory,
          environment: {},
          command: "second",
          waitTimeoutMs: 0,
        }),
      ).toThrow(/\[REDACTED\]/);
    } finally {
      first.release();
    }
  });
});

describe("focused test admission", () => {
  it("shares only explicit focused selections and keeps broad or custom-worker runs exclusive", () => {
    expect(vitestLeaseMode(["related", "--run", "src/lib/example.ts"])).toBe("shared");
    expect(vitestLeaseMode(["run", "tests/example.test.ts", "--reporter=dot"])).toBe("shared");
    expect(vitestLeaseMode(["run", "tests/example.dom.test.tsx"])).toBe("shared");
    expect(vitestLeaseMode(["run", "--reporter=dot"])).toBe("exclusive");
    expect(vitestLeaseMode(["run", "tests/example.test.ts", "--coverage"])).toBe("exclusive");
    expect(vitestLeaseMode(["run", "tests/example.test.ts", "--coverage.enabled"])).toBe("exclusive");
    expect(vitestLeaseMode(["run", "tests/example.test.ts", "--maxWorkers=4"])).toBe("exclusive");
    expect(vitestLeaseMode(["run", "tests/example.test.ts", "--max-workers=4"])).toBe("exclusive");
    expect(vitestLeaseMode(["run", "tests/example.test.ts", "-c", "vitest.other.mts"])).toBe("exclusive");
  });

  it("uses different transform-cache directories for different worktrees", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-vitest-cache-");
    const first = vitestCacheDirectory(path.join(baseDirectory, "worktree-a"), baseDirectory);
    const second = vitestCacheDirectory(path.join(baseDirectory, "worktree-b"), baseDirectory);
    expect(first).not.toBe(second);
    expect(path.dirname(first)).toBe(path.join(baseDirectory, "clinical-kb-vitest-cache"));
  });

  it("uses different TypeScript incremental state for different worktrees", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-tsc-cache-");
    const first = typescriptBuildInfoPath(path.join(baseDirectory, "worktree-a"), baseDirectory);
    const second = typescriptBuildInfoPath(path.join(baseDirectory, "worktree-b"), baseDirectory);
    expect(first).not.toBe(second);
    expect(path.dirname(path.dirname(first))).toBe(path.join(baseDirectory, "clinical-kb-tsc-cache"));
    expect(path.basename(first)).toBe("tsconfig.tsbuildinfo");
  });

  it("keeps distinct buildinfo filenames for base vs source-only typecheck", () => {
    const baseDirectory = temporaryDirectory("clinical-kb-tsc-cache-names-");
    const root = path.join(baseDirectory, "worktree");
    const base = typescriptBuildInfoPath(root, baseDirectory, "tsconfig.tsbuildinfo");
    const source = typescriptBuildInfoPath(root, baseDirectory, "tsconfig.typecheck.tsbuildinfo");
    expect(path.dirname(base)).toBe(path.dirname(source));
    expect(base).not.toBe(source);
    expect(path.basename(source)).toBe("tsconfig.typecheck.tsbuildinfo");
  });
});

describe("sensitive diagnostic text", () => {
  it("redacts CLI flags, environment assignments, bearer values, URLs, and JWTs", () => {
    const jwt = "eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop";
    const cursorExample = ["crsr", "example_1234567890"].join("_");
    const otherCursorExample = ["crsr", "other_1234567890"].join("_");
    const supabaseSecretExample = ["sb", "secret", "example_1234567890"].join("_");
    const value = [
      `agent --api-key ${cursorExample}`,
      `CURSOR_API_KEY=${otherCursorExample}`,
      `supabase --token ${supabaseSecretExample}`,
      "Authorization: Bearer bearer-value-123456",
      "https://worker:password-value@example.com/path",
      jwt,
    ].join(" ");
    const redacted = redactSensitiveText(value);

    expect(redacted).not.toContain(cursorExample);
    expect(redacted).not.toContain(otherCursorExample);
    expect(redacted).not.toContain(supabaseSecretExample);
    expect(redacted).not.toContain("bearer-value-123456");
    expect(redacted).not.toContain("password-value");
    expect(redacted).not.toContain(jwt);
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(6);
  });
});

describe("provider-safe test environment", () => {
  it("removes provider credentials and explicit live-test permission", () => {
    const source = Object.fromEntries(providerEnvironmentKeys.map((key) => [key, `secret-${key}`]));
    const environment: Record<string, string | undefined> = offlineTestEnvironment({
      ...source,
      SAFE_VALUE: "kept",
    });

    expect(environment).toMatchObject({
      SAFE_VALUE: "kept",
      RAG_PROVIDER_MODE: "offline",
      NEXT_PUBLIC_DEMO_MODE: "true",
    });
    for (const key of providerEnvironmentKeys) {
      expect(environment[key]).toBe(offlineUrlValues[key as keyof typeof offlineUrlValues] ?? "");
    }
    // Credentials join the scrub inventory; the control flags deliberately do
    // not — they are forced off instead, so nothing demands that a non-secret
    // name be scrubbed from setup and raw-env checks too.
    expect(providerEnvironmentKeys).toEqual(
      expect.arrayContaining(["SENTRY_AUTH_TOKEN", "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"]),
    );
    expect(providerEnvironmentKeys).not.toContain("SENTRY_ENABLE_LOGS");
    expect(providerEnvironmentKeys).not.toContain("SENTRY_SEND_TEST_LOG");
    expect(providerEnvironmentKeys).not.toContain("SENTRY_TRACES_SAMPLE_RATE");
    expect(environment.SENTRY_AUTH_TOKEN).toBe("");
    // Explicit blank pins the key so Next/Vite cannot reload a live DSN from
    // `.env.local` during Playwright/Lighthouse `next build` / `next start`.
    // `optionalUrlEnv` in `src/lib/env.ts` coerces "" to unset for Zod.
    expect(environment.SENTRY_DSN).toBe("");
    expect(environment.NEXT_PUBLIC_SENTRY_DSN).toBe("");
    expect(environment.SENTRY_ENABLE_LOGS).toBe("false");
    expect(environment.SENTRY_SEND_TEST_LOG).toBe("false");
    expect(environment.SENTRY_TRACES_SAMPLE_RATE).toBe("0");
  });

  it("keeps Sentry DSNs pinned blank so a repository-local env file cannot restore a live destination", () => {
    // Simulate the inheritance shape Next would see after `.env.local` load:
    // both a live DSN on the parent and a would-be reload candidate. The offline
    // wrapper must overwrite both names with an explicit blank (present, falsy).
    const liveDsn = "https://real-key@o123.ingest.sentry.io/456";
    const environment: Record<string, string | undefined> = offlineTestEnvironment({
      SENTRY_DSN: liveDsn,
      NEXT_PUBLIC_SENTRY_DSN: liveDsn,
      SENTRY_AUTH_TOKEN: "sntrys_live_token",
      SENTRY_TRACES_SAMPLE_RATE: "0.1",
      SENTRY_ENABLE_LOGS: "true",
    });

    expect(environment.SENTRY_DSN).toBe("");
    expect(environment.NEXT_PUBLIC_SENTRY_DSN).toBe("");
    expect(environment.SENTRY_DSN).not.toBe(liveDsn);
    expect(environment.SENTRY_AUTH_TOKEN).toBe("");
    expect(environment.SENTRY_TRACES_SAMPLE_RATE).toBe("0");
    expect(environment.SENTRY_ENABLE_LOGS).toBe("false");
    // Presence (not absence) is load-bearing: Next only skips `.env*` reload for
    // names already set on process.env.
    expect(Object.hasOwn(environment, "SENTRY_DSN")).toBe(true);
    expect(Object.hasOwn(environment, "NEXT_PUBLIC_SENTRY_DSN")).toBe(true);
  });

  it("requires explicit permission before live tests can run", () => {
    expect(() => requireProviderTestPermission({})).toThrow(/ALLOW_PROVIDER_TESTS=true/);
    expect(() => requireProviderTestPermission({ ALLOW_PROVIDER_TESTS: "true" })).not.toThrow();
  });

  it("reports the intentional Cloud credential boundary after live-test authorization", () => {
    const environment = {
      ALLOW_PROVIDER_TESTS: "true",
      CODEX_CLOUD: "1",
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
      RAG_PROVIDER_MODE: "offline",
      NEXT_PUBLIC_DEMO_MODE: "true",
      PLAYWRIGHT_OFFLINE_MODE: "true",
      OPENAI_API_KEY: "must-not-appear",
    };
    const gap = providerFreeCloudLiveTestGap(environment);
    expect(gap).toContain("agent-phase provider credentials are intentionally unavailable");
    expect(gap).not.toContain(environment.OPENAI_API_KEY);
    for (const malformedModes of [
      { RAG_PROVIDER_MODE: "openai" },
      { NEXT_PUBLIC_DEMO_MODE: "false" },
      { PLAYWRIGHT_OFFLINE_MODE: "false" },
    ]) {
      expect(providerFreeCloudLiveTestGap({ ...environment, ...malformedModes })).toContain(
        "Live provider test capability gap",
      );
    }
    expect(providerFreeCloudLiveTestGap({ ...environment, CODEX_CLOUD_ACCESS_PROFILE: undefined })).toContain(
      "Live provider test capability gap",
    );
    expect(providerFreeCloudLiveTestGap({ ...environment, CODEX_CLOUD_ACCESS_PROFILE: "connected" })).toBeNull();
  });

  it("keeps live tests out of default Vitest discovery", async () => {
    // Asserted against the loaded config rather than a literal line of its source. The guarantee
    // is "the default node project never collects a live test", and a source-text match reported
    // that guarantee broken whenever anything unrelated was added to the same exclude list --
    // a guard that goes red for the wrong reason gets edited to match the source, which is how a
    // real regression would slip through.
    type ProjectTest = { name: string; include: string[]; exclude?: string[] };
    type LoadedConfig = { default: { test: { projects: { test: ProjectTest }[] } } };

    async function nodeProject(allowProviderTests: string | undefined): Promise<ProjectTest> {
      const previous = process.env.ALLOW_PROVIDER_TESTS;
      if (allowProviderTests === undefined) delete process.env.ALLOW_PROVIDER_TESTS;
      else process.env.ALLOW_PROVIDER_TESTS = allowProviderTests;
      try {
        vi.resetModules();
        // Specifier held in a variable: a literal `.mts` path is rejected by the repository
        // tsconfig (TS5097), and this file is typechecked like any other source.
        const specifier = "../vitest.config.mts";
        const loaded = (await import(specifier)) as unknown as LoadedConfig;
        const project = loaded.default.test.projects.map((entry) => entry.test).find((t) => t.name === "node");
        if (!project) throw new Error("vitest.config.mts declares no node project");
        return project;
      } finally {
        if (previous === undefined) delete process.env.ALLOW_PROVIDER_TESTS;
        else process.env.ALLOW_PROVIDER_TESTS = previous;
        vi.resetModules();
      }
    }

    const offline = await nodeProject(undefined);
    expect(offline.include).toEqual(["tests/**/*.test.ts"]);
    expect(offline.exclude).toContain("tests/**/*.live.test.ts");

    // With permission granted the live glob becomes the only thing collected, so the offline
    // suite can never be run under provider credentials by accident either.
    const live = await nodeProject("true");
    expect(live.include).toEqual(["tests/**/*.live.test.ts"]);
    expect(live.exclude).not.toContain("tests/**/*.live.test.ts");
  });

  it("keeps residual source surfaces visible without lowering the core coverage floor", () => {
    const config = readFileSync(new URL("../vitest.config.mts", import.meta.url), "utf8");
    const coverageContract = readFileSync(new URL("../scripts/coverage-contract.mjs", import.meta.url), "utf8");
    expect(config).toContain('import { COVERAGE_INCLUDE_GLOBS } from "./scripts/coverage-contract.mjs"');
    expect(config).toContain("include: [...COVERAGE_INCLUDE_GLOBS]");
    for (const pattern of [
      '"src/**/*.{ts,tsx}"',
      '"scripts/**/*.{ts,mjs,cjs}"',
      '"worker/**/*.ts"',
      '"supabase/functions/**/*.ts"',
    ]) {
      expect(coverageContract).toContain(pattern);
    }
    expect(config).toContain('"src/{lib/**/*.ts,app/**/route.ts,components/**/*.{ts,tsx}}"');
    expect(config).not.toContain('"src/app/**/{page,layout,loading,error,not-found}.tsx"');
    expect(config).not.toContain('"src/**/*mockup*"');
  });

  it("refuses the live-test command before collection when permission is absent", () => {
    const result = spawnSync(process.execPath, ["scripts/run-live-tests.mjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      env: { ...process.env, ALLOW_PROVIDER_TESTS: "" },
      encoding: "utf8",
    });
    expect(childProcessExitCode(result)).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Live provider tests are disabled");
  });

  it("fails the authorized live-test command with a sanitized offline Cloud capability gap", () => {
    const secret = "sensitive-test-value";
    const result = spawnSync(process.execPath, ["scripts/run-live-tests.mjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      env: {
        ...process.env,
        ALLOW_PROVIDER_TESTS: "true",
        CODEX_CLOUD: "1",
        CODEX_CLOUD_ACCESS_PROFILE: "offline",
        RAG_PROVIDER_MODE: "offline",
        NEXT_PUBLIC_DEMO_MODE: "true",
        PLAYWRIGHT_OFFLINE_MODE: "true",
        OPENAI_API_KEY: secret,
      },
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(childProcessExitCode(result)).toBe(2);
    expect(output).toContain("Live provider test capability gap");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("sensitive-test");
  });

  it("loads credentials from Next environment files without accepting persisted permission", () => {
    const runner = readFileSync(new URL("../scripts/run-live-tests.mjs", import.meta.url), "utf8");
    const permissionSnapshot = "const providerTestPermission = process.env.ALLOW_PROVIDER_TESTS;";
    const permissionCheck = "requireProviderTestPermission({ ALLOW_PROVIDER_TESTS: providerTestPermission });";
    expect(runner).toContain('import nextEnv from "@next/env";');
    expect(runner).toContain("const { loadEnvConfig } = nextEnv;");
    expect(runner.indexOf(permissionSnapshot)).toBeGreaterThanOrEqual(0);
    expect(runner.indexOf(permissionSnapshot)).toBeLessThan(runner.indexOf("loadEnvConfig(projectRoot);"));
    expect(runner.indexOf("loadEnvConfig(projectRoot);")).toBeLessThan(runner.indexOf(permissionCheck));
  });

  it("fails focused selection closed for a deleted or missing explicit source path", () => {
    const result = spawnSync(process.execPath, ["scripts/test-focused.mjs", "--files", "src/missing-source.ts"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
    });
    expect(childProcessExitCode(result)).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("deleted or missing paths require the full suite");
  });

  it("builds and starts an isolated production server for Playwright", () => {
    const runner = readFileSync(new URL("../scripts/run-playwright.mjs", import.meta.url), "utf8");
    const preflight = readFileSync(new URL("../scripts/playwright-browser-preflight.mjs", import.meta.url), "utf8");
    const baseUrl = readFileSync(new URL("../scripts/playwright-base-url.ts", import.meta.url), "utf8");
    const ragRunner = readFileSync(new URL("../scripts/eval-rag-offline.mjs", import.meta.url), "utf8");
    const playwrightConfig = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
    const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(runner).toContain('["--max-old-space-size=8192", nextBin, "build", "--webpack"]');
    expect(runner).toContain('[nextBin, "start", "--hostname"');
    expect(runner).not.toContain('[nextBin, "dev", "--hostname"');
    // Next 16.3 typechecks the run-root tsconfig; TS 6 deprecates baseUrl (TS5101).
    // Keep baseUrl + src-relative paths and silence via ignoreDeprecations (#1798).
    expect(runner).toContain('ignoreDeprecations: "6.0"');
    expect(runner).toContain('baseUrl: "../.."');
    expect(runner).toContain('paths: { "@/*": ["src/*"] }');
    expect(runner).toContain('NODE_ENV: "production"');
    expect(runner).toContain('PLAYWRIGHT_OFFLINE_MODE: "true"');
    expect(runner).toContain('NEXT_PUBLIC_MOCKUPS_ENABLED: mockupProjectRequested ? "true" : "false"');
    expect(runner).toContain("process.env.PLAYWRIGHT_BUILD_ROOT_ID?.trim()");
    expect(runner).toContain('PLAYWRIGHT_KEEP_BUILD_ROOT must be unset or exactly "true"');
    expect(runner).toContain("PLAYWRIGHT_KEEP_BUILD_ROOT requires PLAYWRIGHT_BUILD_ROOT_ID");
    expect(runner).toContain("if (!keepBuildRoot)");
    // The final hosted PR run transferred a 1.09 GB run-scoped artifact and made the
    // slowest warm shard path slower than its cold critical predecessor. Each wrapper
    // now owns an isolated build instead of coupling required jobs through `.next`.
    expect(ciWorkflow).not.toContain("playwright-next-build-cache-${{ github.run_id }}");
    expect(ciWorkflow).not.toContain("Publish isolated Next.js build cache");
    expect(ciWorkflow).not.toContain("Restore isolated Next.js build cache");
    expect(ciWorkflow).not.toMatch(/playwright-next-\$\{\{\s*runner\.os\s*\}\}/);
    expect(ciWorkflow).not.toContain("path: .next-playwright/ci-production/dist/cache");
    expect(ciWorkflow).not.toContain("PLAYWRIGHT_BUILD_ROOT_ID: ci-production");
    expect(ciWorkflow).not.toContain('PLAYWRIGHT_KEEP_BUILD_ROOT: "true"');
    expect(runner).toContain("!explicitProjectRequested ||");
    // Empty 3xx bodies from legacy redirect route handlers must not fail readiness.
    expect(runner).toContain("body === null || body.includes(missingErrorComponentsNeedle)");
    expect(runner).not.toContain("if (!body || body.includes(missingErrorComponentsNeedle))");
    expect(runner).not.toContain("supabase.co");
    // Missing browser binaries must fail before the heavy lock / production build (#120).
    expect(runner).toContain("assertPlaywrightBrowsersReady(playwrightArgs);");
    expect(runner.indexOf("assertPlaywrightBrowsersReady(playwrightArgs);")).toBeLessThan(
      runner.indexOf("lock = acquireHeavyRunLock("),
    );
    expect(runner.indexOf("assertPlaywrightBrowsersReady(playwrightArgs);")).toBeLessThan(
      runner.indexOf("console.log(`Building isolated production Playwright app"),
    );
    expect(preflight).toContain("chromium_headless_shell");
    expect(preflight).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
    expect(preflight).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD");
    expect(runner).toContain("process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = preinstalledChromium.path");
    expect(packageJson.scripts["test:e2e:pr"]).toContain('--grep-invert "@quarantine|@mockup"');
    expect(packageJson.scripts["test:e2e:pr:shard"]).toContain("scripts/playwright-pr-shards.mjs");
    expect(ciWorkflow).toContain("npm run test:e2e:pr:shard -- --shard ${{ matrix.shard }} --exclude-critical");
    expect(ciWorkflow).not.toContain("--shard=${{ matrix.shard }}/3");
    expect(packageJson.scripts["test:e2e:regression"]).toContain('--grep-invert "@critical|@quarantine|@mockup"');
    expect(baseUrl.indexOf("if (!allowEnsure)")).toBeLessThan(baseUrl.indexOf("findExistingLocalProjectUrl();"));
    expect(ragRunner).toContain("cwd: projectRoot");
    expect(playwrightConfig).toContain("visual-artifacts");
  });

  it("uses webpack when shared worktree dependencies resolve outside the project", () => {
    const devRunner = readFileSync(new URL("../scripts/dev-free-port.mjs", import.meta.url), "utf8");
    expect(devRunner).toContain('fs.realpathSync(path.join(projectRoot, "node_modules"))');
    expect(devRunner).toContain('return dependenciesAreExternal ? ["--webpack"] : [];');
    expect(devRunner).toContain('args.some((arg) => ["--webpack", "--turbopack", "--turbo"].includes(arg))');
  });
});
