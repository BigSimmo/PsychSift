import {
  DOMAINS,
  type DomainNumber,
  type EpaNumber,
  type GlobalRating,
  type Rating,
  type CaseComplexity,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";

/*
 * The made-up records behind Teaching › Assessments. Every person, date and answer
 * here is invented. PsychSift has nowhere to keep real assessment records yet, so
 * the page only ever runs on these, in page memory, and says so on screen.
 *
 * The made-up calendar: a PGY1 year from Mon 2 Feb 2026, now in term 4
 * (Psychiatry, 31 Aug to 8 Nov). "Today" starts at Mon 5 Oct, week 6, and can be
 * moved into the end-of-term booking window to walk the rest of the steps.
 */

export const SAMPLE_DOCTOR = { name: "Dr Sam Karri", first: "Sam", initials: "SK", grade: "PGY1" } as const;
export const SAMPLE_SUPERVISOR = {
  name: "Dr Robin Wattle",
  short: "Dr Wattle",
  initials: "RW",
  role: "Consultant psychiatrist · term supervisor",
} as const;
export const SAMPLE_REGISTRAR = { name: "Dr Jo Banksia", role: "Psychiatry registrar" } as const;

export type TermId = "t1" | "t2" | "t3" | "t4" | "t5";
export type SampleTerm = {
  id: TermId;
  n: number;
  name: string;
  category: "A" | "B" | "C" | "D";
  categoryName: string;
  from: string;
  to: string;
  weeks: number;
  status: "done" | "current" | "next";
  supervisor: string;
  midSigned?: string;
  signed?: string;
};

export const SAMPLE_TERMS: readonly SampleTerm[] = [
  {
    id: "t1",
    n: 1,
    name: "Emergency Medicine",
    category: "A",
    categoryName: "Undifferentiated illness",
    from: "2 Feb",
    to: "12 Apr",
    weeks: 10,
    status: "done",
    supervisor: "Dr Alex Jarrah",
    midSigned: "6 Mar",
    signed: "21 Apr",
  },
  {
    id: "t2",
    n: 2,
    name: "General Surgery",
    category: "D",
    categoryName: "Peri-operative / procedural",
    from: "13 Apr",
    to: "21 Jun",
    weeks: 10,
    status: "done",
    supervisor: "Dr Casey Marri",
    midSigned: "15 May",
    signed: "30 Jun",
  },
  {
    id: "t3",
    n: 3,
    name: "General Medicine",
    category: "C",
    categoryName: "Acute and critical illness",
    from: "22 Jun",
    to: "30 Aug",
    weeks: 10,
    status: "done",
    supervisor: "Dr Jordan Tuart",
    midSigned: "24 Jul",
    signed: "7 Sep",
  },
  {
    id: "t4",
    n: 4,
    name: "Psychiatry",
    category: "B",
    categoryName: "Chronic illness",
    from: "31 Aug",
    to: "8 Nov",
    weeks: 10,
    status: "current",
    supervisor: "Dr Robin Wattle",
  },
  {
    id: "t5",
    n: 5,
    name: "Geriatric Medicine",
    category: "B",
    categoryName: "Chronic illness",
    from: "9 Nov",
    to: "31 Jan 2027",
    weeks: 12,
    status: "next",
    supervisor: "Dr Riley Boronia",
  },
];

export const CURRENT_TERM = SAMPLE_TERMS[3]!;

export function sampleTerm(id: string | null | undefined): SampleTerm {
  return SAMPLE_TERMS.find((term) => term.id === id) ?? CURRENT_TERM;
}

export type EpaRecord = {
  term: TermId;
  epa: EpaNumber;
  by: string;
  role: string;
  level: SupervisionLevel;
  complexity?: CaseComplexity;
};

export const SAMPLE_EPA_RECORDS: readonly EpaRecord[] = [
  { term: "t1", epa: 1, by: "Dr Alex Jarrah", role: "consultant", level: "proximal" },
  { term: "t1", epa: 2, by: "Dr Kim Yate", role: "registrar", level: "direct" },
  { term: "t2", epa: 1, by: "Dr Casey Marri", role: "consultant", level: "minimal" },
  { term: "t2", epa: 3, by: "Dr Lee Mallee", role: "registrar", level: "proximal" },
  { term: "t2", epa: 4, by: "Dr Casey Marri", role: "consultant", level: "minimal" },
  { term: "t3", epa: 1, by: "Dr Jordan Tuart", role: "consultant", level: "minimal" },
  { term: "t3", epa: 2, by: "Dr Pat Tingle", role: "registrar", level: "proximal" },
  { term: "t4", epa: 3, by: "Dr Robin Wattle", role: "term supervisor", level: "minimal" },
];

/** The end-of-term booking window: weekday, date, month, week of term. */
export const WINDOW_DAYS: readonly [string, number, string, number][] = [
  ["Mon", 26, "Oct", 9],
  ["Tue", 27, "Oct", 9],
  ["Wed", 28, "Oct", 9],
  ["Thu", 29, "Oct", 9],
  ["Fri", 30, "Oct", 9],
  ["Mon", 2, "Nov", 10],
  ["Tue", 3, "Nov", 10],
  ["Wed", 4, "Nov", 10],
  ["Thu", 5, "Nov", 10],
  ["Fri", 6, "Nov", 10],
];

/** Days the made-up doctor is rostered on nights (Thu 29 and Fri 30 Oct). */
export const NIGHT_DAYS: ReadonlySet<number> = new Set([3, 4]);

export const MEETING_TIMES = ["08:00", "12:30", "13:00", "14:00", "14:30", "15:00"] as const;

export const INITIAL_AVAILABILITY: Readonly<Record<number, readonly string[]>> = {
  1: ["14:00", "14:30"],
  2: ["14:00", "14:30", "15:00"],
  3: ["08:00"],
  5: ["13:00"],
  7: ["14:00", "14:30"],
  8: ["08:00"],
};

export type Ticks = Record<DomainNumber, string[]>;
export type Ratings = Record<DomainNumber, Rating | null>;

function ticksAllExcept(except: readonly string[]): Ticks {
  const ticks = {} as Ticks;
  for (const d of DOMAINS) ticks[d.n] = d.outcomes.map((o) => o.id).filter((id) => !except.includes(id));
  return ticks;
}

type ExampleAnswers = {
  sources: string[];
  ticks: Ticks;
  ratings: Record<DomainNumber, Rating>;
  feedback: Record<DomainNumber, string>;
  global: GlobalRating;
  strengths: string;
  areas: string;
};

/** "Fill with example answers": made-up wording about skills, never about patients. */
export const EXAMPLE_ANSWERS: { self: ExampleAnswers; sup: ExampleAnswers } = {
  self: {
    sources: ["Registrars", "Nursing staff", "EPAs", "Learning record"],
    ticks: ticksAllExcept(["1.3", "1.6", "1.9", "2.7", "3.4", "3.5", "4.3", "4.4"]),
    ratings: { 1: 3, 2: 4, 3: 3, 4: 3 },
    feedback: {
      1: "More confident with mental state exams and risk assessments. Still slow writing up admissions after hours.",
      2: "Reliable and on time. Asked for help early on busy days.",
      3: "Getting better at involving families and the GP in discharge plans.",
      4: "Read up on lithium monitoring after the teaching session.",
    },
    global: "sat",
    strengths: "Calm with distressed patients and families. Clear handovers to the after-hours team.",
    areas: "Presenting a full formulation on ward round. Speed with admission paperwork.",
  },
  sup: {
    sources: ["Nursing staff", "Registrars", "Allied health", "EPAs"],
    ticks: ticksAllExcept(["1.3", "1.6", "2.7", "3.4", "3.5", "4.4"]),
    ratings: { 1: 4, 2: 4, 3: 3, 4: 3 },
    feedback: {
      1: "Thorough, kind assessments. Risk assessments are well reasoned and documented.",
      2: "Punctual, takes feedback well, and supports the medical students.",
      3: "Good at involving families. Next step is linking in community supports earlier.",
      4: "Good use of guidelines. Could join the ward audit next term.",
    },
    global: "sat",
    strengths:
      "Careful, well-reasoned risk assessments, written up clearly. Supports the medical students on the ward. Acts on feedback quickly.",
    areas:
      "Present a full formulation on ward round, not just the history. Keep building confidence with lithium and clozapine monitoring.",
  },
};

export type PastForm = {
  ratings: Record<DomainNumber, Rating>;
  ticks: Ticks;
  sources: string[];
  feedback: Partial<Record<DomainNumber, string>>;
  strengths: string;
  areas: string;
  global: GlobalRating | null;
};

/** This term's mid-term, signed Fri 2 Oct. */
export const SAMPLE_MIDTERM: { date: string; self: PastForm; sup: PastForm } = {
  date: "Fri 2 Oct",
  self: {
    ratings: { 1: 3, 2: 3, 3: 3, 4: 2 },
    ticks: ticksAllExcept([
      "1.3",
      "1.5",
      "1.6",
      "1.8",
      "1.9",
      "2.2",
      "2.4",
      "2.6",
      "2.7",
      "3.1",
      "3.3",
      "3.4",
      "3.5",
      "4.2",
      "4.3",
      "4.4",
    ]),
    sources: [],
    feedback: {},
    strengths: "",
    areas: "",
    global: null,
  },
  sup: {
    ratings: { 1: 3, 2: 4, 3: 3, 4: 3 },
    ticks: ticksAllExcept(["1.3", "1.6", "1.9", "2.4", "2.6", "2.7", "3.3", "3.4", "3.5", "4.3", "4.4"]),
    sources: ["Nursing staff", "Registrars", "EPAs"],
    feedback: {
      1: "Settling in well. Assessments are careful.",
      2: "Reliable and keen to learn.",
      3: "Good with families.",
      4: "Uses guidelines well.",
    },
    strengths: "Settled into the team quickly. Warm and careful with families.",
    areas: "Write a short formulation for each new admission. Ask for an EPA 1 in the next fortnight.",
    global: null,
  },
};

const PAST_TICKS = ticksAllExcept(["1.3", "1.6", "2.7", "3.4", "3.5", "4.4"]);
const PAST_SOURCES = ["Nursing staff", "Registrars", "EPAs"];
const past = (
  ratings: Record<DomainNumber, Rating>,
  strengths: string,
  areas: string,
  global: GlobalRating | null,
): PastForm => ({ ratings, ticks: PAST_TICKS, sources: PAST_SOURCES, feedback: {}, strengths, areas, global });

/** Earlier terms' signed forms, for "All assessments" and their PDFs. */
export const SAMPLE_PAST_FORMS: Record<"t1" | "t2" | "t3", { mid: PastForm; eot: PastForm }> = {
  t1: {
    mid: past(
      { 1: 3, 2: 3, 3: 3, 4: 3 },
      "Quick to learn the department's systems.",
      "Speed up triage decisions with simple presentations.",
      null,
    ),
    eot: past(
      { 1: 3, 2: 4, 3: 3, 4: 3 },
      "Calm in resuscitation. Clear, structured handovers.",
      "Commit to a plan sooner and escalate early when unsure.",
      "sat",
    ),
  },
  t2: {
    mid: past(
      { 1: 3, 2: 3, 3: 3, 4: 3 },
      "Organised ward lists and reliable follow-up.",
      "More confidence with post-operative fluid plans.",
      null,
    ),
    eot: past(
      { 1: 4, 2: 4, 3: 3, 4: 3 },
      "Excellent ward organisation. Safe prescribing of fluids and analgesia.",
      "Present cases concisely on the morning round.",
      "sat",
    ),
  },
  t3: {
    mid: past(
      { 1: 3, 2: 4, 3: 3, 4: 3 },
      "Thorough admissions and good rapport with families.",
      "Recognise the deteriorating patient earlier overnight.",
      null,
    ),
    eot: past(
      { 1: 4, 2: 4, 3: 4, 4: 3 },
      "Thorough admissions, sound medication reconciliation, and strong teamwork.",
      "Lead a family meeting with support next term.",
      "sat",
    ),
  },
};

/** Suggested goals, one per domain; the two lowest-rated domains come first. */
export const GOAL_SUGGESTIONS: Record<DomainNumber, string> = {
  1: "Ask for an EPA 1 on a new admission and present the formulation yourself.",
  2: "Lead one family meeting, with your supervisor there.",
  3: "Link one patient with community supports before discharge and note what helped.",
  4: "Join the ward audit or bring one paper to journal club.",
};

export const SAMPLE_REGISTRAR_NOTE =
  "Reliable on the ward and good with families. Has grown a lot in risk assessments since mid-term.";

/** Sick, personal and carer's leave used so far this year, and the level the panel watches. */
export const SAMPLE_LEAVE = { used: 4, limit: 10 } as const;
