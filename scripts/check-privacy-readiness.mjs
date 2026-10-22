#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appliedRecordName, findAppliedRecord } from "./lib/inbox-archive.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { decideReviewedCommitHistoryFromFacts } from "./lib/reviewed-commit-history-decision.mjs";
import {
  describeReviewDateScope,
  printReviewDateWarnings,
  referencePath,
  registerTopLevel,
  reportExpiredReviewDate,
  resolveGovernanceReviewDateScope,
} from "./organisation/review-date-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PRIVACY_REGISTER_PATH = "docs/governance/privacy-readiness.v1.json";
const manifestPath = resolve(root, PRIVACY_REGISTER_PATH);
const requiredIds = [
  "PRIV-CODE-QUERY-HASH",
  "PRIV-CODE-DURABLE-ANSWER-MINIMISATION",
  "PRIV-CODE-RAW-QUERY-PERSISTENCE",
  "PRIV-PROVIDER-PRODUCTION-HMAC-SECRET",
  "PRIV-PROVIDER-RETENTION-SCHEDULE-PARITY",
  "PRIV-PROVIDER-OPENAI-ZDR",
  "PRIV-LEGAL-OPENAI-DPA",
  "PRIV-LEGAL-RAILWAY-DPA",
  "PRIV-LEGAL-APP8-CROSS-BORDER-BASIS",
  "PRIV-LEGAL-APP1-APP5-NOTICE",
  "PRIV-CLINICAL-PHI-MINIMISATION",
];
const classes = new Set(["code", "provider", "legal", "clinical"]);
const offlineGitEnv = { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
const statuses = new Set(["pending", "partial", "verified", "accepted_decision"]);
const transitions = {
  pending: new Set(["pending", "partial", "verified", "accepted_decision"]),
  partial: new Set(["pending", "partial", "verified", "accepted_decision"]),
  verified: new Set(["pending", "partial", "verified"]),
  accepted_decision: new Set(["accepted_decision"]),
};
const acceptedDecisionRoles = {
  provider: new Set(["Production platform owner", "Privacy engineering owner"]),
  legal: new Set(["Authorised legal signatory", "Privacy adviser"]),
  clinical: new Set(["Clinical safety owner", "Clinical governance authority"]),
};

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

function repositoryPath(reference) {
  if (typeof reference !== "string") return null;
  const file = reference.split("#", 1)[0];
  if (!file || file.includes("\\") || isAbsolute(file)) return null;
  const absolute = resolve(root, file);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
  return { file, absolute };
}

function commitExists(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: root,
      env: offlineGitEnv,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function isShallowClone() {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: root,
        env: offlineGitEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true"
    );
  } catch {
    return false;
  }
}

function commitIsAncestor(commit) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd: root,
      env: offlineGitEnv,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function hasReadableTree(commit) {
  try {
    // The evidence paths are nested, so a root-tree listing is insufficient: a filtered clone
    // can hold the root while a nested tree needed by pathExistsAtCommit is unavailable.
    execFileSync("git", ["ls-tree", "-r", "--name-only", `${commit}^{tree}`], {
      cwd: root,
      env: offlineGitEnv,
      stdio: "ignore",
    });
    return true;
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
        env: offlineGitEnv,
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
 * The repository paths one requirement's review vouches for: its evidence and decision record.
 * An expired review of this requirement blocks a pull request that touches any of them.
 *
 * @param {any} item
 * @returns {string[]}
 */
export function privacyRequirementCoveredPaths(item) {
  const references = [
    ...(Array.isArray(item?.evidenceReferences) ? item.evidenceReferences : []),
    item?.decisionReference,
  ];
  return [...new Set(references.map(referencePath).filter((file) => typeof file === "string"))].sort();
}

/**
 * Everything the register as a whole covers: the scope of its manifest-level review.
 *
 * @param {any} manifest
 * @returns {string[]}
 */
export function privacyRegisterCoveredPaths(manifest) {
  const requirements = Array.isArray(manifest?.requirements) ? manifest.requirements : [];
  return [...new Set(requirements.flatMap(privacyRequirementCoveredPaths))].sort();
}

/**
 * Validate the register and return the blocking errors. Findings that pull-request mode demotes
 * (an expired review on a change that touches neither this register nor a covered path) are
 * printed as warnings, never dropped; use evaluatePrivacyReadiness to receive them instead.
 *
 * @param {any} manifest
 * @param {{ release?: boolean, checkFiles?: boolean, checkGit?: boolean, now?: Date | string | number,
 *   reviewDateScope?: import("./organisation/review-date-scope.mjs").ReviewDateScope | null }} [options]
 * @returns {string[]}
 */
export function validatePrivacyReadiness(manifest, options = {}) {
  const { errors, warnings } = evaluatePrivacyReadiness(manifest, options);
  for (const warning of warnings) console.warn(`PRIVACY_READINESS_REVIEW_DATE_WARNING: ${warning}`);
  return errors;
}

/**
 * The same validation, returning blocking `errors` and non-blocking `warnings` separately.
 * `reviewDateScope` defaults to strict, and release mode is always strict whatever scope is
 * passed: a release must never ship on a lapsed privacy review (organisation framework
 * suggestion 6, owner decision 2026-09-26).
 *
 * @param {any} manifest
 * @param {{ release?: boolean, checkFiles?: boolean, checkGit?: boolean, now?: Date | string | number,
 *   reviewDateScope?: import("./organisation/review-date-scope.mjs").ReviewDateScope | null }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function evaluatePrivacyReadiness(
  manifest,
  { release = false, checkFiles = true, checkGit = checkFiles, now = new Date(), reviewDateScope = null } = {},
) {
  const errors = [];
  const warnings = [];
  const findings = {
    errors,
    warnings,
    scope: release ? null : reviewDateScope,
    registerPath: PRIVACY_REGISTER_PATH,
  };
  const today = todayIso(now);
  if (manifest?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  const reviewedCommit = manifest?.reviewedCommit ?? "";
  let reviewedCommitExists = false;
  if (!/^[0-9a-f]{40}$/.test(reviewedCommit)) errors.push("reviewedCommit must be a full commit SHA");
  else if (checkGit && !commitExists(reviewedCommit)) errors.push(`reviewedCommit does not exist: ${reviewedCommit}`);
  else {
    reviewedCommitExists = true;
    if (checkGit && !commitIsAncestor(reviewedCommit))
      errors.push(`reviewedCommit is not an ancestor of HEAD: ${reviewedCommit}`);
  }
  if (!validDate(manifest?.reviewedAt) || !validDate(manifest?.reviewExpiresAt))
    errors.push("manifest review dates must be ISO dates");
  if (
    validDate(manifest?.reviewedAt) &&
    validDate(manifest?.reviewExpiresAt) &&
    manifest.reviewExpiresAt < manifest.reviewedAt
  ) {
    errors.push("manifest reviewExpiresAt precedes reviewedAt");
  }
  if (validDate(manifest?.reviewedAt) && manifest.reviewedAt > today)
    errors.push("manifest reviewedAt is in the future");
  if (validDate(manifest?.reviewExpiresAt) && manifest.reviewExpiresAt < today)
    reportExpiredReviewDate(
      findings,
      "manifest review has expired",
      privacyRegisterCoveredPaths(manifest),
      registerTopLevel,
    );
  if (!Array.isArray(manifest?.requirements)) errors.push("requirements must be an array");
  const requirements = Array.isArray(manifest?.requirements) ? manifest.requirements : [];
  const ids = new Set();
  for (const item of requirements) {
    const label = item?.id ?? "<missing-id>";
    if (!/^[A-Z0-9-]+$/.test(label)) errors.push(`${label}: invalid id`);
    if (ids.has(label)) errors.push(`${label}: duplicate id`);
    ids.add(label);
    if (!classes.has(item.evidenceClass)) errors.push(`${label}: invalid evidenceClass`);
    if (!statuses.has(item.status)) errors.push(`${label}: invalid status`);
    if (typeof item.accountableRole !== "string" || !item.accountableRole.trim())
      errors.push(`${label}: accountableRole is required`);
    if (!validDate(item.reviewedAt) || !validDate(item.reviewExpiresAt))
      errors.push(`${label}: review dates must be ISO dates`);
    if (validDate(item.reviewedAt) && validDate(item.reviewExpiresAt) && item.reviewExpiresAt < item.reviewedAt) {
      errors.push(`${label}: reviewExpiresAt precedes reviewedAt`);
    }
    if (validDate(item.reviewedAt) && item.reviewedAt > today) errors.push(`${label}: reviewedAt is in the future`);
    if (validDate(item.reviewExpiresAt) && item.reviewExpiresAt < today) {
      reportExpiredReviewDate(
        findings,
        `${label}: review has expired`,
        privacyRequirementCoveredPaths(item),
        (register) => register?.requirements?.find?.((entry) => entry?.id === item?.id),
      );
    }
    if (!Array.isArray(item.evidenceReferences) || item.evidenceReferences.length === 0) {
      errors.push(`${label}: evidenceReferences must be non-empty`);
    } else if (checkFiles) {
      for (const reference of item.evidenceReferences) {
        const resolved = repositoryPath(reference);
        // An applied inbox request cited here may since have been archived, unchanged, into a
        // quarter folder; it is still the same evidence.
        const archived =
          resolved && !existsSync(resolved.absolute) && appliedRecordName(resolved.file)
            ? findAppliedRecord(root, appliedRecordName(resolved.file))
            : null;
        if (!resolved || (!existsSync(resolved.absolute) && !archived)) {
          errors.push(`${label}: missing evidence ${reference}`);
        } else if (
          checkGit &&
          reviewedCommitExists &&
          !pathExistsAtCommit(reviewedCommit, resolved.file) &&
          !(archived && pathExistsAtCommit(reviewedCommit, archived))
        ) {
          errors.push(`${label}: evidence is absent from reviewedCommit ${reference}`);
        }
      }
    }
    if (!Array.isArray(item.statusHistory) || item.statusHistory.length === 0) {
      errors.push(`${label}: statusHistory must be non-empty`);
    } else {
      let previous;
      let previousDate;
      for (const event of item.statusHistory) {
        if (!statuses.has(event.status) || !validDate(event.date)) errors.push(`${label}: invalid statusHistory entry`);
        if (previous && !transitions[previous]?.has(event.status))
          errors.push(`${label}: transition ${previous} -> ${event.status} is not allowed`);
        if (previousDate && event.date < previousDate) errors.push(`${label}: statusHistory dates are not ordered`);
        previous = event.status;
        previousDate = event.date;
      }
      if (previous !== item.status) errors.push(`${label}: current status does not match statusHistory`);
    }
    if (item.status === "verified" && item.evidenceClass !== "code") {
      if (typeof item.externalEvidenceReference !== "string" || !item.externalEvidenceReference.trim()) {
        errors.push(`${label}: verified external evidence requires externalEvidenceReference`);
      }
      if (typeof item.verifiedByRole !== "string" || !item.verifiedByRole.trim()) {
        errors.push(`${label}: verified external evidence requires verifiedByRole`);
      }
    }
    if (item.status === "accepted_decision") {
      const allowedRoles = acceptedDecisionRoles[item.evidenceClass];
      if (!allowedRoles) errors.push(`${label}: ${item.evidenceClass} evidence cannot use accepted_decision`);
      if (!item.decisionReference || !item.acceptedByRole) {
        errors.push(`${label}: accepted_decision requires decisionReference and acceptedByRole`);
      } else {
        if (!allowedRoles?.has(item.acceptedByRole)) {
          errors.push(`${label}: acceptedByRole is not authorised for ${item.evidenceClass} evidence`);
        }
        const decision = repositoryPath(item.decisionReference);
        if (
          !decision ||
          !decision.file.startsWith("docs/governance/") ||
          (checkFiles && !existsSync(decision.absolute))
        ) {
          errors.push(`${label}: decisionReference must be an existing docs/governance record`);
        }
      }
    }
    if (release && !["verified", "accepted_decision"].includes(item.status))
      errors.push(`${label}: release-blocking status ${item.status}`);
  }
  for (const id of requiredIds) if (!ids.has(id)) errors.push(`missing required id ${id}`);
  return { errors, warnings };
}

/**
 * Whether the reviewedCommit checks can be skipped for this run.
 *
 * Policy lives in `decideReviewedCommitHistoryFromFacts` (shared with the unit-test
 * helper). This wrapper only adds release-mode fail-close: structural may skip when
 * history is unanswerable; release never skips — `check:privacy-readiness:release`
 * and `governance:release` bind the register to the repository, and dropping those
 * checks on a truncated checkout would let a release print PRIVACY_READINESS_PASS
 * having proved nothing about the reviewed commit.
 */
export function shallowSkipDecision({ release, shallow, commitPresent, ancestor, treeReadable }) {
  const { checkGit } = decideReviewedCommitHistoryFromFacts({
    shallow,
    commitPresent,
    ancestor,
    treeReadable,
  });
  if (checkGit) return { skip: false, blocked: false };
  if (release) return { skip: false, blocked: true };
  return { skip: true, blocked: false };
}

function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const release = process.argv.includes("--release");
  // Same reasoning as check-clinical-hazard-controls.mjs: on a depth-one clone
  // the reviewedCommit checks report a real commit as missing, which reads as a
  // corrupt register rather than a truncated checkout. Say what was skipped.
  // CI's static-pr job checks out with fetch-depth 0, where the checks do run.
  const { skip, blocked } = shallowSkipDecision({
    release,
    shallow: isShallowClone(),
    commitPresent: commitExists(manifest?.reviewedCommit ?? ""),
    ancestor: commitIsAncestor(manifest?.reviewedCommit ?? ""),
    treeReadable: hasReadableTree(manifest?.reviewedCommit ?? ""),
  });
  if (blocked) {
    console.error("PRIVACY_READINESS_FAIL mode=release");
    console.error(
      `- reviewedCommit ${manifest?.reviewedCommit ?? "(unset)"} cannot be read from this checkout, and ` +
        "release mode will not skip the ancestry and evidence-at-commit checks that bind this register to the " +
        "repository. Re-run on a full-history, unfiltered checkout: git fetch --unshallow (or git fetch --deepen=2000).",
    );
    process.exit(1);
  }
  if (skip) {
    console.warn(
      "PRIVACY_READINESS_HISTORY_UNAVAILABLE: this checkout cannot read the reviewedCommit ancestry and full " +
        "tree, so the reviewedCommit existence/ancestry and evidence-at-commit checks were skipped. Run on a " +
        "full-history, unfiltered checkout (git fetch --unshallow) to prove them; every other check below still " +
        "ran. Release mode does not skip them.",
    );
  }
  // Explicit development scope includes working inputs. Otherwise retain the existing CI scope
  // or strict local default; --release always ignores either non-release scope.
  const reviewDateScope = resolveGovernanceReviewDateScope({ argv: process.argv.slice(2), root });
  const { errors, warnings } = evaluatePrivacyReadiness(manifest, { release, checkGit: !skip, reviewDateScope });
  printReviewDateWarnings("PRIVACY_READINESS", reviewDateScope, warnings);
  const scopeLabel = describeReviewDateScope(reviewDateScope);
  if (!release) {
    for (const item of Array.isArray(manifest.requirements) ? manifest.requirements : []) {
      if (["pending", "partial"].includes(item.status))
        console.warn(
          `PRIVACY_READINESS_RELEASE_BLOCKER: ${item.id} status=${item.status} owner=${item.accountableRole}`,
        );
    }
  }
  if (errors.length) {
    console.error(`PRIVACY_READINESS_FAIL mode=${release ? "release" : "structural"} ${scopeLabel}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `PRIVACY_READINESS_PASS mode=${release ? "release" : "structural"} requirements=${manifest.requirements.length} history=${skip ? "skipped" : "checked"} ${scopeLabel} expired-not-blocking=${warnings.length}`,
  );
}

if (isDirectEntrypoint(import.meta.url)) main();
