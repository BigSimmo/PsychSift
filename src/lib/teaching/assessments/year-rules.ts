/**
 * The PGY1 and PGY2 rules and the year-end facts on the doctor's Progress screen, as data.
 *
 * Every line names its source in a comment. Nothing here is a local or invented rule: a line that could not be
 * found in the sources check (work-mode-build/assessments-cla-sources-check.md, 8 Oct 2026) was left out.
 * Abbreviations follow that note:
 * - [TE3] AMC Section 3, Requirements for prevocational PGY1 and PGY2 training programs and terms (p.34 to 38):
 *   https://www.amc.org.au/wp-content/uploads/2022/12/Section-3-Requirements-for-prevocational-PGY1-and-PGY2-training-programs-and-terms.pdf
 * - [3A] AMC Section 3A, Assessment approach:
 *   https://www.amc.org.au/wp-content/uploads/2022/12/Section-3A-Assessment-approach.pdf
 * - [3C] AMC Section 3C, Certifying completion of PGY1 and PGY2 training (p.56 to 59):
 *   https://www.amc.org.au/wp-content/uploads/2022/12/Section-3C-Certifying-completion-of-PGY1-and-PGY2-training.pdf
 * - [ARP] AMC Guide to Assessment Review Panels:
 *   https://www.amc.org.au/wp-content/uploads/2023/09/Guide-to-Assessment-Review-Panels.pdf
 * - [FAQ23] AMC FAQ, November 2023: https://www.amc.org.au/wp-content/uploads/2023/11/Frequently-Asked-Questions-November-2023.pdf
 * - [PGY2FAQ] AMC PGY2 certification FAQ, 2026:
 *   https://www.amc.org.au/wp-content/uploads/2026/08/FAQ-for-PGY2-certification-process-2026.pdf
 * - [MBA-RS] Medical Board of Australia, general registration on completion of PGY1 (effective 1 Jan 2024):
 *   https://www.medicalboard.gov.au/Registration-Standards/Granting-general-registration-to-Australian-and-New-Zealand-medical-graduates-on-completion-of-PGY1
 * - [CLA-GL] CLA glossary: https://www.digitalhealth.gov.au/sites/default/files/documents/cla-glossary.pdf
 */

import { YEAR_WEEKS } from "@/lib/teaching/assessments/model";

/** Teaching joins a number to its unit with a non-breaking space (see teaching-number.ts). */
const unit = (value: number | string, word: string) => `${value} ${word}`;

/* ---------------------------------------------------------- both years */

/**
 * [MBA-RS]: "at least 47 weeks full-time equivalent (FTE) experience … excludes annual leave but may include up to
 * two weeks of professional development leave". [TE3 p.35]: "minimum of 47 weeks (including professional
 * development leave)" for PGY1 and PGY2.
 */
export const YEAR_LENGTH_RULE = `At least ${unit(YEAR_WEEKS, "weeks")} full-time equivalent, not counting annual leave. Up to ${unit(2, "weeks")} of professional development leave counts.`;

/** [TE3 p.35]: absent "for more than 10 working days … (such as for sick leave, personal leave or carer's leave)". */
export const ABSENCE_RULE = `If you're away for more than ${unit(10, "working days")}, such as sick, personal or carer's leave, the Assessment Review Panel reviews your progress.`;

/* ---------------------------------------------------------- PGY1 */

/**
 * PGY1 rules shown as plain lines beside the sample's own meters.
 * - Different specialties: [MBA-RS] "a minimum of four terms … in different specialties".
 * - Clinical team: [TE3] "Prevocational doctors should be embedded in a clinical team for at least half of each
 *   year". An admission or short-stay ward with multiple supervisors "would not normally be considered being part
 *   of a clinical team".
 */
export const PGY1_TERM_LINES: readonly string[] = [
  `At least ${unit(4, "terms")} in different specialties.`,
  "Part of a clinical team for at least half the year. An admission or short-stay ward with several supervisors would not normally count.",
];

/** [TE3]: each term is accredited for "1 or 2" categories. [MBA-RS]: "Up to two types can be counted per term". */
export const KINDS_PER_TERM_RULE = `Each term is accredited for 1 or 2 kinds of experience.`;

/** [TE3]: PGY1 service terms "no more than 1 term in a 4- or 5-term year", beside the 20% limit. */
export const PGY1_SERVICE_TERM_RULE = `Also no more than ${unit(1, "term")} in a 4- or 5-term year.`;

/* ---------------------------------------------------------- year end */

/** [ARP p.11]: the panel looks mainly at EPA outcomes, end-of-term forms and the record of learning. */
export const PANEL_LOOKS_AT = "Looks at your EPAs, end-of-term forms and record of learning across the year.";

/** [ARP p.12]: the four decisions. [ARP] uses no "repeat" or "not yet completed" labels, so neither do we. */
export const PANEL_OUTCOMES: readonly string[] = [
  "Ask for more information",
  "Recommend progression, with or without specific feedback",
  "Recommend delayed progression, with specific feedback",
  "Refer to the Director of Medical Services",
];

/**
 * [3C p.59]: the Board decides general registration, on its "Certificate of completion of an accredited internship
 * form". [MBA-RS]: the confirmation is signed by the Director of Clinical Training, the Director of Medical Services,
 * the panel (ARP) chair, or another person acceptable to the Board.
 */
export const PGY1_REGISTRATION =
  "The Medical Board decides, on its certificate of completion of an accredited internship. The DCT, the Director of Medical Services, the panel chair or another person the Board accepts signs it.";

/** [MBA-RS]: PGY1 must be completed within 3 years, part-time included. */
export const PGY1_TIME_LIMIT = `PGY1 must be finished within ${unit(3, "years")}, part-time included.`;

/** [CLA-GL]: the MEU administrator generates a Transcript of Learning at the end of the year. */
export const TRANSCRIPT_LINE = "Your MEU makes your transcript of learning in CLA at year end.";

/* ---------------------------------------------------------- PGY2 */

/**
 * PGY2 rules, all [TE3 p.35 to 36] unless the comment says otherwise.
 * Dropped as not found in the sources check: "in different subspecialties" for PGY2 terms.
 */
export const PGY2_RULES: readonly string[] = [
  // [TE3]: each term at least 10 weeks. PGY2 at least 3 terms.
  `At least ${unit(3, "terms")}, each at least ${unit(10, "weeks")}`,
  // [TE3]: at most 5 terms a year.
  `At most ${unit(5, "terms")}`,
  // [TE3]: PGY2 covers A to C across the year. Each term is accredited for "1 or 2" categories.
  "Kinds of experience A, B and C across the year, 1 or 2 in each term",
  // [TE3]: "Maximum of one term not involving direct clinical care".
  `At most ${unit(1, "term")} without direct clinical care`,
  // [TE3]: no more than 25% in any one subspecialty.
  "At most 25% in any one subspecialty",
  // [TE3]: PGY2 service terms (relief or nights) no more than 25% of the year.
  "Service terms (relief, nights) at most 25%",
  // [TE3 p.35]: 47 weeks for PGY1 and PGY2. [3A p.50]: the same EPAs and minimums, "at a higher level for PGY2".
  `At least ${unit(YEAR_WEEKS, "weeks")}, with the same EPA minimums as PGY1, assessed at a higher level`,
  // [FAQ23, FAQ 44]: "PGY2: maximum 4 years to complete".
  `Finished within ${unit(4, "years")}`,
];

/**
 * [3C p.57]: "A certificate of completion will be issued at the end of PGY2". [PGY2FAQ]: the AMC generates it and
 * the health service, which sends the doctor's Ahpra number, issues it to the doctor.
 */
export const PGY2_CERTIFICATE =
  "A certificate of completion is issued at the end of PGY2. It comes through your health service, which needs your Ahpra number.";
