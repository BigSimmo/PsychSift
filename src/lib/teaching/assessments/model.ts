import {
  DOMAIN_NUMBERS,
  DOMAINS,
  EVIDENCE_SOURCES,
  LAST_FORM_STEP,
  domain,
  type CaseComplexity,
  type DomainNumber,
  type EpaNumber,
  type EpaObserved,
  type GlobalRating,
  type Rating,
  SUPERVISION_LEVELS,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import {
  EXAMPLE_ANSWERS,
  GOAL_SUGGESTIONS,
  INITIAL_AVAILABILITY,
  NIGHT_DAYS,
  SAMPLE_EPA_RECORDS,
  SAMPLE_REGISTRAR,
  SAMPLE_SUPERVISOR,
  SAMPLE_TERMS,
  WINDOW_DAYS,
  termKinds,
  type EpaRecord,
  type Ratings,
  type SampleTerm,
  type TermId,
  type Ticks,
} from "@/lib/teaching/assessments/sample";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/*
 * Teaching › Assessments: the end-of-term story as pure functions over one state.
 * Nothing here reads a clock or the network. `now` is the made-up date: -1 is
 * Mon 5 Oct (week 6), 0 to 9 are the ten weekdays of the booking window.
 */

export type Who = "self" | "sup";

export type AssessmentForm = {
  status: "new" | "draft" | "done";
  step: number;
  sources: string[];
  other: string;
  ticks: Ticks;
  ratings: Ratings;
  feedback: Record<DomainNumber, string>;
  global: GlobalRating | null;
  strengths: string;
  areas: string;
  /**
   * Supervisor ticked "Tell the MEU (you do this yourself)" about an improvement plan. Advisory only: the AMC term
   * assessment form says a 1 or 2 means "Liaise with the MEU or DCT to complete an Improving Performance Action
   * Plan" (AMC Prevocational training term assessment form, e-portfolio and paper versions). It never blocks.
   */
  ipap: boolean;
  fullWording: boolean;
};

/** A drawn signature as line data, so it is redrawn in the reader's own text colour in either theme. */
export type SignatureInk = { width: number; height: number; path: string };
export type Signature = { typed: string; image: SignatureInk | null; date: string; day: number };

/**
 * Where an EPA request stands. CLA itself has no decline or send back button: there the assessor tells the
 * doctor, and the doctor deletes the emailed form. These example states show that conversation.
 * - requested: with the assessor.
 * - not-yet: the assessor can't assess it yet (hasn't seen enough). It stays with them.
 * - sent-back: the assessor returned it to the doctor with a note, so the doctor can ask someone else.
 * - cancelled: the doctor cancelled it. Kept in place, never shown, so every other request keeps its index.
 * - done: recorded with a supervision level.
 */
export type EpaRequestStatus = "requested" | "not-yet" | "sent-back" | "cancelled" | "done";

/**
 * Someone else the doctor asks, by the assessor roles on the AMC EPA form ("Specialist or equivalent
 * (other)", "Nurse/ nurse practitioner", "Pharmacist", "Other"). They answer from an emailed link with no
 * CLA account, so CLA marks them Unapproved until the MEU approves them.
 */
export type GuestKind = "specialist" | "nurse" | "pharmacist" | "other";

export const GUEST_KINDS: readonly { id: GuestKind; title: string; name: string }[] = [
  { id: "specialist", title: "Specialist", name: "another specialist" },
  { id: "nurse", title: "Nurse", name: "a nurse" },
  { id: "pharmacist", title: "Pharmacist", name: "a pharmacist" },
  { id: "other", title: "Other", name: "another trained assessor" },
];

/** The rest of the AMC EPA form: how the assessor knows, whether the level fits the year, and feedback. */
export type EpaFeedback = {
  /** "I directly observed some part of it", or a team member who was there told them. */
  observed?: EpaObserved;
  /** Was the rating right for the level of training? */
  rightLevel?: boolean;
  better?: string;
  goal?: string;
  /**
   * The outcome statements the assessor confirmed, out of those the doctor ticked. The doctor ticks the outcome
   * statements they believe were shown [CLA-FS-D], and the assessor ticks or unticks them [CLA-FS-A]. In CLA the
   * confirmed ones update the doctor's Progress View [CLA-FS-A].
   */
  outcomes?: string[];
};

/** The longest free-text EPA feedback: a few sentences, never a case summary. */
export const EPA_FEEDBACK_MAX = 300;

export type EpaRequest = {
  epa: EpaNumber;
  who: "sup" | "reg" | "guest";
  /** With who "guest": which kind of assessor. */
  guest?: GuestKind;
  status: EpaRequestStatus;
  level?: SupervisionLevel;
  /** Case complexity, optional, as the EPA form records it. */
  complexity?: CaseComplexity;
  /** "One thing to keep doing" (on the full form, "What went well"), optional, written by the assessor. */
  note?: string;
  feedback?: EpaFeedback;
  /** The assessor's words to the doctor with "Can't assess yet" (optional) or "Send back" (required). */
  reply?: string;
  /** Recorded by the supervisor without a request from the doctor (the dock's Record EPA). */
  direct?: boolean;
};

/** The longest assessor reply: a sentence or two, never a case summary. */
export const EPA_REPLY_MAX = 200;

export type AssessmentsState = {
  now: number;
  self: AssessmentForm;
  sup: AssessmentForm;
  request: { sent: boolean; sentOn: number; message: string; registrar: boolean };
  share: { epa: boolean; mid: boolean; log: boolean };
  booking: { day: number; time: string } | null;
  meetingDay: number | null;
  avail: Record<number, string[]>;
  sigs: { sup: Signature | null; doc: Signature | null };
  epaRequests: EpaRequest[];
  /**
   * No longer one of the doctor's steps. In CLA the supervisor submits the end-of-term form and the doctor
   * acknowledges it there, then the DCT completes DCT sign-off (CLA Training Guide for Prevocational Doctors,
   * Release 2.0, p.12, and the supervisors' guide, p.39), so nobody emails a PDF. Kept so older screens compile.
   */
  sentToMeu: boolean;
  remindWhenOpen: boolean;
  addToMyDay: boolean;
  remindDayBefore: boolean;
  disagreeDraft: string;
};

export function blankForm(): AssessmentForm {
  return {
    status: "new",
    step: 0,
    sources: [],
    other: "",
    ticks: { 1: [], 2: [], 3: [], 4: [] },
    ratings: { 1: null, 2: null, 3: null, 4: null },
    feedback: { 1: "", 2: "", 3: "", 4: "" },
    global: null,
    strengths: "",
    areas: "",
    ipap: false,
    fullWording: false,
  };
}

export function initialAssessmentsState(): AssessmentsState {
  const avail: Record<number, string[]> = {};
  for (const [day, times] of Object.entries(INITIAL_AVAILABILITY)) avail[Number(day)] = [...times];
  return {
    now: -1,
    self: blankForm(),
    sup: blankForm(),
    request: { sent: false, sentOn: -1, message: "", registrar: false },
    share: { epa: true, mid: true, log: false },
    booking: null,
    meetingDay: null,
    avail,
    sigs: { sup: null, doc: null },
    epaRequests: [],
    sentToMeu: false,
    remindWhenOpen: false,
    addToMyDay: true,
    remindDayBefore: true,
    disagreeDraft: "",
  };
}

/* ---------------- Dates ---------------- */

export function dayLabel(day: number): string {
  const d = WINDOW_DAYS[day];
  return d ? `${d[0]} ${d[1]} ${d[2]}` : "Mon 5 Oct";
}

export const todayLabel = (s: AssessmentsState) => (s.now < 0 ? "Mon 5 Oct" : dayLabel(s.now));
export const windowOpen = (s: AssessmentsState) => s.now >= 0;
export const termWeek = (s: AssessmentsState) => (s.now < 0 ? 6 : WINDOW_DAYS[s.now]![3]);
/** Weeks of the 47-week year done: three 10-week terms, plus this term's full weeks so far. */
export const weeksDone = (s: AssessmentsState) => 30 + termWeek(s) - 1;
export const YEAR_WEEKS = 47;

export function bookingLabel(booking: { day: number; time: string }): string {
  return `${dayLabel(booking.day)}, ${booking.time}`;
}

export function bookableDay(s: AssessmentsState, day: number): boolean {
  return windowOpen(s) && day >= s.now && !NIGHT_DAYS.has(day) && (s.avail[day]?.length ?? 0) > 0;
}

export function dayStatus(s: AssessmentsState, day: number): string {
  if (day < Math.max(0, s.now)) return "Past";
  if (NIGHT_DAYS.has(day)) return "Nights";
  const n = s.avail[day]?.length ?? 0;
  return n ? `${n} time${n > 1 ? "s" : ""}` : "None";
}

/* ---------------- The end-of-term story ---------------- */

export type Stage =
  "start" | "self-draft" | "self-done" | "requested" | "sup-draft" | "ready" | "met" | "sup-signed" | "doc-signed";

export const selfDone = (s: AssessmentsState) => s.self.status === "done";
export const supReady = (s: AssessmentsState) => s.sup.status === "done";
export const meetingHeld = (s: AssessmentsState) => s.meetingDay !== null;
export const meetingDate = (s: AssessmentsState) => (s.meetingDay === null ? null : dayLabel(s.meetingDay));
/** The doctor's self-assessment locks once the supervisor has seen it. */
export const selfLocked = (s: AssessmentsState) => supReady(s);
export const supLocked = (s: AssessmentsState) => s.sigs.sup !== null;

/**
 * Where the end-of-term form is up to. In CLA "End of Term Assessment can only be initiated by a supervisor
 * linked to the prevocational doctor" (CLA Training Guide for Prevocational Doctors, Release 2.0, p.12), so the
 * supervisor's draft starts whether or not the doctor has said they're ready.
 */
export function stage(s: AssessmentsState): Stage {
  if (s.sigs.doc) return "doc-signed";
  if (s.sigs.sup) return "sup-signed";
  if (meetingHeld(s)) return "met";
  if (supReady(s)) return "ready";
  if (s.sup.status === "draft") return "sup-draft";
  if (s.request.sent) return "requested";
  if (selfDone(s)) return "self-done";
  if (s.self.status === "draft") return "self-draft";
  return "start";
}

/**
 * Every EPA recorded this year. A guest assessor's answer is marked `unapproved`: CLA creates it "as a Guest
 * Assessor with a status of Unapproved" until the MEU approves it (CLA detailed FAQs v2.0, p.5, and the
 * supervisors' training guide, Release 2.0, p.17).
 */
export function epaRecords(s: AssessmentsState): EpaRecord[] {
  const done = s.epaRequests
    .filter((r) => r.status === "done" && r.level)
    .map<EpaRecord>((r) => ({
      term: "t4",
      epa: r.epa,
      by: r.who === "sup" ? SAMPLE_SUPERVISOR.name : r.who === "reg" ? SAMPLE_REGISTRAR.name : "Guest assessor",
      role:
        r.who === "sup" ? "term supervisor" : r.who === "reg" ? "registrar" : guestKind(r.guest).title.toLowerCase(),
      level: r.level!,
      ...(r.complexity ? { complexity: r.complexity } : {}),
      ...(r.who === "guest" ? { unapproved: true } : {}),
    }));
  return [...SAMPLE_EPA_RECORDS, ...done];
}

export const epasInTerm = (s: AssessmentsState, term: TermId) => epaRecords(s).filter((r) => r.term === term);
export const epa1ThisTerm = (s: AssessmentsState) => epasInTerm(s, "t4").some((r) => r.epa === 1);
/** Still with the assessor: asked, or "can't assess yet". */
export const epaWithAssessor = (r: EpaRequest) => r.status === "requested" || r.status === "not-yet";
/** Shown on the doctor's side as open: with the assessor, or sent back and not yet dealt with. */
export const epaOpenForDoctor = (r: EpaRequest) => epaWithAssessor(r) || r.status === "sent-back";
export const pendingEpaRequest = (s: AssessmentsState, epa: EpaNumber) =>
  s.epaRequests.find((r) => r.epa === epa && epaWithAssessor(r));
export const sentBackEpaRequest = (s: AssessmentsState, epa: EpaNumber) =>
  s.epaRequests.find((r) => r.epa === epa && r.status === "sent-back");
export const guestKind = (id: GuestKind | undefined) => GUEST_KINDS.find((k) => k.id === id) ?? GUEST_KINDS[3]!;

export const assessorName = (r: Pick<EpaRequest, "who" | "guest">) =>
  r.who === "sup" ? SAMPLE_SUPERVISOR.name : r.who === "reg" ? SAMPLE_REGISTRAR.name : guestKind(r.guest).name;

/** The words a screen shows beside a guest assessor's EPA until the MEU approves it. */
export const UNAPPROVED_WORDS = "Unapproved until the MEU approves";

/**
 * An EPA that counts as this term's one from "the primary clinical supervisor or an equivalent specialist"
 * (AMC Section 3A, Assessment approach, p.50).
 */
export const fromSpecialist = (r: Pick<EpaRecord, "role">) =>
  r.role === "consultant" || r.role === "term supervisor" || r.role === "specialist";

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** How the doctor's side words an open request, and its tag ("Not yet", "Sent back"). */
export function epaRequestWords(r: EpaRequest): { line: string; tag: string | null } {
  const name = assessorName(r);
  const said = r.reply ? ` "${r.reply}"` : "";
  if (r.status === "not-yet") return { line: `${capital(name)} can't assess it yet.${said}`, tag: "Not yet" };
  if (r.status === "sent-back") return { line: `Sent back by ${name}.${said}`, tag: "Sent back" };
  return { line: `Requested from ${name}`, tag: null };
}

/** The doctor's open requests with their index, in the order they were asked. */
export const openEpaRequests = (s: AssessmentsState) =>
  s.epaRequests.map((r, index) => ({ r, index })).filter(({ r }) => epaOpenForDoctor(r));

export function epaCounts(s: AssessmentsState): Record<EpaNumber, number> {
  const by: Record<EpaNumber, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of epaRecords(s)) by[r.epa]++;
  return by;
}

/**
 * The fewest EPAs still needed this year, from the AMC rules: "At least 10 EPAs must be assessed across the year
 * with at least 2 in each term", EPA 1 "at least once in each term", and EPAs 2 to 4 at least twice each (AMC
 * Section 3A, Assessment approach, p.50, and the certification checklist in Section 3C, p.58).
 *
 * Only terms not yet finished can take more. Each needs enough to reach 2, and an EPA 1 if it has none. Those
 * of its slots that need not be EPA 1 can go to EPAs 2 to 4 still short. Anything left over is added on top,
 * and the year never needs fewer than 10 in all.
 */
export function epaStillNeeded(
  records: readonly Pick<EpaRecord, "term" | "epa">[],
  openTerms: readonly TermId[],
): number {
  let termSlots = 0;
  let freeSlots = 0;
  for (const term of openTerms) {
    const inTerm = records.filter((r) => r.term === term);
    const epa1 = inTerm.some((r) => r.epa === 1) ? 0 : 1;
    const slots = Math.max(2 - inTerm.length, epa1);
    termSlots += slots;
    freeSlots += slots - epa1;
  }
  const others = ([2, 3, 4] as const).reduce(
    (sum, k) => sum + Math.max(0, 2 - records.filter((r) => r.epa === k).length),
    0,
  );
  return Math.max(10 - records.length, termSlots + Math.max(0, others - freeSlots));
}

/** The sample's terms that can still take EPAs: this one and the next. */
const OPEN_TERMS: readonly TermId[] = SAMPLE_TERMS.filter((t) => t.status !== "done").map((t) => t.id);

export function epaNeedMore(s: AssessmentsState): number {
  return epaStillNeeded(epaRecords(s), OPEN_TERMS);
}

/** Only things the doctor must do now count on the tab. */
export function doctorActions(s: AssessmentsState): number {
  let n = 0;
  const st = stage(s);
  if (!epa1ThisTerm(s) && !pendingEpaRequest(s, 1)) n++;
  // A request sent back for another EPA is the doctor's to answer too (EPA 1's is counted just above).
  n += s.epaRequests.filter((r) => r.status === "sent-back" && r.epa !== 1).length;
  if (st === "start" || st === "self-draft" || st === "self-done") n++;
  else if (st === "sup-signed") n++;
  else if (st === "ready" && windowOpen(s) && !s.booking) n++;
  return n;
}

/**
 * What the supervisor has to finish: two made-up requests, Sam's form and any EPA asked of them. Sam's form is
 * theirs to start whether or not Sam has said they're ready (CLA Training Guide for Prevocational Doctors, p.12).
 */
export function supervisorTodo(s: AssessmentsState): number {
  let n = 2;
  if (!s.sigs.sup) n++;
  n += s.epaRequests.filter((r) => epaWithAssessor(r) && r.who === "sup").length;
  return n;
}

const SUP = SAMPLE_SUPERVISOR.short;

/**
 * The DCT's sign-off on this form, when given (`samSignOff(dct)` in dct.ts). Passed in rather than imported,
 * because dct.ts reads this file. In CLA the DCT or EDMS completes the "DCT Sign-off" form after the term
 * supervisor and the doctor (CLA training guide for supervisors, assessors, DCTs and EDMS, Release 2.0, p.39).
 */
export type DctSignOff = { readonly date: string } | null;

export function endOfTermLine(s: AssessmentsState, signOff: DctSignOff = null): string {
  switch (stage(s)) {
    case "start":
      return `Rate yourself (optional), then tell ${SUP} you're ready`;
    case "self-draft":
      return `Self-assessment saved at step ${s.self.step + 1} of 8`;
    case "self-done":
      return `Self-assessment done. Tell ${SUP} you're ready.`;
    case "requested":
    case "sup-draft":
      return s.request.sent ? `Told ${SUP}. She's preparing her view.` : `${SUP} is preparing her view.`;
    case "ready":
      if (s.booking) return `${SUP}'s draft is done. Meeting ${bookingLabel(s.booking)}.`;
      return windowOpen(s)
        ? `${SUP}'s draft is done. Book your meeting.`
        : `${SUP}'s draft is done. Booking opens Mon 26 Oct.`;
    case "met":
      return `Discussed on ${meetingDate(s)}. ${SUP} submits it next.`;
    case "sup-signed":
      return `${SUP} has submitted it. Read your report and acknowledge it.`;
    case "doc-signed":
      return signOff ? `DCT sign-off done ${signOff.date}.` : "You've acknowledged it. The DCT signs off next.";
  }
}

export type PillTone = "neutral" | "accent" | "warm" | "ok" | "bad";
export type Pill = { label: string; tone: PillTone };

export function endOfTermPill(s: AssessmentsState, signOff: DctSignOff = null): Pill {
  switch (stage(s)) {
    case "doc-signed":
      return signOff ? { label: "DCT signed off", tone: "ok" } : { label: "Awaiting DCT sign-off", tone: "neutral" };
    case "sup-signed":
      return { label: "Your turn to acknowledge", tone: "warm" };
    case "start":
      return { label: "Not started", tone: "accent" };
    case "self-draft":
    case "self-done":
      return { label: "In progress", tone: "accent" };
    case "ready":
      if (s.booking) return { label: "Meeting booked", tone: "neutral" };
      return windowOpen(s)
        ? { label: "Book your meeting", tone: "accent" }
        : { label: "Booking opens Mon 26 Oct", tone: "neutral" };
    case "met":
      return { label: `Waiting for ${SUP} to submit`, tone: "neutral" };
    default:
      return { label: `Waiting for ${SUP}'s draft`, tone: "neutral" };
  }
}

export type StepState = "ok" | "now" | "lock";
/** `optional` steps (rating yourself, telling the supervisor) are passed over once a later step is under way. */
export type Step = { state: StepState; title: string; detail: string; optional?: boolean };

/** True when the supervisor's draft is still not done on Thu 5 Nov (window day 8) or later. */
export const supervisorLate = (s: AssessmentsState) => !supReady(s) && s.now >= 8;

/**
 * The seven end-of-term steps, in order. The last three follow CLA: the term supervisor submits the form, the
 * doctor acknowledges it, and the DCT completes DCT sign-off (CLA Training Guide for Prevocational Doctors,
 * Release 2.0, p.12; supervisors' guide, p.39; AMC term assessment form, sign-off section). The meeting and its
 * booking window are this example's own, not a CLA or MEU rule.
 */
export function endOfTermSteps(s: AssessmentsState, signOff: DctSignOff = null): Step[] {
  const sent = s.request.sent;
  const late = supervisorLate(s);
  const step = (state: StepState, title: string, detail: string, optional = false): Step =>
    optional ? { state, title, detail, optional } : { state, title, detail };
  const tell = `Tell ${SUP} you're ready (optional)`;
  return [
    selfDone(s)
      ? step("ok", "Rate yourself (optional)", "Saved", true)
      : selfLocked(s)
        ? step("lock", "Rate yourself (optional)", s.self.status === "draft" ? "Not finished" : "Skipped", true)
        : step(
            "now",
            "Rate yourself (optional)",
            s.self.status === "draft" ? `Saved at step ${s.self.step + 1} of 8` : "About 10 minutes",
            true,
          ),
    sent
      ? step("ok", tell, `Told her ${dayLabel(s.request.sentOn)}`, true)
      : supReady(s)
        ? step("lock", tell, "Not needed. Her view is done.", true)
        : step(
            "now",
            tell,
            s.sup.status === "draft" ? "She has already started the form." : "She starts the form either way.",
            true,
          ),
    supReady(s)
      ? step("ok", `${SUP} prepares her view`, "Draft done")
      : s.sup.status === "draft" || sent
        ? step("now", `${SUP} prepares her view`, late ? "Not finished yet" : "In progress")
        : step("lock", `${SUP} prepares her view`, "Only a supervisor can start it"),
    meetingHeld(s)
      ? step("ok", "Meet and discuss", meetingDate(s)!)
      : s.booking
        ? step("now", "Meet and discuss", `${bookingLabel(s.booking)} · Ward A office`)
        : windowOpen(s)
          ? step("now", "Book and meet", "Open until Fri 6 Nov")
          : step("lock", "Book and meet", "Booking opens Mon 26 Oct"),
    s.sigs.sup
      ? step("ok", `${SUP} submits it in CLA`, s.sigs.sup.date)
      : meetingHeld(s)
        ? step("now", `${SUP} submits it in CLA`, "Next")
        : step("lock", `${SUP} submits it in CLA`, "After the meeting"),
    s.sigs.doc
      ? step("ok", "You acknowledge it in CLA", s.sigs.doc.date)
      : s.sigs.sup
        ? step("now", "You acknowledge it in CLA", "Read your report first")
        : step("lock", "You acknowledge it in CLA", `After ${SUP}`),
    signOff
      ? step("ok", "DCT sign-off in CLA", signOff.date)
      : s.sigs.doc
        ? step("now", "DCT sign-off in CLA", "With the DCT")
        : step("lock", "DCT sign-off in CLA", "After you acknowledge it"),
  ];
}

/**
 * "Step n of 7": the first step that is neither done nor passed over. A step left behind by a later done step
 * (a skipped self-rating) is passed over, and so is an optional step once a later required one is under way.
 */
export function currentStepNumber(steps: readonly Step[]): number {
  const i = steps.findIndex((x, n) => {
    if (x.state === "ok") return false;
    const later = steps.slice(n + 1);
    if (later.some((y) => y.state === "ok")) return false;
    return !(x.optional && later.some((y) => !y.optional && y.state === "now"));
  });
  return i < 0 ? steps.length : i + 1;
}

/** The made-up date can't move before anything already recorded on it. */
function earliestNow(s: AssessmentsState): number {
  return Math.max(
    -1,
    s.request.sent ? s.request.sentOn : -1,
    s.meetingDay ?? -1,
    s.sigs.sup?.day ?? -1,
    s.sigs.doc?.day ?? -1,
  );
}

/* ---------------- The form ---------------- */

export const lowDomains = (f: { ratings: Ratings | Record<DomainNumber, Rating> }) =>
  DOMAIN_NUMBERS.filter((k) => {
    const r = f.ratings[k];
    return r !== null && r <= 2;
  });

/**
 * When to suggest talking to the MEU or DCT about an improvement plan. A domain rated 1 or 2 is the AMC form's
 * own trigger ("Liaise with the MEU or DCT to complete an Improving Performance Action Plan", AMC term assessment
 * form). Adding a Conditional pass or Unsatisfactory global rating is this example's choice, not an AMC rule
 * (Section 3B, Improving performance, starts with an informal discussion). It is advice, never a blocker.
 */
export const needsImprovementPlan = (f: AssessmentForm) =>
  lowDomains(f).length > 0 || f.global === "cond" || f.global === "unsat";

/**
 * A partial check for patient details (record numbers, dates of birth, long numbers, a title and a name,
 * dates, beds and the rest): the one shared work-text check, so every Assessments field reads text the same
 * way the rest of work mode does. It deliberately says it catches only some.
 */
export function looksLikePatientDetails(text: string): boolean {
  return looksLikePatientDetail(text);
}

export const formMentionsPatient = (f: AssessmentForm) =>
  [f.strengths, f.areas, f.other, ...Object.values(f.feedback)].some(looksLikePatientDetails);

/** What still stops the form being finished, in plain words. Empty means it can be saved. */
export function formBlockers(f: AssessmentForm, who: Who): string[] {
  const reasons: string[] = [];
  const missing = DOMAIN_NUMBERS.filter((k) => !f.ratings[k]);
  if (missing.length) reasons.push(`Rate domain ${missing.join(", ")}.`);
  if (who === "sup") {
    if (!f.global) reasons.push("Choose a global rating.");
    const lowNoFeedback = lowDomains(f).filter((k) => !f.feedback[k].trim());
    // A 1 or 2 needs written feedback: "Domain ratings of 1 or 2 will require further information" (AMC term
    // assessment form), and CLA asks for a written justification (supervisors' guide, Release 2.0, pp.8 and 25).
    if (lowNoFeedback.length) reasons.push(`Add feedback for domain ${lowNoFeedback.join(", ")}.`);
  }
  return reasons;
}

/* ---------------- Reports ---------------- */

export type ComparisonRow = {
  domain: DomainNumber;
  title: string;
  self: Rating | null;
  sup: Rating;
  message: string;
};

/**
 * Self against supervisor, domain by domain. `view` is whose screen it is: the
 * doctor reads "Dr Wattle: 1 higher", the supervisor reads "You: 1 higher".
 */
export function compareRatings(
  selfRatings: Ratings | Record<DomainNumber, Rating> | null,
  supRatings: Ratings | Record<DomainNumber, Rating>,
  view: "doc" | "sup",
  doctorFirst: string,
): ComparisonRow[] {
  return DOMAINS.map((d) => {
    const a = selfRatings?.[d.n] ?? null;
    const b = (supRatings[d.n] ?? 1) as Rating;
    let message: string;
    if (!a) message = "No self-rating";
    else if (a === b) message = "Same rating";
    else {
      const gap = b - a;
      message =
        view === "sup"
          ? gap > 0
            ? `You: ${gap} higher`
            : `${doctorFirst}: ${-gap} higher`
          : gap > 0
            ? `${SUP}: ${gap} higher`
            : `You: ${-gap} higher`;
    }
    return { domain: d.n, title: d.title, self: a, sup: b, message };
  });
}

type ReportForm = { ratings: Ratings | Record<DomainNumber, Rating>; ticks: Ticks };

/** The one-paragraph summary under the doctor's comparison chart. */
export function reportSummary(self: ReportForm | null, sup: ReportForm): string {
  if (!self) return "You didn't rate yourself this time, so there's nothing to compare.";
  let under = 0;
  let over = 0;
  let agree = 0;
  let supTicks = 0;
  for (const k of DOMAIN_NUMBERS) {
    const diff = (sup.ratings[k] ?? 0) - (self.ratings[k] ?? 0);
    if (diff > 0) under++;
    else if (diff < 0) over++;
    agree += sup.ticks[k].filter((t) => self.ticks[k].includes(t)).length;
    supTicks += sup.ticks[k].length;
  }
  const plural = (n: number) => `${n} domain${n > 1 ? "s" : ""}`;
  if (!under && !over)
    return `You and ${SUP} gave the same rating in every domain. You both ticked ${agree} of the ${supTicks} outcomes she observed.`;
  return [
    under ? `You rated yourself lower than ${SUP} in ${plural(under)}. Ask her what she saw.` : "",
    over ? `You rated yourself higher in ${plural(over)}. Ask for an example.` : "",
    `You both ticked ${agree} of the ${supTicks} outcomes ${SUP} observed.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Talking points for the supervisor's meeting, biggest gap first. */
export function talkingPoints(
  self: { ratings: Ratings } | null,
  sup: { ratings: Ratings },
  doctorFirst: string,
): string[] {
  if (!self)
    return [`${doctorFirst} didn't rate themselves. Ask how they think the term went before sharing your view.`];
  const gaps = DOMAIN_NUMBERS.map((k) => ({ k, g: (sup.ratings[k] ?? 0) - (self.ratings[k] ?? 0) }))
    .filter((x) => x.g)
    .sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
  if (!gaps.length) return ["You gave the same rating in every domain. Use the meeting to set goals for next term."];
  return gaps.map((x) =>
    x.g > 0
      ? `Domain ${x.k}: ${doctorFirst} rated themselves ${x.g} lower than you. Say what you've seen them do well.`
      : `Domain ${x.k}: ${doctorFirst} rated themselves ${-x.g} higher. Talk through one example together.`,
  );
}

/** Two suggested goals from the two lowest-rated domains (ties go to the earlier domain). */
export function suggestedGoals(ratings: Ratings | Record<DomainNumber, Rating>): string[] {
  return [...DOMAIN_NUMBERS]
    .sort((a, b) => (ratings[a] ?? 0) - (ratings[b] ?? 0) || a - b)
    .slice(0, 2)
    .map((k) => GOAL_SUGGESTIONS[k]);
}

/* ---------------- Reducer ---------------- */

export type AssessmentsAction =
  | { type: "set-now"; now: number }
  | { type: "form-step"; who: Who; step: number }
  | { type: "form-save-exit"; who: Who }
  | { type: "form-finish"; who: Who }
  | { type: "form-example"; who: Who }
  | { type: "toggle-source"; who: Who; source: string }
  | { type: "set-other"; who: Who; value: string }
  | { type: "toggle-tick"; who: Who; domain: DomainNumber; outcome: string }
  | { type: "tick-all"; who: Who; domain: DomainNumber }
  | { type: "toggle-wording"; who: Who }
  | { type: "set-rating"; who: Who; domain: DomainNumber; rating: Rating }
  | { type: "set-feedback"; who: Who; domain: DomainNumber; value: string }
  | { type: "set-global"; who: Who; rating: GlobalRating }
  | { type: "set-text"; who: Who; field: "strengths" | "areas"; value: string }
  | { type: "toggle-ipap"; who: Who }
  | { type: "toggle-registrar" }
  | { type: "toggle-share"; key: "epa" | "mid" | "log" }
  | { type: "set-request-message"; value: string }
  | { type: "send-request" }
  | { type: "toggle-remind-open" }
  | { type: "toggle-my-day" }
  | { type: "toggle-remind-day" }
  | { type: "book"; day: number; time: string }
  | { type: "cancel-booking" }
  | { type: "meeting-held" }
  | { type: "sign"; who: Who; typed: string; image: SignatureInk | null }
  | { type: "sent-to-meu" }
  | { type: "request-epa"; epa: EpaNumber; who: "sup" | "reg" | "guest"; guest?: GuestKind }
  | {
      type: "record-epa";
      index: number;
      level: SupervisionLevel;
      complexity?: CaseComplexity;
      note?: string;
      feedback?: EpaFeedback;
    }
  | {
      type: "record-epa-direct";
      epa: EpaNumber;
      level: SupervisionLevel;
      complexity?: CaseComplexity;
      note?: string;
    }
  | { type: "undo-record-epa"; index: number; previous?: EpaRequest }
  | { type: "epa-not-yet"; index: number; reply?: string }
  | { type: "epa-send-back"; index: number; reply: string }
  /** `previous` is the request as it was before the answer, so Undo puts back a "not yet" and its note too. */
  | {
      type: "undo-epa-answer";
      index: number;
      previous?: EpaRequest;
      /** The answer this Undo belongs to, so an older Undo never reverses a newer answer. */
      answered?: { status: EpaRequestStatus; reply: string };
    }
  | { type: "cancel-epa-request"; index: number }
  | { type: "restore-epa-request"; index: number; request: EpaRequest }
  | { type: "toggle-availability"; day: number; time: string }
  | { type: "set-disagree-draft"; value: string };

const validComplexity = (c: CaseComplexity) => c === "low" || c === "medium" || c === "high";

/** A reply is short, has no patient details, and is present when it must be. */
export function validReply(reply: string, required: boolean): boolean {
  if (required && !reply) return false;
  return reply.length <= EPA_REPLY_MAX && !looksLikePatientDetails(reply);
}

/** Who was asked for what: everything a request keeps when its answer changes. */
const asked = (x: EpaRequest) => ({ epa: x.epa, who: x.who, ...(x.guest ? { guest: x.guest } : {}) });

function answerAt(list: readonly EpaRequest[], index: number, status: EpaRequestStatus, reply: string): EpaRequest[] {
  return list.map((x, i) => (i === index ? { ...asked(x), status, ...(reply ? { reply } : {}) } : x));
}

const validText = (text: string | undefined) =>
  text === undefined || (text.length <= EPA_FEEDBACK_MAX && !looksLikePatientDetails(text));

/** The 28 outcome statement ids ([2A]), the only ones an EPA can confirm. */
const OUTCOME_IDS: ReadonlySet<string> = new Set(DOMAINS.flatMap((d) => d.outcomes.map((o) => o.id)));

/**
 * The feedback with blanks dropped, or null when any part is too long, looks like patient details, or names an
 * outcome statement that does not exist.
 */
function cleanFeedback(f: EpaFeedback): EpaFeedback | null {
  if (f.observed !== undefined && f.observed !== "direct" && f.observed !== "team") return null;
  const better = f.better?.trim() || undefined;
  const goal = f.goal?.trim() || undefined;
  if (!validText(better) || !validText(goal)) return null;
  if (f.outcomes !== undefined && !f.outcomes.every((id) => OUTCOME_IDS.has(id))) return null;
  const outcomes = f.outcomes ? [...new Set(f.outcomes)] : [];
  return {
    ...(f.observed ? { observed: f.observed } : {}),
    ...(typeof f.rightLevel === "boolean" ? { rightLevel: f.rightLevel } : {}),
    ...(better ? { better } : {}),
    ...(goal ? { goal } : {}),
    ...(outcomes.length ? { outcomes } : {}),
  };
}

/** A form that is locked rejects every edit. */
function editForm(s: AssessmentsState, who: Who, change: (f: AssessmentForm) => AssessmentForm): AssessmentsState {
  if (who === "self" ? selfLocked(s) : supLocked(s)) return s;
  const current = s[who];
  const next = change(current);
  // A finished form that is changed into one with gaps goes back to a draft.
  const status =
    next.status === "new" || (next.status === "done" && formBlockers(next, who).length) ? "draft" : next.status;
  return { ...s, [who]: { ...next, status } };
}

const toggle = (list: readonly string[], item: string) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

export function assessmentsReducer(s: AssessmentsState, a: AssessmentsAction): AssessmentsState {
  switch (a.type) {
    case "set-now":
      if (!Number.isInteger(a.now)) return s;
      return { ...s, now: Math.max(earliestNow(s), Math.min(WINDOW_DAYS.length - 1, a.now)) };
    case "form-step": {
      if (!Number.isInteger(a.step)) return s;
      const step = Math.max(0, Math.min(LAST_FORM_STEP, a.step));
      return { ...s, [a.who]: { ...s[a.who], step } };
    }
    case "form-save-exit":
      return editForm(s, a.who, (f) => f);
    case "form-finish": {
      if (formBlockers(s[a.who], a.who).length) return s;
      // The supervisor's draft needs no request from the doctor: in CLA only a linked supervisor starts an
      // end-of-term form (CLA Training Guide for Prevocational Doctors, Release 2.0, p.12).
      return editForm(s, a.who, (f) => ({ ...f, status: "done" }));
    }
    case "form-example": {
      const ex = EXAMPLE_ANSWERS[a.who];
      return editForm(s, a.who, (f) => ({
        ...f,
        sources: [...ex.sources],
        ticks: { 1: [...ex.ticks[1]], 2: [...ex.ticks[2]], 3: [...ex.ticks[3]], 4: [...ex.ticks[4]] },
        ratings: { ...ex.ratings },
        feedback: { ...ex.feedback },
        global: ex.global,
        strengths: ex.strengths,
        areas: ex.areas,
      }));
    }
    case "toggle-source":
      if (!(EVIDENCE_SOURCES as readonly string[]).includes(a.source)) return s;
      return editForm(s, a.who, (f) => ({ ...f, sources: toggle(f.sources, a.source) }));
    case "set-other":
      return editForm(s, a.who, (f) => ({ ...f, other: a.value }));
    case "toggle-tick":
      return editForm(s, a.who, (f) => ({
        ...f,
        ticks: { ...f.ticks, [a.domain]: toggle(f.ticks[a.domain], a.outcome) },
      }));
    case "tick-all":
      return editForm(s, a.who, (f) => ({
        ...f,
        ticks: { ...f.ticks, [a.domain]: domain(a.domain).outcomes.map((o) => o.id) },
      }));
    case "toggle-wording":
      return { ...s, [a.who]: { ...s[a.who], fullWording: !s[a.who].fullWording } };
    case "set-rating":
      return editForm(s, a.who, (f) => ({ ...f, ratings: { ...f.ratings, [a.domain]: a.rating } }));
    case "set-feedback":
      return editForm(s, a.who, (f) => ({ ...f, feedback: { ...f.feedback, [a.domain]: a.value } }));
    case "set-global":
      // The doctor's own overall rating is optional: tapping it again clears it.
      return editForm(s, a.who, (f) => ({
        ...f,
        global: a.who === "self" && f.global === a.rating ? null : a.rating,
      }));
    case "set-text":
      return editForm(s, a.who, (f) => ({ ...f, [a.field]: a.value }));
    case "toggle-ipap":
      return editForm(s, a.who, (f) => ({ ...f, ipap: !f.ipap }));
    case "toggle-registrar":
      return s.request.sent ? s : { ...s, request: { ...s.request, registrar: !s.request.registrar } };
    case "toggle-share":
      return s.request.sent ? s : { ...s, share: { ...s.share, [a.key]: !s.share[a.key] } };
    case "set-request-message":
      return s.request.sent ? s : { ...s, request: { ...s.request, message: a.value } };
    case "send-request":
      return s.request.sent ? s : { ...s, request: { ...s.request, sent: true, sentOn: s.now } };
    case "toggle-remind-open":
      return { ...s, remindWhenOpen: !s.remindWhenOpen };
    case "toggle-my-day":
      return { ...s, addToMyDay: !s.addToMyDay };
    case "toggle-remind-day":
      return { ...s, remindDayBefore: !s.remindDayBefore };
    case "book":
      if (!supReady(s) || !bookableDay(s, a.day) || !s.avail[a.day]?.includes(a.time) || meetingHeld(s)) return s;
      return { ...s, booking: { day: a.day, time: a.time } };
    case "cancel-booking":
      return meetingHeld(s) ? s : { ...s, booking: null };
    case "meeting-held":
      if (!s.booking || s.now < s.booking.day || !supReady(s)) return s;
      return { ...s, meetingDay: s.booking.day };
    case "sign": {
      if (!a.typed.trim() && !a.image) return s;
      const sig: Signature = { typed: a.typed.trim(), image: a.image, date: todayLabel(s), day: s.now };
      if (a.who === "sup") {
        const ok = meetingHeld(s) && !s.sigs.sup && !formBlockers(s.sup, "sup").length;
        return ok ? { ...s, sigs: { ...s.sigs, sup: sig } } : s;
      }
      return s.sigs.sup && !s.sigs.doc ? { ...s, sigs: { ...s.sigs, doc: sig } } : s;
    }
    case "sent-to-meu":
      return s.sigs.doc ? { ...s, sentToMeu: true } : s;
    case "request-epa": {
      if (![1, 2, 3, 4].includes(a.epa) || (a.who !== "sup" && a.who !== "reg" && a.who !== "guest")) return s;
      if (pendingEpaRequest(s, a.epa)) return s;
      if (a.who === "guest" && !GUEST_KINDS.some((k) => k.id === a.guest)) return s;
      // Asking again replaces a request that was sent back for the same EPA.
      const epaRequests = s.epaRequests.map((x) =>
        x.epa === a.epa && x.status === "sent-back" ? { ...x, status: "cancelled" as const } : x,
      );
      const request: EpaRequest = {
        epa: a.epa,
        who: a.who,
        ...(a.who === "guest" && a.guest ? { guest: a.guest } : {}),
        status: "requested",
      };
      return { ...s, epaRequests: [...epaRequests, request] };
    }
    case "record-epa": {
      const r = s.epaRequests[a.index];
      if (!r || !epaWithAssessor(r) || !SUPERVISION_LEVELS.some((l) => l.id === a.level)) return s;
      if (a.complexity !== undefined && !validComplexity(a.complexity)) return s;
      const note = a.note?.trim();
      if (!validText(note)) return s;
      const feedback = a.feedback ? cleanFeedback(a.feedback) : {};
      if (!feedback) return s;
      const epaRequests = s.epaRequests.map((x, i) =>
        i === a.index
          ? {
              ...asked(x),
              status: "done" as const,
              level: a.level,
              ...(a.complexity ? { complexity: a.complexity } : {}),
              ...(note ? { note } : {}),
              ...(Object.keys(feedback).length ? { feedback } : {}),
            }
          : x,
      );
      return { ...s, epaRequests };
    }
    case "record-epa-direct": {
      if (![1, 2, 3, 4].includes(a.epa) || !SUPERVISION_LEVELS.some((l) => l.id === a.level)) return s;
      if (a.complexity !== undefined && !validComplexity(a.complexity)) return s;
      const note = a.note?.trim();
      const done: EpaRequest = {
        epa: a.epa,
        who: "sup",
        status: "done",
        level: a.level,
        direct: true,
        ...(a.complexity ? { complexity: a.complexity } : {}),
        ...(note ? { note } : {}),
      };
      return { ...s, epaRequests: [...s.epaRequests, done] };
    }
    case "epa-not-yet": {
      // Only a request still waiting for its first answer can be put off.
      const r = s.epaRequests[a.index];
      const reply = a.reply?.trim() ?? "";
      if (!r || r.status !== "requested" || !validReply(reply, false)) return s;
      return { ...s, epaRequests: answerAt(s.epaRequests, a.index, "not-yet", reply) };
    }
    case "epa-send-back": {
      const r = s.epaRequests[a.index];
      const reply = a.reply.trim();
      if (!r || !epaWithAssessor(r) || !validReply(reply, true)) return s;
      return { ...s, epaRequests: answerAt(s.epaRequests, a.index, "sent-back", reply) };
    }
    case "undo-epa-answer": {
      // Undo straight after "Can't assess yet" or "Send back": the request is waiting again.
      const r = s.epaRequests[a.index];
      if (!r || (r.status !== "not-yet" && r.status !== "sent-back")) return s;
      if (a.answered && (r.status !== a.answered.status || (r.reply ?? "") !== a.answered.reply)) return s;
      const p = a.previous;
      if (p && p.epa === r.epa && epaWithAssessor(p)) {
        return { ...s, epaRequests: answerAt(s.epaRequests, a.index, p.status, p.reply ?? "") };
      }
      return { ...s, epaRequests: answerAt(s.epaRequests, a.index, "requested", "") };
    }
    case "restore-epa-request": {
      // Undo straight after a cancel: back exactly as it was, unless the doctor has since asked again.
      const r = s.epaRequests[a.index];
      if (!r || r.status !== "cancelled" || !epaOpenForDoctor(a.request) || a.request.epa !== r.epa) return s;
      if (epaWithAssessor(a.request) && pendingEpaRequest(s, r.epa)) return s;
      if (a.request.status === "sent-back" && s.epaRequests.some((x) => x.epa === r.epa && epaOpenForDoctor(x)))
        return s;
      return { ...s, epaRequests: s.epaRequests.map((x, i) => (i === a.index ? { ...a.request } : x)) };
    }
    case "cancel-epa-request": {
      const r = s.epaRequests[a.index];
      if (!r || !epaOpenForDoctor(r)) return s;
      return {
        ...s,
        epaRequests: s.epaRequests.map((x, i) => (i === a.index ? { ...x, status: "cancelled" as const } : x)),
      };
    }
    case "undo-record-epa": {
      // Undo straight after saving: a request goes back to waiting, one recorded without a request goes.
      const r = s.epaRequests[a.index];
      if (!r || r.status !== "done") return s;
      if (r.direct) return { ...s, epaRequests: s.epaRequests.filter((_, i) => i !== a.index) };
      // Recorded after "Can't assess yet": back to that, note included.
      const p = a.previous;
      if (p && p.epa === r.epa && epaWithAssessor(p))
        return { ...s, epaRequests: answerAt(s.epaRequests, a.index, p.status, p.reply ?? "") };
      const epaRequests = s.epaRequests.map((x, i) =>
        i === a.index ? { ...asked(x), status: "requested" as const } : x,
      );
      return { ...s, epaRequests };
    }
    case "toggle-availability": {
      const booked = s.booking?.day === a.day && s.booking.time === a.time;
      if (booked) return s;
      return { ...s, avail: { ...s.avail, [a.day]: toggle(s.avail[a.day] ?? [], a.time) } };
    }
    case "set-disagree-draft":
      return { ...s, disagreeDraft: a.value };
  }
}

/**
 * Kinds of experience (A to D) from terms already finished. A term accredited for two counts both: [TE3] "1 or 2"
 * per term, [MBA-RS] "Up to two types can be counted per term".
 */
export function kindsDone(terms: readonly Pick<SampleTerm, "status" | "category" | "category2">[]): number {
  return new Set(terms.filter((t) => t.status === "done").flatMap(termKinds)).size;
}
