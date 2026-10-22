import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  citedRegisterPaths,
  evaluateClinicalHazardControls,
  hazardEntryCoveredPaths,
  hazardRegisterCoveredPaths,
  reviewedContentDigest,
  sealReviewedPathDigests,
  validateClinicalHazardControls,
} from "../scripts/check-clinical-hazard-controls.mjs";
import { fixedClockImport, latestIsoDate, perthMidday, shiftIsoDate } from "./helpers/fixed-clock";
import { resolveReviewedCommitHistory, warnReviewedCommitSkipped } from "./helpers/reviewed-commit-history";

const REGISTER = "docs/clinical-hazard-controls.json";
const manifest = JSON.parse(readFileSync(new URL(`../${REGISTER}`, import.meta.url), "utf8"));

type DatedEntry = { reviewedAt?: string; reviewExpiresAt?: string; recordedOn?: string; expiresOn?: string };
const datedEntries = (register: typeof manifest): DatedEntry[] => [
  register,
  ...(register.hazards ?? []),
  ...(register.assuranceDecisions ?? []),
  ...(register.driftExceptions ?? []),
];

/**
 * THE COMMITTED REGISTER IS CHECKED AS OF ITS OWN LATEST RECORDED DATE, NEVER THE REAL CLOCK.
 *
 * Against the real clock this suite turned red for every change on the day a review date lapsed
 * (organisation framework suggestion 6, "defuse the date traps"). A hard-coded date would trap in
 * the other direction: the next re-review records a later reviewedAt, which reads as "in the
 * future". The latest date the register itself records (a review or an exception being recorded)
 * is deterministic and moves with every edit, and it keeps a real invariant: whoever edits the
 * register may not leave another entry already lapsed at that moment. The calendar is still
 * enforced by the CLI in strict runs and by the weekly review-date report; the tests below prove
 * that expiry is still detected.
 */
const REGISTER_AS_OF = latestIsoDate(datedEntries(manifest).flatMap((entry) => [entry.reviewedAt, entry.recordedOn]));
const REGISTER_NOW = perthMidday(REGISTER_AS_OF);
/** A day after every expiry date the register records: every review and exception has lapsed. */
const AFTER_EVERY_EXPIRY = perthMidday(
  shiftIsoDate(latestIsoDate(datedEntries(manifest).flatMap((entry) => [entry.reviewExpiresAt, entry.expiresOn])), 1),
);

/** A SHA that is well-formed and cannot exist, standing in for one a squash merge orphaned. */
const ORPHANED_COMMIT = "0".repeat(39) + "1";

describe("clinical hazard controls contract", () => {
  it("validates paths, tests, dates, required hazards, and open assurance boundaries", () => {
    // The shallow-checkout decision moved to a shared helper on 2026-09-07. The guard this
    // replaces asked only whether the commit OBJECT was present, so a session holding that
    // object while unable to walk to it failed the ancestry check and reported eight hazard
    // sign-off records as broken. They were not. See the helper for the full incident.
    const { checkGit, skipReason } = resolveReviewedCommitHistory(manifest.reviewedCommit);
    if (skipReason) warnReviewedCommitSkipped("clinical hazard controls", skipReason);
    expect(validateClinicalHazardControls(manifest, { checkGit, now: REGISTER_NOW })).toEqual([]);
  });

  // #D7K71C: this repository squash-merges, so an author cannot know the SHA their register
  // update will land as. PR #2882 pinned its own pre-squash branch head; the squash orphaned it
  // and every branch that merged main went red until it was repaired by hand. These four cases
  // pin the replacement: the reviewed CONTENT is what must still be provable, not the commit.
  describe("a squash merge that orphans the reviewed commit", () => {
    function orphaned() {
      const changed = structuredClone(manifest);
      const { sealed } = sealReviewedPathDigests(changed);
      sealed.reviewedCommit = ORPHANED_COMMIT;
      for (const hazard of sealed.hazards) hazard.reviewedCommit = ORPHANED_COMMIT;
      for (const decision of sealed.assuranceDecisions) decision.reviewedCommit = ORPHANED_COMMIT;
      return sealed;
    }

    it("passes when the recorded digests still prove the reviewed content", () => {
      expect(validateClinicalHazardControls(orphaned(), { checkGit: true, now: REGISTER_NOW })).toEqual([]);
    });

    it("fails, naming the remedy, when no digests were recorded", () => {
      const changed = orphaned();
      delete changed.reviewedPathDigests;
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: REGISTER_NOW });
      expect(errors.join("\n")).toContain("no reviewedPathDigests are recorded");
      expect(errors.join("\n")).toContain("npm run governance:seal-hazard-controls");
    });

    /**
     * Drift FAILS unless a reviewed, expiring exception covers it (audit F13, 2026-09-25).
     * It used to only warn, and by then fourteen safety-behaviour changes had landed in
     * src/lib/clinical-safety.ts and its neighbours since the 2026-08-23 review without anyone
     * re-reviewing them. The exception route keeps the old worry in check: an intended change
     * does not force a reflexive re-seal, but it does force a named, dated, time-limited record.
     */
    function drifted() {
      const changed = orphaned();
      const [firstCitedPath] = citedRegisterPaths(changed);
      changed.reviewedPathDigests[firstCitedPath] = reviewedContentDigest("not what was sealed");
      return { changed, firstCitedPath };
    }
    // Relative to the register's own as-of date (see REGISTER_AS_OF), so a later re-review of the
    // committed entries can never make these fixtures read as "in the future".
    const NOW = REGISTER_NOW;
    const exceptionFor = (path: string, overrides: Record<string, string> = {}) => ({
      path,
      reason: "Behaviour change under clinical re-review",
      recordedBy: "Engineering (not a clinical review)",
      recordedOn: REGISTER_AS_OF,
      expiresOn: shiftIsoDate(REGISTER_AS_OF, 30),
      ...overrides,
    });

    it("fails when a reviewed control has changed since it was sealed and no exception covers it", () => {
      const { changed, firstCitedPath } = drifted();
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: NOW }).join("\n");
      expect(errors).toContain("CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT");
      expect(errors).toContain(firstCitedPath);
      expect(errors).toContain("npm run governance:seal-hazard-controls");
    });

    it("passes while a named, unexpired exception covers the drifted path", () => {
      const { changed, firstCitedPath } = drifted();
      changed.driftExceptions = [exceptionFor(firstCitedPath)];
      expect(validateClinicalHazardControls(changed, { checkGit: true, now: NOW })).toEqual([]);
    });

    it("fails once the exception has expired", () => {
      const { changed, firstCitedPath } = drifted();
      changed.driftExceptions = [
        exceptionFor(firstCitedPath, {
          recordedOn: shiftIsoDate(REGISTER_AS_OF, -40),
          expiresOn: shiftIsoDate(REGISTER_AS_OF, -10),
        }),
      ];
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: NOW }).join("\n");
      expect(errors).toContain("has expired");
      expect(errors).toContain(firstCitedPath);
    });

    it("rejects an exception without a reason or author, or one that runs longer than 45 days", () => {
      const { changed, firstCitedPath } = drifted();
      changed.driftExceptions = [
        exceptionFor(firstCitedPath, { reason: " ", recordedBy: "", expiresOn: shiftIsoDate(REGISTER_AS_OF, 60) }),
      ];
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: NOW }).join("\n");
      expect(errors).toContain("reason is required");
      expect(errors).toContain("recordedBy is required");
      expect(errors).toContain("at most 45 days");
    });

    it("rejects two exceptions for the same path, which the review-date scope could not tell apart", () => {
      const { changed, firstCitedPath } = drifted();
      changed.driftExceptions = [exceptionFor(firstCitedPath), exceptionFor(firstCitedPath)];
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: NOW }).join("\n");
      expect(errors).toContain(`driftExceptions[1] (${firstCitedPath}): duplicate drift exception path`);
    });

    it("drops the exceptions when the register is re-sealed, since nothing has drifted any more", () => {
      const { changed, firstCitedPath } = drifted();
      changed.driftExceptions = [exceptionFor(firstCitedPath)];
      expect(sealReviewedPathDigests(changed).sealed.driftExceptions).toBeUndefined();
    });

    it("still fails when a cited path has no recorded digest at all", () => {
      const changed = orphaned();
      const [firstCitedPath] = citedRegisterPaths(changed);
      delete changed.reviewedPathDigests[firstCitedPath];
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: REGISTER_NOW });
      expect(errors.join("\n")).toContain(`no recorded digest for ${firstCitedPath}`);
    });

    // The point of saying it once: eleven entries pin the same commit, and eleven copies of the
    // same finding is how a real one gets skimmed past.
    it("reports the unreachable commit once, not once per entry", () => {
      const changed = orphaned();
      delete changed.reviewedPathDigests;
      const errors = validateClinicalHazardControls(changed, { checkGit: true, now: REGISTER_NOW });
      expect(errors.filter((error: string) => error.includes(ORPHANED_COMMIT))).toHaveLength(1);
    });
  });

  it("does not allow static evidence to close clinical truth or external risk acceptance", () => {
    const changed = structuredClone(manifest);
    changed.assuranceDecisions[0].state = "controlled";
    changed.assuranceDecisions[1].state = "accepted_decision";
    const errors = validateClinicalHazardControls(changed, { checkFiles: false, now: REGISTER_NOW });
    expect(errors).toContain("clinical truth authority closure requires an external evidence reference");
    expect(errors).toContain("external risk acceptance closure requires acceptanceReference and acceptedByRole");
  });

  it("requires partial hazards to name controls, paths, and tests", () => {
    const changed = structuredClone(manifest);
    changed.hazards[0].controlPaths = [];
    changed.hazards[0].tests = [];
    expect(validateClinicalHazardControls(changed, { checkFiles: false, now: REGISTER_NOW })).toContain(
      "H1: partial state requires controlSymbols, controlPaths, and tests",
    );
  });

  /**
   * Existence is not evidence. Until audit M33 the validator only checked that each
   * listed test file existed and matched `tests/*.test.ts`, so a hazard's named proofs
   * could be emptied of the relevant case — or the control symbol renamed and re-added
   * as a comment — while CLINICAL_HAZARD_CONTROLS_PASS kept printing.
   */
  it("requires at least one listed test to reference a control symbol or control path", () => {
    const changed = structuredClone(manifest);
    // A real, existing test file that names none of H1's controls.
    changed.hazards[0].tests = ["tests/clinical-hazard-controls.test.ts"];
    const errors = validateClinicalHazardControls(changed, { checkFiles: true, checkGit: false, now: REGISTER_NOW });
    expect(errors).toContain(
      "H1: no listed test references a control symbol or imports a control path (tests/clinical-hazard-controls.test.ts)",
    );
    // The committed manifest satisfies the rule for every hazard.
    expect(validateClinicalHazardControls(manifest, { checkFiles: true, checkGit: false, now: REGISTER_NOW })).toEqual(
      [],
    );
  });

  /**
   * The symbol-presence check escapes regex metacharacters before wrapping the symbol in
   * word boundaries. Until audit L22 the escape class was mis-written so nothing was
   * escaped: a dotted symbol acted as a wildcard (fail-open) and a bracket symbol threw.
   * The sentinels below live in this file, which the fixture names as its control path:
   * `fooxbar` and `sentinel(x)` — the dotted symbol itself is assembled at runtime so it
   * never appears here literally.
   */
  it("escapes regex metacharacters in control symbols instead of treating them as wildcards", () => {
    const self = "tests/clinical-hazard-controls.test.ts";
    const dotted = ["foo", "bar"].join(".");
    const changed = structuredClone(manifest);
    changed.hazards[0].controlPaths = [self];
    changed.hazards[0].tests = [self];
    changed.hazards[0].controlSymbols = [dotted];
    expect(validateClinicalHazardControls(changed, { checkFiles: true, checkGit: false, now: REGISTER_NOW })).toContain(
      `H1: control symbol ${dotted} not found in controlPaths`,
    );

    const bracketed = ["sentinel", "("].join("");
    changed.hazards[0].controlSymbols = [bracketed];
    let errors: string[] = [];
    expect(() => {
      errors = validateClinicalHazardControls(changed, { checkFiles: true, checkGit: false, now: REGISTER_NOW });
    }).not.toThrow();
    expect(errors).not.toContain(`H1: control symbol ${bracketed} not found in controlPaths`);
  });

  it("rejects stale or impossible dates, fake commits, and escaped evidence paths", () => {
    const changed = structuredClone(manifest);
    changed.reviewExpiresAt = "2026-08-22";
    changed.hazards[0].reviewedAt = "2026-02-30";
    changed.hazards[1].reviewedCommit = "f".repeat(40);
    changed.hazards[2].controlPaths = ["C:/Windows/System32/drivers/etc/hosts"];
    const errors = validateClinicalHazardControls(changed, { now: new Date("2026-08-23T12:00:00Z") });
    expect(errors).toContain("manifest: review has expired");
    expect(errors).toContain("H1: review dates must be ISO dates");
    expect(errors).toContain(`H2: reviewedCommit does not exist ${"f".repeat(40)}`);
    expect(errors).toContain("H2: reviewedCommit must match manifest");
    expect(errors).toContain("H3: missing path C:/Windows/System32/drivers/etc/hosts");
  });

  it("requires an authorised role and governance record for accepted decisions", () => {
    const changed = structuredClone(manifest);
    const decision = changed.assuranceDecisions[1];
    decision.state = "accepted_decision";
    decision.acceptedByRole = "Application developer";
    decision.acceptanceReference = "docs/clinical-hazard-analysis.md";
    const errors = validateClinicalHazardControls(changed, { checkFiles: false, now: REGISTER_NOW });
    expect(errors).toContain("EXTERNAL-RISK-ACCEPTANCE: acceptedByRole must be Authorised risk owner");
    expect(errors).toContain(
      "EXTERNAL-RISK-ACCEPTANCE: acceptanceReference must be an existing docs/governance record",
    );
  });
});

/**
 * Organisation framework suggestion 6, "defuse the date traps" (owner decision 2026-09-26). On a
 * pull request or in the merge queue an EXPIRED review date is a warning, unless the change touches
 * this register or a path the expired entry covers; then it still blocks. Local runs, main and
 * release checks stay strict. These tests pin both halves, and the checks that must not move.
 */
describe("clinical hazard review dates: expiry and pull-request scope", () => {
  const { checkGit } = resolveReviewedCommitHistory(manifest.reviewedCommit);
  const UNRELATED = "docs/organisation/README.md";
  const prScope = (touched: string[]) => ({ mode: "pr" as const, touched, base: "base", head: "head", notes: [] });
  const expired = (lines: string[]) => lines.filter((line) => line.includes("has expired"));
  const entries = () => [...manifest.hazards, ...manifest.assuranceDecisions] as { id: string }[];
  const lapsedCount = 1 + entries().length + (manifest.driftExceptions ?? []).length;

  it("still detects every lapsed review and exception once now is later (strict by default)", () => {
    const errors = validateClinicalHazardControls(manifest, { checkGit, now: AFTER_EVERY_EXPIRY });
    expect(errors).toContain("manifest: review has expired");
    for (const entry of entries()) expect(errors).toContain(`${entry.id}: review has expired`);
    (manifest.driftExceptions ?? []).forEach((exception: { path: string; expiresOn: string }, index: number) => {
      expect(errors).toContain(
        `driftExceptions[${index}] (${exception.path}): drift exception has expired on ${exception.expiresOn}. ` +
          "Re-review the change and run npm run governance:seal-hazard-controls.",
      );
    });
    expect(expired(errors)).toHaveLength(lapsedCount);
  });

  it("expires the day after the stated date, not on it", () => {
    const onTheDay = validateClinicalHazardControls(manifest, { checkGit, now: perthMidday(manifest.reviewExpiresAt) });
    expect(onTheDay).not.toContain("manifest: review has expired");
    const dayAfter = validateClinicalHazardControls(manifest, {
      checkGit,
      now: perthMidday(shiftIsoDate(manifest.reviewExpiresAt, 1)),
    });
    expect(dayAfter).toContain("manifest: review has expired");
  });

  it("warns instead of blocking on a pull request that touches neither the register nor a covered path", () => {
    expect(hazardRegisterCoveredPaths(manifest)).not.toContain(UNRELATED);
    const { errors, warnings } = evaluateClinicalHazardControls(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([UNRELATED]),
    });
    expect(errors).toEqual([]);
    expect(expired(warnings)).toHaveLength(lapsedCount);
    expect(warnings.some((warning) => warning.startsWith("manifest: review has expired. Not blocking"))).toBe(true);
    // An expired exception on an unrelated change still excuses its drift, so no drift error either.
    expect(errors.join("\n")).not.toContain("CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT");
  });

  it("blocks on a register touch only for the lapsed entry the change edits (owner decision 2026-09-26)", () => {
    const [edited, ...others] = manifest.hazards;
    const head = { ...manifest, hazards: [{ ...edited, residualRisk: `${edited.residualRisk} (edited)` }, ...others] };
    const copies: Record<string, string> = { base: JSON.stringify(manifest), head: JSON.stringify(head) };
    const { errors, warnings } = evaluateClinicalHazardControls(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: {
        ...prScope([UNRELATED, REGISTER]),
        mergeBase: "base",
        read: (revision: string) => copies[revision] ?? null,
      },
    });
    expect(expired(errors)).toEqual([
      `${edited.id}: review has expired (blocking: this change touches this entry in ${REGISTER})`,
    ]);
    expect(expired(warnings)).toHaveLength(lapsedCount - 1);
    expect(warnings.some((warning) => warning.startsWith("manifest: review has expired. Not blocking"))).toBe(true);
  });

  it("still blocks every lapsed entry when the register is touched and the entries cannot be compared", () => {
    const { errors, warnings } = evaluateClinicalHazardControls(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([UNRELATED, REGISTER]),
    });
    expect(warnings).toEqual([]);
    expect(errors).toContain(`manifest: review has expired (blocking: this change touches ${REGISTER})`);
    for (const entry of entries()) {
      expect(errors).toContain(`${entry.id}: review has expired (blocking: this change touches ${REGISTER})`);
    }
    expect(expired(errors)).toHaveLength(lapsedCount);
  });

  it("blocks only the entries that cover a path the pull request touches, plus the register-wide review", () => {
    const covered = new Map(entries().map((entry) => [entry.id, hazardEntryCoveredPaths(entry)]));
    const exceptionPaths = (manifest.driftExceptions ?? []).map((exception: { path: string }) => exception.path);
    // A path exactly one entry covers, so the other entries show that they stay warnings.
    const pick = [...covered].flatMap(([id, paths]) =>
      paths
        .filter((path) => [...covered].every(([other, list]) => other === id || !list.includes(path)))
        .filter((path) => !exceptionPaths.includes(path))
        .map((path) => ({ id, path })),
    )[0];
    expect(pick).toBeDefined();
    const { errors, warnings } = evaluateClinicalHazardControls(manifest, {
      checkGit,
      now: AFTER_EVERY_EXPIRY,
      reviewDateScope: prScope([pick.path]),
    });
    expect(errors).toContain(`${pick.id}: review has expired (blocking: this change touches ${pick.path})`);
    expect(errors).toContain(`manifest: review has expired (blocking: this change touches ${pick.path})`);
    expect(expired(errors)).toHaveLength(2);
    for (const entry of entries().filter((item) => item.id !== pick.id)) {
      expect(warnings.some((warning) => warning.startsWith(`${entry.id}: review has expired. Not blocking`))).toBe(
        true,
      );
    }
  });

  describe("an expired drift exception", () => {
    function withExpiredException() {
      const { sealed } = sealReviewedPathDigests(structuredClone(manifest));
      const [path] = citedRegisterPaths(sealed);
      sealed.reviewedPathDigests[path] = reviewedContentDigest("not what was sealed");
      sealed.driftExceptions = [
        {
          path,
          reason: "Behaviour change under clinical re-review",
          recordedBy: "Engineering (not a clinical review)",
          recordedOn: shiftIsoDate(REGISTER_AS_OF, -40),
          expiresOn: shiftIsoDate(REGISTER_AS_OF, -10),
        },
      ];
      return { sealed, path };
    }

    it("blocks, and stops excusing the drift, in a strict run", () => {
      const { sealed, path } = withExpiredException();
      const errors = validateClinicalHazardControls(sealed, { checkGit, now: REGISTER_NOW }).join("\n");
      expect(errors).toContain(`driftExceptions[0] (${path}): drift exception has expired`);
      expect(errors).toContain("CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT");
    });

    it("warns, and still excuses the drift already on main, for an unrelated pull request", () => {
      const { sealed, path } = withExpiredException();
      const { errors, warnings } = evaluateClinicalHazardControls(sealed, {
        checkGit,
        now: REGISTER_NOW,
        reviewDateScope: prScope([UNRELATED]),
      });
      expect(errors).toEqual([]);
      expect(warnings.join("\n")).toContain(`driftExceptions[0] (${path}): drift exception has expired`);
    });

    it("blocks, and the drift fails too, when the pull request touches the excused path", () => {
      const { sealed, path } = withExpiredException();
      const { errors, warnings } = evaluateClinicalHazardControls(sealed, {
        checkGit,
        now: REGISTER_NOW,
        reviewDateScope: prScope([path]),
      });
      expect(warnings).toEqual([]);
      const text = errors.join("\n");
      expect(text).toContain(`drift exception has expired on ${shiftIsoDate(REGISTER_AS_OF, -10)}`);
      expect(text).toContain(`(blocking: this change touches ${path})`);
      expect(text).toContain(`CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT: these reviewed paths have changed`);
    });
  });

  it("keeps future dates, bad dates, the 45-day cap and non-date checks blocking in pull-request mode", () => {
    const changed = structuredClone(manifest);
    changed.hazards[0].reviewedAt = shiftIsoDate(REGISTER_AS_OF, 1);
    changed.hazards[1].reviewedAt = "2026-02-30";
    changed.hazards[2].reviewExpiresAt = shiftIsoDate(changed.hazards[2].reviewedAt, -1);
    changed.hazards[3].controlPaths = [];
    changed.driftExceptions = [
      {
        path: UNRELATED,
        reason: "fixture",
        recordedBy: "fixture",
        recordedOn: shiftIsoDate(REGISTER_AS_OF, 1),
        expiresOn: shiftIsoDate(REGISTER_AS_OF, 100),
      },
    ];
    const { errors } = evaluateClinicalHazardControls(changed, {
      checkGit: false,
      now: REGISTER_NOW,
      reviewDateScope: prScope([UNRELATED]),
    });
    const [h1, h2, h3, h4] = changed.hazards.map((hazard: { id: string }) => hazard.id);
    expect(errors).toContain(`${h1}: reviewedAt is in the future`);
    expect(errors).toContain(`${h2}: review dates must be ISO dates`);
    expect(errors).toContain(`${h3}: reviewExpiresAt precedes reviewedAt`);
    expect(errors).toContain(`${h4}: partial state requires controlSymbols, controlPaths, and tests`);
    expect(errors).toContain(`driftExceptions[0] (${UNRELATED}): recordedOn is in the future`);
    expect(errors).toContain(`driftExceptions[0] (${UNRELATED}): an exception may run at most 45 days from recordedOn`);
  });

  describe("the command-line check", () => {
    function run(env: Record<string, string>, now: Date, args: string[] = []) {
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const key of [
        "REVIEW_DATE_MODE",
        "BASE_SHA",
        "HEAD_SHA",
        "GITHUB_EVENT_NAME",
        "GITHUB_REF",
        "GITHUB_ACTIONS",
      ]) {
        delete childEnv[key];
      }
      return spawnSync(
        process.execPath,
        ["--import", fixedClockImport(now), "scripts/check-clinical-hazard-controls.mjs", ...args],
        { encoding: "utf8", env: { ...childEnv, ...env } },
      );
    }
    const PR_ENV = { REVIEW_DATE_MODE: "pr", BASE_SHA: "HEAD", HEAD_SHA: "HEAD", GITHUB_EVENT_NAME: "pull_request" };

    // The CLI proves reviewedCommit ancestry itself, so it needs a checkout that holds that history.
    it.skipIf(!checkGit)("passes the committed register as of its own date, in either mode", () => {
      expect(run({}, REGISTER_NOW).stdout).toContain("review-dates=strict expired-not-blocking=0");
      expect(run(PR_ENV, REGISTER_NOW).stdout).toContain("review-dates=pr touched=0 expired-not-blocking=0");
    });

    it.skipIf(!checkGit)("fails a lapsed register when strict and only warns in pull-request mode", () => {
      const strictRun = run({}, AFTER_EVERY_EXPIRY);
      expect(strictRun.status).toBe(1);
      expect(strictRun.stderr).toContain("CLINICAL_HAZARD_CONTROLS_FAIL review-dates=strict");
      expect(strictRun.stderr).toContain("- manifest: review has expired\n");

      const prRun = run(PR_ENV, AFTER_EVERY_EXPIRY);
      expect(prRun.status).toBe(0);
      expect(prRun.stdout).toContain(`review-dates=pr touched=0 expired-not-blocking=${lapsedCount}`);
      expect(prRun.stderr).toContain("CLINICAL_HAZARD_CONTROLS_REVIEW_DATE_WARNING: manifest: review has expired.");
    });

    it.skipIf(!checkGit)("ignores pull-request mode under --release, as governance:release runs it", () => {
      const releaseRun = run(PR_ENV, AFTER_EVERY_EXPIRY, ["--release"]);
      expect(releaseRun.status).toBe(1);
      expect(releaseRun.stderr).toContain("CLINICAL_HAZARD_CONTROLS_FAIL review-dates=strict");
      expect(releaseRun.stderr).toContain("- manifest: review has expired\n");
      // No refusal note either: release never asks the environment in the first place.
      expect(releaseRun.stderr).not.toContain("CLINICAL_HAZARD_CONTROLS_REVIEW_DATE_MODE");
      const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      expect(packageJson.scripts["governance:release"]).toContain(
        "npm run check:clinical-hazard-controls -- --release",
      );
    });

    it.skipIf(!checkGit)("ignores explicit development scope under --release at the CLI boundary", () => {
      const result = run({}, AFTER_EVERY_EXPIRY, ["--development", "--base", manifest.reviewedCommit, "--release"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("CLINICAL_HAZARD_CONTROLS_FAIL review-dates=strict");
      expect(result.stderr).toContain("- manifest: review has expired\n");
      expect(result.stderr).not.toContain("REVIEW_DATE_WARNING");
    });

    it.skipIf(!checkGit)("refuses pull-request mode on a non-main push, or without a base, and stays strict", () => {
      for (const env of [
        { ...PR_ENV, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/topic" },
        { ...PR_ENV, GITHUB_EVENT_NAME: "" },
        { ...PR_ENV, BASE_SHA: "" },
        { ...PR_ENV, BASE_SHA: "0".repeat(40) },
        { ...PR_ENV, BASE_SHA: "--output=/dev/null" },
        { ...PR_ENV, REVIEW_DATE_MODE: "PR" },
      ]) {
        const refused = run(env, AFTER_EVERY_EXPIRY);
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain("CLINICAL_HAZARD_CONTROLS_REVIEW_DATE_MODE: REVIEW_DATE_MODE=");
        expect(refused.stderr).toContain("- manifest: review has expired\n");
      }
    });
  });
});
