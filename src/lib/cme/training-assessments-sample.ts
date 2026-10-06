import type {
  CmeTrainingAssessments,
  InternAssessments,
  RegistrarAssessments,
  TrainingExampleView,
} from "@/lib/cme/training-assessments";
import type { TrainingMilestone, TrainingPeriod } from "@/lib/cme/training-timeline";

/**
 * The invented example people from the owner's approved CPD mock-up (screens
 * 04 and 05), for the signed-out sample and demo mode only. Every value is
 * copied from the mock-up; none of it is a real doctor, rotation or assessor.
 * Assessor names exist ONLY here: PsychSift never stores one.
 *
 * - Registrar: stage 3, rotation 2 of 4 (adult inpatient, 3 Aug 2026 to
 *   29 Jan 2027), 1 of 2 EPAs marked attained.
 * - Junior doctor: a WA intern in term 4 (14 Sep to 22 Nov 2026), 7 EPA
 *   assessments logged, clinical experience A 2, B 1, C 2, D 0 of 3.
 */

/** Sun 4 October 2026, 10:00 Perth: the mock-up's "today". */
export const SAMPLE_TRAINING_NOW_ISO = "2026-10-04T02:00:00.000Z";

export const SAMPLE_TRAINING_PERIODS: readonly TrainingPeriod[] = [
  { id: "sample-stage-3", kind: "stage", label: "Stage 3", startsOn: "2026-02-02", endsOn: "2028-01-28", fte: 1 },
  {
    id: "sample-rotation-1",
    kind: "rotation",
    label: "Example rotation one",
    startsOn: "2026-02-02",
    endsOn: "2026-07-31",
    fte: 1,
  },
  {
    id: "sample-rotation-2",
    kind: "rotation",
    label: "Adult inpatient",
    startsOn: "2026-08-03",
    endsOn: "2027-01-29",
    fte: 1,
  },
  {
    id: "sample-rotation-3",
    kind: "rotation",
    label: "Example rotation three",
    startsOn: "2027-02-01",
    endsOn: "2027-07-30",
    fte: 1,
  },
  {
    id: "sample-rotation-4",
    kind: "rotation",
    label: "Example rotation four",
    startsOn: "2027-08-02",
    endsOn: "2028-01-28",
    fte: 1,
  },
];

export const SAMPLE_TRAINING_MILESTONES: readonly TrainingMilestone[] = [
  {
    id: "sample-milestone-1",
    label: "Mid-rotation review",
    dueKind: "date",
    dueFteMonths: null,
    dueOn: "2026-11-02",
    completedOn: null,
  },
  {
    id: "sample-milestone-2",
    label: "Example milestone two",
    dueKind: "date",
    dueFteMonths: null,
    dueOn: "2027-03-01",
    completedOn: null,
  },
  {
    id: "sample-milestone-3",
    label: "Example milestone three",
    dueKind: "date",
    dueFteMonths: null,
    dueOn: "2027-08-02",
    completedOn: null,
  },
];

export const SAMPLE_REGISTRAR_ASSESSMENTS: RegistrarAssessments = {
  rotationEndsOn: "2027-01-29",
  minimumEpas: 2,
  wbasPerEpa: 3,
  epas: [
    { id: "sample-epa-1", title: "Example EPA one", wbasLogged: 2, assessor: "Dr Example", attainedOn: null },
    { id: "sample-epa-2", title: "Example EPA two", wbasLogged: 0, assessor: null, attainedOn: null },
    { id: "sample-epa-3", title: "Example EPA three", wbasLogged: 3, assessor: null, attainedOn: "2026-09-14" },
  ],
};

export const SAMPLE_INTERN_ASSESSMENTS: InternAssessments = {
  year: 2026,
  termName: "general medicine",
  currentTerm: 4,
  midTermAssessmentOn: "2026-10-16",
  terms: [
    { number: 1, startsOn: "2026-01-19", endsOn: "2026-04-05", epaCount: 3 },
    { number: 2, startsOn: "2026-04-06", endsOn: "2026-06-21", epaCount: 2 },
    { number: 3, startsOn: "2026-06-22", endsOn: "2026-09-13", epaCount: 2 },
    { number: 4, startsOn: "2026-09-14", endsOn: "2026-11-22", epaCount: 0 },
    { number: 5, startsOn: "2026-11-23", endsOn: "2027-01-31", epaCount: 0 },
  ],
  annualMinimum: 10,
  perTermMinimum: 2,
  experienceTermsNeeded: 3,
  experience: [
    { category: "A", label: "Undifferentiated illness", coveredTerms: [1, 3] },
    { category: "B", label: "Chronic illness", coveredTerms: [2] },
    { category: "C", label: "Acute and critical illness", coveredTerms: [1, 3] },
    { category: "D", label: "Peri-procedural care", coveredTerms: [] },
  ],
};

/** The sample assessments for one example person. */
export function sampleTrainingAssessments(view: TrainingExampleView): CmeTrainingAssessments {
  return view === "intern"
    ? { status: "sample", view: "intern", intern: SAMPLE_INTERN_ASSESSMENTS }
    : { status: "sample", view: "registrar", registrar: SAMPLE_REGISTRAR_ASSESSMENTS };
}
