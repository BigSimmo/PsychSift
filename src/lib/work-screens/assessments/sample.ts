/*
 * Every made-up record the Assessments work screens add, in one place, so the shared example-data
 * registry can take them over in one move. Every id starts "example:". The doctors, forms and EPAs
 * themselves are the existing sample's (`src/lib/teaching/assessments`); only the supervision rows
 * below are new. Topics only, never patient details.
 *
 * Anything built from a list to leave the page (a file, copied text, a notification) goes through
 * `withoutExampleRecords`, which the shared helper will replace.
 */

export const EXAMPLE_ID_PREFIX = "example:";

/** The id with the example prefix, added once. */
export function exampleId(id: string): string {
  return id.startsWith(EXAMPLE_ID_PREFIX) ? id : `${EXAMPLE_ID_PREFIX}${id}`;
}

export function isExampleRecord(record: { readonly id: string }): boolean {
  return record.id.startsWith(EXAMPLE_ID_PREFIX);
}

/** Drops made-up records from anything that leaves the page. */
export function withoutExampleRecords<T extends { readonly id: string }>(records: readonly T[]): T[] {
  return records.filter((record) => !isExampleRecord(record));
}

export interface SampleSession {
  readonly id: string;
  readonly date: string;
  readonly minutes: number;
  readonly kind: "Individual" | "Group";
  readonly topics: readonly string[];
  /** Already confirmed before this page opened. */
  readonly confirmed: boolean;
}

export interface SampleCorrection {
  readonly id: string;
  readonly date: string;
  readonly kind: "Individual" | "Group";
  readonly field: string;
  readonly was: string;
  readonly proposed: string;
  readonly topics: readonly string[];
  readonly confirmedOn: string;
}

export interface SampleSupervision {
  readonly sessions: readonly SampleSession[];
  readonly correction: SampleCorrection | null;
}

/** Made-up supervision for the doctors the sample supervisor supervises, keyed by overview doctor id. */
export const SAMPLE_SUPERVISION: Readonly<Record<string, SampleSupervision>> = {
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
