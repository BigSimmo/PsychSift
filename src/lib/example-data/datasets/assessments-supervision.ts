/*
 * Example supervision for the Assessments supervisor's view of a trainee
 * (`/teaching/assessments/trainee/[id]`): the sessions waiting for the example supervisor's sign-off
 * and a correction one doctor proposed. Keyed by the doctor ids of the existing Assessments sample
 * (`src/lib/teaching/assessments/sample.ts`), which holds the doctors themselves. Every id starts
 * "example:". Topics only, never patient details. Read through the registry,
 * `loadExampleDataset("assessments.supervision")`.
 */

export interface ExampleSupervisionSession {
  readonly id: string;
  readonly date: string;
  readonly minutes: number;
  readonly kind: "Individual" | "Group";
  readonly topics: readonly string[];
  /** Already confirmed before this page opened. */
  readonly confirmed: boolean;
}

export interface ExampleSupervisionCorrection {
  readonly id: string;
  readonly date: string;
  readonly kind: "Individual" | "Group";
  readonly field: string;
  readonly was: string;
  readonly proposed: string;
  readonly topics: readonly string[];
  readonly confirmedOn: string;
}

export interface ExampleSupervision {
  readonly sessions: readonly ExampleSupervisionSession[];
  readonly correction: ExampleSupervisionCorrection | null;
}

export type ExampleSupervisionByDoctor = Readonly<Record<string, ExampleSupervision>>;

/** Supervision for the doctors the example supervisor supervises, keyed by overview doctor id. */
export const EXAMPLE_ASSESSMENTS_SUPERVISION: ExampleSupervisionByDoctor = {
  sam: {
    sessions: [
      {
        id: "example:sam-s3",
        date: "Mon 5 Oct",
        minutes: 60,
        kind: "Individual",
        topics: ["formulation", "risk", "career"],
        confirmed: false,
      },
      {
        id: "example:sam-s2",
        date: "Tue 29 Sep",
        minutes: 60,
        kind: "Individual",
        topics: ["handover"],
        confirmed: true,
      },
      { id: "example:sam-s1", date: "Fri 25 Sep", minutes: 90, kind: "Group", topics: ["teaching"], confirmed: true },
    ],
    correction: null,
  },
  ben: {
    sessions: [
      { id: "example:ben-s1", date: "Thu 1 Oct", minutes: 60, kind: "Individual", topics: ["risk"], confirmed: true },
    ],
    correction: {
      id: "example:ben-c1",
      date: "Thu 24 Sep",
      kind: "Individual",
      field: "Wrong length",
      was: "60 min",
      proposed: "90 min",
      topics: ["risk", "medication"],
      confirmedOn: "Thu 24 Sep",
    },
  },
  mia: {
    sessions: [
      {
        id: "example:mia-s1",
        date: "Fri 2 Oct",
        minutes: 90,
        kind: "Group",
        topics: ["teaching", "medication"],
        confirmed: false,
      },
    ],
    correction: null,
  },
};
