import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  clientChunkNamesFromManifestSource,
  clientRouteAndChunkNamesFromManifestSource,
  compareToBudget,
  decideBaselineSourceWarning,
  EXIT_FAILSAFE_MS,
  exitProcess,
  findFixtureSnapshotsInChunks,
  gzipBytesOf,
  initialDashboardChunkNames,
  measureBudgetRoutes,
  measureChunkPaths,
  measureChunks,
  measureServerHtmlPayloads,
  MOCKUP_ROUTE_SEGMENT,
  normalizeManifestRoute,
  parseMaxDistance,
  partitionRouteClientChunks,
  resolveBaselineCommitDistance,
  resolveBaselineGitStatus,
  resolveBaselineSource,
  STALE_BASELINE_COMMIT_DISTANCE_THRESHOLD,
  validateBaselineProvenance,
} from "../scripts/check-bundle-budget.mjs";

const buf = (n: number) => Buffer.alloc(n, "a"); // highly compressible; gzip < raw

describe("measureChunks", () => {
  it("sums raw and gzip bytes and ranks the largest", () => {
    const m = measureChunks([
      { name: "a.js", buffer: buf(1000) },
      { name: "b.js", buffer: buf(4000) },
    ]);
    expect(m.files).toBe(2);
    expect(m.totalRawBytes).toBe(5000);
    expect(m.totalGzipBytes).toBeGreaterThan(0);
    expect(m.totalGzipBytes).toBeLessThan(m.totalRawBytes);
    expect(m.largest[0].name).toBe("b.js");
  });
});

describe("measureChunkPaths", () => {
  it("streams paths without requiring callers to retain buffers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bundle-budget-paths-"));
    try {
      const a = path.join(dir, "a.js");
      const b = path.join(dir, "b.js");
      writeFileSync(a, buf(1000));
      writeFileSync(b, buf(4000));
      const m = measureChunkPaths([a, b]);
      expect(m.files).toBe(2);
      expect(m.totalRawBytes).toBe(5000);
      expect(m.largest[0].name.endsWith("b.js")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("exitProcess", () => {
  it("exits immediately when stdout write buffer is empty", () => {
    const exitImpl = vi.fn();
    const stdout = {
      write: vi.fn(() => true),
      once: vi.fn(),
    };
    const setTimer = vi.fn(() => ({ unref: vi.fn() }));
    exitProcess(0, {
      exitImpl,
      stdout,
      setTimer: setTimer as unknown as typeof setTimeout,
    });
    expect(exitImpl).toHaveBeenCalledWith(0);
    expect(stdout.once).not.toHaveBeenCalled();
    expect(setTimer).toHaveBeenCalled();
  });

  it("forces exit via failsafe when stdout drain never fires", () => {
    vi.useFakeTimers();
    try {
      const exitImpl = vi.fn();
      const stdout = {
        write: vi.fn(() => false),
        once: vi.fn(),
      };
      exitProcess(0, { exitImpl, stdout, setTimer: setTimeout, failsafeMs: EXIT_FAILSAFE_MS });
      expect(exitImpl).not.toHaveBeenCalled();
      vi.advanceTimersByTime(EXIT_FAILSAFE_MS);
      expect(exitImpl).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("check-bundle-budget CLI exit", () => {
  /** Minimal build tree: one chunk, a build manifest, and one production route. */
  function makeSandbox({
    withRouteManifests = true,
    baselineSource,
  }: { withRouteManifests?: boolean; baselineSource?: string } = {}) {
    const sandbox = mkdtempSync(path.join(tmpdir(), "bundle-budget-cli-"));
    const chunksDir = path.join(sandbox, ".next", "static", "chunks");
    mkdirSync(chunksDir, { recursive: true });
    writeFileSync(path.join(chunksDir, "main.js"), "console.log('ok')");
    writeFileSync(
      path.join(sandbox, ".next", "app-build-manifest.json"),
      JSON.stringify({
        rootMainFiles: ["static/chunks/main.js"],
        pages: { "/layout": [], "/page": [] },
      }),
    );
    if (withRouteManifests) {
      const appDir = path.join(sandbox, ".next", "server", "app");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "page_client-reference-manifest.js"),
        `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify({
          clientModules: { mod: { chunks: ["static/chunks/main.js"] } },
        })};`,
      );
    }
    writeFileSync(
      path.join(sandbox, "bundle-budget.json"),
      // Baselines well above the tiny fixture chunk so the CLI takes the success path.
      JSON.stringify({
        enforce: true,
        baselineSource,
        production: { gzipBytes: 100_000, tolerancePct: 10 },
        mockups: { gzipBytes: 100_000, tolerancePct: 25 },
        routes: {
          "/": { gzipBytes: 100_000, tolerancePct: 10 },
        },
      }),
    );
    return sandbox;
  }

  function initGitRepo(dir: string) {
    execFileSync("git", ["init"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test Runner"], { cwd: dir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  function runCli(sandbox: string, args: string[] = [], envOverrides: Record<string, string> = {}) {
    const script = path.join(process.cwd(), "scripts/check-bundle-budget.mjs");
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: sandbox,
        // GITHUB_SHA is real (and foreign to the sandbox repo) when this suite runs in CI;
        // blank it by default so baseline-source resolution falls through to the sandbox's
        // own git HEAD unless a test deliberately overrides it.
        env: { ...process.env, NODE_OPTIONS: "", BUNDLE_BUDGET_ROOT: sandbox, GITHUB_SHA: "", ...envOverrides },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`CLI hung (stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)})`));
      }, 5_000);
      child.on("error", (error) => {
        clearTimeout(killTimer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(killTimer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  it("terminates within a deadline after printing done", async () => {
    const sandbox = makeSandbox();
    const started = Date.now();
    const result = await runCli(sandbox);
    try {
      expect(
        { code: result.code, stdout: result.stdout, stderr: result.stderr },
        "CLI should exit 0 after printing done",
      ).toMatchObject({ code: 0 });
      expect(result.stdout).toContain("[bundle-budget] done.");
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("names both budgets so neither number reads as the other", async () => {
    // The reconciliation of `#013`/`#252` is only real if the output says which
    // question each number answers.
    const sandbox = makeSandbox();
    const result = await runCli(sandbox);
    try {
      expect(result.stdout).toContain("production (what users download");
      expect(result.stdout).toContain(`${MOCKUP_ROUTE_SEGMENT} (design scratch, 404s in production`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when chunks cannot be attributed to routes", async () => {
    // Without attribution the two buckets silently collapse into one, which is
    // the ambiguity this gate exists to remove.
    const sandbox = makeSandbox({ withRouteManifests: false });
    const result = await runCli(sandbox);
    try {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("cannot separate production weight");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when a discovered route manifest cannot be decoded", async () => {
    const sandbox = makeSandbox();
    const appDir = path.join(sandbox, ".next", "server", "app");
    mkdirSync(path.join(appDir, MOCKUP_ROUTE_SEGMENT, "demo"), { recursive: true });
    writeFileSync(
      path.join(appDir, MOCKUP_ROUTE_SEGMENT, "demo", "page_client-reference-manifest.js"),
      'globalThis.__RSC_MANIFEST["/mockups/demo"]={truncated',
    );
    const result = await runCli(sandbox);
    try {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("could not be decoded");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("warns without failing when a configured baseline commit cannot be resolved", async () => {
    const sandbox = makeSandbox({ baselineSource: "c".repeat(40) });
    const result = await runCli(sandbox);
    try {
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("WARN (baseline source unresolvable)");
      expect(result.stderr).toContain("Fetch the recorded baseline commit");
      expect(result.stdout).toContain("[bundle-budget] done.");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps an unresolvable baseline warning structured in JSON output", async () => {
    const sandbox = makeSandbox({ baselineSource: "c".repeat(40) });
    const result = await runCli(sandbox, ["--json"]);
    try {
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.warnings).toEqual([
        expect.objectContaining({ code: "baseline-source-unresolvable", remediation: expect.any(String) }),
      ]);
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when --refresh-baseline is run without build chunks", async () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), "bundle-budget-nobuild-"));
    try {
      const result = await runCli(sandbox, ["--refresh-baseline"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("cannot refresh baseline without a build");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when baseline source SHA is unresolvable during --refresh-baseline", async () => {
    const sandbox = makeSandbox();
    try {
      const result = await runCli(sandbox, ["--refresh-baseline"], {
        BUNDLE_BUDGET_SOURCE_SHA: "not-a-valid-sha",
        GITHUB_SHA: "",
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("could not resolve a 40-character source SHA");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when baseline source commit does not exist in git during --refresh-baseline", async () => {
    const sandbox = makeSandbox();
    initGitRepo(sandbox);
    const nonExistentSha = "0123456789abcdef0123456789abcdef01234567";
    try {
      const result = await runCli(sandbox, ["--refresh-baseline"], {
        BUNDLE_BUDGET_SOURCE_SHA: nonExistentSha,
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("baseline provenance check failed");
      expect(result.stderr).toContain("does not exist in local Git history");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when baseline source is not an ancestor of HEAD during --refresh-baseline", async () => {
    const sandbox = makeSandbox();
    initGitRepo(sandbox);
    execFileSync("git", ["checkout", "-b", "diverged-branch"], { cwd: sandbox });
    execFileSync("git", ["commit", "--allow-empty", "-m", "diverged commit", "--no-gpg-sign"], { cwd: sandbox });
    const divergedSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sandbox, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-"], { cwd: sandbox });
    execFileSync("git", ["commit", "--allow-empty", "-m", "mainline commit", "--no-gpg-sign"], { cwd: sandbox });
    try {
      const result = await runCli(sandbox, ["--refresh-baseline"], {
        BUNDLE_BUDGET_SOURCE_SHA: divergedSha,
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("baseline provenance check failed");
      expect(result.stderr).toContain("is not an ancestor of HEAD");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("enforces --max-distance threshold during --refresh-baseline", async () => {
    const sandbox = makeSandbox();
    const c1 = initGitRepo(sandbox);
    execFileSync("git", ["commit", "--allow-empty", "-m", "second commit", "--no-gpg-sign"], { cwd: sandbox });
    try {
      // Invalid distance
      const invalidResult = await runCli(sandbox, ["--refresh-baseline", "--max-distance", "invalid"], {
        BUNDLE_BUDGET_SOURCE_SHA: c1,
      });
      expect(invalidResult.code).toBe(1);
      expect(invalidResult.stderr).toContain("invalid --max-distance value");

      // Distance exceeded (c1 is 1 commit behind HEAD, max-distance is 0)
      const exceededResult = await runCli(sandbox, ["--refresh-baseline", "--max-distance", "0"], {
        BUNDLE_BUDGET_SOURCE_SHA: c1,
      });
      expect(exceededResult.code).toBe(1);
      expect(exceededResult.stderr).toContain("exceeding maximum allowed distance of 0");

      // Distance within threshold
      const okResult = await runCli(sandbox, ["--refresh-baseline", "--max-distance", "5"], {
        BUNDLE_BUDGET_SOURCE_SHA: c1,
      });
      expect(okResult.code).toBe(0);
      expect(okResult.stdout).toContain("[bundle-budget] baseline refreshed successfully:");
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("refreshes bundle-budget.json with fresh measurements and prints CI integration guidance", async () => {
    const sandbox = makeSandbox();
    const headSha = initGitRepo(sandbox);
    try {
      const result = await runCli(sandbox, ["--refresh-baseline"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[bundle-budget] baseline refreshed successfully:");
      expect(result.stdout).toContain("[bundle-budget] CI integration guidance:");
      expect(result.stdout).toContain("npm run check:bundle-budget -- --refresh-baseline");

      const written = JSON.parse(readFileSync(path.join(sandbox, "bundle-budget.json"), "utf8"));
      expect(written.baselineSource).toBe(headSha.toLowerCase());
      expect(written.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(written.production.gzipBytes).toBeGreaterThan(0);
      expect(written.routes["/"].gzipBytes).toBeGreaterThan(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("emits structured JSON reporting when --refresh-baseline --json is used", async () => {
    const sandbox = makeSandbox();
    const headSha = initGitRepo(sandbox);
    try {
      const result = await runCli(sandbox, ["--refresh-baseline", "--json"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.refreshed).toBe(true);
      expect(parsed.baselineSource).toBe(headSha.toLowerCase());
      expect(parsed.baselineCommitDistance).toBe(0);
      expect(parsed.production).toMatchObject({
        gzipBytes: expect.any(Number),
        previousGzipBytes: expect.any(Number),
      });
      expect(parsed.routes["/"]).toMatchObject({
        gzipBytes: expect.any(Number),
      });
      expect(parsed.ciGuidance).toMatchObject({
        command: "npm run check:bundle-budget -- --refresh-baseline",
      });
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps the committed comparator distinguishable from the candidate it measured", async () => {
    // Two baselines exist in every refresh run: the committed one the
    // previousGzipBytes numbers came FROM, and the candidate this run measured.
    // The response used to carry only the candidate's SHA, which reads as though
    // the drift had been measured against the commit it was measured at.
    const comparatorSha = "c".repeat(40);
    const sandbox = makeSandbox({ baselineSource: comparatorSha });
    const headSha = initGitRepo(sandbox);
    try {
      const result = await runCli(sandbox, ["--refresh-baseline", "--json"]);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.comparator.source).toBe(comparatorSha);
      expect(parsed.measurement.measuredSha).toBe(headSha.toLowerCase());
      expect(parsed.comparator.source).not.toBe(parsed.measurement.measuredSha);
      expect(parsed.measurement.distanceFromCheckedOutHead).toBe(0);
      expect(parsed.measurement.observedAt).toEqual(expect.any(String));
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("emits tolerances as data so no report has to restate them as prose", async () => {
    // The rolling issue hardcoded "10% and 25%", which silently stops being true
    // the moment either value is edited in bundle-budget.json.
    const sandbox = makeSandbox();
    initGitRepo(sandbox);
    try {
      const parsed = JSON.parse((await runCli(sandbox, ["--refresh-baseline", "--json"])).stdout);
      expect(parsed.production.tolerancePct).toBe(10);
      expect(parsed.mockups.tolerancePct).toBe(25);
      expect(parsed.routes["/"].tolerancePct).toBe(10);
      expect(parsed.comparator.tolerancePct).toMatchObject({ production: 10, mockups: 25 });
    } finally {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("compareToBudget", () => {
  it("warns when there is no baseline", () => {
    const v = compareToBudget({ totalGzipBytes: 1000 }, { enforce: true, tolerancePct: 10, totalGzipBytes: null });
    expect(v.status).toBe("warn");
    expect(v.reason).toMatch(/no baseline/);
  });

  it("passes within tolerance", () => {
    const v = compareToBudget({ totalGzipBytes: 1050 }, { enforce: true, tolerancePct: 10, totalGzipBytes: 1000 });
    expect(v.status).toBe("ok");
    expect(v.overPct).toBeCloseTo(5, 5);
  });

  it("fails over tolerance when enforcing", () => {
    const v = compareToBudget({ totalGzipBytes: 1200 }, { enforce: true, tolerancePct: 10, totalGzipBytes: 1000 });
    expect(v.status).toBe("fail");
    expect(v.overPct).toBeCloseTo(20, 5);
  });

  it("only warns over tolerance when not enforcing", () => {
    const v = compareToBudget({ totalGzipBytes: 1200 }, { enforce: false, tolerancePct: 10, totalGzipBytes: 1000 });
    expect(v.status).toBe("warn");
  });

  it("triggers a drift warning when growth exceeds warnTolerancePct while within tolerance", () => {
    const v = compareToBudget(
      { totalGzipBytes: 1060 },
      { enforce: true, tolerancePct: 10, warnTolerancePct: 5, totalGzipBytes: 1000 },
    );
    expect(v.status).toBe("warn");
    expect(v.isDriftWarning).toBe(true);
    expect(v.overPct).toBeCloseTo(6, 5);
    expect(v.reason).toContain("drift warning > 5%");
  });

  it("treats exactly-at-tolerance as ok", () => {
    const v = compareToBudget({ totalGzipBytes: 1100 }, { enforce: true, tolerancePct: 10, totalGzipBytes: 1000 });
    expect(v.status).toBe("ok");
  });

  it("treats an unchanged zero baseline as within tolerance", () => {
    // `--update` can record mockups.gzipBytes: 0; (0-0)/0 must not become NaN fail.
    const v = compareToBudget({ totalGzipBytes: 0 }, { enforce: true, tolerancePct: 25, totalGzipBytes: 0 });
    expect(v.status).toBe("ok");
    expect(v.overPct).toBe(0);
    expect(v.reason).toBe("within tolerance");
  });

  it("treats any growth from a zero baseline as over tolerance", () => {
    const v = compareToBudget({ totalGzipBytes: 40 }, { enforce: true, tolerancePct: 25, totalGzipBytes: 0 });
    expect(v.status).toBe("fail");
    expect(v.overPct).toBe(Number.POSITIVE_INFINITY);
    expect(v.reason).toContain("+∞%");
  });
});

describe("bundle baseline provenance", () => {
  const gitHead = "A".repeat(40);

  it("prefers an explicit measurement source and normalizes it", () => {
    const readHead = vi.fn(() => "b".repeat(40));
    expect(resolveBaselineSource({ BUNDLE_BUDGET_SOURCE_SHA: gitHead }, readHead)).toBe(gitHead.toLowerCase());
    expect(readHead).not.toHaveBeenCalled();
  });

  it("falls back to the current Git head and rejects malformed candidates", () => {
    expect(resolveBaselineSource({ GITHUB_SHA: "not-a-sha" }, () => "b".repeat(40))).toBe("b".repeat(40));
    expect(resolveBaselineSource({}, () => "still-not-a-sha")).toBeNull();
  });

  it("resolves baseline commit distance using git rev-list", () => {
    const mockExec = vi.fn(() => "15\n");
    const count = resolveBaselineCommitDistance(gitHead, process.cwd(), mockExec as unknown as typeof execFileSync);
    expect(count).toBe(15);
    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["-C", process.cwd(), "rev-list", "--count", `${gitHead.toLowerCase()}..HEAD`],
      expect.any(Object),
    );
  });

  it("checks that the baseline resolves and is an ancestor before distance comparison", () => {
    const mockExec = vi.fn(() => "");
    expect(resolveBaselineGitStatus(gitHead, process.cwd(), mockExec as unknown as typeof execFileSync)).toEqual({
      commitExists: true,
      comparableAsAncestor: true,
    });
    expect(mockExec).toHaveBeenNthCalledWith(
      1,
      "git",
      ["-C", process.cwd(), "cat-file", "-e", `${gitHead.toLowerCase()}^{commit}`],
      expect.any(Object),
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      2,
      "git",
      ["-C", process.cwd(), "merge-base", "--is-ancestor", gitHead.toLowerCase(), "HEAD"],
      expect.any(Object),
    );
  });

  it("returns a pure remediation warning for an unresolvable baseline source", () => {
    const warning = decideBaselineSourceWarning({
      baselineSource: gitHead,
      commitExists: false,
      comparableAsAncestor: null,
    });
    expect(warning).toMatchObject({ code: "baseline-source-unresolvable", remediation: expect.any(String) });
    expect(warning?.remediation).toContain("Fetch the recorded baseline commit");
  });

  it("returns a pure remediation warning when the baseline is not comparable as an ancestor", () => {
    const warning = decideBaselineSourceWarning({
      baselineSource: gitHead,
      commitExists: true,
      comparableAsAncestor: false,
    });
    expect(warning).toMatchObject({ code: "baseline-source-not-ancestor", remediation: expect.any(String) });
    expect(warning?.message).toContain("cannot be compared as an ancestor of HEAD");
  });

  it("does not warn when the baseline resolves as an ancestor", () => {
    expect(
      decideBaselineSourceWarning({ baselineSource: gitHead, commitExists: true, comparableAsAncestor: true }),
    ).toBeNull();
  });

  it("returns null for malformed or absent baseline commit SHA", () => {
    expect(resolveBaselineCommitDistance(null)).toBeNull();
    expect(resolveBaselineCommitDistance("not-a-sha")).toBeNull();
  });

  it("returns null when git output is malformed or non-numeric", () => {
    const mockExecTrailing = vi.fn(() => "12 commits\n");
    expect(
      resolveBaselineCommitDistance(gitHead, process.cwd(), mockExecTrailing as unknown as typeof execFileSync),
    ).toBeNull();

    const mockExecNonNumeric = vi.fn(() => "fatal: bad revision\n");
    expect(
      resolveBaselineCommitDistance(gitHead, process.cwd(), mockExecNonNumeric as unknown as typeof execFileSync),
    ).toBeNull();
  });
  it("defines a default stale baseline commit distance threshold", () => {
    expect(STALE_BASELINE_COMMIT_DISTANCE_THRESHOLD).toBe(50);
  });

  describe("parseMaxDistance", () => {
    it("parses valid space-separated and equals-separated values", () => {
      expect(parseMaxDistance(["--max-distance", "10"])).toBe(10);
      expect(parseMaxDistance(["--max-distance=25"])).toBe(25);
      expect(parseMaxDistance(["--other", "flag", "--max-distance", "0"])).toBe(0);
    });

    it("returns NaN for invalid or negative values", () => {
      expect(Number.isNaN(parseMaxDistance(["--max-distance", "-5"]))).toBe(true);
      expect(Number.isNaN(parseMaxDistance(["--max-distance=foo"]))).toBe(true);
      expect(Number.isNaN(parseMaxDistance(["--max-distance"]))).toBe(true);
    });

    it("returns null when flag is omitted", () => {
      expect(parseMaxDistance([])).toBeNull();
      expect(parseMaxDistance(["--update", "--json"])).toBeNull();
    });
  });

  describe("validateBaselineProvenance", () => {
    const dummySha = "d".repeat(40);

    it("rejects malformed or non-40-hex commit SHA", () => {
      expect(validateBaselineProvenance(null)).toMatchObject({ valid: false, code: "invalid-sha" });
      expect(validateBaselineProvenance("not-a-sha")).toMatchObject({ valid: false, code: "invalid-sha" });
      expect(validateBaselineProvenance("g".repeat(40))).toMatchObject({ valid: false, code: "invalid-sha" });
    });

    it("fails when commit does not exist in git history", () => {
      const mockExec = vi.fn(() => {
        throw new Error("missing commit");
      });
      const res = validateBaselineProvenance(dummySha, {
        cwd: process.cwd(),
        exec: mockExec as unknown as typeof execFileSync,
      });
      expect(res).toMatchObject({
        valid: false,
        code: "commit-not-found",
        message: expect.stringContaining("does not exist in local Git history"),
      });
    });

    it("fails when commit exists but is not an ancestor of HEAD", () => {
      const mockExec = vi.fn((_cmd: string, args: string[]) => {
        if (args.includes("merge-base")) throw new Error("not ancestor");
        return "";
      });
      const res = validateBaselineProvenance(dummySha, {
        cwd: process.cwd(),
        exec: mockExec as unknown as typeof execFileSync,
      });
      expect(res).toMatchObject({
        valid: false,
        code: "not-ancestor",
        message: expect.stringContaining("is not an ancestor of HEAD"),
      });
    });

    it("fails when commit distance is unresolvable", () => {
      const mockExec = vi.fn((_cmd: string, args: string[]) => {
        if (args.includes("rev-list")) throw new Error("rev-list error");
        return "";
      });
      const res = validateBaselineProvenance(dummySha, {
        cwd: process.cwd(),
        exec: mockExec as unknown as typeof execFileSync,
      });
      expect(res).toMatchObject({
        valid: false,
        code: "distance-unresolvable",
        message: expect.stringContaining("Could not determine commit distance"),
      });
    });

    it("fails when commit distance exceeds maxDistance threshold", () => {
      const mockExec = vi.fn((_cmd: string, args: string[]) => {
        if (args.includes("rev-list")) return "15\n";
        return "";
      });
      const res = validateBaselineProvenance(dummySha, {
        cwd: process.cwd(),
        maxDistance: 10,
        exec: mockExec as unknown as typeof execFileSync,
      });
      expect(res).toMatchObject({
        valid: false,
        code: "distance-exceeded",
        commitDistance: 15,
        message: expect.stringContaining("exceeding maximum allowed distance of 10"),
      });
    });

    it("passes when commit exists and is an ancestor within maxDistance", () => {
      const mockExec = vi.fn((_cmd: string, args: string[]) => {
        if (args.includes("rev-list")) return "3\n";
        return "";
      });
      const res = validateBaselineProvenance(dummySha, {
        cwd: process.cwd(),
        maxDistance: 10,
        exec: mockExec as unknown as typeof execFileSync,
      });
      expect(res).toMatchObject({
        valid: true,
        baselineSource: dummySha.toLowerCase(),
        commitDistance: 3,
        message: expect.stringContaining("3 commit(s) behind HEAD"),
      });
    });
  });
});

describe("committed route bundle budgets", () => {
  it("covers the same journeys as Lighthouse with enforced numeric baselines", () => {
    const bundle = JSON.parse(readFileSync(path.resolve("bundle-budget.json"), "utf8"));
    const lighthouse = JSON.parse(readFileSync(path.resolve("lighthouse-budget.json"), "utf8"));

    // The Lighthouse journeys come first; the main work-mode pages follow them (added by the
    // work-mode speed review, 7 Oct 2026) and carry the same enforced numeric shape.
    expect(Object.keys(bundle.routes).slice(0, lighthouse.routes.length)).toEqual(lighthouse.routes);
    for (const routeBudget of Object.values(bundle.routes) as Array<{ gzipBytes: unknown; tolerancePct: unknown }>) {
      expect(routeBudget.gzipBytes).toEqual(expect.any(Number));
      expect(routeBudget.tolerancePct).toBe(10);
    }
  });
});

describe("initial dashboard fixture boundary", () => {
  it("resolves root layout, page, and shared chunks without dynamic route chunks", () => {
    expect(
      initialDashboardChunkNames({
        rootMainFiles: ["static/chunks/main.js"],
        pages: {
          "/layout": ["static/chunks/layout.js", "static/css/layout.css"],
          "/page": ["static/chunks/page.js"],
          "/documents/[id]/page": ["static/chunks/document-viewer.js"],
        },
      }),
    ).toEqual(["main.js", "layout.js", "page.js"]);
  });

  it("resolves Next 16 root-page chunks from the client-reference manifest", () => {
    expect(
      initialDashboardChunkNames(
        {
          rootMainFiles: ["static/chunks/main-app.js"],
          pages: { "/_app": [] },
        },
        {
          clientModules: {
            home: { chunks: ["1234", "static/chunks/1234-home.js"] },
            lazy: { chunks: [] },
          },
        },
      ),
    ).toEqual(["main-app.js", "1234-home.js"]);
  });

  it("detects complete fixture marker groups in initial chunks", () => {
    const violations = findFixtureSnapshotsInChunks([
      {
        name: "page.js",
        buffer: Buffer.from("transport-crisis-form extension-transport-order detention-examination-movement"),
      },
    ]);
    expect(violations).toEqual(["forms fixture catalogue"]);
  });

  it.each([
    ["medications snapshot", ["GABA / Glutamate Modulator", "1998 mg/day", "Renal Adj."]],
    [
      "medication interaction index",
      ["generatedFrom", "sourceRowCount", "rowsWithCatalogueTarget", "medicationsWithUnresolvedRows"],
    ],
  ])("detects the complete %s marker group as prevention-only leakage", (name, markers) => {
    expect(findFixtureSnapshotsInChunks([{ name: "page.js", buffer: Buffer.from(markers.join(" ")) }])).toEqual([name]);
  });

  it.each([
    ["medications snapshot", ["GABA / Glutamate Modulator", "1998 mg/day"]],
    ["medication interaction index", ["generatedFrom", "sourceRowCount", "rowsWithCatalogueTarget"]],
  ])("does not flag %s when one low-collision marker is missing", (_name, markers) => {
    expect(findFixtureSnapshotsInChunks([{ name: "page.js", buffer: Buffer.from(markers.join(" ")) }])).toEqual([]);
  });

  it("does not flag an isolated UI string as a serialized fixture", () => {
    expect(
      findFixtureSnapshotsInChunks([{ name: "page.js", buffer: Buffer.from("Try first episode psychosis") }]),
    ).toEqual([]);
  });
});

describe("production vs mockup chunk attribution", () => {
  const manifest = (route: string, chunks: string[]) =>
    `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}]=${JSON.stringify({
      clientModules: Object.fromEntries(chunks.map((c, i) => [`mod${i}`, { chunks: [`static/chunks/${c}`] }])),
    })};`;

  /** Build an injectable fake of `.next/server/app` from a path -> contents map. */
  function fakeTree(files: Record<string, string>) {
    const readDir = (dir: string) => {
      // `partitionRouteClientChunks` correctly uses the host path separator.
      // The fixture map is deliberately repository-style POSIX paths, so make
      // the fake filesystem accept Windows paths as well.
      const normalizedDir = dir.replaceAll("\\", "/");
      const prefix = normalizedDir.endsWith("/") ? normalizedDir : `${normalizedDir}/`;
      const names = new Set<string>();
      const out: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = [];
      for (const full of Object.keys(files)) {
        if (!full.startsWith(prefix)) continue;
        const rest = full.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash < 0 ? rest : rest.slice(0, slash);
        if (names.has(name)) continue;
        names.add(name);
        out.push({ name, isDirectory: () => slash >= 0, isFile: () => slash < 0 });
      }
      return out;
    };
    return { readDir, readFile: (p: string) => files[p.replaceAll("\\", "/")] };
  }

  it("parses chunk names out of a route client-reference manifest", () => {
    const names = clientChunkNamesFromManifestSource(manifest("/page", ["a.js", "b.js"]));
    expect(names).toBeInstanceOf(Set);
    expect([...(names ?? [])]).toEqual(["a.js", "b.js"]);
  });

  it("normalizes route groups and page manifest keys", () => {
    expect(normalizeManifestRoute("/page")).toBe("/");
    expect(normalizeManifestRoute("/(search-app)/documents/search/page")).toBe("/documents/search");
    expect(clientRouteAndChunkNamesFromManifestSource(manifest("/forms/page", ["forms.js"]))?.route).toBe("/forms");
  });

  it("returns null rather than an empty set on an unparseable manifest", () => {
    // Empty set means "decoded, no client chunks"; null is the fail-closed signal.
    expect(clientChunkNamesFromManifestSource("module.exports = {}")).toBeNull();
    expect(clientChunkNamesFromManifestSource('globalThis.__RSC_MANIFEST["/x"]={oops;')).toBeNull();
  });

  it("charges a chunk shared with a production route to production, not to scratch", () => {
    // `shared.js` is reached by both, so it would be built with or without the
    // mockup — only `scratch.js` is design-scratch weight.
    const { readDir, readFile } = fakeTree({
      "app/page_client-reference-manifest.js": manifest("/page", ["shared.js"]),
      [`app/${MOCKUP_ROUTE_SEGMENT}/demo/page_client-reference-manifest.js`]: manifest("/mockups/demo", [
        "shared.js",
        "scratch.js",
      ]),
    });
    const result = partitionRouteClientChunks("app", { readDir, readFile });
    expect([...result.mockupExclusive]).toEqual(["scratch.js"]);
    expect(result.routeCount).toBe(2);
    expect(result.mockupRouteCount).toBe(1);
    expect(result.unparseable).toEqual([]);
    expect([...result.routeChunks.get("/")!]).toEqual(["shared.js"]);
  });

  it("measures shared and route-local chunks for every configured route", () => {
    const measured = [
      { name: "shared.js", gzipBytes: 100 },
      { name: "root.js", gzipBytes: 40 },
      { name: "forms.js", gzipBytes: 60 },
    ];
    const routeChunks = new Map([
      ["/", new Set(["shared.js", "root.js"])],
      ["/forms", new Set(["shared.js", "forms.js"])],
    ]);
    const result = measureBudgetRoutes(measured, routeChunks, {
      "/": { gzipBytes: 140 },
      "/forms": { gzipBytes: 160 },
    });

    expect(result.missing).toEqual([]);
    expect(result.measured).toEqual({
      "/": { gzipBytes: 140, chunks: 2 },
      "/forms": { gzipBytes: 160, chunks: 2 },
    });
  });

  it("fails closed when a configured route has no manifest", () => {
    const result = measureBudgetRoutes([], new Map([["/", new Set()]]), {
      "/": { gzipBytes: 0 },
      "/missing": { gzipBytes: 0 },
    });
    expect(result.missing).toEqual(["/missing"]);
  });

  it("treats nested mockup routes as scratch and API route manifests as production", () => {
    const { readDir, readFile } = fakeTree({
      "app/api/answer/route_client-reference-manifest.js": manifest("/api/answer", ["api.js"]),
      [`app/${MOCKUP_ROUTE_SEGMENT}/a/b/page_client-reference-manifest.js`]: manifest("/mockups/a/b", ["deep.js"]),
    });
    const result = partitionRouteClientChunks("app", { readDir, readFile });
    expect([...result.mockupExclusive]).toEqual(["deep.js"]);
    expect(result.mockupRouteCount).toBe(1);
    expect(result.unparseable).toEqual([]);
  });

  it("leaves chunks no route claims on the production side", () => {
    // Framework/polyfill/runtime chunks appear in no manifest. They must not
    // drift into the scratch bucket, which would understate production weight.
    const { readDir, readFile } = fakeTree({
      [`app/${MOCKUP_ROUTE_SEGMENT}/demo/page_client-reference-manifest.js`]: manifest("/mockups/demo", ["scratch.js"]),
    });
    const { mockupExclusive } = partitionRouteClientChunks("app", { readDir, readFile });
    const measured = [
      { name: "framework.js", gzipBytes: 100 },
      { name: "scratch.js", gzipBytes: 40 },
    ];
    expect(gzipBytesOf(measured, mockupExclusive)).toBe(40);
    const total = measured.reduce((sum, f) => sum + f.gzipBytes, 0);
    expect(total - gzipBytesOf(measured, mockupExclusive)).toBe(100);
  });

  it("reports no routes when the manifest tree is empty, so the caller can fail closed", () => {
    const { readDir, readFile } = fakeTree({});
    expect(partitionRouteClientChunks("app", { readDir, readFile }).routeCount).toBe(0);
  });

  it("surfaces a malformed mockup manifest instead of counting it as resolved", () => {
    // Counting before parse let one valid root + one truncated mockup exit 0
    // while the mockup budget silently measured nothing.
    const { readDir, readFile } = fakeTree({
      "app/page_client-reference-manifest.js": manifest("/page", ["main.js"]),
      [`app/${MOCKUP_ROUTE_SEGMENT}/demo/page_client-reference-manifest.js`]:
        'globalThis.__RSC_MANIFEST["/mockups/demo"]={truncated',
    });
    const result = partitionRouteClientChunks("app", { readDir, readFile });
    expect(result.unparseable).toEqual([`app/${MOCKUP_ROUTE_SEGMENT}/demo/page_client-reference-manifest.js`]);
    expect(result.routeCount).toBe(1);
    expect(result.mockupRouteCount).toBe(0);
    expect([...result.mockupExclusive]).toEqual([]);
  });

  it("surfaces a malformed production manifest so shared chunks cannot drift to scratch", () => {
    // Asymmetric case: production fails to parse, mockup still parses. Without
    // fail-closed attribution, `shared.js` would only appear in mockupChunks and
    // be subtracted from the production budget.
    const { readDir, readFile } = fakeTree({
      "app/page_client-reference-manifest.js": 'globalThis.__RSC_MANIFEST["/page"]={truncated',
      [`app/${MOCKUP_ROUTE_SEGMENT}/demo/page_client-reference-manifest.js`]: manifest("/mockups/demo", [
        "shared.js",
        "scratch.js",
      ]),
    });
    const result = partitionRouteClientChunks("app", { readDir, readFile });
    expect(result.unparseable).toEqual(["app/page_client-reference-manifest.js"]);
    expect(result.routeCount).toBe(1);
    expect(result.mockupRouteCount).toBe(1);
    // Caller must fail before trusting mockupExclusive; do not compute budgets from this.
    expect(result.unparseable.length).toBeGreaterThan(0);
  });
});

describe("measureServerHtmlPayloads", () => {
  it("returns missing status when server page file is absent", () => {
    const results = measureServerHtmlPayloads("app", undefined, {
      existsSync: () => false,
      readFileSync: () => Buffer.alloc(0),
    });
    expect(results["/mockups/development/clinical-sign-off"]).toMatchObject({
      found: false,
      status: "missing",
    });
  });

  it("measures server page HTML within ceiling as ok", () => {
    const results = measureServerHtmlPayloads(
      "app",
      {
        "/mockups/development/clinical-sign-off": {
          rawBytesCeiling: 1000,
          gzipBytesCeiling: 200,
        },
      },
      {
        existsSync: () => true,
        readFileSync: () => Buffer.from("<html><body>Sign-off queue content</body></html>"),
      },
    );
    const measurement = results["/mockups/development/clinical-sign-off"];
    expect(measurement.found).toBe(true);
    expect(measurement.status).toBe("ok");
    expect(measurement.rawBytes).toBeGreaterThan(0);
    expect(measurement.gzipBytes).toBeGreaterThan(0);
  });

  it("fails when server page HTML exceeds raw or gzip ceiling", () => {
    const results = measureServerHtmlPayloads(
      "app",
      {
        "/mockups/development/clinical-sign-off": {
          rawBytesCeiling: 10,
          gzipBytesCeiling: 5,
        },
      },
      {
        existsSync: () => true,
        readFileSync: () => Buffer.from("<html><body>Very long repetitive HTML payload content here</body></html>"),
      },
    );
    const measurement = results["/mockups/development/clinical-sign-off"];
    expect(measurement.found).toBe(true);
    expect(measurement.status).toBe("fail");
    expect(measurement.reason).toContain("exceeds");
  });

  it("resolves a route that Next emitted inside a route group", () => {
    // `/sources/search` is built to `(search-app)/sources/search/page.js`: Next
    // strips route groups from the URL but keeps them in the output tree. Almost
    // every route in this app lives in a group, so a measurer that only looked
    // at the flat path would report every configured route as missing.
    const results = measureServerHtmlPayloads(
      "app",
      { "/sources/search": { rawBytesCeiling: 5000, gzipBytesCeiling: 1000, required: true } },
      {
        existsSync: (p) => p === path.join("app", "(search-app)", "sources", "search", "page.js"),
        readFileSync: () => Buffer.from("export default function Page() { return null; }"),
        readdirSync: () => ["(search-app)", "api", "sources"],
      },
    );
    const measurement = results["/sources/search"];
    expect(measurement.found).toBe(true);
    expect(measurement.status).toBe("ok");
    expect(measurement.file).toBe(path.join("app", "(search-app)", "sources", "search", "page.js"));
  });

  it("finds server page artifact when only page.js candidate exists", () => {
    const results = measureServerHtmlPayloads(
      "app",
      {
        "/mockups/development/clinical-sign-off": {
          rawBytesCeiling: 5000,
          gzipBytesCeiling: 1000,
        },
      },
      {
        existsSync: (p) => p.endsWith("page.js"),
        readFileSync: () => Buffer.from("export default function Page() { return null; }"),
      },
    );
    const measurement = results["/mockups/development/clinical-sign-off"];
    expect(measurement.found).toBe(true);
    expect(measurement.status).toBe("ok");
  });
});
