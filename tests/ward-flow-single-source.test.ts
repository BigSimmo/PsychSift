import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const WARD_DIR = "src/components/ward-management";

/**
 * Scope for the `NOW_ANCHOR` read-restriction rule. Task 6 fix round 4: widened from `WARD_DIR`
 * after fix round 3's guard was proven to check only reads inside
 * `src/components/ward-management` while its own test name claimed "every read of NOW_ANCHOR" —
 * a probe file at `src/lib/ward-probe/frozen.ts` (outside `WARD_DIR`, deleted after proving the
 * point) named-imported `NOW_ANCHOR` and the fix-round-3 suite stayed fully green. The repo has
 * roughly 200 modules under `src/lib` alone, so a ward screen importing a time helper from
 * outside `WARD_DIR` is an ordinary shape, not an exotic one. The fixture-import rule below
 * (`ALLOWED`) stays scoped to `WARD_DIR` — only the `NOW_ANCHOR` rule widens.
 */
const SRC_DIR = "src";

/** Files allowed to read the frozen fixture: the seed itself, and derivations that take it as a
 *  default parameter. Everything else must read the provider, or two surfaces will disagree.
 *  Scoped to `WARD_DIR`, not `SRC_DIR` — the fixture only ever needs importing from within the
 *  ward-management feature, so bare basenames are unambiguous here and this rule is unchanged
 *  from fix round 3. */
const ALLOWED = new Set(["ward-movements.ts", "ward-flow-reducer.ts", "ward-pressure.ts", "ward-derivations.ts"]);

/**
 * Files allowed to read `NOW_ANCHOR` anywhere under `SRC_DIR` — Task 6 fix round 4, widening fix
 * round 3's rule (which was scoped only to `WARD_DIR` despite its test name claiming "every
 * read"). Keys are full paths from the repo root with forward slashes, not bare basenames: across
 * the whole of `src` a bare basename can collide with an unrelated same-named file elsewhere in
 * the tree, which would silently exempt it. `readsNowAnchor` below parses each candidate file
 * with the TypeScript compiler's own parser and walks the resulting AST for a real identifier
 * reference, so it catches every reading form (named import, namespace-qualified property
 * access, bare re-export) without needing a separate regex per form, and without being fooled by
 * a comment or string that merely mentions the name.
 *
 * Verified by hand (`grep -rln "NOW_ANCHOR" src`, Task 6 fix round 4) before writing this list:
 * six files under `src` mention the string `NOW_ANCHOR` at all, but three of those — `ward-derivations.ts`,
 * `ward-flow-reducer.ts`, and `coordinator-screen.tsx` — only name it in a comment (confirmed by
 * inspecting each match with context, and re-confirmed in fix round 5 against the AST-based
 * scanner below). These three are the only files anywhere under `src` with a real (non-comment,
 * non-string) read of the identifier.
 */
const NOW_ANCHOR_ALLOWLIST = new Set([
  "src/components/ward-management/ward-sites.ts", // declares the constant and uses it to build the fixture's capacity timestamps
  "src/components/ward-management/ward-movements.ts", // the movement fixture; every synthetic timestamp derives from it
  "src/components/ward-management/ward-flow-provider.tsx", // the provider, which reads it once to derive the live `now`
]);

/**
 * Normalises a walked path to forward-slash form so it can be compared against the
 * forward-slash keys in `NOW_ANCHOR_ALLOWLIST`. `walk` below builds paths with `node:path`'s
 * `join`, which emits backslashes on Windows — comparing those raw against forward-slash keys
 * would never match, silently exempting nothing (failing the whole suite on every legitimate
 * reader) or, if the comparison were ever inverted by mistake, silently exempting everything.
 */
function normalizePath(file: string): string {
  return file.split("\\").join("/");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/**
 * `.tsx` alone left the `.ts` entries in `ALLOWED` inert, and let a `.ts` module reintroduce a
 * direct fixture import completely unseen by this test (Task 6 review of the brief's own draft).
 * Scanning both extensions keeps every name in `ALLOWED` doing real work, and the zero-match
 * guard below stops a typo'd directory constant from silently passing with nothing scanned at all.
 */
function isScannable(file: string): boolean {
  return file.endsWith(".tsx") || file.endsWith(".ts");
}

/**
 * A source-tree file, read once and cached: `file` is the raw walked path (backslashes on
 * Windows, exactly as `ALLOWED`'s basename lookup and the AST helpers below expect), and
 * `normalizedFile` is the forward-slash form `NOW_ANCHOR_ALLOWLIST` and the `WARD_DIR` prefix
 * filter compare against.
 */
interface ScannedFile {
  readonly file: string;
  readonly normalizedFile: string;
  readonly source: string;
}

/**
 * Task 6A fix round 2 (performance): every rule below used to independently call `walk(SRC_DIR)`
 * and `readFileSync` each of the ~896 scannable files under `src` — five separate full-tree
 * walks and reads across this file's nine tests (measured before this round: 61.19s total, one
 * test timing out past the 30s per-test ceiling). None of that redundancy was buying extra
 * safety: every rule's own pre-filter (a substring check, or `NOW_ANCHOR_ALLOWLIST`/`ALLOWED`
 * membership) still runs exactly as before, unchanged, against the same in-memory content — this
 * is a single shared read, not a weaker scan.
 *
 * `srcDirFiles()` walks `SRC_DIR` and reads every scannable file exactly once, then caches the
 * result for the lifetime of this module (a single test-file process). `wardDirFiles()` does not
 * re-walk the tree: `WARD_DIR` (`src/components/ward-management`) is a subdirectory of `SRC_DIR`,
 * so its file set is derived by filtering the already-read `srcDirFiles()` list on the
 * `WARD_DIR/` path prefix — this is the same file set `walk(WARD_DIR)` would produce, not a
 * narrower or wider one, because `SRC_DIR`'s walk already visited every file under `WARD_DIR`.
 * The scope each rule enforces is unchanged: the fixture-import rule still only ever sees
 * `wardDirFiles()`, and the `NOW_ANCHOR`/`ED_ACCESS_TARGET_MINUTES` rules still only ever see the
 * full `srcDirFiles()`. Do not unify those call sites — only the underlying I/O is shared.
 */
let srcDirFilesCache: ScannedFile[] | undefined;
function srcDirFiles(): ScannedFile[] {
  if (!srcDirFilesCache) {
    srcDirFilesCache = walk(SRC_DIR)
      .filter(isScannable)
      .map((file) => ({ file, normalizedFile: normalizePath(file), source: readFileSync(file, "utf8") }));
  }
  return srcDirFilesCache;
}

let wardDirFilesCache: ScannedFile[] | undefined;
function wardDirFiles(): ScannedFile[] {
  if (!wardDirFilesCache) {
    const prefix = `${normalizePath(WARD_DIR)}/`;
    wardDirFilesCache = srcDirFiles().filter((entry) => entry.normalizedFile.startsWith(prefix));
  }
  return wardDirFilesCache;
}

/**
 * True for any real read of `NOW_ANCHOR` — a named import, a namespace-qualified property access
 * (`sites.NOW_ANCHOR`), or a bare use of the identifier — never for a mention inside a comment or
 * a string literal.
 *
 * Task 6 fix round 5: the previous implementation (`stripCommentsAndStrings`, deleted) was a
 * hand-rolled character-by-character scanner with no concept of a regex literal. A quote
 * character inside a `/…/` regex opened a phantom string that desynced the scanner's comment and
 * string tracking for the rest of the file, making every later line invisible to the identifier
 * scan — reproduced by hand against `src/components/clinical-dashboard/search-utils.ts:331`
 * (`/"[^"]+"|(?:^|\s)'[^']+'(?=\s|$)/`) and `src/lib/document-summary-badges.ts:61` (a regex with
 * an apostrophe inside a character class): appending a real `NOW_ANCHOR` import after either
 * regex left the suite fully green. Teaching the scanner to recognise regex literals was
 * rejected — telling a regex literal from a division operator requires knowing the preceding
 * token, which is exactly why ad-hoc JavaScript scanners get this wrong, and a heuristic here
 * would only have bought a fourth version of the same overclaim.
 *
 * Instead this walks the real AST that the TypeScript compiler itself parses `.ts`/`.tsx` files
 * into (`typescript`, already a repo dependency — it is what `tsc` runs on): every `Identifier`
 * node named `NOW_ANCHOR` is a real reference (import specifier, property access, or plain use),
 * because comment text is trivia attached to token positions rather than a node the walk ever
 * visits, and the contents of a string or template literal are `StringLiteral`/template nodes,
 * never `Identifier` nodes. Comments and strings are excluded by construction, not by a second
 * regex layered on top of the first mistake. A cheap `source.includes("NOW_ANCHOR")` pre-filter
 * runs first so the parser is only invoked for files that could possibly match — verified by
 * hand (`grep -rln "NOW_ANCHOR" src`) that only six files under `src` contain the substring at
 * all, so this discards essentially the whole tree before any parsing happens.
 */
function readsNowAnchor(source: string, fileName: string): boolean {
  if (!source.includes("NOW_ANCHOR")) return false;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === "NOW_ANCHOR") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Task 6A Minor 1 (fix round 1): `ED_ACCESS_TARGET_MINUTES` (`ward-model.ts`) is the emergency
 * department's access target (four hours when this guard was written; the product owner
 * superseded that figure to 24 hours on 2026-08-22 — see the constant's own doc comment) — a
 * departmental performance measure counted UP from `openedAt`. Its own doc comment forbids it
 * from ever touching a `LegalForm`, gaining a
 * `dueAt`, or feeding a legal-breach count, but Task 6A only pinned its numeric value
 * (`tests/ward-model.test.ts`). Nothing structural stopped a later change — Task 11's emergency
 * department screen is the first real consumer — from wiring it back onto a legal form, which is
 * exactly the mistake Task 6A exists to undo. The two checks below give that prohibition a shape
 * that can actually fail, mirroring the `NOW_ANCHOR` read-restriction rule above rather than only
 * pinning a value.
 *
 * Scope, named precisely after fix round 2: a reviewer probed twelve construction shapes and
 * confirmed every one of the following evades both checks below whenever the consuming file does
 * not also spell out a fresh `{code, label, kind}` object literal. These two checks are a
 * tripwire for the naive, direct case only — real value, but not a data-flow analysis — and they
 * cannot see:
 *   - an intermediate local variable holding the constant before it reaches `dueAt`
 *   - an aliased import (`import { ED_ACCESS_TARGET_MINUTES as target }`)
 *   - a spread construction (`{ ...base, dueAt }`)
 *   - a helper function in another file that builds the `dueAt` value
 *   - direct mutation (`legalForm.dueAt = ED_ACCESS_TARGET_MINUTES`) after construction
 * Closing these was deliberately ruled out: it is a type-checker's job, it was already rejected
 * for the sibling `NOW_ANCHOR` guard above, and chasing it is exactly how this file grew a
 * scanner that took five fix rounds to get right (see `readsNowAnchor`'s doc comment). Task 11's
 * emergency department screen is this constant's only real consumer, and will very likely derive
 * its `dueAt` from an existing movement rather than author a fresh `LegalForm` literal — i.e.
 * exactly the shape these two checks cannot see. Enforcement for that shape is Task 11's brief
 * and its review to carry, not this file's; that is why the two tests below are named for the
 * literal case they actually catch, not for the constant's reach in general.
 */
const LEGAL_FORM_REQUIRED_FIELDS = ["code", "label", "kind"];

/**
 * True if the file contains an object literal shaped like a `LegalForm` construction — carrying
 * all three of `LegalForm`'s required fields (`code`, `label`, `kind`; `ward-model.ts`) on the
 * same object literal. This matches every real `LegalForm` construction without needing the type
 * checker, and is specific in practice, not just in theory: verified by hand (this same
 * AST-walk, run standalone against all of `SRC_DIR`) that exactly two files anywhere under `src`
 * match this shape — `ward-movements.ts` (the fixture) and `ward-flow-reducer.ts` (the only
 * place that produces one at runtime) — both genuine `LegalForm` sites, zero false positives.
 */
function constructsLegalForm(source: string, fileName: string): boolean {
  if (!LEGAL_FORM_REQUIRED_FIELDS.every((name) => source.includes(name))) return false;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set(
        node.properties
          .map((prop) => (prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined))
          .filter((name): name is string => name !== undefined),
      );
      if (LEGAL_FORM_REQUIRED_FIELDS.every((name) => names.has(name))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * True for any real read of `ED_ACCESS_TARGET_MINUTES` anywhere in the file — the same
 * AST-identifier approach as `readsNowAnchor` above, for the same reason: a plain substring match
 * would also fire on a comment or string that merely mentions the name.
 */
function referencesEdAccessTarget(source: string, fileName: string): boolean {
  if (!source.includes("ED_ACCESS_TARGET_MINUTES")) return false;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === "ED_ACCESS_TARGET_MINUTES") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * True if any `dueAt` property's initializer expression anywhere in the file references
 * `ED_ACCESS_TARGET_MINUTES` — a narrower, independent check that does not require the enclosing
 * object literal to also carry `code`/`label`/`kind`, so a partial or spread construction the
 * field-triple check above would miss still cannot smuggle the value through.
 */
function assignsDueAtFromEdAccessTarget(source: string, fileName: string): boolean {
  if (!source.includes("dueAt") || !source.includes("ED_ACCESS_TARGET_MINUTES")) return false;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const initializerReferencesConstant = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === "ED_ACCESS_TARGET_MINUTES") return true;
    return Boolean(ts.forEachChild(node, initializerReferencesConstant));
  };

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "dueAt") {
      if (initializerReferencesConstant(node.initializer)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("one source of truth", () => {
  it("scans a non-empty set of ward-management source files", () => {
    // A test that can vacuously pass because its own file list came back empty is a test that
    // cannot fail — guard against WARD_DIR ever silently resolving to nothing scannable.
    const scanned = wardDirFiles();
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("has no component reading the frozen fixture directly", () => {
    const offenders = wardDirFiles()
      .filter(({ file }) => !ALLOWED.has(file.split(/[\\/]/).pop()!))
      .filter(({ source }) => /from "[^"]*ward-movements"/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("no longer exports a stage summary frozen at import time", () => {
    const source = readFileSync(join(WARD_DIR, "ward-derivations.ts"), "utf8");
    expect(source).not.toMatch(/export const movementStageSummary/);
  });

  /**
   * Task 6 fix round 4: the fix-round-3 guard scanned only `WARD_DIR` while its test name claimed
   * to restrict "every read" of `NOW_ANCHOR` — a file placed anywhere else under `src` (proven
   * with a probe at `src/lib/ward-probe/frozen.ts`) could import the frozen epoch and this suite
   * stayed green. This test is scoped to `SRC_DIR`, the whole source tree, so a reader placed in
   * any module — ward-management or not — is caught.
   */
  it("scans a non-empty set of src source files for the NOW_ANCHOR allow-list check", () => {
    // Same failure mode as the fixture-import guard above, checked again here rather than only
    // relied upon there: this specific check must not be able to pass by scanning nothing.
    const scanned = srcDirFiles();
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("restricts every read of NOW_ANCHOR under src to the named allow-list", () => {
    const offenders = srcDirFiles()
      .filter(({ normalizedFile }) => !NOW_ANCHOR_ALLOWLIST.has(normalizedFile))
      .filter(({ file, source }) => readsNowAnchor(source, file))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("ED access target stays quarantined from the legal clock (Task 6A Minor 1)", () => {
  it("detects a real LegalForm construction, so the field-triple predicate cannot pass vacuously", () => {
    // Guards the two checks below against passing only because they never actually matched
    // anything: proves `constructsLegalForm` fires on a known-real construction (the fixture)
    // before trusting it to fire on a hypothetical bad one.
    const file = join(WARD_DIR, "ward-movements.ts");
    expect(constructsLegalForm(readFileSync(file, "utf8"), file)).toBe(true);
  });

  it("scans a non-empty set of src source files for the ED access target checks", () => {
    // Same failure mode as the other scans in this file, checked again here rather than only
    // relied upon there: these two checks must not be able to pass by scanning nothing.
    const scanned = srcDirFiles();
    expect(scanned.length).toBeGreaterThan(0);
  });

  // Direct/literal case only (see the scope comment above `LEGAL_FORM_REQUIRED_FIELDS`): fires
  // when a file spells out a fresh `{code, label, kind}` object literal AND references
  // `ED_ACCESS_TARGET_MINUTES` anywhere in that same file. It cannot see the constant reaching a
  // `LegalForm` through an intermediate variable, an aliased import, a spread, a helper in
  // another file, or direct mutation — Task 11's brief and review carry those shapes.
  it("never lets a file with a direct {code, label, kind} LegalForm literal also reference ED_ACCESS_TARGET_MINUTES", () => {
    const offenders = srcDirFiles()
      .filter(({ file, source }) => constructsLegalForm(source, file) && referencesEdAccessTarget(source, file))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  // Direct/literal case only (see the scope comment above `LEGAL_FORM_REQUIRED_FIELDS`): fires
  // when a `dueAt` property's initializer expression directly references
  // `ED_ACCESS_TARGET_MINUTES`. It cannot see the same indirections listed above — an
  // intermediate variable, an aliased import, a spread, a helper in another file, or direct
  // mutation after construction — Task 11's brief and review carry those shapes.
  it("never assigns dueAt: ED_ACCESS_TARGET_MINUTES as a direct property initializer", () => {
    const offenders = srcDirFiles()
      .filter(({ file, source }) => assignsDueAtFromEdAccessTarget(source, file))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
