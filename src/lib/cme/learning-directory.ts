import { z } from "zod";

import directoryJson from "@/data/cme/wa-learning-directory.json";
import { normalizeCmeSourceUrl } from "@/lib/cme/learning-source";

/**
 * WA LEARNING DIRECTORY — a curated, hand-checked list of upcoming courses and
 * events in Western Australia that a doctor may want to attend.
 *
 * The data lives in `src/data/cme/wa-learning-directory.json`, not the database,
 * so a monthly check (by a person or an automated job) can rewrite that one file
 * and open a pull request. Everything that job must get right is enforced here:
 * the schema is strict, so a misspelt field fails the unit test instead of
 * silently rendering nothing.
 *
 * Nothing here fetches, tracks or logs attendance. "Log as CPD" only prefills the
 * new-entry form with a title and a link; the owner still decides what to record.
 *
 * Dates are Perth calendar dates (`YYYY-MM-DD`), compared as strings — the same
 * discipline `cpd-year.ts` documents, so no runtime time zone can roll a date.
 */

function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine(isRealCalendarDate, "Not a real calendar date.");

/** An https link that also passes the CME source-link rules (no credentials, no control characters). */
const httpsUrlSchema = z.string().transform((value, context) => {
  const normalized = normalizeCmeSourceUrl(value);
  if (!normalized || !normalized.startsWith("https://")) {
    context.addIssue({ code: "custom", message: "Links must be absolute https URLs." });
    return z.NEVER;
  }
  return normalized;
});

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

const learningDirectoryItemSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase, hyphenated id.")
      .max(120),
    title: nonEmptyText(200),
    provider: nonEmptyText(160),
    /** Omitted means the item is relevant to every specialty. */
    specialties: z
      .array(nonEmptyText(80).transform((value) => value.toLowerCase()))
      .max(20)
      .optional(),
    kind: z.enum(["course", "event", "recorded"]),
    /**
     * False when the organiser's page did not give a date that could be
     * confirmed. Such items may carry null dates, never drop off automatically,
     * and are shown apart from the dated list.
     */
    datesConfirmed: z.boolean(),
    startsOn: calendarDateSchema.nullable(),
    endsOn: calendarDateSchema.nullable(),
    /** Optional Perth 24-hour wall times; omitted means an all-day event. */
    startsAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endsAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    mode: z.enum(["online", "in-person", "both"]),
    location: nonEmptyText(160).nullable(),
    costNote: nonEmptyText(200).nullable(),
    /**
     * How a doctor may already have access, shown before the cost so nobody pays
     * for something their workshop or employer already covers. Omitted means unknown.
     */
    access: z.enum(["included-in-workshop", "employer"]).optional(),
    /** True when the organiser has cancelled it. A cancelled item stays listed, flagged, until it would have finished. */
    cancelled: z.boolean().optional(),
    url: httpsUrlSchema,
    /** Where the details were confirmed; may equal `url`. */
    sourceUrl: httpsUrlSchema,
    lastCheckedOn: calendarDateSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (item.datesConfirmed && item.startsOn === null && item.kind !== "recorded") {
      context.addIssue({
        code: "custom",
        path: ["startsOn"],
        message: "A course or event with confirmed dates needs a start date.",
      });
    }
    if (item.cancelled && item.kind === "recorded") {
      context.addIssue({ code: "custom", path: ["cancelled"], message: "A recorded resource cannot be cancelled." });
    }
    if (item.endsOn !== null && item.startsOn === null) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: "An end date needs a start date." });
    }
    if (item.endsOn !== null && item.startsOn !== null && item.endsOn < item.startsOn) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: "The end date is before the start date." });
    }
    if ((item.startsAt === undefined) !== (item.endsAt === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "A timed event needs both start and end times.",
      });
    }
    if (
      item.startsAt &&
      item.endsAt &&
      item.startsOn &&
      (item.endsOn ?? item.startsOn) === item.startsOn &&
      item.endsAt <= item.startsAt
    ) {
      context.addIssue({ code: "custom", path: ["endsAt"], message: "The end time must follow the start time." });
    }
    if (
      item.specialties &&
      new Set(item.specialties.map((specialty) => specialty.toLowerCase())).size !== item.specialties.length
    ) {
      context.addIssue({ code: "custom", path: ["specialties"], message: "Specialties must be unique." });
    }
  });

const learningDirectorySchema = z
  .object({
    lastCheckedOn: calendarDateSchema,
    items: z.array(learningDirectoryItemSchema),
  })
  .strict()
  .superRefine((directory, context) => {
    const seen = new Set<string>();
    directory.items.forEach((item, index) => {
      if (seen.has(item.id)) {
        context.addIssue({ code: "custom", path: ["items", index, "id"], message: `Duplicate id "${item.id}".` });
      }
      seen.add(item.id);
    });
  });

export type LearningDirectoryItem = z.infer<typeof learningDirectoryItemSchema>;
type LearningDirectory = z.infer<typeof learningDirectorySchema>;

/** Validates a directory file. Throws with every problem listed, so a bad monthly rewrite fails loudly. */
export function parseLearningDirectory(input: unknown): LearningDirectory {
  const result = learningDirectorySchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`The WA learning directory is invalid:\n${problems.join("\n")}`);
  }
  return result.data;
}

/** Validated once at module load: an invalid file breaks the build and the tests, never the reader's page silently. */
const WA_LEARNING_DIRECTORY = parseLearningDirectory(directoryJson);

export function loadLearningDirectory(): LearningDirectory {
  return WA_LEARNING_DIRECTORY;
}

export {
  LEARNING_DIRECTORY_STALE_AFTER_DAYS,
  upcomingLearningItems,
  unconfirmedLearningItems,
  defaultLearningSpecialty,
  filterLearningItems,
  pastLearningItems,
  groupLearningByMonth,
  isDirectoryStale,
  learningItemLogHref,
} from "@/lib/cme/learning-directory-view";
export type { LearningFormat, LearningSpecialty, LearningMonthGroup } from "@/lib/cme/learning-directory-view";
