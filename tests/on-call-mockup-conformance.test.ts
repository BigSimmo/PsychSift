import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The gate that stops the On Call build drifting from the drawing.
 *
 * Eleven phone artboards were drawn for this mode and committed at
 * `docs/on-call/design/prototypes/on-call-screens.html`. A mockup consulted
 * once and then left behind is how a build drifts without anyone noticing:
 * each departure looks reasonable on its own, and the accumulated result is a
 * page nobody drew. So the drawing is not the record — the LEDGER is, and this
 * test keeps the two in step.
 *
 * It follows `tests/mode-nav-contract.test.ts`'s idiom of parsing a committed
 * markdown table literally: the table is the contract, and a row that stops
 * being true fails here rather than shipping.
 *
 * It deliberately does NOT try to diff pixels or DOM. It asserts the weaker,
 * checkable thing: every board in the drawing is accounted for, every element
 * row carries one of three dispositions, every `built` claim names a testid
 * that really exists in the source, and every deliberate departure carries its
 * reason in writing.
 */
const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const MOCKUP_PATH = "docs/on-call/design/prototypes/on-call-screens.html";
const LEDGER_PATH = "docs/on-call/design/mockup-conformance.md";
/** The browser spec that renders the boards and asserts them on a real page. */
const BOARD_SPEC_PATH = "tests/ui-on-call-boards.spec.ts";

/**
 * The four dispositions an element may carry. Anything else is a typo, not a
 * decision. `open` is the only one that is a promise rather than a record: it
 * marks an element inside change A's scope that is accounted for but not yet
 * written, and it must name the plan step that will close it.
 */
const DISPOSITIONS = ["built", "open", "deviation", "change-b"] as const;

/** Boards as the drawing itself names them: "01 Home" … "11 Logistics". */
function boardsFromMockup(html: string): string[] {
  const matches = [...html.matchAll(/<span class="board-no">(\d+)<\/span>\s*<h2 class="board-title">([^<]+)<\/h2>/g)];
  return matches.map((match) => `${match[1]} ${match[2].trim()}`);
}

type LedgerRow = {
  board: string;
  element: string;
  disposition: string;
  where: string;
  note: string;
  line: number;
};

/**
 * Reads the ledger's one table. Header and separator rows are dropped by
 * requiring five cells and rejecting the separator's dashes, so a reformat by
 * Prettier cannot change what this sees.
 */
function ledgerRows(markdown: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  markdown.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) return;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 5) return;
    if (cells[0] === "Board") return;
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) return;
    rows.push({
      board: cells[0],
      element: cells[1],
      disposition: cells[2],
      where: cells[3],
      note: cells[4],
      line: index + 1,
    });
  });
  return rows;
}

/**
 * Every identifier the two component trees can actually put in the DOM.
 *
 * Deliberately wider than `data-testid=` alone: several of these testids reach
 * the DOM through a prop (`<HomeModule id="on-call-home-recent">` sets its own
 * `data-testid` from `id`), so matching only the attribute would call a built
 * module unproven.
 *
 * A template literal becomes a pattern rather than a prefix string. An earlier
 * version recorded the static text before the first `${` and prefix-matched
 * it, which was worthless: `on-call-${view}-main` reduced to "on-call-" and
 * then vouched for every claim in the ledger. Interpolations become
 * `[a-z0-9-]*` — a star, not a plus, so the ledger may cite the stable stem of
 * a per-entry testid without inventing a slug.
 *
 * The stem before the first interpolation is kept too, so a two-interpolation
 * testid (`on-call-playbook-step-${slug}-${order}`) can still be cited by the
 * part that is stable. That is the concession that reopened the hole above, so
 * it carries a floor: a stem shorter than `STEM_FLOOR` is discarded, which is
 * what keeps the bare "on-call-" out.
 */
const STEM_FLOOR = 15;
function testIdMatchers(): { literals: Set<string>; patterns: RegExp[]; stems: string[] } {
  const literals = new Set<string>();
  const patterns: RegExp[] = [];
  const stems = new Set<string>();
  // `on-call/now` is read alongside the top-level folder because board 01
  // Home IS Now (v6 rebuild, plan C25): its safety-order modules — the
  // hospital line's emergency pin, Right now, the footer group — are its own
  // testids, and a `built` claim about the page a reader actually opens
  // should be provable, not routed around as a `deviation` the way
  // `on-call-home-recent` was before this folder was read.
  for (const dir of ["src/components/on-call", "src/components/on-call/now", "src/components/mode-nav"]) {
    for (const file of readdirSync(new URL(`../${dir}`, import.meta.url))) {
      if (!/\.tsx?$/.test(file)) continue;
      const source = read(`${dir}/${file}`);
      for (const match of source.matchAll(/["']((?:on-call|mode-nav)[a-z0-9-]*)["']/g)) {
        literals.add(match[1]);
      }
      for (const match of source.matchAll(/`((?:on-call|mode-nav)[^`]*)`/g)) {
        const body = match[1];
        if (!body.includes("${")) {
          literals.add(body);
          continue;
        }
        patterns.push(new RegExp(`^${body.replace(/\$\{[^}]*\}/g, "[a-z0-9-]*")}$`));
        const stem = body.slice(0, body.indexOf("${"));
        if (stem.length >= STEM_FLOOR) stems.add(stem);
      }
    }
  }
  return { literals, patterns, stems: [...stems] };
}

const mockup = read(MOCKUP_PATH);
const ledger = read(LEDGER_PATH);
const boards = boardsFromMockup(mockup);
const rows = ledgerRows(ledger);

describe("On Call mockup conformance ledger", () => {
  it("reads eleven boards out of the drawing", () => {
    // A guard on the parser itself: if the HTML's board markup changes shape,
    // every other assertion here would pass vacuously against an empty list.
    expect(boards).toHaveLength(11);
    expect(boards[0]).toBe("01 Home");
    expect(boards.at(-1)).toBe("11 Logistics");
  });

  it("finds element rows in the ledger", () => {
    expect(rows.length).toBeGreaterThan(60);
  });

  it("accounts for every board the drawing contains", () => {
    const covered = new Set(rows.map((row) => row.board));
    for (const board of boards) {
      expect(covered.has(board), `board "${board}" is drawn but has no ledger row`).toBe(true);
    }
  });

  it("names no board the drawing does not contain", () => {
    // The other direction, and the one that catches a renamed or deleted
    // artboard: a ledger row about a board nobody drew is a stale record.
    const drawn = new Set(boards);
    for (const row of rows) {
      expect(
        drawn.has(row.board),
        `ledger line ${row.line} names board "${row.board}", which is not in the drawing`,
      ).toBe(true);
    }
  });

  it("gives every element exactly one of the three dispositions", () => {
    for (const row of rows) {
      expect(
        (DISPOSITIONS as readonly string[]).includes(row.disposition),
        `ledger line ${row.line} ("${row.element}") has disposition "${row.disposition}"`,
      ).toBe(true);
    }
  });

  it("makes every deliberate departure state its reason", () => {
    // The whole value of a `deviation` row is the sentence saying why the
    // drawing was not followed. Without it the row is indistinguishable from
    // something that was simply forgotten.
    for (const row of rows.filter((candidate) => candidate.disposition === "deviation")) {
      expect(
        row.note.length,
        `ledger line ${row.line} ("${row.element}") is a deviation with no reason`,
      ).toBeGreaterThan(15);
    }
  });

  it("proves every built claim against a testid that exists", () => {
    const { literals, patterns, stems } = testIdMatchers();
    for (const row of rows.filter((candidate) => candidate.disposition === "built")) {
      const cited = row.where.replace(/`/g, "").trim();
      const exists = literals.has(cited) || patterns.some((pattern) => pattern.test(cited)) || stems.includes(cited);
      expect(exists, `ledger line ${row.line} claims "${cited}" is built, but no component declares that testid`).toBe(
        true,
      );
    }
  });

  it("backs the built claims with a spec that opens the page in a browser", () => {
    // The ceiling on everything above, named in review: a testid can exist in
    // source and never render — dead code, or a branch nothing reaches — and
    // every assertion in this file would still pass. So the ledger is not the
    // last word on "built": `ui-on-call-boards.spec.ts` opens each board at the
    // width it was drawn at and asserts the element is really on the screen.
    //
    // This pins that the spec exists, covers every board, and is actually
    // asserting the elements rather than merely loading the routes. It cannot
    // verify each row one-for-one — an element can be covered by an assertion
    // that never names its testid — but it does make a boards spec that quietly
    // stops covering a board fail here.
    const spec = read(BOARD_SPEC_PATH);
    for (const board of boards) {
      const number = board.slice(0, 2);
      const drawnHere = rows.filter((row) => row.board === board);
      const needsBrowserProof = drawnHere.some((row) => row.disposition === "built");
      if (!needsBrowserProof) continue;
      expect(
        spec.includes(`test.describe("${number} `) || spec.includes(`${number} ${board.slice(3)}`),
        `board "${board}" has built elements but ${BOARD_SPEC_PATH} never opens it`,
      ).toBe(true);
    }
  });

  it("asserts the load-bearing testids in the browser, not only in source", () => {
    // The elements most easily faked by a source-only check: a module that
    // renders empty, a marker on a branch nobody reaches, a control in a sheet
    // that never opens. Each is named in the browser spec, so a regression that
    // stops it rendering fails there rather than passing here.
    const spec = read(BOARD_SPEC_PATH);
    const loadBearing = [
      // Board 01 Home is Now (v6 rebuild, plan C25): the tile grid, Call first,
      // the ward strip and the pinned reminder left the page, so their testids
      // no longer belong here — these are Now's own safety-order modules.
      "on-call-now-hospital",
      "on-call-now-emergency",
      "on-call-now-right-now",
      "on-call-now-footer",
      // Coming up (`on-call-home-upcoming`) left the On Call boards when
      // `/on-call/education` hard-redirected to Teaching Week — see the
      // deviation rows in mockup-conformance.md.
      "on-call-page-menu-trigger",
      "on-call-page-menu-order",
      "on-call-contacts-group-needs-checking",
      // The groups the removed chip rows became. Both pages were flat lists
      // whose only navigation was a chip row; if these stopped rendering, the
      // header's jump list would quietly have nothing to offer on them.
      "on-call-referrals-group-",
      "on-call-orientation-group-",
      "on-call-private-flag",
      "on-call-playbook-group-no-guideline",
      // "on-call-logistics-private-note" stood here until Admin update 1
      // (Task 1, 2026-09-26) moved board 11's content to Admin > Help
      // (`/admin/help`): every element that board drew is now a `deviation`
      // row in `docs/on-call/design/mockup-conformance.md`, so this file no
      // longer needs a browser proof for it. Admin's own build owns proving
      // its rows render, not On Call's board ledger.
      "on-call-orientation-checklist-",
      // The second header row. It replaced the shared rail, then came back AS a
      // bar — pointed at this page's groups rather than at the mode's routes.
      // `mode-nav-sheet` stood here while On Call mounted the mode's own rail;
      // a load-bearing entry for a component this mode never renders would have
      // gone on passing forever, which is why these are the mode's own testids.
      "on-call-section-detail-header",
      "on-call-section-section-rail",
      // The page's actions moved to the universal header's trailing slot when
      // the pill took over naming the page, so there is no second ellipsis to
      // assert — `on-call-page-menu-trigger` above is now the only one.
    ];
    for (const testId of loadBearing) {
      expect(spec.includes(testId), `${BOARD_SPEC_PATH} never asserts "${testId}" on a rendered page`).toBe(true);
    }
    // And each of those must be a `built` claim in the ledger, so the two
    // records cannot describe different screens.
    const builtIds = new Set(
      rows.filter((row) => row.disposition === "built").map((row) => row.where.replace(/`/g, "").trim()),
    );
    for (const testId of loadBearing) {
      expect(
        [...builtIds].some((id) => id === testId || id.startsWith(testId)),
        `${testId} is asserted in the browser but not recorded as built`,
      ).toBe(true);
    }
  });

  it("catches a built claim whose component does not exist", () => {
    // The guard on the guard. The check above is only worth running if a false
    // claim actually fails it, and its first version did not.
    const { literals, patterns, stems } = testIdMatchers();
    for (const invented of ["on-call-nothing-declares-this", "on-call-", "mode-nav-invented"]) {
      const matched =
        literals.has(invented) || patterns.some((pattern) => pattern.test(invented)) || stems.includes(invented);
      expect(matched, `"${invented}" must not vouch for anything`).toBe(false);
    }
  });

  it("points every deferred element at change B", () => {
    for (const row of rows.filter((candidate) => candidate.disposition === "change-b")) {
      expect(row.where.length, `ledger line ${row.line} defers to change B without naming its step`).toBeGreaterThan(2);
    }
  });

  it("makes every open element name the step that will close it", () => {
    for (const row of rows.filter((candidate) => candidate.disposition === "open")) {
      expect(row.where.length, `ledger line ${row.line} is open with no plan step named`).toBeGreaterThan(2);
    }
  });
});
