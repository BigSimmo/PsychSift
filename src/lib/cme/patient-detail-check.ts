import { checkReminderText } from "@/lib/alerts/remind-me";
import { looksLikePatientDetails } from "@/lib/work-search/signals";
import { currentWorkYear } from "@/lib/work-time/current-zone";

/**
 * The patient-detail reading every CPD free-text field goes through before it
 * can leave the device (a CPD Home file, a copy) or be kept on it (Job
 * applications). Three readings run, and any one is enough:
 *
 * - the work search's (`looksLikePatientDetails`): labelled record numbers,
 *   beds, dates of birth, a title and surname;
 * - the Remind me check (`checkReminderText`): initials, dotted initials, an
 *   initial and surname, ages, full dates and phone numbers;
 * - the age-and-sex shapes a clinical note takes that neither of those reads
 *   ("34 y.o. male", "34 year old woman"), kept here so the shared detectors
 *   are not changed for CPD.
 *
 * It leans towards a false alarm on purpose. A flagged title costs the doctor
 * one edit; a missed one sends a patient detail to a website.
 */

const AGE_SEX: readonly RegExp[] = [
  // "34yo", "34 y.o.", "34 y/o".
  /\b\d{1,3}\s?(?:yo|y\/o|y\.o\.?)(?=[\s,.;:)]|$)/i,
  // "34 year old", "5-year-old".
  /\b\d{1,3}[- ]?(?:years?|yrs?)[- ]old\b/i,
  // "34 male", "34 yrs female", "12 boy".
  /\b\d{1,3}\s?(?:(?:years?|yrs?)\s?)?(?:male|female|man|woman|boy|girl)\b/i,
  // "34 yrs F", "34M". Capital M or F only, so "30m webinar" (minutes) passes.
  /\b\d{1,3}\s?yrs?\s?[MFmf]\b/,
  /\b\d{1,3}[MF]\b/,
];

export function looksLikeAgeAndSex(text: string): boolean {
  return AGE_SEX.some((pattern) => pattern.test(text));
}

function reminderFindings(text: string): string[] {
  const problem = checkReminderText(text);
  if (!problem) return [];
  return problem.title
    .replace(/^This looks like /, "")
    .split(/, | and /)
    .map((part) => part.trim())
    .filter(Boolean);
}

export type CpdPatientCheckOptions = {
  /** A referee's name is a title and surname by design ("Dr J Smith"), so the "a name" finding is allowed. */
  readonly allowName?: boolean;
  /**
   * A role or a source names a hospital or service in capitals ("RPH", "FSH"), which the Remind me
   * check reads as initials. Bare two- and three-letter capitals are read past; dotted initials
   * ("J.S."), and every other finding, still count.
   */
  readonly allowCapitals?: boolean;
};

/** True when the words read as holding a patient detail. Empty text is never flagged. */
export function cpdTextLooksLikePatient(
  text: string,
  thisYear = currentWorkYear(),
  options: CpdPatientCheckOptions = {},
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksLikePatientDetails(trimmed, thisYear) || looksLikeAgeAndSex(trimmed)) return true;
  const read = options.allowCapitals ? trimmed.replace(/\b[A-Z]{2,3}\b(?!\.)/g, " ") : trimmed;
  return reminderFindings(read).some((finding) => !(options.allowName && finding === "a name"));
}
