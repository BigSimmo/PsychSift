import { describe, expect, it } from "vitest";
import {
  computeParity,
  EXPECTED_GITHUB_SECRETS,
  EXPECTED_GITHUB_VARIABLES,
  EXPECTED_RAILWAY_APP_VARIABLES,
  EXPECTED_RAILWAY_SECRETS,
  EXPECTED_RAILWAY_WORKER_VARIABLES,
  githubListArgs,
  parseCiEnvNames,
  parseEnvExampleNames,
  parseEnvSchemaNames,
  railwayVariableArgs,
} from "../scripts/check-env-parity.mjs";
import {
  branchCoverageRefusal,
  fetchRefspecCoversAllBranches,
  hasCompletedCleanupReview,
  parseLedgerBranches,
  shallowCloneRefusal,
} from "../scripts/sweep-branch-ledger.mjs";
import {
  archiveQuarterLabel,
  buildRow,
  calendarQuarterStart,
  dedupeLedgerMarkdown,
  findReviews,
  headMatches,
  legacyMaintenanceAllowed,
  migrateLegacyRows,
  mergeLedgerMarkdown,
  parseLedgerRows,
  parseFlags,
  reviewRecordPath,
  rotateLedgerMarkdown,
  sanitizeCell,
} from "../scripts/branch-review-ledger.mjs";
import { validateLedger } from "../scripts/check-branch-review-ledger.mjs";
import { issueRowFingerprint, mergeAttributeProblem } from "../scripts/check-outstanding-issues.mjs";
import { applyRequest, validateRequest } from "../scripts/ledger-inbox.mjs";

describe("check-env-parity name parsing", () => {
  it("extracts UPPER_SNAKE schema keys from env.ts-style text", () => {
    const text = [
      "const envSchema = z.object({",
      "  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),",
      "  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),",
      "  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().default(16000),",
      "  RAG_PERSIST_RAW_QUERY_TEXT: z",
      '    .enum(["true", "false"])',
      '    .default("false"),',
      "  notAKey: 3,",
      "});",
    ].join("\n");
    const names = parseEnvSchemaNames(text);
    expect(names).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(names).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(names).toContain("OPENAI_MAX_OUTPUT_TOKENS");
    expect(names).toContain("RAG_PERSIST_RAW_QUERY_TEXT");
    expect(names).not.toContain("notAKey");
  });

  it("extracts names from check-ci-env quoted literals and process.env access", () => {
    const text = `const required = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]; if (process.env.E2E_AUTH_ENABLED) {}`;
    const names = parseCiEnvNames(text);
    expect(names).toEqual(expect.arrayContaining(["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_AUTH_ENABLED"]));
  });

  it("reports missing expected secrets and unknown live names", () => {
    const parity = computeParity({
      canonical: ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      liveNames: ["OPENAI_API_KEY", "LEFTOVER_OLD_KEY"],
      expectedSecrets: ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    });
    expect(parity.missingSecrets).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
    expect(parity.unknownLive).toEqual(["LEFTOVER_OLD_KEY"]);
  });

  it("extracts active and documented optional names from .env.example-style text", () => {
    const names = parseEnvExampleNames(
      ["OPENAI_API_KEY=replace-with-key", "#OPENAI_SAFETY_IDENTIFIER_SECRET=", "# explanation"].join("\n"),
    );
    expect(names).toEqual(["OPENAI_API_KEY", "OPENAI_SAFETY_IDENTIFIER_SECRET"]);
  });

  it("keeps CI-only E2E credentials out of Railway expectations", () => {
    expect(EXPECTED_GITHUB_SECRETS).toEqual(
      expect.arrayContaining(["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "HEALTH_DEEP_PROBE_SECRET"]),
    );
    expect(EXPECTED_RAILWAY_SECRETS).toEqual(
      expect.arrayContaining([
        "SUPABASE_SERVICE_ROLE_KEY",
        "OPENAI_API_KEY",
        "OPENAI_SAFETY_IDENTIFIER_SECRET",
        "RAG_QUERY_HASH_SECRET",
        "HEALTH_DEEP_PROBE_SECRET",
      ]),
    );
    expect(EXPECTED_RAILWAY_SECRETS).not.toEqual(expect.arrayContaining(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]));
  });

  it("covers app, worker, and scheduled-health configuration separately", () => {
    expect(EXPECTED_RAILWAY_APP_VARIABLES).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_PROJECT_REF",
        "SUPABASE_PROJECT_NAME",
        "OPENAI_SAFETY_IDENTIFIER_SECRET",
      ]),
    );
    expect(EXPECTED_RAILWAY_WORKER_VARIABLES).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_PROJECT_REF",
        "SUPABASE_PROJECT_NAME",
        "SUPABASE_SERVICE_ROLE_KEY",
        "OPENAI_API_KEY",
      ]),
    );
    expect(EXPECTED_RAILWAY_WORKER_VARIABLES).not.toContain("HEALTH_DEEP_PROBE_SECRET");
    expect(EXPECTED_GITHUB_VARIABLES).toEqual(["PROD_HEALTH_URL"]);
  });

  it("pins GitHub and Railway reads to the intended repository and production services", () => {
    expect(githubListArgs("secret")).toEqual(
      expect.arrayContaining(["secret", "list", "--repo", "BigSimmo/PsychSift", "--json", "name"]),
    );
    expect(railwayVariableArgs("PsychSift")).toEqual(
      expect.arrayContaining([
        "--project",
        "5deaad0b-675a-4c13-978e-5ca2b5b877f9",
        "--environment",
        "6aa16f7b-d3e8-4aa2-9854-ee9ead9fcbd4",
        "--service",
        "PsychSift",
      ]),
    );
    expect(railwayVariableArgs("worker")).toContain("worker");
  });
});

describe("sweep-branch-ledger parsing", () => {
  it("extracts claude/ and codex/ branch names from ledger markdown", () => {
    const md = [
      "| 2026-07-10 | codex/design-ux-review-fixes | abc | scope | out | checks |",
      "| 2026-07-11 | PR #487 / claude/answer-page-design-polish-ffd5a6 | def | s | o | c |",
    ].join("\n");
    const names = parseLedgerBranches(md);
    expect(names.has("codex/design-ux-review-fixes")).toBe(true);
    expect(names.has("claude/answer-page-design-polish-ffd5a6")).toBe(true);
  });

  it("extracts every branch namespace, not just claude/ and codex/", () => {
    const md = [
      "| 2026-07-14 | copilot/fix-failing-ci | a | branch-cleanup-deletion-pending | out | c |",
      "| 2026-07-14 | cursor/fix-pr654-ci-53b4 | b | branch-cleanup | out | c |",
      "| 2026-07-14 | fix/accessibility-remaining-findings | c | branch-cleanup | out | c |",
    ].join("\n");
    const names = parseLedgerBranches(md);
    expect(names.has("copilot/fix-failing-ci")).toBe(true);
    expect(names.has("cursor/fix-pr654-ci-53b4")).toBe(true);
    expect(names.has("fix/accessibility-remaining-findings")).toBe(true);
  });

  it("normalizes origin/* remote-tracking rows to the short name the sweep compares against", () => {
    const md = "| 2026-07-14 | origin/claude/codebase-index-coverage | a | branch-cleanup | out | c |";
    const names = parseLedgerBranches(md);
    // the sweep strips origin/ from live refs before ledgerBranches.has(short)
    expect(names.has("claude/codebase-index-coverage")).toBe(true);
    expect(names.has("origin/claude/codebase-index-coverage")).toBe(false);
  });
});

describe("hasCompletedCleanupReview", () => {
  it("matches an exact completed branch-cleanup review (name + HEAD + scope)", () => {
    const md = "| 2026-07-14 | copilot/fix | headsha | branch-cleanup | out | c |";
    expect(hasCompletedCleanupReview(md, "copilot/fix", "headsha")).toBe(true);
    // matches origin/-prefixed and "PR #N / " prefixed rows too
    const md2 = "| 2026-07-14 | PR #654 / origin/fix/a11y | h2 | branch-cleanup | out | c |";
    expect(hasCompletedCleanupReview(md2, "fix/a11y", "h2")).toBe(true);
  });

  it("does NOT treat a deletion-pending row as a completed review", () => {
    const md = "| 2026-07-14 | copilot/fix-yet-again | headsha | branch-cleanup-deletion-pending | out | c |";
    // scope differs, so the still-undeleted branch must be surfaced for retry
    expect(hasCompletedCleanupReview(md, "copilot/fix-yet-again", "headsha")).toBe(false);
  });

  it("does NOT match when the HEAD has moved since the review", () => {
    const md = "| 2026-07-14 | codex/foo | oldsha | branch-cleanup | out | c |";
    expect(hasCompletedCleanupReview(md, "codex/foo", "newsha")).toBe(false);
  });
});

describe("shallowCloneRefusal", () => {
  /*
   * Ledger #109. Every signal the sweep reports comes from a merge-base, and a shallow
   * clone has a grafted root, so those numbers are wrong WITHOUT erroring. Measured
   * 2026-07-29 in a real `--depth 1` clone: the unguarded sweep exited 0 and named the
   * live checked-out branch as a deletion candidate with "no unique patch content". A
   * green exit recommending deletion of an active branch is the exact hazard here, so
   * the guard must refuse rather than degrade.
   */
  it("refuses on a shallow clone and names the remedy", () => {
    // The exact stdout of `git rev-parse --is-shallow-repository` in a shallow clone.
    const refusal = shallowCloneRefusal("true");
    expect(refusal).not.toBe("");
    // The operator must be told how to fix it, not merely that something is wrong.
    expect(refusal).toContain("git fetch --unshallow");
    // Cite the ledger item so the reason survives without this comment.
    expect(refusal).toContain("#109");
    // Name the specific signals that are untrustworthy, not just "unreliable".
    expect(refusal).toContain("merge-base");
  });

  it("stays silent ONLY on an explicit complete-history result", () => {
    // A full clone prints the STRING "false" — truthy. Coercing on truthiness rather than
    // on the exact value would refuse on every healthy repo, so this is the regression
    // that matters most in the safe direction.
    expect(shallowCloneRefusal("false")).toBe("");
  });

  it("refuses when the shallow state cannot be determined", () => {
    /*
     * `tryGit` swallows every error into "", so an unverifiable precondition is
     * indistinguishable from a healthy one unless it is treated as its own failure.
     * Proceeding here would emit merge-base-derived numbers while unable to establish that
     * the merge-bases are real — the #109 defect in a different guise. Both CodeRabbit and
     * Codex flagged this independently on PR #1392; an earlier revision of this test
     * asserted the opposite and was wrong.
     */
    for (const indeterminate of ["", "shallow", "yes"]) {
      expect(shallowCloneRefusal(indeterminate)).not.toBe("");
    }
    expect(shallowCloneRefusal(undefined)).not.toBe("");
  });

  it("distinguishes a known-shallow clone from an undeterminable one", () => {
    // The remedy differs: one needs --unshallow, the other needs a real git checkout.
    expect(shallowCloneRefusal("true")).toContain("SHALLOW clone");
    expect(shallowCloneRefusal("")).toContain("could not determine");
    expect(shallowCloneRefusal("true")).not.toBe(shallowCloneRefusal(""));
  });

  it("tolerates surrounding whitespace from git stdout in both directions", () => {
    expect(shallowCloneRefusal(" true\n")).not.toBe("");
    // A padded "false" must still be recognised as healthy, or every sweep refuses.
    expect(shallowCloneRefusal(" false\n")).toBe("");
  });
});

/*
 * Complete history is NOT complete branch coverage — the second way to get a confident wrong
 * answer, and it survives the shallow guard. `git clone --depth 1` implies `--single-branch`,
 * pinning `remote.origin.fetch` to one branch; `git fetch --unshallow` converts the history so
 * `--is-shallow-repository` reads `false`, but leaves the refspec narrow. Measured in a fixture
 * with `main` and `feature`: after unshallowing, `ls-remote` listed both while
 * `refs/remotes/origin` held only `origin/main`, and the sweep exited 0 with `"branches": []`.
 * Codex raised this on PR #1392 after the shallow fix landed.
 */
describe("branchCoverageRefusal", () => {
  it("treats a heads wildcard into refs/remotes/origin as covering every branch", () => {
    expect(fetchRefspecCoversAllBranches("+refs/heads/*:refs/remotes/origin/*")).toBe(true);
    // Unprefixed (non-forced) wildcards are still wildcards.
    expect(fetchRefspecCoversAllBranches("refs/heads/*:refs/remotes/origin/*")).toBe(true);
  });

  it("rejects a wildcard whose destination is not refs/remotes/origin", () => {
    /*
     * The source says which refs are fetched; `<dst>` says which local ref is updated, and the
     * sweep enumerates `refs/remotes/origin` and nothing else. An earlier revision of this test
     * asserted that a mirror's `+refs/*:refs/*` counted as covered — mine, and wrong in the
     * dangerous direction. Measured with `+refs/heads/*:refs/remotes/upstream/*`:
     * `refs/remotes/upstream` held `upstream/main` and `upstream/feature` while
     * `refs/remotes/origin` was empty and the sweep exited 0 with `"branches": []`.
     * Codex raised this on PR #1398.
     */
    expect(fetchRefspecCoversAllBranches("+refs/*:refs/*")).toBe(false);
    expect(fetchRefspecCoversAllBranches("+refs/heads/*:refs/remotes/upstream/*")).toBe(false);
    expect(branchCoverageRefusal("+refs/*:refs/*", false)).not.toBe("");
    // The sweep's own fetch writes into refs/remotes/origin explicitly, so it still repairs this.
    expect(branchCoverageRefusal("+refs/*:refs/*", true)).toBe("");
  });

  it("rejects a refs/* source even when the destination is refs/remotes/origin/*", () => {
    /*
     * Git substitutes the matched suffix into `<dst>`. Fetching `refs/heads/main` against
     * `+refs/*:refs/remotes/origin/*` therefore writes `refs/remotes/origin/heads/main`, not
     * `refs/remotes/origin/main`. Measured in a two-branch fixture: the sweep enumerated
     * `heads/main` and `heads/feature`, failed to resolve its `origin/main` comparison base,
     * swallowed both comparison failures as zeroes, and exited 0 marking both as deletion
     * candidates. An earlier revision of this suite asserted the opposite — that a `refs/*`
     * source counted as covered when the destination looked right. Codex raised this on PR #1398.
     */
    expect(fetchRefspecCoversAllBranches("+refs/*:refs/remotes/origin/*")).toBe(false);
    expect(branchCoverageRefusal("+refs/*:refs/remotes/origin/*", false)).not.toBe("");
    expect(branchCoverageRefusal("+refs/*:refs/remotes/origin/*", false)).toContain("refs/remotes/origin/heads/");
    // The sweep's own fetch still uses +refs/heads/*:…, so a completed fetch repairs this.
    expect(branchCoverageRefusal("+refs/*:refs/remotes/origin/*", true)).toBe("");
  });

  it("rejects the single-branch refspec that `git clone --depth 1` leaves behind", () => {
    expect(fetchRefspecCoversAllBranches("+refs/heads/main:refs/remotes/origin/main")).toBe(false);
    // Several narrow refspecs are still narrow: naming two branches does not cover the rest.
    expect(
      fetchRefspecCoversAllBranches(
        "+refs/heads/main:refs/remotes/origin/main\n+refs/heads/feature:refs/remotes/origin/feature",
      ),
    ).toBe(false);
    // `git config --get-all` exits 1 when the key is absent, which `tryGit` turns into "".
    expect(fetchRefspecCoversAllBranches("")).toBe(false);
    expect(fetchRefspecCoversAllBranches(undefined)).toBe(false);
  });

  it("treats a negative refspec as not covering every branch", () => {
    /*
     * A `^` exclusion sits alongside a wildcard and removes branches from it. Measured on git
     * 2.43.0 with `+refs/heads/*:refs/remotes/origin/*` plus `^refs/heads/feature`: an ordinary
     * `git fetch --prune origin` honoured the exclusion and left `origin/feature` absent, so
     * reading the wildcard alone and calling it covered would report a partial inventory as
     * complete. Codex raised this on PR #1392.
     */
    const excluded = "+refs/heads/*:refs/remotes/origin/*\n^refs/heads/feature";
    expect(fetchRefspecCoversAllBranches(excluded)).toBe(false);
    expect(branchCoverageRefusal(excluded, false)).not.toBe("");
    // But the sweep's explicit command-line wildcard OVERRIDES a configured exclusion — measured
    // in the same fixture, the ref came back — so a completed fetch still establishes coverage.
    expect(branchCoverageRefusal(excluded, true)).toBe("");
  });

  it("accepts a mixed config as long as one refspec is a wildcard", () => {
    const mixed = "+refs/heads/main:refs/remotes/origin/main\n+refs/heads/*:refs/remotes/origin/*";
    expect(fetchRefspecCoversAllBranches(mixed)).toBe(true);
    expect(branchCoverageRefusal(mixed, false)).toBe("");
  });

  it("stays silent when the configured refspec already covers every branch", () => {
    // The ordinary case for a normal clone: no fetch needed to establish coverage.
    expect(branchCoverageRefusal("+refs/heads/*:refs/remotes/origin/*", false)).toBe("");
  });

  it("stays silent when the sweep's own wildcard fetch completed", () => {
    // The sweep passes an explicit +refs/heads/*:refs/remotes/origin/* rather than relying on
    // the configured refspec, so a successful fetch establishes coverage even in a
    // single-branch clone — without rewriting the operator's config.
    expect(branchCoverageRefusal("+refs/heads/main:refs/remotes/origin/main", true)).toBe("");
  });

  it("refuses a narrow refspec when nothing established coverage", () => {
    // --no-fetch, offline, or a failed fetch. An empty inventory is NOT a safe failure here:
    // it reads as "nothing to clean up".
    const refusal = branchCoverageRefusal("+refs/heads/main:refs/remotes/origin/main", false);
    expect(refusal).not.toBe("");
    // Name the actual cause, so the operator does not go looking at the history again.
    expect(refusal).toContain("remote.origin.fetch");
    expect(refusal).toContain("--single-branch");
    // And give the remedy, not just the diagnosis.
    expect(refusal).toContain("git remote set-branches origin '*'");
  });

  it("is distinct from the shallow refusal, because the remedies differ", () => {
    const refusal = branchCoverageRefusal("", false);
    expect(refusal).not.toBe(shallowCloneRefusal("true"));
    // `--unshallow` fixes history and does nothing for the refspec, so it must not be the
    // prescribed command — it appears in the body only as the thing that does NOT fix this.
    // Sending the operator to `--unshallow` here means they re-run and get the same empty
    // inventory, now doubly convinced it is correct.
    const fixLine = refusal.split("\n").find((line) => line.startsWith("Fix:")) ?? "";
    expect(fixLine).toContain("git remote set-branches origin '*'");
    expect(fixLine).not.toContain("--unshallow");
  });
});

describe("branch-review-ledger row parsing", () => {
  const row = (over: Record<string, string> = {}) => {
    const cells = {
      date: "2026-07-29",
      ref: "codex/thing",
      head: "a".repeat(40),
      scope: "diff review",
      outcome: "fine",
      checks: "npm run test",
      ...over,
    };
    return `| ${[cells.date, cells.ref, cells.head, cells.scope, cells.outcome, cells.checks].join(" | ")} |`;
  };

  it("keeps an escaped prose pipe inside one cell", () => {
    const [parsed] = parseLedgerRows(row({ outcome: String.raw`kept \| escaped` }));
    expect(parsed.cells).toHaveLength(6);
    expect(parsed.outcome).toBe(String.raw`kept \| escaped`);
    expect(parsed.checks).toBe("npm run test");
  });

  it("accepts required values that begin with a double-dash token", () => {
    expect(parseFlags(["--scope", "--shadow-tight migration", "--json"])).toEqual({
      flags: { scope: "--shadow-tight migration", json: true },
      positional: [],
    });
    expect(parseFlags(["--scope=--shadow-tight migration"])).toEqual({
      flags: { scope: "--shadow-tight migration" },
      positional: [],
    });
  });

  it("treats an abbreviated recorded HEAD as the same commit", () => {
    expect(headMatches("`bc5b51c2`", "bc5b51c2f0a9d3e4b5c6d7e8f9a0b1c2d3e4f5a6")).toBe(true);
    expect(headMatches("bc5b51c2 (squash)", "bc5b51c2f0a9d3e4b5c6d7e8f9a0b1c2d3e4f5a6")).toBe(true);
    expect(headMatches("see PR head", "a".repeat(40))).toBe(false);
    expect(headMatches("n/a - see deadbeef", `deadbeef${"0".repeat(32)}`)).toBe(false);
    expect(headMatches("bc5b51c2", "0123456789abcdef0123456789abcdef01234567")).toBe(false);
  });

  it("finds a prior review across origin/ and 'PR #N /' ref spellings", () => {
    const md = [row({ ref: "PR #1 / `codex/thing`" }), row({ ref: "origin/codex/other", head: "b".repeat(40) })].join(
      "\n",
    );
    expect(findReviews(md, { ref: "codex/thing", head: "a".repeat(40) }).atHead).toHaveLength(1);
    expect(findReviews(md, { ref: "codex/other", head: "b".repeat(40) }).atHead).toHaveLength(1);
  });

  it("requires an exact scope match so deletion-pending rows do not skip cleanup", () => {
    const md = row({ scope: "branch-cleanup-deletion-pending" });
    expect(findReviews(md, { ref: "codex/thing", head: "a".repeat(40), scope: "branch-cleanup" }).atHead).toHaveLength(
      0,
    );
    expect(
      findReviews(md, {
        ref: "codex/thing",
        head: "a".repeat(40),
        scope: "branch-cleanup-deletion-pending",
      }).atHead,
    ).toHaveLength(1);
  });

  it("separates records at a different HEAD so only the delta is re-reviewed", () => {
    const md = [row(), row({ head: "b".repeat(40), scope: "later pass" })].join("\n");
    const result = findReviews(md, { ref: "codex/thing", head: "b".repeat(40) });
    expect(result.atHead.map((r) => r.scope)).toEqual(["later pass"]);
    expect(result.otherHead).toHaveLength(1);
  });

  it("escapes pipes and collapses newlines when building a row", () => {
    expect(sanitizeCell("before | after\nnext line")).toBe(String.raw`before \| after next line`);
    const built = buildRow({
      date: "2026-07-29",
      ref: "codex/thing",
      head: "a".repeat(40),
      scope: "s",
      outcome: "a | b",
      checks: "c",
    });
    expect(parseLedgerRows(built)[0].cells).toHaveLength(6);
  });

  it("uses a distinct immutable path for each distinct review record", () => {
    const first = `| 2026-08-13 | codex/a | ${"a".repeat(40)} | review | pass | test |`;
    const second = first.replace("codex/a", "codex/b");
    expect(reviewRecordPath(first)).toMatch(/^docs\/archive\/branch-review-records\/[0-9a-f]{64}\.record\.md$/);
    expect(reviewRecordPath(first)).toBe(reviewRecordPath(first));
    expect(reviewRecordPath(second)).not.toBe(reviewRecordPath(first));
  });

  it("moves only a branch-added legacy row into its immutable record", () => {
    const preamble = "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |";
    const baseRow = `| 2026-08-12 | codex/base | ${"a".repeat(40)} | review | pass | test |`;
    const addedRow = `| 2026-08-13 | codex/active | ${"b".repeat(40)} | review | pass | test |`;
    const result = migrateLegacyRows(`${preamble}\n${baseRow}\n${addedRow}\n`, `${preamble}\n${baseRow}\n`);
    expect(result.added).toEqual([addedRow]);
    expect(result.markdown).toContain(baseRow);
    expect(result.markdown).not.toContain(addedRow);
    expect(() => migrateLegacyRows(`${preamble}\n${addedRow}\n`, `${preamble}\n${baseRow}\n`)).toThrow(
      /removes or rewrites/,
    );
  });

  it("requires explicit approval before legacy table maintenance can write", () => {
    expect(legacyMaintenanceAllowed({ dryRun: true })).toBe(true);
    expect(legacyMaintenanceAllowed({ allow: "false" })).toBe(false);
    expect(legacyMaintenanceAllowed({ allow: "true" })).toBe(true);
  });

  it("refuses a row whose HEAD no lookup could ever match", () => {
    const base = { date: "2026-07-29", ref: "x", scope: "s", outcome: "o", checks: "c" };
    expect(() => buildRow({ ...base, head: "see PR head" })).toThrow(/full 40-character SHA/);
    expect(() => buildRow({ ...base, head: "abc1234" })).toThrow(/full 40-character SHA/);
    expect(buildRow({ ...base, head: "n/a - branch never pushed" })).toContain("n/a - branch never pushed");
  });

  it("dedupes exact twin records and merges concurrent appends without twins", () => {
    const preamble = [
      "This file is append-only.",
      "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |",
      "| --- | --- | --- | --- | --- | --- |",
    ].join("\n");
    const shared = `| 2026-07-30 | codex/x | ${"a".repeat(40)} | Run PR sweep | o | c |`;
    const oursOnly = `| 2026-07-30 | codex/x | ${"b".repeat(40)} | product review | o | c |`;
    const theirsOnly = `| 2026-07-30 | codex/y | ${"c".repeat(40)} | product review | o | c |`;
    const deduped = dedupeLedgerMarkdown(`${preamble}\n${shared}\n${shared}\n`);
    expect(deduped.removed).toBe(1);
    expect(deduped.kept).toBe(1);
    const merged = mergeLedgerMarkdown(
      `${preamble}\n${shared}\n`,
      `${preamble}\n${shared}\n${oursOnly}\n`,
      `${preamble}\n${shared}\n${theirsOnly}\n`,
    );
    expect(merged.recordCount).toBe(3);
    expect(merged.markdown.match(/Run PR sweep/g)).toHaveLength(1);
  });

  it("does not restore rotated base rows or discard the updated preamble", () => {
    const oldPreamble = [
      "# Branch Review Ledger",
      "",
      "Old live-ledger instructions.",
      "",
      "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |",
      "| --- | --- | --- | --- | --- | --- |",
    ].join("\n");
    const newPreamble = oldPreamble.replace("Old live-ledger instructions.", "New archive-aware instructions.");
    const archived = `| 2026-07-01 | old/x | ${"a".repeat(40)} | s | o | c |`;
    const oursOnly = `| 2026-07-30 | ours/x | ${"b".repeat(40)} | s | o | c |`;
    const theirsOnly = `| 2026-07-30 | theirs/x | ${"c".repeat(40)} | s | o | c |`;

    const merged = mergeLedgerMarkdown(
      `${oldPreamble}\n${archived}\n`,
      `${oldPreamble}\n${archived}\n${oursOnly}\n`,
      `${newPreamble}\n${theirsOnly}\n`,
    );

    expect(merged.markdown).not.toContain(archived);
    expect(merged.markdown).toContain(oursOnly);
    expect(merged.markdown).toContain(theirsOnly);
    expect(merged.markdown).toContain("New archive-aware instructions.");
    expect(merged.markdown).not.toContain("Old live-ledger instructions.");
  });

  it("rotates older rows into a quarterly archive while keeping newer live rows", () => {
    expect(calendarQuarterStart("2026-07-30")).toBe("2026-07-01");
    expect(archiveQuarterLabel("2026-07-15")).toBe("2026-q3");
    const preamble = [
      "# Ledger",
      "",
      "This file is append-only.",
      "",
      "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |",
      "| --- | --- | --- | --- | --- | --- |",
    ].join("\n");
    const oldRow = `| 2026-07-01 | old/x | ${"a".repeat(40)} | s | o | c |`;
    const newRow = `| 2026-07-29 | new/x | ${"b".repeat(40)} | s | o | c |`;
    const rotated = rotateLedgerMarkdown(`${preamble}\n${oldRow}\n${newRow}\n`, { before: "2026-07-29" });
    expect(rotated.moved).toBe(1);
    expect(rotated.kept).toBe(1);
    expect(rotated.liveMarkdown).toContain(newRow);
    expect(rotated.liveMarkdown).not.toContain(oldRow);
    expect(rotated.archives[0]?.path).toBe("docs/archive/branch-review-ledger-2026-q3.md");
    expect(rotated.archives[0]?.markdown).toContain(oldRow);
  });
});

describe("branch-review-ledger guard", () => {
  const valid = {
    ledger: [
      "This file is a frozen historical table.",
      "New review records are pull request comments.",
      `| 2026-07-29 | codex/x | ${"a".repeat(40)} | s | o | c |`,
      "",
    ].join("\n"),
    mergeAttribute: "unspecified",
    protocol: "post one `Review record` comment on the PR. The table is frozen",
  };

  it("accepts a well-formed ledger", () => {
    expect(validateLedger(valid).failures).toEqual([]);
  });

  it("rejects a checkout that reintroduces a local-only custom merge driver", () => {
    expect(validateLedger({ ...valid, mergeAttribute: "ledger" }).failures.join(" ")).toMatch(
      /leave merge unspecified/,
    );
  });

  it("rejects mojibake left by a non-UTF-8 append", () => {
    const ledger = valid.ledger.replace("| o |", "| restored ??? arc |");
    expect(validateLedger({ ...valid, ledger }).failures.join(" ")).toMatch(/mojibake/);
  });

  it("rejects a record that is not six cells", () => {
    const ledger = valid.ledger.replace("| s | o | c |", "| s | o has a | pipe | c |");
    expect(validateLedger({ ...valid, ledger }).failures.join(" ")).toMatch(/6 cells/);
  });

  it("rejects a record written as a dated heading inside the table", () => {
    const ledger = `${valid.ledger}\n## 2026-07-29 - a review\n`;
    expect(validateLedger({ ...valid, ledger }).failures.join(" ")).toMatch(/dated heading/);
  });

  it("rejects an unmatchable HEAD only for records under the machine-readable contract", () => {
    const strict = valid.ledger.replace("a".repeat(40), "see PR head");
    expect(validateLedger({ ...valid, ledger: strict }).failures.join(" ")).toMatch(/no lookup can match/);
    const legacy = strict.replace("2026-07-29", "2026-07-01");
    expect(validateLedger({ ...valid, ledger: legacy }).failures).toEqual([]);
  });
});

describe("outstanding-issues merge attribute", () => {
  // Ledger #133 removed `merge=union` so overlapping edits conflict loudly rather
  // than being silently concatenated. Git's three non-driver states are not
  // interchangeable, and only one of them is that contract.
  it("accepts an unspecified attribute, the documented default 3-way merge", () => {
    expect(mergeAttributeProblem("unspecified")).toBeNull();
  });

  it("rejects `-merge`, which conflicts every two-sided edit instead of merging", () => {
    // Unset is not Unspecified: it takes the current branch's version and declares
    // a conflict. `git check-attr` reports it as "unset", and an earlier revision of
    // this guard accepted that string while printing "no merge driver".
    expect(mergeAttributeProblem("unset")).toMatch(/must leave `merge` unspecified/);
  });

  it("rejects a named driver, including the one #133 removed", () => {
    expect(mergeAttributeProblem("union")).toMatch(/must have NO merge driver/);
    expect(mergeAttributeProblem("ledger")).toMatch(/must have NO merge driver/);
  });

  it("rejects an empty reading rather than treating it as absence", () => {
    // An empty string means check-attr output did not parse — silently accepting it
    // would make the whole check vacuous.
    expect(mergeAttributeProblem("")).toMatch(/must have NO merge driver/);
  });
});

describe("outstanding-issues inbox", () => {
  it("queues valid operations and rejects unassigned mutations", () => {
    const add = {
      version: 1,
      id: "11111111-1111-4111-8111-111111111111",
      createdOn: "2026-08-13",
      action: "add",
      payload: { pri: "P2", type: "issue", summary: "queued" },
    };
    expect(validateRequest(add)).toEqual([]);
    const currentAdd = {
      ...add,
      version: 2,
      payload: { ...add.payload, issueUlid: "0000000000ABCDEF0000000000" },
    };
    expect(validateRequest(currentAdd)).toEqual([]);
    expect(validateRequest({ ...currentAdd, payload: { ...currentAdd.payload, issueUlid: "bad" } })).not.toEqual([]);
    expect(validateRequest({ ...add, action: "done", payload: { outcome: "no id" } })).not.toEqual([]);
    expect(validateRequest({ ...add, action: "done", payload: { id: "#ABCDEF", outcome: "done" } })).toEqual([]);

    const ledger = [
      "<!-- issues:next-id=2 -->",
      "",
      "## Recommended execution queue",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| Order | ID(s) |",
      "| --- | --- |",
      "| 1 | `#001` |",
      "",
      "## Open items",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| #001 | P2 | issue | existing | detail | source | 2026-01-01 |",
      "",
      "## Resolved / archive",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Type | Summary | Outcome | Resolved |",
      "| ---- | ---- | ---- | ---- | ---- |",
      "| #000 | issue | old | done | 2026-01-01 |",
      "",
    ].join("\n");
    const applied = applyRequest(ledger, currentAdd);
    expect(applied).toContain("| #ABCDEF <!-- issue-ulid:0000000000ABCDEF0000000000 --> | P2 | issue | queued |");
    expect(applied).toContain("<!-- issues:next-id=2 -->");
  });

  it("rejects stale done/update requests when the row hash changed after queueing", () => {
    const ledger = [
      "<!-- issues:next-id=2 -->",
      "",
      "## Recommended execution queue",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| Order | ID(s) |",
      "| --- | --- |",
      "| 1 | `#001` |",
      "",
      "## Open items",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| #001 | P2 | issue | original summary | original detail | source | 2026-01-01 |",
      "",
      "## Resolved / archive",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Type | Summary | Outcome | Resolved |",
      "| ---- | ---- | ---- | ---- | ---- |",
      "| #000 | issue | old | done | 2026-01-01 |",
      "",
    ].join("\n");
    const baseFingerprint = issueRowFingerprint(ledger, "#001");
    expect(baseFingerprint).not.toBeNull();

    const done = {
      version: 1,
      id: "77777777-7777-4777-8777-777777777777",
      createdOn: "2026-08-13",
      action: "done",
      payload: { id: "#001", outcome: "done", baseRowFingerprint: baseFingerprint },
    };
    const update = {
      version: 1,
      id: "88888888-8888-4888-8888-888888888888",
      createdOn: "2026-08-13",
      action: "update",
      payload: { id: "#001", summary: "new summary", baseRowFingerprint: baseFingerprint },
    };

    const stale = ledger.replace("original summary", "mutated summary");
    expect(() => applyRequest(ledger, done)).not.toThrow();
    expect(() => applyRequest(stale, done)).toThrow(/stale|no longer open/);
    expect(() => applyRequest(stale, update)).toThrow(/stale|no longer open/);
  });

  it("fingerprints and closes ULID-display-id rows minted by reconcile", () => {
    // Reconcile mints rows whose display id is the ULID's chars 10-16, not a
    // legacy number. issues:done must be able to fingerprint and close them.
    const ledger = [
      "# Outstanding issues",
      "",
      "<!-- next-issue-id: 2 -->",
      "",
      "## Recommended execution queue",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| Order | ID(s) |",
      "| --- | --- |",
      "| 1 | `#001` |",
      "",
      "## Open items",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| #001 | P2 | issue | original summary | original detail | source | 2026-01-01 |",
      "| #6BG9X2 <!-- issue-ulid:01M07SS71R6BG9X2VAGXMM1A1G --> | P2 | task | reconciled summary | reconciled detail | source | 2026-08-17 |",
      "",
      "## Resolved / archive",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Type | Summary | Outcome | Resolved |",
      "| ---- | ---- | ---- | ---- | ---- |",
      "| #000 | issue | old | done | 2026-01-01 |",
      "",
    ].join("\n");

    const fingerprint = issueRowFingerprint(ledger, "#6BG9X2");
    expect(fingerprint).not.toBeNull();
    expect(issueRowFingerprint(ledger, "#000")).toBeNull();
    expect(issueRowFingerprint(ledger, "#ZZZZZZ")).toBeNull();

    const done = {
      version: 2,
      id: "99999999-9999-4999-8999-999999999999",
      createdOn: "2026-08-17",
      action: "done",
      payload: { id: "#6BG9X2", outcome: "closed by test", baseRowFingerprint: fingerprint },
    };
    const update = {
      version: 2,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdOn: "2026-08-17",
      action: "update",
      payload: { id: "#6BG9X2", summary: "updated by test", baseRowFingerprint: fingerprint },
    };
    expect(validateRequest(update)).toEqual([]);
    expect(applyRequest(ledger, update)).toContain("| updated by test | reconciled detail |");
    expect(validateRequest(done)).toEqual([]);
    const applied = applyRequest(ledger, done);
    expect(applied).not.toContain("| #6BG9X2 <!-- issue-ulid:01M07SS71R6BG9X2VAGXMM1A1G --> | P2 |");
    expect(applied.slice(applied.indexOf("## Resolved / archive"))).toContain("closed by test");

    const stale = ledger.replace("reconciled summary", "mutated summary");
    expect(() => applyRequest(stale, done)).toThrow(/stale|no longer open/);
  });

  it("rejects done requests targeting archived or nonexistent issues", () => {
    const ledger = [
      "<!-- issues:next-id=2 -->",
      "",
      "## Recommended execution queue",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| Order | ID(s) |",
      "| --- | --- |",
      "| 1 | `#001` |",
      "",
      "## Open items",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| #001 | P2 | issue | open task | detail | source | 2026-01-01 |",
      "",
      "## Resolved / archive",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Type | Summary | Outcome | Resolved |",
      "| ---- | ---- | ---- | ---- | ---- |",
      "| #000 | issue | archived task | resolved | 2026-01-01 |",
      "",
    ].join("\n");

    const doneArchived = {
      version: 1,
      id: "22222222-2222-4222-8222-222222222222",
      createdOn: "2026-08-14",
      action: "done",
      payload: { id: "#000", outcome: "trying to resolve archived" },
    };
    expect(() => applyRequest(ledger, doneArchived)).toThrow(/#000 is already archived/);

    const doneMissing = {
      version: 1,
      id: "33333333-3333-4333-8333-333333333333",
      createdOn: "2026-08-14",
      action: "done",
      payload: { id: "#999", outcome: "trying to resolve missing" },
    };
    expect(() => applyRequest(ledger, doneMissing)).toThrow(/#999 is not in/);
  });

  it("rejects update requests targeting archived or nonexistent issues", () => {
    const ledger = [
      "<!-- issues:next-id=2 -->",
      "",
      "## Recommended execution queue",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| Order | ID(s) |",
      "| --- | --- |",
      "| 1 | `#001` |",
      "",
      "## Open items",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| #001 | P2 | issue | open task | detail | source | 2026-01-01 |",
      "",
      "## Resolved / archive",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Type | Summary | Outcome | Resolved |",
      "| ---- | ---- | ---- | ---- | ---- |",
      "| #000 | issue | archived task | resolved | 2026-01-01 |",
      "",
    ].join("\n");

    const updateArchived = {
      version: 1,
      id: "44444444-4444-4444-8444-444444444444",
      createdOn: "2026-08-14",
      action: "update",
      payload: { id: "#000", detail: "trying to update archived" },
    };
    expect(() => applyRequest(ledger, updateArchived)).toThrow(/#000 is archived/);

    const updateMissing = {
      version: 1,
      id: "55555555-5555-4555-8555-555555555555",
      createdOn: "2026-08-14",
      action: "update",
      payload: { id: "#999", detail: "trying to update missing" },
    };
    expect(() => applyRequest(ledger, updateMissing)).toThrow(/#999 is not in/);
  });
});
