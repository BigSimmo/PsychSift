import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "live-drift.yml");
const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");

type Issue = { number: number; title: string; body?: string };
type RepositoryCoordinates = { owner: string; repo: string };

type ScriptFunction = (
  github: Record<string, unknown>,
  context: Record<string, unknown>,
  core: {
    info: (message: string) => void;
    warning: (message: string) => void;
  },
) => Promise<void>;

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => ScriptFunction;

// Same extraction shape as tests/codex-autofix-workflow.test.ts: the block is
// `script: |` at ten spaces, so its body is everything indented twelve or more.
function extractWorkflowScripts(source: string) {
  const scriptMarker = "          script: |\n";
  const scripts: string[] = [];
  let searchFrom = 0;

  while (true) {
    const scriptStart = source.indexOf(scriptMarker, searchFrom);
    if (scriptStart === -1) break;

    const scriptLines = source.slice(scriptStart + scriptMarker.length).split("\n");
    const extractedLines: string[] = [];

    for (const line of scriptLines) {
      if (line.length === 0) {
        extractedLines.push("");
        continue;
      }
      if (!line.startsWith("            ")) break;
      extractedLines.push(line.slice(12));
    }

    scripts.push(extractedLines.join("\n"));
    searchFrom = scriptStart + scriptMarker.length;
  }

  return scripts;
}

const [routingScriptSource, ...extraScripts] = extractWorkflowScripts(workflow);
if (!routingScriptSource) {
  throw new Error("Expected a github-script block for drift routing in .github/workflows/live-drift.yml.");
}
if (extraScripts.length > 0) {
  throw new Error("Expected exactly one github-script block in live-drift.yml; update this test if that changes.");
}

const routingScript = new AsyncFunction("github", "context", "core", routingScriptSource);

type Calls = {
  closed: Array<RepositoryCoordinates & { issue_number: number; state?: string; state_reason?: string }>;
  comments: Array<RepositoryCoordinates & { issue_number: number; body: string }>;
  created: Array<RepositoryCoordinates & { title: string; labels: string[]; body: string }>;
  listed: Array<RepositoryCoordinates & { labels: string; state: string }>;
  updatedBodies: Array<RepositoryCoordinates & { issue_number: number; body: string }>;
  assigned: Array<RepositoryCoordinates & { issue_number: number; assignees: string[] }>;
  warnings: string[];
};

async function runRoutingScript(options: {
  findings?: string;
  comparison?: string;
  history?: string;
  projectRef?: string;
  checkedSha?: string;
  openIssues?: Issue[];
  refuseAssignment?: boolean;
  result: string;
}) {
  const calls: Calls = {
    assigned: [],
    closed: [],
    comments: [],
    created: [],
    listed: [],
    updatedBodies: [],
    warnings: [],
  };

  const github = {
    rest: {
      issues: {
        addAssignees: async (request: RepositoryCoordinates & { assignees: string[]; issue_number: number }) => {
          if (options.refuseAssignment) throw new Error("Validation Failed");
          calls.assigned.push({
            assignees: request.assignees,
            issue_number: request.issue_number,
            owner: request.owner,
            repo: request.repo,
          });
        },
        create: async (request: RepositoryCoordinates & { body: string; labels: string[]; title: string }) => {
          calls.created.push({
            body: request.body,
            labels: request.labels,
            owner: request.owner,
            repo: request.repo,
            title: request.title,
          });
          return { data: { number: 4242 } };
        },
        createComment: async (request: RepositoryCoordinates & { body: string; issue_number: number }) => {
          calls.comments.push({
            body: request.body,
            issue_number: request.issue_number,
            owner: request.owner,
            repo: request.repo,
          });
        },
        listForRepo: async (request: RepositoryCoordinates & { labels: string; state: string }) => {
          calls.listed.push({ labels: request.labels, owner: request.owner, repo: request.repo, state: request.state });
          return { data: options.openIssues ?? [] };
        },
        update: async (
          request: RepositoryCoordinates & {
            body?: string;
            issue_number: number;
            state?: string;
            state_reason?: string;
          },
        ) => {
          if (request.state) {
            calls.closed.push({
              issue_number: request.issue_number,
              owner: request.owner,
              repo: request.repo,
              state: request.state,
              state_reason: request.state_reason,
            });
          }
          if (typeof request.body === "string") {
            calls.updatedBodies.push({
              body: request.body,
              issue_number: request.issue_number,
              owner: request.owner,
              repo: request.repo,
            });
          }
        },
      },
    },
  };

  const context = {
    eventName: "schedule",
    repo: { owner: "BigSimmo", repo: "PsychSift" },
    runId: 99,
    serverUrl: "https://github.com",
  };

  const core = {
    info: () => undefined,
    warning: (message: string) => {
      calls.warnings.push(message);
    },
  };

  const keys = [
    "DRIFT_RESULT",
    "DRIFT_FINDINGS",
    "DRIFT_COMPARISON",
    "DRIFT_HISTORY",
    "DRIFT_PROJECT_REF",
    "DRIFT_CHECKED_SHA",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.DRIFT_RESULT = options.result;
  process.env.DRIFT_FINDINGS = options.findings ?? "";
  process.env.DRIFT_COMPARISON = options.comparison ?? "";
  process.env.DRIFT_HISTORY = options.history ?? "";
  process.env.DRIFT_PROJECT_REF = options.projectRef ?? "sjrfecxgysukkwxsowpy";
  process.env.DRIFT_CHECKED_SHA = options.checkedSha ?? "a3cfb6362782d2025643371bf0746472515e33ad";
  try {
    await routingScript(github, context, core);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }

  return calls;
}

const pinnedIssue: Issue = { number: 1234, title: "Live drift check failing" };
const sampleFindings = "UNEXPECTED DRIFT (2):\n  ! [indexes] missing_live documents_title_trgm_idx";
const repositoryCoordinates = { owner: "BigSimmo", repo: "PsychSift" };

function workflowJobPermissionMaps(source: string) {
  const jobsStart = source.indexOf("jobs:\n");
  if (jobsStart < 0) throw new Error("Expected a jobs map in .github/workflows/live-drift.yml.");

  const jobsSection = source.slice(jobsStart);
  const jobHeaders = [...jobsSection.matchAll(/^  ([a-z][\w-]*):$/gm)];
  const jobs = Object.fromEntries(
    jobHeaders.map((header, index) => {
      const bodyStart = (header.index ?? 0) + header[0].length + 1;
      const bodyEnd = jobHeaders[index + 1]?.index ?? jobsSection.length;
      const body = jobsSection.slice(bodyStart, bodyEnd);
      const permissions = Object.fromEntries(
        [...body.matchAll(/^    permissions:\n((?:      [^\n]+\n?)*)/gm)].flatMap((permissionsMatch) =>
          [...permissionsMatch[1].matchAll(/^      ([\w-]+): ([\w-]+)$/gm)].map((entry) => [entry[1], entry[2]]),
        ),
      );
      return [header[1], { permissions }];
    }),
  );

  return { jobs };
}

describe("live-drift workflow triggers and privileges", () => {
  /**
   * Reordered 2026-09-16: a push-triggered run starts within seconds of the
   * merge, while the Supabase GitHub integration is still applying it
   * (~34 s). Sampling check:drift first raced that apply and produced false
   * drift on 3 of 4 runs sampled that day. check:migration-history now runs
   * FIRST, in a ten-minute wait-until-applied mode (`--max-wait-ms 600000`),
   * so check:drift only samples the schema once nothing is pending — or the
   * bounded wait has been exhausted, which still fails the job as before.
   * check:drift keeps `if: !cancelled()` (moved from migration-history) so a
   * migration-history failure still leaves drift's own evidence captured,
   * matching the previous "the other check's output survives either
   * failure" guarantee, just mirrored by the reordering.
   */
  it("runs migration-history first in a bounded wait-until-applied mode, then drift once, keeping drift visible after a migration-history failure", () => {
    expect(workflow.match(/npm run check:drift\b/g)).toHaveLength(1);
    expect(workflow.match(/npm run check:migration-history\b/g)).toHaveLength(1);
    expect(workflow.indexOf("npm run check:migration-history")).toBeLessThan(workflow.indexOf("npm run check:drift"));
    expect(workflow).toContain("npm run check:migration-history -- --max-wait-ms 600000");
    expect(workflow).toMatch(/- name: Compare live schema drift\n\s+id: drift\n\s+if: \$\{\{ !cancelled\(\) \}\}/);
    expect(workflow).not.toMatch(
      /- name: Align migration history for Supabase Preview\n\s+if: \$\{\{ !cancelled\(\) \}\}/,
    );
  });

  it("keeps the weekly schedule and manual dispatch", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('- cron: "30 18 * * 0"');
  });

  it("also runs once a schema change reaches main, and never on pull requests", () => {
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain('- "supabase/migrations/**"');
    expect(workflow).toContain('- "supabase/schema.sql"');
    expect(workflow).not.toMatch(/^on:[\s\S]*?^\s{2}pull_request/m);
  });

  it("never cancels an in-flight drift run", () => {
    expect(workflow).toContain("group: live-drift-check");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("keeps the secret preflight so a missing key fails loudly rather than silently passing", () => {
    expect(workflow).toContain("Preflight required secrets");
    expect(workflow).toContain("Live drift check cannot run - missing secrets (production-secrets environment):");
  });

  it("reads the service-role key only through the main-only production-secrets environment (audit F-21)", () => {
    const environments = workflow.match(/^\s+environment:.*$/gm) ?? [];
    expect(environments.map((line) => line.trim())).toEqual(["environment: production-secrets"]);
    const liveDriftJob = workflow.slice(workflow.indexOf("  live-drift:\n"), workflow.indexOf("  drift-routing:\n"));
    expect(liveDriftJob).toContain("    environment: production-secrets\n");
  });

  it("grants issues: write only to the routing job", () => {
    // Workflow-level permissions stay read-only, so no job inherits issue writes.
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);

    const parsed = workflowJobPermissionMaps(workflow);
    expect(parsed.jobs["drift-routing"]?.permissions).toEqual({ contents: "read", issues: "write" });
    for (const [jobName, job] of Object.entries(parsed.jobs)) {
      if (jobName !== "drift-routing") expect(job.permissions.issues).toBeUndefined();
    }
  });

  it("keeps the service-role key out of the job that can write issues", () => {
    const routingStart = workflow.indexOf("  drift-routing:");
    expect(workflow.slice(routingStart)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("pins github-script to the reviewed immutable commit", () => {
    expect(workflow).toContain("uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0");
  });

  it("captures findings even when the drift step failed", () => {
    expect(workflow).toContain("set -o pipefail");
    expect(workflow).toMatch(/id: findings\n\s+if: always\(\)/);
  });

  it("still routes when the drift job fails", () => {
    expect(workflow).toContain("if: ${{ !cancelled() }}");
  });
});

describe("live-drift failure routing", () => {
  it("opens one labelled issue when the check fails and none is open", async () => {
    const calls = await runRoutingScript({ findings: sampleFindings, result: "failure" });

    expect(calls.listed).toEqual([{ ...repositoryCoordinates, labels: "live-drift-failure", state: "open" }]);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0].title).toBe("Live drift check failing");
    expect(calls.created[0].labels).toEqual(["live-drift-failure"]);
    expect(calls.created[0]).toMatchObject(repositoryCoordinates);
    expect(calls.created[0].body).toContain("https://github.com/BigSimmo/PsychSift/actions/runs/99");
    expect(calls.created[0].body).toContain("documents_title_trgm_idx");
    expect(calls.closed).toHaveLength(0);
  });

  it("updates the same issue on a repeat failure instead of stacking a second one", async () => {
    const calls = await runRoutingScript({
      findings: sampleFindings,
      openIssues: [pinnedIssue],
      result: "failure",
    });

    expect(calls.created).toHaveLength(0);
    expect(calls.updatedBodies).toEqual([expect.objectContaining({ ...repositoryCoordinates, issue_number: 1234 })]);
    expect(calls.comments).toHaveLength(1);
    expect(calls.comments[0].issue_number).toBe(1234);
    expect(calls.comments[0]).toMatchObject(repositoryCoordinates);
    expect(calls.comments[0].body).toContain("Still failing");
    expect(calls.closed).toHaveLength(0);
    expect(calls.warnings.join(" ")).toContain("1234");
  });

  it("does not present a run that died before the comparison as a clean schema", async () => {
    const calls = await runRoutingScript({ findings: "", result: "failure" });

    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject(repositoryCoordinates);
    expect(calls.created[0].body).toContain("not** evidence of a clean schema");
    expect(calls.created[0].body).not.toContain("UNEXPECTED DRIFT");
  });

  it("comments the resolution and closes the issue on the next green run", async () => {
    const calls = await runRoutingScript({ openIssues: [pinnedIssue], result: "success" });

    expect(calls.comments).toHaveLength(1);
    expect(calls.comments[0].body).toContain("Resolved");
    expect(calls.comments[0].body).toContain("https://github.com/BigSimmo/PsychSift/actions/runs/99");
    expect(calls.closed).toEqual([
      { ...repositoryCoordinates, issue_number: 1234, state: "closed", state_reason: "completed" },
    ]);
    expect(calls.created).toHaveLength(0);
    expect(calls.listed).toEqual([{ ...repositoryCoordinates, labels: "live-drift-failure", state: "open" }]);
  });

  it("assigns the repository owner so the alert reaches a person, on open and on repeat", async () => {
    const opened = await runRoutingScript({ findings: sampleFindings, result: "failure" });
    expect(opened.assigned).toEqual([{ ...repositoryCoordinates, assignees: ["BigSimmo"], issue_number: 4242 }]);

    const repeated = await runRoutingScript({ findings: sampleFindings, openIssues: [pinnedIssue], result: "failure" });
    expect(repeated.assigned).toEqual([{ ...repositoryCoordinates, assignees: ["BigSimmo"], issue_number: 1234 }]);

    const green = await runRoutingScript({ openIssues: [pinnedIssue], result: "success" });
    expect(green.assigned).toHaveLength(0);
  });

  it("still opens the alert when GitHub refuses the assignment", async () => {
    const calls = await runRoutingScript({ findings: sampleFindings, refuseAssignment: true, result: "failure" });

    expect(calls.created).toHaveLength(1);
    expect(calls.assigned).toHaveLength(0);
    expect(calls.warnings.join(" ")).toContain("Could not assign @BigSimmo to #4242");
  });

  it("writes nothing when the check is green and no issue is open", async () => {
    const calls = await runRoutingScript({ result: "success" });

    expect(calls.created).toHaveLength(0);
    expect(calls.comments).toHaveLength(0);
    expect(calls.closed).toHaveLength(0);
    expect(calls.updatedBodies).toHaveLength(0);
  });

  it("treats an unknown job result as a failure rather than closing the issue", async () => {
    const calls = await runRoutingScript({ openIssues: [pinnedIssue], result: "" });

    expect(calls.closed).toHaveLength(0);
    expect(calls.updatedBodies).toEqual([expect.objectContaining({ ...repositoryCoordinates, issue_number: 1234 })]);
  });
});

describe("live-drift green runs carry their own evidence", () => {
  const comparison =
    "Drift manifest: generated 2026-09-16T12:00:00.000Z from schema.sql 819db2576117…\n" +
    "Compared 6 extensions, 60 tables, 1 views, 171 functions, 270 indexes, 58 policies, 370 constraints, 41 triggers, 2 storage_buckets against live.";
  const history =
    "Local migration versions: 245\nRemote migration versions: 245 (read via rpc)\nRemote-only (Preview blockers): 0";

  it("states what was compared, against which project, at which commit", async () => {
    // "The job exited 0" is a fact about the job, not about the schema. The
    // comment that CLOSES the issue used to be the one message in the thread
    // saying nothing about what had been checked.
    const calls = await runRoutingScript({ comparison, history, openIssues: [pinnedIssue], result: "success" });
    const [resolved] = calls.comments;
    expect(resolved.body).toContain("Compared 6 extensions, 60 tables");
    expect(resolved.body).toContain("Local migration versions: 245");
    expect(resolved.body).toContain("`sjrfecxgysukkwxsowpy`");
    expect(resolved.body).toContain("`a3cfb6362782`");
    expect(calls.closed).toHaveLength(1);
  });

  it("says so loudly when a green run captured no comparison summary", async () => {
    // A skipped or truncated comparison must never read as parity.
    const calls = await runRoutingScript({ comparison: "", openIssues: [pinnedIssue], result: "success" });
    expect(calls.comments[0].body).toContain("not** what it compared");
    expect(calls.comments[0].body).not.toContain("Compared ");
  });

  it("does not present object-inventory parity as whole-database parity", async () => {
    const calls = await runRoutingScript({ comparison, openIssues: [pinnedIssue], result: "success" });
    expect(calls.comments[0].body).toContain("Data, cron and configuration");
  });
});

describe("live-drift issue ownership", () => {
  const unrelated: Issue = { number: 77, title: "Someone else's schema question" };

  it("never closes a labelled issue this workflow does not own", async () => {
    // `open.find(title match) ?? open[0]` was harmless while UPDATING a body and
    // unrecoverable on the green path, where it closes whatever it picked. Any
    // open issue carrying the live-drift-failure label qualified.
    const calls = await runRoutingScript({ openIssues: [unrelated], result: "success" });
    expect(calls.closed).toHaveLength(0);
    expect(calls.comments).toHaveLength(0);
  });

  it("still finds its own issue after a human retitles it", async () => {
    // The reason the fallback existed. A marker in the body keeps that tolerance
    // without betting an unrelated issue's open state on list ordering.
    const retitled: Issue = {
      number: 1234,
      title: "Drift — renamed by a human",
      body: "…previous body…\n<!-- live-drift-routing:v1 -->",
    };
    const calls = await runRoutingScript({
      comparison: "Compared 60 tables",
      openIssues: [retitled],
      result: "success",
    });
    expect(calls.closed).toEqual([
      expect.objectContaining({ issue_number: 1234, state: "closed", state_reason: "completed" }),
    ]);
  });

  it("prefers its own marked issue over an unrelated one listed first", async () => {
    const marked: Issue = { number: 1234, title: "Live drift check failing" };
    const calls = await runRoutingScript({ openIssues: [unrelated, marked], result: "success" });
    expect(calls.closed).toEqual([expect.objectContaining({ issue_number: 1234 })]);
  });

  it("writes the ownership marker into every body it authors", async () => {
    const created = await runRoutingScript({ findings: sampleFindings, result: "failure" });
    expect(created.created[0].body).toContain("<!-- live-drift-routing:v1 -->");
    const updated = await runRoutingScript({
      findings: sampleFindings,
      openIssues: [pinnedIssue],
      result: "failure",
    });
    expect(updated.updatedBodies[0].body).toContain("<!-- live-drift-routing:v1 -->");
  });
});

describe("live-drift diagnostics artifact", () => {
  it("uploads the untruncated output the issue can only slice", () => {
    // The issue body gets head -80 / tail -80. A real drift report runs to
    // hundreds of lines and the truncated tail is where the unexplained entries
    // sit; without an artifact that evidence died with the runner.
    expect(workflow).toContain("name: live-drift-diagnostics");
    expect(workflow).toMatch(/Upload full drift diagnostics[\s\S]*if: always\(\)/);
    expect(workflow).toMatch(/live-drift-diagnostics[\s\S]*drift-output\.txt/);
    expect(workflow).toMatch(/live-drift-diagnostics[\s\S]*migration-history-output\.txt/);
  });

  it("keeps migration-history settling ahead of the comparison", () => {
    // Unchanged by the reporting work above, and re-pinned here because these
    // edits sit in the same steps.
    expect(workflow.indexOf("npm run check:migration-history")).toBeLessThan(workflow.indexOf("npm run check:drift"));
  });
});

describe("production alert workflows route to a person (#TN512M)", () => {
  // The live monitor, CI on main, the eval canary, live drift and ingestion autopilot all
  // detected real failures and reported them only to a label. Each must assign the owner
  // both when it opens its issue and when it updates an existing one. ci.yml has a third path:
  // it reopens its most recent closed issue rather than opening a new one (owner, 2026-09-26).
  it.each([
    ["live-domain-monitor.yml", 2],
    ["ci.yml", 3],
    ["eval-canary.yml", 2],
    ["live-drift.yml", 2],
    ["ingestion-autopilot.yml", 2],
  ] as const)("%s assigns its failure issue", (file, assignPaths) => {
    const source = readFileSync(path.join(repoRoot, ".github", "workflows", file), "utf8");
    expect(source).toContain("github.rest.issues.addAssignees(");
    expect(source).toContain("const alertAssignee = context.repo.owner;");
    expect(source).toContain("await assignAlert(created.data.number);");
    expect(source.match(/await assignAlert\(/g)?.length).toBe(assignPaths);
  });
});
