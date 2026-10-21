import { appModeSide, type AppModeId } from "@/lib/app-modes";

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
  // Grouped by what the doctor is doing (usefulness and layout audit, 11 Oct
  // 2026, item 8): search first, then Psychiatry, then Medicines, with the
  // housekeeping pages (Favourites, Sources) at the foot.
  {
    id: "find",
    label: "Search",
    hint: "Answers, documents, services",
    side: "clinical",
    showHeading: true,
    drawn: true,
    modeIds: ["answer", "documents", "services"],
  },
  // Psychiatry is a mode of its own (a dashboard at `/psychiatry`) that
  // gathers these sections. It leads the group, and the sections stay listed
  // under it so each keeps its own search. First Nations culturally safe care
  // sits with it: it is used with a patient, beside diagnosis and formulation.
  // Calculators (psychiatric rating scales) and the Dictionary (psychiatric
  // terms) moved here from the old Medicines & tools group.
  {
    id: "psychiatry",
    label: "Psychiatry",
    hint: "Diagnosis, formulation, therapy, scales",
    side: "clinical",
    showHeading: true,
    drawn: true,
    modeIds: [
      "psychiatry",
      "dsm",
      "differentials",
      "specifiers",
      "formulation",
      "therapy-compass",
      "calculators",
      "dictionary",
      "first-nations",
    ],
  },
  // The WA Mental Health Act is its own door (owner decision, 21 Oct 2026), not
  // one section among ten under Psychiatry. Forms leads it: its three tabs are
  // the forms register, the Act and Chief Psychiatrist standards, and the MHA
  // clock, and every one of those addresses is unchanged.
  {
    id: "mha",
    label: "Mental Health Act",
    hint: "Forms, the Act and the MHA clock",
    side: "clinical",
    showHeading: true,
    drawn: true,
    modeIds: ["forms"],
  },
  // Medicines, like Psychiatry, is a dashboard (`/medicines`) that gathers
  // these sections and leads its group (modes review, phase 3).
  {
    id: "care",
    label: "Medicines",
    hint: "Medication and factsheets",
    side: "clinical",
    showHeading: true,
    drawn: true,
    modeIds: ["medicines", "prescribing", "factsheets"],
  },
  // Housekeeping at the foot of the Clinical list, under no heading of its own.
  {
    id: "library",
    label: "Your library",
    hint: "Favourites and sources",
    side: "clinical",
    showHeading: false,
    drawn: true,
    modeIds: ["favourites", "sources"],
  },
  // Retired from the menu but still a registered mode (audit item 8), so `/tools`
  // still opens for old links and bookmarks. Never drawn.
  {
    id: "retired",
    label: "Retired",
    hint: "Kept for old links",
    side: "clinical",
    showHeading: false,
    drawn: false,
    modeIds: ["tools"],
  },
  // One list, and the switch already names it, so the menu draws no second heading.
  // Same area order as the side menu and the rail: My Day, On Call, Roster, Teaching, CPD, Admin.
  {
    id: "work",
    label: "Work",
    hint: "Your working day",
    side: "work",
    showHeading: false,
    drawn: true,
    modeIds: ["my-day", "on-call", "roster", "teaching", "cme", "my-work"],
  },
  // Open shifts is a tab inside Roster (owner decision, 21 Oct 2026), so the
  // menu does not draw it. It stays a registered mode so every /open-shifts
  // address keeps working.
  {
    id: "inside-roster",
    label: "Inside Roster",
    hint: "Open shifts",
    side: "work",
    showHeading: false,
    drawn: false,
    modeIds: ["open-shifts"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  hint: string;
  side: ModeMenuSideId;
  showHeading: boolean;
  /** False for a group kept only so its modes still belong to a side; the menus skip it. */
  drawn: boolean;
  modeIds: readonly AppModeId[];
}>;

const rankedModeIds = phoneModeGroups.filter((group) => group.drawn).flatMap((group) => group.modeIds);

/** The groups the menu draws when `side` is selected, in draw order. */
export function phoneModeGroupsForSide(side: ModeMenuSideId) {
  return phoneModeGroups.filter((group) => group.side === side && group.drawn);
}

/** Which room a mode belongs to: the `side` its own definition declares. */
export function modeMenuSideForMode(modeId: AppModeId): ModeMenuSideId {
  return appModeSide(modeId);
}

/**
 * A Clinical page (not the shared home) wears the clinical band's soft tint on
 * its top bar (owner design review, 11 Oct 2026; mode-band.css). Decided from
 * the mode and address alone, so it is in the server HTML and never flashes.
 * Returns the `data-clinical-band` attribute value.
 */
export function clinicalBandAttribute(
  modeId: AppModeId,
  pathname: string | null | undefined,
  onWorkArea: boolean,
): "" | undefined {
  return !onWorkArea && (pathname ?? "/") !== "/" && modeMenuSideForMode(modeId) === "clinical" ? "" : undefined;
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
