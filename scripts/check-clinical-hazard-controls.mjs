#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import {
  describeReviewDateScope,
  printReviewDateWarnings,
  referencePath,
  registerTopLevel,
  reportExpiredReviewDate,
  resolveReviewDateScope,
} from "./organisation/review-date-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const HAZARD_REGISTER_PATH = "docs/clinical-hazard-controls.json";
const manifestPath = resolve(root, HAZARD_REGISTER_PATH);
const states = new Set(["controlled", "partial", "open", "accepted_decision"]);
const requiredHazards = ["H1", "H2", "H3", "H4", "H5", "H6"];
const requiredDecisions = ["CLINICAL-TRUTH-AUTHORITY", "EXTERNAL-RISK-ACCEPTANCE"];

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayIso(now) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Perth",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safeDate);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function repositoryPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || isAbsolute(value)) return null;
  const absolute = resolve(root, value);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
  return { file: value, absolute };
}

function gitCheck(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * A word-bounded match for a control symbol inside source text. The escape class is the
 * repository's standard one (see scripts/pr-policy.mjs); the earlier `[...[\\]\\]` form
 * parsed as a class followed by a literal `\]`, so no metacharacter was ever escaped and a
 * dotted symbol matched as a wildcard (audit L22).
 */
function symbolPattern(symbol) {
  return new RegExp(`\\b${String(symbol).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

/**
 * Whether a listed test actually exercises the control it is cited for: it names a
 * control symbol, or imports a control path module (alias `@/lib/x`, relative
 * `../src/lib/x`, or the bare repository path). Existence alone proved nothing (M33).
 */
function testReferencesControl(testSource, hazard) {
  if ((hazard.controlSymbols ?? []).some((symbol) => symbolPattern(symbol).test(testSource))) return true;
  return (hazard.controlPaths ?? []).some((controlPath) => {
    const modulePath = String(controlPath).replace(/\.(?:ts|tsx|mjs|js)$/, "");
    const withoutSrc = modulePath.replace(/^src\//, "");
    return [`@/${withoutSrc}`, `/src/${withoutSrc}`, modulePath].some((specifier) => testSource.includes(specifier));
  });
}

function isShallowClone() {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true"
    );
  } catch {
    return false;
  }
}

const commitTreeCache = new Map();

function pathExistsAtCommit(commit, file) {
  try {
    if (!commitTreeCache.has(commit)) {
      const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", commit], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      commitTreeCache.set(commit, new Set(paths.split(/\r?\n/).filter(Boolean)));
    }
    return commitTreeCache.get(commit).has(file);
  } catch {
    commitTreeCache.set(commit, new Set());
    return false;
  }
}

/**
 * WHY A CONTENT DIGEST SITS BESIDE THE REVIEWED COMMIT.
 *
 * 🔴 **THE FAILURE THIS EXISTS FOR, MEASURED 2026-09-18 (#D7K71C).** An author updating this
 * register cannot know the SHA their work will land as: this repository squash-merges, so that
 * commit does not exist until after the merge. PR #2882 therefore recorded its own pre-squash
 * branch head in all twelve entries. The squash orphaned that object, and from the moment it
 * landed the ancestry check failed on `main` and on every branch that merged `main` — taking the
 * aggregate required check red and blocking five unrelated pull requests. It cost most of a
 * working day across three sessions and was repaired by hand, which leaves the trap armed for
 * the next register update.
 *
 * Reachability was only ever a proxy. What the register claims is that a human reviewed *this
 * content*, so the content is what we pin. While the reviewed commit is reachable nothing
 * changes and the snapshot checks run exactly as before. When it is not — the squash case — the
 * digests answer the same question directly, and a mismatch is still RED.
 *
 * ⚠️ **THIS IS NOT A WEAKENING.** The commit check asks only whether a cited path *existed* at
 * the reviewed commit. A digest additionally proves the file has not changed since review, so an
 * edited control that would previously have passed now fails. The fallback is refused outright
 * when digests are absent or incomplete, so an unreachable commit with no digests stays RED.
 *
 * Regenerate with `npm run governance:seal-hazard-controls` after a reviewed change.
 */
export function reviewedContentDigest(contents) {
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

function stringsOf(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * The repository paths one hazard or assurance decision covers: what its review vouches for. An
 * expired review of this entry blocks a pull request that touches any of them (or the register).
 *
 * @param {any} entry
 * @returns {string[]}
 */
export function hazardEntryCoveredPaths(entry) {
  const paths = [
    ...stringsOf(entry?.controlPaths),
    ...stringsOf(entry?.tests),
    ...stringsOf(entry?.evidenceReferences),
    ...stringsOf([entry?.acceptanceReference]),
  ];
  return [...new Set(paths.map(referencePath).filter(Boolean))].sort();
}

/**
 * Everything the register as a whole covers: the scope of its manifest-level review.
 *
 * @param {any} manifest
 * @returns {string[]}
 */
export function hazardRegisterCoveredPaths(manifest) {
  const entries = [
    ...(Array.isArray(manifest?.hazards) ? manifest.hazards : []),
    ...(Array.isArray(manifest?.assuranceDecisions) ? manifest.assuranceDecisions : []),
  ];
  return [...new Set(entries.flatMap(hazardEntryCoveredPaths))].sort();
}

/** Every path any entry cites, which is exactly what the digest map must cover. */
export function citedRegisterPaths(manifest) {
  const paths = new Set();
  for (const hazard of manifest?.hazards ?? []) {
    for (const value of [...(hazard.controlPaths ?? []), ...(hazard.tests ?? [])]) paths.add(value);
  }
  for (const decision of manifest?.assuranceDecisions ?? []) {
    for (const value of decision.evidenceReferences ?? []) paths.add(value);
  }
  return [...paths].sort();
}

/**
 * Can the reviewed content be proven without the commit? Only when every cited path carries a
 * digest and every digest still matches. Anything less and the caller keeps the hard failure.
 */
export function reviewedDigestsProveContent(manifest) {
  const digests = manifest?.reviewedPathDigests;
  if (!digests || typeof digests !== "object") {
    return { proven: false, drifted: [], reason: "no reviewedPathDigests are recorded" };
  }
  const missing = [];
  const drifted = [];
  for (const file of citedRegisterPaths(manifest)) {
    const recorded = digests[file];
    const resolved = repositoryPath(file);
    if (typeof recorded !== "string" || !resolved || !existsSync(resolved.absolute)) {
      missing.push(file);
      continue;
    }
    if (reviewedContentDigest(readFileSync(resolved.absolute, "utf8")) !== recorded) drifted.push(file);
  }
  if (missing.length) {
    return { proven: false, drifted, reason: `no recorded digest for ${missing.join(", ")}` };
  }
  // Proof of the reviewed CONTENT is separate from drift. Drift is judged by
  // validateDriftExceptions, which fails it unless a reviewed, expiring exception covers it.
  return { proven: true, drifted, reason: null };
}

const commitStatusCache = new Map();

function commitStatus(commit) {
  if (!commitStatusCache.has(commit)) {
    const exists = gitCheck(["cat-file", "-e", `${commit}^{commit}`]);
    commitStatusCache.set(commit, {
      exists,
      ancestor: exists && gitCheck(["merge-base", "--is-ancestor", commit, "HEAD"]),
    });
  }
  return commitStatusCache.get(commit);
}

/** Reachable means the reviewed snapshot can still be read, which is what the checks consume. */
function commitIsReachable(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) return false;
  const status = commitStatus(commit);
  return status.exists && status.ancestor;
}

function validateCommit(errors, commit, label, checkGit, contentProven = false) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
    errors.push(`${label}: reviewedCommit must be a full commit SHA`);
    return false;
  }
  if (checkGit) {
    const status = commitStatus(commit);
    // An unreachable reviewed commit is the squash-merge artefact described above, not a register
    // defect — but only where the recorded digests still prove the reviewed content. Where they
    // do not, the original hard failure stands, and its message names which proof was missing.
    if (!status.exists || !status.ancestor) {
      if (contentProven) return false;
      const detail = status.exists ? `is not an ancestor of HEAD ${commit}` : `does not exist ${commit}`;
      errors.push(`${label}: reviewedCommit ${detail}`);
      return false;
    }
  }
  return true;
}

const DRIFT_EXCEPTION_MAX_DAYS = 45;

/**
 * Drift in a reviewed control FAILS unless a named, dated, expiring exception covers that path
 * (audit F13, 2026-09-25). It used to only warn: fourteen safety-behaviour changes then landed in
 * src/lib/clinical-safety.ts and its neighbours after the 2026-08-23 review, and nobody re-reviewed
 * them. The original worry about a blocking gate still holds, that it would push people to re-seal
 * reflexively, so there is a second route: record an exception with a reason, an author and an
 * expiry at most 45 days out. An intended change can land. An unreviewed one cannot linger unseen.
 *
 * An EXPIRED exception is the one date finding that pull-request mode can demote (see
 * scripts/organisation/review-date-scope.mjs): on a pull request that touches neither this register
 * nor the exception's own path it is a warning, and the exception keeps covering its path for that
 * run, because the drift it records is already on main and is not this change's doing. On a pull
 * request that touches either, and in every strict run, it blocks and stops covering the path, so
 * the drift fails too, exactly as before. The 45-day cap and a future recordedOn always block.
 */
function validateDriftExceptions(findings, manifest, drifted, today) {
  const { errors } = findings;
  const exceptions = Array.isArray(manifest?.driftExceptions) ? manifest.driftExceptions : [];
  const covered = new Set();
  const seenPaths = new Set();
  exceptions.forEach((exception, index) => {
    const path = typeof exception?.path === "string" ? exception.path.trim() : "";
    const label = `driftExceptions[${index}]${path ? ` (${path})` : ""}`;
    // One exception per path: the review-date scope finds an exception by its path, so a second
    // entry for the same path could hide an edit to it.
    if (path && seenPaths.has(path)) errors.push(`${label}: duplicate drift exception path`);
    if (path) seenPaths.add(path);
    if (!path) {
      errors.push(`${label}: path is required`);
      return;
    }
    for (const field of ["reason", "recordedBy"]) {
      if (typeof exception[field] !== "string" || !exception[field].trim())
        errors.push(`${label}: ${field} is required`);
    }
    if (!validDate(exception.recordedOn) || !validDate(exception.expiresOn)) {
      errors.push(`${label}: recordedOn and expiresOn must be ISO dates`);
      return;
    }
    const days = (Date.parse(exception.expiresOn) - Date.parse(exception.recordedOn)) / 86_400_000;
    if (days < 0 || days > DRIFT_EXCEPTION_MAX_DAYS) {
      errors.push(`${label}: an exception may run at most ${DRIFT_EXCEPTION_MAX_DAYS} days from recordedOn`);
    }
    if (exception.recordedOn > today) errors.push(`${label}: recordedOn is in the future`);
    if (exception.expiresOn < today) {
      const blocking = reportExpiredReviewDate(
        findings,
        `${label}: drift exception has expired on ${exception.expiresOn}. Re-review the change and run ` +
          "npm run governance:seal-hazard-controls.",
        [path],
        (register) => register?.driftExceptions?.find?.((entry) => entry?.path?.trim?.() === path),
      );
      if (blocking) return;
    }
    covered.add(path);
  });
  const uncovered = drifted.filter((file) => !covered.has(file));
  if (uncovered.length) {
    errors.push(
      `CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT: these reviewed paths have changed since they were sealed ` +
        `and no current drift exception covers them: ${uncovered.join(", ")}. Re-review the change, then run ` +
        "npm run governance:seal-hazard-controls; or, for an intended change still under review, add a " +
        "driftExceptions entry (path, reason, recordedBy, recordedOn, expiresOn at most 45 days later).",
    );
  }
  const stale = exceptions
    .map((exception) => (typeof exception?.path === "string" ? exception.path.trim() : ""))
    .filter((path) => path && !drifted.includes(path));
  if (stale.length) {
    console.warn(
      `CLINICAL_HAZARD_CONTROLS_STALE_EXCEPTION: these drift exceptions cover paths that no longer drift and ` +
        `can be removed: ${stale.join(", ")}.`,
    );
  }
  if (drifted.length && !uncovered.length) {
    console.warn(
      `CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT_EXCEPTED: ${drifted.join(", ")} changed since sealing and are ` +
        "covered by drift exceptions until they expire.",
    );
  }
}

function validateReviewDates(findings, reviewedAt, reviewExpiresAt, label, today, coveredPaths, select) {
  const { errors } = findings;
  if (!validDate(reviewedAt) || !validDate(reviewExpiresAt)) {
    errors.push(`${label}: review dates must be ISO dates`);
    return;
  }
  if (reviewExpiresAt < reviewedAt) errors.push(`${label}: reviewExpiresAt precedes reviewedAt`);
  if (reviewedAt > today) errors.push(`${label}: reviewedAt is in the future`);
  if (reviewExpiresAt < today) reportExpiredReviewDate(findings, `${label}: review has expired`, coveredPaths, select);
}

function validatePath(errors, value, label, reviewedCommit, { checkFiles, checkGit }) {
  const resolved = repositoryPath(value);
  if (!resolved || (checkFiles && !existsSync(resolved.absolute))) {
    errors.push(`${label}: missing path ${value}`);
    return null;
  }
  if (checkGit && !pathExistsAtCommit(reviewedCommit, resolved.file)) {
    errors.push(`${label}: path is absent from reviewedCommit ${value}`);
  }
  return resolved;
}

/**
 * Validate the register and return the blocking errors. Findings that pull-request mode demotes
 * (an expired review date on a change that touches neither this register nor a covered path) are
 * printed as warnings, never dropped; use evaluateClinicalHazardControls to receive them instead.
 *
 * @param {any} manifest
 * @param {{ checkFiles?: boolean, checkGit?: boolean, now?: Date | string | number,
 *   reviewDateScope?: import("./organisation/review-date-scope.mjs").ReviewDateScope | null }} [options]
 * @returns {string[]}
 */
export function validateClinicalHazardControls(manifest, options = {}) {
  const { errors, warnings } = evaluateClinicalHazardControls(manifest, options);
  for (const warning of warnings) console.warn(`CLINICAL_HAZARD_CONTROLS_REVIEW_DATE_WARNING: ${warning}`);
  return errors;
}

/**
 * The same validation, returning blocking `errors` and non-blocking `warnings` separately.
 * `reviewDateScope` defaults to strict: every expired date blocks, as it always has.
 *
 * @param {any} manifest
 * @param {{ checkFiles?: boolean, checkGit?: boolean, now?: Date | string | number,
 *   reviewDateScope?: import("./organisation/review-date-scope.mjs").ReviewDateScope | null }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function evaluateClinicalHazardControls(
  manifest,
  { checkFiles = true, checkGit = checkFiles, now = new Date(), reviewDateScope = null } = {},
) {
  const errors = [];
  const warnings = [];
  const findings = { errors, warnings, scope: reviewDateScope, registerPath: HAZARD_REGISTER_PATH };
  const today = todayIso(now);
  if (manifest?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  // Decide once, not per entry: every entry is required to pin the manifest's commit, so
  // reachability and the digest fallback are one question asked eleven times.
  const contentProof = checkFiles
    ? reviewedDigestsProveContent(manifest)
    : { proven: false, drifted: [], reason: "digests were not read because checkFiles is off" };
  const commitReachable = checkGit ? commitIsReachable(manifest?.reviewedCommit) : true;
  // Every entry pins the manifest's commit, so an unreachable one would otherwise report the same
  // finding eleven times. Say it once, with the remedy, and let the entries stand down.
  const contentProven = !commitReachable;
  if (!commitReachable && !contentProof.proven) {
    errors.push(
      `manifest: reviewedCommit ${manifest?.reviewedCommit} is unreachable from HEAD and the recorded ` +
        `digests do not prove the reviewed content (${contentProof.reason}). If the content is still the ` +
        "reviewed content, run npm run governance:seal-hazard-controls; if it changed, it needs re-review.",
    );
  }
  // The reviewed snapshot cannot be read once its commit is gone, so the path-at-commit checks
  // stand down with it. The digests replace them, and prove more: those files are unchanged.
  const snapshotCheckGit = checkGit && commitReachable;
  if (!commitReachable && contentProof.proven) {
    console.warn(
      `CLINICAL_HAZARD_CONTROLS_COMMIT_UNREACHABLE: reviewedCommit ${manifest?.reviewedCommit} is not ` +
        "reachable from HEAD (expected after a squash merge). Every cited path is recorded and present, " +
        "so the register's claims were checked against the recorded digests instead.",
    );
  }
  if (checkFiles) validateDriftExceptions(findings, manifest, contentProof.drifted, today);
  validateCommit(errors, manifest?.reviewedCommit, "manifest", checkGit, contentProven);
  validateReviewDates(
    findings,
    manifest?.reviewedAt,
    manifest?.reviewExpiresAt,
    "manifest",
    today,
    hazardRegisterCoveredPaths(manifest),
    registerTopLevel,
  );
  const hazards = Array.isArray(manifest?.hazards) ? manifest.hazards : [];
  const ids = new Set();
  for (const hazard of hazards) {
    const label = hazard?.id ?? "<missing-id>";
    if (ids.has(label)) errors.push(`${label}: duplicate id`);
    ids.add(label);
    if (!states.has(hazard.state)) errors.push(`${label}: invalid state`);
    if (!hazard.owner || !hazard.residualRisk) errors.push(`${label}: owner and residualRisk are required`);
    validateCommit(errors, hazard.reviewedCommit, label, checkGit, contentProven);
    if (hazard.reviewedCommit !== manifest.reviewedCommit) errors.push(`${label}: reviewedCommit must match manifest`);
    validateReviewDates(
      findings,
      hazard.reviewedAt,
      hazard.reviewExpiresAt,
      label,
      today,
      hazardEntryCoveredPaths(hazard),
      (register) => register?.hazards?.find?.((entry) => entry?.id === hazard?.id),
    );
    for (const field of ["controlSymbols", "controlPaths", "tests"]) {
      if (!Array.isArray(hazard[field]) || hazard[field].some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`${label}: ${field} must be an array of non-empty strings`);
      }
    }
    if (
      ["controlled", "partial"].includes(hazard.state) &&
      (!hazard.controlSymbols?.length || !hazard.controlPaths?.length || !hazard.tests?.length)
    ) {
      errors.push(`${label}: ${hazard.state} state requires controlSymbols, controlPaths, and tests`);
    }
    if (hazard.state === "accepted_decision" && (!hazard.acceptanceReference || !hazard.acceptedByRole)) {
      errors.push(`${label}: accepted_decision requires acceptanceReference and acceptedByRole`);
    } else if (hazard.state === "accepted_decision") {
      if (!new Set(["Clinical governance authority", "Authorised risk owner"]).has(hazard.acceptedByRole)) {
        errors.push(`${label}: acceptedByRole is not authorised for clinical risk acceptance`);
      }
      const acceptance = repositoryPath(hazard.acceptanceReference);
      if (
        !acceptance ||
        !acceptance.file.startsWith("docs/governance/") ||
        (checkFiles && !existsSync(acceptance.absolute))
      ) {
        errors.push(`${label}: acceptanceReference must be an existing docs/governance record`);
      }
    }
    if (checkFiles) {
      for (const path of [...(hazard.controlPaths ?? []), ...(hazard.tests ?? [])]) {
        validatePath(errors, path, label, hazard.reviewedCommit, { checkFiles, checkGit: snapshotCheckGit });
      }
      for (const testPath of hazard.tests ?? []) {
        if (!/^tests\/.+\.test\.(?:ts|tsx)$/.test(testPath)) errors.push(`${label}: invalid test path ${testPath}`);
      }
      const controlSource = (hazard.controlPaths ?? [])
        .map(repositoryPath)
        .filter((path) => path && existsSync(path.absolute))
        .map((path) => readFileSync(path.absolute, "utf8"))
        .join("\n");
      for (const symbol of hazard.controlSymbols ?? []) {
        if (!symbolPattern(symbol).test(controlSource)) {
          errors.push(`${label}: control symbol ${symbol} not found in controlPaths`);
        }
      }
      // A test that exists but never touches the control is not proof of it.
      const listedTests = (hazard.tests ?? []).map(repositoryPath).filter((path) => path && existsSync(path.absolute));
      if (
        ["controlled", "partial"].includes(hazard.state) &&
        listedTests.length > 0 &&
        !listedTests.some((path) => testReferencesControl(readFileSync(path.absolute, "utf8"), hazard))
      ) {
        errors.push(
          `${label}: no listed test references a control symbol or imports a control path (${listedTests
            .map((path) => path.file)
            .join(", ")})`,
        );
      }
    }
  }
  for (const id of requiredHazards) if (!ids.has(id)) errors.push(`missing required hazard ${id}`);
  const decisions = Array.isArray(manifest?.assuranceDecisions) ? manifest.assuranceDecisions : [];
  const decisionIds = new Set();
  for (const decision of decisions) {
    if (decisionIds.has(decision.id)) errors.push(`${decision.id}: duplicate assurance decision id`);
    decisionIds.add(decision.id);
    if (!states.has(decision.state) || !decision.owner || !decision.residualRisk)
      errors.push(`${decision.id}: invalid assurance decision`);
    validateCommit(errors, decision.reviewedCommit, decision.id, checkGit, contentProven);
    if (decision.reviewedCommit !== manifest.reviewedCommit)
      errors.push(`${decision.id}: reviewedCommit must match manifest`);
    validateReviewDates(
      findings,
      decision.reviewedAt,
      decision.reviewExpiresAt,
      decision.id,
      today,
      hazardEntryCoveredPaths(decision),
      (register) => register?.assuranceDecisions?.find?.((entry) => entry?.id === decision?.id),
    );
    if (!Array.isArray(decision.evidenceReferences) || decision.evidenceReferences.length === 0) {
      errors.push(`${decision.id}: evidenceReferences must be non-empty`);
    }
    if (checkFiles) {
      for (const path of decision.evidenceReferences ?? []) {
        validatePath(errors, path, decision.id, decision.reviewedCommit, { checkFiles, checkGit: snapshotCheckGit });
      }
    }
    if (decision.state === "accepted_decision") {
      if (!decision.acceptanceReference || !decision.acceptedByRole) {
        errors.push(`${decision.id}: accepted_decision requires acceptanceReference and acceptedByRole`);
      } else {
        const allowedRole =
          decision.id === "CLINICAL-TRUTH-AUTHORITY" ? "Clinical governance authority" : "Authorised risk owner";
        if (decision.acceptedByRole !== allowedRole)
          errors.push(`${decision.id}: acceptedByRole must be ${allowedRole}`);
        const acceptance = repositoryPath(decision.acceptanceReference);
        if (
          !acceptance ||
          !acceptance.file.startsWith("docs/governance/") ||
          (checkFiles && !existsSync(acceptance.absolute))
        ) {
          errors.push(`${decision.id}: acceptanceReference must be an existing docs/governance record`);
        }
      }
    }
  }
  for (const id of requiredDecisions)
    if (!decisionIds.has(id)) errors.push(`missing required assurance decision ${id}`);
  const clinicalTruth = decisions.find((item) => item.id === "CLINICAL-TRUTH-AUTHORITY");
  const riskAcceptance = decisions.find((item) => item.id === "EXTERNAL-RISK-ACCEPTANCE");
  if (clinicalTruth && !["open", "partial"].includes(clinicalTruth.state) && !clinicalTruth.externalEvidenceReference) {
    errors.push("clinical truth authority closure requires an external evidence reference");
  }
  if (
    riskAcceptance &&
    !["open", "partial"].includes(riskAcceptance.state) &&
    (!riskAcceptance.acceptanceReference || !riskAcceptance.acceptedByRole)
  ) {
    errors.push("external risk acceptance closure requires acceptanceReference and acceptedByRole");
  }
  return { errors, warnings };
}

/**
 * Record the digest of every cited path, so the register survives the squash merge that orphans
 * its reviewedCommit. Append-and-update only: this never edits a review date, a state or a
 * residual risk, because those are a human's words and not this script's to touch.
 */
export function sealReviewedPathDigests(manifest) {
  const digests = {};
  const unreadable = [];
  for (const file of citedRegisterPaths(manifest)) {
    const resolved = repositoryPath(file);
    if (!resolved || !existsSync(resolved.absolute)) {
      unreadable.push(file);
      continue;
    }
    digests[file] = reviewedContentDigest(readFileSync(resolved.absolute, "utf8"));
  }
  // Sealing records the current content as reviewed, so nothing drifts and every exception lapses.
  const sealed = { ...manifest, reviewedPathDigests: digests };
  delete sealed.driftExceptions;
  return { sealed, unreadable };
}

function seal() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { sealed, unreadable } = sealReviewedPathDigests(manifest);
  if (unreadable.length) {
    console.error("CLINICAL_HAZARD_CONTROLS_SEAL_FAIL: cited paths do not exist, so nothing was written");
    for (const file of unreadable) console.error(`- ${file}`);
    process.exit(1);
  }
  writeFileSync(manifestPath, `${JSON.stringify(sealed, null, 2)}\n`);
  // Formatting is not cosmetic here. Raw JSON.stringify expands every short array that Prettier
  // keeps on one line, so an unformatted seal turns a 29-line diff into a 127-line one and then
  // loses to the format gate on push. Run the repository formatter so sealing is idempotent.
  execFileSync(process.execPath, [resolve(root, "node_modules/prettier/bin/prettier.cjs"), "--write", manifestPath], {
    cwd: root,
    stdio: "ignore",
  });
  const count = Object.keys(sealed.reviewedPathDigests).length;
  console.log(`CLINICAL_HAZARD_CONTROLS_SEALED paths=${count} commit=${sealed.reviewedCommit}`);
}

function main() {
  if (process.argv.includes("--seal")) return seal();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // The reviewedCommit ancestry checks need history. On a depth-one clone they
  // would report every reviewed commit as missing — a checkout artefact, not a
  // register defect — so say exactly what was skipped instead of failing on it.
  // CI's static-pr job checks out with fetch-depth 0, where the checks do run.
  const shallow = isShallowClone();
  if (shallow) {
    console.warn(
      "CLINICAL_HAZARD_CONTROLS_SHALLOW_CLONE: this is a shallow git clone, so the reviewedCommit " +
        "existence/ancestry checks were skipped. Run on a full-history checkout (git fetch --unshallow) " +
        "to prove them; every file, symbol, test-reference and date check below still ran.",
    );
  }
  // Strict unless pull-request CI asks for pr mode explicitly (REVIEW_DATE_MODE=pr with BASE_SHA and
  // HEAD_SHA); see scripts/organisation/review-date-scope.mjs. Local runs, other branches and release stay strict.
  // --release pins strict whatever the environment says, as check-privacy-readiness does: a release
  // must never ship on a lapsed hazard review.
  const release = process.argv.includes("--release");
  const reviewDateScope = resolveReviewDateScope({ env: release ? {} : process.env, root });
  const { errors, warnings } = evaluateClinicalHazardControls(manifest, { checkGit: !shallow, reviewDateScope });
  printReviewDateWarnings("CLINICAL_HAZARD_CONTROLS", reviewDateScope, warnings);
  if (errors.length) {
    console.error(`CLINICAL_HAZARD_CONTROLS_FAIL ${describeReviewDateScope(reviewDateScope)}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `CLINICAL_HAZARD_CONTROLS_PASS hazards=${manifest.hazards.length} decisions=${manifest.assuranceDecisions.length} ` +
      `${describeReviewDateScope(reviewDateScope)} expired-not-blocking=${warnings.length}`,
  );
}

if (isDirectEntrypoint(import.meta.url)) main();
