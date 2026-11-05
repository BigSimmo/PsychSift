export const cmeCategories = ["educational", "reviewing", "measuring"] as const;
export type CmeCategory = (typeof cmeCategories)[number];

export const cmeCategoryLabels: Record<CmeCategory, string> = {
  educational: "Educational activities",
  reviewing: "Reviewing performance",
  measuring: "Measuring outcomes",
};

/**
 * Four shapes, because three of them cannot be expressed as hours in a category
 * and every tracker that models only the first quietly misses them.
 *
 * The shape lives in a JSON `spec` column rather than in columns of its own, so
 * a shape this design does not yet draw — a trainee's weekly supervision
 * cadence, a count scoped to a rotation — is a code change rather than a
 * migration against the live clinical database.
 */
export type CmeRequirementSpec =
  | { shape: "credited-hours"; credit: "formal-peer-review"; minimumHours: number }
  | { shape: "hours-in-category"; category: CmeCategory; minimumHours: number }
  | {
      shape: "hours-across-categories";
      categories: readonly CmeCategory[];
      minimumHours: number;
      /** Each named category must also reach this on its own. */
      minimumEachHours: number;
    }
  | { shape: "activity-count"; buckets: readonly string[]; minimumPerBucket: number }
  | { shape: "task" };

export type CmeRequirementSource = "national" | "college";

export type CmeRequirement = {
  readonly id: string;
  readonly label: string;
  readonly source: CmeRequirementSource;
  readonly spec: CmeRequirementSpec;
  /** For `task` requirements only: whether the owner has marked it done. */
  readonly completedOn: string | null;
};

export type CmeAllocation = { readonly category: CmeCategory; readonly hours: number };

/** Complete stored content a full-record editor must still be replacing. */
export type CmeEntryVersion = {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly reflection: string;
  readonly costCents: number | null;
  readonly routineId: string | null;
  readonly documentId: string | null;
  readonly sourceUrl: string | null;
  readonly buckets: readonly string[];
  readonly formalPeerReviewHours: number;
  readonly transcribed: boolean;
  readonly archived: boolean;
  readonly allocations: readonly CmeAllocation[];
};

export type CmeEntry = {
  /** Present on stored entries; required when submitting a full edit or amendment. */
  readonly version?: CmeEntryVersion;
  readonly archivedAt?: string | null;
  readonly evidenceCount?: number;
  /** Active certificates only; `undefined` when not counted (falls back to `evidenceCount`). */
  readonly certificateCount?: number;
  /** A learning source link, not evidence of participation. */
  readonly sourceUrl?: string | null;
  /** Credit within reviewing hours, never extra hours added to the total. */
  readonly formalPeerReviewHours?: number;
  readonly id: string;
  /** Perth calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly title: string;
  readonly allocations: readonly CmeAllocation[];
  readonly reflection: string;
  readonly costCents: number | null;
  readonly transcribed: boolean;
  readonly routineId: string | null;
  readonly documentId: string | null;
  /** Free-text buckets this entry counts toward, for `activity-count` requirements. */
  readonly buckets: readonly string[];
  /** The development-plan goal this activity served, if the owner chose one. */
  readonly goalId?: string | null;
};

export type CmeRequirementSet = {
  readonly closedAt?: string | null;
  readonly year: number;
  /** When the owner confirmed these targets, and against what. Rendered on every screen showing a target. */
  readonly confirmedOn: string;
  readonly confirmedSource: string;
  readonly totalHours: number;
  readonly requirements: readonly CmeRequirement[];
};

export type CmeRequirementStatus = {
  readonly requirementId: string;
  readonly met: boolean;
  /** Null for shapes with no single scalar, such as a per-bucket count. */
  readonly progress: { readonly value: number; readonly target: number } | null;
  /**
   * Hours still needed before this is met, when that is more than
   * `progress.target - progress.value` — an `hours-across-categories`
   * requirement whose combined total is reached can still be short in one of
   * its categories. Absent when the aggregate gap already tells the whole story.
   */
  readonly hoursShort?: number;
  /** One plain status: "Reached", "3 h to go", "Ethical practice has nothing against it yet". */
  readonly summary: string;
};

/** One requirement as the app read it at the moment a year was closed. */
export type CmeClosedRequirementStatus = {
  readonly requirementId: string;
  readonly label: string;
  readonly met: boolean;
  readonly summary: string;
};

/** What the owner sees before and after an amendment to one activity in a closed year. */
export type CmeAmendedEntryVersion = {
  readonly date: string;
  readonly title: string;
  readonly allocations: readonly CmeAllocation[];
};

/** A dated, reasoned change to an activity in a closed year. The original is kept beside it. */
export type CmeYearAmendment = {
  readonly id: string;
  readonly entryId: string;
  readonly amendedAt: string;
  readonly reason: string;
  readonly before: CmeAmendedEntryVersion;
  readonly after: CmeAmendedEntryVersion;
};

/**
 * A closed year: the snapshot taken at closing, never changed afterwards, plus every
 * amendment made since. Current totals are read from the live record, which includes them.
 */
export type CmeYearClose = {
  readonly closedAt: string;
  readonly shortfallNote: string | null;
  readonly totalHours: number;
  readonly targetHours: number;
  readonly entryCount: number;
  readonly requirements: readonly CmeClosedRequirementStatus[];
  readonly amendments: readonly CmeYearAmendment[];
};

/** True only when the log has counted this activity's certificates and found none. */
export function cmeCertificateMissing(entry: Pick<CmeEntry, "certificateCount" | "evidenceCount">): boolean {
  return (entry.certificateCount ?? entry.evidenceCount) === 0;
}
