import { normalizeCmeSourceUrl } from "@/lib/cme/learning-source";
import { z } from "zod";
import { cmeCategories } from "@/lib/cme/types";
import { cmeRoutineCadences } from "@/lib/cme/routines";

export const cmeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      Number(value.slice(0, 4)) >= 2000 &&
      Number(value.slice(0, 4)) <= 2100
    );
  }, "Use a real calendar date between 2000 and 2100.");
export const cmeAllocationSchema = z.object({ category: z.enum(cmeCategories), hours: z.number().positive().max(24) });
const allocationList = z
  .array(cmeAllocationSchema)
  .max(3)
  .refine((items) => new Set(items.map((a) => a.category)).size === items.length, "Use each category only once.");
const entryFields = z.object({
  date: cmeDateSchema,
  title: z.string().trim().min(1).max(200),
  allocations: allocationList
    .refine((items) => items.length > 0, "Add an allocation.")
    .refine((items) => items.reduce((sum, a) => sum + a.hours, 0) <= 24, "Allocate no more than 24 hours per entry."),
  reflection: z.string().max(2000).default(""),
  costCents: z.number().int().nonnegative().max(2147483647).nullable().default(null),
  routineId: z.string().uuid().nullable().default(null),
  documentId: z.string().uuid().nullable().default(null),
  sourceUrl: z
    .string()
    .max(2000)
    .refine((v) => normalizeCmeSourceUrl(v) !== null, "Use a valid source link.")
    .nullable()
    .optional(),
  buckets: z
    .array(z.string().trim().min(1).max(80))
    .max(8)
    .refine((items) => new Set(items).size === items.length, "Use each domain only once.")
    .default([]),
  formalPeerReviewHours: z.number().nonnegative().max(24).default(0),
});
const validCredit = (entry: { formalPeerReviewHours: number; allocations: { category: string; hours: number }[] }) =>
  entry.formalPeerReviewHours <=
  entry.allocations.filter((a) => a.category === "reviewing").reduce((sum, a) => sum + a.hours, 0);
// A stored-content token must preserve exact strings rather than normalising edited input.
export const cmeEntryVersionSchema = z.object({
  id: z.string().uuid(),
  date: cmeDateSchema,
  title: z.string().max(200),
  reflection: z.string().max(2000),
  costCents: z.number().int().nonnegative().max(2147483647).nullable(),
  routineId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  sourceUrl: z.string().max(2000).nullable(),
  buckets: z.array(z.string().max(80)).max(8),
  formalPeerReviewHours: z.number().nonnegative().max(24),
  transcribed: z.boolean(),
  archived: z.boolean(),
  allocations: z.array(cmeAllocationSchema).max(3),
});
export const cmeEntryCreateSchema = entryFields
  .extend({
    requestId: z.string().uuid().optional(),
    // A saved draft this activity finishes: deleted only after the activity is saved.
    draftId: z.string().uuid().optional(),
    // A missed teaching or supervision session this activity replaces: linked after it is saved.
    missedSessionId: z.string().uuid().optional(),
  })
  .refine(validCredit, "Formal peer review credit cannot exceed reviewing hours.");
// A complete replace prevents omitted fields from silently erasing prior records.
export const cmeEntryUpdateSchema = entryFields
  .required()
  .extend({
    formalPeerReviewHours: z.number().nonnegative().max(24),
    sourceUrl: entryFields.shape.sourceUrl,
    // Missing versions receive the repository's reload conflict, including older clients.
    expectedVersion: cmeEntryVersionSchema.optional(),
  })
  .refine(validCredit, "Formal peer review credit cannot exceed reviewing hours.");
export const cmeListQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const hours = z.number().positive().max(500);
export const cmeRequirementSpecSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("hours-in-category"), category: z.enum(cmeCategories), minimumHours: hours }),
  z.object({
    shape: z.literal("hours-across-categories"),
    categories: z
      .array(z.enum(cmeCategories))
      .min(1)
      .max(3)
      .refine((a) => new Set(a).size === a.length),
    minimumHours: hours,
    minimumEachHours: z.number().nonnegative().max(500),
  }),
  z.object({ shape: z.literal("credited-hours"), credit: z.literal("formal-peer-review"), minimumHours: hours }),
  z.object({
    shape: z.literal("activity-count"),
    buckets: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(8)
      .refine((a) => new Set(a).size === a.length),
    minimumPerBucket: z.number().int().positive().max(100),
  }),
  z.object({ shape: z.literal("task") }),
]);
export const cmeYearConfirmSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    totalHours: hours,
    confirmedOn: cmeDateSchema,
    confirmedSource: z.string().trim().min(1).max(1000),
    requirements: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(100),
          label: z.string().trim().min(1).max(200),
          source: z.enum(["national", "college"]),
          spec: cmeRequirementSpecSchema,
          completedOn: cmeDateSchema.nullable(),
        }),
      )
      .min(1)
      .max(30),
  })
  .refine(
    (s) => new Set(s.requirements.map((r) => r.id)).size === s.requirements.length,
    "Requirement IDs must be unique.",
  )
  .refine(
    (s) => s.requirements.every((r) => r.completedOn === null || r.spec.shape === "task"),
    "Only tasks have completion dates.",
  );
const routineFields = z.object({
  title: z.string().trim().min(1).max(200),
  cadence: z.enum(cmeRoutineCadences),
  usualHours: z.number().positive().max(24),
  usualAllocations: allocationList,
  nextDue: cmeDateSchema.nullable(),
  archivedAt: z.string().datetime().nullable(),
});
const validRoutine = (r: { usualHours: number; usualAllocations: { hours: number }[] }) =>
  r.usualAllocations.length === 0 ||
  Math.abs(r.usualAllocations.reduce((s, a) => s + a.hours, 0) - r.usualHours) < 0.001;
export const cmeRoutineCreateSchema = routineFields
  .extend({ archivedAt: z.null().default(null) })
  .refine(validRoutine, "Category hours must equal usual hours.");
export const cmeRoutineUpdateSchema = routineFields.refine(validRoutine, "Category hours must equal usual hours.");
// Closing a year: which year, and an optional note explaining a shortfall. The note goes on the
// record; it does not reduce any requirement.
export const cmeYearCloseSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    shortfallNote: z.string().trim().max(2000).optional(),
  })
  .strict();
// An amendment to an activity in a closed year: the same complete record as an edit, plus the
// reason, which is stored with the date beside the original.
export const cmeEntryAmendSchema = entryFields
  .required()
  .extend({
    formalPeerReviewHours: z.number().nonnegative().max(24),
    // Required (null when there is none): an amendment states the whole record.
    sourceUrl: entryFields.shape.sourceUrl.unwrap(),
    amendmentReason: z.string().trim().min(3).max(1000),
    expectedVersion: cmeEntryVersionSchema.optional(),
  })
  .refine(validCredit, "Formal peer review credit cannot exceed reviewing hours.");
