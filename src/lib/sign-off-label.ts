import { isNamedPerson, isUtcIsoTimestamp } from "@/lib/admin/rule-sign-off";
import { formatDayMonthYear } from "@/lib/first-nations/contact-format";
import { PERTH_TIME_ZONE } from "@/lib/perth-time";

/**
 * The one reader-facing sign-off line for clinical reference records.
 *
 * A record reads as signed off only when its sign-off names a real person (a given and a
 * family name, see `isNamedPerson`) AND carries a real UTC sign-off time. A system or
 * product attribution such as "PsychSift" is not a person's name, so it does not buy the
 * "Signed off by" line: the record keeps its not-signed-off wording until a named clinician
 * is recorded. It fails closed — an unreadable name or date never reads as signed.
 *
 * Display only. Whether a record's content is shown at all is decided by each record's own
 * governance rules, never by this label.
 */
export type SignOffDisplay = { signedOff: true; text: string } | { signedOff: false; text: string };

export const NOT_SIGNED_OFF_LABEL = "Not signed off yet";

const perthDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: PERTH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function signOffDisplay(
  reviewer: string | null | undefined,
  reviewedAt: string | null | undefined,
): SignOffDisplay {
  const name = typeof reviewer === "string" ? reviewer.trim().replace(/\s+/g, " ") : "";
  if (!isNamedPerson(name) || !isUtcIsoTimestamp(reviewedAt) || Date.parse(reviewedAt) > Date.now()) {
    return { signedOff: false, text: NOT_SIGNED_OFF_LABEL };
  }
  const day = formatDayMonthYear(perthDay.format(new Date(reviewedAt)));
  return { signedOff: true, text: `Signed off by ${name}, ${day}` };
}
