import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

/**
 * The demo CPD year.
 *
 * Every CME screen has to render before a database exists, and the browser
 * tests assert against exactly this data, so it has to exercise every shape
 * the requirement model supports and leave exactly the gaps those screens are
 * drawn around — not a tidy year with nothing left to do.
 *
 * **Everything here must stay obviously synthetic.** Every activity is a
 * generic, made-up CPD log line (no real course, provider or person), every
 * `documentId` is a placeholder `00000000-…` value, and nothing states a
 * clinical fact — no dose, no threshold, no criterion. Activity titles name
 * broad topics (mood disorders, cultural safety, telehealth) the way a real
 * CPD log would; that is what makes them look real enough to test against
 * without being real. See `src/lib/on-call/demo-entries.ts` for the same rule
 * applied to another mode.
 *
 * Requirement design, and why the three category totals do not add up the
 * way an earlier description of this corpus implied:
 *
 * - `educational`, `combined`, `domains`, `plan` and `self-evaluation` are the
 *   national baseline, modelled on the Medical Board of Australia's CPD
 *   registration standard: an educational-activities minimum, a combined
 *   reviewing+measuring minimum with a floor in each, a set of practice
 *   domains that each need at least one activity, a written development plan,
 *   and a self-evaluation.
 * - `measuring` and `peer-review` are the college overlay: extra requirements
 *   this owner has added on top of the national baseline.
 * - Formal peer review is credited within reviewing-performance allocations.
 *   It is measured in hours and never adds hours to the total.
 *
 * `totalAllocatedHours` is the sum of every allocation across all three
 * categories, so it is arithmetically forced to equal
 * `educational + reviewing + measuring` hours — there is no fourth bucket for
 * extra hours to hide in. That identity is exact in `evaluate.ts` and cannot
 * be worked around from the data side.
 */

export const DEMO_CME_INSTANT: Date = new Date("2026-09-19T02:00:00Z");

/** Recognisably fake: a run of zeroes with a single distinguishing digit. */
function evidenceDocumentId(n: number): string {
  return `00000000-0000-4000-8000-${`${n}`.padStart(12, "0")}`;
}

type DemoEntryInput = {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly formalPeerReviewHours?: number;
  readonly category: CmeCategory;
  readonly hours: number;
  readonly reflection: string;
  readonly buckets?: readonly string[];
  readonly costCents?: number | null;
  readonly documentId?: string | null;
  readonly transcribed: boolean;
};

function entry(input: DemoEntryInput): CmeEntry {
  return {
    id: input.id,
    date: input.date,
    formalPeerReviewHours: input.formalPeerReviewHours ?? 0,
    title: input.title,
    allocations: [{ category: input.category, hours: input.hours }],
    reflection: input.reflection,
    costCents: input.costCents ?? null,
    transcribed: input.transcribed,
    routineId: null,
    documentId: input.documentId ?? null,
    buckets: input.buckets ?? [],
  };
}

export const DEMO_CME_ENTRIES: readonly CmeEntry[] = [
  // ---- January ----
  entry({
    id: "cme-2026-001",
    date: "2026-01-08",
    title: "Journal club — mood disorders literature",
    category: "educational",
    hours: 0.5,
    reflection: "Compared notes on recent reading with two colleagues afterwards.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-002",
    date: "2026-01-15",
    title: "Grand round: mood disorders update",
    category: "educational",
    hours: 1.0,
    reflection: "Solid overview, mostly consistent with current local practice.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-003",
    date: "2026-01-22",
    title: "Webinar: telehealth consultation skills",
    category: "educational",
    hours: 0.5,
    reflection: "Picked up a couple of practical tips for video consultations.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-004",
    date: "2026-01-29",
    title: "Clinical audit: discharge planning review",
    category: "reviewing",
    hours: 1.0,
    reflection: "Reviewed a sample of discharge summaries with the team.",
    transcribed: true,
  }),
  // ---- February ----
  entry({
    id: "cme-2026-005",
    date: "2026-02-05",
    title: "Conference: anxiety and trauma treatments",
    category: "educational",
    hours: 1.0,
    reflection: "Full-day conference, useful networking as well as content.",
    costCents: 15_000,
    documentId: evidenceDocumentId(1),
    transcribed: true,
  }),
  entry({
    id: "cme-2026-006",
    date: "2026-02-12",
    title: "Peer review group — February session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — February"],
    reflection: "Brought a case to the group and got helpful feedback.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-007",
    date: "2026-02-19",
    title: "Podcast CPD: workforce wellbeing",
    category: "educational",
    hours: 0.5,
    reflection: "Listened on the drive in, worth a second listen.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-008",
    date: "2026-02-26",
    title: "Patient experience survey review",
    category: "measuring",
    hours: 0.5,
    reflection: "Went through this quarter's survey results with the practice manager.",
    transcribed: true,
  }),
  // ---- March ----
  entry({
    id: "cme-2026-009",
    date: "2026-03-05",
    title: "Online course: cultural safety in psychiatric practice",
    category: "educational",
    hours: 1.0,
    buckets: ["Culturally safe practice"],
    reflection: "Well-structured course with several local case studies.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-010",
    date: "2026-03-12",
    title: "Peer review group — March session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — March"],
    reflection: "Good discussion, ran a little over time.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-011",
    date: "2026-03-19",
    title: "Reading group: trauma-informed care",
    category: "educational",
    hours: 0.5,
    reflection: "Shared a short summary with the wider team afterwards.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-012",
    date: "2026-03-26",
    title: "Case conference — complex presentations",
    category: "reviewing",
    hours: 1.0,
    reflection: "Presented one case and discussed two others brought by colleagues.",
    transcribed: true,
  }),
  // ---- April ----
  entry({
    id: "cme-2026-013",
    date: "2026-04-02",
    title: "Workshop: working with Aboriginal and Torres Strait Islander clients",
    category: "educational",
    hours: 1.0,
    buckets: ["Culturally safe practice"],
    reflection: "Practical, community-led session with useful local contacts.",
    costCents: 22_000,
    documentId: evidenceDocumentId(2),
    transcribed: true,
  }),
  entry({
    id: "cme-2026-014",
    date: "2026-04-09",
    title: "Peer review group — April session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — April"],
    reflection: "Smaller group than usual but a focused discussion.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-015",
    date: "2026-04-16",
    title: "Online module: record-keeping standards",
    category: "educational",
    hours: 0.5,
    reflection: "Straightforward refresher, nothing unexpected.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-016",
    date: "2026-04-23",
    title: "Outcome measures training",
    category: "measuring",
    hours: 0.5,
    reflection: "Ran through the new reporting template with the team.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-017",
    date: "2026-04-30",
    title: "Seminar: mental health access in regional and remote Australia",
    category: "educational",
    hours: 1.0,
    buckets: ["Health inequities"],
    reflection: "Sobering statistics on access, good discussion afterwards.",
    transcribed: true,
  }),
  // ---- May ----
  entry({
    id: "cme-2026-018",
    date: "2026-05-07",
    title: "Journal club — psychotic disorders literature",
    category: "educational",
    hours: 0.5,
    reflection: "Two papers discussed, one worth revisiting.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-019",
    date: "2026-05-14",
    title: "Peer review group — May session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — May"],
    reflection: "Brought a case that generated a useful discussion on documentation.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-020",
    date: "2026-05-21",
    title: "Practice review meeting",
    category: "reviewing",
    hours: 1.0,
    reflection: "External reviewer walked through the practice's processes.",
    costCents: 15_000,
    transcribed: true,
  }),
  entry({
    id: "cme-2026-021",
    date: "2026-05-28",
    title: "Webinar: socioeconomic disadvantage and psychiatric care",
    category: "educational",
    hours: 1.0,
    buckets: ["Health inequities"],
    reflection: "Useful framing, will share the slides with the team.",
    costCents: 8_000,
    documentId: evidenceDocumentId(3),
    transcribed: true,
  }),
  // ---- June ----
  entry({
    id: "cme-2026-022",
    date: "2026-06-04",
    title: "Webinar: working with interpreters",
    category: "educational",
    hours: 0.5,
    reflection: "Confirmed our current booking process is on the right track.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-023",
    date: "2026-06-11",
    title: "Peer review group — June session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — June"],
    reflection: "Good turnout this month, useful cross-referrals discussed.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-024",
    date: "2026-06-18",
    title: "Quality improvement project — follow-up audit review",
    category: "measuring",
    hours: 0.5,
    reflection: "Checked progress against the plan from earlier in the year.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-025",
    date: "2026-06-25",
    title: "Course: professional boundaries and ethics refresher",
    category: "educational",
    hours: 1.0,
    buckets: ["Professionalism"],
    reflection: "Mandatory refresher, well organised this year.",
    transcribed: true,
  }),
  // ---- July ----
  entry({
    id: "cme-2026-026",
    date: "2026-07-02",
    title: "Short course: motivational interviewing refresher",
    category: "educational",
    hours: 0.5,
    reflection: "Good reminder of a few techniques I'd stopped using.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-027",
    date: "2026-07-09",
    title: "Peer review group — July session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — July"],
    reflection: "Discussed a referral pathway question with the group.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-028",
    date: "2026-07-16",
    title: "Morbidity and mortality review",
    category: "reviewing",
    hours: 0.5,
    reflection: "Standard departmental review, no local process changes needed.",
    transcribed: true,
  }),
  entry({
    id: "cme-2026-029",
    date: "2026-07-23",
    title: "Workshop: managing conflicts of interest",
    category: "educational",
    hours: 1.0,
    buckets: ["Professionalism"],
    reflection: "Clear examples, useful for updating our own disclosure process.",
    costCents: 9_500,
    transcribed: true,
  }),
  entry({
    id: "cme-2026-030",
    date: "2026-07-30",
    title: "Online module: telehealth privacy basics",
    category: "educational",
    hours: 0.5,
    reflection: "Confirmed our current setup already meets this.",
    transcribed: true,
  }),
  // ---- August ----
  entry({
    id: "cme-2026-031",
    date: "2026-08-06",
    title: "Conference: psychopharmacology safety review",
    category: "educational",
    hours: 1.0,
    reflection: "Long day but well worth attending this year.",
    costCents: 30_000,
    documentId: evidenceDocumentId(4),
    transcribed: true,
  }),
  entry({
    id: "cme-2026-032",
    date: "2026-08-13",
    title: "Peer review group — August session",
    formalPeerReviewHours: 0.5,
    category: "reviewing",
    hours: 0.5,
    buckets: ["Peer review — August"],
    reflection: "Renewed the group's annual arrangement at this session.",
    costCents: 12_000,
    documentId: evidenceDocumentId(5),
    transcribed: true,
  }),
  entry({
    id: "cme-2026-033",
    date: "2026-08-20",
    title: "Webinar: eating disorders update",
    category: "educational",
    hours: 0.5,
    reflection: "Useful update, mostly aligned with current practice.",
    transcribed: true,
  }),
  // ---- Late August / September: logged, not yet transcribed into the CPD home ----
  entry({
    id: "cme-2026-034",
    date: "2026-08-27",
    title: "Peer consultation — difficult cases",
    category: "reviewing",
    hours: 0.5,
    reflection: "Talked through two cases with a colleague.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-035",
    date: "2026-09-01",
    title: "Course: supervision skills for consultants",
    category: "educational",
    hours: 1.0,
    reflection: "Practical session, plan to apply a couple of the techniques.",
    costCents: 18_000,
    documentId: evidenceDocumentId(6),
    transcribed: false,
  }),
  entry({
    id: "cme-2026-036",
    date: "2026-09-03",
    title: "Journal club — personality disorders literature",
    category: "educational",
    hours: 0.5,
    reflection: "Interesting paper, flagged for the next group discussion.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-037",
    date: "2026-09-05",
    title: "Service review: intake process",
    category: "reviewing",
    hours: 0.5,
    reflection: "External consultant reviewed our current intake steps.",
    costCents: 20_000,
    documentId: evidenceDocumentId(7),
    transcribed: false,
  }),
  entry({
    id: "cme-2026-038",
    date: "2026-09-07",
    title: "Grand round: personality disorders update",
    category: "educational",
    hours: 1.0,
    reflection: "Well presented, consistent with recent journal club reading.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-039",
    date: "2026-09-09",
    title: "Outcome measures data review",
    category: "measuring",
    hours: 0.5,
    reflection: "Checked the new dashboard against last quarter's figures.",
    costCents: 5_000,
    documentId: evidenceDocumentId(8),
    transcribed: false,
  }),
  entry({
    id: "cme-2026-040",
    date: "2026-09-10",
    title: "Webinar: perinatal mental health update",
    category: "educational",
    hours: 0.5,
    reflection: "Good update, will revisit the recording later.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-041",
    date: "2026-09-11",
    title: "Conference: workforce burnout and wellbeing",
    category: "educational",
    hours: 1.0,
    reflection: "Practical strategies, shared a summary with the practice.",
    costCents: 27_500,
    documentId: evidenceDocumentId(9),
    transcribed: false,
  }),
  entry({
    id: "cme-2026-042",
    date: "2026-09-12",
    title: "Online module: consent and capacity refresher",
    category: "educational",
    hours: 0.5,
    reflection: "Quick refresher, no surprises.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-043",
    date: "2026-09-13",
    title: "Webinar: digital mental health tools",
    category: "educational",
    hours: 1.0,
    reflection: "Interesting options, worth a follow-up look.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-044",
    date: "2026-09-15",
    title: "Reading group: neurodevelopmental conditions",
    category: "educational",
    hours: 0.5,
    reflection: "Shared a short write-up with the group afterwards.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-045",
    date: "2026-09-16",
    title: "Seminar: forensic psychiatry update",
    category: "educational",
    hours: 1.0,
    reflection: "Relevant background even outside forensic work.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-046",
    date: "2026-09-18",
    title: "Webinar: sleep and mental health update",
    category: "educational",
    hours: 0.5,
    reflection: "Useful update, will share with the team.",
    transcribed: false,
  }),
  entry({
    id: "cme-2026-047",
    date: "2026-09-19",
    title: "Webinar: neuromodulation therapies overview",
    category: "educational",
    hours: 1.0,
    reflection: "Overview session, logging before the reporting cutoff.",
    costCents: 6_000,
    transcribed: false,
  }),
];

const PRACTICE_DOMAINS = [
  "Culturally safe practice",
  "Health inequities",
  "Professionalism",
  "Ethical practice",
] as const;

export const DEMO_CME_YEAR: CmeRequirementSet = {
  year: 2026,
  // Deliberately NOT the name of a real regulator's real standard. This string is
  // rendered verbatim into the provenance block beside "Confirmed by you on …",
  // so a screenshot of demo mode carrying a genuine standard's title would read
  // as a real regulatory citation the app had made on its own authority — the one
  // thing this mode exists to never do.
  confirmedOn: "2026-01-08",
  confirmedSource: "Example CPD standard (made up, not a real regulatory source)",
  totalHours: 50,
  requirements: [
    {
      id: "educational",
      label: "Educational activities",
      source: "national",
      completedOn: null,
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 12.5 },
    },
    {
      id: "combined",
      label: "Reviewing + measuring, combined",
      source: "national",
      completedOn: null,
      spec: {
        shape: "hours-across-categories",
        categories: ["reviewing", "measuring"],
        minimumHours: 25,
        minimumEachHours: 5,
      },
    },
    {
      id: "domains",
      label: "Practice domains",
      source: "national",
      completedOn: null,
      spec: { shape: "activity-count", buckets: PRACTICE_DOMAINS, minimumPerBucket: 1 },
    },
    {
      id: "plan",
      label: "Development plan",
      source: "national",
      completedOn: "2026-01-12",
      spec: { shape: "task" },
    },
    {
      id: "self-evaluation",
      label: "Self-evaluation",
      source: "national",
      completedOn: null,
      spec: { shape: "task" },
    },
    {
      id: "measuring",
      label: "Measuring outcomes (college minimum)",
      source: "college",
      completedOn: null,
      spec: { shape: "hours-in-category", category: "measuring", minimumHours: 5 },
    },
    {
      id: "peer-review",
      label: "Formal peer review",
      source: "college",
      completedOn: null,
      spec: { shape: "credited-hours", credit: "formal-peer-review", minimumHours: 10 },
    },
  ],
};

/** Synthetic demonstration only; a routine is never attendance evidence. */
export const DEMO_CME_ROUTINES: readonly CmeRoutine[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    title: "Journal club",
    cadence: "monthly",
    usualHours: 1,
    usualAllocations: [{ category: "educational", hours: 1 }],
    nextDue: "2026-09-15",
    archivedAt: null,
  },
];

/** Synthetic demonstration only: an obviously invented plan for the demo year. */
export const DEMO_CME_PLAN_GOALS: readonly CmePlanGoal[] = [
  { id: "00000000-0000-4000-8000-000000000201", goal: "Goal: keep up with a topic", sortOrder: 0 },
  { id: "00000000-0000-4000-8000-000000000202", goal: "Goal: review my own outcomes", sortOrder: 1 },
];
