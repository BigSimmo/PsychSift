// Where applied outstanding-issues inbox requests live.
//
// issues:reconcile moves each request it applies into `applied/<uuid>.json`. Once a calendar
// quarter has ended, `issues:archive-applied` moves that quarter's records, byte for byte, into
// `applied/archive/<YYYY-Qn>/<uuid>.json` so the folder stays small enough to list. A record keeps
// its file name and content when it is archived, so every check that tracks applied records
// matches them by file name, never by full path.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const INBOX_DIR = "docs/outstanding-issues-inbox";
export const APPLIED_DIR = path.posix.join(INBOX_DIR, "applied");
export const APPLIED_ARCHIVE_DIR = path.posix.join(APPLIED_DIR, "archive");

const QUARTER = /^\d{4}-Q[1-4]$/;
const APPLIED_RECORD = new RegExp(
  `^${APPLIED_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:archive/\\d{4}-Q[1-4]/)?([^/]+\\.json)$`,
);

/** The calendar quarter of an ISO date, such as `2026-Q3`, or null when the date is not ISO. */
export function quarterOf(isoDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(String(isoDate ?? ""));
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-Q${Math.ceil(month / 3)}`;
}

/** True for an applied record, in `applied/` itself or in one quarter's archive folder. */
export function isAppliedRecordPath(relativePath) {
  return APPLIED_RECORD.test(String(relativePath ?? "").replace(/\\/g, "/"));
}

/** The record's file name, which archiving never changes; null for any other path. */
export function appliedRecordName(relativePath) {
  return APPLIED_RECORD.exec(String(relativePath ?? "").replace(/\\/g, "/"))?.[1] ?? null;
}

/** The archive path a record created on `createdOn` moves to. */
export function archivedAppliedPath(name, createdOn) {
  const quarter = quarterOf(createdOn);
  if (!quarter) throw new Error(`cannot archive ${name}: createdOn ${JSON.stringify(createdOn)} is not an ISO date`);
  return path.posix.join(APPLIED_ARCHIVE_DIR, quarter, name);
}

/** The quarter archive folders present under `root`, oldest first. */
export function appliedArchiveQuarters(root) {
  const absolute = path.join(root, APPLIED_ARCHIVE_DIR);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && QUARTER.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Every directory that holds applied records: `applied/` first, then each quarter archive. */
export function appliedRecordDirectories(root) {
  return [APPLIED_DIR, ...appliedArchiveQuarters(root).map((quarter) => path.posix.join(APPLIED_ARCHIVE_DIR, quarter))];
}

/** The repository-relative path of an applied record by file name, or null when there is none. */
export function findAppliedRecord(root, name) {
  for (const directory of appliedRecordDirectories(root)) {
    const relative = path.posix.join(directory, name);
    if (existsSync(path.join(root, relative))) return relative;
  }
  return null;
}
