import { DOMAINS, RATING_LABELS, type GlobalRating, type Rating } from "@/lib/teaching/assessments/content";
import {
  epaWithAssessor,
  guestKind,
  meetingDate,
  stage,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import { overviewDoctors, type OverviewDoctor } from "@/lib/teaching/assessments/overview";
import { SAMPLE_DOCTOR, SAMPLE_SUPERVISOR, WINDOW_DAYS, type Ratings } from "@/lib/teaching/assessments/sample";

/*
 * The Director of Clinical Training's side of the made-up Assessments story (owner request 8 Oct 2026,
 * mock-up "Assessments: DCT and assessor views"). MADE-UP SAMPLE ONLY, in page memory.
 *
 * What it rests on (checked 9 Oct 2026, sources in work-mode-build/assessments-cla-sources-check.md):
 * - The AMC term assessment form ends with the DCT's signature and feedback, after the term supervisor
 *   and the doctor sign. By signing, the doctor acknowledges the discussion and "may respond in writing to
 *   the Director of Clinical Training within 14 days" if they disagree.
 * - Improving performance has three phases: informal discussion, a formal Improving Performance Action
 *   Plan (IPAP) agreed by the DCT, term supervisor and doctor, then managed supervised practice.
 * - Guest assessors have no CLA account and show as Unapproved until the MEU approves them.
 * - The Assessment Review Panel has at least three members and meets at least once a year. "The chair should
 *   generally be a senior doctor, but not the DCT" (AMC Guide to Assessment Review Panels, p.8), and
 *   "Prevocational doctors should not be included as panel members" (same guide, p.7).
 * - The form says "within 14 days" but not when they start, so the DCT's screens never show a last day.
 * - In CLA a submitted form is not edited by whoever submitted it. The MEU can return it to draft (CLA
 *   detailed FAQs v2.0, p.8 and p.13, and the doctors' training guide, p.19), so a sign-off is only undone
 *   in the few seconds of Undo.
 *
 * Every person and date here is invented. Dr Sam Karri's form joins the queue once the story has it signed
 * by both, so the DCT's step follows the supervisor's and the doctor's.
 */

export const RESPONSE_DAYS = 14;

export interface DctForm {
  readonly id: string;
  readonly doctor: string;
  readonly initials: string;
  readonly grade: "PGY1" | "PGY2";
  /** "Term 3 · General medicine" */
  readonly term: string;
  readonly dates: string;
  readonly supervisor: string;
  readonly global: GlobalRating | null;
  readonly ratings: Ratings;
  readonly discussed: string;
  readonly bothSigned: string;
  /**
   * The made-up last day the doctor can respond in writing, for the story's clock only. The AMC form says
   * "within 14 days" without saying when they start, so no screen shows it.
   */
  readonly responseUntil: string;
  readonly responseOpen: boolean;
  /** The supervisor flagged an improvement plan on the form. */
  readonly ipap: boolean;
  /** The rest of the AMC term form, so the DCT can read all of it before signing. */
  readonly strengths: string;
  readonly areas: string;
  /** Written feedback per domain, where the supervisor gave some. */
  readonly feedback: Readonly<Partial<Record<1 | 2 | 3 | 4, string>>>;
}

type FixedForm = Omit<DctForm, "responseOpen"> & {
  /** The made-up day (as `s.now`) from which the 14 days have run out. */
  readonly closesFrom: number;
};

const FIXED_FORMS: readonly FixedForm[] = [
  {
    id: "ella-t3",
    doctor: "Dr Charlie Balga",
    initials: "CB",
    grade: "PGY1",
    term: "Term 3 · Emergency",
    dates: "22 Jun to 30 Aug",
    supervisor: "Dr Morgan Grevillea",
    global: "sat",
    ratings: { 1: 3, 2: 4, 3: 3, 4: 3 },
    discussed: "Wed 23 Sep",
    bothSigned: "Fri 25 Sep",
    responseUntil: "Fri 9 Oct",
    closesFrom: 0,
    ipap: false,
    strengths: "Calm in a busy department and quick to ask for help.",
    areas: "Shorter handovers at the end of a night shift.",
    feedback: {},
  },
  {
    id: "noah-t3",
    doctor: "Dr Lou Quandong",
    initials: "LQ",
    grade: "PGY1",
    term: "Term 3 · General medicine",
    dates: "22 Jun to 30 Aug",
    supervisor: "Dr Quinn Wandoo",
    global: "sat",
    ratings: { 1: 4, 2: 3, 3: 3, 4: 4 },
    discussed: "Thu 27 Aug",
    bothSigned: "Fri 28 Aug",
    responseUntil: "Fri 11 Sep",
    closesFrom: -1,
    ipap: false,
    strengths: "Thorough ward rounds and clear notes.",
    areas: "Escalate a deteriorating patient sooner.",
    feedback: {},
  },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A made-up window day plus a number of days, as "Fri 20 Nov". The story's year is 2026. */
export function windowDayPlus(day: number, days: number): string {
  const d = WINDOW_DAYS[day];
  if (!d) return "";
  const at = new Date(Date.UTC(2026, MONTHS.indexOf(d[2] as (typeof MONTHS)[number]), d[1] + days));
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

export const SAM_FORM_ID = "sam-t4";

/** Dr Sam Karri's end-of-term form, once both have signed it. */
function samForm(s: AssessmentsState): DctForm | null {
  if (stage(s) !== "doc-signed" || !s.sigs.doc) return null;
  return {
    id: SAM_FORM_ID,
    doctor: SAMPLE_DOCTOR.name,
    initials: SAMPLE_DOCTOR.initials,
    grade: SAMPLE_DOCTOR.grade,
    term: "Term 4 · Psychiatry",
    dates: "31 Aug to 8 Nov",
    supervisor: SAMPLE_SUPERVISOR.name,
    global: s.sup.global,
    ratings: s.sup.ratings,
    discussed: meetingDate(s) ?? s.sigs.doc.date,
    bothSigned: s.sigs.doc.date,
    responseUntil: windowDayPlus(s.sigs.doc.day, RESPONSE_DAYS),
    // The story's last day is Fri 6 Nov, so Sam's 14 days are always still running.
    responseOpen: true,
    ipap: s.sup.ipap,
    strengths: s.sup.strengths.trim(),
    areas: s.sup.areas.trim(),
    feedback: Object.fromEntries(
      Object.entries(s.sup.feedback)
        .map(([n, text]) => [n, text.trim()] as const)
        .filter(([, text]) => text),
    ),
  };
}

/** Every end-of-term form that reaches the DCT, the story's own first. */
export function dctForms(s: AssessmentsState): DctForm[] {
  const fixed = FIXED_FORMS.map(({ closesFrom, ...f }) => ({ ...f, responseOpen: s.now < closesFrom }));
  const sam = samForm(s);
  return sam ? [sam, ...fixed] : fixed;
}

export function dctForm(s: AssessmentsState, id: string | null): DctForm | null {
  return dctForms(s).find((f) => f.id === id) ?? null;
}

/* ---------------------------------------------------------- sign-offs */

export const DCT_FEEDBACK_MAX = 300;

export type DctSignature = { readonly date: string; readonly feedback: string };
export type DctState = { readonly signed: Readonly<Record<string, DctSignature>> };
export type DctAction =
  { type: "dct-sign"; id: string; date: string; feedback: string } | { type: "dct-unsign"; id: string };

export const initialDctState = (): DctState => ({ signed: {} });

export function dctReducer(state: DctState, action: DctAction): DctState {
  switch (action.type) {
    case "dct-sign": {
      if (state.signed[action.id]) return state;
      const feedback = action.feedback.trim().slice(0, DCT_FEEDBACK_MAX);
      return { signed: { ...state.signed, [action.id]: { date: action.date, feedback } } };
    }
    case "dct-unsign": {
      if (!state.signed[action.id]) return state;
      return { signed: Object.fromEntries(Object.entries(state.signed).filter(([id]) => id !== action.id)) };
    }
  }
}

/** The DCT's sign-off on Dr Sam Karri's own form, once given, for the doctor's and supervisor's screens. */
export function samSignOff(d: DctState): DctSignature | null {
  return d.signed[SAM_FORM_ID] ?? null;
}

/** The forms still waiting for the DCT. */
export function dctWaiting(s: AssessmentsState, d: DctState): DctForm[] {
  return dctForms(s).filter((f) => !d.signed[f.id]);
}

/* ---------------------------------------------------------- improvement plans */

export interface PlanAction {
  readonly outcome: string;
  readonly action: string;
  readonly who: string;
  readonly by: string;
}

export interface ImprovementPlan {
  readonly id: string;
  readonly doctor: string;
  readonly initials: string;
  readonly grade: "PGY1" | "PGY2";
  readonly supervisor: string;
  /** 1 informal discussion, 2 formal plan (IPAP), 3 managed supervised practice. */
  readonly phase: 1 | 2 | 3;
  readonly review: string;
  readonly actions: readonly PlanAction[];
}

export const IMPROVEMENT_PHASES: readonly { n: 1 | 2 | 3; title: string; detail: string }[] = [
  {
    n: 1,
    title: "Informal discussion",
    detail: "The term supervisor and doctor talk it through, write it down and set a time to review.",
  },
  {
    n: 2,
    title: "Formal plan",
    detail: "You, the term supervisor and the doctor agree an Improving Performance Action Plan with dated actions.",
  },
  {
    n: 3,
    title: "Managed supervised practice",
    detail: "For continuing concern. You decide, the Director of Medical Services is told and the panel meets.",
  },
];

function outcomeName(id: string): string {
  for (const d of DOMAINS) {
    const found = d.outcomes.find((o) => o.id === id);
    if (found) return `${found.id} ${found.name}`;
  }
  return id;
}

export const IMPROVEMENT_PLANS: readonly ImprovementPlan[] = [
  {
    id: "ravi",
    doctor: "Dr Rowan Sheoak",
    initials: "RS",
    grade: "PGY1",
    supervisor: "Dr Quinn Wandoo",
    phase: 2,
    review: "Mon 19 Oct",
    actions: [
      {
        outcome: outcomeName("1.1"),
        action: "Handover to the evening registrar with ISBAR, watched twice a week",
        who: "Term supervisor",
        by: "Fri 16 Oct",
      },
      {
        outcome: outcomeName("2.8"),
        action: "Jobs list checked with the registrar at 3 pm each day, and two extra EPA 4 assessments",
        who: "Doctor",
        by: "Mon 19 Oct",
      },
    ],
  },
];

export function improvementPlan(id: string | null): ImprovementPlan | null {
  return IMPROVEMENT_PLANS.find((p) => p.id === id) ?? null;
}

/* ---------------------------------------------------------- the rest of the service */

export interface GuestAssessor {
  /** Null for a guest the story asked by role only. */
  readonly name: string | null;
  readonly role: string;
  readonly what: string;
}

/** Made-up guest assessors waiting for the MEU. The DCT sees them so nothing is missed, but cannot approve. */
export const GUEST_ASSESSORS: readonly GuestAssessor[] = [
  { name: "Alex Tuart", role: "Clinical nurse specialist", what: "EPA 2 for Dr Drew Hakea" },
  { name: "Kim Jarrah", role: "Pharmacist", what: "EPA 3 for Dr Taylor Kwongan" },
];

/**
 * The guest assessors the DCT sees: the made-up ones, then any guest Dr Sam Karri asked in the story whose
 * request is still open. A guest has no CLA account, so CLA shows them as Unapproved until the MEU approves
 * them (CLA detailed FAQs v2.0, p.5, and the supervisors' training guide, p.17). The story gives them no
 * name, so they show by role.
 */
export function guestAssessors(s: AssessmentsState): GuestAssessor[] {
  const story = s.epaRequests
    .filter((r) => r.who === "guest" && epaWithAssessor(r))
    .map((r) => ({ name: null, role: guestKind(r.guest).title, what: `EPA ${r.epa} for ${SAMPLE_DOCTOR.name}` }));
  return [...GUEST_ASSESSORS, ...story];
}

export const PANEL_FACTS: readonly string[] = [
  "At least three members. The chair should generally be a senior doctor, but not the DCT.",
  "Prevocational doctors (PGY1 and PGY2) are never panellists.",
  "Meets at least once a year to judge whether each doctor has met the outcomes.",
  "Looks mainly at EPAs, end-of-term forms and the record of learning.",
  "Can ask for more information, recommend progression, recommend delayed progression with actions, or refer to the Director of Medical Services.",
];

/** The made-up panel date, and how many doctors it covers. */
export const PANEL_DATE = "Fri 27 Nov";

/** Doctors with something overdue this term, from the term overview's own rows. */
export function dctBehind(s: AssessmentsState): OverviewDoctor[] {
  return overviewDoctors(s).filter((r) => r.bucket === "overdue");
}

export function ratingWords(rating: Rating | null): string {
  return rating === null ? "Not rated" : RATING_LABELS[rating - 1];
}
