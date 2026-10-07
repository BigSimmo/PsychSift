import type { AppModeId } from "@/lib/app-modes";

/**
 * The mode pill's two rooms.
 *
 * Clinical is care with a patient. Work is the working day, and it is short on
 * purpose: On Call lives here, beside My Day and the roster, rather than in a
 * door of its own above the clinical list.
 */
export const modeMenuSides = [
  {
    id: "clinical",
    label: "Clinical",
    hint: "Care, diagnosis and reference",
  },
  {
    id: "work",
    label: "Work",
    hint: "Your working day",
  },
] as const;

export type ModeMenuSideId = (typeof modeMenuSides)[number]["id"];

/**
 * How the mode menu groups the app's modes, inside one side.
 *
 * A flat list of every mode is unusable, so each side groups its own. The
 * desktop menu and the phone sheet both draw from here. That makes this a
 * *second* list of mode ids, and a mode missing from every group is silently
 * dropped — `satisfies readonly AppModeId[]` constrains membership but not
 * exhaustiveness, so nothing in the type system catches it.
 *
 * Sources was added to `appModeDefinitions` without being added here and so was
 * unreachable on phones. `tests/phone-mode-groups.test.ts` is the exhaustiveness
 * check that now fails instead: every mode id must appear in exactly one group.
 */
export const phoneModeGroups = [
  {
    id: "find",
    label: "Search",
    hint: "Answers, sources, services",
    side: "clinical",
    showHeading: true,
    modeIds: ["answer", "documents", "services", "sources", "favourites"],
  },
  // Psychiatry is a mode of its own (a dashboard at `/psychiatry`) that
  // gathers these sections. It leads the group, and the sections stay listed
  // under it so each keeps its own search. First Nations culturally safe care
  // sits with it: it is used with a patient, beside diagnosis and formulation.
  {
    id: "psychiatry",
    label: "Psychiatry",
    hint: "Diagnosis, formulation, therapy, forms",
    side: "clinical",
    showHeading: true,
    modeIds: [
      "psychiatry",
      "dsm",
      "differentials",
      "specifiers",
      "formulation",
      "therapy-compass",
      "forms",
      "first-nations",
    ],
  },
  // Medicines & tools, like Psychiatry, is a dashboard (`/medicines`) that
  // gathers these sections and leads its group (modes review, phase 3).
  {
    id: "care",
    label: "Medicines & tools",
    hint: "Medication, calculators, reference",
    side: "clinical",
    showHeading: true,
    modeIds: ["medicines", "prescribing", "tools", "calculators", "factsheets", "dictionary"],
  },
  // One list, and the switch already names it, so the menu draws no second heading.
  {
    id: "work",
    label: "Work",
    hint: "Your working day",
    side: "work",
    showHeading: false,
    modeIds: ["my-day", "cme", "open-shifts", "roster", "my-work", "on-call", "teaching"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  hint: string;
  side: ModeMenuSideId;
  showHeading: boolean;
  modeIds: readonly AppModeId[];
}>;

const rankedModeIds = phoneModeGroups.flatMap((group) => group.modeIds);

/** The groups the menu draws when `side` is selected, in draw order. */
export function phoneModeGroupsForSide(side: ModeMenuSideId) {
  return phoneModeGroups.filter((group) => group.side === side);
}

/** Which room a mode belongs to. A mode in no group, which the exhaustiveness test forbids, reads as Clinical. */
export function modeMenuSideForMode(modeId: AppModeId): ModeMenuSideId {
  return phoneModeGroups.find((group) => (group.modeIds as readonly AppModeId[]).includes(modeId))?.side ?? "clinical";
}

/**
 * `modes` in the order one side of the menu draws them.
 *
 * Arrow keys walk this order, so it has to be the order on screen for the
 * open side, not registry order.
 */
export function orderModesForSide<T extends { readonly id: AppModeId }>(
  modes: readonly T[],
  side: ModeMenuSideId,
): T[] {
  const byId = new Map(modes.map((mode) => [mode.id, mode]));
  return phoneModeGroupsForSide(side).flatMap((group) =>
    group.modeIds.flatMap((modeId) => {
      const mode = byId.get(modeId);
      return mode ? [mode] : [];
    }),
  );
}

/**
 * `modes` in the order the grouped menus would draw them if both sides were
 * open: Clinical, then Work, and within a side in `modeIds` order.
 *
 * A mode in no group, which the exhaustiveness test forbids, sorts last rather
 * than vanishing.
 */
export function orderByPhoneModeGroups<T extends { readonly id: AppModeId }>(modes: readonly T[]): T[] {
  const ranked = new Set<AppModeId>(rankedModeIds);
  const ordered = (["clinical", "work"] as const).flatMap((side) => orderModesForSide(modes, side));
  const omitted = modes.filter((mode) => !ranked.has(mode.id));
  return [...ordered, ...omitted];
}
