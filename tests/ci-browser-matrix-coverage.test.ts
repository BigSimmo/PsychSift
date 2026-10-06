import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { sourceFrom } from "./helpers/source-contract";
import { projectsForPrUiShard } from "../scripts/playwright-pr-shards.mjs";
import { RELEASE_SHARDED_PROJECTS } from "../scripts/playwright-release-shards.mjs";

/*
 * `release-browser-matrix` partitions Firefox and each WebKit project independently.
 *
 * Why that shape needs a guard of its own: before 2026-09-07 the job ran
 * chromium-mockups + firefox + webkit sequentially in ONE job under
 * `workers: 1` / `fullyParallel: false`, and it stopped finishing — measured
 * 70m23s (run 34100540973) and 70m20s (run 34104496596), both landing exactly on
 * the then-70-minute cap. GitHub reports a timed-out job as `cancelled`, so
 * every main run concluded cancelled while every other job passed, and the
 * matrix produced NO verdict at all. `main` had zero Firefox/WebKit coverage
 * rather than failing coverage, which is the strictly worse state and the one
 * nobody notices.
 *
 * Splitting by engine fixes the wall-clock. It also introduces the one hazard
 * that a single job did not have: the fail-safe path used to run bare
 * `npm run test:e2e`, which means EVERY project in playwright.config.ts. Spread
 * across engines, that set is now written out by hand, so a project added to the
 * config later would simply never run — and nothing would go red to say so.
 *
 * These cases exist to make that impossible. They re-derive the engine groups
 * from ci.yml and the project list from playwright.config.ts, and fail closed on
 * any divergence. Do not relax them to accommodate a new project; add the
 * project to the right engine group instead.
 */

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const playwrightConfig = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
const parsedWorkflow = createRequire(import.meta.url)("js-yaml").load(workflow);
type WorkflowStep = {
  name: string;
  if?: string;
  run?: string;
  with: Record<string, string>;
  env: Record<string, string>;
  "continue-on-error"?: boolean;
};

const releaseJob = sourceFrom(workflow, "  release-browser-matrix:", {
  label: "release-browser-matrix job definition",
});

/** Every project name declared in playwright.config.ts. */
function configuredProjects(): string[] {
  const names = [...playwrightConfig.matchAll(/^\s*name:\s*"([^"]+)"/gm)].map((match) => match[1]);
  expect(names.length, "playwright.config.ts declared no projects — the regex above has drifted").toBeGreaterThan(0);
  return names;
}

/**
 * The `--project=` flags each engine runs, split by the two branches of the
 * step's `if`. The first `case` block is the primary path (production Chromium
 * already proven in this run); the second is the fail-safe path that must cover
 * everything.
 */
function engineProjects(branch: "primary" | "failsafe"): Map<string, string[]> {
  const caseBlocks = [...releaseJob.matchAll(/case "\$ENGINE" in\n([\s\S]*?)\n\s*esac/g)].map((match) => match[1]);
  expect(caseBlocks.length, 'expected exactly two `case "$ENGINE"` blocks in the matrix step').toBe(2);

  const block = caseBlocks[branch === "primary" ? 0 : 1];
  const byEngine = new Map<string, string[]>();
  for (const line of block.split("\n")) {
    const engine = /^\s*([a-z]+)\)\s+PROJECTS=/.exec(line);
    if (!engine) continue;
    byEngine.set(
      engine[1],
      line.includes("--project=$BROWSER_PROJECT")
        ? [
            ...new Set<string>(
              parsedWorkflow.jobs["release-browser-matrix"].strategy.matrix.include
                .filter((job: { engine: string }) => job.engine === engine[1])
                .map((job: { project: string }) => job.project),
            ),
          ]
        : [...line.matchAll(/--project=([\w-]+)/g)].map((match) => match[1]),
    );
  }
  return byEngine;
}

describe("release-browser-matrix engine coverage", () => {
  it("declares one job per engine and does not buy time with a longer timeout", () => {
    expect(
      new Set(
        parsedWorkflow.jobs["release-browser-matrix"].strategy.matrix.include.map(
          (job: { engine: string }) => job.engine,
        ),
      ),
    ).toEqual(new Set(["chromium", "firefox", "webkit"]));
    expect(releaseJob).toContain("fail-fast: false");

    // A single-worker suite is not made faster by a longer cap. Raising this
    // back above the old 70 restores the exact defect: a job that runs for over
    // an hour and then reports nothing.
    const timeout = /timeout-minutes:\s*(\d+)/.exec(releaseJob);
    expect(timeout, "release-browser-matrix must declare a timeout").not.toBeNull();
    expect(Number(timeout?.[1])).toBeLessThanOrEqual(45);
  });

  it("runs every configured Playwright project on the fail-safe path", () => {
    const byEngine = engineProjects("failsafe");
    expect([...byEngine.keys()].sort()).toEqual(["chromium", "firefox", "webkit"]);

    const covered = [...byEngine.values()].flat();
    expect(
      [...covered].sort(),
      "a playwright.config.ts project is missing from the fail-safe engine groups, so it would never run in CI",
    ).toEqual([...configuredProjects()].sort());
  });

  it("never runs the same project on two engines", () => {
    for (const branch of ["primary", "failsafe"] as const) {
      const covered = [...engineProjects(branch).values()].flat();
      expect(new Set(covered).size, `${branch} path runs a project on more than one engine`).toBe(covered.length);
    }
  });

  it("covers every project on the primary path except those actually proved by PR shards", () => {
    const byEngine = engineProjects("primary");
    const alreadyProven = new Set([1, 2, 3].flatMap((shard) => projectsForPrUiShard(shard)));
    expect([...byEngine.values()].flat().sort()).toEqual(
      configuredProjects()
        .filter((project) => !alreadyProven.has(project))
        .sort(),
    );

    // `chromium` (the production project) is the one the ui-critical job already
    // proved in this run. Re-running it here is the waste the primary path exists
    // to avoid — but only Chromium, never the cross-engine backstop.
    expect([...byEngine.values()].flat()).not.toContain("chromium");
    expect([...byEngine.values()].flat()).toContain("firefox");
    expect([...byEngine.values()].flat()).toContain("webkit");
    expect([...byEngine.values()].flat()).toContain("mobile-webkit");
    expect([...byEngine.values()].flat()).toContain("mobile-pwa-standalone");
  });

  it("runs all partitions while keeping the shorter Chromium suite on one runner", () => {
    const jobs = parsedWorkflow.jobs["release-browser-matrix"].strategy.matrix.include as Array<{
      engine: string;
      project: string;
      shard: number;
      total: number;
    }>;
    expect(jobs).toHaveLength(16);
    for (const [project, engine, total] of [
      ["chromium-mockups", "chromium", 1],
      ["firefox", "firefox", 3],
      ["webkit", "webkit", 2],
      ["mobile-webkit", "webkit", 5],
      ["mobile-pwa-standalone", "webkit", 5],
    ] as const) {
      expect(jobs.filter((job) => job.project === project)).toEqual(
        Array.from({ length: total }, (_, index) => ({ project, engine, shard: index + 1, total })),
      );
    }
    expect(releaseJob).toContain("BROWSER_PROJECT: ${{ matrix.project }}");
    expect(releaseJob).toContain('webkit)   PROJECTS="--project=$BROWSER_PROJECT"');
    expect(releaseJob).toContain("SHARD: ${{ matrix.shard }}");
    expect(releaseJob).toContain("SHARD_TOTAL: ${{ matrix.total }}");
    // Split legs take a duration-balanced file group (tests/playwright-release-shards.test.ts
    // proves every spec lands on exactly one leg) and still run through scripts/run-playwright.mjs.
    expect(releaseJob).toContain('node scripts/playwright-release-shards.mjs $PROJECTS --shard="$SHARD/$SHARD_TOTAL"');
    expect(releaseJob).not.toContain("npm run test:e2e -- $PROJECTS --shard=");
    for (const job of jobs.filter((leg) => leg.total > 1)) {
      expect(RELEASE_SHARDED_PROJECTS, `${job.project} is split but has no measured shard timings`).toContain(
        job.project,
      );
    }
    expect(releaseJob).toContain("--global-timeout=1800000");
  });

  it("keeps browser archives isolated by engine and installs that engine on cache hits too", () => {
    const steps = parsedWorkflow.jobs["release-browser-matrix"].steps as WorkflowStep[];
    const cache = steps.find((step) => step.name === "Restore browser cache");
    expect(cache?.with.key).toBe(
      "playwright-engine-${{ matrix.engine }}-${{ runner.os }}-${{ hashFiles('package-lock.json') }}",
    );
    expect(cache?.with["restore-keys"].trim()).toBe("playwright-engine-${{ matrix.engine }}-${{ runner.os }}-");
    expect(releaseJob).toContain("BROWSER_ENGINE: ${{ matrix.engine }}");
    expect(releaseJob).toContain('npx playwright install-deps "$BROWSER_ENGINE"');
    expect(releaseJob).toContain('npx playwright install "$BROWSER_ENGINE"');
    expect(releaseJob).toContain('npx playwright install --with-deps "$BROWSER_ENGINE"');
  });

  it("reuses only the same run's matching production build, preserving the mockup build and no-producer fallback", () => {
    const job = parsedWorkflow.jobs["release-browser-matrix"];
    const steps = job.steps as WorkflowStep[];
    const download = steps.find((step) => step.name === "Download matching production browser build");
    const run = steps.find((step) => step.name === "Full browser UI matrix");
    const producer = parsedWorkflow.jobs["ui-playwright-build"].steps as WorkflowStep[];
    const build = producer.find((step) => step.name === "Build isolated Next app for Playwright");
    const upload = producer.find((step) => step.name === "Upload Playwright Next build");
    expect(job.needs).toContain("ui-playwright-build");
    expect(job.if).toContain(
      "(needs.ui-playwright-build.result == 'success' || needs.ui-playwright-build.result == 'skipped')",
    );
    expect(build?.run).toBe("node scripts/run-playwright.mjs --project=chromium");
    expect(download?.if).toBe("matrix.engine != 'chromium' && needs.ui-playwright-build.result == 'success'");
    expect(download?.with.name).toBe(upload?.with.name);
    // The upload names the build root plus one negated exclusion (the webpack build cache,
    // which a reuse-only consumer never reads). The root is still what the consumer downloads
    // into, and nothing but `dist/cache/webpack` may be excluded: `dist/cache/fetch-cache` is
    // read at runtime, and dropping any other part of the root would break `next start`.
    const uploadPaths = String(upload?.with.path).trim().split("\n");
    expect(uploadPaths).toEqual([
      ".next-playwright/ci-${{ github.run_id }}",
      "!.next-playwright/ci-${{ github.run_id }}/dist/cache/webpack",
    ]);
    expect(download?.with.path).toBe(uploadPaths[0]);
    expect(download?.with["run-id"]).toBeUndefined();
    expect(run?.env.PLAYWRIGHT_BUILD_ROOT_ID).toBe(build?.env.PLAYWRIGHT_BUILD_ROOT_ID);
    expect(run?.env.PLAYWRIGHT_REUSE_BUILD).toBe(
      "${{ matrix.engine != 'chromium' && needs.ui-playwright-build.result == 'success' }}",
    );
    expect(download?.["continue-on-error"]).toBeUndefined();
    const runner = readFileSync(new URL("../scripts/run-playwright.mjs", import.meta.url), "utf8");
    expect(runner).toContain("if (reuseBuild && !distReady)");
    expect(runner).toContain("is missing a usable Next build");
  });

  it("uploads diagnostics under a per-project and partition artifact name", () => {
    // A shared name makes the second failing engine fail on upload, so the
    // engine that failed second loses its trace exactly when it is needed.
    expect(releaseJob).toContain(
      "release-ui-diagnostics-${{ github.run_id }}-${{ matrix.project }}-${{ matrix.shard }}",
    );
  });
});
