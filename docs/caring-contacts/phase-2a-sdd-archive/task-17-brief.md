### Task 17: The frozen 24-row definition table

The production table is a **fresh file**, not an import — production may never import from `src/components/caring-contacts/mockups/`. Its 24 ids, titles, phone modalities, desktop modalities and dismissal values must equal the frozen matrix in `docs/caring-contacts/interaction-matrix.md` exactly.

**Files:**

- Create: `src/components/caring-contacts/workspace/overlays/definitions.ts`
- Test: `tests/caring-contacts-overlay-definitions.test.ts` (new)

**Interfaces:**

```ts
export type OverlayPhoneModality = "bottom-sheet" | "full-screen-stage" | "session-gate" | "status-banner";
export type OverlayDesktopModality = "dialog" | "inspection-drawer" | "session-gate" | "status-banner";
export type OverlayDismissal = "escape-backdrop-close" | "action-only" | "recovery-only";
export type OverlayAvailability = "Available" | "Read only" | "Unavailable until resolved";

export type WorkspaceOverlayDefinition = {
  id: string;
  label: string;
  title: string;
  summary: string;
  decision: string;
  availability: OverlayAvailability;
  mutatesState: boolean;
  requiresFreshAuthentication: boolean;
  phoneModality: OverlayPhoneModality;
  desktopModality: OverlayDesktopModality;
  dismissal: OverlayDismissal;
  tone?: "primary" | "danger";
};

export const WORKSPACE_OVERLAY_DEFINITIONS: readonly WorkspaceOverlayDefinition[]; // exactly 24
export const MUTATING_OVERLAY_IDS: readonly string[]; // exactly 16
export function overlayDefinition(id: string): WorkspaceOverlayDefinition | null;
```

The 24 ids, in matrix order: `verify-identity`, `change-patient`, `pathway-preview`, `message-preview`, `communication-preference`, `adjust-date-time`, `outside-window-warning`, `save-draft`, `discard-changes`, `final-activation`, `activation-success`, `pause`, `withdrawal`, `reassignment`, `delivery-detail`, `resolve-failed-delivery`, `contact-changed-block`, `template-changed-retired`, `session-expiry`, `offline-banner`, `recoverable-error`, `permission-unavailable`, `team-switcher`, `draft-version-conflict`.

`requiresFreshAuthentication` is `true` for exactly `withdrawal` and `reassignment` — the matrix's "two-stage" column.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MUTATING_OVERLAY_IDS,
  WORKSPACE_OVERLAY_DEFINITIONS,
} from "@/components/caring-contacts/workspace/overlays/definitions";

/** Parses the frozen matrix out of the interaction-matrix document itself. */
function frozenMatrixRows() {
  const document = readFileSync("docs/caring-contacts/interaction-matrix.md", "utf8");
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

describe("the frozen 24-overlay contract", () => {
  it("holds exactly 24 unique overlays, 16 of which mutate", () => {
    expect(WORKSPACE_OVERLAY_DEFINITIONS).toHaveLength(24);
    expect(new Set(WORKSPACE_OVERLAY_DEFINITIONS.map((definition) => definition.id)).size).toBe(24);
    expect(MUTATING_OVERLAY_IDS).toHaveLength(16);
  });

  it("matches the interaction matrix document row for row", () => {
    const rows = frozenMatrixRows();
    expect(rows).toHaveLength(24);
    rows.forEach((row, index) => {
      const definition = WORKSPACE_OVERLAY_DEFINITIONS[index];
      expect(definition.id).toBe(row.id);
      expect(definition.mutatesState).toBe(row.mutation.startsWith("Yes"));
      expect(definition.requiresFreshAuthentication).toBe(row.mutation.includes("two-stage"));
    });
  });

  it("requires fresh authentication for exactly withdrawal and reassignment", () => {
    expect(
      WORKSPACE_OVERLAY_DEFINITIONS.filter((definition) => definition.requiresFreshAuthentication).map((d) => d.id),
    ).toEqual(["withdrawal", "reassignment"]);
  });

  it("carries no empty field and no prohibited clinical language", () => {
    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      for (const [field, value] of Object.entries(definition)) {
        if (typeof value === "string") expect(value.trim(), `${definition.id}.${field}`).not.toBe("");
      }
      expect(`${definition.summary} ${definition.decision}`).not.toMatch(
        /monitor(ed|ing)? replies|patient is safe|risk score|inbox|conversation/i,
      );
    }
  });
});
```

Reading the matrix document is deliberate. A hand-copied expectation array can drift from the frozen record silently; parsing the record cannot.

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Write `definitions.ts`** with all 24 rows, transcribed from `docs/caring-contacts/interaction-matrix.md`.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Swap `pause`'s phone modality to `full-screen-stage` → the matrix test goes red. Set `requiresFreshAuthentication` on `pause` → the fresh-auth test goes red. Revert both.
- [ ] **Step 6: Commit**

```bash
git add src/components/caring-contacts/workspace/overlays/definitions.ts tests/caring-contacts-overlay-definitions.test.ts
git commit -m "feat(caring-contacts): the frozen 24-overlay definition table, checked against the matrix document"
```

---
