import type { z } from "zod";

import type { ReminderTextProblem } from "@/lib/alerts/remind-me";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";
import {
  selectContractEnd,
  type AdminFeatureNeedsYouItem,
  type AdminFeatureSearchRecord,
} from "@/lib/admin/contract-end";
import { buildRenewedEntryBody, catalogueItemDraftEntry } from "@/lib/admin/renewals";
import { formatDateEcho, utcDay } from "@/lib/admin/renewal-dates";
import {
  ADMIN_REQUIREMENTS_CATALOGUE,
  catalogueItemForEntry,
  type AdminRequirementCatalogueItem,
} from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { createOnCallEntrySchema } from "@/lib/on-call/api-schemas";
import { complianceExpiresOn, entryNotForThisJob, isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { GLOSSARY } from "@/lib/teaching/assessments/content";

/**
 * Starter pack for overseas-trained doctors (junior feature #14, owner request
 * 6 Oct 2026): how WA hospitals work, local words (with the words from home),
 * the doctor's own registration and visa dates, and who to ask.
 *
 * What it may never do: give visa or registration advice, state a visa
 * length or a registration deadline it has not sourced, or name a phone
 * number other than the crisis lines Help already carries. Dates are the
 * doctor's own, compared only with each other. Words and roles are general
 * descriptions; every page says site rules can differ.
 */

type CreateBody = z.input<typeof createOnCallEntrySchema>;

/* ----------------------------------------------------------- local words */

export type LocalWordGroup = "hospital" | "training" | "pay-and-leave" | "everyday";

export const LOCAL_WORD_GROUP_LABELS: Record<LocalWordGroup, string> = {
  hospital: "Hospital",
  training: "Training",
  "pay-and-leave": "Pay and leave",
  everyday: "Everyday",
};

export interface LocalWord {
  readonly term: string;
  readonly meaning: string;
  readonly group: LocalWordGroup;
  /** Words a doctor trained elsewhere may use for the same thing. */
  readonly fromHome?: readonly string[];
  /** An example in use. */
  readonly example?: string;
  /** Shown as a small tag: the word's rules are set by each site. */
  readonly differsBySite?: boolean;
}

const OWN_WORDS: readonly LocalWord[] = [
  {
    term: "Consultant",
    meaning: "Senior doctor who leads the team and signs off plans.",
    group: "hospital",
    fromHome: ["attending", "specialist"],
  },
  {
    term: "Registrar",
    meaning: "Doctor in specialist training, senior to residents.",
    group: "hospital",
    fromHome: ["specialty trainee", "fellow"],
  },
  {
    term: "RMO",
    meaning: "Resident medical officer. A doctor after internship, not yet in a training program.",
    group: "hospital",
    fromHome: ["SHO", "junior resident"],
  },
  {
    term: "Intern",
    meaning: "A doctor in their first year after medical school, also called PGY1.",
    group: "hospital",
    fromHome: ["FY1", "house officer"],
  },
  {
    term: "PGY1, PGY2",
    meaning: "Postgraduate year 1 or 2: the first two years after medical school.",
    group: "training",
    fromHome: ["foundation years"],
  },
  {
    term: "MET call",
    meaning: "The team called to a patient who is getting worse.",
    group: "hospital",
    fromHome: ["rapid response", "crash call"],
    differsBySite: true,
  },
  {
    term: "Pager",
    meaning: "The small device that calls you to a ward.",
    group: "hospital",
    fromHome: ["bleep", "beeper"],
  },
  { term: "ED", meaning: "Emergency department.", group: "hospital", fromHome: ["A&E", "ER", "casualty"] },
  { term: "Theatre", meaning: "Operating room.", group: "hospital", fromHome: ["OR", "operating room"] },
  {
    term: "Handover",
    meaning: "Passing the care of patients to the next team at the change of shift.",
    group: "hospital",
    fromHome: ["sign-out", "signout"],
  },
  { term: "Locum", meaning: "A doctor who covers a shift or a post for a short time.", group: "hospital" },
  {
    term: "Discharge summary",
    meaning: "The letter to the family doctor when a patient goes home.",
    group: "hospital",
    fromHome: ["discharge letter", "TTO"],
  },
  {
    term: "GP",
    meaning: "General practitioner, the family doctor in the community.",
    group: "hospital",
    fromHome: ["family physician", "primary care physician"],
  },
  {
    term: "Roster",
    meaning: "The list of who works which shift.",
    group: "pay-and-leave",
    fromHome: ["rota", "schedule"],
  },
  {
    term: "Medical Workforce",
    meaning: "The hospital office for contracts, pay, rosters and leave.",
    group: "pay-and-leave",
    fromHome: ["medical staffing", "HR"],
  },
  {
    term: "Staff Health",
    meaning: "The hospital office for staff immunisation and injury at work.",
    group: "hospital",
    fromHome: ["occupational health"],
  },
  {
    term: "Ahpra",
    meaning: "Registers health practitioners in Australia, together with the Medical Board of Australia.",
    group: "training",
    fromHome: ["GMC", "medical council", "licensing board"],
  },
  {
    term: "RANZCP",
    meaning: "Royal Australian and New Zealand College of Psychiatrists, which runs psychiatry training.",
    group: "training",
  },
  {
    term: "AL",
    meaning: "Annual leave, your paid holidays.",
    group: "pay-and-leave",
    fromHome: ["holiday", "vacation", "PTO"],
    example: '"I am on AL next week."',
  },
  {
    term: "PD leave",
    meaning: "Professional development leave, for courses and conferences.",
    group: "pay-and-leave",
    fromHome: ["study leave"],
  },
  {
    term: "Super",
    meaning: "Superannuation: retirement savings your employer pays into.",
    group: "pay-and-leave",
    fromHome: ["pension", "401(k)"],
  },
  {
    term: "TFN",
    meaning: "Tax file number, from the Australian Taxation Office.",
    group: "pay-and-leave",
    fromHome: ["national insurance number", "tax ID"],
  },
  { term: "Medicare", meaning: "Australia's public health insurance.", group: "pay-and-leave", fromHome: ["NHS"] },
  { term: "Arvo", meaning: "Afternoon.", group: "everyday", example: '"Late shift starts this arvo."' },
  { term: "Brekkie", meaning: "Breakfast.", group: "everyday" },
  { term: "Smoko", meaning: "A short break.", group: "everyday", fromHome: ["tea break", "coffee break"] },
  { term: "Ta", meaning: "Thank you.", group: "everyday", fromHome: ["cheers"] },
  { term: "No worries", meaning: "You are welcome, or that is fine.", group: "everyday" },
  { term: "Servo", meaning: "Petrol station.", group: "everyday", fromHome: ["gas station"] },
  { term: "Uni", meaning: "University.", group: "everyday" },
];

/** The Teaching glossary's own terms, kept in one place and reused here. */
const TRAINING_WORDS: readonly LocalWord[] = GLOSSARY.map(([term, meaning]) => ({
  term,
  meaning,
  group: "training" as const,
}));

export const LOCAL_WORDS: readonly LocalWord[] = [...OWN_WORDS, ...TRAINING_WORDS].sort((a, b) =>
  a.term.localeCompare(b.term, "en-AU"),
);

export interface LocalWordMatch {
  readonly word: LocalWord;
  /** The word from home the search matched, when it was not the local word itself. */
  readonly fromHome: string | null;
}

function normal(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, " ")
    .trim();
}

/**
 * Search the words. A local word or its meaning matching counts, and so does
 * a word from home ("bleep" finds Pager), which the page shows as "You searched".
 */
export function searchLocalWords(
  query: string,
  group: LocalWordGroup | "all" = "all",
  words: readonly LocalWord[] = LOCAL_WORDS,
): LocalWordMatch[] {
  const q = normal(query);
  const inGroup = words.filter((word) => group === "all" || word.group === group);
  if (!q) return inGroup.map((word) => ({ word, fromHome: null }));
  const termHits: LocalWordMatch[] = [];
  const homeHits: LocalWordMatch[] = [];
  const meaningHits: LocalWordMatch[] = [];
  for (const word of inGroup) {
    if (normal(word.term).includes(q)) termHits.push({ word, fromHome: null });
    else {
      const home = word.fromHome?.find((alt) => normal(alt).includes(q));
      if (home) homeHits.push({ word, fromHome: home });
      else if (normal(word.meaning).includes(q)) meaningHits.push({ word, fromHome: null });
    }
  }
  return [...termHits, ...homeHits, ...meaningHits];
}

/* -------------------------------------------------------- how it works */

export interface LadderStep {
  readonly who: string;
  readonly what: string;
  readonly when: string;
}

/** A clinical question: who to ask, and in what order. General, not a site rule. */
export const ESCALATION_LADDER: readonly LadderStep[] = [
  { who: "You", what: "Look it up, then ask early", when: "" },
  { who: "Your registrar", what: "The senior doctor in training on your team", when: "First call" },
  { who: "Your consultant", what: "Leads the team and signs off plans", when: "Daytime" },
  { who: "Consultant on call", what: "After hours and on weekends", when: "Nights" },
  { who: "Head of department", what: "If you are still worried", when: "Rarely" },
];

export interface StarterOffice {
  readonly name: string;
  readonly what: string;
}

/** Not clinical: go to the right office. Names only, never numbers. */
export const STARTER_OFFICES: readonly StarterOffice[] = [
  { name: "Medical Workforce", what: "Contract, pay, roster, leave" },
  { name: "Staff Health", what: "Immunisation, injury at work" },
  { name: "Medical Education Unit", what: "Supervision, teaching, support" },
  { name: "IT help desk", what: "Logins, passwords, pager" },
];

/* ------------------------------------------------------------ your dates */

export type StarterDateKind = "visa-end" | "registration" | "general-registration" | "supervision" | "other";

export interface StarterDateKindInfo {
  readonly kind: StarterDateKind;
  readonly label: string;
  /** The Requirements catalogue item this date is recorded against, if any. */
  readonly requirementId: string | null;
}

export const STARTER_DATE_KINDS: readonly StarterDateKindInfo[] = [
  { kind: "visa-end", label: "Visa end", requirementId: "img-visa-requirements" },
  { kind: "registration", label: "Registration renewal", requirementId: "medical-registration-renewal" },
  { kind: "general-registration", label: "General registration", requirementId: "provisional-to-general-registration" },
  { kind: "supervision", label: "Supervised practice", requirementId: "img-supervised-practice" },
  { kind: "other", label: "Other", requirementId: null },
];

export const STARTER_DATE_SLUG_PREFIX = "starter-date-";
export const STARTER_REMIND_CHOICES = [
  { days: 90, label: "3 months before" },
  { days: 42, label: "6 weeks before" },
  { days: 14, label: "2 weeks before" },
] as const;
export const STARTER_NAME_LIMIT = 60;

export function starterKindInfo(kind: StarterDateKind): StarterDateKindInfo {
  return STARTER_DATE_KINDS.find((info) => info.kind === kind)!;
}

function catalogueItem(id: string | null): AdminRequirementCatalogueItem | null {
  return id ? (ADMIN_REQUIREMENTS_CATALOGUE.find((item) => item.id === id) ?? null) : null;
}

export interface StarterDateRow {
  readonly key: string;
  readonly kind: StarterDateKind | "contract";
  readonly title: string;
  readonly date: string;
  /** Where to change it. */
  readonly href: string;
  readonly entry: OnCallEntry | null;
  /** Created from this pack, so Undo may delete it. */
  readonly ownedByPack: boolean;
}

function catalogueEntry(own: readonly OnCallEntry[], requirementId: string): OnCallEntry | null {
  const matches = own.filter(
    (entry) =>
      isComplianceEntry(entry) &&
      !entryNotForThisJob(entry) &&
      catalogueItemForEntry(entry)?.id === requirementId &&
      complianceExpiresOn(entry) !== undefined,
  );
  return matches.sort((a, b) => (complianceExpiresOn(b)! > complianceExpiresOn(a)! ? 1 : -1))[0] ?? null;
}

/** The pack's dates: the catalogue dates an overseas-trained doctor tracks, their own other dates, and the contract end. Soonest first. */
export function selectStarterDates(own: readonly OnCallEntry[]): StarterDateRow[] {
  const rows: StarterDateRow[] = [];
  for (const info of STARTER_DATE_KINDS) {
    if (!info.requirementId) continue;
    const entry = catalogueEntry(own, info.requirementId);
    const date = entry ? complianceExpiresOn(entry) : undefined;
    if (entry && date) {
      rows.push({
        key: entry.id,
        kind: info.kind,
        title: info.label,
        date,
        href: `/admin/renewals?item=${entry.id}`,
        entry,
        ownedByPack: entry.slug.startsWith(STARTER_DATE_SLUG_PREFIX),
      });
    }
  }
  for (const entry of own) {
    const date = complianceExpiresOn(entry);
    if (!date || !isComplianceEntry(entry) || !entry.slug.startsWith(STARTER_DATE_SLUG_PREFIX)) continue;
    if (catalogueItemForEntry(entry)) continue;
    rows.push({
      key: entry.id,
      kind: "other",
      title: entry.title,
      date,
      href: `/admin/renewals?item=${entry.id}`,
      entry,
      ownedByPack: true,
    });
  }
  const contract = selectContractEnd(own);
  const contractEnd = contract ? complianceExpiresOn(contract) : undefined;
  if (contract && contractEnd) {
    rows.push({
      key: contract.id,
      kind: "contract",
      title: "Contract end",
      date: contractEnd,
      href: "/admin/contract",
      entry: contract,
      ownedByPack: false,
    });
  }
  return rows.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? -1 : 1));
}

export interface VisaClash {
  readonly visaEnd: string;
  readonly contractEnd: string;
  readonly daysBefore: number;
}

/** The one comparison the pack makes: a visa end date before the contract end date. Never advice. */
export function visaContractClash(rows: readonly StarterDateRow[]): VisaClash | null {
  const visa = rows.find((row) => row.kind === "visa-end");
  const contract = rows.find((row) => row.kind === "contract");
  if (!visa || !contract || visa.date >= contract.date) return null;
  const a = utcDay(visa.date);
  const b = utcDay(contract.date);
  return {
    visaEnd: visa.date,
    contractEnd: contract.date,
    daysBefore: a === null || b === null ? 0 : Math.round(b - a),
  };
}

export interface StarterDateInput {
  readonly kind: StarterDateKind;
  readonly name: string;
  readonly date: string;
  readonly leadTimeDays: number;
}

export interface StarterDateErrors {
  date?: string;
  name?: string;
  nameProblem?: ReminderTextProblem;
}

export function validateStarterDate(input: StarterDateInput, today: string): StarterDateErrors {
  const errors: StarterDateErrors = {};
  const date = input.date.trim();
  if (!date) errors.date = "Type the date.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || utcDay(date) === null)
    errors.date = "Use the date picker, or type the date as YYYY-MM-DD.";
  else if (date < today) errors.date = "That date has passed. Reminders are for dates still to come.";
  if (input.kind === "other") {
    const name = input.name.trim();
    if (!name) errors.name = "Name the date, for example visa condition review.";
    else if (name.length > STARTER_NAME_LIMIT) errors.name = `Keep the name to ${STARTER_NAME_LIMIT} characters.`;
    else {
      // A date is often named for a body in capitals ("AHPRA", "WWC").
      const problem = checkPatientDetail(name, { allowCapitals: true });
      if (problem) errors.nameProblem = { ...problem, body: "Names here cannot hold patient details." };
    }
  }
  return errors;
}

export function starterDateHasErrors(errors: StarterDateErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * The create body for a new date. A catalogue kind reuses Renewals' own
 * draft and validation, so the row is the same row Renewals would write.
 */
export function buildStarterDateBody(input: StarterDateInput, slugSuffix: string): CreateBody | null {
  const info = starterKindInfo(input.kind);
  const item = catalogueItem(info.requirementId);
  const draft: OnCallEntry = item
    ? { ...catalogueItemDraftEntry(item), slug: `${STARTER_DATE_SLUG_PREFIX}${item.id}-${slugSuffix}` }
    : {
        id: "",
        section: "logistics",
        slug: `${STARTER_DATE_SLUG_PREFIX}${slugSuffix}`,
        title: input.name.trim(),
        subtitle: null,
        body: null,
        details: { kind: "compliance", category: "Personal" },
        linkedDocumentIds: [],
        tags: [],
        isPersonal: true,
        includeOnCard: false,
        sortOrder: 0,
        lastVerifiedAt: null,
        isOwn: true,
      };
  const result = buildRenewedEntryBody(draft, { newExpiresOn: input.date.trim(), proofNote: "" });
  if (!result.ok) return null;
  const {
    section,
    slug,
    title,
    subtitle,
    body,
    details,
    linkedDocumentIds,
    tags,
    isPersonal,
    includeOnCard,
    sortOrder,
    lastVerifiedAt,
  } = result.body;
  return {
    section,
    slug,
    title,
    subtitle,
    body,
    details: { ...(details as Record<string, unknown>), leadTimeDays: input.leadTimeDays },
    linkedDocumentIds,
    tags,
    isPersonal,
    includeOnCard,
    sortOrder,
    lastVerifiedAt,
  };
}

/** "Visa end saved. Reminder from 16 Oct." */
export function starterSavedLine(title: string, date: string, leadTimeDays: number): string {
  const from = utcDay(date);
  const remind = from === null ? null : new Date((from - leadTimeDays) * 86_400_000).toISOString().slice(0, 10);
  return remind ? `${title} saved. Shown on Admin Today from ${formatDateEcho(remind)}.` : `${title} saved.`;
}

/* ------------------------------------------------------ suggest a word */

export const STARTER_SUGGEST_LIMIT = 40;

/** The note "Suggest a word" copies. The doctor sends it; nothing is kept. */
export function starterWordSuggestion(word: string): string {
  return `Hi Medical Education,\n\nI heard the word "${word.trim()}" and did not know it. Could it go in the starter pack for new doctors?\n\nThanks`;
}

/* ---------------------------------------------------- hooks for main */

export function selectStarterNeedsYou(own: readonly OnCallEntry[], now: Date): AdminFeatureNeedsYouItem[] {
  const clash = visaContractClash(selectStarterDates(own));
  if (!clash || clash.visaEnd < perthCalendarDate(now)) return [];
  return [
    {
      id: `starter-visa-clash-${clash.visaEnd}`,
      title: "Your visa date is before your contract end. Talk to Medical Workforce",
      dueOn: clash.visaEnd,
      area: "admin",
      href: "/admin/new-job/starter",
      kind: "action",
    },
  ];
}

/** Work-search provider: the pack, and each local word (by its words from home too). */
export function starterPackSearchRecords(words: readonly LocalWord[] = LOCAL_WORDS): AdminFeatureSearchRecord[] {
  return [
    {
      id: "admin-starter",
      title: "Starter pack for overseas-trained doctors",
      area: "admin",
      keywords: ["overseas", "international", "IMG", "new to WA", "glossary", "visa", "who to ask"],
      href: "/admin/new-job/starter",
    },
    ...words.map((word) => ({
      id: `admin-starter-word-${normal(word.term).replace(/\s+/g, "-")}`,
      title: `${word.term}: ${word.meaning}`,
      area: "admin" as const,
      keywords: [word.term, ...(word.fromHome ?? [])],
      href: `/admin/new-job/starter?word=${encodeURIComponent(word.term)}#starter-words`,
    })),
  ];
}
