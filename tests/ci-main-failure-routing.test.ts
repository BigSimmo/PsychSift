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
      /const previous = closed\.find\(\(issue\) => !issue\.pull_request && String\(issue\.body \?\? ""\)\.includes\(MARKER\)\)/,
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

async function runRouting(options: {
  results: { prRequired: string; matrix: string; visual: string };
  jobs?: ListedJob[];
  listingFails?: boolean;
  openIssues?: Issue[];
}) {
  const created: Array<{ title: string; body: string }> = [];
  const closed: number[] = [];
  const github = {
    paginate: async () => {
      if (options.listingFails) throw new Error("Resource not accessible by integration");
      return options.jobs ?? [];
    },
    rest: {
      actions: { listJobsForWorkflowRun: () => undefined },
      issues: {
        listForRepo: async ({ state }: { state: string }) => ({
          data: state === "open" ? (options.openIssues ?? []) : [],
        }),
        create: async (request: { title: string; body: string }) => {
          created.push(request);
          return { data: { number: 900 } };
        },
        update: async (request: { issue_number: number; state?: string }) => {
          if (request.state === "closed") closed.push(request.issue_number);
        },
        createComment: async () => undefined,
        addAssignees: async () => undefined,
      },
    },
  };
  const context = { repo: { owner: "BigSimmo", repo: "PsychSift" }, runId: 1, serverUrl: "https://github.com" };
  const core = { info: () => undefined, warning: () => undefined };
  const env = {
    PR_REQUIRED_RESULT: options.results.prRequired,
    BROWSER_MATRIX_RESULT: options.results.matrix,
    VISUAL_BASELINE_RESULT: options.results.visual,
    HEAD_SHA: "0123456789abcdef",
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
  return { created, closed };
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
