import {
  looksLikePatientDetail,
  normaliseWorkText,
  type PatientDetailCheckOptions,
} from "@/lib/work-text/patient-detail-check";
import { currentWorkYear } from "@/lib/work-time/current-zone";

/**
 * CPD's thin layer over the shared work-text check
 * (`src/lib/work-text/patient-detail-check.ts`), which does all the reading:
 * folded and invisible characters, initials, names, ages with sex, record
 * numbers, dates of birth and the WA workplace capitals it reads past.
 *
 * The only rules kept here are the CPD-specific allowances, each read past
 * BEFORE the shared check runs, so everything else in the text is still read:
 * - an activity or talk title may hold a recent full date ("Peer review
 *   12/09/2026"), because CPD dates are recent and a date of birth is not;
 * - a title may name a speaker by their title ("Dr J Smith lecture",
 *   "Prof Lowe on lithium"). Mr, Mrs, Ms and Miss are not read past, because
 *   that is how a patient is written;
 * - a title may name a course or college in three capitals ("APA webinar").
 *   Two capitals are still read as initials;
 * - where a job advert came from may hold its link and its reference number.
 */

export type CpdPatientCheckOptions = Pick<PatientDetailCheckOptions, "allowName" | "allowCapitals">;

/**
 * Three shapes a CPD reflection or title takes that the shared check leaves alone, because a search
 * box or a note rarely holds them. They run on the folded text after the shared check:
 * - a name then an age after a comma ("Saw John Smith, 45", "Smith, John 45");
 * - "patient" or "pt" then two lower-case words that are not a care word ("patient john smith");
 * - an age with a lower-case sex letter and a clinical word after it ("45m with psychosis"). A bare
 *   "45m" is left alone, because it is how minutes are written ("45m webinar").
 */
const NAME_THEN_AGE =
  /\b\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+,\s*(?:aged\s+)?\d{1,3}(?=\s*(?:$|[,.;:)]|with\b|who\b|re\b|for\b|[MFmf]\b))|\b\p{Lu}\p{Ll}+,\s+(?!(?:Ward|Unit|Level|Floor|Room|Clinic|Pod|Team|Term|Week|Day|Session|Part|Module|Group|Year|Grade|Block|Wing)\b)\p{Lu}\p{Ll}+\s+(?:aged\s+)?\d{1,3}\b(?!\s*(?:h|hrs?|hours?|mins?|minutes?|%))/u;
const NOT_A_PATIENT_NAME = new Set(
  "safety care centred centered experience experiences feedback journey journeys flow education outcome outcomes rights survey surveys record records privacy consent assessment assessments information satisfaction voice advocacy group groups review reviews management needs partnership partnerships engagement handover handovers selection load data stories story focused led perspective perspectives involvement participation case cases presentation presentations".split(
    " ",
  ),
);
const PATIENT_WORDS = /\b(?:patient|pt)\s+([a-z][a-z'-]+)\s+([a-z][a-z'-]+)\b/g;
const AGE_LOWER_SEX = /\b\d{1,3}\s?[mf]\s+(?:with|who|presenting|presented|admitted|re)\b/i;

function cpdOnlyShapes(text: string): boolean {
  const folded = normaliseWorkText(text);
  if (NAME_THEN_AGE.test(folded) || AGE_LOWER_SEX.test(folded)) return true;
  for (const match of folded.matchAll(PATIENT_WORDS))
    if (!NOT_A_PATIENT_NAME.has(match[1]!) && !NOT_A_PATIENT_NAME.has(match[2]!)) return true;
  return false;
}

/** True when the words read as holding a patient detail. Empty text is never flagged. */
export function cpdTextLooksLikePatient(
  text: string,
  thisYear = currentWorkYear(),
  options: CpdPatientCheckOptions = {},
): boolean {
  if (!text.trim()) return false;
  return looksLikePatientDetail(text, { ...options, thisYear }) || cpdOnlyShapes(text);
}

const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const FULL_DATES: readonly RegExp[] = [
  /\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4}|\d{2})\b/g,
  /\b(\d{4})-\d{1,2}-\d{1,2}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\s+(\\d{4})\\b`, "gi"),
];

/** A speaker named by a doctor's or professor's title, with or without an initial. Dotted initials alone are not a surname. */
const SPEAKER =
  /\b(?:Dr|Doctor|Prof|Professor|A\/Prof|Assoc(?:iate)?\.?\s+Prof(?:essor)?)\.?\s+(?:\p{Lu}\.?\s+)*\p{Lu}\p{Ll}[\p{L}'-]+/gu;

function fullYear(raw: string, thisYear: number): number {
  if (raw.length === 4) return Number(raw);
  const two = Number(raw);
  return two > (thisYear % 100) + 1 ? 1900 + two : 2000 + two;
}

/** A title with its recent dates and its speaker read past, for the shared check. */
function titleForChecking(title: string, thisYear: number): string {
  let text = title.normalize("NFKC");
  for (const pattern of FULL_DATES) {
    text = text.replace(new RegExp(pattern.source, pattern.flags), (match: string, year: string) => {
      const value = fullYear(year, thisYear);
      // Only a date within five years before (or one after) is a CPD date; an older one may be a date of birth.
      return value >= thisYear - 5 && value <= thisYear + 1 ? " " : match;
    });
  }
  // Course and college capitals ("APA webinar", "ECT workshop") are read past at three letters. Two
  // capitals are left for the shared check, which knows the common ones (ED, GP, OT), because two
  // letters is how a patient's initials are most often written ("Supervision of JS").
  return readPastThreeCapitals(text.replace(SPEAKER, " "));
}

/** Three bare capitals read as a word ("APA", "OPH"); two capitals and dotted initials are left to be read. */
function readPastThreeCapitals(text: string): string {
  return text.replace(/\b[A-Z]{3}\b(?!\.)/g, (word) => word.toLowerCase());
}

/**
 * A field that names hospitals, services and courses in capitals (a referee's role, an activity
 * title): three capitals are read past ("Consultant, OPH"), two are still read as initials
 * ("Supervised me with JS").
 */
export function cpdNamedPlaceTextLooksLikePatient(text: string, thisYear = currentWorkYear()): boolean {
  if (!text.trim()) return false;
  return looksLikePatientDetail(readPastThreeCapitals(text.normalize("NFKC")), { thisYear }) || cpdOnlyShapes(text);
}

/** A CPD activity or Teaching talk title: the shared check, with a recent date and a speaker read past. */
export function cpdTitleLooksLikePatient(title: string, thisYear = currentWorkYear()): boolean {
  if (!title.trim()) return false;
  return looksLikePatientDetail(titleForChecking(title, thisYear), { thisYear }) || cpdOnlyShapes(title);
}

const ADVERT_LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const ADVERT_REF = /\b(?:job\s+)?ref(?:erence)?\.?\s*(?:no\.?|number)?\s*[:#]?\s*[A-Za-z]{0,4}[-/]?\d[\w/-]*/gi;

/** Where a job advert came from: its link and reference number are read past, everything else is checked. */
export function advertSourceLooksLikePatient(text: string, thisYear = currentWorkYear()): boolean {
  const read = text.normalize("NFKC").replace(ADVERT_LINK, " ").replace(ADVERT_REF, " ");
  return looksLikePatientDetail(read, { thisYear }) || cpdOnlyShapes(read);
}
