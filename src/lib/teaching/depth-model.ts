import { z } from "zod";

import {
  seriesInputSchema,
  sessionStatuses,
  teachingDateSchema,
  teachingInstantSchema as instant,
  type LogbookRow,
  type SeriesInput,
} from "@/lib/teaching/model";
import { perthDate } from "@/lib/teaching/time";

/*
 * Depth (spec §3 PR B, part 4): supervision, the presenter's Teach page, feedback taps, the term
 * import and the weekly CPD review. Names and payloads are teaching_depth_command's own. Results are
 * parsed, so a key the database should never have sent (a topic for an organiser, a responder) is
 * dropped here. Client-safe: no server imports.
 */

export const supervisionTopics = [
  "case_review",
  "risk",
  "psychotherapy",
  "formulation",
  "medication",
  "mha_legal",
  "teaching_skills",
  "career",
  "exam_prep",
  "wellbeing",
  "other",
] as const;
export type SupervisionTopic = (typeof supervisionTopics)[number];
export const supervisionTopicLabels: Record<SupervisionTopic, string> = {
  case_review: "case review",
  risk: "risk",
  psychotherapy: "psychotherapy",
  formulation: "formulation",
  medication: "medication",
  mha_legal: "Mental Health Act and legal",
  teaching_skills: "teaching skills",
  career: "career",
  exam_prep: "exam preparation",
  wellbeing: "wellbeing",
  other: "other",
};
export const supervisionTypes = ["individual", "group"] as const;
export type SupervisionType = (typeof supervisionTypes)[number];
export const supervisionTypeLabels: Record<SupervisionType, string> = { individual: "Individual", group: "Group" };
export const correctionReasons = [
  "wrong_date",
  "wrong_length",
  "wrong_type",
  "wrong_topics",
  "entered_in_error",
] as const;
export type CorrectionReason = (typeof correctionReasons)[number];
export const correctionReasonLabels: Record<CorrectionReason, string> = {
  wrong_date: "Wrong date",
  wrong_length: "Wrong length",
  wrong_type: "Wrong type",
  wrong_topics: "Wrong topics",
  entered_in_error: "Entered in error",
};
export const readinessItems = ["reading_list", "aims", "slides_link", "room"] as const;
export type ReadinessItem = (typeof readinessItems)[number];
export const readinessLabels: Record<ReadinessItem, string> = {
  reading_list: "Reading list",
  aims: "Aims written",
  slides_link: "Slides link added",
  room: "Room confirmed",
};
export const feedbackPaces = ["slow", "right", "fast"] as const;
export type FeedbackPace = (typeof feedbackPaces)[number];
export const feedbackPaceLabels: Record<FeedbackPace, string> = {
  slow: "Too slow",
  right: "About right",
  fast: "Too fast",
};
/** Master plan R26: this wording wins over spec §7. */
export const FEEDBACK_PRIVACY_LINE = "Presenter and organisers see answers, not your name";
/**
 * Master plan R24: a supervision confirmation is held on the device this long ("Sending to Dr … · Undo")
 * before it is sent. After that, the fix is an "Entered in error" correction.
 */
export const SUPERVISION_UNDO_MS = 10_000;
export const IMPORT_TEMPLATE_HEADERS = [
  "title",
  "kind",
  "repeat",
  "first_date",
  "end_date",
  "start_time",
  "minutes",
  "venue",
  "join_link",
  "groups",
] as const;
export const IMPORT_MAX_ROWS = 200;
/** A term's timetable is a few kilobytes; anything larger is refused before it is opened. */
export const IMPORT_MAX_FILE_BYTES = 1_048_576;
export const CPD_REVIEW_MAX_ROWS = 20;

/**
 * Headers that look like patient identifiers. Matching any of these refuses the
 * whole import before a row is accepted. Ordinary extra columns that are not
 * patient-shaped stay ignored.
 */
export const IMPORT_FORBIDDEN_HEADER_PATTERNS: readonly RegExp[] = [
  /\bpatient(?:s)?(?:_|\b|$)/,
  /\bmrn\b/,
  /\bumrn\b/,
  /\bmedicare\b/,
  /\bdob\b/,
  /\bdate[_\s-]?of[_\s-]?birth\b/,
  /\bsurname\b/,
  /\bfirst[_\s-]?name\b/,
  /\blast[_\s-]?name\b/,
  /\bgiven[_\s-]?name\b/,
];

export const teachingDepthActions = [
  "pairing.save",
  "pairing.reassign",
  "supervision.log",
  "supervision.confirm",
  "supervision.note",
  "supervision.note.confirm",
  "supervision.read",
  "supervision.target.set",
  "readiness.set",
  "readiness.deid.confirm",
  "feedback.submit",
  "feedback.totals",
  "import.commit",
] as const;
export type TeachingDepthAction = (typeof teachingDepthActions)[number];

const uuid = z.uuid();
const supervisionMinutes = z.number().int().min(15).max(240).multipleOf(15);
const topicList = z.array(z.enum(supervisionTopics)).max(5); // optional: none to five
const count = z.number().int().nonnegative();

/** teaching_valid_correction, field for field: the corrected value only, never free text. */
const correctionValues: Record<CorrectionReason, z.ZodType> = {
  entered_in_error: z.object({}).strict(),
  wrong_date: z.object({ date: teachingDateSchema }).strict(),
  wrong_length: z.object({ minutes: supervisionMinutes }).strict(),
  wrong_type: z.object({ type: z.enum(supervisionTypes) }).strict(),
  wrong_topics: z.object({ topics: topicList }).strict(),
};

/** Master plan R25: an import adds new series, and they have no presenter until an organiser sets one. */
export const importSeriesSchema = seriesInputSchema
  .refine((row) => row.seriesId === undefined, "An import adds new series only.")
  .refine(
    (row) => row.presenterId === null,
    "An imported series has no presenter. Set one in Organise after the import.",
  );

/**
 * One spreadsheet row as the browser read it (master plan R25): its line number and its cells as
 * text. The header row is sent too, so the server matches columns by name.
 */
export const sheetRowSchema = z
  .object({
    line: z.number().int().min(1).max(100_000),
    cells: z.array(z.string().max(2000, "Keep each cell under 2,000 characters.")).max(30),
  })
  .strict();
export type SheetRow = z.infer<typeof sheetRowSchema>;

// ---- Requests ----------------------------------------------------------------------

export const teachingDepthActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("pairing.save"),
        pairingId: uuid.optional(),
        registrarId: uuid,
        supervisorId: uuid,
        startsOn: teachingDateSchema,
        endsOn: teachingDateSchema,
      })
      .strict(),
    z.object({ action: z.literal("pairing.reassign"), pairingId: uuid, supervisorId: uuid }).strict(),
    z
      .object({
        action: z.literal("supervision.target.set"),
        pairingId: uuid,
        targetHours: z
          .number()
          .min(1)
          .max(500)
          .refine((hours) => Math.round(hours * 10) / 10 === hours, "Use whole or tenth hours.")
          .nullable(),
      })
      .strict(),
    z
      .object({
        action: z.literal("supervision.log"),
        pairingId: uuid,
        date: teachingDateSchema,
        minutes: supervisionMinutes,
        type: z.enum(supervisionTypes),
        topics: topicList,
      })
      .strict(),
    z.object({ action: z.literal("supervision.confirm"), entryIds: z.array(uuid).min(1).max(20) }).strict(),
    z
      .object({
        action: z.literal("supervision.note"),
        entryId: uuid,
        reason: z.enum(correctionReasons),
        correctedValue: z.record(z.string(), z.unknown()),
      })
      .strict(),
    z.object({ action: z.literal("supervision.note.confirm"), noteId: uuid }).strict(),
    z
      .object({
        action: z.literal("readiness.set"),
        occurrenceId: uuid,
        item: z.enum(readinessItems),
        done: z.boolean(),
      })
      .strict(),
    z.object({ action: z.literal("readiness.deid.confirm"), occurrenceId: uuid }).strict(),
    z
      .object({
        action: z.literal("feedback.submit"),
        occurrenceId: uuid,
        useful: z.number().int().min(1).max(5),
        pace: z.enum(feedbackPaces),
      })
      .strict(),
    // Master plan R25: rows the browser read from the file; nothing is saved by a preview.
    z
      .object({
        action: z.literal("import.preview"),
        rows: z
          .array(sheetRowSchema)
          .min(1, "Add at least one session under the headings.")
          .max(IMPORT_MAX_ROWS + 1, `Import at most ${IMPORT_MAX_ROWS} rows at a time.`),
      })
      .strict(),
    z
      .object({ action: z.literal("import.commit"), rows: z.array(importSeriesSchema).min(1).max(IMPORT_MAX_ROWS) })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (value.action === "pairing.save") {
      const days = (Date.parse(value.endsOn) - Date.parse(value.startsOn)) / 86_400_000;
      if (value.registrarId === value.supervisorId) issue("Choose two different people.", "supervisorId");
      if (days < 0 || days > 731) issue("A pairing ends on or after it starts, within two years.", "endsOn");
    } else if (value.action === "supervision.confirm" && new Set(value.entryIds).size !== value.entryIds.length) {
      issue("List each session once.", "entryIds");
    } else if (value.action === "supervision.log" && new Set(value.topics).size !== value.topics.length) {
      issue("Choose each topic once.", "topics");
    } else if (
      value.action === "supervision.note" &&
      !correctionValues[value.reason].safeParse(value.correctedValue).success
    ) {
      issue("Choose the corrected value.", "correctedValue");
    }
  });
export type TeachingDepthInput = z.infer<typeof teachingDepthActionSchema>;

export const teachingDepthQuerySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("supervision.read"), pairingId: uuid.optional() }).strict(),
  z.object({ action: z.literal("feedback.totals"), occurrenceId: uuid }).strict(),
]);
export type TeachingDepthQuery = z.infer<typeof teachingDepthQuerySchema>;

export const teachingDepthViewSchema = z
  .object({ view: z.enum(["supervision", "pending", "teach", "feedback-open", "cpd-review"]) })
  .strict();
export type TeachingDepthView = z.infer<typeof teachingDepthViewSchema>["view"];

export const cpdReviewBodySchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            occurrenceId: uuid,
            // Master plan R20: the 8-hour cap cme_save_teaching_entry enforces.
            hours: z
              .number()
              .min(0.25)
              .max(8)
              .refine((hours) => Number.isInteger(hours * 4), "Use quarter hours."),
            requestId: uuid,
          })
          .strict(),
      )
      .min(1)
      .max(CPD_REVIEW_MAX_ROWS),
  })
  .strict()
  .refine(
    (body) => new Set(body.rows.map((row) => row.occurrenceId)).size === body.rows.length,
    "List each session once.",
  );
export type CpdReviewBody = z.infer<typeof cpdReviewBodySchema>;

// ---- Results -------------------------------------------------------------------------

const noteSchema = z.object({
  noteId: uuid,
  reason: z.enum(correctionReasons),
  correctedValue: z.record(z.string(), z.unknown()),
  createdAt: instant,
  confirmedAt: instant.nullable(),
});
const entrySchema = z.object({
  entryId: uuid,
  date: teachingDateSchema,
  minutes: z.number().int(),
  type: z.enum(supervisionTypes),
  topics: z.array(z.enum(supervisionTopics)),
  status: z.enum(["pending", "confirmed"]),
  confirmedAt: instant.nullable(),
  confirmedByName: z.string().nullable(),
  notes: z.array(noteSchema),
});
const pairingSchema = z
  .object({
    pairingId: uuid,
    access: z.enum(["registrar", "supervisor", "organiser"]),
    registrarName: z.string(),
    supervisorName: z.string(),
    startsOn: teachingDateSchema,
    endsOn: teachingDateSchema,
    targetHours: z.number().nullable(),
    confirmedMinutes: count,
    pendingMinutes: count,
    pendingCount: count,
    oldestPendingAt: instant.nullable(),
    entries: z.array(entrySchema).nullable(),
  })
  // Spec §4: an organiser sees totals and status only. Enforced by the SQL; repeated here so a
  // regression there still never sends topics or the registrar's own target to an organiser.
  .transform((row) => (row.access === "organiser" ? { ...row, entries: null, targetHours: null } : row));
export const supervisionReadSchema = z.object({ pairings: z.array(pairingSchema) });
export type SupervisionNote = z.infer<typeof noteSchema>;
export type SupervisionEntry = z.infer<typeof entrySchema>;
export type SupervisionPairing = z.infer<typeof pairingSchema>;
/**
 * A pairing labelled with its service. `readOnlyUntil` is set only for a service the reader has left
 * (master plan R28): their own entries as registrar stay readable, read-only, until then.
 */
export type SupervisionPairingView = SupervisionPairing & {
  serviceId: string;
  serviceName: string;
  readOnlyUntil: string | null;
};

export const readinessSchema = z.object({
  items: z.array(z.enum(readinessItems)),
  deidConfirmedAt: instant.nullable(),
});
export type Readiness = z.infer<typeof readinessSchema>;
export const feedbackTotalsSchema = z.discriminatedUnion("released", [
  z.object({ released: z.literal(false) }),
  z.object({
    released: z.literal(true),
    replies: count,
    useful: z.object({ 1: count, 2: count, 3: count, 4: count, 5: count }),
    pace: z.object({ slow: count, right: count, fast: count }),
  }),
]);
export type FeedbackTotals = z.infer<typeof feedbackTotalsSchema>;
export const sessionRefSchema = z.object({
  occurrenceId: uuid,
  serviceId: uuid,
  title: z.string(),
  startsAt: instant,
  endsAt: instant,
});
export type SessionRef = z.infer<typeof sessionRefSchema>;
const teachSessionSchema = sessionRefSchema.extend({
  venue: z.string().nullable(),
  status: z.enum(sessionStatuses),
  items: z.array(z.enum(readinessItems)),
  deidConfirmedAt: instant.nullable(),
});
export type TeachSession = z.infer<typeof teachSessionSchema>;
export const teachReadSchema = z.object({ upcoming: z.array(teachSessionSchema), taught: z.array(sessionRefSchema) });
export type TeachRead = z.infer<typeof teachReadSchema>;
export const feedbackOpenSchema = z.object({ sessions: z.array(sessionRefSchema) });
/**
 * `supervision.left_services` (S11b): the actor's own services left within 90 days where they are
 * the registrar on a pairing with supervision entries — found even with no attendance, unlike the
 * logbook (master plan R28).
 */
export type LeftService = { serviceId: string; serviceName: string; leftAt: string; readableUntil: string };
const leftServiceSchema = z.object({
  serviceId: uuid,
  serviceName: z.string(),
  leftAt: instant,
  readableUntil: instant,
}) satisfies z.ZodType<LeftService>;
export const leftServicesSchema = z.object({ services: z.array(leftServiceSchema) });
export type LeftServicesResult = z.infer<typeof leftServicesSchema>;
export const importCommittedSchema = z.object({ series: count, occurrences: count });
export type ImportCommitted = z.infer<typeof importCommittedSchema>;
export type ImportPreview = {
  rows: { line: number; title: string; errors: string[] }[];
  ready: SeriesInput[] | null;
};
export type CpdReviewRow = {
  occurrenceId: string;
  serviceName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  hours: number;
};
export type CpdReviewResult = {
  occurrenceId: string;
  entryId: string | null;
  code: string | null;
  message: string | null;
};

// ---- Pure helpers ----------------------------------------------------------------------

export type PendingConfirmation = {
  id: string;
  kind: "entry" | "note";
  serviceId: string;
  pairingId: string;
  registrarName: string;
  entry: SupervisionEntry;
  note: SupervisionNote | null;
  since: string;
};

/** What waits for the reader as supervisor: pending entries and unconfirmed corrections, oldest first. */
export function pendingConfirmations(pairings: readonly SupervisionPairingView[]): PendingConfirmation[] {
  const items: PendingConfirmation[] = [];
  for (const pairing of pairings) {
    // A leaver's rows are read-only, so nothing there waits for them.
    if (pairing.access !== "supervisor" || pairing.readOnlyUntil !== null) continue;
    for (const entry of pairing.entries ?? []) {
      const base = {
        serviceId: pairing.serviceId,
        pairingId: pairing.pairingId,
        registrarName: pairing.registrarName,
        entry,
      };
      if (entry.status === "pending")
        items.push({ ...base, id: entry.entryId, kind: "entry", note: null, since: entry.date });
      for (const note of entry.notes)
        if (!note.confirmedAt)
          items.push({ ...base, id: note.noteId, kind: "note", note, since: perthDate(note.createdAt) });
    }
  }
  return items.sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

/** The scheduled length in quarter hours, within what cme_save_teaching_entry accepts (0.25 to 8). */
export function reviewHours(startsAt: string, endsAt: string): number {
  const quarters = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 900_000);
  return Math.min(32, Math.max(1, quarters)) / 4;
}

/** Attended, ended and not yet in CPD, newest first (logbook.read's order), 50 at most. */
export function unloggedReviewRows(rows: readonly LogbookRow[], now: Date): CpdReviewRow[] {
  return rows
    .filter((row) => row.cpdEntryId === null && Date.parse(row.endsAt) <= now.getTime())
    .slice(0, 50)
    .map((row) => ({
      occurrenceId: row.occurrenceId,
      serviceName: row.serviceName,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      hours: reviewHours(row.startsAt, row.endsAt),
    }));
}

export function teachingDepthUrl(serviceId: string, query?: Record<string, string>): string {
  const path = `/api/teaching/services/${encodeURIComponent(serviceId)}/depth`;
  return query ? `${path}?${new URLSearchParams(query).toString()}` : path;
}
