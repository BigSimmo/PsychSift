import type { AppModeId } from "@/lib/app-modes";

/**
 * How the phone mode sheet groups the app's modes.
 *
 * A twenty-one-item flat list is unusable on a phone, so the sheet groups it,
 * and the desktop menu uses the same groups whenever it is not filtered. That makes
 * this a *second* list of mode ids, and a mode missing from every group here is
 * silently dropped from the sheet — `satisfies readonly AppModeId[]` constrains
 * membership but not exhaustiveness, so nothing in the type system catches it.
 *
 * Sources was added to `appModeDefinitions` without being added here and so was
 * unreachable on phones. `tests/phone-mode-groups.test.ts` is the exhaustiveness
 * check that now fails instead: every mode id must appear in exactly one group.
 */
export const phoneModeGroups = [
  // Five doors (modes review, phase 1, approved 2026-10-04). My Day leads:
  // one list of what needs you, with the work areas behind it. On Call comes
  // second, on its own, so the urgent screen is never below the clinical list.
  // Then the three clinical doors: Search, Psychiatry, Medicines & tools.
  {
    id: "my-day",
    label: "My Day",
    hint: "Your day, roster, teaching, CPD and admin",
    modeIds: ["my-day", "roster", "teaching", "cme", "my-work"],
  },
  {
    id: "on-call",
    label: "On Call",
    hint: "Who to ring, right now",
    modeIds: ["on-call"],
  },
  {
    id: "find",
    label: "Search",
    hint: "Answers, sources, services",
    modeIds: ["answer", "documents", "services", "favourites", "sources"],
  },
  // Psychiatry is a mode of its own (a dashboard at `/psychiatry`) that
  // gathers these sections. It leads the group, and the sections stay listed
  // under it so each keeps its own search. First Nations culturally safe care
  // joined it from the work areas: it is used with a patient, beside diagnosis
  // and formulation.
  {
    id: "psychiatry",
    label: "Psychiatry",
    hint: "Diagnosis, formulation, therapy, forms",
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
  {
    id: "care",
    label: "Medicines & tools",
    hint: "Medication, calculators, reference",
    modeIds: ["prescribing", "calculators", "tools", "factsheets", "dictionary"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  hint: string;
  modeIds: readonly AppModeId[];
}>;

const phoneModeGroupRank = new Map<AppModeId, number>(
  phoneModeGroups.flatMap((group) => group.modeIds).map((modeId, rank) => [modeId, rank]),
);

/**
 * `modes` in the order the grouped mode menus draw them: group by group, and
 * within a group in `modeIds` order.
 *
 * The menus register each row's roving-tabindex index from this order, so
 * arrow keys move to the row visibly below or above. Registry order is not the
 * drawn order (Psychiatry is registered last but drawn second). A mode in no
 * group, which the exhaustiveness test forbids, sorts last rather than vanishing.
 */
export function orderByPhoneModeGroups<T extends { readonly id: AppModeId }>(modes: readonly T[]): T[] {
  const rankOf = (modeId: AppModeId) => phoneModeGroupRank.get(modeId) ?? Number.MAX_SAFE_INTEGER;
  return [...modes].sort((a, b) => rankOf(a.id) - rankOf(b.id));
}
