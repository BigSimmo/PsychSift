// Last-read pins for the organisation map's key documents (suggestion 11).
//
// docs/organisation/pins.json maps each canonical doc to the commit at which someone last read it
// against its area's files. A doc is stale when files in its area changed after it was last read:
// after its pin, or after the doc's own latest edit when that is newer (an edit is a read too).
// This is information for the weekly report and is never a PR block.
//
// Pins must name a commit on main (for example the commit a weekly report was generated at).
// A commit that only ever existed on a PR branch is not in main's history until that PR merges, and
// commits from PRs squash-merged before 2026-10-18 (merge commits only since) never reach it; its doc reports "pin not in history" instead of a guess. A shallow clone that does not
// reach the pin degrades the same way. Everything is read from HEAD, so the answer never depends
// on today's date.
import { areasOf, git, mapAtHead } from "./map-placement.mjs";

export const PINS_FILE = "docs/organisation/pins.json";
const MAP_DIR_PREFIX = "docs/organisation/";
const SHA = /^[0-9a-f]{7,40}$/;

function readPinsAtHead(root) {
  const raw = git(root, ["show", `HEAD:${PINS_FILE}`], { allowFail: true });
  if (raw === null) return {};
  try {
    const data = JSON.parse(raw);
    return data?.pins && typeof data.pins === "object" ? data.pins : {};
  } catch {
    return {}; // the checker reports an unreadable pins file
  }
}

// A pin names a commit. Something that is not a commit id (a content id from before pins recorded
// commits, a typo) is unreadable; a commit id this clone does not have is "not in history".
function resolvePin(root, value) {
  if (typeof value !== "string" || !SHA.test(value)) return { commit: null, readable: false };
  const type = git(root, ["cat-file", "-t", value], { allowFail: true })?.trim();
  if (type === undefined) return { commit: null, readable: true };
  if (type !== "commit") return { commit: null, readable: false };
  return { commit: git(root, ["rev-parse", `${value}^{commit}`]).trim(), readable: true };
}

function isAncestorOfHead(root, commit) {
  return git(root, ["merge-base", "--is-ancestor", commit, "HEAD"], { allowFail: true }) !== null;
}

// Non-merge commits after `pin` up to HEAD, newest first, each with the files it touched.
function commitsSince(root, pin) {
  const log = git(root, ["log", "--no-merges", "--no-renames", "--name-only", "--format=%x00%H", `${pin}..HEAD`]);
  const commits = [];
  for (const block of log.split("\0")) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length) commits.push({ sha: lines[0], files: lines.slice(1) });
  }
  return commits;
}

/**
 * One row per canonical doc (and any other pinned doc): its area, its pin, how many commits
 * touched the area's files since the pin, whether the doc itself changed since, and whether it
 * is stale. Area files exclude the doc itself, the map folder, and generated files and records.
 * `now` is accepted for the report runner's shared signature; the result depends only on HEAD.
 *
 * @param {{ root: string, now?: Date }} options
 * @returns {Array<{doc: string, area: string|null, pinnedCommit: string|null,
 *   status: "checked"|"no pin"|"pin unreadable"|"pin not in history"|"doc missing",
 *   commitsSinceInArea: number|null, docChangedSincePin: boolean|null,
 *   commitsSinceLastRead: number|null, stale: boolean, changedFiles: string[]}>}
 */
export function pinStatus({ root } = {}) {
  const pins = readPinsAtHead(root);
  const resolved = new Map();
  const logs = new Map();
  for (const [doc, value] of Object.entries(pins)) {
    const { commit, readable } = resolvePin(root, value);
    const inHistory = Boolean(commit) && isAncestorOfHead(root, commit);
    if (inHistory && !logs.has(commit)) logs.set(commit, commitsSince(root, commit));
    resolved.set(doc, { commit, readable, inHistory });
  }

  // Files deleted since a pin still count for their area, placed by today's rules.
  const historical = new Set();
  for (const commits of logs.values()) for (const c of commits) for (const f of c.files) historical.add(f);
  const map = mapAtHead(root, { extraPaths: [...historical] });

  const docs = new Map();
  for (const [doc, areas] of map.canonicalDocs) docs.set(doc, areas[0]);
  for (const doc of Object.keys(pins)) {
    if (!docs.has(doc)) docs.set(doc, areasOf(map.placement[doc])[0] ?? null);
  }

  const areaFileCache = new Map();
  const inArea = (file, area) => {
    const key = `${area}\0${file}`;
    if (!areaFileCache.has(key)) {
      areaFileCache.set(
        key,
        !file.startsWith(MAP_DIR_PREFIX) &&
          areasOf(map.placement[file]).includes(area) &&
          !map.isRecordOrGenerated(file),
      );
    }
    return areaFileCache.get(key);
  };

  const rows = [];
  for (const [doc, area] of [...docs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pin = resolved.get(doc);
    const row = {
      doc,
      area,
      pinnedCommit: pin?.commit ?? (typeof pins[doc] === "string" ? pins[doc] : null),
      status: "checked",
      commitsSinceInArea: null,
      docChangedSincePin: null,
      commitsSinceLastRead: null,
      stale: false,
      changedFiles: [],
    };
    if (!map.files.has(doc)) row.status = "doc missing";
    else if (!pin) row.status = "no pin";
    else if (!pin.readable) row.status = "pin unreadable";
    else if (!pin.inHistory) row.status = "pin not in history";
    if (row.status !== "checked") {
      rows.push(row);
      continue;
    }
    const commits = logs.get(pin.commit);
    const newestDocEdit = commits.findIndex((c) => c.files.includes(doc));
    row.docChangedSincePin = newestDocEdit !== -1;
    const areaCommits = commits
      .map((c, index) => ({ index, files: c.files.filter((f) => f !== doc && inArea(f, area)) }))
      .filter((c) => c.files.length);
    row.commitsSinceInArea = areaCommits.length;
    const unread = row.docChangedSincePin ? areaCommits.filter((c) => c.index < newestDocEdit) : areaCommits;
    row.commitsSinceLastRead = unread.length;
    row.stale = unread.length > 0;
    row.changedFiles = [...new Set(unread.flatMap((c) => c.files))].sort();
    rows.push(row);
  }
  return rows;
}
