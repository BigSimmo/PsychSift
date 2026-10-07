import { checkReminderText } from "@/lib/alerts/remind-me";
import { looksLikePatientDetails } from "@/lib/work-search/signals";

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

/** True when the words read as holding a patient detail. Empty text is never flagged. */
export function cpdTextLooksLikePatient(text: string, thisYear = new Date().getFullYear()): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    looksLikePatientDetails(trimmed, thisYear) || checkReminderText(trimmed) !== null || looksLikeAgeAndSex(trimmed)
  );
}
