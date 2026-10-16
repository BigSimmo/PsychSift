#!/usr/bin/env node
/**
 * check-codebase-index-coverage — flag top-level modules/routes that exist but are
 * NOT mentioned in docs/codebase-index.md.
 *
 * codebase-index.md is the orientation map agents read first; docs:check-links
 * already verifies the paths it names EXIST, but nothing catches the reverse — a
 * new src/lib module or app route that never gets added to the map, silently
 * staling it. This checks that each top-level directory the index organizes around
 * is referenced somewhere in it.
 *
 * Granularity is deliberately top-level directories (route groups + src/lib module
 * dirs), not every file — the index maps modules by theme, so per-file coverage
 * would be pure noise.
 *
 * Run: `npm run docs:check-index`. Blocking — runs in `verify:full` and in
 * CI (`.github/workflows/ci.yml`, the "Codebase index coverage" step). Exit 1 on gaps.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = "docs/codebase-index.md";
const SCHEMA_PATH = "supabase/schema.sql";

// Directories intentionally not indexed at the top level.
const ALLOWLIST = new Set([
  "src/app/icons", // dynamic icon/OG routes, covered by the brand/PWA note, not a product page
]);

function dirsIn(relativeDir) {
  return readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

export function coverageCandidates(kind, name) {
  if (kind === "api") return [`/api/${name}`];
  if (kind === "route") return [`/${name}`];
  if (kind === "root") return [`${name}/`];
  return [`${name}/`, `src/lib/${name}/`];
}

const SECTION_BOUNDS = {
  root: ["## Top-level layout", "## Application architecture"],
  route: ["### Product pages (`src/app/`)", "### API routes (`src/app/api/`)"],
  api: ["### API routes (`src/app/api/`)", "## `src/lib/` module map"],
  lib: ["## `src/lib/` module map", "## Supabase"],
  schema: ["### Schema tables", "### Migration themes"],
};

function sectionText(indexText, kind) {
  const [startMarker, endMarker] = SECTION_BOUNDS[kind] ?? [];
  if (!startMarker) return "";
  const headingOffset = (marker, from = 0) => {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escaped}\\r?$`, "m").exec(indexText.slice(from));
    return match ? from + match.index : -1;
  };
  const start = headingOffset(startMarker);
  if (start < 0) return "";
  const end = headingOffset(endMarker, start + startMarker.length);
  return indexText.slice(start, end < 0 ? indexText.length : end);
}

function codeSpans(text) {
  return [...text.matchAll(/`([^`\r\n]+)`/g)].map((match) => match[1].trim().toLowerCase());
}

function candidateMatches(span, candidate) {
  const normalized = candidate.toLowerCase();
  if (normalized.endsWith("/")) return span.startsWith(normalized);
  return span === normalized || span.startsWith(`${normalized}/`);
}

/** Pure: given the index text and the discovered groups, return the uncovered entries. */
export function coverageGaps(indexText, groups, allowlist = ALLOWLIST) {
  const spansByKind = new Map(
    ["root", "lib", "route", "api"].map((kind) => [kind, codeSpans(sectionText(indexText, kind))]),
  );
  const gaps = [];
  for (const { kind, dir, name } of groups) {
    const full = `${dir}/${name}`;
    if (allowlist.has(full)) continue;
    const tried = coverageCandidates(kind, name);
    const spans = spansByKind.get(kind) ?? [];
    if (!tried.some((candidate) => spans.some((span) => candidateMatches(span, candidate)))) {
      gaps.push({ full, kind, tried });
    }
  }
  return gaps;
}

/** Pure: derive unique repository-root directory names from tracked paths. */
export function trackedRootDirectoryNames(trackedPaths) {
  return [
    ...new Set(
      trackedPaths
        .map((trackedPath) => trackedPath.replaceAll("\\", "/").replace(/^\.\//, ""))
        .filter((trackedPath) => trackedPath.includes("/"))
        .map((trackedPath) => trackedPath.split("/", 1)[0])
        .filter(Boolean),
    ),
  ].sort();
}

/** Pure: compare the exhaustive schema-table list in the index with the schema mirror. */
export function schemaTableGaps(indexText, schemaText) {
  const schemaTables = new Set(
    [...schemaText.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  const tableSection = sectionText(indexText, "schema");
  const documentedTables = new Set(codeSpans(tableSection).filter((span) => /^[a-z][a-z0-9_]*$/.test(span)));
  return {
    missing: [...schemaTables].filter((table) => !documentedTables.has(table)).sort(),
    stale: [...documentedTables].filter((table) => !schemaTables.has(table)).sort(),
  };
}

function discoverGroups() {
  const groups = [];
  const trackedPaths = execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const name of trackedRootDirectoryNames(trackedPaths)) {
    groups.push({ kind: "root", dir: ".", name });
  }
  for (const name of dirsIn("src/lib")) groups.push({ kind: "lib", dir: "src/lib", name });
  for (const name of dirsIn("src/app")) {
    if (name === "api") continue;
    groups.push({ kind: "route", dir: "src/app", name });
  }
  for (const name of dirsIn("src/app/api")) groups.push({ kind: "api", dir: "src/app/api", name });
  return groups;
}

function main() {
  const indexText = readFileSync(path.join(repoRoot, INDEX_PATH), "utf8");
  const schemaText = readFileSync(path.join(repoRoot, SCHEMA_PATH), "utf8");
  const groups = discoverGroups();
  const gaps = coverageGaps(indexText, groups);
  const tables = schemaTableGaps(indexText, schemaText);

  if (gaps.length > 0 || tables.missing.length > 0 || tables.stale.length > 0) {
    console.error(`\n${INDEX_PATH} is missing ${gaps.length} top-level module(s)/route(s):`);
    for (const g of gaps) console.error(`  UNINDEXED ${g.full} (${g.kind}) — add it or allowlist it`);
    for (const table of tables.missing) console.error(`  UNINDEXED public.${table} (schema table)`);
    for (const table of tables.stale) console.error(`  STALE ${table} (not present in ${SCHEMA_PATH})`);
    console.error(`\nUpdate ${INDEX_PATH} so the agent-orientation map stays current.`);
    process.exit(1);
  }
  console.log(
    `${INDEX_PATH} coverage OK: all ${groups.length} repository roots/modules/routes and ${tables.missing.length + tables.stale.length === 0 ? "all" : "checked"} schema tables are indexed.`,
  );
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) main();
