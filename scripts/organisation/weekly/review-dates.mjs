#!/usr/bin/env node
// Weekly report section: governance review dates that have lapsed or fall due soon.
//
// Organisation framework suggestion 6, "defuse the date traps" (owner decision 2026-09-26). The
// clinical hazard register and the privacy-readiness register record review dates. On a pull
// request an expired date now only warns, unless the change edits that entry or touches a path the
// entry covers (scripts/organisation/review-date-scope.mjs), so this weekly section is where a
// lapse is raised instead: every entry that has lapsed or falls due within 14 days, and what
// re-reviewing it means. Report only: it never edits a register and never fails.
//
// Usage: node scripts/organisation/weekly/review-dates.mjs [--now YYYY-MM-DD]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "../../lib/is-entrypoint.mjs";

export const DUE_WITHIN_DAYS = 14;
const HAZARD_REGISTER = "docs/clinical-hazard-controls.json";
const PRIVACY_REGISTER = "docs/governance/privacy-readiness.v1.json";
const DAY_MS = 86_400_000;

const MEANING = {
  hazardReview:
    "Re-review means a clinician in the named role re-checks the entry's controls, tests and residual risk " +
    "against the current code, then records new `reviewedAt` and `reviewExpiresAt` dates in the register. If a " +
    "cited file changed since the register was sealed, that change is reviewed too and " +
    "`npm run governance:seal-hazard-controls` records the reviewed content.",
  driftException:
    "A drift exception excuses a change to a reviewed file for at most 45 days while it waits for clinical " +
    "review. Re-review means a clinician reviews what changed in that file since the register was sealed: if " +
    "it is acceptable, `npm run governance:seal-hazard-controls` records it and the exception goes; if not, the " +
    "change is reverted. Recording a new exception without that review is not a re-review.",
  privacyReview:
    "Re-review means the accountable role re-checks the evidence the requirement's class needs (the provider " +
    "setting, the contract or the clinical sign-off, not only the code), then records the decision date and a " +
    "new `reviewExpiresAt` in the register, with a sanitized external reference where the evidence is external " +
    "(see the role-attestation pack in `docs/governance/`).",
};

const ENFORCEMENT =
  "A lapsed date still fails each register's own check in local runs, on other branches and in release checks. " +
  "A pull request or push to main that edits neither that entry nor its files sees a warning instead.";

function perthIsoDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Perth",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toDate(now) {
  const date = now instanceof Date ? now : typeof now === "string" || typeof now === "number" ? new Date(now) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new TypeError("review-dates section needs a valid `now` (a Date, an ISO string or a timestamp)");
  }
  return date;
}

// A reason safe for a public issue: never an absolute path or a raw system message.
function readRegister(root, file) {
  try {
    return { manifest: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")), problem: null };
  } catch (error) {
    const problem =
      error?.code === "ENOENT"
        ? "the file is missing"
        : error instanceof SyntaxError
          ? "it is not valid JSON"
          : "it could not be read";
    return { manifest: null, problem };
  }
}

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

function hazardEntries(manifest) {
  return [
    { label: "the register-wide review", owner: null, kind: "hazardReview", expires: manifest?.reviewExpiresAt },
    ...[...list(manifest?.hazards), ...list(manifest?.assuranceDecisions)].map((entry) => ({
      label: text(entry?.id) ?? "an entry with no id",
      owner: text(entry?.owner),
      kind: "hazardReview",
      expires: entry?.reviewExpiresAt,
    })),
    ...list(manifest?.driftExceptions).map((exception) => ({
      label: `the drift exception for \`${text(exception?.path) ?? "no path"}\``,
      owner: null,
      kind: "driftException",
      expires: exception?.expiresOn,
    })),
  ];
}

function privacyEntries(manifest) {
  return [
    { label: "the register-wide review", owner: null, kind: "privacyReview", expires: manifest?.reviewExpiresAt },
    ...list(manifest?.requirements).map((item) => ({
      label: text(item?.id) ?? "a requirement with no id",
      owner: text(item?.accountableRole),
      kind: "privacyReview",
      expires: item?.reviewExpiresAt,
    })),
  ];
}

/** Days from `today` to `expires` (both ISO dates); negative once lapsed. */
function daysUntil(today, expires) {
  return Math.round((Date.parse(`${expires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/**
 * How an entry stands on `today`. The stated date is the last valid day: an entry lapses the day
 * AFTER it, exactly as the register checks judge it. Flagged when it has lapsed, its date cannot
 * be read (treated as lapsed, never as current), or its last valid day is within 14 days.
 */
function status(today, expires) {
  if (!validDate(expires)) {
    return { attention: true, lapsed: true, order: -Infinity, text: "Date unreadable (treated as lapsed)" };
  }
  const days = daysUntil(today, expires);
  if (days < 0) {
    const since = -days - 1;
    const ago = since === 0 ? "today" : since === 1 ? "yesterday" : `${since} days ago`;
    return { attention: true, lapsed: true, order: days, text: `Lapsed ${ago} (last valid day ${expires})` };
  }
  const until = days + 1;
  const when = until === 1 ? "tomorrow" : `in ${until} days`;
  return {
    attention: days <= DUE_WITHIN_DAYS,
    lapsed: false,
    order: days,
    text: `Lapses ${when} (last valid day ${expires})`,
  };
}

/**
 * Every dated entry of both registers, judged on `now` (Perth date), for callers that want rows.
 *
 * @param {{ root: string, now: Date | string | number }} options
 */
export function collectReviewDates({ root, now }) {
  const today = perthIsoDate(toDate(now));
  const registers = [
    { name: "Clinical hazard register", file: HAZARD_REGISTER, entries: hazardEntries },
    { name: "Privacy readiness register", file: PRIVACY_REGISTER, entries: privacyEntries },
  ];
  return {
    today,
    registers: registers.map(({ name, file, entries }) => {
      const { manifest, problem } = readRegister(root, file);
      const rows = problem
        ? []
        : entries(manifest).map((entry) => ({ ...entry, status: status(today, entry.expires) }));
      return { name, file, problem, rows };
    }),
  };
}

function describeGroup(rows) {
  return rows.map((row) => (row.owner ? `${row.label} (${row.owner})` : row.label)).join("; ");
}

/**
 * The weekly report section: entries of both registers that have lapsed or fall due within
 * 14 days of `now`, grouped by date, with what re-review means for each kind of entry.
 *
 * @param {{ root: string, now: Date | string | number }} options
 * @returns {Promise<{ title: string, markdown: string }>}
 */
export async function section({ root, now }) {
  const { today, registers } = collectReviewDates({ root, now });
  const title = "Review dates";
  const flagged = registers.flatMap((register) => register.rows.filter((row) => row.status.attention));
  const lapsed = flagged.filter((row) => row.status.lapsed).length;
  const unreadable = registers.filter((register) => register.problem);
  const dated = registers.reduce((sum, register) => sum + register.rows.length, 0);

  const lines = [];
  if (!flagged.length && !unreadable.length) {
    lines.push(
      `As of ${today} (Perth), none of the ${dated} dated entries in the clinical hazard and privacy readiness ` +
        `registers has lapsed or falls due within ${DUE_WITHIN_DAYS} days.`,
    );
    return { title, markdown: `${lines.join("\n")}\n` };
  }
  lines.push(
    `As of ${today} (Perth): ${lapsed} lapsed and ${flagged.length - lapsed} due for re-review within ${DUE_WITHIN_DAYS} ` +
      `days, out of ${dated} dated entries in the clinical hazard and privacy readiness registers. ${ENFORCEMENT}`,
  );
  for (const register of registers) {
    if (register.problem) {
      lines.push("", `**${register.name}** (\`${register.file}\`): not checked, because ${register.problem}.`);
      continue;
    }
    const rows = register.rows.filter((row) => row.status.attention);
    if (!rows.length) continue;
    lines.push("", `**${register.name}** (\`${register.file}\`)`, "");
    const groups = new Map();
    for (const row of [...rows].sort((a, b) => a.status.order - b.status.order)) {
      const key = `${row.kind}|${row.status.text}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const group of groups.values()) lines.push(`- **${group[0].status.text}:** ${describeGroup(group)}.`);
    lines.push("");
    for (const kind of new Set(rows.map((row) => row.kind))) lines.push(`_${MEANING[kind]}_`);
  }
  return {
    title,
    markdown: `${lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()}\n`,
  };
}

async function main(argv) {
  const index = argv.indexOf("--now");
  const now = index >= 0 ? `${argv[index + 1]}T04:00:00Z` : new Date();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const { title, markdown } = await section({ root, now });
  process.stdout.write(`## ${title}\n\n${markdown}`);
}

if (isDirectEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`review-dates: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
}
