import { formatDayMonthYear } from "@/lib/first-nations/contact-format";

// Browser-safe half of the review stamp: no hashing, so client components can import it without pulling
// the server-only `node:crypto` code in `approval.ts` into the browser bundle.
/**
 * The review facts a card can show, read from the content files only: the source's
 * title, and the approval record (body, role, date) when one matches the card's
 * current content. Nothing here is ever written by hand; a missing record is
 * shown as "Not yet reviewed".
 */
export type ReviewStamp = { source: string; reviewer: string | null; reviewedOn: string | null };

export function reviewStampText(stamp: ReviewStamp): string {
  const reviewed =
    stamp.reviewer && stamp.reviewedOn
      ? `Reviewed by ${stamp.reviewer} · ${formatDayMonthYear(stamp.reviewedOn)}`
      : "Not yet reviewed";
  return `Source: ${stamp.source} · ${reviewed}`;
}
