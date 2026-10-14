import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

/**
 * DELIVERY, NOT DETECTION (ledger #T82ND3 and #TN512M).
 *
 * `pr-required` answers "is this change broken?". Until this routing job existed nothing answered
 * "is `main` broken right now?", and a post-merge failure has nothing left to block: measured
 * 2026-09-16, CI on `main` failed six of its last eight pushes since 2026-09-13 with no workflow
 * reporting it, and a re-read of the four most recent red runs on 2026-09-18 found the only failing
 * jobs were `release-browser-matrix (firefox)` and `(webkit)` while `pr-required` went green each
 * time. The routing job is the entire fix, so it is the part most worth pinning — silence is the
 * state the repository returns to if it is removed.
 */
describe("main CI failure routing", () => {
  const routingIndex = workflow.indexOf("  main-failure-routing:");
  const routing = workflow.slice(routingIndex);

  it("routes a red main run to a pinned issue, which is its only delivery path", () => {
    expect(routingIndex).toBeGreaterThan(-1);
    expect(routing).toContain('const title = "CI on main is failing"');
    expect(routing).toContain("issues.create(");
  });

  // Only `main` pushes. A pull request already has `pr-required` blocking it, and opening an issue
  // per red branch push would make the label meaningless within a day.
  it("fires only on pushes to main", () => {
    expect(routing).toMatch(/github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  });

  /**
   * `always()`, not `!cancelled()`. A cancelled `main` run verified nothing, and a run that quietly
   * verified nothing is exactly the invisibility this job exists to end — `cancel-in-progress` is
   * deliberately disabled for base-branch pushes for the same reason.
   */
  it("still reports when the run was cancelled rather than failed", () => {
    expect(routing).toContain("always() && github.event_name == 'push'");
    expect(routing).toContain('value === "cancelled"');
  });

  /**
   * An alert that never clears becomes wallpaper, which is the failure mode #9Z197J records for the
   * browser matrix. A green run must close the issue, so an open issue always means main is red now.
   */
  it("closes the issue on the next green main run", () => {
    expect(routing).toMatch(/if \(!red\)/);
    expect(routing).toContain('state: "closed"');
  });

  /**
   * Owner decision, 2026-09-26: main flips red and green often, and a fresh issue per red spell made
   * 25 alerts in a day. A new red spell reopens the latest issue this job closed, matched by marker
   * only (never by title), so a person's own issue is never reopened.
   */
  it("reopens its most recent closed issue instead of opening a new one", () => {
    expect(routing).toContain('state: "closed",');
    expect(routing).toMatch(
      /closed\.find\(\(issue\) => !issue\.pull_request && String\(issue\.body \?\? ""\)\.includes\(MARKER\)\)/,
    );
    expect(routing).toContain('state: "open", title, body');
    expect(routing.indexOf('state: "open", title, body')).toBeLessThan(routing.indexOf("issues.create("));
  });

  /**
   * Ownership is matched on this job's own marker first. `?? open[0]` was removed from live-drift's
   * equivalent for a reason worth not relearning: harmless when updating a body, but on the green
   * path it CLOSES whatever it matched, and closing someone else's issue is not recoverable by a
   * workflow.
   */
  it("matches its own issue by marker or exact title, never by 'first labelled issue'", () => {
    expect(routing).toContain('const label = "main-ci-failure"');
    expect(routing).toContain("<!-- main-ci-routing:v1 -->");
    expect(routing).toMatch(/const owned = \(issue\) =>[\s\S]*?MARKER[\s\S]*?issue\.title === title/);
    expect(routing).not.toContain("?? open[0]");
  });

  /**
   * The issue is close to useless if it only says the run was red. #9Z197J is a standing failure of
   * two named matrix legs, and naming them is what turns "main is red again" into a row somebody can
   * already recognise. The job listing is read-only and falls back to the declared results, so a
   * naming failure can never swallow the alert itself.
   */
  it("names the failing jobs, including individual matrix legs", () => {
    expect(routing).toContain("listJobsForWorkflowRun");
    expect(routing).toContain("actions: read");
    expect(routing).toContain("### Failing jobs");
    expect(routing).toMatch(/jobListing = `unavailable/);
  });

  /**
   * `issues: write` must stay scoped to a job that never checks out or executes repository code —
   * the same split live-drift.yml and live-domain-monitor.yml use. Every other job in ci.yml keeps
   * the workflow-level `contents: read`.
   */
  it("keeps issues: write on a job that runs no repository code", () => {
    const beforeRouting = workflow
      .slice(0, routingIndex)
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(beforeRouting).not.toContain("issues: write");
    expect(routing).not.toContain("actions/checkout@");
    expect(routing).not.toContain("setup-node-cached");
  });

  /**
   * Step results travel through `env:`, never inline template expansion inside `script:`. An
   * expression interpolated into the script body is a template-injection surface, and the commit
   * subject read here is attacker-influenceable text on any branch that reaches main.
   */
  it("passes every run-derived value through env rather than inline expansion", () => {
    expect(routing).toContain("HEAD_MESSAGE: ${{ github.event.head_commit.message }}");
    expect(routing).toContain("process.env.HEAD_MESSAGE");
    const script = routing.slice(routing.indexOf("script: |"));
    expect(script).not.toMatch(/\$\{\{/);
  });

  /**
   * REPORT ONLY. `scripts/check-github-action-pins.mjs` forbids workflow-authored branch mutation,
   * and a red `main` is a fact to deliver, not to auto-repair.
   */
  it("mutates nothing", () => {
    expect(routing).not.toContain("updateBranch");
    expect(routing).not.toContain("pulls.merge");
    expect(routing).not.toContain("git push");
  });

  /**
   * #9Z197J's recorded remedy, verbatim in effect: do NOT add `release-browser-matrix` to
   * `pr-required`'s needs. It never runs on a `pull_request` event, so aggregating a skipped job
   * would change nothing while making every PR wait on a ~45-minute matrix. The post-merge signal is
   * the fix. This pins the decision so a later edit has to argue with it.
   */
  it("does not make the browser matrix a PR-required check", () => {
    const prRequired = workflow.slice(
      workflow.indexOf("  pr-required:"),
      workflow.indexOf("  release-browser-matrix:"),
    );
    expect(prRequired).not.toContain("release-browser-matrix");
    expect(routing).toContain("needs: [pr-required, release-browser-matrix, visual-baseline]");
  });

  /**
   * DEPLOY GATE (ledger #HYSWAF, owner choice "Report only", 2026-10-09). Railway's "Wait for CI"
   * skips a production deploy when any Actions workflow on the pushed commit concludes failure,
   * reading whole runs, not jobs. On main the browser matrix is continue-on-error so a red Safari leg
   * cannot skip the deploy of every screen change. Everywhere else it still blocks.
   */
  it("lets a red browser-matrix leg report without failing the main run", () => {
    const matrix = workflow.slice(workflow.indexOf("  release-browser-matrix:"), routingIndex);
    // Main pushes only: the routing job runs only there, so a scheduled or dispatched run must stay red.
    expect(matrix).toMatch(
      /^ {4}continue-on-error: \$\{\{ github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' \}\}$/m,
    );
    // Exactly one continue-on-error in the job: the main-only one above, nothing at step level.
    expect(matrix.match(/continue-on-error:/g)).toHaveLength(1);
  });
});

type Issue = { number: number; title: string; body: string; pull_request?: unknown };
type ListedJob = { name: string; conclusion: string | null };
type RoutingScript = (github: unknown, context: unknown, core: unknown) => Promise<void>;

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => RoutingScript;

// Same extraction shape as tests/live-drift-workflow.test.ts: `script: |` at ten spaces, so the
// body is everything indented twelve or more.
function routingScriptSource() {
  const routing = workflow.slice(workflow.indexOf("  main-failure-routing:"));
  const marker = "          script: |\n";
  const lines = routing.slice(routing.indexOf(marker) + marker.length).split("\n");
  const body: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      body.push("");
      continue;
    }
    if (!line.startsWith("            ")) break;
    body.push(line.slice(12));
  }
  return body.join("\n");
}

const RUN_SHA = "0123456789abcdef0123456789abcdef01234567";
const ROUTED_SHA = "fedcba9876543210fedcba9876543210fedcba98";

async function runRouting(options: {
  results: { prRequired: string; matrix: string; visual: string };
  jobs?: ListedJob[];
  listingFails?: boolean;
  openIssues?: Issue[];
  closedIssues?: Issue[];
  /** Per-call open-issue reads (the last entry repeats), to model the pinned issue changing mid-run. */
  openIssuesByCall?: Issue[][];
  /** Per-call closed-issue reads (the last entry repeats). */
  closedIssuesByCall?: Issue[][];
  /** Make the nth (1-based) open-issue read reject. */
  failOpenReadOnCall?: number;
  /** What `compareCommits` reports for the run's commit against the last routed one, or an Error to reject. */
  compare?: "behind" | "ahead" | "identical" | "diverged" | Error;
}) {
  const created: Array<{ title: string; body: string }> = [];
  const closed: number[] = [];
  const updates: Array<{ issue_number: number; state?: string; body?: string }> = [];
  const comments: number[] = [];
  const compared: Array<{ base: string; head: string }> = [];
  let openReads = 0;
  let closedReads = 0;
  const github = {
    paginate: async () => {
      if (options.listingFails) throw new Error("Resource not accessible by integration");
      return options.jobs ?? [];
    },
    rest: {
      actions: { listJobsForWorkflowRun: () => undefined },
      issues: {
        listForRepo: async ({ state }: { state: string }) => {
          if (state === "open") {
            openReads += 1;
            if (options.failOpenReadOnCall === openReads) throw new Error("API rate limit exceeded");
            const calls = options.openIssuesByCall;
            return { data: calls ? calls[Math.min(openReads, calls.length) - 1]! : (options.openIssues ?? []) };
          }
          closedReads += 1;
          const calls = options.closedIssuesByCall;
          return { data: calls ? calls[Math.min(closedReads, calls.length) - 1]! : (options.closedIssues ?? []) };
        },
        create: async (request: { title: string; body: string }) => {
          created.push(request);
          return { data: { number: 900 } };
        },
        update: async (request: { issue_number: number; state?: string; body?: string }) => {
          updates.push(request);
          if (request.state === "closed") closed.push(request.issue_number);
        },
        createComment: async (request: { issue_number: number }) => {
          comments.push(request.issue_number);
        },
        addAssignees: async () => undefined,
      },
      repos: {
        compareCommits: async (request: { base: string; head: string }) => {
          compared.push(request);
          if (options.compare instanceof Error) throw options.compare;
          return { data: { status: options.compare ?? "ahead" } };
        },
      },
    },
  };
  const context = { repo: { owner: "BigSimmo", repo: "PsychSift" }, runId: 1, serverUrl: "https://github.com" };
  const core = { info: () => undefined, warning: () => undefined };
  const env = {
    PR_REQUIRED_RESULT: options.results.prRequired,
    BROWSER_MATRIX_RESULT: options.results.matrix,
    VISUAL_BASELINE_RESULT: options.results.visual,
    HEAD_SHA: RUN_SHA,
    HEAD_MESSAGE: "Example merge",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    await new AsyncFunction("github", "context", "core", routingScriptSource())(github, context, core);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { created, closed, updates, comments, compared };
}

describe("main CI failure routing, executed", () => {
  const green = { prRequired: "success", matrix: "success", visual: "success" };
  const ownIssue: Issue = { number: 42, title: "CI on main is failing", body: "<!-- main-ci-routing:v1 -->" };

  // The case continue-on-error creates: `needs` says success while the listing says a leg failed.
  it("still alerts when a continue-on-error matrix leg failed behind a success result", async () => {
    const { created, closed } = await runRouting({
      results: green,
      jobs: [
        { name: "PR required", conclusion: "success" },
        { name: "release-browser-matrix (webkit, mobile-webkit, 5, 5)", conclusion: "failure" },
      ],
      openIssues: [],
    });
    expect(closed).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toContain("release-browser-matrix (webkit, mobile-webkit, 5, 5)");
  });

  it("still alerts when a continue-on-error matrix leg timed out", async () => {
    const { created } = await runRouting({
      results: green,
      jobs: [{ name: "release-browser-matrix (firefox, firefox, 1, 5)", conclusion: "timed_out" }],
      openIssues: [],
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toContain("release-browser-matrix (firefox, firefox, 1, 5)`: timed_out");
  });

  it("reports an unverified matrix rather than assuming it green when jobs cannot be listed", async () => {
    const { created, closed } = await runRouting({ results: green, listingFails: true, openIssues: [ownIssue] });
    expect(closed).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("opens an issue for an unverified matrix when none is open", async () => {
    const { created } = await runRouting({ results: green, listingFails: true, openIssues: [] });
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toContain("verdict unknown");
  });

  it("closes its issue when every listed job passed", async () => {
    const { created, closed } = await runRouting({
      results: green,
      jobs: [{ name: "release-browser-matrix (firefox, firefox, 1, 3)", conclusion: "success" }],
      openIssues: [ownIssue],
    });
    expect(created).toHaveLength(0);
    expect(closed).toEqual([42]);
  });

  it("does not invent a matrix verdict when the matrix was skipped and listing failed", async () => {
    const { created, closed } = await runRouting({
      results: { prRequired: "success", matrix: "skipped", visual: "skipped" },
      listingFails: true,
      openIssues: [ownIssue],
    });
    expect(created).toHaveLength(0);
    expect(closed).toEqual([42]);
  });

  it("keeps alerting on a red PR required exactly as before", async () => {
    const { created } = await runRouting({
      results: { prRequired: "failure", matrix: "skipped", visual: "skipped" },
      jobs: [{ name: "Build", conclusion: "failure" }],
      openIssues: [],
    });
    expect(created).toHaveLength(1);
  });
});

/**
 * Runs on main finish out of order (2026-10-13: the tip's green run closed #3099, then an older
 * commit's run reopened it). Every body the job writes records the commit it last routed, and a run
 * whose commit is behind that one stands down. Ordering by what was last routed, not by "is this
 * main's tip", means a merge streak cannot suppress every alert.
 */
describe("main CI failure routing ignores superseded runs", () => {
  const red = { prRequired: "failure", matrix: "skipped", visual: "skipped" };
  const green = { prRequired: "success", matrix: "success", visual: "success" };
  const failingJobs: ListedJob[] = [{ name: "Build", conclusion: "failure" }];
  const stamp = (sha: string) => `<!-- routed-sha:${sha} -->`;
  const marked = (sha: string): Issue => ({
    number: 42,
    title: "CI on main is failing",
    body: `<!-- main-ci-routing:v1 -->\n${stamp(sha)}`,
  });

  it("does not use a job-level concurrency group that could cancel a newer commit's routing", () => {
    const routing = workflow.slice(workflow.indexOf("  main-failure-routing:"));
    const jobBlock = routing.slice(0, routing.indexOf("    steps:"));
    expect(jobBlock).not.toMatch(/\n {4}concurrency:/);
  });

  it("leaves the issue untouched when a superseded red run finishes after a newer one routed", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [marked(ROUTED_SHA)],
      compare: "behind",
    });
    expect(result.compared).toMatchObject([{ base: ROUTED_SHA, head: RUN_SHA }]);
    expect(result.updates).toHaveLength(0);
    expect(result.comments).toHaveLength(0);
    expect(result.created).toHaveLength(0);
  });

  it("does not close the issue for a superseded green run", async () => {
    const result = await runRouting({ results: green, jobs: [], openIssues: [marked(ROUTED_SHA)], compare: "behind" });
    expect(result.closed).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
  });

  it("does not reopen a closed issue for a red run older than the green that closed it", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      closedIssues: [marked(ROUTED_SHA)],
      compare: "behind",
    });
    expect(result.updates).toHaveLength(0);
    expect(result.created).toHaveLength(0);
  });

  it("still alerts when an older commit's run is the newest one to report (merge streak)", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [marked(ROUTED_SHA)],
      compare: "ahead",
    });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.body).toContain(stamp(RUN_SHA));
    expect(result.updates[0]!.body).not.toContain(stamp(ROUTED_SHA));
    expect(result.comments).toEqual([42]);
  });

  it("opens an issue stamped with the run's commit when a red run finds none", async () => {
    const result = await runRouting({ results: red, jobs: failingJobs });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.body).toContain(stamp(RUN_SHA));
    expect(result.compared).toHaveLength(0);
  });

  it("stamps the closing green run on the issue so a later stale red run cannot reopen it", async () => {
    const result = await runRouting({ results: green, jobs: [], openIssues: [marked(ROUTED_SHA)], compare: "ahead" });
    expect(result.closed).toEqual([42]);
    expect(result.updates[0]!.body).toContain(stamp(RUN_SHA));
    expect(result.updates[0]!.body).toContain("<!-- main-ci-routing:v1 -->");
  });

  it("records a green run on the closed issue when none is open", async () => {
    const result = await runRouting({ results: green, jobs: [], closedIssues: [marked(ROUTED_SHA)], compare: "ahead" });
    expect(result.closed).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.state).toBeUndefined();
    expect(result.updates[0]!.body).toContain(stamp(RUN_SHA));
  });

  it("routes a red run that has no recorded commit to order against", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [ownIssueWithoutStamp()],
      compare: "behind",
    });
    expect(result.compared).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
  });

  it("fails open: an ordering lookup that errors still routes the alert", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [marked(ROUTED_SHA)],
      compare: new Error("Not Found"),
    });
    expect(result.updates).toHaveLength(1);
    expect(result.comments).toEqual([42]);
  });

  it("writes to the issue state re-read just before writing, not the state read at the start", async () => {
    // A newer green run closed #42 while this older-but-ahead red run was reading: the start sees
    // #42 open, the re-check sees it closed. The red run must reopen the closed issue, not update
    // the (now closed) one it first saw.
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssuesByCall: [[marked(ROUTED_SHA)], []],
      closedIssuesByCall: [[marked(ROUTED_SHA)]],
      compare: "ahead",
    });
    expect(result.created).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({ issue_number: 42, state: "open" });
    expect(result.updates[0]!.body).toContain(stamp(RUN_SHA));
  });

  it("closes the freshly opened issue on green when a red run reopened it while this run was reading", async () => {
    // Start: nothing open, #42 closed. By the re-check an older red run reopened #42. This green
    // run is ahead and must close it, not rewrite the closed-issue body and leave it open.
    const result = await runRouting({
      results: green,
      jobs: [],
      openIssuesByCall: [[], [marked(ROUTED_SHA)]],
      closedIssuesByCall: [[marked(ROUTED_SHA)]],
      compare: "ahead",
    });
    expect(result.closed).toEqual([42]);
  });

  it("stands down when the re-check shows a newer run routed while this one was reading", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssuesByCall: [[ownIssueWithoutStamp()], [marked(ROUTED_SHA)]],
      compare: "behind",
    });
    expect(result.updates).toHaveLength(0);
  });

  it("fails open when the first issue read works but the re-check read fails", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [marked(ROUTED_SHA)],
      failOpenReadOnCall: 2,
      compare: "ahead",
    });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.body).toContain(stamp(RUN_SHA));
    expect(result.comments).toEqual([42]);
  });

  it("treats a diverged history as not superseded", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [marked(ROUTED_SHA)],
      compare: "diverged",
    });
    expect(result.updates).toHaveLength(1);
  });

  it("does not compare a run with itself when it is the commit last routed", async () => {
    const result = await runRouting({
      results: red,
      jobs: failingJobs,
      openIssues: [marked(RUN_SHA)],
      compare: "behind",
    });
    expect(result.compared).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
  });
});

function ownIssueWithoutStamp(): Issue {
  return { number: 42, title: "CI on main is failing", body: "<!-- main-ci-routing:v1 -->" };
}
