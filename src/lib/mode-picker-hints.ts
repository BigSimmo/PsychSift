import type { AppModeId } from "@/lib/app-modes";

/**
 * The one-line hint each mode shows under its name in the phone mode sheet.
 *
 * The registry `description` is written for search and screen readers, and runs
 * to two lines or more on a phone, where it was clamped mid-sentence ("and
 * your attendance…"). The sheet is a list to scan, so it gets a short line of
 * its own that always fits one row at 320px. The full description stays the
 * row's accessible name, so nothing a screen reader hears is lost.
 *
 * A `Record` over every mode id, so a new mode cannot ship without a hint:
 * the type check fails first. `tests/mode-picker-hints.test.ts` pins the length,
 * which leaves about 25px spare at 320px in Geist (measured 7 Oct 2026).
 */
export const modePickerHints = {
  "my-day": "What needs you today",
  roster: "Your shifts",
  "open-shifts": "Extra shifts in your teams",
  teaching: "Sessions and attendance",
  cme: "Hours done and still short",
  "my-work": "Renewals, jobs and help",
  "on-call": "Contacts and escalation",
  answer: "Source-backed answers",
  documents: "Source PDFs and passages",
  services: "Services and referral pathways",
  favourites: "Your saved items",
  sources: "Ranked source catalogue",
  psychiatry: "All of psychiatry in one place",
  dsm: "Diagnostic criteria",
  differentials: "Causes and clinical clues",
  specifiers: "Episode and course wording",
  formulation: "Mechanism hypotheses",
  "therapy-compass": "Therapy reference",
  forms: "Forms and pathways",
  "first-nations": "Culturally safe care",
  medicines: "All medicines and tools",
  prescribing: "Dosing, safety and monitoring",
  calculators: "Scores and calculators",
  tools: "Clinical tools",
  factsheets: "Patient information to print",
  dictionary: "Terms and abbreviations",
} as const satisfies Record<AppModeId, string>;

/** Longest hint the sheet allows: one row at 320px beside a 40px tile and a tick. */
export const modePickerHintMaxLength = 30;

export function modePickerHint(modeId: AppModeId): string {
  return modePickerHints[modeId];
}
