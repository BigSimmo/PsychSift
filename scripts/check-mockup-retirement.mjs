#!/usr/bin/env node
/**
 * check-mockup-retirement — make the written record, not a reachability scan, the gate on
 * retiring a mockup.
 *
 * Written after a 2026-09-02 survey found the mockup surface at ~430 files / ~98,000 lines
 * with three problems no existing gate could see:
 *
 *   1. `mockups/README.md` is the repo's only record of which mockup is superseded, and
 *      nothing kept it in step with the tree. It was refuted in five places by a single
 *      afternoon of evidence-gathering (the answer family, both document families, the
 *      closed issue #162, and the calculators family promoted to production by PR #1227).
 *   2. A third of the surface is not design scratch at all. `/mockups/development` and
 *      `/mockups/care-plan` (and, at the time, two since-retired prototypes) are live in
 *      production behind `DeveloperAreaGate` (src/proxy.ts) and linked from Settings. Any
 *      policy keyed on the path `src/app/mockups/**` hits them too.
 *   3. Filename supersession is systematically backwards. `example-round-two` IMPORTS
 *      `example-round-one`; dictionary rounds 2 and 3 both import round 1; the privacy
 *      study imports the privacy winner. Deleting "the older generation" breaks the newer one
 *      in at least five families.
 *
 * `check-dead-code-candidate.mjs` already refuses to call a SYMBOL dead on "nothing imports
 * it". This is its route-and-file-level sibling: it refuses to call a MOCKUP retired on
 * anything except a written record, and it fails CLOSED — an unanswerable question is a
 * refusal, never a pass, because proceeding on a weak signal is the exact failure mode of
 * PR #2204 (~1,644 lines, walked back seven times).
 *
 * Usage:
 *   node scripts/check-mockup-retirement.mjs                 # audit the working tree
 *   node scripts/check-mockup-retirement.mjs --diff <base>   # audit a deletion diff
 *   node scripts/check-mockup-retirement.mjs --json
 *   node scripts/check-mockup-retirement.mjs --self-test
 *
 * Exit 0 = clean. Exit 1 = at least one violation. Exit 2 = bad invocation.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { posix as posixPath, resolve } from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const CLI_USAGE = [
  "Usage:",
  "  node scripts/check-mockup-retirement.mjs",
  "  node scripts/check-mockup-retirement.mjs --diff <base-ref>",
  "  node scripts/check-mockup-retirement.mjs --json",
  "  node scripts/check-mockup-retirement.mjs --self-test",
].join("\n");

export const MOCKUP_ROUTE_ROOT = "src/app/mockups";

/**
 * The file that MAKES a directory a route, and therefore the only deletion the owner's register
 * can speak about. The register records routes — "/mockups/example-gated/panel/[id]" — while
 * Tier B fires per deleted FILE, so the two only meet once this suffix is off. A co-located
 * component deleted from the same folder is deliberately NOT cleared by a route's record: nobody
 * decided about it, and Tier B's whole job is to insist somebody did.
 */
export const ROUTE_ENTRY_SUFFIX = "/page.tsx";

/**
 * The one file whose job is to name paths that deliberately do NOT resolve: it registers link
 * targets known to dangle, so a deleted path recorded there is the record of the deletion
 * rather than a reference that survived it. Named explicitly, because scoping this to the
 * Set-literal shape alone would discount a real route allowlist in any other file.
 */
export const UNRESOLVABLE_LINK_REGISTRY = "scripts/check-docs-links.mjs";

/**
 * Whether a Route-column cell names a retirable ROUTE rather than something else.
 *
 * Two conditions, and the second is the one that was missing: it must live under `/mockups/`,
 * and its last segment must not be a source FILE. The extensions here are deliberately the same
 * set the survivor scan reads, because those are exactly the paths somebody holding a deletion
 * diff has in hand and might paste into the wrong column.
 */
export function isRetirableRoutePath(route) {
  if (typeof route !== "string" || !route.startsWith("/mockups/")) return false;
  const last = route.split("/").pop() ?? "";
  return !SOURCE_FILE_EXTENSION.test(last);
}

// ⚠️ THE DOT IS ESCAPED, AND IT WAS NOT. An unescaped `.` matches ANY character, so this rejected
// every route whose last segment merely ENDS in an extension-like suffix — a `.../reports`
// route (the `.` taking `r`, then `ts`), and `charts` likewise. That is a FALSE
// REFUSAL: it would have blocked a legitimate owner-approved retirement, which is the opposite of
// the defect this predicate was added to fix. Found in review, not by my own six cases, because
// every case I wrote was either an obvious file or an obvious route and none ended in `ts`.
const SOURCE_FILE_EXTENSION = /\.(tsx?|mjs|cjs|jsx?|css|json|md)$/iu;
export const MOCKUP_INDEX_FILE = "mockups/README.md";
export const RETIRED_SECTION_HEADING = "## Retired mockups";

/**
 * The owner's register for Tier B.
 *
 * The policy says a developer-gated retirement is "a product decision, outside this policy", and
 * Tier B refuses one unconditionally. That refusal is right and it stays: it is what stops a
 * cleanup sweep quietly deleting a screen that is live behind the gate. But a decision the owner
 * HAS made needs somewhere to be written down, or the refusal is not a question being asked, it
 * is a route that can never be retired however the product changes.
 *
 * This register is that place, and it is deliberately the strictest table in the file: five
 * columns, every one of them non-blank, naming who approved the retirement as well as what
 * replaced it. A gated deletion absent from this table fails exactly as it did before.
 */
export const OWNER_DECISION_SECTION_HEADING = "## Retired developer-gated routes (owner decisions)";
export const OWNER_DECISION_TABLE_HEADER = ["Retired", "Route", "Approved by", "Superseded by", "Evidence"];
export const DEVELOPER_GATE_SOURCE = "src/lib/developer-area/headers.ts";

/** Directories under the mockup route root that are shell/infrastructure, not routes. */
const NON_ROUTE_ENTRIES = new Set(["mockups.css", "layout.tsx", "mockups-layout-client.tsx"]);

const errorMessage = (error) => (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error));

/** @typedef {{ readFileSync: typeof readFileSync, readdirSync: typeof readdirSync, existsSync: typeof existsSync }} FileSystemAdapter */
/** @type {FileSystemAdapter} */
const NODE_FILE_SYSTEM = { readFileSync, readdirSync, existsSync };

/** Git is repository-guaranteed; a failed command is a safety error, never a soft skip. */
const sh = (args, root = process.cwd()) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.stdout?.toString().trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail.split(/\r?\n/, 1)[0]}` : ""}`, { cause: error });
  }
};

export function normalizeRepoPath(file) {
  return String(file)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");
}

/**
 * Top-level route slugs that actually exist on disk.
 * Nested routes (`document-search/search`) roll up to their top-level slug, because the
 * README indexes mockups at that granularity and always has.
 */
export function listRouteSlugs(root, fileSystem = NODE_FILE_SYSTEM) {
  const base = resolve(root, ...MOCKUP_ROUTE_ROOT.split("/"));
  // Fail closed. Returning [] here made auditIndex pass with "0 routes indexed", which is
  // indistinguishable from a healthy repo and is exactly the soft-skip this gate must not do.
  if (!fileSystem.existsSync(base))
    throw new Error(`${MOCKUP_ROUTE_ROOT} does not exist — cannot audit the mockup surface`);
  // A route is live only while a page.tsx survives under it. Enumerating directories alone let a
  // leftover stylesheet or asset keep a slug "live", which silently suppressed the
  // retirement-record check for a route nobody can load any more.
  const hasPage = (dir) => {
    let entries;
    try {
      entries = fileSystem.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name === "page.tsx") return true;
    }
    return entries.some((entry) => entry.isDirectory() && hasPage(resolve(dir, entry.name)));
  };

  return fileSystem
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_ROUTE_ENTRIES.has(entry.name))
    .filter((entry) => hasPage(resolve(base, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Read the developer-gated prefixes from their own source of truth rather than restating
 * them. If that list grows, this check follows it the same day.
 */
export function readDeveloperGatedPrefixes(root, fileSystem = NODE_FILE_SYSTEM) {
  const source = fileSystem.readFileSync(resolve(root, ...DEVELOPER_GATE_SOURCE.split("/")), "utf8");
  const block = source.match(/DEVELOPER_GATED_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/u);
  if (!block) throw new Error(`${DEVELOPER_GATE_SOURCE} no longer declares DEVELOPER_GATED_PATH_PREFIXES`);
  const prefixes = [...block[1].matchAll(/["'`]([^"'`]+)["'`]/gu)].map((match) => match[1]);
  if (!prefixes.length) throw new Error(`${DEVELOPER_GATE_SOURCE} declares an empty developer-gate list`);
  return prefixes;
}

/** Every inline-code span in a Markdown body, unwrapped. */
export function inlineCodeSpans(markdown) {
  return [...String(markdown).matchAll(/`([^`\n]+)`/gu)].map((match) => match[1].trim());
}

/** True for a line inside a fenced code block, including the fence lines themselves. */
function fenceMask(lines) {
  const mask = [];
  let open = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const marker = trimmed.startsWith("```") ? "```" : trimmed.startsWith("~~~") ? "~~~" : null;
    if (open === null && marker) {
      open = marker;
      mask.push(true);
      continue;
    }
    if (open !== null && marker === open) {
      open = null;
      mask.push(true);
      continue;
    }
    mask.push(open !== null);
  }
  return mask;
}

/** An ATX heading of any level — `#` through `######` followed by a space. */
function isMarkdownHeading(line) {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === "#") hashes += 1;
  return hashes > 0 && hashes <= 6 && line[hashes] === " ";
}

/** The body of a named heading's section, or "" when the section is absent. */
export function sectionBody(markdown, heading) {
  const lines = String(markdown).split(/\r?\n/);
  // A fenced EXAMPLE of one of these tables would otherwise redirect the whole check to the
  // sample rows — plausible precisely because this README's job is to explain the format to
  // future editors, so the more carefully somebody documents it the more likely they break it.
  const fenced = fenceMask(lines);
  const start = lines.findIndex((line, index) => !fenced[index] && line.trim() === heading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  // Any heading ends the section, not just another `##`. Terminating only on `##` meant a
  // `###` subsection’s rows were read as the PRECEDING register’s rows — latent while both
  // registers are `##`, and live the moment anyone demotes a heading or adds a subsection.
  const offset = start + 1;
  const end = rest.findIndex((line, index) => !fenced[offset + index] && isMarkdownHeading(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * Route slugs recorded as retired.
 *
 * Only the Route column of the section's table counts. The "Superseded by" column names the
 * LIVE winner, and reading every code span in the section made that winner look retired — a
 * bug caught by this check against its own first record on 2026-09-02.
 */
export const RETIRED_TABLE_HEADER = ["Retired", "Route", "Superseded by", "Evidence"];

export function retiredSlugs(markdown) {
  const section = retiredSection(markdown);
  if (!section.trim()) return new Set();
  const rows = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  if (!rows.length) return new Set();

  // Column order is load-bearing — the Route column records the retirement, the "Superseded by"
  // column names a LIVE route. Reordering the table silently changes what the record means, so
  // the header is verified rather than assumed.
  const header = rows[0]
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (header.join("|") !== RETIRED_TABLE_HEADER.join("|")) {
    throw new Error(
      `the "${RETIRED_SECTION_HEADING}" table header must be ${RETIRED_TABLE_HEADER.join(" | ")} — found ${header.join(" | ") || "<none>"}`,
    );
  }

  const slugs = new Set();
  for (const line of rows.slice(1)) {
    const cells = line.split("|").map((cell) => cell.trim());
    const route = inlineCodeSpans(cells[2] ?? "")[0];
    if (!route) continue;
    // Evidence bar item 1 is a WRITTEN SUCCESSOR. A row that names a route but leaves the
    // successor or evidence cell blank is not a retirement record — recording the slug from it
    // would let a deletion through on the strength of a table row that says nothing.
    const separator = /^-{2,}$/u;
    const successor = cells[3] ?? "";
    const evidence = cells[4] ?? "";
    if (!successor || separator.test(successor) || !evidence || separator.test(evidence)) continue;
    slugs.add(route.replace(/^\/mockups\//u, "").replace(/\/.*$/u, ""));
  }
  return slugs;
}

/** The body of the "## Retired mockups" section, or "" when the section is absent. */
export function retiredSection(markdown) {
  return sectionBody(markdown, RETIRED_SECTION_HEADING);
}

/**
 * Route paths the owner has explicitly approved retiring from a developer-gated subtree.
 *
 * Returns full "/mockups/..." paths, NOT the top-level slugs that "## Retired mockups" records.
 * That difference is the point: a Tier B decision retires ONE route out of a gated application
 * that is otherwise still live, so a slug-granular record cannot express it — and would reject
 * it anyway, because the application's own slug still exists.
 */
export function ownerApprovedGatedRoutes(markdown) {
  const section = sectionBody(markdown, OWNER_DECISION_SECTION_HEADING);
  if (!section.trim()) return new Set();
  const rows = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  if (!rows.length) return new Set();

  // Column order is load-bearing here for the same reason it is in the retirement table: the
  // Route column names a route that must be GONE, the "Superseded by" column names one that
  // must be live. Reordering them silently inverts the record.
  const header = rows[0]
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (header.join("|") !== OWNER_DECISION_TABLE_HEADER.join("|")) {
    throw new Error(
      `the "${OWNER_DECISION_SECTION_HEADING}" table header must be ${OWNER_DECISION_TABLE_HEADER.join(" | ")} — found ${header.join(" | ") || "<none>"}`,
    );
  }

  const routes = new Set();
  // `-{2,}` let a row of SINGLE hyphens through, and a lone `-` is the conventional markdown
  // way to write "nothing here" — so the most natural way to fill a row you cannot complete
  // was exactly the one that passed, clearing the tier on a row that records no date, no
  // approver, no successor and no reason.
  const separator = /^-+$/u;
  const blank = (cell) => !cell || separator.test(cell);
  for (const line of rows.slice(1)) {
    const cells = line.split("|").map((cell) => cell.trim());
    const route = inlineCodeSpans(cells[2] ?? "")[0];
    if (!route) continue;
    // Every other column is load-bearing too. A row naming a route and nothing else would clear
    // a gated deletion on the strength of a table row that records no date, no approver, no
    // successor and no reason — which is the decision this tier exists to insist on.
    if (blank(cells[1]) || blank(cells[3]) || blank(cells[4]) || blank(cells[5])) continue;
    routes.add(route.replace(/\/+$/u, ""));
  }
  return routes;
}

/** Slugs the index mentions anywhere — the completeness signal. */
export function mentionedSlugs(markdown) {
  return new Set(inlineCodeSpans(markdown).map((span) => span.replace(/^\/mockups\//u, "").replace(/\/.*$/u, "")));
}

/**
 * Audit the working tree: the index must describe the tree, and the tree must not contradict
 * the index. This is the forward-looking half — it is what stops the record drifting away
 * from the files again.
 */
export function auditIndex(root, fileSystem = NODE_FILE_SYSTEM) {
  const violations = [];
  const slugs = listRouteSlugs(root, fileSystem);
  let markdown;
  try {
    markdown = fileSystem.readFileSync(resolve(root, ...MOCKUP_INDEX_FILE.split("/")), "utf8");
  } catch (error) {
    return {
      routeCount: slugs.length,
      violations: [`${MOCKUP_INDEX_FILE} is unreadable — ${errorMessage(error)}`],
    };
  }

  const mentioned = mentionedSlugs(markdown);
  const retired = retiredSlugs(markdown);

  for (const slug of slugs) {
    if (!mentioned.has(slug)) {
      violations.push(
        `/mockups/${slug} has no entry in ${MOCKUP_INDEX_FILE} — every mockup route carries a recorded status`,
      );
    }
    if (retired.has(slug)) {
      violations.push(
        `/mockups/${slug} is listed under "${RETIRED_SECTION_HEADING}" but still exists on disk — retire it or correct the record`,
      );
    }
  }

  return { routeCount: slugs.length, retiredCount: retired.size, violations };
}

/**
 * Files a diff deletes outright, in scope for the reference scan.
 *
 * Naming alone is not the scope. The survey behind this policy found 82 modules reachable only
 * from mockup routes with no "mockup" anywhere in their path (one since-retired prototype's
 * component folder was 58 of them), so a filename filter would drop exactly the support files a retirement is most
 * likely to strand. When a diff retires anything from the mockup surface, every deletion under
 * `src`, `tests`, `scripts` and `worker` is scanned; when it retires nothing, the scan is empty
 * and the gate stays out of the way of unrelated changes.
 */
export function deletedMockupFiles(base, { root = process.cwd(), runGit = sh } = {}) {
  const raw = runGit(["diff", "--diff-filter=D", "--name-only", base, "--", "src", "tests", "scripts", "worker"], root);
  const deleted = raw
    .split("\n")
    .map((line) => normalizeRepoPath(line.trim()))
    .filter(Boolean);
  const retiresMockups = deleted.some((file) => file.startsWith(`${MOCKUP_ROUTE_ROOT}/`) || /mockup/iu.test(file));
  return retiresMockups ? deleted : [];
}

/** Route slugs a diff removes entirely (no surviving page.tsx under them). */
export function deletedRouteSlugs(deletedFiles, survivingSlugs) {
  const live = new Set(survivingSlugs);
  const slugs = new Set();
  for (const file of deletedFiles) {
    if (!file.startsWith(`${MOCKUP_ROUTE_ROOT}/`)) continue;
    const slug = file.slice(MOCKUP_ROUTE_ROOT.length + 1).split("/")[0];
    if (!slug || NON_ROUTE_ENTRIES.has(slug)) continue;
    if (!live.has(slug)) slugs.add(slug);
  }
  return [...slugs].sort();
}

/**
 * Every specifier a survivor could name a deleted file by.
 *
 * The alias form alone was not enough: 59 files in this surface import by relative path, and a
 * first version of this gate missed `./x`, `../../x`, `dynamic(() => import("./x"))` and CSS
 * `composes … from "./x.module.css"` — every one of which the policy claims to cover. Matching
 * is anchored on a quote OR a slash (see `referencePattern`) so a relative prefix cannot hide a
 * reference.
 */
export function moduleSpecifiersFor(file) {
  const path = normalizeRepoPath(file);
  const withoutExtension = path.replace(/\.(tsx?|mjs|jsx?)$/u, "");
  const specifiers = new Set();

  if (withoutExtension.startsWith("src/")) {
    const aliased = `@/${withoutExtension.slice("src/".length)}`;
    specifiers.add(aliased);
    if (aliased.endsWith("/index")) specifiers.add(aliased.slice(0, -"/index".length));
  }

  // A route directory is referenced by its URL, never by a module specifier — the four dead
  // `pathname === "/mockups/<slug>"` branches this gate first shipped without are why.
  //
  // The specifier must name the route that actually went, not just its root: a deep deleted
  // page used to collapse to only its first path segment — the route's root, which usually
  // still exists and is exactly what every surviving nav/test legitimately references.
  // Dropping only the trailing filename and keeping the rest of the directory chain instead
  // names the deleted route itself, segment for segment; the bare root falls out of the same
  // formula when the deleted file IS the root's own page (no segments left to keep).
  if (path.startsWith(`${MOCKUP_ROUTE_ROOT}/`)) {
    const segments = path.slice(MOCKUP_ROUTE_ROOT.length + 1).split("/");
    const slug = segments[0];
    if (slug && !NON_ROUTE_ENTRIES.has(slug)) {
      const routeSegments = segments.slice(0, -1);
      const route = routeSegments.length ? routeSegments.join("/") : slug;
      specifiers.add(`/mockups/${route}`);
    }
  }

  // The bare tail, so `./name`, `../../dir/name` and a CSS-module `composes` source all match.
  const basename = withoutExtension.split("/").pop();
  if (basename && basename !== "index" && basename !== "page") {
    specifiers.add(basename);
    if (path.endsWith(".css")) specifiers.add(path.split("/").pop());
  }
  return [...specifiers];
}

/**
 * True for a bare basename tail (`loading`, `name.css`) as opposed to an aliased (`@/…`) or
 * route (`/mockups/…`) specifier — the two kinds `moduleSpecifiersFor` ever produces that
 * already carry their own path shape by construction.
 */
function isBareTailSpecifier(specifier) {
  return !specifier.startsWith("@/") && !specifier.startsWith("/");
}

/**
 * A reference to `specifier` that survives a relative prefix.
 *
 * A bare tail is only ever a real reference when it is PATH-SHAPED — `./name`, `../x/name`, or
 * a CSS `composes … from "./name.css"` — so it requires an immediately preceding `/`, never a
 * bare quote. Anchoring a bare tail on a quote alone was the defect: an ordinary string literal
 * like `"loading"` (a state value, not an import) opens with the same quote character and
 * matched every time — 54 false positives against a retired root-level "loading" route file on
 * this branch alone (its own literal path is deliberately not spelled out here, so this comment
 * cannot itself trip the Tier C scan below).
 * The aliased and route specifiers are already path-shaped by construction (they start with
 * `@/` or `/`), so they keep matching on a leading quote too.
 */
export function referencePattern(specifier) {
  const escaped = specifier.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const prefix = isBareTailSpecifier(specifier) ? "/" : `(?:["'\`]|/)`;
  return new RegExp(`${prefix}${escaped}["'\`]`, "u");
}

const SOURCE_EXTENSION = /\.(tsx?|mjs|jsx?)$/u;

/** Every quoted relative import/require/dynamic-import/`composes` specifier (`./x`, `../../x`) in `body`. */
export function relativeSpecifiersIn(body) {
  const pattern = /(["'`])(\.\.?\/[^"'`]+)\1/gu;
  const specifiers = [];
  let match;
  while ((match = pattern.exec(body))) specifiers.push(match[2]);
  return specifiers;
}

/**
 * Whether relative `specifier`, written inside `survivor`, resolves to `deletedFile`.
 *
 * The bare-tail specifier text alone (`loading`) cannot tell a genuine reference to one deleted
 * file apart from a reference to any OTHER file sharing that basename — and a per-route
 * convention file like `loading.tsx` exists dozens of times over in this repository, each one a
 * legitimate relative import from a sibling. Resolving the specifier against the importing
 * file's own directory, the way module resolution actually works, is what disambiguates them;
 * matching bare basename text cannot. Extension-agnostic on both sides, since neither a written
 * import specifier nor `moduleSpecifiersFor`'s output carries one (CSS is the exception, and
 * both sides keep `.module.css` for the same reason).
 */
export function relativeSpecifierResolvesTo(specifier, survivor, deletedFile) {
  const survivorDir = posixPath.dirname(normalizeRepoPath(survivor));
  const resolved = posixPath.normalize(posixPath.join(survivorDir, specifier)).replace(SOURCE_EXTENSION, "");
  const target = normalizeRepoPath(deletedFile).replace(SOURCE_EXTENSION, "");
  return resolved === target;
}

/** Every tracked text file that survives the diff, with its contents. */
/**
 * A body with every "known-unresolvable link" registry entry for this path removed.
 *
 * The shape is load-bearing and narrow on purpose: the path must be the sole member of a Set
 * literal, which is how `scripts/check-docs-links.mjs` records a target it expects to dangle.
 * Anything else — an import, a string in a template, a path built by concatenation — is left in
 * place, so the caller's re-test still sees it.
 */
export function stripRegistryEntries(body, file, survivor) {
  // Scoped to the registry FILE, not just its shape. Matching the shape alone discounted any
  // one-member Set anywhere — and `export const GATED_ROUTES = new Set(["<path>"])` is an
  // idiomatic route allowlist, i.e. a genuine dependency, not a record of a deletion.
  if (survivor !== UNRESOLVABLE_LINK_REGISTRY) return String(body);
  return String(body).split(`new Set(["${file}"])`).join("");
}

function survivingSources(root, runGit, fileSystem, deleted) {
  const gone = new Set(deleted.map(normalizeRepoPath));
  const tracked = runGit(["ls-files", "src", "tests", "scripts", "worker"], root)
    .split("\n")
    .map((line) => normalizeRepoPath(line.trim()))
    .filter(Boolean)
    .filter((file) => !gone.has(file))
    .filter((file) => /\.(tsx?|mjs|jsx?|css)$/u.test(file));
  const sources = new Map();
  for (const file of tracked) {
    try {
      sources.set(file, fileSystem.readFileSync(resolve(root, ...file.split("/")), "utf8"));
    } catch {
      // A tracked file we cannot read is a question we cannot answer. Fail closed below.
      sources.set(file, null);
    }
  }
  return sources;
}

/**
 * Audit a deletion diff. Every refusal here exists because the survey found a real file that
 * would have been wrongly removed by a reachability scan.
 */
/**
 * Resolve the base a deletion is measured against.
 *
 * `auto` lets one npm script be enforced locally, in verify:cheap and in CI without each caller
 * knowing the branch shape. It fails closed: an unresolvable base is a refusal, not a skip.
 */
export function resolveDiffBase(base, { root = process.cwd(), runGit = sh, env = process.env } = {}) {
  if (base !== "auto") return base;
  const configured = env.MOCKUP_RETIREMENT_BASE;
  if (configured) return configured;
  const merged = runGit(["merge-base", "origin/main", "HEAD"], root).trim();
  if (!merged) throw new Error("could not resolve a diff base — pass --diff <ref> or set MOCKUP_RETIREMENT_BASE");
  return merged;
}

export function auditDeletions(
  rawBase,
  { root = process.cwd(), runGit = sh, fileSystem = NODE_FILE_SYSTEM, env = process.env } = {},
) {
  const violations = [];
  const base = resolveDiffBase(rawBase, { root, runGit, env });
  const deleted = deletedMockupFiles(base, { root, runGit });
  if (!deleted.length) return { deleted: [], violations };

  const gatedPrefixes = readDeveloperGatedPrefixes(root, fileSystem);
  const survivingSlugs = listRouteSlugs(root, fileSystem);
  const markdown = fileSystem.readFileSync(resolve(root, ...MOCKUP_INDEX_FILE.split("/")), "utf8");
  const recorded = retiredSlugs(markdown);
  const approved = ownerApprovedGatedRoutes(markdown);
  const sources = survivingSources(root, runGit, fileSystem, deleted);

  // Tier B — developer-gated applications are live behind admin auth, not design scratch.
  for (const file of deleted) {
    const routePath = file.startsWith(`${MOCKUP_ROUTE_ROOT}/`)
      ? `/mockups/${file.slice(MOCKUP_ROUTE_ROOT.length + 1)}`
      : null;
    const gated = gatedPrefixes.find(
      (prefix) => routePath && (routePath === prefix || routePath.startsWith(`${prefix}/`)),
    );
    const approvedRoute =
      routePath && routePath.endsWith(ROUTE_ENTRY_SUFFIX) ? routePath.slice(0, -ROUTE_ENTRY_SUFFIX.length) : routePath;
    if (gated && !(approvedRoute && approved.has(approvedRoute))) {
      violations.push(
        `${file} is under the developer-gated prefix ${gated} — that subtree is live in production behind DeveloperAreaGate, so retiring it is a product decision, not cleanup. If the owner has made that decision, record it under "${OWNER_DECISION_SECTION_HEADING}" in ${MOCKUP_INDEX_FILE}`,
      );
    }
  }

  for (const route of approved) {
    // ⚠️ THE ROUTE COLUMN MUST CONTAIN A ROUTE, AND NOTHING USED TO CHECK THAT. Writing a FILE
    // path there cleared Tier B for that one file, and the symmetry check below could not see it:
    // it probes `route + "/page.tsx"`, so for `…/widget.tsx` it looked for
    // `…/widget.tsx/page.tsx`, which cannot exist, and stayed silent. A pass with its own
    // counter-check disabled by construction. Same family as the single-hyphen row: the tier's
    // protection is that a row must MEAN something, and nothing checked that this cell meant what
    // its column says.
    //
    // Fails closed rather than ignoring the row, so the silence becomes a question. A row that
    // records the wrong KIND of thing is a mistake worth a message, not a line to skip quietly.
    if (!isRetirableRoutePath(route)) {
      violations.push(
        `${route} is recorded under "${OWNER_DECISION_SECTION_HEADING}" in ${MOCKUP_INDEX_FILE} but is not a route path — that column records routes, and a file path there would clear this tier for one file with the "recorded but still live" check unable to fire`,
      );
      continue;
    }
    const file = `${MOCKUP_ROUTE_ROOT}/${route.slice("/mockups/".length)}${ROUTE_ENTRY_SUFFIX}`;
    if (fileSystem.existsSync(resolve(root, ...file.split("/")))) {
      violations.push(
        `${route} is recorded under "${OWNER_DECISION_SECTION_HEADING}" in ${MOCKUP_INDEX_FILE} but ${file} still exists — a retirement record for a live route pre-authorises a deletion nobody has decided on`,
      );
    }
  }

  // Tier C + import-graph safety — anything still named by a survivor.
  for (const file of deleted) {
    const specifiers = moduleSpecifiersFor(file);
    for (const [survivor, body] of sources) {
      if (body === null) {
        violations.push(`${survivor} is unreadable — cannot prove ${file} is unreferenced`);
        continue;
      }
      // A path can be named by a survivor for the opposite of the usual reason: the docs-link
      // checker keeps a registry of link targets that are KNOWN not to resolve, so a deleted
      // path listed there is the record of the deletion, not a reference that survived it.
      // Only that exact shape is discounted, and the rest of the file is then re-tested — a
      // genuine reference elsewhere in the same file still fails.
      if (body.includes(file) && stripRegistryEntries(body, file, survivor).includes(file)) {
        violations.push(`${file} is still named as a path by ${survivor} — remove that reference first`);
        continue;
      }
      // A bare tail cannot be text-matched — this repo has dozens of same-named per-route
      // convention files (`loading.tsx` alone, 24 of them) — so it is resolved as a real
      // relative import against the survivor's own directory instead. The aliased and route
      // specifiers stay text-matched: both are already fully qualified, so no other file can
      // collide with them.
      const relativeSpecifiers = relativeSpecifiersIn(body);
      for (const specifier of specifiers) {
        const matched = isBareTailSpecifier(specifier)
          ? relativeSpecifiers.some((relative) => relativeSpecifierResolvesTo(relative, survivor, file))
          : referencePattern(specifier).test(body);
        if (!matched) continue;
        const kind = survivor.startsWith("tests/")
          ? "a committed test"
          : survivor.startsWith("scripts/") || survivor.startsWith("worker/")
            ? "repository tooling"
            : "a surviving module";
        violations.push(`${file} is still referenced as "${specifier}" by ${kind} (${survivor})`);
      }
    }
  }

  // Evidence of record — the whole point of the policy.
  for (const slug of deletedRouteSlugs(deleted, survivingSlugs)) {
    if (recorded.has(slug)) continue;
    violations.push(
      `/mockups/${slug} is deleted but is not recorded under "${RETIRED_SECTION_HEADING}" in ${MOCKUP_INDEX_FILE} — a retirement without a written record is not a retirement`,
    );
  }

  return { deleted, violations: [...new Set(violations)] };
}

export function parseArguments(argv) {
  const options = new Set(argv.filter((arg) => arg.startsWith("--")));
  if (options.has("--self-test")) return { mode: "self-test" };
  const json = options.has("--json");
  const diffIndex = argv.indexOf("--diff");
  if (diffIndex !== -1) {
    const base = argv[diffIndex + 1];
    if (!base || base.startsWith("--")) throw new Error("--diff requires a base ref (or the literal `auto`)");
    return { mode: "diff", base, json };
  }
  const unknown = [...options].filter((option) => !["--json", "--diff", "--self-test"].includes(option));
  if (unknown.length) throw new Error(`unknown option(s): ${unknown.join(", ")}`);
  return { mode: "index", json };
}

function selfTest({ stdout = console.log, stderr = console.error } = {}) {
  const failures = [];
  const check = (name, condition) => {
    if (!condition) failures.push(name);
  };

  const markdown = [
    "# Project Mockups",
    "",
    "`example-study` — Active study.",
    "",
    RETIRED_SECTION_HEADING,
    "",
    "| Retired | Route | Superseded by | Evidence |",
    "| --- | --- | --- | --- |",
    "| 2026-09-02 | `document-navigation-pane` | `document-navigation-perfected` | Exact code match. |",
    "",
    "## Design tokens",
    "",
    "`not-a-retired-slug`",
  ].join("\n");

  check("retiredSection stops at the next heading", !retiredSection(markdown).includes("not-a-retired-slug"));
  check("retiredSlugs finds the recorded slug", retiredSlugs(markdown).has("document-navigation-pane"));
  check("retiredSlugs excludes live entries", !retiredSlugs(markdown).has("example-study"));
  check(
    "retiredSlugs never treats the successor column as retired",
    !retiredSlugs(markdown).has("document-navigation-perfected"),
  );
  check("mentionedSlugs sees the live entry", mentionedSlugs(markdown).has("example-study"));
  check("inlineCodeSpans unwraps backticks", inlineCodeSpans("a `b` c").join() === "b");

  // The owner register for Tier B. Each control below is the FALSE direction: a table that
  // records less than a decision must not clear a gated deletion, because the whole tier is
  // there to insist somebody decided.
  const ownerTable = (rows) =>
    [
      OWNER_DECISION_SECTION_HEADING,
      "",
      "| Retired | Route | Approved by | Superseded by | Evidence |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
      "",
      "## Something else",
      "",
      "`/mockups/example-gated/never-approved`",
    ].join("\n");

  const approvedRow =
    "| 2026-09-03 | `/mockups/example-gated/panel/[id]` | Owner | `/mockups/example-gated/replacement/[id]` | Split into person and movement screens. |";

  check(
    "ownerApprovedGatedRoutes finds a fully recorded decision",
    ownerApprovedGatedRoutes(ownerTable([approvedRow])).has("/mockups/example-gated/panel/[id]"),
  );
  check(
    "ownerApprovedGatedRoutes never reads the successor column as retired",
    !ownerApprovedGatedRoutes(ownerTable([approvedRow])).has("/mockups/example-gated/replacement/[id]"),
  );
  check(
    "ownerApprovedGatedRoutes stops at the next heading",
    !ownerApprovedGatedRoutes(ownerTable([approvedRow])).has("/mockups/example-gated/never-approved"),
  );
  for (const [name, row] of [
    ["no approver", "| 2026-09-03 | `/mockups/example-gated/panel/[id]` |  | `/x` | Reason. |"],
    ["no successor", "| 2026-09-03 | `/mockups/example-gated/panel/[id]` | Owner |  | Reason. |"],
    ["no evidence", "| 2026-09-03 | `/mockups/example-gated/panel/[id]` | Owner | `/x` |  |"],
    ["no date", "|  | `/mockups/example-gated/panel/[id]` | Owner | `/x` | Reason. |"],
  ]) {
    check(
      `ownerApprovedGatedRoutes rejects a row with ${name}`,
      !ownerApprovedGatedRoutes(ownerTable([row])).has("/mockups/example-gated/panel/[id]"),
    );
  }
  check(
    "ownerApprovedGatedRoutes refuses a reordered header",
    (() => {
      try {
        ownerApprovedGatedRoutes(ownerTable([approvedRow]).replace("| Retired | Route |", "| Route | Retired |"));
        return false;
      } catch {
        return true;
      }
    })(),
  );
  // Four holes an adversarial review opened in this tier on 2026-09-03, each pinned with the
  // control that proves the fix still catches the real thing. Every one of them passed the
  // suite as written, so none of these would have been noticed by re-running it.
  const gatedRoute = "/mockups/example-gated/panel/[id]";
  check(
    "a row of single hyphens records nothing and is rejected",
    !ownerApprovedGatedRoutes(ownerTable(["| - | `" + gatedRoute + "` | - | - | - |"])).has(gatedRoute),
  );
  check(
    "a ### subsection is not read as the register",
    !ownerApprovedGatedRoutes(
      ownerTable([approvedRow]).replace(
        "## Something else",
        "### A subsection\n\n| 2026-09-03 | `/mockups/sneaky` | Owner | `/z` | Reason. |\n\n## Something else",
      ),
    ).has("/mockups/sneaky"),
  );
  const fencedExample = [
    "```",
    OWNER_DECISION_SECTION_HEADING,
    "",
    "| Retired | Route | Approved by | Superseded by | Evidence |",
    "| --- | --- | --- | --- | --- |",
    "| 2026-09-03 | `/mockups/fenced-example` | Owner | `/z` | Reason. |",
    "```",
    "",
    ownerTable([approvedRow]),
  ].join("\n");
  check(
    "a fenced example table is documentation, not a register",
    !ownerApprovedGatedRoutes(fencedExample).has("/mockups/fenced-example"),
  );
  check("and the real table after the fence is still read", ownerApprovedGatedRoutes(fencedExample).has(gatedRoute));
  const deletedPath = "src/app/mockups/a/page.tsx";
  const setLiteral = `new Set(["${deletedPath}"])`;
  check(
    "an idiomatic route allowlist in another file is still a reference",
    stripRegistryEntries(`export const GATED = ${setLiteral};`, deletedPath, "src/lib/routes.ts").includes(deletedPath),
  );
  check(
    "the unresolvable-link registry is discounted",
    !stripRegistryEntries(setLiteral, deletedPath, UNRESOLVABLE_LINK_REGISTRY).includes(deletedPath),
  );
  check(
    "but a real import inside that same registry file is not",
    stripRegistryEntries(
      `${setLiteral}\nimport X from \"${deletedPath}\";`,
      deletedPath,
      UNRESOLVABLE_LINK_REGISTRY,
    ).includes(deletedPath),
  );

  check(
    "the two registers do not read each other",
    ownerApprovedGatedRoutes(markdown).size === 0 && retiredSlugs(ownerTable([approvedRow])).size === 0,
  );

  check(
    "moduleSpecifiersFor builds the @/ alias",
    moduleSpecifiersFor("src/components/example-study-mockups.tsx").includes("@/components/example-study-mockups"),
  );
  check(
    "moduleSpecifiersFor strips a trailing /index",
    moduleSpecifiersFor("src/components/tools-page-mockups/index.ts").includes("@/components/tools-page-mockups"),
  );
  check(
    "moduleSpecifiersFor ignores a bare page basename",
    !moduleSpecifiersFor("src/app/mockups/foo/page.tsx").includes("page"),
  );

  // Defect 2 — a deep deleted route must be named by the route that actually went, not
  // collapsed to its (possibly still-live) root.
  check(
    "moduleSpecifiersFor names a deep deleted route by its full path, not just its root",
    moduleSpecifiersFor(`${MOCKUP_ROUTE_ROOT}/example-gated/patients/[id]/page.tsx`).includes(
      "/mockups/example-gated/patients/[id]",
    ),
  );
  check(
    "moduleSpecifiersFor does not also emit the bare root for a deep deleted route",
    !moduleSpecifiersFor(`${MOCKUP_ROUTE_ROOT}/example-gated/patients/[id]/page.tsx`).includes(
      "/mockups/example-gated",
    ),
  );
  check(
    "moduleSpecifiersFor still emits the bare root when the root's own page is what was deleted",
    moduleSpecifiersFor(`${MOCKUP_ROUTE_ROOT}/gone/page.tsx`).includes("/mockups/gone"),
  );

  // Defect 1 — a bare tail is only ever a real reference when it is path-shaped.
  check(
    "referencePattern's bare-tail form requires a leading slash, not a bare quote",
    !referencePattern("loading").test('const status = "loading";'),
  );
  check(
    "referencePattern's bare-tail form still matches a relative import",
    referencePattern("loading").test('import X from "./loading";'),
  );
  check(
    "referencePattern's alias form keeps matching on a leading quote (unaffected by Defect 1)",
    referencePattern("@/app/demo/loading").test('import X from "@/app/demo/loading";'),
  );

  // The residual ambiguity Defect 1 alone cannot resolve: many files can share one bare tail
  // (24 `loading.tsx` route files in this repo), so a real relative import must be RESOLVED
  // against the importing file's own directory, not merely text-matched. Synthetic example
  // paths below deliberately avoid spelling out the real retired root-level file's exact repo
  // path, so this self-test cannot trip the Tier C scan it is testing.
  check(
    "relativeSpecifierResolvesTo confirms a real reference from a sibling file",
    relativeSpecifierResolvesTo("./loading", "src/app/demo/page.tsx", "src/app/demo/loading.tsx"),
  );
  check(
    "relativeSpecifierResolvesTo confirms a real reference from a nested file, walking up",
    relativeSpecifierResolvesTo("../../loading", "src/app/demo/a/b/page.tsx", "src/app/demo/loading.tsx"),
  );
  check(
    "relativeSpecifierResolvesTo rejects a same-named file elsewhere in the tree",
    !relativeSpecifierResolvesTo("../loading", "src/app/demo/services/search/page.tsx", "src/app/demo/loading.tsx"),
  );
  check(
    "relativeSpecifierResolvesTo is extension-agnostic on the specifier side",
    relativeSpecifierResolvesTo(
      "./example-shell.module.css",
      "src/components/x.tsx",
      "src/components/example-shell.module.css",
    ),
  );
  check(
    "relativeSpecifiersIn extracts a dynamic import specifier",
    relativeSpecifiersIn('dynamic(() => import("./example-study-mockups"))').includes("./example-study-mockups"),
  );

  check(
    "deletedRouteSlugs reports a fully removed route",
    deletedRouteSlugs([`${MOCKUP_ROUTE_ROOT}/gone/page.tsx`], ["stays"]).join() === "gone",
  );
  check(
    "deletedRouteSlugs ignores a route with a surviving sibling page",
    deletedRouteSlugs([`${MOCKUP_ROUTE_ROOT}/stays/nested/page.tsx`], ["stays"]).length === 0,
  );

  let parsedDiff;
  try {
    parsedDiff = parseArguments(["--diff", "origin/main"]);
  } catch {
    parsedDiff = null;
  }
  check("parseArguments accepts --diff <base>", parsedDiff?.mode === "diff" && parsedDiff.base === "origin/main");
  let rejectedBareDiff = false;
  try {
    parseArguments(["--diff"]);
  } catch {
    rejectedBareDiff = true;
  }
  check("parseArguments rejects a bare --diff", rejectedBareDiff);

  if (failures.length) {
    for (const failure of failures) stderr(`  x ${failure}`);
    stderr(`[mockup-retirement] SELF-TEST FAILED — ${failures.length} assertion(s).`);
    return 1;
  }
  stdout("[mockup-retirement] self-test passed.");
  return 0;
}

export function main(
  argv = process.argv.slice(2),
  {
    root = process.cwd(),
    runGit = sh,
    fileSystem = NODE_FILE_SYSTEM,
    stdout = console.log,
    stderr = console.error,
  } = {},
) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    stderr(`${errorMessage(error)}\n${CLI_USAGE}`);
    return 2;
  }
  if (parsed.mode === "self-test") return selfTest({ stdout, stderr });

  let result;
  try {
    result =
      parsed.mode === "diff" ? auditDeletions(parsed.base, { root, runGit, fileSystem }) : auditIndex(root, fileSystem);
  } catch (error) {
    stderr(`[mockup-retirement] REFUSE — ${errorMessage(error)}`);
    return 1;
  }

  if (parsed.json) {
    stdout(JSON.stringify(result, null, 2));
    return result.violations.length ? 1 : 0;
  }

  if (result.violations.length) {
    for (const violation of result.violations) stdout(`  x ${violation}`);
    stderr(
      `[mockup-retirement] FAIL — ${result.violations.length} violation(s). See docs/mockup-retirement-policy.md.`,
    );
    return 1;
  }

  stdout(
    parsed.mode === "diff"
      ? `[mockup-retirement] PASS — ${result.deleted.length} deleted mockup file(s), each recorded and unreferenced.`
      : `[mockup-retirement] PASS — ${result.routeCount} mockup route(s) indexed, ${result.retiredCount} recorded as retired.`,
  );
  return 0;
}

const invokedAsScript = isDirectEntrypoint(import.meta.url);
if (invokedAsScript) process.exitCode = main();
