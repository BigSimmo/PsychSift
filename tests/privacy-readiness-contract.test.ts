import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluatePrivacyReadiness,
  privacyRegisterCoveredPaths,
  privacyRequirementCoveredPaths,
  shallowSkipDecision,
  validatePrivacyReadiness,
} from "../scripts/check-privacy-readiness.mjs";
import { decideReviewedCommitHistoryFromFacts } from "../scripts/lib/reviewed-commit-history-decision.mjs";
import { fixedClockImport, latestIsoDate, perthMidday, shiftIsoDate } from "./helpers/fixed-clock";
import { resolveReviewedCommitHistory, warnReviewedCommitSkipped } from "./helpers/reviewed-commit-history";

const REGISTER = "docs/governance/privacy-readiness.v1.json";
const manifest = JSON.parse(readFileSync(new URL(`../${REGISTER}`, import.meta.url), "utf8"));

type Requirement = { id: string; reviewedAt?: string; reviewExpiresAt?: string };
const requirements = manifest.requirements as Requirement[];

/**
 * THE COMMITTED REGISTER IS CHECKED AS OF ITS OWN LATEST RECORDED REVIEW, NEVER THE REAL CLOCK.
 *
 * Against the real clock this suite (and the CLI run below) turned red on the day the first review
 * lapsed, whatever the change (organisation framework suggestion 6, "defuse the date traps"). A
 * hard-coded date would trap the other way: the next re-review records a later reviewedAt, which
 * reads as "in the future". The latest review date the register records moves with every edit and
 * keeps a real invariant: whoever records a review may not leave another entry already lapsed.
 * The calendar is still enforced by the CLI in strict runs and by the weekly review-date report,
 * and the tests at the end prove that expiry is still detected.
 */
const REGISTER_AS_OF = latestIsoDate([manifest.reviewedAt, ...requirements.map((item) => item.reviewedAt)]);
const REGISTER_NOW = perthMidday(REGISTER_AS_OF);
/** A day after every expiry date the register records: every review has lapsed. */
const AFTER_EVERY_EXPIRY = perthMidday(
  shiftIsoDate(latestIsoDate([manifest.reviewExpiresAt, ...requirements.map((item) => item.reviewExpiresAt)]), 1),
);

/** Spawn the CLI with its clock pinned and no review-date variables inherited from this process. */
function runCli(args: string[], now: Date, env: Record<string, string> = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["REVIEW_DATE_MODE", "BASE_SHA", "HEAD_SHA", "GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_ACTIONS"]) {
    delete childEnv[key];
  }
  return spawnSync(
    process.execPath,
    ["--import", fixedClockImport(now), "scripts/check-privacy-readiness.mjs", ...args],
    {
      encoding: "utf8",
      env: { ...childEnv, ...env },
    },
  );
}
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const retentionParityMigration = readFileSync(
  new URL("../supabase/migrations/20260901033250_enable_staging_privacy_retention_schedules.sql", import.meta.url),
  "utf8",
);

describe("privacy readiness contract", () => {
  it("accepts the honest structural register", () => {
    // This suite had no shallow-checkout handling at all, so on a partial clone it failed with
    // "reviewedCommit does not exist" — a statement about the checkout being read as a statement
    // about the register. Its sibling hazard suite had a guard; this one did not. See
    // tests/helpers/reviewed-commit-history.ts for the 2026-09-07 incident.
    const { checkGit, skipReason } = resolveReviewedCommitHistory(manifest.reviewedCommit);
    if (skipReason) warnReviewedCommitSkipped("privacy readiness", skipReason);
    expect(validatePrivacyReadiness(manifest, { checkGit, now: REGISTER_NOW })).toEqual([]);
  });

  it("skips structural Git checks when a shallow checkout has the commit but cannot answer its ancestry", () => {
    // A fetched commit object alone does not make the evidence-at-commit checks safe: the
    // reviewed snapshot still cannot be walked. This is the present-but-unreachable partial
    // history case reported on the privacy CLI.
    expect(
      shallowSkipDecision({ release: false, shallow: true, commitPresent: true, ancestor: false, treeReadable: true }),
    ).toEqual({
      skip: true,
      blocked: false,
    });
    expect(
      shallowSkipDecision({ release: true, shallow: true, commitPresent: true, ancestor: false, treeReadable: true }),
    ).toEqual({
      skip: false,
      blocked: true,
    });
  });

  it("skips structural Git checks when a nested reviewed tree is unavailable", () => {
    // A root tree can be present while a nested governance path is absent from a filtered
    // checkout. The CLI must not enable checkGit until its recursive tree walk is readable.
    expect(
      shallowSkipDecision({ release: false, shallow: false, commitPresent: true, ancestor: true, treeReadable: false }),
    ).toEqual({
      skip: true,
      blocked: false,
    });
  });

  it("never skips the reviewedCommit checks in release mode when history is unanswerable", () => {
    // The release gate's repository binding is exactly these checks, so a
    // truncated checkout must block the release rather than quietly pass it.
    expect(
      shallowSkipDecision({
        release: false,
        shallow: true,
        commitPresent: false,
        ancestor: false,
        treeReadable: false,
      }),
    ).toEqual({
      skip: true,
      blocked: false,
    });
    expect(
      shallowSkipDecision({ release: true, shallow: true, commitPresent: false, ancestor: false, treeReadable: false }),
    ).toEqual({
      skip: false,
      blocked: true,
    });
    // A reachable commit or a full clone is proved, not skipped, in either mode.
    for (const release of [false, true]) {
      expect(
        shallowSkipDecision({ release, shallow: true, commitPresent: true, ancestor: true, treeReadable: true }),
      ).toEqual({
        skip: false,
        blocked: false,
      });
      expect(
        shallowSkipDecision({ release, shallow: false, commitPresent: false, ancestor: false, treeReadable: false }),
      ).toEqual({
        skip: false,
        blocked: false,
      });
    }
  });

  it("shares the reviewed-history unavailability matrix with decideReviewedCommitHistoryFromFacts", () => {
    // Release mode must only wrap the shared answer with blocked — not re-implement it.
    const cases = [
      { shallow: true, commitPresent: true, ancestor: false, treeReadable: true },
      { shallow: false, commitPresent: true, ancestor: true, treeReadable: false },
      { shallow: true, commitPresent: false, ancestor: false, treeReadable: false },
      { shallow: true, commitPresent: true, ancestor: true, treeReadable: true },
      { shallow: false, commitPresent: false, ancestor: false, treeReadable: false },
    ] as const;
    for (const facts of cases) {
      const { checkGit } = decideReviewedCommitHistoryFromFacts(facts);
      expect(shallowSkipDecision({ release: false, ...facts })).toEqual({
        skip: !checkGit,
        blocked: false,
      });
      expect(shallowSkipDecision({ release: true, ...facts })).toEqual({
        skip: false,
        blocked: !checkGit,
      });
    }
  });

  it("encodes history=skipped or history=checked on the structural PASS line", () => {
    // Greppable PASS without a history marker is a silent-success footgun when structural
    // mode skips Git binding. Release already fail-closes; this pins the success line. The clock is
    // pinned to the register's own date so the line is proved without waiting for a lapse.
    const result = runCli([], REGISTER_NOW);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/PRIVACY_READINESS_PASS mode=structural requirements=\d+ history=(checked|skipped)/);
  });

  it("keeps Railway processor evidence linked to the privacy impact assessment", () => {
    const railwayDpa = manifest.requirements.find((item: { id: string }) => item.id === "PRIV-LEGAL-RAILWAY-DPA");
    expect(railwayDpa.evidenceReferences).toContain("docs/privacy-impact-assessment.md");
  });

  it("fails release closed on the remaining human and environment blockers", () => {
    const releaseErrors = validatePrivacyReadiness(manifest, { release: true, now: REGISTER_NOW });
    // 5 Oct 2026: the OpenAI standard-agreement DPA and the executed Railway DPA were recorded
    // verified on attributed external evidence (docs/governance/*-2026-10-05.md), leaving four
    // human/environment blockers. Each remaining one is pinned so none can silently clear.
    expect(releaseErrors).toEqual(
      expect.arrayContaining([
        "PRIV-PROVIDER-OPENAI-ZDR: release-blocking status pending",
        "PRIV-LEGAL-APP8-CROSS-BORDER-BASIS: release-blocking status pending",
        "PRIV-LEGAL-APP1-APP5-NOTICE: release-blocking status pending",
        "PRIV-CLINICAL-PHI-MINIMISATION: release-blocking status partial",
      ]),
    );
    expect(releaseErrors.filter((error: string) => error.includes("release-blocking status"))).toHaveLength(4);
    expect(releaseErrors).not.toContain("PRIV-LEGAL-RAILWAY-DPA: release-blocking status pending");
    expect(releaseErrors).not.toContain("PRIV-LEGAL-OPENAI-DPA: release-blocking status pending");
    expect(releaseErrors).not.toContain("PRIV-PROVIDER-PRODUCTION-HMAC-SECRET: release-blocking status partial");
    expect(releaseErrors).not.toContain("PRIV-PROVIDER-RETENTION-SCHEDULE-PARITY: release-blocking status partial");
    expect(packageJson.scripts["check:production-readiness"]).toContain("check:privacy-readiness:release");
    expect(packageJson.scripts["check:production-readiness:ci"]).toContain("check:privacy-readiness");
    expect(packageJson.scripts["check:production-readiness:ci"]).not.toContain("check:privacy-readiness:release");
  });

  it("records current provider evidence without promoting repository-only OpenAI claims", () => {
    const byId = new Map(manifest.requirements.map((item: { id: string }) => [item.id, item]));

    expect(byId.get("PRIV-PROVIDER-PRODUCTION-HMAC-SECRET")).toMatchObject({
      status: "verified",
      verifiedByRole: "Production platform owner",
    });
    expect(byId.get("PRIV-PROVIDER-OPENAI-ZDR")).toMatchObject({
      status: "pending",
      externalEvidenceReference: expect.stringContaining("API input/output sharing disabled"),
    });
    expect(byId.get("PRIV-PROVIDER-OPENAI-ZDR")).toMatchObject({
      externalEvidenceReference: expect.stringContaining("API call logging to Disabled"),
    });
    expect(byId.get("PRIV-PROVIDER-OPENAI-ZDR")).toMatchObject({
      externalEvidenceReference: expect.stringContaining("disabled hosted MCP, web search, file search"),
    });
    expect(byId.get("PRIV-PROVIDER-OPENAI-ZDR")).toMatchObject({
      externalEvidenceReference: expect.stringContaining("submitted and acknowledged by OpenAI"),
    });
    // The OpenAI DPA is verified only on attributed external evidence, never on repository checks.
    expect(byId.get("PRIV-LEGAL-OPENAI-DPA")).toMatchObject({
      status: "verified",
      verifiedByRole: "Authorised legal signatory",
      externalEvidenceReference: expect.stringContaining("OPENAI-STD-20261005: owner-attested"),
    });
    expect(byId.get("PRIV-LEGAL-RAILWAY-DPA")).toMatchObject({
      status: "verified",
      verifiedByRole: "Authorised legal signatory",
      externalEvidenceReference: expect.stringContaining("no sensitive-data suitability or release approval"),
    });
    expect(byId.get("PRIV-PROVIDER-RETENTION-SCHEDULE-PARITY")).toMatchObject({
      status: "verified",
      verifiedByRole: "Database operations owner",
    });
    expect(byId.get("PRIV-LEGAL-APP8-CROSS-BORDER-BASIS")).toMatchObject({ status: "pending" });
    expect(byId.get("PRIV-CLINICAL-PHI-MINIMISATION")).toMatchObject({ status: "partial" });
  });

  it("reconciles all four staging privacy-retention schedules after enabling pg_cron", () => {
    expect(retentionParityMigration).toContain("create extension if not exists pg_cron with schema pg_catalog");
    expect(retentionParityMigration).toContain("'purge-expired-rag-queries'");
    expect(retentionParityMigration).toContain("'purge-rag-retrieval-logs'");
    expect(retentionParityMigration).toContain("'purge-rag-query-misses'");
    expect(retentionParityMigration).toContain("'purge-rag-response-cache'");
    expect(retentionParityMigration).toContain("select public.purge_expired_rag_queries(30)");
    expect(retentionParityMigration).toContain("interval '90 days'");
    expect(retentionParityMigration).toContain("select public.purge_expired_rag_query_misses(90)");
    expect(retentionParityMigration).toContain("select public.purge_expired_rag_response_cache(1000)");
  });

  it("rejects contradictory external verification and forbidden accepted-decision rollback", () => {
    const changed = structuredClone(manifest);
    const requirement = changed.requirements.find((item: { id: string }) => item.id === "PRIV-LEGAL-OPENAI-DPA");
    requirement.status = "verified";
    requirement.statusHistory = [
      { status: "accepted_decision", date: "2026-08-22" },
      { status: "verified", date: "2026-08-23" },
    ];
    delete requirement.externalEvidenceReference;
    delete requirement.verifiedByRole;
    const errors = validatePrivacyReadiness(changed, { checkFiles: false, now: REGISTER_NOW });
    expect(errors).toContain("PRIV-LEGAL-OPENAI-DPA: transition accepted_decision -> verified is not allowed");
    expect(errors).toContain("PRIV-LEGAL-OPENAI-DPA: verified external evidence requires externalEvidenceReference");
    expect(errors).toContain("PRIV-LEGAL-OPENAI-DPA: verified external evidence requires verifiedByRole");
  });

  it("rejects expired reviews, fake commits, escaped evidence, and unauthorised accepted decisions", () => {
    const changed = structuredClone(manifest);
    changed.reviewedCommit = "f".repeat(40);
    changed.reviewExpiresAt = "2026-08-22";
    changed.requirements[0].evidenceReferences = ["C:/Windows/System32/drivers/etc/hosts"];
    const legal = changed.requirements.find((item: { id: string }) => item.id === "PRIV-LEGAL-OPENAI-DPA");
    legal.status = "accepted_decision";
    legal.statusHistory = [{ status: "accepted_decision", date: "2026-08-23" }];
    legal.acceptedByRole = "Application developer";
    legal.decisionReference = "docs/privacy-impact-assessment.md";
    const errors = validatePrivacyReadiness(changed, { now: new Date("2026-08-23T12:00:00Z") });
    expect(errors).toContain(`reviewedCommit does not exist: ${"f".repeat(40)}`);
    expect(errors).toContain("manifest review has expired");
    expect(errors).toContain("PRIV-CODE-QUERY-HASH: missing evidence C:/Windows/System32/drivers/etc/hosts");
    expect(errors).toContain("PRIV-LEGAL-OPENAI-DPA: acceptedByRole is not authorised for legal evidence");
    expect(errors).toContain("PRIV-LEGAL-OPENAI-DPA: decisionReference must be an existing docs/governance record");
  });

  it("rejects impossible calendar dates", () => {
    const changed = structuredClone(manifest);
    changed.reviewedAt = "2026-02-30";
    expect(validatePrivacyReadiness(changed, { checkFiles: false, now: REGISTER_NOW })).toContain(
      "manifest review dates must be ISO dates",
    );
  });
});

/**
 * Organisation framework suggestion 6, "defuse the date traps" (owner decision 2026-09-26, which
 * includes this register). On a pull request or in the merge queue an EXPIRED review is a warning,
 * unless the change touches this register or a path the expired requirement covers; then it still
 * blocks. Local runs, main and release mode stay strict. These pin both halves.
 */
describe("privacy readiness review dates: expiry and pull-request scope", () => {
  const { checkGit } = resolveReviewedCommitHistory(manifest.reviewedCommit);
  const UNRELATED = "docs/organisation/README.md";
  const prScope = (touched: string[]) => ({ mode: "pr" as const, touched, base: "base", head: "head", notes: [] });
  const expired = (lines: string[]) => lines.filter((line) => line.includes("review has expired"));
  const lapsedCount = 1 + requirements.length;

  it("still detects every lapsed review once now is later (strict by default)", () => {
    const errors = validatePrivacyReadiness(manifest, { checkGit, now: AFTER_EVERY_EXPIRY });
    expect(errors).toContain("manifest review has expired");
    for (const item of requirements) expect(errors).toContain(`${item.id}: review has expired`);
    expect(expired(errors)).toHaveLength(lapsedCount);
  });

  it("expires the day after the stated date, not on it", () => {
    const [first] = [...requirements].sort((a, b) =>
      String(a.reviewExpiresAt).localeCompare(String(b.reviewExpiresAt)),
    );
    const onTheDay = validatePrivacyReadiness(manifest, { checkGit, now: perthMidday(String(first.reviewExpiresAt)) });
    expect(onTheDay).not.toContain(`${first.id}: review has expired`);
    const dayAfter = validatePrivacyReadiness(manifest, {
      checkGit,
      now: perthMidday(shiftIsoDate(String(first.reviewExpiresAt), 1)),
    });
    expect(dayAfter).toContain(`${first.id}: review has expired`);
  });

  it("warns instead of blocking on a pull request that touches neither the register nor a covered path", () => {
    expect(privacyRegisterCoveredPaths(manifest)).not.toContain(UNRELATED);
    const { errors, warnings } = evaluatePrivacyReadiness(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([UNRELATED]),
    });
    expect(errors).toEqual([]);
    expect(expired(warnings)).toHaveLength(lapsedCount);
    expect(warnings.some((warning) => warning.startsWith("manifest review has expired. Not blocking"))).toBe(true);
  });

  it("blocks on a register touch only for the lapsed requirement the change edits (owner decision 2026-09-26)", () => {
    const [edited, ...others] = manifest.requirements;
    const head = {
      ...manifest,
      requirements: [{ ...edited, accountableRole: `${edited.accountableRole} (edited)` }, ...others],
    };
    const copies: Record<string, string> = { base: JSON.stringify(manifest), head: JSON.stringify(head) };
    const { errors, warnings } = evaluatePrivacyReadiness(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: {
        ...prScope([REGISTER]),
        mergeBase: "base",
        read: (revision: string) => copies[revision] ?? null,
      },
    });
    expect(expired(errors)).toEqual([
      `${edited.id}: review has expired (blocking: this change touches this entry in ${REGISTER})`,
    ]);
    expect(expired(warnings)).toHaveLength(lapsedCount - 1);
  });

  it("still blocks every lapsed review when the register is touched and the entries cannot be compared", () => {
    const { errors, warnings } = evaluatePrivacyReadiness(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([REGISTER]),
    });
    expect(warnings).toEqual([]);
    expect(errors).toContain(`manifest review has expired (blocking: this change touches ${REGISTER})`);
    for (const item of requirements) {
      expect(errors).toContain(`${item.id}: review has expired (blocking: this change touches ${REGISTER})`);
    }
  });

  it("blocks only the requirements that cover a path the pull request touches, plus the register-wide review", () => {
    const covered = new Map(requirements.map((item) => [item.id, privacyRequirementCoveredPaths(item)]));
    // A path exactly one requirement covers, so the others show that they stay warnings.
    const pick = [...covered].flatMap(([id, paths]) =>
      paths
        .filter((path) => [...covered].every(([other, list]) => other === id || !list.includes(path)))
        .map((path) => ({ id, path })),
    )[0];
    expect(pick).toBeDefined();
    const { errors, warnings } = evaluatePrivacyReadiness(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([pick.path]),
    });
    expect(errors).toContain(`${pick.id}: review has expired (blocking: this change touches ${pick.path})`);
    expect(errors).toContain(`manifest review has expired (blocking: this change touches ${pick.path})`);
    expect(expired(errors)).toHaveLength(2);
    for (const item of requirements.filter((entry) => entry.id !== pick.id)) {
      expect(warnings.some((warning) => warning.startsWith(`${item.id}: review has expired. Not blocking`))).toBe(true);
    }
  });

  it("covers evidence by path, without its anchor, and the decision record", () => {
    expect(
      privacyRequirementCoveredPaths({
        evidenceReferences: ["docs/a.md#section-2", "src/b.ts", "docs/a.md"],
        decisionReference: "docs/governance/decision.md#record",
      }),
    ).toEqual(["docs/a.md", "docs/governance/decision.md", "src/b.ts"]);
  });

  it("keeps release mode strict whatever scope is passed", () => {
    const { errors, warnings } = evaluatePrivacyReadiness(manifest, {
      release: true,
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([UNRELATED]),
    });
    expect(warnings).toEqual([]);
    expect(errors).toContain("manifest review has expired");
    for (const item of requirements) expect(errors).toContain(`${item.id}: review has expired`);
  });

  it("keeps future dates, bad dates and non-date checks blocking in pull-request mode", () => {
    const changed = structuredClone(manifest);
    changed.requirements[0].reviewedAt = shiftIsoDate(REGISTER_AS_OF, 1);
    changed.requirements[1].reviewedAt = "2026-02-30";
    changed.requirements[2].reviewExpiresAt = shiftIsoDate(changed.requirements[2].reviewedAt, -1);
    changed.requirements[3].accountableRole = " ";
    const { errors } = evaluatePrivacyReadiness(changed, {
      checkFiles: false,
      now: REGISTER_NOW,
      reviewDateScope: prScope([UNRELATED]),
    });
    const [first, second, third, fourth] = changed.requirements.map((item: { id: string }) => item.id);
    expect(errors).toContain(`${first}: reviewedAt is in the future`);
    expect(errors).toContain(`${second}: review dates must be ISO dates`);
    expect(errors).toContain(`${third}: reviewExpiresAt precedes reviewedAt`);
    expect(errors).toContain(`${fourth}: accountableRole is required`);
  });

  describe("the command-line check", () => {
    const PR_ENV = { REVIEW_DATE_MODE: "pr", BASE_SHA: "HEAD", HEAD_SHA: "HEAD", GITHUB_EVENT_NAME: "pull_request" };

    it("fails a lapsed register when strict and only warns in pull-request mode", () => {
      const strictRun = runCli([], AFTER_EVERY_EXPIRY);
      expect(strictRun.status).toBe(1);
      expect(strictRun.stderr).toContain("PRIVACY_READINESS_FAIL mode=structural review-dates=strict");
      expect(strictRun.stderr).toContain("- manifest review has expired\n");

      const prRun = runCli([], AFTER_EVERY_EXPIRY, PR_ENV);
      expect(prRun.status).toBe(0);
      expect(prRun.stdout).toMatch(
        new RegExp(
          `PRIVACY_READINESS_PASS mode=structural requirements=\\d+ history=(checked|skipped) review-dates=pr touched=0 expired-not-blocking=${lapsedCount}`,
        ),
      );
      expect(prRun.stderr).toContain("PRIVACY_READINESS_REVIEW_DATE_WARNING: manifest review has expired.");
    });

    // Release mode refuses to run at all on a checkout without the reviewed history, before any date
    // is read, so this proof needs that history.
    it.skipIf(!checkGit)("ignores pull-request mode in release mode", () => {
      const releaseRun = runCli(["--release"], AFTER_EVERY_EXPIRY, PR_ENV);
      expect(releaseRun.status).toBe(1);
      expect(releaseRun.stderr).toContain("PRIVACY_READINESS_FAIL mode=release review-dates=strict");
      expect(releaseRun.stderr).toContain("- manifest review has expired\n");
    });

    it("refuses pull-request mode on a non-main push and stays strict", () => {
      const pushRun = runCli([], AFTER_EVERY_EXPIRY, {
        ...PR_ENV,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/topic",
      });
      expect(pushRun.status).toBe(1);
      expect(pushRun.stderr).toContain("PRIVACY_READINESS_REVIEW_DATE_MODE: REVIEW_DATE_MODE=pr was not applied");
      expect(pushRun.stderr).toContain("- manifest review has expired\n");
    });
  });
});
