import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The merge-queue half of pr-policy.yml. A queued PR is re-based onto whatever merged ahead of it
 * and never re-synced, so its migration order must be re-checked against the queue entry's real
 * base. These cases run the workflow's own script against a fake GitHub API.
 */
const require = createRequire(import.meta.url);
// Same inline form as ci-cache-safety.test.ts: js-yaml is transitive, and knip flags a bare require().
const workflow = createRequire(import.meta.url)("js-yaml").load(
  readFileSync(new URL("../.github/workflows/pr-policy.yml", import.meta.url), "utf8"),
) as { jobs: { policy: { steps: Array<{ name: string; if?: string; with?: { script?: string } }> } } };
const step = workflow.jobs.policy.steps.find(
  (candidate) => candidate.name === "Recheck migration history against the queue base",
);
const script = step?.with?.script ?? "";

type Listing = Record<string, string>;

async function runQueueCheck({
  base,
  head,
  body = "",
  listingError,
  headRef = "refs/heads/gh-readonly-queue/main/pr-42-0123456789abcdef0123456789abcdef01234567",
}: {
  base: Listing;
  head: Listing;
  body?: string;
  listingError?: string;
  headRef?: string;
}) {
  const failures: string[] = [];
  const errors: string[] = [];
  const toEntries = (listing: Listing) => Object.entries(listing).map(([name, sha]) => ({ name, sha, type: "file" }));
  const github = {
    rest: {
      repos: {
        getContent: async ({ path: requested, ref }: { path: string; ref: string }) => {
          if (listingError) throw new Error(listingError);
          if (requested === "supabase/migrations") return { data: toEntries(ref === "base" ? base : head) };
          return { data: { content: Buffer.from("select 1;").toString("base64"), encoding: "base64" } };
        },
      },
      pulls: { get: async () => ({ data: { body } }) },
    },
  };
  const context = {
    repo: { owner: "o", repo: "r" },
    payload: { merge_group: { base_sha: "base", head_sha: "head", head_ref: headRef } },
  };
  const core = {
    setFailed: (message: string) => failures.push(message),
    error: (message: string) => errors.push(message),
    warning: () => undefined,
    info: () => undefined,
  };
  const previousWorkspace = process.env.GITHUB_WORKSPACE;
  process.env.GITHUB_WORKSPACE = fileURLToPath(new URL("..", import.meta.url));
  try {
    // A Function-constructor body cannot use dynamic import() under Vitest, so the script's one
    // import is routed through an injected loader that resolves the same module URL.
    const runnable = script.replace("await import(moduleUrl)", "await importModule(moduleUrl)");
    expect(runnable).not.toBe(script);
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
    await new AsyncFunction("require", "github", "context", "core", "importModule", runnable)(
      require,
      github,
      context,
      core,
      (url: string) => import(/* @vite-ignore */ url),
    );
  } finally {
    process.env.GITHUB_WORKSPACE = previousWorkspace;
  }
  return { failures, errors };
}

const applied = { "20260801000000_first.sql": "a1", "20260815000000_second.sql": "a2" };

describe("PR policy in the merge queue", () => {
  it("runs only on merge_group, and the placeholder that accepted every queue entry is gone", () => {
    expect(step?.if).toBe("github.event_name == 'merge_group'");
    expect(script).toContain("migrationHistoryVerdict(");
    expect(script).toContain("group.base_sha");
    expect(JSON.stringify(workflow)).not.toContain("PR metadata was validated before merge-queue entry.");
  });

  it("passes an entry that changes no migrations", async () => {
    expect((await runQueueCheck({ base: applied, head: applied })).failures).toEqual([]);
  });

  it("passes a new migration that is still the newest against the queue base", async () => {
    const result = await runQueueCheck({
      base: applied,
      head: { ...applied, "20260820000000_mine.sql": "m1" },
    });
    expect(result.failures).toEqual([]);
  });

  it("fails a migration overtaken by one that merged ahead of it in the queue", async () => {
    const result = await runQueueCheck({
      base: { ...applied, "20260825000000_merged_ahead.sql": "x1" },
      head: { ...applied, "20260825000000_merged_ahead.sql": "x1", "20260820000000_mine.sql": "m1" },
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("no longer holds against the queue base");
    expect(result.errors.join(" ")).toContain("20260820000000");
  });

  it("fails an edit to an applied migration", async () => {
    const result = await runQueueCheck({ base: applied, head: { ...applied, "20260801000000_first.sql": "edited" } });
    expect(result.failures).toHaveLength(1);
  });

  it("fails closed when the migration listing cannot be read", async () => {
    const result = await runQueueCheck({ base: applied, head: applied, listingError: "boom" });
    expect(result.failures.join(" ")).toContain("Migration history cannot be verified");
  });
});
