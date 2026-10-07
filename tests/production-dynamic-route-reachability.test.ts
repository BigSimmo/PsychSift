// tests/production-dynamic-route-reachability.test.ts
//
// Every production dynamic page route must be linked from somewhere in src/, so a page nothing can
// reach fails here instead of waiting to be noticed by a person.
//
// ⚠️ WHAT THIS ASSERTS, AND WHAT IT DOES NOT. This proves a route is REFERENCED — that some source
// builds an href whose shape matches it. It does NOT prove a person can reach the page. A link built
// inside a `.map()` may iterate a whole collection or a context-derived subset of one, and the two
// are textually identical. Read a passing run as "something links this", never as "this is
// reachable". The retired Ward Flow prototype's navigation test made the same distinction in its
// own title and for the same reason.
//
// WHY THIS FILE EXISTS AT ALL, since a reader will reasonably suspect it duplicates something.
// `tests/route-reachability.test.ts` removes every dynamic route before it asserts anything
// (`!entry.route.includes("[")`), by design — its header says interpolated hrefs are brittle to
// pattern-match. `tests/site-map.test.ts` proves each route is DOCUMENTED, and regenerates that doc
// from the same filesystem walk, so a route that moved updates both sides and stays green. And the
// retired Ward Flow prototype's navigation test covered only its own design-scratch tree. The result
// was an inversion: the mockups had a strong reachability guard and the pages real users load had
// none.
//
// THREE THINGS HERE ARE LOAD-BEARING RATHER THAN TIDY. Each is a check that could not fail, found in
// this repository rather than imagined:
//
//   1. COMMENTS ARE STRIPPED BEFORE SCANNING. On `main`, `tests/route-reachability.test.ts` records
//      that a patients module's own note contained the sentence "the control is
//      `<Link href={patientRoute(...)}>`" and satisfied that scan on PROSE — it passed with the real
//      link mutated away.
//
//      ⚠️ BE PRECISE ABOUT WHAT THE STRIP BUYS HERE, because the first version of this file
//      overclaimed and its own assertion caught it. `src/lib/information-pages.ts:75` does carry a
//      comment naming `/therapy-compass/[slug]/brief or /sheet` — the only contiguous mention of
//      either path outside the route files — but that path is written as bare prose, and `hrefsIn`
//      only reads QUOTED strings and template literals. So that particular comment never entered the
//      scan, stripped or not, and removing the strip would not change today's result by one route.
//      The strip earns its place against a different and equally real case: a comment containing a
//      QUOTED path, which `hrefsIn` would otherwise happily accept. That case is unit-tested below
//      against synthetic input rather than against the tree, because a defence that happens to be
//      unexercised today must still be proved to work.
//
//   2. SHAPE MATCHING, NOT PREFIX MATCHING. The tempting cheap version truncates a route at its
//      first `[` and asks whether that prefix appears. It is wrong in the one direction that matters:
//      `/therapy-compass/[slug]/brief` truncates to `/therapy-compass/`, which the existing href
//      `` `/therapy-compass/${record.slug}` `` satisfies — so the cheap version marks BOTH real
//      routes covered and goes green precisely where the risk is. Segment count and position are
//      what separate them, so an href must match a route's whole shape. The
//      `prefix matching would swallow` case below pins that too, because the argument is more
//      convincing than the code and someone will otherwise simplify this back.
//
//   3. THE EXCEPTION SET IS PINNED EXACTLY, NOT FLOORED. A newly unmatched route fails, and so does
//      an entry for a route the scan can now see: a stale entry is a false record of the codebase,
//      and this project has been bitten before by rows that outlived what they described.
//
// Scope is production only: `src/app/mockups/**` is design-scratch that 404s in production and is
// deliberately exempt from the wiring and reachability gates.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripAllComments } from "./helpers/strip-source-comments";

const repoRoot = path.resolve(__dirname, "..");
// `path.resolve(__dirname, "..")` rather than `process.cwd()`: a cwd-relative read passes or fails
// depending on where the runner happened to start, which a since-retired prototype's sandbox test
// documented having been caught by.

const APP_DIR = path.join(repoRoot, "src", "app");
const SRC_DIR = path.join(repoRoot, "src");

/**
 * A path segment standing in for a value only known at runtime — `[slug]`, or a `${…}`.
 *
 * Written as an escape rather than as the raw control character it denotes. The first version of
 * this file embedded literal NUL bytes here; every test still passed, and the only symptom was that
 * `grep` began reporting the file as binary and refused to print matching lines. A sentinel that
 * works perfectly while making the file unreadable to text tooling is the quiet kind of defect this
 * repository has been caught by before, so: no raw control bytes in source, ever.
 */
const DYNAMIC = "::dynamic-segment::";

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const toPosix = (p: string) => p.split(path.sep).join("/");

/** The URL a page file serves, with parenthesised route-group folders removed. */
function routeUrlForFile(file: string): string {
  return file
    .slice(toPosix(APP_DIR).length)
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/");
}

/**
 * Every dynamic production page route, as the URL it actually serves.
 *
 * Route groups — `(search-app)` — are stripped because parenthesised folders do not appear in URLs.
 * Forgetting that is how a check ends up looking for `/(search-app)/documents/` and finding nothing,
 * which reads as an orphan rather than as a bug in the check.
 */
function collectDynamicRoutes(): string[] {
  return walk(APP_DIR)
    .map(toPosix)
    .filter((file) => /\/page\.tsx$/.test(file))
    .map((file) => file.slice(toPosix(APP_DIR).length).replace(/\/page\.tsx$/, ""))
    .filter((route) => route.includes("["))
    .filter((route) => !route.startsWith("/mockups"))
    .map((route) =>
      route
        .split("/")
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .join("/"),
    )
    .sort();
}

/** `/dsm/diagnoses/[slug]/differentials` -> `["dsm","diagnoses",DYNAMIC,"differentials"]`. */
function routeShape(route: string): string[] {
  return route
    .split("/")
    .slice(1)
    .map((segment) => (/^\[.*\]$/.test(segment) ? DYNAMIC : segment));
}

/**
 * The shape of an href written in source, or `null` if it is not a rooted path.
 *
 * A segment containing `${` becomes DYNAMIC: the value is decided at runtime, so it can stand for a
 * `[param]` but for nothing else. Query and hash are dropped — they do not select a route.
 */
function hrefShape(raw: string): string[] | null {
  if (!raw.startsWith("/")) return null;
  // LOAD-BEARING: the backtick regex stops at a NESTED backtick, so a redirect written with an
  // inner template is captured as a fragment with more openings than closings. Unguarded, one such
  // fragment shape-matched /dictionary/[slug] - a redirect to a STATIC page scoring as a link to a
  // dynamic one.
  const withoutQuery = stripQueryAndHash(raw).replace(/\/$/, "");
  // Checked AFTER the query is stripped, not before. The backtick regex stops at a NESTED backtick,
  // so a redirect written with an inner template is captured as a fragment with more openings than
  // closings, and unguarded one such fragment shape-matched /dictionary/[slug]. But checking before
  // the strip ALSO discarded ordinary hrefs whose only imbalance sat inside a query string this line
  // throws away - a false rejection, and a false rejection accuses working code.
  if ((withoutQuery.match(/\$\{/g) ?? []).length !== (withoutQuery.match(/\}/g) ?? []).length) return null;
  if (withoutQuery === "") return null;
  return withoutQuery
    .split("/")
    .slice(1)
    .map((segment) => (segment.includes("${") ? DYNAMIC : segment));
}

/** An href reaches a route when every segment lines up — same count, same positions. */
function shapeMatches(href: string[], route: string[]): boolean {
  if (href.length !== route.length) return false;
  return route.every((routeSegment, index) => {
    const hrefSegment = href[index];
    if (routeSegment === DYNAMIC) return hrefSegment.length > 0;
    return hrefSegment === routeSegment;
  });
}

function stripComments(source: string): string {
  // ORDER IS LOAD-BEARING, and the first version had it backwards. Stripping BLOCK comments first
  // means a line comment that merely CONTAINS the two characters that open a block comment - a path
  // glob written in a note - opens a block that runs forward to the next closer anywhere in the file.
  // Eleven such lines exist in src/ today; in global-search-shell.tsx the old order destroyed 1,897
  // characters of live JSX, measured. Nothing failed only because no destroyed span happened to hold
  // a route's last link - a coincidence, not a guard, and the defence this file calls load-bearing
  // was quietly its own biggest source of false alarms. Line comments first.
  return source.replace(/^[ \t]*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Cut an href at its query or hash — at the first `?` or `#` sitting at `${}`-DEPTH ZERO.
 *
 * ⚠️ **`split("?")` cuts at the first `?` anywhere, and a `?` is legal inside a `${…}` expression.**
 * A ternary in a template is a query separator to a naive split:
 *
 * ```
 * /documents/${id}${query ? `?${query}` : ""}
 * split("?")[0]  ->  /documents/${id}${query      <- cut inside an open expression
 * ```
 *
 * This mattered only after the template scanner above started capturing whole literals: while the
 * capture truncated at the nested backtick the fragment was already unbalanced, so the naive split
 * changed nothing. **Fixing the scanner is what made this reachable** — which is the more useful
 * half of the lesson: the two defects were sequential, and the second was invisible while the first
 * stood.
 */
function stripQueryAndHash(raw: string): string {
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.startsWith("${", i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (raw[i] === "}" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0 && (raw[i] === "?" || raw[i] === "#")) return raw.slice(0, i);
  }
  return raw;
}

/**
 * Read one template literal starting at `start` (which must index a backtick), returning its body
 * and the index of its closing backtick.
 *
 * ⚠️ **A REGEX CANNOT DO THIS, AND THE REGEX THAT WAS HERE SILENTLY DISCARDED REAL HREFS.**
 * `` /`(\/[^`]*)`/g `` stops at the first backtick it meets — including a backtick that OPENS a
 * nested template inside a `${…}` expression. Measured on
 * `src/components/clinical-dashboard/source-actions.tsx:131`:
 *
 * ```
 * source   `/documents/${encodeURIComponent(sourceId)}${query ? `?${query}` : ""}`
 * captured  /documents/${encodeURIComponent(sourceId)}${query ?          <- stops at the inner tick
 * braces    2 openings, 1 closing  ->  rejected by the balance check below
 * ```
 *
 * **That href points at `/documents/[id]` and was thrown away.** The route stayed green only
 * because four OTHER files happen to link it. Delete those four and it becomes a false orphan while
 * two perfectly good hrefs point straight at it — a coincidence of redundancy, not a guard.
 *
 * Found by Ward Verifier, 2026-09-02, attacking this file on request.
 */
function readTemplateLiteral(source: string, start: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source.startsWith("${", i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (source[i] === "}" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (source[i] === "`") {
      if (depth === 0) return { body: source.slice(start + 1, i), end: i };
      // A backtick at depth > 0 opens a NESTED template. Recurse past it rather than stopping.
      const nested = readTemplateLiteral(source, i);
      if (nested === null) return null;
      i = nested.end;
      continue;
    }
    if (source[i] === "\n" && depth === 0) continue;
  }
  return null;
}

/** Every rooted path written as a quoted string or template literal. */
/**
 * ⚠️ HREFS ASSEMBLED FROM CONSTANTS, WHICH THIS SCAN COULD NOT SEE AND THEREFORE CALLED ORPHANS.
 *
 * Found on the since-retired Caring Contacts workspace: its `patientRoute()` returned
 * `` `${ROUTES.patients}/${encodeURIComponent(id)}` ``, and `ROUTES.patients` was itself
 * `` `${BASE}/patients` ``. So the literal patients path existed NOWHERE in the source, while three
 * real `<Link href={patientRoute(...)}>` controls pointed at the route. The scan reported two reachable
 * routes as unreachable, and the tempting fix — adding them to the exception map — would have
 * recorded a falsehood about the codebase in the one place meant to hold the truth about it.
 *
 * This resolves a bounded set of path constants so a composed href becomes visible: string
 * constants, and object properties whose value is a string or a template over another constant.
 * Iterated to a fixpoint (capped), because the real case is two levels deep.
 *
 * ⚠️ It is deliberately NOT a general evaluator. Anything it cannot resolve stays unresolved and
 * the route stays unmatched, which fails loudly — the safe direction.
 */
function pathConstants(files: readonly { stripped: string }[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  // One regex per quote style rather than one with a backreference: simpler to read, and it keeps
  // every character class free of the escapes that a generator can mangle.
  const declarations = [
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g,
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'([^']*)'/g,
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*`([^`]*)`/g,
  ];
  const memberPairs = [
    /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]*)"/g,
    /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'/g,
    /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*`([^`]*)`/g,
  ];
  const memberAlias = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/g;
  // ⚠️ NOT `[^}]*`: an interpolation such as `${SOME_BASE}` contains a closing brace,
  // so that class truncates the object at its first composed member — which is exactly the
  // member this resolver exists to read. Match lazily to a brace at the start of a line.
  const objects = new RegExp("(?:export\\s+)?const\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*\\{([^]*?)\\n}", "g");
  for (const file of files) {
    for (const pattern of declarations) {
      for (const m of file.stripped.matchAll(pattern)) map.set(m[1], m[2]);
    }
    for (const o of file.stripped.matchAll(objects)) {
      for (const pattern of memberPairs) {
        for (const mem of o[2].matchAll(pattern)) map.set(`${o[1]}.${mem[1]}`, mem[2]);
      }
      for (const mem of o[2].matchAll(memberAlias)) {
        if (!map.has(`${o[1]}.${mem[1]}`)) map.set(`${o[1]}.${mem[1]}`, "${" + mem[2] + "}");
      }
    }
  }
  // Two levels deep is the real case; the cap stops a self-referential pair spinning.
  const reference = /\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;
  for (let pass = 0; pass < 4; pass += 1) {
    for (const [key, value] of map) {
      const next = value.replace(reference, (whole, name: string) => map.get(name) ?? whole);
      if (next !== value) map.set(key, next);
    }
  }
  return map;
}

/**
 * ⚠️ A ROUTE BUILDER'S OWN DEFINITION MUST NOT VOUCH FOR ITS ROUTE, and the first version of this
 * fix let it. The since-retired Caring Contacts workspace's `pathwayRoute()` returned
 * `` `${ROUTES.templates}/${id}` ``, so once
 * constants resolved, the routes module contained a string of the right shape — and the route
 * counted as referenced even with EVERY real `<Link>` to it deleted. Proved by mutation: removing
 * the only inbound link left this file green.
 *
 * So route modules are excluded from the href scan, exactly as fixtures and mockups are and for the
 * same reason — a vocabulary is not navigation — and a builder instead vouches for its route only
 * where it is CALLED. That is a two-part chain: the builder resolves to the route's shape, and some
 * other file invokes it.
 */
const ROUTE_MODULE = /-routes\.ts$/;

function routeBuilders(
  files: readonly { rel: string; stripped: string }[],
  constants: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const builders = new Map<string, string>();
  const declaration = /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*:\s*string\s*\{\s*return\s+`([^`]*)`/g;
  for (const file of files) {
    if (!ROUTE_MODULE.test(file.rel)) continue;
    for (const m of file.stripped.matchAll(declaration)) {
      const body = expandLeadingConstant(m[2], constants);
      if (body.startsWith("/")) builders.set(m[1], body);
    }
  }
  return builders;
}

/** Paths a file vouches for by CALLING a route builder, rather than by writing the path itself. */
function builtHrefsIn(source: string, builders: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const [name, body] of builders) {
    if (new RegExp(String.raw`\b${name}\s*\(`).test(source)) found.push(body);
  }
  return found;
}

const NO_CONSTANTS: ReadonlyMap<string, string> = new Map();

/** Expands a single leading `${CONSTANT}` when it is known, so composed hrefs join the scan. */
function expandLeadingConstant(body: string, constants: ReadonlyMap<string, string>): string {
  const match = new RegExp("^\\$\\{([A-Za-z_][A-Za-z0-9_.]*)\\}").exec(body);
  if (match === null) return body;
  const resolved = constants.get(match[1]);
  return resolved === undefined ? body : resolved + body.slice(match[0].length);
}

function hrefsIn(source: string, constants: ReadonlyMap<string, string> = NO_CONSTANTS): string[] {
  const found: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== "`") continue;
    const literal = readTemplateLiteral(source, i);
    if (literal === null) continue;
    const body = expandLeadingConstant(literal.body, constants);
    if (body.startsWith("/")) found.push(body);
    i = literal.end;
  }
  for (const pattern of [/"(\/[^"\n]*)"/g, /'(\/[^'\n]*)'/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/**
 * Source that may vouch for a route.
 *
 * Mockups are excluded in both directions, matching `route-reachability.test.ts`: a link from
 * design-scratch does not make a production page reachable. Fixtures and demo data are excluded for
 * the same reason one level down — a sample href in a fixture table is an example, not navigation.
 */
const scannedFiles = walk(SRC_DIR)
  .map(toPosix)
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .filter((file) => !/mockup/i.test(file))
  .filter((file) => !/fixture|demo-data/i.test(file))
  .map((file) => ({
    rel: file.slice(toPosix(repoRoot).length + 1),
    stripped: stripComments(readFileSync(file, "utf8")),
    raw: readFileSync(file, "utf8"),
  }));

const PATH_CONSTANTS = pathConstants(scannedFiles);
const ROUTE_BUILDERS = routeBuilders(scannedFiles, PATH_CONSTANTS);

const dynamicRoutes = collectDynamicRoutes();

/**
 * Static production pages.
 *
 * LOAD-BEARING, and the severe defect in this file's first draft. A link to one of these can never
 * render a dynamic sibling: Next.js resolves the static segment first, so `/dictionary/topics`
 * SHADOWS `/dictionary/[slug]`. Such a link is evidence the dynamic route was NOT reached, yet the
 * first draft accepted it as proof that it WAS. Measured: seven of the sixteen were vouched for
 * only this way, `/documents/[id]` and `/formulation/[slug]` among them - deleting every genuine
 * link to those routes left the check green.
 */
/**
 * Static production pages, split by whether they RENDER or REDIRECT.
 *
 * The shadowing rule is: a static segment resolves before its dynamic sibling, so a link to a
 * static page cannot render the dynamic route. That is true of a page that renders its own
 * content, and FALSE of one whose whole body is a `redirect(...)`. `/documents/source` is exactly
 * that - a static page that forwards to `/documents/[id]` and is exported as the canonical reader
 * entry point - so rejecting it would accuse a link that genuinely reaches the route. Shadows-and-
 * renders is evidence against; shadows-and-redirects is evidence for.
 */
const staticPageFiles = walk(APP_DIR)
  .map(toPosix)
  .filter((file) => /\/page\.tsx$/.test(file))
  .map((file) => ({ file, route: routeUrlForFile(file) }))
  .filter((entry) => !entry.route.includes("[") && !entry.route.startsWith("/mockups"));

/**
 * ⚠️ COMMENTS ARE STRIPPED BEFORE THIS REGEX RUNS, AND THE UNSTRIPPED VERSION WAS LIVE-EXPLOITABLE.
 * The render/redirect split below decides whether a link to a static sibling can vouch for a
 * dynamic route (see `vouches`), so a page wrongly classified as "redirects" starts vouching for
 * routes it never reaches. Proved by mutation on real source: with every genuine
 * `` `/formulation/${id}` `` link in src/ disguised as identical-runtime string concatenation
 * (so `hrefsIn` cannot see it), this file correctly reported `/formulation/[slug]` as an orphan.
 * Adding ONE line -- `// this route used to redirect(...) to the mechanism map before the builder
 * shipped its own UI` -- to `src/app/(search-app)/formulation/builder/page.tsx`, a page that
 * genuinely only renders, turned the whole suite green: `redirect(` matched inside the comment,
 * `formulation/builder` flipped into `redirectingStaticRoutes`, and the real (undisguised) link
 * `href: "/formulation/builder"` in `mode-secondary-navigation.ts` started vouching for
 * `/formulation/[slug]` purely because the two share a segment count. `stripAllComments`, not
 * `stripSourceComments`: this check watches for a CODE WRITE (a real `redirect(...)` call), and a
 * trailing `// ... redirect(...)` comment must not count either.
 */
const staticPageSources = new Map(
  staticPageFiles.map((entry) => [entry.file, stripAllComments(readFileSync(entry.file, "utf8"))]),
);

const renderingStaticRoutes = new Set(
  staticPageFiles
    .filter((entry) => !/\bredirect\s*\(/.test(staticPageSources.get(entry.file)!))
    .map((entry) => entry.route),
);

const redirectingStaticRoutes = new Set(
  staticPageFiles
    .filter((entry) => /\bredirect\s*\(/.test(staticPageSources.get(entry.file)!))
    .map((entry) => entry.route),
);

/** Does this href vouch for this route? A link to a shadowing static sibling never does. */
function vouches(href: string, route: string): boolean {
  const bare = stripQueryAndHash(href).replace(/\/+$/, "");
  // Only a RENDERING static page shadows. A redirect-only one forwards to the dynamic route, so a
  // link to it is evidence the route is reached, not evidence against.
  if (renderingStaticRoutes.has(bare)) return false;
  const shape = hrefShape(href);
  return shape !== null && shapeMatches(shape, routeShape(route));
}

/** Routes with no href of matching shape anywhere in the scanned source. */
function orphansUnder(useStripped: boolean): string[] {
  return dynamicRoutes.filter(
    (route) =>
      !scannedFiles.some((file) =>
        (ROUTE_MODULE.test(file.rel)
          ? // ⚠️ A ROUTE MODULE VOUCHES FOR NOTHING AT ALL. It defines the vocabulary and
            // navigates nowhere. Two rounds of mutation were needed to get this right: first
            // its template literal vouched for the route, and when that was excluded its own
            // `export function pathwayRoute(` still matched the builder-CALL check one level
            // up. Both times the route stayed "referenced" with every real link deleted.
            []
          : [
              ...hrefsIn(useStripped ? file.stripped : file.raw, PATH_CONSTANTS),
              ...builtHrefsIn(useStripped ? file.stripped : file.raw, ROUTE_BUILDERS),
            ]
        ).some((href) => vouches(href, route)),
      ),
  );
}

/**
 * ⚠️ ROUTES THAT ARE GENUINELY LINKED AND THAT THIS SCAN CANNOT SEE. These are NOT orphans, and an
 * earlier draft of this file called them that — which would have sent somebody to "wire in" code
 * that is correct and type-checked. The word matters: an entry here is an admission about the
 * instrument, not a defect in the product.
 *
 * Both are reached through `therapyRecordHref(slug, artifact)`
 * (`src/lib/therapy-compass-navigation.ts:150`), called as `openSlug(slug, "brief")` at
 * `src/components/therapy-compass/bindings.tsx:402` and `openSlug(slug, "sheet")` at `:405`.
 *
 * The path is assembled from three pieces — the base constant `THERAPY_COMPASS_BASE`, an encoded
 * slug, and a member of the typed union `"brief" | "sheet"` — so no contiguous literal exists
 * anywhere and no text scan can see it. Shape matching cannot either: the first expression sits at
 * position zero, so the static prefix is empty.
 *
 * ⚠️ THIS PAIR IS THE ACCEPTANCE CASE FOR ANY FUTURE VERSION OF THIS CHECK — a correct link it must
 * not flag. It is also the sharpest available argument that text scanning is the wrong instrument:
 * the only textual trace of either route is a comment at `src/lib/information-pages.ts:75`, so a
 * bare-substring scan gets the RIGHT answer for a reason unrelated to the link, and gets a FALSE
 * ALARM the moment somebody tidies that comment away. There is no state of that comment in which
 * such a scan is reasoning correctly.
 */
/**
 * ⚠️ A LIMIT THIS CHECK DOES NOT CLOSE, stated rather than implied.
 *
 * A route whose only voucher is the BODY of its own href builder passes here while nothing calls
 * that builder. `/factsheets/[slug]` is in exactly that position today: its single match is the
 * return statement inside `factsheetDetailHref`, and its four real call sites write
 * `href={factsheetDetailHref(sheet.slug)}` with no literal for this scan to see. Delete all four and
 * this file stays green while the route becomes unreachable.
 *
 * It is the same mechanism as the exception map below, inverted: a builder that composes
 * non-contiguously is invisible and lands in the map, and one that composes contiguously is visible
 * whether or not anything calls it. Closing it needs call-site resolution, which is a different
 * instrument from text matching. Until then this is coverage the file does not have.
 */
const LINKED_BUT_INVISIBLE_TO_THIS_SCAN: ReadonlyMap<string, string> = new Map([
  [
    "/therapy-compass/[slug]/brief",
    "Linked via therapyRecordHref(slug, 'brief') — bindings.tsx:402. Composed from THERAPY_COMPASS_BASE " +
      "+ encoded slug + a typed union member, so no contiguous literal exists for any scan to match.",
  ],
  [
    "/therapy-compass/[slug]/sheet",
    "Linked via therapyRecordHref(slug, 'sheet') — bindings.tsx:405. Composed the same way; the compiler " +
      "enforces the artifact union, so this is correct code that this instrument cannot observe.",
  ],
]);

describe("production dynamic route reachability", () => {
  it("scanned real routes and real source, so nothing below can pass vacuously", () => {
    // Written out in full rather than counted. A seventeenth production dynamic route arriving here
    // should cost somebody a decision about how its instances are reached, not a number.
    expect([...dynamicRoutes].sort()).toEqual([
      // CME's one entry record. Reached from the log's rows, which build
      // `/cme/log/${entry.id}` — a template literal this scan reads directly.
      "/cme/log/[id]",
      "/dictionary/[slug]",
      "/dictionary/topics/[slug]",
      "/differentials/diagnoses/[slug]",
      "/differentials/presentations/[slug]",
      "/documents/[id]",
      "/dsm/diagnoses/[slug]",
      "/dsm/diagnoses/[slug]/differentials",
      "/factsheets/[slug]",
      "/forms/[slug]",
      "/formulation/[slug]",
      "/medications/[slug]",
      // Open shifts: one advert, and one shift a manager posted. Reached from
      // the Browse, My shifts and Post lists, which build
      // `/open-shifts/shift/${serviceId}/${openShiftId}` and
      // `/open-shifts/post/${serviceId}/${openShiftId}` template literals.
      "/open-shifts/post/[serviceId]/[openShiftId]",
      "/open-shifts/shift/[serviceId]/[openShiftId]",
      "/services/[slug]",
      "/sources/[sourceId]",
      "/specifiers/[slug]",
      // One doctor as their supervisor sees them (work mode, 7 Oct 2026). Reached today from the
      // preview-role switcher's supervisor example in preview-role.ts; it sits behind the launch
      // switch (work-mode-launch/routes.ts).
      "/teaching/assessments/trainee/[id]",
      // Teaching dynamic routes (U7). Reached from device QR/link values built by
      // checkin-token.ts's `checkinScanPath`/`teachingDisplayPath` (not `<a href>`s — a QR code
      // value and a shared-screen link, each scanned or opened outside in-app navigation) and from
      // `<Link>`s built with `/teaching/session/${occurrenceId}` in teaching-view-model.ts,
      // calendar-events.ts, teaching-checkin.tsx and teaching-scan-landing.tsx.
      "/teaching/c/[token]",
      "/teaching/display/[token]",
      // Collection cards in teaching-resources.tsx link to each collection.
      "/teaching/resources/[collectionId]",
      "/teaching/session/[id]",
      "/teaching/session/[id]/check-in",
      "/therapy-compass/[slug]",
      "/therapy-compass/[slug]/brief",
      "/therapy-compass/[slug]/sheet",
    ]);

    // Floored, not pinned: src/ grows for reasons unrelated to routing. But a walk that resolved the
    // wrong root or lost its extension filter returns a handful, and every per-route result below
    // would then read "nothing links this" for reasons having nothing to do with navigation.
    expect(scannedFiles.length).toBeGreaterThan(900);

    // The static set is what stops a shadowing sibling vouching for a dynamic route. If it empties,
    // that guard silently stops applying and the check weakens without ever failing.
    expect(
      renderingStaticRoutes.size,
      "no static production routes found - the shadowing guard is inert",
    ).toBeGreaterThan(20);

    // Extraction must be producing a corpus. Without this, an hrefsIn that matched nothing would
    // leave this test green while every route below reported unmatched for the wrong reason.
    const extracted = scannedFiles.reduce((total, file) => total + hrefsIn(file.stripped, PATH_CONSTANTS).length, 0);
    expect(extracted, "href extraction produced almost nothing - the scan is broken, not the app").toBeGreaterThan(200);

    // ⚠️ A FLOOR DETECTS AN EMPTY SCAN. IT CANNOT DETECT A DIMINISHED ONE, AND DIMINISHMENT IS THE
    // FAILURE THIS FILE ACTUALLY HAD. The `stripComments` ordering bug destroyed 1,897 characters of
    // live JSX in one file and this block stayed green throughout, because thousands-minus-a-few
    // is still far above 200. Ward Verifier found that, 2026-09-02, and it is right.
    //
    // ⚠️ ITS PROPOSED FIX — A RATIO OF STRIPPED HREFS TO RAW HREFS — DOES NOT WORK, AND THE
    // MEASUREMENT IS WHY THIS IS WRITTEN AS AN EQUALITY INSTEAD:
    //
    //     hrefs      correct order 0.7207   broken order 0.7198   discrimination 0.0009
    //     characters correct order 0.79409  broken order 0.79384  discrimination 0.00025
    //
    // The damage is real and it is 3,613 characters inside 14.2 million. No aggregate threshold
    // separates those two numbers, and any bound that did would be tuned so finely it would flake.
    // A PER-FILE loss bound fails for a different reason: legitimate comment-heavy files lose up to
    // 93.4% of their characters (`loading.tsx`), which is far more than the 60.7% the broken order
    // costs the worst-damaged file. The honest reading is that the damaged and the healthy are not
    // separable by any quantity — so do not use one.
    //
    // What IS exact: only 5 files of 1,283 are order-sensitive at all, so comparing the two orders
    // directly is sharp, threshold-free, and names the file. If `stripComments` is ever reordered,
    // this fails immediately and says which file lost code.
    const lineFirst = (source: string) => source.replace(/^[ \t]*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const blockFirst = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
    const orderSensitive = scannedFiles.filter((file) => lineFirst(file.raw) !== blockFirst(file.raw));
    expect(
      orderSensitive.length,
      "no file in src/ is sensitive to comment-strip ORDER, so the comparison below cannot fail. " +
        "Either the tree changed or the strip stopped working; do not delete this — find out which.",
    ).toBeGreaterThan(0);
    const misstripped = scannedFiles.filter((file) => file.stripped !== lineFirst(file.raw)).map((file) => file.rel);
    expect(
      misstripped,
      `stripComments does not match line-comments-first on: ${misstripped.join(", ")}. Block-first ` +
        `lets a line comment CONTAINING a block opener swallow live code to the next closer — ` +
        `measured at 1,897 characters in one file. Fix the order; do not adjust this comparison.`,
    ).toEqual([]);
  });

  it("every production dynamic route is referenced by at least one link in src/ (referenced — NOT proven reachable)", () => {
    const unexplained = orphansUnder(true).filter((route) => !LINKED_BUT_INVISIBLE_TO_THIS_SCAN.has(route));
    expect(
      unexplained,
      `Production dynamic route(s) with no href of matching shape anywhere under src/ — nothing can ` +
        `reach any instance of them. Wire each into real navigation, or add it to LINKED_BUT_INVISIBLE_TO_THIS_SCAN with ` +
        `the reason: ${unexplained.join(", ")}`,
    ).toEqual([]);
  });

  it("LINKED_BUT_INVISIBLE_TO_THIS_SCAN has no entry for a route the scan can now see, or that no longer exists", () => {
    // ⚠️ THE ARITY GUARD LIVES HERE, IN THE BODY THAT LOOPS, NOT IN A NEIGHBOURING TEST.
    //
    // It used to sit in the anti-vacuity block above. A guard in one `it` cannot protect a loop in
    // another: they are separate scopes and separate runs, so emptying the map made THIS test
    // iterate nothing and pass while the guard over there did its job in a test that never looks at
    // the map. Ward Verifier found the identical structure in another chat's file the same evening
    // — two authors, two files, one night — which makes it a pattern rather than a slip:
    // A NON-VACUITY GUARD IS ONLY A GUARD WITHIN ITS OWN TEST BODY.
    //
    // The old cross-cover was luck, not design: emptying the map made the OTHER test start
    // reporting these two as unexplained orphans, so something went red — a different test failing
    // for a different reason, which is the coincidence-not-a-guard shape this file exists to name.
    expect(LINKED_BUT_INVISIBLE_TO_THIS_SCAN.size, "the map is empty, so the loop below asserts nothing").toBe(2);
    const orphans = new Set(orphansUnder(true));
    for (const [route, reason] of LINKED_BUT_INVISIBLE_TO_THIS_SCAN) {
      expect(dynamicRoutes, `${route} is recorded here but is no longer a dynamic route`).toContain(route);
      expect(
        orphans.has(route),
        `${route} is now linked — delete its LINKED_BUT_INVISIBLE_TO_THIS_SCAN entry rather than leaving a false record`,
      ).toBe(true);
      expect(reason.length, `${route} has an empty reason`).toBeGreaterThan(0);
    }
  });

  it("a quoted path written inside a comment never vouches for a route", () => {
    // Unit-tested against synthetic input rather than against the tree, because the tree does not
    // happen to contain this case today and a defence that is currently unexercised must still be
    // shown to work. The first draft of this file asserted the strip mattered HERE and was wrong;
    // the assertion caught it, which is the whole argument for writing it.
    const commented = [
      "// see `/medications/${id}` for the detail route",
      "/* const href = `/services/${slug}`; */",
      "const real = `/factsheets/${slug}`;",
    ].join("\n");

    expect(hrefsIn(commented).sort(), "unstripped, both commented-out paths are read as hrefs").toEqual([
      "/factsheets/${slug}",
      "/medications/${id}",
      "/services/${slug}",
    ]);
    expect(hrefsIn(stripComments(commented)), "stripped, only the real one survives").toEqual(["/factsheets/${slug}"]);
  });

  it("the therapy-compass prose mention is present, and is not what keeps those routes unmatched", () => {
    // A known-positive control: the hazard text really is in the tree, so a later reader does not
    // dismiss the orphan entries as stale. It is bare prose, not a quoted literal, so `hrefsIn` never
    // reads it either way — which is why the orphan set is identical stripped and unstripped. Were
    // the extractor ever loosened to bare substrings, this equality would break and should.
    const informationPages = readFileSync(path.join(SRC_DIR, "lib", "information-pages.ts"), "utf8");
    expect(
      informationPages,
      "the comment this file's LINKED_BUT_INVISIBLE_TO_THIS_SCAN entries cite must still exist",
    ).toContain("therapy-compass/[slug]/brief");
    expect(orphansUnder(true).sort(), "stripped and unstripped agree today: the mention is unquoted").toEqual(
      orphansUnder(false).sort(),
    );
  });

  it("a static sibling that RENDERS never vouches; one that REDIRECTS does", () => {
    // The severe defect in this file's first draft, pinned so it cannot return: a link to a static
    // page that renders its own content is evidence the dynamic sibling was NOT reached, because the
    // static segment resolves first.
    expect(renderingStaticRoutes.has("/dictionary/topics"), "fixture assumption: exists and renders").toBe(true);
    expect(vouches("/dictionary/topics", "/dictionary/[slug]")).toBe(false);
    expect(vouches("/dictionary/${term.slug}", "/dictionary/[slug]")).toBe(true);

    // And the counterexample that made the first version of the guard wrong in the other direction.
    // `/documents/source` is a static page whose whole body is a redirect to `/documents/[id]`, and it
    // is exported as the canonical reader entry point - so a link to it REACHES the dynamic route.
    // Rejecting it would have accused working code, which is the failure mode that matters most here.
    expect(redirectingStaticRoutes.has("/documents/source"), "fixture assumption: exists and redirects").toBe(true);
    expect(vouches("/documents/source", "/documents/[id]")).toBe(true);
  });

  it("a line comment containing a block-comment opener does not swallow the code after it", () => {
    // The defect this file shipped with, pinned as a known-positive control. Stripping BLOCK comments
    // first let the opener inside a line comment start a block that ran to the next closer anywhere in
    // the file - 1,897 characters of live JSX in `global-search-shell.tsx`, measured. Nothing failed
    // only because no destroyed span happened to hold a route's last link. Here the first href sits in
    // exactly such a span, so a regression to the old order deletes it and this test goes red.
    const source = [
      "// hide widths measured against /differentials/diagnoses/* - 137px per hidden control",
      "const detail = `/medications/${record.slug}`;",
      "/* an ordinary block comment, whose closer the fake block above would reach */",
      "const other = `/services/${record.slug}`;",
    ].join("\n");

    expect(hrefsIn(stripComments(source)).sort()).toEqual(["/medications/${record.slug}", "/services/${record.slug}"]);
  });

  it("a fragment left by a nested template literal is not read as an href", () => {
    expect(hrefShape("/dictionary/search${suffix ? ")).toBeNull();
    expect(hrefShape("/dictionary/${slug}")).toEqual(["dictionary", DYNAMIC]);
  });

  it("⚠️ an href whose template contains a NESTED template is captured whole, not truncated", () => {
    // The input is `src/components/clinical-dashboard/source-actions.tsx:131` verbatim. Under the
    // old regex-based extractor it captured as far as the inner backtick —
    //   /documents/${encodeURIComponent(sourceId)}${query ?
    // — which carries two `${` openings against one `}` closing and was therefore thrown away by
    // hrefShape's balance check. A real link to /documents/[id], discarded in silence.
    //
    // ⚠️ THIS INPUT DISCRIMINATES. Under the old extractor the first expectation yields
    // ["/documents/${encodeURIComponent(sourceId)}${query ? "] and the second yields null; under
    // the scanner both are as written below. A regression test whose input passes either way would
    // prove nothing, which is the defect this whole file is about.
    const source = 'return `/documents/${encodeURIComponent(sourceId)}${query ? `?${query}` : ""}`;';
    expect(hrefsIn(source)).toEqual(['/documents/${encodeURIComponent(sourceId)}${query ? `?${query}` : ""}']);
    expect(hrefShape(hrefsIn(source)[0])).toEqual(["documents", DYNAMIC]);
  });

  it("⚠️ a query is cut at a `?` outside an expression, never at one inside a ternary", () => {
    // Reachable only because the scanner above now captures whole templates: while the capture
    // truncated at the nested backtick the fragment was already unbalanced, so a naive split
    // changed nothing. The two defects were sequential and the second was invisible while the
    // first stood.
    expect(hrefShape('/documents/${id}${q ? `?${q}` : ""}')).toEqual(["documents", DYNAMIC]);
    // A real separator, at depth zero, still cuts.
    expect(hrefShape("/documents/${id}?page=${n}")).toEqual(["documents", DYNAMIC]);
    // And a hash at depth zero still cuts, so a fragment link cannot invent a segment.
    expect(hrefShape("/documents/${id}#pdf-preview-section")).toEqual(["documents", DYNAMIC]);
  });

  it("prefix matching would swallow both invisible routes, which is why shape matching is used", () => {
    // The cheap design: truncate a route at its first `[` and ask whether that prefix appears.
    // `/therapy-compass/[slug]/brief` truncates to `/therapy-compass/`, satisfied by the existing
    // `/therapy-compass/${record.slug}` — so the cheap version reports nothing unmatched and is green
    // exactly where the defect is. Pinned so nobody simplifies this back.
    const prefixOf = (route: string) => route.split("/[")[0] + "/";
    const prefixCovered = (route: string) =>
      scannedFiles.some((file) => hrefsIn(file.stripped).some((href) => href.startsWith(prefixOf(route))));

    for (const orphan of LINKED_BUT_INVISIBLE_TO_THIS_SCAN.keys()) {
      expect(
        prefixCovered(orphan),
        `${orphan} is invisible to this scan, yet PREFIX matching would have passed it — this is the trap`,
      ).toBe(true);
      expect(orphansUnder(true), `${orphan} must still be an orphan under shape matching`).toContain(orphan);
    }
  });
});
