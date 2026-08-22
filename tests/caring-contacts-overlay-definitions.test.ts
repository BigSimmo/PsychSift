import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MUTATING_OVERLAY_IDS,
  overlayDefinition,
  WORKSPACE_OVERLAY_DEFINITIONS,
  type OverlayDesktopModality,
  type OverlayDismissal,
  type OverlayPhoneModality,
} from "@/components/caring-contacts/workspace/overlays/definitions";

import { CARING_CONTACTS_PROHIBITED_LANGUAGE } from "./helpers/caring-contacts-prohibited-language";

const MATRIX_PATH = "docs/caring-contacts/interaction-matrix.md";

/**
 * The matrix document holds human prose (`Full-screen stage`); the definition
 * table holds the kebab-case union member (`full-screen-stage`). These hand
 * written lookups are the only bridge between the two, and they are deliberately
 * total: an unmapped cell throws and names the row and the offending value.
 *
 * Do NOT replace them with a lowercase-and-hyphenate transform. That would map a
 * corrupted matrix cell onto a plausible-looking value and the frozen record
 * would stop being checked at all.
 */
const PHONE_MODALITY_BY_MATRIX_WORDING: Readonly<Record<string, OverlayPhoneModality>> = {
  "Bottom sheet": "bottom-sheet",
  "Full-screen stage": "full-screen-stage",
  "Session gate": "session-gate",
  "Status banner": "status-banner",
};

const DESKTOP_MODALITY_BY_MATRIX_WORDING: Readonly<Record<string, OverlayDesktopModality>> = {
  Dialog: "dialog",
  "Inspection drawer": "inspection-drawer",
  "Session gate": "session-gate",
  "Status banner": "status-banner",
};

const DISMISSAL_BY_MATRIX_WORDING: Readonly<Record<string, OverlayDismissal>> = {
  "Escape, backdrop, close": "escape-backdrop-close",
  "Recovery action only": "recovery-only",
};

const MUTATION_BY_MATRIX_WORDING: Readonly<
  Record<string, { mutatesState: boolean; requiresFreshAuthentication: boolean }>
> = {
  No: { mutatesState: false, requiresFreshAuthentication: false },
  Yes: { mutatesState: true, requiresFreshAuthentication: false },
  "Yes; two-stage": { mutatesState: true, requiresFreshAuthentication: true },
};

function normalised<Value>(
  table: Readonly<Record<string, Value>>,
  wording: string,
  rowId: string,
  column: string,
): Value {
  // `Object.hasOwn`, not `table[wording]`: a matrix cell reading `constructor` or
  // `toString` would otherwise resolve to an inherited function. That could never
  // pass — a function is not a modality string — but the failure would be
  // illegible for an already-bewildering input. This makes the guarantee
  // unconditional rather than incidental.
  if (!Object.hasOwn(table, wording)) {
    throw new Error(
      `${MATRIX_PATH} row \`${rowId}\`: unmapped ${column} value ${JSON.stringify(wording)}. ` +
        `Known ${column} values: ${Object.keys(table)
          .map((known) => JSON.stringify(known))
          .join(", ")}.`,
    );
  }
  return table[wording];
}

/**
 * The columns this parser reads by position. Without this check, column drift
 * still fails closed — but it fails through the lookup tables, reporting
 * "unmapped phone modality value `Dialog`" and sending the next reader hunting a
 * corrupted cell instead of a moved column. One assertion names the real cause.
 */
const MATRIX_COLUMNS = ["ID", "Product context", "Phone", "Desktop", "Mutation", "Dismissal"] as const;

function matrixColumnHeadings(document: string): readonly string[] {
  const header = document.split("\n").find((line) => line.startsWith("| ID"));
  if (header === undefined) {
    throw new Error(
      `${MATRIX_PATH}: no table header row starting "| ID". The matrix table has moved or been reformatted.`,
    );
  }
  return header
    .split("|")
    .map((cell) => cell.trim())
    .slice(1, -1);
}

/** Parses the frozen matrix out of the interaction-matrix document itself. */
function frozenMatrixRows() {
  const document = readFileSync(resolve(process.cwd(), MATRIX_PATH), "utf8");
  const headings = matrixColumnHeadings(document);
  if (headings.join(" | ") !== MATRIX_COLUMNS.join(" | ")) {
    throw new Error(
      `${MATRIX_PATH}: the table columns moved. Expected \`${MATRIX_COLUMNS.join(" | ")}\`; ` +
        `found \`${headings.join(" | ")}\`. This test reads cells 1-6 by position, so correct the ` +
        `column order or this parser — do not touch the row values.`,
    );
  }
  return document
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map((cells) => ({
      id: cells[1].replace(/`/g, ""),
      phone: cells[3],
      desktop: cells[4],
      mutation: cells[5],
      dismissal: cells[6],
    }));
}

/**
 * The full prohibited vocabulary, not the subset any one surface happens to
 * render.
 *
 * It now lives in `tests/helpers/caring-contacts-prohibited-language.ts`: the
 * overlay-host suite checks the same list against the words the RENDERER adds on
 * top of these definitions, and it had been a byte-for-byte second copy. Two
 * hand-kept copies of a safety list drift apart silently, and the failure mode is
 * a green suite that no longer covers what it says it covers.
 */
const PROHIBITED_LANGUAGE = CARING_CONTACTS_PROHIBITED_LANGUAGE;

describe("the frozen 24-overlay contract", () => {
  it("holds exactly 24 unique overlays, 16 of which mutate", () => {
    expect(WORKSPACE_OVERLAY_DEFINITIONS).toHaveLength(24);
    expect(new Set(WORKSPACE_OVERLAY_DEFINITIONS.map((definition) => definition.id)).size).toBe(24);
    expect(MUTATING_OVERLAY_IDS).toHaveLength(16);

    // Against the matrix document, NOT against the table's own `filter().map()`.
    // Comparing the export with the expression that defines it re-derives the
    // code's own computation and cannot fail; comparing it with the frozen
    // record bites today, and still catches a later hand-written list.
    const mutatingInMatrix = frozenMatrixRows()
      .filter((row) => normalised(MUTATION_BY_MATRIX_WORDING, row.mutation, row.id, "mutation").mutatesState)
      .map((row) => row.id);
    expect(mutatingInMatrix).toHaveLength(16);
    expect(MUTATING_OVERLAY_IDS).toEqual(mutatingInMatrix);
  });

  it("reads the matrix columns from the positions this parser assumes", () => {
    const document = readFileSync(resolve(process.cwd(), MATRIX_PATH), "utf8");
    expect(matrixColumnHeadings(document)).toEqual([...MATRIX_COLUMNS]);
  });

  it("matches the interaction matrix document row for row", () => {
    const rows = frozenMatrixRows();
    expect(rows).toHaveLength(24);
    rows.forEach((row, index) => {
      const definition = WORKSPACE_OVERLAY_DEFINITIONS[index];
      expect(definition, `matrix row ${index + 1} \`${row.id}\` has no definition`).toBeDefined();
      expect(definition.id).toBe(row.id);

      const mutation = normalised(MUTATION_BY_MATRIX_WORDING, row.mutation, row.id, "mutation");
      expect(definition.mutatesState, `${row.id}.mutatesState`).toBe(mutation.mutatesState);
      expect(definition.requiresFreshAuthentication, `${row.id}.requiresFreshAuthentication`).toBe(
        mutation.requiresFreshAuthentication,
      );
      expect(definition.phoneModality, `${row.id}.phoneModality`).toBe(
        normalised(PHONE_MODALITY_BY_MATRIX_WORDING, row.phone, row.id, "phone modality"),
      );
      expect(definition.desktopModality, `${row.id}.desktopModality`).toBe(
        normalised(DESKTOP_MODALITY_BY_MATRIX_WORDING, row.desktop, row.id, "desktop modality"),
      );
      expect(definition.dismissal, `${row.id}.dismissal`).toBe(
        normalised(DISMISSAL_BY_MATRIX_WORDING, row.dismissal, row.id, "dismissal"),
      );
    });
  });

  it("requires fresh authentication for exactly withdrawal and reassignment", () => {
    expect(
      WORKSPACE_OVERLAY_DEFINITIONS.filter((definition) => definition.requiresFreshAuthentication).map((d) => d.id),
    ).toEqual(["withdrawal", "reassignment"]);
  });

  /**
   * Ruling 58: `action-only` is a reserved, currently unreachable member of
   * `OverlayDismissal`. The matrix expresses two dismissal values and no more,
   * so this pins the used set rather than the type. A future author who assigns
   * `action-only` to a row must first change the frozen record, which is where
   * the authority lives.
   *
   * The two modality unions need no equivalent guard: all four phone values and
   * all four desktop values are taken by at least one of the 24 rows.
   */
  it("uses only the dismissal values the matrix expresses", () => {
    const used = [...new Set(WORKSPACE_OVERLAY_DEFINITIONS.map((definition) => definition.dismissal))].sort();
    expect(used).toEqual(["escape-backdrop-close", "recovery-only"]);
  });

  it("carries no empty field and no prohibited clinical language", () => {
    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      for (const [field, value] of Object.entries(definition)) {
        if (typeof value === "string") expect(value.trim(), `${definition.id}.${field}`).not.toBe("");
        if (typeof value === "string") expect(value, `${definition.id}.${field}`).not.toMatch(PROHIBITED_LANGUAGE);
        if (typeof value === "string") expect(value.trim(), `${definition.id}.${field}`).not.toBe("-");
      }
      expect(`${definition.summary} ${definition.decision}`).not.toMatch(
        /monitor(ed|ing)? replies|patient is safe|risk score|inbox|conversation/i,
      );
    }
  });

  it("looks a definition up by id and returns null for an unknown id", () => {
    // Both sides asserted present before they are compared. Optional chaining on
    // each side would make this pass vacuously if `pause` were renamed away:
    // `undefined` would equal `undefined` and the lookup would go untested.
    const row = WORKSPACE_OVERLAY_DEFINITIONS.find((definition) => definition.id === "pause");
    expect(row, "no `pause` row in the definition table").toBeDefined();

    const found = overlayDefinition("pause");
    expect(found, 'overlayDefinition("pause") returned null').not.toBeNull();
    expect(found).toBe(row);

    expect(overlayDefinition("not-an-overlay")).toBeNull();
  });
});
