import { onCallEntryFreshness, type OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallViewForEntry } from "@/lib/on-call/view";

/**
 * Which entries belong on the printed essentials card (Task 13) — the one
 * artefact that leaves the app and gets carried around in a lanyard pocket or
 * left on a desk, rather than read on a screen that can be corrected.
 *
 * Five conditions, every one load-bearing:
 *  - `includeOnCard` is the owner's explicit opt-in. Nothing reaches the card
 *    just because it exists in a section.
 *  - `isPersonal` entries are excluded even when flagged for the card. They
 *    carry someone's direct or mobile number, which is information for the
 *    person signed in, never for a sheet of paper that can end up anywhere.
 *  - Stale entries (`onCallEntryFreshness` — unconfirmed for over a year) are
 *    excluded because a printed number that was last checked over a year ago
 *    is the worst kind: it looks just as authoritative on paper as a number
 *    checked yesterday, and the paper cannot show its own age the way the
 *    on-screen freshness badge can.
 *  - Compliance requirements are excluded outright, for the reasons below.
 *  - Role explainers are excluded outright, for the reasons below that.
 *
 * ## Why no compliance requirement may be printed, whatever it is flagged
 *
 * A compliance row is stored in `logistics` and so arrives here looking like
 * any other Admin entry. The editor no longer offers `includeOnCard` on a
 * compliance form, and forces the stored flag off — but that is the editor's
 * courtesy, not a guarantee: a row written by an import, by the API directly,
 * or before that rule existed can still arrive here flagged. This test is what
 * makes the rule true of the data rather than of one form. Printed,
 * it comes out under the heading "Admin" as a title, a subtitle and a body —
 * and nothing else, because the card renders numbers from `CARD_NUMBER_FIELDS`
 * and a requirement's meaning is not in a number field. The expiry date, the
 * consequence band, the issuing body and the provenance all fall off, and so
 * does the Compliance page's own scope note: nothing there is checked with an
 * issuing body. What lands on the paper is a bare "Medical registration",
 * which a reader is entitled to take as a statement that it is in order. That
 * is exactly the verdict this data may never render
 * (`src/lib/on-call/compliance.ts`, "What this page may never say").
 *
 * The freshness guard does not save it either, and it is worth being exact
 * about why, because it looks as though it should. `stale` is computed from
 * `lastVerifiedAt` — when somebody last said the RECORD was right — not from
 * `expiresOn`. A registration that ran out last month, on a row ticked as
 * still-correct last week, is "fresh" by that test and would print. The card
 * cannot withhold a date it does not know it needs.
 *
 * The test is deliberate belt-and-braces, and stays even if something else
 * already happens to exclude these rows. Flagging every compliance row
 * personal, for instance, would exclude them through the `isPersonal` test
 * above — but that is a privacy decision taken for privacy reasons, and
 * whoever revisits it will be thinking about who can read a screen, not about
 * what a printed card leaves off. A control that only works as a side effect
 * of an unrelated decision is not a control. This one is named.
 *
 * If a compliance card is ever genuinely wanted, it is a different artefact:
 * one that prints the date, the band and the "recorded, not checked" sentence
 * beside every row. Do not reach it by deleting this line.
 *
 * ## Why no role explainer may be printed either, whatever it is flagged
 *
 * The same shape one section over, and the more dangerous of the two. A role
 * explainer is stored in `contacts` and so arrives here looking like an
 * ordinary contact. It is not one: Who's who answers "what does this role do
 * and when do I call it", and `partitionContactsEntries` keeps these rows off
 * the Contacts page for exactly that reason.
 *
 * It can arrive carrying a phone number. `contactsDetails` permits `phone`,
 * `afterHoursPhone`, `pager` and `extension` alongside
 * `kind: "role-explainer"`, and `CARD_NUMBER_FIELDS` in `on-call-card.tsx`
 * reads those four fields off any entry it is given. So an explainer that
 * happens to hold a number prints that number — under the heading "Contacts",
 * among rows that are numbers you ring, on the one artefact nobody can correct
 * once it is in a pocket. Every other surface in the mode has already decided
 * that number must not be offered: `isHomeDialContact` in `home-modules.ts`
 * withholds explainers from every dial module on the home, on the stated
 * ground that one there "would be a call card that cannot call". The app's own
 * reasoning ruled the number out; the printed card was the last place still
 * offering it.
 *
 * Printing the row WITHOUT its number is not the fix, and it is worth saying
 * why, because it is the smaller-looking change. The card groups by page and
 * heads each group with that page's name, so a numberless explainer still
 * lands under "Contacts" as a title and a subtitle with nothing beneath it —
 * on paper, indistinguishable from a contact whose number went missing. That
 * exact shape was a real defect on this card until 2026-09-19 (the `extension`
 * note beside `CARD_NUMBER_FIELDS`), so it is a misread this artefact has
 * already produced once for real.
 *
 * And if Who's who is genuinely wanted on paper, it is a different artefact
 * for the same reason compliance is: a "who does what" sheet whose rows are
 * roles and whose heading says so. Do not reach it by deleting this line
 * either.
 */
export function selectCardEntries(entries: readonly OnCallEntry[], now: Date = new Date()): OnCallEntry[] {
  return entries.filter((entry) => {
    if (!entry.includeOnCard) return false;
    if (entry.isPersonal) return false;
    const view = onCallViewForEntry(entry);
    if (view === "compliance" || view === "who-is-who") return false;
    if (onCallEntryFreshness(entry, now).state === "stale") return false;
    return true;
  });
}
