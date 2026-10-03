import type { AppModeId } from "@/lib/app-modes";

import type { SignOffFamilyId, SignOffQueue, SignOffRow, SignOffTool } from "./sign-off-queue";

/**
 * "Sign off today": a short list the owner can clear in one sitting, taken from
 * the full sign-off queue, so the unsigned clinical content goes down a few
 * records at a time instead of sitting as one 1,500-record wall.
 *
 * **It never signs.** It picks records and prints the command that opens each
 * one in the local sign-off tool. That tool shows the record's full text, asks
 * the checklist questions, takes the reviewer's own name and today's date, and
 * refuses to write unless a person is typing at a real terminal. Nothing here,
 * and nothing on the page that renders it, can record a sign-off.
 *
 * **It only lists what can be signed today.** A row with no sign-off tool (the
 * exported differential records, the dictionary sense drafts, the specifier
 * catalogue) stays on the full queue page but never appears here, because
 * putting a record on a to-do list with no way to do it is noise.
 *
 * **The order is fixed and stated.** Statutory content first, then locally
 * authored content that is already live, then imported clinical records, then
 * candidate sources that nothing cites yet. Within a family the sign-off
 * tool's own order is kept (the queue's order where the tool names none), so the list is the same on every load and advances only when a
 * record is signed (it is as current as the deployed build, like the rest of
 * the owner panel).
 */
export const SIGN_OFF_TODAY_SIZE = 5;

/** Highest priority first. A family missing here is never picked. */
export const SIGN_OFF_TODAY_FAMILY_ORDER: readonly SignOffFamilyId[] = [
  // Live operational guidance for statutory Mental Health Act forms.
  "wa-mha-forms",
  // Locally authored overlays shown on live differential pages.
  "differentials",
  // Formulation mechanisms, concepts and guides, live with no named reviewer.
  "formulation",
  // Imported Therapy Compass records, shown with an awaiting-review badge.
  "therapy",
  // Proposed dictionary rewrites; approval does not apply the wording.
  "dictionary",
  // Candidate sources: nothing clinical may cite them until verified.
  "sources",
];

export type SignOffTodayRow = SignOffRow & {
  signOff: SignOffTool;
  familyName: string;
  /** The command that opens this record in the sign-off tool, ready to paste. */
  command: string;
};

export type SignOffToday = {
  rows: readonly SignOffTodayRow[];
  /** Records waiting across every family the queue reads, signable or not. */
  waiting: number;
  /** Of those, how many a local tool can sign today. */
  signable: number;
};

/**
 * The sign-off command, ending at `--reviewed-by` so the owner types their own
 * name after it. Left without a value on purpose: both tools stop with an error
 * when the name is missing, whereas a filled-in placeholder is not refused by
 * every tool and could end up published as the reviewer.
 */
export function signOffCommand(tool: SignOffTool): string {
  return tool.script === "therapy:review"
    ? `npm run therapy:review -- --write --slug "${tool.slug}" --reviewed-by`
    : `npm run clinical:review -- --write --kind ${tool.kind} --code "${tool.code}" --reviewed-by`;
}

export function pickSignOffToday(queue: SignOffQueue, size: number = SIGN_OFF_TODAY_SIZE): SignOffToday {
  const limit = Math.max(0, Math.trunc(size));
  const signableRows: SignOffTodayRow[] = [];
  for (const familyId of SIGN_OFF_TODAY_FAMILY_ORDER) {
    const family = queue.families.find((candidate) => candidate.id === familyId);
    if (!family) continue;
    // Within a family, follow the sign-off tool's own order where the row names one.
    const ordered = family.rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => (a.row.toolOrder ?? 0) - (b.row.toolOrder ?? 0) || a.index - b.index)
      .map(({ row }) => row);
    for (const row of ordered) {
      if (!row.signOff) continue;
      signableRows.push({
        ...row,
        signOff: row.signOff,
        familyName: family.name,
        command: signOffCommand(row.signOff),
      });
    }
  }
  return { rows: signableRows.slice(0, limit), waiting: queue.total, signable: signableRows.length };
}

/**
 * The one My Day line for the sign-off queue: a count with a link to the owner
 * panel, never the records themselves, so a shared list never fills with
 * clinical titles. Owner-only: the caller must show it only to the owner, as the
 * panel does.
 *
 * Same fields and id convention (`<mode>:<kind>:<record id>`) as the shared
 * `TodayItem` in `src/lib/today/today-item.ts` (PR #3224, not yet on main), so it
 * can be passed straight to that type once it lands. The owning mode is
 * `my-work`, the owner's admin area, which is where the panel lives.
 */
export type SignOffTodayItem = {
  readonly id: "my-work:sign-off:today";
  readonly mode: AppModeId;
  readonly title: string;
  readonly detail: string;
  readonly due: null;
  readonly severity: "info";
  readonly href: string;
};

export const SIGN_OFF_TODAY_HREF = "/mockups/development#developer-hub-today";

export function signOffTodayItem(today: SignOffToday): SignOffTodayItem | null {
  if (today.rows.length === 0) return null;
  const count = today.rows.length;
  return {
    id: "my-work:sign-off:today",
    mode: "my-work",
    title: `${count} clinical ${count === 1 ? "record" : "records"} to sign off today`,
    detail: `${today.signable} you can sign with the local tool, of ${today.waiting} waiting`,
    due: null,
    severity: "info",
    href: SIGN_OFF_TODAY_HREF,
  };
}
