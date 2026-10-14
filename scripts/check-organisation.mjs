#!/usr/bin/env node
// Organisation map checker. The map (docs/organisation/) says which area of PsychSift every
// tracked file belongs to; this script keeps that map honest. Guide: docs/organisation/README.md.
//
// Exit codes (honest, never optimistic):
//   0  the scope was checked and nothing it is responsible for is broken; warnings may remain
//   1  the map contradicts itself or cannot be read (bad JSON or schema, an over-broad rule, two
//      areas tying for one file)
//   2  the check could not run or could not be trusted (crash, git missing, wrong or sparse
//      checkout, unknown map version, unreachable CI base)
//
// Modes: working tree (default), --staged (reads the map and file list from the index), and CI
// (ORGANISATION_CHECK_MODE=ci with BASE_SHA/HEAD_SHA): only findings the change itself introduced
// block, so a PR is never blamed for leftovers already on main and the result never depends on
// today's date. Files no rule places are warnings, never failures (owner decision 2026-09-26).
// Moving or renaming never turns a PR red either: entries left pointing at a moved or deleted file,
// superseded not-yet-placed entries and unsorted rules are warnings, and --fix tidies them (owner
// decision 2026-09-26: keep the map loose around pages and modes, which move often).
//
// It never deletes, moves or rewrites project files. Reports go to the git-ignored
// output/organisation/ as a paired JSON + Markdown file selected through latest.json.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { indexSectionDrift } from "./organisation/codebase-index-section.mjs";
import { pinStatus } from "./organisation/pins.mjs";
import { coverageLossFindings, deadEntryFindings } from "./organisation/path-lists.mjs";
import { routingHint } from "./organisation/routing-hint.mjs";

export const MAP_VERSION = 1;
const CHECKER_VERSION = 1;
const MAP_DIR = "docs/organisation";
const SYSTEMS_DIR = `${MAP_DIR}/systems`;
const CHECKER_PATH = "scripts/check-organisation.mjs";
const REPORT_DIR = "output/organisation";
const LOCK_STALE_MS = 2 * 60 * 1000;
const KEEP_REPORTS = 20;
const REASON_MAX = 120;
const SUMMARY_MAX = 60_000;
// Folders that mix areas: a wildcard sitting directly inside one must carry at least three
// literal characters (for example `tests/rag-*`), so nobody can place a whole mixed folder at once.
// A rule of `**` segments ending in a fixed file name (`src/app/**/page.tsx`) is exempt: it names one kind
// of file.
const MIXED_PARENTS = new Set([
  "",
  "src/",
  "src/lib/",
  "src/components/",
  "src/app/",
  "src/app/api/",
  "tests/",
  "docs/",
  "scripts/",
  "public/",
  "data/",
  "src/data/",
]);
const ZERO_SHA = /^0+$/;
const FIX_HINT = "`npm run check:organisation -- --fix` tidies it";

class Incomplete extends Error {}

// ---------- git and snapshots ----------

function git(root, args, { allowFail = false } = {}) {
  const result = spawnSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Incomplete(`git could not be run: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFail) return null;
    throw new Incomplete(`git ${args.join(" ")} failed: ${(result.stderr || "").trim().split("\n")[0]}`);
  }
  return result.stdout;
}

function splitZ(text) {
  return text.split("\0").filter(Boolean);
}

// A snapshot is a list of tracked files, their blob ids, and a way to read one file.
function indexEntries(root) {
  const blobs = new Map();
  for (const entry of splitZ(git(root, ["ls-files", "-z", "--stage"]))) {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab).split(" ");
    blobs.set(entry.slice(tab + 1), meta[1]);
  }
  return blobs;
}

function workingTreeSnapshot(root) {
  const blobs = indexEntries(root);
  for (const file of [...blobs.keys()]) {
    if (!fs.existsSync(path.join(root, file))) blobs.delete(file);
  }
  // Include non-ignored untracked files so placement and verification see new files
  // before they are added to the index.
  for (const file of splitZ(git(root, ["ls-files", "-z", "--others", "--exclude-standard"]))) {
    blobs.set(file, "(untracked)");
  }
  return {
    label: "working tree",
    blobs,
    read: (file) => (blobs.has(file) ? fs.readFileSync(path.join(root, file), "utf8") : null),
  };
}

function stagedSnapshot(root) {
  const blobs = indexEntries(root);
  return {
    label: "staged",
    blobs,
    read: (file) => (blobs.has(file) ? git(root, ["show", `:${file}`]) : null),
  };
}

function commitSnapshot(root, sha) {
  const blobs = new Map();
  for (const entry of splitZ(git(root, ["ls-tree", "-r", "-z", sha]))) {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab).split(" ");
    if (meta[1] === "blob") blobs.set(entry.slice(tab + 1), meta[2]);
  }
  return {
    label: `commit ${sha.slice(0, 9)}`,
    blobs,
    read: (file) => (blobs.has(file) ? git(root, ["cat-file", "blob", blobs.get(file)]) : null),
  };
}

function assertUsableCheckout(root) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
  if (inside?.trim() !== "true") throw new Incomplete(`${root} is not inside a git work tree`);
  const top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const norm = (p) => {
    const real = fs.realpathSync.native(p);
    return process.platform === "win32" ? real.toLowerCase().replaceAll("\\", "/") : real;
  };
  // A broken nested worktree can make git silently resolve to a different checkout.
  if (norm(top) !== norm(root)) throw new Incomplete(`git resolved to ${top}, not ${root}`);
  const sparse = git(root, ["config", "--bool", "core.sparseCheckout"], { allowFail: true });
  if (sparse?.trim() === "true") throw new Incomplete("sparse checkout: the file list would be incomplete");
}

// ---------- patterns ----------

function patternProblem(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return "is empty or not a string";
  if (/[\\?]/.test(pattern)) return "uses `\\` or `?`";
  if (pattern.startsWith("/") || pattern.endsWith("/") || pattern.includes("//")) return "has a stray `/`";
  const segments = pattern.split("/");
  if (segments.some((s) => s === "." || s === "..")) return "uses `.` or `..` segments";
  if (segments.some((s) => s.includes("**") && s !== "**")) return "uses `**` inside a segment";
  const prefix = literalPrefix(pattern);
  // A rule whose last segment is a fixed file name (`src/app/**/page.tsx`) names one kind of file,
  // not a whole mixed folder, so the three-character rule does not apply to it.
  // Only `**` qualifies: a single `*` segment (`src/lib/*/index.ts`) still sweeps a mixed folder.
  const namedFile =
    segments.length > 1 &&
    !segments.at(-1).includes("*") &&
    segments.every((segment) => !segment.includes("*") || segment === "**");
  if (prefix !== null && !namedFile) {
    const dir = prefix.slice(0, prefix.lastIndexOf("/") + 1);
    if (MIXED_PARENTS.has(dir) && prefix.length - dir.length < 3) {
      return `is too broad: a wildcard directly inside \`${dir || "(repo root)"}\` needs at least three fixed characters`;
    }
  }
  return null;
}

function literalPrefix(pattern) {
  const star = pattern.indexOf("*");
  return star === -1 ? null : pattern.slice(0, star);
}

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

// Our own small dialect: `*` stays inside one folder, `**` spans folders, everything else
// (including Next.js route folders such as `(search-app)` and `[id]`) is literal. Case-sensitive.
export function compilePattern(pattern) {
  const segments = pattern.split("/");
  let source = "^";
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === "**") source += last ? ".+" : "(?:[^/]+/)*";
    else source += segment.split("*").map(escapeRegex).join("[^/]*") + (last ? "" : "/");
  });
  return new RegExp(`${source}$`);
}

// ---------- map loading and validation ----------

function parseJson(snapshot, file, findings) {
  const raw = snapshot.read(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw.replace(/^﻿/, ""));
  } catch (error) {
    findings.push(broken(`map-json:${file}`, file, `is not valid JSON: ${error.message}`));
    return null;
  }
}

function broken(key, subject, message) {
  return { level: "broken", key, subject, message };
}

// `about` names the project file a map finding concerns, so CI can annotate the PR that moved it.
function warning(key, subject, message, about = null) {
  return about ? { level: "warning", key, subject, message, about } : { level: "warning", key, subject, message };
}

function checkKeys(object, allowed, file, findings) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) findings.push(broken(`map-key:${file}:${key}`, file, `has an unknown key \`${key}\``));
  }
}

function checkVersion(object, file) {
  if (object.version !== MAP_VERSION) {
    throw new Incomplete(`${file} has map version ${object.version}; this checker reads version ${MAP_VERSION}`);
  }
}

function checkReason(reason, where, file, findings) {
  const problem =
    typeof reason !== "string" || reason.trim() === ""
      ? "needs a reason"
      : reason.length > REASON_MAX
        ? `has a reason over ${REASON_MAX} characters`
        : /[\r\n]/.test(reason)
          ? "has a multi-line reason"
          : /:\/\/|www\.|@|\d{6,}/.test(reason)
            ? "has a reason containing a link, email or long number (reasons describe location only)"
            : null;
  if (problem) findings.push(broken(`map-reason:${file}:${where}`, file, `\`${where}\` ${problem}`));
}

function loadMap(snapshot) {
  const findings = [];
  const systemFiles = [...snapshot.blobs.keys()].filter(
    (f) => f.startsWith(`${SYSTEMS_DIR}/`) && f.endsWith(".json") && !f.slice(SYSTEMS_DIR.length + 1).includes("/"),
  );
  if (systemFiles.length === 0) throw new Incomplete(`no area files found under ${SYSTEMS_DIR}/`);
  const systems = new Map();
  const rules = [];
  for (const file of systemFiles.sort()) {
    const data = parseJson(snapshot, file, findings);
    if (!data) continue;
    checkVersion(data, file);
    checkKeys(data, ["version", "id", "name", "kind", "owns", "canonicalDocs", "paths"], file, findings);
    const expectedId = path.posix.basename(file, ".json");
    if (data.id !== expectedId) findings.push(broken(`map-id:${file}`, file, `id must be \`${expectedId}\``));
    if (!["area", "workstream"].includes(data.kind)) {
      findings.push(broken(`map-kind:${file}`, file, "kind must be `area` or `workstream`"));
    }
    for (const field of ["name", "owns"]) {
      if (typeof data[field] !== "string" || !data[field].trim()) {
        findings.push(broken(`map-field:${file}:${field}`, file, `needs a \`${field}\``));
      }
    }
    const docs = Array.isArray(data.canonicalDocs) ? data.canonicalDocs : [];
    const paths = Array.isArray(data.paths) ? data.paths : [];
    if (!Array.isArray(data.paths)) findings.push(broken(`map-field:${file}:paths`, file, "needs a `paths` list"));
    const sorted = [...paths].sort();
    if (paths.some((p, i) => p !== sorted[i])) {
      findings.push(warning(`map-sort:${file}`, file, `\`paths\` is not in alphabetical order; ${FIX_HINT}`));
    }
    if (new Set(paths).size !== paths.length)
      findings.push(warning(`map-dup:${file}`, file, `\`paths\` has duplicates; ${FIX_HINT}`));
    systems.set(data.id, { id: data.id, name: data.name, kind: data.kind, owns: data.owns, canonicalDocs: docs, file });
    for (const pattern of paths) {
      const problem = patternProblem(pattern);
      if (problem) {
        findings.push(broken(`rule-invalid:${data.id}:${pattern}`, file, `rule \`${pattern}\` ${problem}`));
        continue;
      }
      const prefix = literalPrefix(pattern);
      rules.push({
        system: data.id,
        pattern,
        exact: prefix === null,
        rank: prefix === null ? Number.POSITIVE_INFINITY : prefix.length,
        regex: prefix === null ? null : compilePattern(pattern),
        file,
      });
    }
  }

  const listFile = (name, key) => {
    const file = `${MAP_DIR}/${name}`;
    const data = parseJson(snapshot, file, findings);
    if (!data) {
      if (!snapshot.blobs.has(file)) findings.push(broken(`map-missing:${file}`, file, "is missing"));
      return [];
    }
    checkVersion(data, file);
    checkKeys(data, ["version", key], file, findings);
    return Array.isArray(data[key]) ? data[key] : [];
  };

  const shared = [];
  for (const entry of listFile("shared.json", "entries")) {
    const where = entry?.path ?? "(entry)";
    checkKeys(entry ?? {}, ["path", "systems", "reason"], `${MAP_DIR}/shared.json`, findings);
    checkReason(entry?.reason, where, `${MAP_DIR}/shared.json`, findings);
    const ids = Array.isArray(entry?.systems) ? entry.systems : [];
    if (ids.length < 2)
      findings.push(
        broken(`shared-few:${where}`, `${MAP_DIR}/shared.json`, `\`${where}\` must name two or more areas`),
      );
    for (const id of ids) {
      if (!systems.has(id))
        findings.push(
          broken(
            `shared-unknown:${where}:${id}`,
            `${MAP_DIR}/shared.json`,
            `\`${where}\` names unknown area \`${id}\``,
          ),
        );
    }
    if (typeof entry?.path === "string" && literalPrefix(entry.path) !== null) {
      findings.push(
        broken(`shared-glob:${where}`, `${MAP_DIR}/shared.json`, `\`${where}\` must be an exact file, not a pattern`),
      );
    }
    shared.push({ path: entry?.path, systems: ids });
  }

  const notYetPlaced = [];
  for (const entry of listFile("not-yet-placed.json", "entries")) {
    const where = entry?.path ?? "(entry)";
    checkKeys(entry ?? {}, ["path", "reason"], `${MAP_DIR}/not-yet-placed.json`, findings);
    checkReason(entry?.reason, where, `${MAP_DIR}/not-yet-placed.json`, findings);
    if (typeof entry?.path === "string" && literalPrefix(entry.path) !== null) {
      findings.push(
        broken(
          `nyp-glob:${where}`,
          `${MAP_DIR}/not-yet-placed.json`,
          `\`${where}\` must be an exact file, not a pattern`,
        ),
      );
    }
    notYetPlaced.push({ path: entry?.path });
  }

  const compileList = (name, list) => {
    const out = [];
    for (const pattern of list) {
      const problem = patternProblem(pattern);
      if (problem) {
        findings.push(
          broken(`rule-invalid:${name}:${pattern}`, `${MAP_DIR}/${name}`, `rule \`${pattern}\` ${problem}`),
        );
        continue;
      }
      out.push({ pattern, exact: literalPrefix(pattern) === null, regex: compilePattern(pattern), list: name });
    }
    return out;
  };

  const ignored = [];
  const ignoredData = listFile("ignored.json", "entries");
  for (const entry of ignoredData) {
    const where = entry?.match ?? "(entry)";
    checkKeys(entry ?? {}, ["match", "reason"], `${MAP_DIR}/ignored.json`, findings);
    checkReason(entry?.reason, where, `${MAP_DIR}/ignored.json`, findings);
  }
  ignored.push(
    ...compileList(
      "ignored.json",
      ignoredData.map((e) => e?.match),
    ),
  );

  const kinds = new Map();
  const kindsFile = `${MAP_DIR}/kinds.json`;
  const kindsData = parseJson(snapshot, kindsFile, findings);
  if (kindsData) {
    checkVersion(kindsData, kindsFile);
    checkKeys(kindsData, ["version", "generated", "records", "historical"], kindsFile, findings);
    for (const kind of ["generated", "records", "historical"]) {
      kinds.set(kind, compileList("kinds.json", Array.isArray(kindsData[kind]) ? kindsData[kind] : []));
    }
  } else if (!snapshot.blobs.has(kindsFile)) {
    findings.push(broken(`map-missing:${kindsFile}`, kindsFile, "is missing"));
  }

  const pinsFile = `${MAP_DIR}/pins.json`;
  const pinsData = parseJson(snapshot, pinsFile, findings);
  let pins = {};
  if (pinsData) {
    checkVersion(pinsData, pinsFile);
    checkKeys(pinsData, ["version", "pins"], pinsFile, findings);
    pins = pinsData.pins && typeof pinsData.pins === "object" ? pinsData.pins : {};
  } else if (!snapshot.blobs.has(pinsFile)) {
    findings.push(broken(`map-missing:${pinsFile}`, pinsFile, "is missing"));
  }

  return { systems, rules, shared, notYetPlaced, ignored, kinds, pins, findings };
}

// ---------- evaluation ----------

export function evaluate(snapshot) {
  const map = loadMap(snapshot);
  const findings = [...map.findings];
  const files = [...snapshot.blobs.keys()].sort();
  const fileSet = new Set(files);

  const exactRules = new Map();
  const globRules = [];
  for (const rule of map.rules) {
    if (rule.exact) {
      if (!exactRules.has(rule.pattern)) exactRules.set(rule.pattern, []);
      exactRules.get(rule.pattern).push(rule);
    } else globRules.push(rule);
  }
  const sharedByPath = new Map(map.shared.filter((e) => typeof e.path === "string").map((e) => [e.path, e]));
  const nypSet = new Set(map.notYetPlaced.map((e) => e.path).filter((p) => typeof p === "string"));
  const globHits = new Map(globRules.map((r) => [r, 0]));
  const listHits = new Map([...map.ignored, ...[...map.kinds.values()].flat()].map((r) => [r, 0]));

  const placement = {};
  const counts = Object.fromEntries([...map.systems.keys()].map((id) => [id, 0]));
  const unplaced = [];
  const ambiguous = [];
  let ignoredCount = 0;
  let sharedCount = 0;

  for (const file of files) {
    for (const rule of listHits.keys()) {
      if (rule.exact ? rule.pattern === file : rule.regex.test(file)) listHits.set(rule, listHits.get(rule) + 1);
    }
    const matches = [...(exactRules.get(file) ?? [])];
    for (const rule of globRules) {
      if (rule.regex.test(file)) {
        matches.push(rule);
        globHits.set(rule, globHits.get(rule) + 1);
      }
    }
    if (map.ignored.some((rule) => (rule.exact ? rule.pattern === file : rule.regex.test(file)))) {
      placement[file] = "(ignored)";
      ignoredCount += 1;
      continue;
    }
    const sharedEntry = sharedByPath.get(file);
    const best = matches.length ? Math.max(...matches.map((m) => m.rank)) : null;
    const top = [...new Set(matches.filter((m) => m.rank === best).map((m) => m.system))];
    if (sharedEntry) {
      placement[file] = `(shared) ${sharedEntry.systems.join(" + ")}`;
      sharedCount += 1;
    } else if (top.length === 1) {
      placement[file] = top[0];
      counts[top[0]] += 1;
    } else if (top.length > 1) {
      placement[file] = "(tie)";
      ambiguous.push(file);
      findings.push(
        broken(
          `tie:${file}`,
          file,
          `is claimed equally by ${top.map((t) => `\`${t}\``).join(" and ")}; add an exact rule or a shared entry`,
        ),
      );
    }
    const placed = Boolean(sharedEntry) || top.length === 1;
    if (nypSet.has(file) && placed) {
      findings.push(
        warning(
          `nyp-superseded:${file}`,
          `${MAP_DIR}/not-yet-placed.json`,
          `\`${file}\` is now placed by a rule; ${FIX_HINT}`,
          file,
        ),
      );
    }
    if (!placed && top.length === 0) {
      placement[file] = nypSet.has(file) ? "(not yet placed)" : "(unplaced)";
      if (!nypSet.has(file)) unplaced.push(file);
    }
  }

  // Everything that names an exact file must point at a real one (principle: no dead rules).
  for (const [pattern, list] of exactRules) {
    if (!fileSet.has(pattern)) {
      for (const rule of list)
        findings.push(
          warning(
            `dead-rule:${rule.system}:${pattern}`,
            rule.file,
            `rule \`${pattern}\` names a file that no longer exists (moved or deleted?); ${FIX_HINT}`,
            pattern,
          ),
        );
    }
  }
  for (const entry of map.shared) {
    if (typeof entry.path === "string" && !fileSet.has(entry.path)) {
      findings.push(
        warning(
          `dead-shared:${entry.path}`,
          `${MAP_DIR}/shared.json`,
          `\`${entry.path}\` no longer exists; ${FIX_HINT}`,
          entry.path,
        ),
      );
    }
  }
  for (const file of nypSet) {
    if (!fileSet.has(file))
      findings.push(
        warning(
          `dead-nyp:${file}`,
          `${MAP_DIR}/not-yet-placed.json`,
          `\`${file}\` no longer exists; ${FIX_HINT}`,
          file,
        ),
      );
  }
  for (const [rule, hits] of listHits) {
    if (hits > 0) continue;
    if (rule.exact)
      findings.push(
        warning(
          `dead-list:${rule.list}:${rule.pattern}`,
          `${MAP_DIR}/${rule.list}`,
          `\`${rule.pattern}\` no longer exists; ${FIX_HINT}`,
          rule.pattern,
        ),
      );
    else
      findings.push(
        warning(
          `empty-list-glob:${rule.list}:${rule.pattern}`,
          `${MAP_DIR}/${rule.list}`,
          `\`${rule.pattern}\` matches nothing`,
        ),
      );
  }
  for (const [rule, hits] of globHits) {
    if (hits === 0)
      findings.push(
        warning(`empty-glob:${rule.system}:${rule.pattern}`, rule.file, `rule \`${rule.pattern}\` matches nothing`),
      );
  }
  for (const system of map.systems.values()) {
    for (const doc of system.canonicalDocs) {
      if (!fileSet.has(doc))
        findings.push(
          warning(
            `dead-canonical:${system.id}:${doc}`,
            system.file,
            `canonical doc \`${doc}\` no longer exists; ${FIX_HINT}`,
            doc,
          ),
        );
    }
  }
  for (const doc of Object.keys(map.pins)) {
    if (!fileSet.has(doc))
      findings.push(
        warning(`dead-pin:${doc}`, `${MAP_DIR}/pins.json`, `pinned doc \`${doc}\` no longer exists; ${FIX_HINT}`, doc),
      );
  }
  for (const file of unplaced) findings.push(warning(`unplaced:${file}`, file, "is not placed in any area yet"));

  return {
    systems: [...map.systems.values()].map(({ id, name, kind }) => ({ id, name, kind, files: counts[id] })),
    totals: {
      files: files.length,
      placed: Object.values(counts).reduce((a, b) => a + b, 0),
      shared: sharedCount,
      ignored: ignoredCount,
      notYetPlaced: nypSet.size,
      unplaced: unplaced.length,
      ambiguous: ambiguous.length,
    },
    files,
    placement,
    kinds: map.kinds,
    findings,
  };
}

// ---------- freshness (information only) ----------

function freshness(root, result) {
  const shallow = git(root, ["rev-parse", "--is-shallow-repository"], { allowFail: true })?.trim() === "true";
  if (shallow) return { history: "unavailable (shallow clone)", hotspots: [] };
  const log =
    git(root, ["log", "--since=30.days", "--no-renames", "--name-only", "--format=", "HEAD"], { allowFail: true }) ??
    "";
  const skip = [...result.kinds.values()].flat();
  const counts = new Map();
  for (const file of log.split("\n").filter(Boolean)) {
    if (!(file in result.placement) || result.placement[file] === "(ignored)") continue;
    if (skip.some((rule) => (rule.exact ? rule.pattern === file : rule.regex.test(file)))) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  const hotspots = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([file, commits]) => ({ file, commits, area: result.placement[file] }));
  return { history: "last 30 days", hotspots };
}

// ---------- reports ----------

function fence(lines) {
  return ["```text", ...lines.map((line) => String(line).replaceAll("`", "'")), "```"];
}

function renderMarkdown(report) {
  const blocking = report.findings.filter((f) => f.level === "broken" && f.blocking);
  const other = report.findings.filter((f) => !(f.level === "broken" && f.blocking));
  const lines = [
    `# Organisation check: exit ${report.exitCode} (${report.verdict})`,
    "",
    `Last checked: ${report.checkedAt} on ${report.scope}${report.commit ? ` at ${report.commit.slice(0, 9)}` : ""}. A report means "last checked", never "currently true".`,
    "",
    "## Areas",
    "",
    ...fence(
      report.systems.map(
        (s) =>
          `${s.id.padEnd(20)} ${String(s.files).padStart(5)}  ${s.name}${s.kind === "workstream" ? " (workstream)" : ""}`,
      ),
    ),
    "",
    ...fence(Object.entries(report.totals).map(([k, v]) => `${k.padEnd(14)} ${v}`)),
  ];
  if (report.incomplete) lines.push("", "## Could not check", "", ...fence([report.incomplete]));
  if (blocking.length) lines.push("", "## Blocking", "", ...fence(blocking.map((f) => `${f.subject}: ${f.message}`)));
  if (other.length) {
    lines.push(
      "",
      `## Warnings and findings (${other.length})`,
      "",
      ...fence(other.slice(0, 200).map((f) => `${f.subject}: ${f.message}`)),
    );
    if (other.length > 200) lines.push(`…and ${other.length - 200} more in the JSON report.`);
  }
  if (report.staleDocs?.length) {
    lines.push(
      "",
      "## Key documents that may be out of date",
      "",
      "Re-read the document against the files that changed in its area, then set its pin in",
      "docs/organisation/pins.json to the commit on main you read it against (the weekly report prints one).",
      "Never a commit only on a PR branch: PRs are squash-merged.",
      "",
    );
    lines.push(
      ...fence(
        report.staleDocs.map((r) =>
          r.status === "checked"
            ? `${r.doc} [${r.area}] ${r.commitsSinceLastRead} commit(s) since last read`
            : `${r.doc} [${r.area}] ${r.status}`,
        ),
      ),
    );
  }
  if (report.freshness?.hotspots?.length) {
    lines.push(
      "",
      `## Most-edited files (${report.freshness.history})`,
      "",
      ...fence(report.freshness.hotspots.map((h) => `${String(h.commits).padStart(4)}  ${h.file}  [${h.area}]`)),
    );
  }
  if (report.sinceLast) lines.push("", "## Since the last compatible report", "", ...fence(report.sinceLast));
  if (report.untracked?.length) {
    lines.push(
      "",
      `## Untracked files (information only, ${report.untracked.length})`,
      "",
      ...fence(report.untracked.slice(0, 20)),
    );
  }
  lines.push(
    "",
    "## What this does not guarantee",
    "",
    "It does not prove any code works, and placing a file never grants clinical, ranking, privacy, security or database approval.",
  );
  return `${lines.join("\n")}\n`;
}

function sinceLastReport(dir, report) {
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
    const previous = JSON.parse(fs.readFileSync(path.join(dir, pointer.json), "utf8"));
    if (previous.mapVersion !== report.mapVersion || previous.checkerVersion !== report.checkerVersion) return null;
    const moved = [];
    let added = 0;
    let removed = 0;
    for (const [file, area] of Object.entries(report.placement)) {
      if (!(file in previous.placement)) added += 1;
      else if (previous.placement[file] !== area) moved.push(`${file}: ${previous.placement[file]} -> ${area}`);
    }
    for (const file of Object.keys(previous.placement)) if (!(file in report.placement)) removed += 1;
    return [
      `since ${previous.checkedAt}: ${added} files added, ${removed} removed, ${moved.length} changed area`,
      ...moved.slice(0, 50),
    ];
  } catch {
    return null;
  }
}

function writeReport(root, report) {
  const dir = path.join(root, REPORT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, ".lock");
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
  } catch {
    // no lock present
  }
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
  } catch {
    return "skipped: another run is writing a report";
  }
  try {
    report.sinceLast = sinceLastReport(dir, report);
    const id = `report-${report.checkedAt.replace(/[:.]/g, "-")}-${process.pid}`;
    const writeAtomic = (name, text) => {
      const tmp = path.join(dir, `.${name}.tmp`);
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, path.join(dir, name));
    };
    writeAtomic(`${id}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeAtomic(`${id}.md`, renderMarkdown(report));
    // The pointer is written last, so a reader never pairs Markdown and JSON from different runs.
    writeAtomic(
      "latest.json",
      `${JSON.stringify({ json: `${id}.json`, md: `${id}.md`, checkedAt: report.checkedAt }, null, 2)}\n`,
    );
    const old = fs
      .readdirSync(dir)
      .filter((f) => /^report-.*\.json$/.test(f))
      .sort()
      .slice(0, -KEEP_REPORTS);
    for (const f of old) {
      fs.rmSync(path.join(dir, f), { force: true });
      fs.rmSync(path.join(dir, f.replace(/\.json$/, ".md")), { force: true });
    }
    return path.join(REPORT_DIR, `${id}.md`);
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

// ---------- --fix: tidy stale entries ----------

// Removes map entries left behind by moved or deleted files, drops not-yet-placed entries a rule
// now covers, and restores alphabetical order. It edits only docs/organisation/, never places a
// file, never touches ignore patterns, and never moves or deletes a project file.
function fixMap(root) {
  const snapshot = workingTreeSnapshot(root);
  const result = evaluate(snapshot);
  // A new file counts as existing before it is added to git: the tidy-up must never drop the map
  // entry, pin or key-doc line written for a document that is simply not committed yet.
  const exists = (file) =>
    typeof file === "string" &&
    (snapshot.blobs.has(file) ||
      (!path.isAbsolute(file) && fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() === true));
  const isExact = (pattern) => typeof pattern === "string" && literalPrefix(pattern) === null;
  const placedByRule = (file) => {
    const where = result.placement[file];
    return typeof where === "string" && (!where.startsWith("(") || where.startsWith("(shared)"));
  };
  const changed = [];
  const removed = [];
  const edit = (file, mutate) => {
    const full = path.join(root, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, "utf8").replace(/^﻿/, ""));
    } catch {
      return; // unreadable files are reported by the check itself
    }
    const before = JSON.stringify(data);
    mutate(data);
    if (JSON.stringify(data) === before) return;
    fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
    changed.push(file);
  };
  const keep = (file, list, test, label) =>
    list.filter((item) => {
      if (test(item)) return true;
      removed.push(`${file}: ${label(item)}`);
      return false;
    });

  for (const file of [...snapshot.blobs.keys()].filter((f) => f.startsWith(`${SYSTEMS_DIR}/`) && f.endsWith(".json"))) {
    edit(file, (data) => {
      if (Array.isArray(data.paths)) {
        const kept = keep(file, data.paths, (p) => !isExact(p) || exists(p), String);
        data.paths = [...new Set(kept)].sort();
      }
      if (Array.isArray(data.canonicalDocs)) data.canonicalDocs = keep(file, data.canonicalDocs, exists, String);
    });
  }
  const entries = (name, test, label) => {
    const file = `${MAP_DIR}/${name}`;
    if (!snapshot.blobs.has(file)) return;
    edit(file, (data) => {
      if (Array.isArray(data.entries)) data.entries = keep(file, data.entries, test, label);
    });
  };
  entries(
    "shared.json",
    (e) => exists(e?.path),
    (e) => e?.path,
  );
  entries(
    "not-yet-placed.json",
    (e) => exists(e?.path) && !placedByRule(e.path),
    (e) => e?.path,
  );
  entries(
    "ignored.json",
    (e) => !isExact(e?.match) || exists(e.match),
    (e) => e?.match,
  );
  const kindsFile = `${MAP_DIR}/kinds.json`;
  if (snapshot.blobs.has(kindsFile)) {
    edit(kindsFile, (data) => {
      for (const kind of ["generated", "records", "historical"]) {
        if (Array.isArray(data[kind]))
          data[kind] = keep(kindsFile, data[kind], (p) => !isExact(p) || exists(p), String);
      }
    });
  }
  const pinsFile = `${MAP_DIR}/pins.json`;
  if (snapshot.blobs.has(pinsFile)) {
    edit(pinsFile, (data) => {
      if (!data.pins || typeof data.pins !== "object") return;
      for (const doc of Object.keys(data.pins)) {
        if (!exists(doc)) {
          delete data.pins[doc];
          removed.push(`${pinsFile}: ${doc}`);
        }
      }
    });
  }

  // Leave the edited files in the repo's own Prettier layout when Prettier is installed.
  let formatted = changed.length === 0;
  const prettier = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");
  if (changed.length && fs.existsSync(prettier)) {
    formatted =
      spawnSync(process.execPath, [prettier, "--write", ...changed], { cwd: root, stdio: "ignore" }).status === 0;
  }
  return { changed, removed, formatted };
}

// ---------- modes ----------

function changedFiles(root, base, head) {
  return splitZ(git(root, ["diff", "--no-renames", "--name-only", "-z", `${base}...${head}`]));
}

function runCi(root, env) {
  const baseEnv = (env.BASE_SHA ?? "").trim();
  const head = (env.HEAD_SHA ?? "").trim() || "HEAD";
  const headSnapshot = commitSnapshot(root, head);
  const hasMap = (snapshot) =>
    [...snapshot.blobs.keys()].some((f) => f.startsWith(`${SYSTEMS_DIR}/`) && f.endsWith(".json"));
  const reachableBase =
    baseEnv && !ZERO_SHA.test(baseEnv) ? git(root, ["merge-base", baseEnv, head], { allowFail: true })?.trim() : null;
  if (!hasMap(headSnapshot) && !(reachableBase && hasMap(commitSnapshot(root, reachableBase)))) {
    // A branch started before the map existed has nothing to check; it picks the map up when it
    // next merges main. Passing here keeps such a branch from failing on a map it never had. A
    // change that deletes a map its base had is not this case: it falls through and fails.
    return {
      scope: `no organisation map on ${headSnapshot.label} yet (branch predates it; nothing to check)`,
      result: { findings: [], systems: [], totals: {}, placement: {}, files: [] },
      baseKeys: null,
      touched: [],
      mergeBase: null,
      head,
    };
  }
  if (!baseEnv || ZERO_SHA.test(baseEnv)) {
    // Scheduled or manual runs have no base: judge the whole tree honestly.
    return {
      scope: `whole tree (${headSnapshot.label})`,
      result: evaluate(headSnapshot),
      baseKeys: null,
      touched: null,
      mergeBase: null,
      head,
    };
  }
  const mergeBase = git(root, ["merge-base", baseEnv, head], { allowFail: true })?.trim();
  if (!mergeBase) {
    // A force-push leaves the old tip unreachable. Judge the whole tree rather than failing to run.
    return {
      scope: `whole tree (${headSnapshot.label}; the CI base ${baseEnv.slice(0, 9)} is not reachable)`,
      result: evaluate(headSnapshot),
      baseKeys: null,
      touched: null,
      mergeBase: null,
      head,
    };
  }
  const touched = changedFiles(root, mergeBase, head);
  const result = evaluate(headSnapshot);
  let baseKeys = new Set();
  const baseSnapshot = commitSnapshot(root, mergeBase);
  if ([...baseSnapshot.blobs.keys()].some((f) => f.startsWith(`${SYSTEMS_DIR}/`))) {
    try {
      baseKeys = new Set(evaluate(baseSnapshot).findings.map((f) => f.key));
    } catch {
      baseKeys = new Set();
    }
  }
  return {
    scope: `changes since ${mergeBase.slice(0, 9)} (${headSnapshot.label})`,
    result,
    baseKeys,
    touched,
    mergeBase,
    head,
  };
}

// Safety-list coverage (plan suggestion 7). Never blocking: a rename that drops a file out of a
// safety list is loud, dead list entries are ordinary warnings. pr-policy stays the list's owner.
function safetyListFindings(root, result, run, ci) {
  try {
    // The lists come from this checkout's pr-policy, so they only describe a tree that has it.
    if (!result.files?.includes("scripts/pr-policy.mjs")) return [];
    const findings = deadEntryFindings({ root, trackedFiles: result.files });
    // The generated Areas section in docs/codebase-index.md is regenerated by the pre-commit
    // hook; drift is only ever a warning here, never a CI failure.
    if (!ci) {
      const drift = indexSectionDrift({ root });
      if (drift) findings.push(warning("index-section-drift", "docs/codebase-index.md", drift));
    }
    if (ci && run.mergeBase) findings.push(...coverageLossFindings({ root, base: run.mergeBase, head: run.head }));
    return findings.map((f) => ({ ...f, level: "warning" }));
  } catch (error) {
    return [
      warning(
        "safety-lists-unchecked",
        "scripts/pr-policy.mjs",
        `safety-list coverage could not be checked: ${String(error?.message ?? error).split("\n")[0]}`,
      ),
    ];
  }
}

function touchesMap(touched) {
  return (
    touched === null ||
    touched.some((f) => f === CHECKER_PATH || f.startsWith(`${MAP_DIR}/`) || f.startsWith("scripts/organisation/"))
  );
}

// `--files` accepts repo-relative, `./`-prefixed, absolute and current-folder-relative paths.
function repoPath(root, file, env, placement) {
  const slashed = String(file)
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/, "");
  if (slashed in placement) return slashed;
  const from = env.INIT_CWD || process.cwd();
  const relative = path.relative(root, path.resolve(from, String(file))).replaceAll("\\", "/");
  if (relative && !relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative)) return relative;
  return path.isAbsolute(slashed) ? null : slashed;
}

function parseArgs(argv) {
  const args = { staged: false, report: true, quiet: false, json: false, fix: false, root: null, files: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--staged") args.staged = true;
    else if (arg === "--no-report") args.report = false;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--fix") args.fix = true;
    else if (arg === "--root") args.root = argv[++i];
    else if (arg === "--files") args.files = argv.slice(i + 1);
    else throw new Incomplete(`unknown argument ${arg}`);
    if (arg === "--files") break;
  }
  return args;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const checkedAt = new Date().toISOString();
  let args = { report: false, quiet: false, json: false };
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const ci = env.ORGANISATION_CHECK_MODE === "ci";
  const report = {
    checkedAt,
    mapVersion: MAP_VERSION,
    checkerVersion: CHECKER_VERSION,
    findings: [],
    systems: [],
    totals: {},
  };
  try {
    args = parseArgs(argv);
    if (args.root) root = path.resolve(args.root);
    assertUsableCheckout(root);
    if (args.fix) {
      if (ci || args.staged) throw new Incomplete("--fix works on the working tree only");
      report.fixed = fixMap(root);
    }
    let run;
    if (ci) run = runCi(root, env);
    else {
      const snapshot = args.staged ? stagedSnapshot(root) : workingTreeSnapshot(root);
      run = { scope: snapshot.label, result: evaluate(snapshot), baseKeys: null, touched: null, snapshot };
    }
    const { result } = run;
    result.findings.push(...safetyListFindings(root, result, run, ci));
    report.scope = run.scope;
    report.commit = git(root, ["rev-parse", "HEAD"], { allowFail: true })?.trim() ?? null;
    Object.assign(report, {
      systems: result.systems,
      totals: result.totals,
      placement: result.placement,
    });
    for (const finding of result.findings) {
      // In CI only findings the change introduced block; inherited ones are reported, not blamed.
      finding.blocking = finding.level === "broken" && (!run.baseKeys || !run.baseKeys.has(finding.key));
    }
    report.findings = result.findings;
    if (!ci) {
      if (args.report) {
        try {
          report.staleDocs = pinStatus({ root }).filter((r) => r.stale || r.status !== "checked");
        } catch (error) {
          report.staleDocs = [{ doc: "(pins)", area: "-", status: `could not check: ${error.message}` }];
        }
      }
      report.freshness = freshness(root, result);
      report.untracked = splitZ(git(root, ["ls-files", "-z", "--others", "--exclude-standard"]));
    }
    if (args.files) {
      const lookups = args.files.map((file) => ({ file, key: repoPath(root, file, env, result.placement) }));
      // A file not in git yet is placed as if it were, so a planned file shows its future area.
      const missing = lookups.filter((l) => l.key && !(l.key in result.placement)).map((l) => l.key);
      let future = {};
      if (missing.length && run.snapshot) {
        const blobs = new Map([...run.snapshot.blobs, ...missing.map((file) => [file, "(new)"])]);
        future = evaluate({ ...run.snapshot, blobs }).placement;
      }
      report.lookup = lookups.map(({ file, key }) => {
        const tracked = key !== null && key in result.placement;
        const area = tracked ? result.placement[key] : (future[key] ?? "(unplaced)");
        const system = result.systems.find((s) => s.id === area);
        return { file, path: key, area: tracked ? area : `${area}, not tracked yet`, name: system?.name ?? null };
      });
    }
    report.touchesMap = ci ? touchesMap(run.touched) : null;
    report.touched = run.touched;
    report.exitCode = result.findings.some((f) => f.blocking) ? 1 : 0;
  } catch (error) {
    report.incomplete = error instanceof Incomplete ? error.message : `checker crashed: ${error?.stack ?? error}`;
    report.exitCode = 2;
  }
  report.verdict = ["pass", "map broken", "could not check"][report.exitCode];

  if (args.report && !ci) {
    try {
      report.reportPath = writeReport(root, report);
    } catch (error) {
      report.reportPath = `not written: ${error.message}`;
    }
  }
  const markdown = renderMarkdown(report);
  if (ci && env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown.slice(0, SUMMARY_MAX));
    } catch {
      // the summary is a convenience
    }
  }
  if (args.json)
    process.stdout.write(`${JSON.stringify({ ...report, placement: undefined, touched: undefined }, null, 2)}\n`);
  else printConsole(report, args, ci);

  // CI: a checker that cannot run fails the step only when the change touches the map or checker,
  // so a checker bug cannot turn every unrelated PR red. The report keeps the honest code.
  if (ci && report.exitCode === 2 && report.touchesMap === false) {
    console.log(`::warning title=Organisation check incomplete::${report.incomplete}`);
    return 0;
  }
  return report.exitCode;
}

function printConsole(report, args, ci) {
  const out = args.quiet ? console.error : console.log;
  out(`organisation: exit ${report.exitCode} (${report.verdict}) — ${report.scope ?? "no scope"}`);
  if (report.incomplete) out(`  could not check: ${report.incomplete.split("\n")[0]}`);
  const t = report.totals;
  if (t.files !== undefined) {
    out(
      `  ${t.files} files: ${t.placed} placed, ${t.shared} shared, ${t.ignored} ignored, ${t.notYetPlaced} not yet placed, ${t.unplaced} unplaced`,
    );
  }
  if (report.fixed) {
    const { changed, removed, formatted } = report.fixed;
    out(
      `  tidied: ${removed.length} stale entr${removed.length === 1 ? "y" : "ies"} removed, ${changed.length} map file(s) rewritten`,
    );
    for (const item of removed.slice(0, 30)) out(`    removed ${item}`);
    if (!formatted) out("  run `npm run format` to restore the map files' layout");
  }
  for (const finding of report.findings.filter((f) => f.blocking))
    out(`  BLOCKING ${finding.subject}: ${finding.message}`);
  // A folder move gives one loud finding per file; say it once per folder pair, not per file.
  const loud = report.findings.filter((f) => f.loud);
  const groups = new Map();
  for (const finding of loud) {
    const key = finding.about ? `${path.posix.dirname(finding.about)} -> ${path.posix.dirname(finding.subject)}` : "";
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  for (const [key, items] of groups) {
    const shown = key && items.length > 3 ? items.slice(0, 1) : items;
    for (const finding of shown) {
      const more = shown.length < items.length ? ` (and ${items.length - 1} more files moved ${key})` : "";
      out(`  SAFETY COVERAGE LOST ${finding.subject}: ${finding.message}${more}`);
      if (ci)
        console.log(
          `::warning file=${finding.subject},title=Safety coverage lost::${finding.message.replaceAll("`", "'")}${more}`,
        );
    }
  }
  // Loud findings are printed above; listing them again as warnings doubled every one.
  const warnings = report.findings.filter((f) => !f.blocking && !f.loud);
  if (warnings.length) out(`  ${warnings.length} warning(s)${args.quiet ? "" : ":"}`);
  if (!args.quiet) {
    // In CI, annotate only what this change touched; inherited warnings stay in the summary.
    const touched = report.touched ? new Set(report.touched) : null;
    const shown = touched ? warnings.filter((f) => touched.has(f.subject) || touched.has(f.about)) : warnings;
    for (const finding of shown.slice(0, 30)) {
      out(`  warning ${finding.subject}: ${finding.message}`);
      if (ci) console.log(`::warning file=${finding.subject}::${finding.message.replaceAll("`", "'")}`);
    }
    if (shown.length > 30) out(`  …and ${shown.length - 30} more (see the report)`);
    for (const item of report.lookup ?? []) out(`  ${item.file}: ${item.area}${item.name ? ` (${item.name})` : ""}`);
    if (report.lookup?.length) out(`  ${routingHint(report.lookup.map((item) => item.path ?? item.file))}`);
  }
  if (report.reportPath) out(`  report: ${report.reportPath}`);
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`organisation: checker crashed: ${error?.stack ?? error}`);
    process.exitCode = 2;
  }
}
