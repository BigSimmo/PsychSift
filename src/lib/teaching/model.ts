import { z } from "zod";

/**
 * Teaching's shared shapes (plan-contracts §5) and the schemas that check what
 * crosses the HTTP boundary, in both directions.
 *
 * Results read back from the database are parsed as well, and Zod drops any key a
 * schema does not name. That is deliberate defence in depth: if a database function
 * ever returned a field it must not (the check-in secret, a join link in a week
 * list), it still never reaches a browser.
 */

export const teachingRoles = ["doctor", "organiser", "admin"] as const;
export type TeachingRole = (typeof teachingRoles)[number];
export const attendanceMethods = ["code_room", "code_teams", "self"] as const;
export type AttendanceMethod = (typeof attendanceMethods)[number];
export const checkinStreams = ["room", "teams"] as const;
export type CheckinStream = (typeof checkinStreams)[number];
export const sessionStatuses = ["scheduled", "moved", "cancelled"] as const;
export type SessionStatus = (typeof sessionStatuses)[number];
export const seriesKinds = ["lecture", "case", "journal", "grand_round", "simulation", "workshop", "other"] as const;
export const seriesRepeats = ["once", "weekly", "fortnightly", "monthly_nth"] as const;
/** Master plan R4: which level a series is for (`teaching_series.audience`). */
export const seriesAudiences = ["interns", "residents", "registrars", "consultants", "all_doctors"] as const;
export type SeriesAudience = (typeof seriesAudiences)[number];
export const changeReasons = [
  "presenter_unavailable",
  "room_change",
  "clinical_pressure",
  "public_holiday",
  "rescheduled",
  "other",
] as const;

export const teachingActions = [
  "week.read",
  "session.read",
  "attendance.self",
  "checkin.code",
  "checkin.typed",
  "checkin.complete",
  "display.create",
  "display.revoke",
  "notice.read",
  "calendar.set",
  "logbook.read",
  "cpd.unlogged",
  // Part 4 (S11): the presenter's own talks and the sessions whose feedback is still open, across teams.
  "teach.read",
  "feedback.open",
  "series.save",
  "occurrence.change",
  "group.save",
  "group.delete",
  "group.members.set",
  "register.read",
  "export.attendance",
  "members.read",
  "invitation.create",
  "role.set",
  "audit.read",
  // Reconciliation with part 1 (master plan S10): four actions Josh's later answers gave part 1
  // that S3/S4 predate.
  "organise.read",
  "attendance.remove",
  "session.next",
  "supervision.pending",
  // S11b: the leaver's own left services with supervision, found even with no attendance.
  "supervision.left_services",
] as const;
export type TeachingAction = (typeof teachingActions)[number];

export type TeamSummary = {
  id: string;
  name: string;
  role: TeachingRole;
  acceptsRealData: boolean;
  isDemo: boolean;
  /** `week.read` (part 4): the reader presents a session of this service in the next 90 days. */
  presenting?: boolean;
  /** The authenticated reader's persisted calendar consent. */
  inCalendar?: boolean;
};
export type SessionSummary = {
  occurrenceId: string;
  serviceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  hasJoinLink: boolean;
  status: SessionStatus;
  isPresenter: boolean;
  source: "teaching" | "on_call_relocated";
  /** An On Call session with a date but no clock time. Never set on Teaching's own sessions. */
  allDay?: true;
  /** A moved session's former start, also shown in week summaries. */
  previousStartsAt?: string | null;
};
export type SessionDetail = SessionSummary & {
  joinUrl: string | null;
  presenterName: string | null;
  materials: { label: string; url: string }[];
  changeReason: string | null;
  canShowCode: boolean;
  counts: { code: number; self: number; expected?: number; visitors?: number } | null;
  /** Master plan R15: a health-service visitor gets the read-only view. A missing marker reads as false. */
  visitor: boolean;
  /** Master plan R3 and R9: optional fields `session.read` sends. */
  seriesId?: string | null;
  /** Set only while the session is moved; drives "Moved from 12:30". */
  previousStartsAt?: string | null;
  /** The caller's own mark only, or null. */
  myAttendance?: { method: AttendanceMethod; recordedAt: string } | null;
  inCalendar?: boolean;
};
export type AttendanceMark = { occurrenceId: string; method: AttendanceMethod; recordedAt: string };
export type Notice = {
  id: string;
  occurrenceId: string;
  serviceId: string;
  kind: "moved" | "cancelled";
  createdAt: string;
};
export type LogbookRow = AttendanceMark & {
  title: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  cpdEntryId: string | null;
  /** `logbook.read` sends both; optional so fixtures that predate them stay valid. */
  serviceId?: string;
  /** Master plan R28: set for a leaver, whose record stays readable (read-only) until this time. */
  readOnlyUntil?: string | null;
};
export type TeachingWeek = {
  teams: TeamSummary[];
  sessions: SessionSummary[];
  notices: Notice[];
  attendance: AttendanceMark[];
};
export type TeachingWeekResponse = TeachingWeek & { relocated: SessionSummary[]; relocatedUnavailable: boolean };
export type CheckinCode = { token: string; typedCode: string; window: number; validUntil: string };
export type DisplayCode = {
  token: string;
  typedCode: string;
  window: number;
  title: string;
  venue: string | null;
  closesAt: string;
};
export type CheckinOpened = { occurrenceId: string; title: string; startsAt: string; stream: CheckinStream };
export type CheckinCompleted = AttendanceMark & { serviceId: string };
export type RegisterRow = {
  userId: string | null;
  name: string | null;
  method: AttendanceMethod;
  recordedAt: string;
};
export type RegisterResult =
  { rows: RegisterRow[]; visitors: number } | { counts: { code: number; self: number; visitors: number } };
export type ExportRow = {
  occurrenceId: string;
  title: string;
  startsAt: string;
  userId: string | null;
  name: string | null;
  method: AttendanceMethod;
  recordedAt: string;
};
export type MemberRow = { userId: string; name: string | null; role: TeachingRole; joinedAt: string };
export type AuditRow = {
  id: number;
  actorId: string | null;
  /** Master plan part 1: an actor's own display name at read time, never stripped for the admin viewing it. */
  actorName: string | null;
  action: string;
  subjectId: string | null;
  at: string;
};

export const attendanceLabels: Record<AttendanceMethod, string> = {
  code_room: "Checked in by code · shown in room",
  code_teams: "Checked in by code · shown on Teams",
  // Master plan R1/R16: members and visitors alike. The stored method value stays `self`.
  self: "Self-reported",
};

/** Relocated On Call sessions belong to no Teaching team. */
export const RELOCATED_SERVICE_ID = "on-call";
export const FORMER_MEMBER_LABEL = "Former member";
export const MEMBER_FALLBACK_LABEL = "Member";

/** A person as a register shows them: their chosen name, "Member", or "Former member" once the account is gone. */
export function memberLabel(person: { userId: string | null; name: string | null }): string {
  if (!person.userId) return FORMER_MEMBER_LABEL;
  const name = person.name?.trim();
  return name ? name : MEMBER_FALLBACK_LABEL;
}

/** The CPD entry a "Log to CPD" save created or reused. */
export function teachingCpdEntryHref(entryId: string): string {
  return `/cme/log/${entryId}`;
}

/** `<occurrence hex 32><r|t><window><mac hex 32>` (plan-contracts §4). */
export const CHECKIN_TOKEN_PATTERN = /^([0-9a-f]{32})([rt])(\d{1,12})([0-9a-f]{32})$/;
/** Display-link secrets and claim secrets: 32 random bytes as lower-case hex. */
export const TEACHING_SECRET_PATTERN = /^[0-9a-f]{64}$/;

const GENERIC_ISSUE_MESSAGE = "Check the details and try again.";

/**
 * Teaching's schema messages are plain sentences ending in a full stop ("Remove the passcode
 * from this link. Share passcodes another way."). Zod's built-in English ("Too small: expected
 * string to have >=3 characters", "Invalid UUID") never ends in one, so it becomes a generic line.
 */
export function plainTeachingIssue(issues: readonly { message: string }[]): string {
  return issues.find((issue) => /^[A-Z][^{}<>]*\.$/.test(issue.message))?.message ?? GENERIC_ISSUE_MESSAGE;
}

// ---- Field rules ----------------------------------------------------------------

const uuid = z.uuid();
const instant = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), "Use an ISO date and time.");
/** The ISO instant rule, shared with `depth-model.ts`. */
export const teachingInstantSchema = instant;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` that really exists: V8 would otherwise read 30 February as 2 March. */
export const teachingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Use a real calendar date.");
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time, HH:MM.");

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|\[.*\]|\d+(?:\.\d+){3})$/i;

function isPublicHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !PRIVATE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** Query parameters meeting services use for a passcode (Teams `p`, Zoom `pwd`, Webex `password`, …). */
const PASSCODE_PARAMETERS = new Set(["p", "pw", "pwd", "pass", "passcode", "password", "pin"]);

/** Whether a link carries a meeting passcode. Teaching never stores passcodes, even inside a link. */
export function linkCarriesPasscode(raw: string): boolean {
  try {
    return [...new URL(raw).searchParams.keys()].some((key) => PASSCODE_PARAMETERS.has(key.toLowerCase()));
  } catch {
    return false;
  }
}

export const teachingLinkUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(isPublicHttpsUrl, "Use a public https link without a user name or password.");
export const teachingJoinUrlSchema = teachingLinkUrlSchema.refine(
  (value) => !linkCarriesPasscode(value),
  "Remove the passcode from this link. Share passcodes another way.",
);
export const teachingMaterialSchema = z
  .object({ label: z.string().trim().min(1).max(160), url: teachingLinkUrlSchema })
  .strict();

const secretToken = z.string().regex(TEACHING_SECRET_PATTERN);

// ---- Series -----------------------------------------------------------------------

const seriesFields = z
  .object({
    seriesId: uuid.optional(),
    title: z.string().trim().min(3).max(160),
    kind: z.enum(seriesKinds),
    groupIds: z.array(uuid).max(20).default([]),
    repeat: z.enum(seriesRepeats),
    firstDate: teachingDateSchema,
    startTime: timeOfDay,
    minutes: z.number().int().min(10).max(480),
    venue: z.string().trim().max(160).nullable().default(null),
    joinUrl: teachingJoinUrlSchema.nullable().default(null),
    skipDates: z.array(teachingDateSchema).max(60).default([]),
    endDate: teachingDateSchema,
    presenterId: uuid.nullable().default(null),
    materials: z.array(teachingMaterialSchema).max(10).default([]),
    // No default on purpose: `series.save` keeps a saved series' level when this is left out, and a
    // new series falls back to all_doctors in the database.
    audience: z.enum(seriesAudiences).optional(),
  })
  .strict();

type Issue = { path: string; message: string };

function seriesIssues(value: { firstDate: string; endDate: string; repeat: string }): Issue[] {
  const issues: Issue[] = [];
  const span = daysBetween(value.firstDate, value.endDate);
  if (span < 0) issues.push({ path: "endDate", message: "The end date must be on or after the first date." });
  if (span > 366) issues.push({ path: "endDate", message: "A series can run for at most a year." });
  if (value.repeat === "once" && value.endDate !== value.firstDate)
    issues.push({ path: "endDate", message: "A one-off session ends on its own date." });
  return issues;
}

export const seriesInputSchema = seriesFields.superRefine((value, ctx) => {
  for (const issue of seriesIssues(value)) ctx.addIssue({ code: "custom", message: issue.message, path: [issue.path] });
});
export type SeriesInput = z.infer<typeof seriesInputSchema>;

// ---- Requests ---------------------------------------------------------------------

/**
 * `GET /api/teaching`: the week (default), the logbook, the unlogged count for CPD's Today, or one
 * session by occurrence id alone (a calendar link knows no team).
 */
export const teachingOverviewQuerySchema = z
  .object({
    view: z
      .enum(["week", "logbook", "unlogged-count", "session", "next-session", "supervision-pending"])
      .default("week"),
    from: teachingDateSchema.optional(),
    to: teachingDateSchema.optional(),
    occurrenceId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.view === "session") !== Boolean(value.occurrenceId))
      ctx.addIssue({
        code: "custom",
        message: "Only the session view takes an occurrence id, and it needs one.",
        path: ["occurrenceId"],
      });
    if (value.view !== "week") {
      if (value.from || value.to)
        ctx.addIssue({ code: "custom", message: "Only the week view takes dates.", path: ["from"] });
      return;
    }
    if (Boolean(value.from) !== Boolean(value.to)) {
      ctx.addIssue({ code: "custom", message: "Give both a from and a to date.", path: ["to"] });
      return;
    }
    if (value.from && value.to) {
      const span = daysBetween(value.from, value.to);
      if (span < 0 || span > 41)
        ctx.addIssue({ code: "custom", message: "A week view covers 1 to 42 days.", path: ["to"] });
    }
  });
export type TeachingOverviewQuery = z.infer<typeof teachingOverviewQuerySchema>;

/** `GET /api/teaching/services/[serviceId]?action=…`: reads for one team. */
export const teachingServiceQuerySchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("session.read"), occurrenceId: uuid }),
    z.object({ action: z.literal("register.read"), occurrenceId: uuid }),
    z.object({ action: z.literal("checkin.code"), occurrenceId: uuid, stream: z.enum(checkinStreams) }),
    z.object({ action: z.literal("members.read") }),
    z.object({
      action: z.literal("audit.read"),
      before: instant.optional(),
      // Keyset paging (part 1): before and beforeId page together, or neither is given.
      beforeId: z.number().int().nonnegative().optional(),
    }),
    z.object({ action: z.literal("export.attendance"), from: teachingDateSchema, to: teachingDateSchema }),
    z.object({ action: z.literal("organise.read") }),
  ])
  .superRefine((value, ctx) => {
    if (value.action === "audit.read" && Boolean(value.before) !== Boolean(value.beforeId)) {
      ctx.addIssue({
        code: "custom",
        message: "Give both a before time and a before id, or neither.",
        path: ["beforeId"],
      });
      return;
    }
    if (value.action !== "export.attendance") return;
    const span = daysBetween(value.from, value.to);
    if (span < 0 || span > 366)
      ctx.addIssue({ code: "custom", message: "An export covers at most a year.", path: ["to"] });
  });
export type TeachingServiceQuery = z.infer<typeof teachingServiceQuerySchema>;

const optionalVenue = z.string().trim().max(160).nullable().optional();

/** `POST /api/teaching/services/[serviceId]`: writes for one team. The actor never comes from the body. */
export const teachingServiceActionSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("attendance.self"), occurrenceId: uuid }).strict(),
    z
      .object({
        action: z.literal("checkin.typed"),
        occurrenceId: uuid,
        stream: z.enum(checkinStreams),
        code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
      })
      .strict(),
    z.object({ action: z.literal("display.create"), occurrenceId: uuid, stream: z.enum(checkinStreams) }).strict(),
    z
      .object({
        action: z.literal("display.revoke"),
        token: secretToken.optional(),
        occurrenceId: uuid.optional(),
      })
      .strict(),
    z.object({ action: z.literal("notice.read"), noticeId: uuid }).strict(),
    z.object({ action: z.literal("calendar.set"), enabled: z.boolean() }).strict(),
    seriesFields.extend({ action: z.literal("series.save") }).strict(),
    z
      .object({
        action: z.literal("occurrence.change"),
        occurrenceId: uuid,
        status: z.enum(["moved", "cancelled"]),
        startsAt: instant.optional(),
        endsAt: instant.optional(),
        venue: optionalVenue,
        reason: z.enum(changeReasons),
      })
      .strict(),
    z
      .object({ action: z.literal("group.save"), groupId: uuid.optional(), name: z.string().trim().min(1).max(80) })
      .strict(),
    z.object({ action: z.literal("group.delete"), groupId: uuid }).strict(),
    z.object({ action: z.literal("group.members.set"), groupId: uuid, userIds: z.array(uuid).max(500) }).strict(),
    z
      .object({
        action: z.literal("invitation.create"),
        email: z.preprocess(
          (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
          z.email("Enter an email address.").max(254),
        ),
      })
      .strict(),
    z.object({ action: z.literal("role.set"), userId: uuid, role: z.enum(teachingRoles) }).strict(),
    // Master plan S10: an organiser removing a member's own self-report (never a code check-in).
    z.object({ action: z.literal("attendance.remove"), occurrenceId: uuid, userId: uuid }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.action === "display.revoke") {
      if (!value.token && !value.occurrenceId) {
        ctx.addIssue({
          code: "custom",
          message: "Give a display link token or an occurrence id.",
          path: ["token"],
        });
      }
      return;
    }
    if (value.action === "series.save") {
      for (const issue of seriesIssues(value))
        ctx.addIssue({ code: "custom", message: issue.message, path: [issue.path] });
      return;
    }
    if (value.action !== "occurrence.change") return;
    if (value.status === "cancelled") {
      if (value.startsAt || value.endsAt || value.venue !== undefined)
        ctx.addIssue({ code: "custom", message: "A cancelled session keeps its time and place.", path: ["status"] });
      return;
    }
    if (!value.startsAt || !value.endsAt) {
      ctx.addIssue({ code: "custom", message: "Give the new start and end times.", path: ["startsAt"] });
      return;
    }
    const minutes = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60_000;
    if (!(minutes >= 10 && minutes <= 480))
      ctx.addIssue({ code: "custom", message: "A session runs for 10 minutes to 8 hours.", path: ["endsAt"] });
  });
export type TeachingServiceAction = z.infer<typeof teachingServiceActionSchema>;

/** `POST /api/teaching/checkin/open`: the scanned token, parsed again by `parseCheckinToken`. */
export const checkinOpenBodySchema = z.object({ token: z.string().min(1).max(100) }).strict();

/** `POST /api/teaching/cpd` (plan-contracts §10). */
export const teachingCpdBodySchema = z
  .object({
    occurrenceId: uuid,
    hours: z
      .number()
      .positive()
      // Master plan R20: matches the 8-hour cap in `cme_save_teaching_entry`.
      .max(8)
      .refine((hours) => Number.isInteger(hours * 4), "Use quarter hours."),
    requestId: uuid,
  })
  .strict();
export type TeachingCpdBody = z.infer<typeof teachingCpdBodySchema>;

// ---- Results ----------------------------------------------------------------------

const counts = z.object({
  code: z.number().int().nonnegative(),
  self: z.number().int().nonnegative(),
  visitors: z.number().int().nonnegative(),
});

export const teamSummarySchema = z.object({
  id: uuid,
  name: z.string(),
  role: z.enum(teachingRoles),
  acceptsRealData: z.boolean(),
  isDemo: z.boolean(),
  presenting: z.boolean().optional(),
  inCalendar: z.boolean().optional(),
}) satisfies z.ZodType<TeamSummary>;

export const sessionSummarySchema = z.object({
  occurrenceId: z.string().min(1).max(80),
  serviceId: z.string().min(1).max(80),
  title: z.string(),
  startsAt: instant,
  endsAt: instant,
  venue: z.string().nullable(),
  hasJoinLink: z.boolean(),
  status: z.enum(sessionStatuses),
  isPresenter: z.boolean(),
  source: z.enum(["teaching", "on_call_relocated"]),
  allDay: z.literal(true).optional(),
  previousStartsAt: instant.nullable().optional(),
}) satisfies z.ZodType<SessionSummary>;

const sessionCounts = counts.extend({
  expected: z.number().int().nonnegative().optional(),
  visitors: z.number().int().nonnegative().optional(),
});

export const sessionDetailSchema = sessionSummarySchema.extend({
  joinUrl: z.string().nullable(),
  presenterName: z.string().nullable(),
  materials: z.array(z.object({ label: z.string(), url: z.string() })),
  changeReason: z.string().nullable(),
  canShowCode: z.boolean(),
  counts: sessionCounts.nullable(),
  visitor: z.boolean().default(false),
  seriesId: uuid.nullable().optional(),
  previousStartsAt: instant.nullable().optional(),
  myAttendance: z
    .object({ method: z.enum(attendanceMethods), recordedAt: instant })
    .nullable()
    .optional(),
  inCalendar: z.boolean().optional(),
}) satisfies z.ZodType<SessionDetail>;

export const attendanceMarkSchema = z.object({
  occurrenceId: uuid,
  method: z.enum(attendanceMethods),
  recordedAt: instant,
}) satisfies z.ZodType<AttendanceMark>;

export const noticeSchema = z.object({
  id: uuid,
  occurrenceId: uuid,
  serviceId: uuid,
  kind: z.enum(["moved", "cancelled"]),
  createdAt: instant,
}) satisfies z.ZodType<Notice>;

export const teachingWeekSchema = z.object({
  teams: z.array(teamSummarySchema),
  sessions: z.array(sessionSummarySchema),
  notices: z.array(noticeSchema),
  attendance: z.array(attendanceMarkSchema),
}) satisfies z.ZodType<TeachingWeek>;

export const logbookRowSchema = attendanceMarkSchema.extend({
  title: z.string(),
  startsAt: instant,
  endsAt: instant,
  serviceName: z.string(),
  cpdEntryId: uuid.nullable(),
  serviceId: uuid.optional(),
  readOnlyUntil: instant.nullable().optional(),
}) satisfies z.ZodType<LogbookRow>;
export const logbookSchema = z.object({ attendance: z.array(logbookRowSchema) });
export const unloggedCountSchema = z.object({ count: z.number().int().nonnegative() });

const checkinTokenText = z.string().regex(CHECKIN_TOKEN_PATTERN);
const typedCode = z.string().regex(/^\d{6}$/);
const codeWindow = z.number().int().nonnegative();

export const checkinCodeSchema = z.object({
  token: checkinTokenText,
  typedCode,
  window: codeWindow,
  validUntil: instant,
}) satisfies z.ZodType<CheckinCode>;
export const displayCodeSchema = z.object({
  token: checkinTokenText,
  typedCode,
  window: codeWindow,
  title: z.string(),
  venue: z.string().nullable(),
  closesAt: instant,
}) satisfies z.ZodType<DisplayCode>;
export const checkinOpenedSchema = z.object({
  occurrenceId: uuid,
  title: z.string(),
  startsAt: instant,
  stream: z.enum(checkinStreams),
}) satisfies z.ZodType<CheckinOpened>;
export const checkinCompletedSchema = attendanceMarkSchema.extend({
  serviceId: uuid,
}) satisfies z.ZodType<CheckinCompleted>;

const registerRowSchema = z.object({
  userId: uuid.nullable(),
  name: z.string().nullable(),
  method: z.enum(attendanceMethods),
  recordedAt: instant,
}) satisfies z.ZodType<RegisterRow>;
export const registerResultSchema = z.union([
  z.object({ rows: z.array(registerRowSchema), visitors: z.number().int().nonnegative() }),
  z.object({ counts }),
]) satisfies z.ZodType<RegisterResult>;
export const exportResultSchema = z.object({
  rows: z.array(
    z.object({
      occurrenceId: uuid,
      title: z.string(),
      startsAt: instant,
      userId: uuid.nullable(),
      name: z.string().nullable(),
      method: z.enum(attendanceMethods),
      recordedAt: instant,
    }) satisfies z.ZodType<ExportRow>,
  ),
});
export const membersResultSchema = z.object({
  members: z.array(
    z.object({
      userId: uuid,
      name: z.string().nullable(),
      role: z.enum(teachingRoles),
      joinedAt: instant,
    }) satisfies z.ZodType<MemberRow>,
  ),
});
export const auditResultSchema = z.object({
  events: z.array(
    z.object({
      id: z.number().int(),
      actorId: uuid.nullable(),
      actorName: z.string().nullable(),
      action: z.string().regex(/^[a-z_.]{3,48}$/),
      subjectId: uuid.nullable(),
      at: instant,
    }) satisfies z.ZodType<AuditRow>,
  ),
});
export const displayCreatedSchema = z.object({ expiresAt: instant });
export const invitationCreatedSchema = z.object({ invitationId: uuid, expiresAt: instant });
export const cpdSavedSchema = z.object({ entryId: uuid, created: z.boolean() });
/** Master plan R6: `series.save` answers the series and how many sessions it now has. */
export const seriesSavedSchema = z.object({ seriesId: uuid, occurrences: z.number().int().nonnegative() });
export type SeriesSaved = z.infer<typeof seriesSavedSchema>;
/** Master plan R6: `group.save` answers the group's id. */
export const groupSavedSchema = z.object({ groupId: uuid });
export type GroupSaved = z.infer<typeof groupSavedSchema>;

// ---- Organise page, quiet-day hero and supervision count (reconciliation with part 1) ---------

export type SeriesRow = {
  seriesId: string;
  title: string;
  kind: string;
  groupIds: string[];
  repeat: string;
  firstDate: string;
  startTime: string;
  minutes: number;
  venue: string | null;
  joinUrl: string | null;
  skipDates: string[];
  endDate: string;
  presenterId: string | null;
  materials: { label: string; url: string }[];
  lastConfirmedAt: string | null;
  /** Master plan R4: which level the series is for. Always set in the database; optional here so a
   * caller that never asked for it (nothing in this build parses `organise.read` before now) is not
   * forced to supply it. */
  audience?: SeriesAudience;
  /** Master plan R3/R5: a series a health service's visitors may open. Always set in the database. */
  openTo?: "team" | "health_service";
};
export const seriesRowSchema = z.object({
  seriesId: uuid,
  title: z.string(),
  kind: z.enum(seriesKinds),
  groupIds: z.array(uuid),
  repeat: z.enum(seriesRepeats),
  firstDate: teachingDateSchema,
  startTime: timeOfDay,
  minutes: z.number().int(),
  venue: z.string().nullable(),
  joinUrl: z.string().nullable(),
  skipDates: z.array(teachingDateSchema),
  endDate: teachingDateSchema,
  presenterId: uuid.nullable(),
  materials: z.array(z.object({ label: z.string(), url: z.string() })),
  lastConfirmedAt: instant.nullable(),
  audience: z.enum(seriesAudiences).optional(),
  openTo: z.enum(["team", "health_service"]).optional(),
}) satisfies z.ZodType<SeriesRow>;

export type GroupRow = { groupId: string; name: string; userIds: string[] };
export const groupRowSchema = z.object({
  groupId: uuid,
  name: z.string(),
  userIds: z.array(uuid),
}) satisfies z.ZodType<GroupRow>;

const organiseMemberRowSchema = z.object({
  userId: uuid,
  name: z.string().nullable(),
  role: z.enum(teachingRoles),
  joinedAt: instant,
});

/** `organise.read`: the Organise page's editors (part 1) — every series, the groups with their
 * member ids, and the active members. */
export const organiseResultSchema = z.object({
  series: z.array(seriesRowSchema),
  groups: z.array(groupRowSchema),
  members: z.array(organiseMemberRowSchema),
});

/** `session.next`: the quiet-day hero's next listed session across every active team, or none. */
export const sessionNextResultSchema = z.object({ session: sessionSummarySchema.nullable() });

/** `supervision.pending`: a supervisor's pending confirmations across active teams, as a count only. */
export const supervisionPendingSchema = z.object({ count: z.number().int().nonnegative() });

// ---- Write actions with a result S3 left unchecked (reconciliation with part 1) -----------------

/** `notice.read`, `occurrence.change` and `role.set` all confirm with nothing but `{}` — parsing
 * against an empty shape is still worth doing, so a database change that started leaking a field
 * (the check-in secret, say) would be dropped here rather than reach the browser. */
export const emptyTeachingResultSchema = z.object({});
export const noticeReadResultSchema = z.object({});
export const occurrenceChangedSchema = z.object({});
export const roleSetSchema = z.object({});
export const calendarSetSchema = z.object({ enabled: z.boolean() });
export const groupDeletedSchema = z.object({ groupId: uuid });
export const groupMembersSetSchema = z.object({ groupId: uuid });

// ---- What's on and Resources (spec §5a, part 1 D4b) ------------------------------

export const healthServiceCodes = ["nmhs", "smhs", "emhs", "wachs", "cahs", "demo"] as const;
export type HealthServiceCode = (typeof healthServiceCodes)[number];
export const resourceKinds = ["slides", "recording", "reading", "link", "library"] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export const seriesOpenToValues = ["team", "health_service"] as const;
/** The two collections every viewer has without an organiser making them. */
export const builtInCollections = ["recordings", "saved"] as const;
export type BuiltInCollection = (typeof builtInCollections)[number];

/** One resource as `teaching_resource_row` returns it. Who added it is never returned. */
export type ResourceRow = {
  resourceId: string;
  serviceId: string;
  title: string;
  kind: ResourceKind;
  url: string | null;
  libraryDocumentId: string | null;
  collectionId: string | null;
  sectionId: string | null;
  occurrenceId: string | null;
  seriesId: string | null;
  addedAt: string;
  saved: boolean;
};
export const resourceRowSchema = z.object({
  resourceId: uuid,
  serviceId: uuid,
  title: z.string(),
  kind: z.enum(resourceKinds),
  url: z.string().nullable(),
  libraryDocumentId: uuid.nullable(),
  collectionId: uuid.nullable(),
  sectionId: uuid.nullable(),
  occurrenceId: uuid.nullable(),
  seriesId: uuid.nullable(),
  addedAt: instant,
  saved: z.boolean(),
}) satisfies z.ZodType<ResourceRow>;

/**
 * A What's on row: a session of the viewer's own service, or one another service has opened to their
 * health service. `audience` is the series' level (a one-off reads all_doctors); the client works out
 * "For my level" from it (master plan R4).
 */
export type WhatsOnRow = SessionSummary & {
  teamName: string;
  joinUrl: string | null;
  own: boolean;
  inMyWeek: boolean;
  audience: SeriesAudience;
  forMyLevel?: boolean;
};
export const whatsOnRowSchema = sessionSummarySchema.extend({
  teamName: z.string(),
  joinUrl: z.string().nullable(),
  own: z.boolean(),
  inMyWeek: z.boolean(),
  audience: z.enum(seriesAudiences),
  forMyLevel: z.boolean().optional(),
}) satisfies z.ZodType<WhatsOnRow>;
export const whatsOnReadResultSchema = z.object({
  healthServices: z.array(z.enum(healthServiceCodes)),
  sessions: z.array(whatsOnRowSchema),
});
export type WhatsOnRead = z.infer<typeof whatsOnReadResultSchema>;

export const weekAddResultSchema = z.object({ inMyWeek: z.boolean() });
export const resourceSaveResultSchema = z.object({ saved: z.boolean() });
export const resourcesForSessionSchema = z.object({ items: z.array(resourceRowSchema) });
export type ResourcesForSession = z.infer<typeof resourcesForSessionSchema>;
export const resourcesForWeekSchema = z.object({
  forThisWeek: z.array(resourceRowSchema.extend({ catchUp: z.boolean() })),
  collections: z.array(
    z.object({ collectionId: uuid, serviceId: uuid, name: z.string(), count: z.number().int().nonnegative() }),
  ),
  recordingsCount: z.number().int().nonnegative(),
  savedCount: z.number().int().nonnegative(),
});
export type ResourcesForWeek = z.infer<typeof resourcesForWeekSchema>;
export const collectionReadResultSchema = z.object({
  collection: z.object({ collectionId: uuid, serviceId: uuid, name: z.string() }).nullable(),
  sections: z.array(z.object({ sectionId: uuid, name: z.string(), sortOrder: z.number().int() })),
  items: z.array(resourceRowSchema),
});
export type CollectionRead = z.infer<typeof collectionReadResultSchema>;
export const resourceAddedSchema = z.object({ resourceId: uuid });
/** `resource.remove` confirms with nothing but `{}`. */
export const resourceRemovedSchema = z.object({});
export const seriesOpenToResultSchema = z.object({ seriesId: uuid, openTo: z.enum(seriesOpenToValues) });
export const collectionSavedSchema = z.object({ collectionId: uuid });
export const collectionSectionSavedSchema = z.object({ sectionId: uuid });

/** `GET /api/teaching/whats-on`: the health-service and own-service sessions for one week. */
export const teachingWhatsOnQuerySchema = z.object({ weekStart: teachingDateSchema });
export type TeachingWhatsOnQuery = z.infer<typeof teachingWhatsOnQuerySchema>;

/** `POST /api/teaching/whats-on`: every personal action. No service is named, so no membership is checked here. */
export const teachingWhatsOnActionSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("week_add.set"), occurrenceId: uuid.optional(), seriesId: uuid.optional() }).strict(),
    z
      .object({ action: z.literal("week_add.unset"), occurrenceId: uuid.optional(), seriesId: uuid.optional() })
      .strict(),
    // Master plan R15: a visitor's "I was there" comes here, never through attendance.self.
    z.object({ action: z.literal("whats_on.attend"), occurrenceId: uuid }).strict(),
    z.object({ action: z.literal("resource_save.set"), resourceId: uuid }).strict(),
    z.object({ action: z.literal("resource_save.unset"), resourceId: uuid }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.action !== "week_add.set" && value.action !== "week_add.unset") return;
    if (Boolean(value.occurrenceId) === Boolean(value.seriesId))
      ctx.addIssue({ code: "custom", message: "Give a session or a series, not both.", path: ["occurrenceId"] });
  });
export type TeachingWhatsOnAction = z.infer<typeof teachingWhatsOnActionSchema>;

/** `GET /api/teaching/resources`: materials for the week or one session, or a collection. */
export const teachingResourcesQuerySchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("resources.read"),
      weekStart: teachingDateSchema.optional(),
      occurrenceId: uuid.optional(),
    }),
    z.object({
      action: z.literal("collection.read"),
      collectionId: uuid.optional(),
      builtIn: z.enum(builtInCollections).optional(),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.action === "resources.read" && Boolean(value.weekStart) === Boolean(value.occurrenceId))
      ctx.addIssue({ code: "custom", message: "Give a week or a session, not both.", path: ["weekStart"] });
    if (value.action === "collection.read" && Boolean(value.collectionId) === Boolean(value.builtIn))
      ctx.addIssue({
        code: "custom",
        message: "Give a collection or a built-in name, not both.",
        path: ["collectionId"],
      });
  });
export type TeachingResourcesQuery = z.infer<typeof teachingResourcesQuerySchema>;

/** `POST /api/teaching/resources/services/[serviceId]`: organiser and presenter writes for one service. */
export const teachingResourceTeamActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("resource.add"),
        title: z.string().trim().min(1).max(160),
        kind: z.enum(resourceKinds),
        url: teachingLinkUrlSchema.optional(),
        libraryDocumentId: uuid.optional(),
        collectionId: uuid.optional(),
        sectionId: uuid.optional(),
        occurrenceId: uuid.optional(),
        seriesId: uuid.optional(),
        noPatientDetails: z.literal(true),
      })
      .strict(),
    z.object({ action: z.literal("resource.remove"), resourceId: uuid }).strict(),
    z.object({ action: z.literal("series.set_open_to"), seriesId: uuid, openTo: z.enum(seriesOpenToValues) }).strict(),
    z
      .object({
        action: z.literal("collection.save"),
        collectionId: uuid.optional(),
        name: z.string().trim().min(1).max(80),
        sortOrder: z.number().int().min(0).max(999).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("collection.section.save"),
        collectionId: uuid,
        sectionId: uuid.optional(),
        name: z.string().trim().min(1).max(80),
        sortOrder: z.number().int().min(0).max(999).optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.action !== "resource.add") return;
    if (value.kind === "recording")
      ctx.addIssue({ code: "custom", message: "Recordings are not available in this build.", path: ["kind"] });
    if (Boolean(value.url) === Boolean(value.libraryDocumentId))
      ctx.addIssue({ code: "custom", message: "Give a link or a library document, not both.", path: ["url"] });
    if ((value.kind === "library") !== Boolean(value.libraryDocumentId))
      ctx.addIssue({ code: "custom", message: "A library document must use the library kind.", path: ["kind"] });
    if (value.sectionId && !value.collectionId)
      ctx.addIssue({ code: "custom", message: "A section needs its collection too.", path: ["sectionId"] });
    if (value.occurrenceId && value.seriesId)
      ctx.addIssue({ code: "custom", message: "Give a session or a series, not both.", path: ["occurrenceId"] });
    // Master plan R27: slides belong to one session, so every slide link sits behind that session's
    // cases-checked gate (`teaching_slides_released`). The database does not check this itself.
    if (value.kind === "slides" && !value.occurrenceId)
      ctx.addIssue({
        code: "custom",
        message: "Slides belong to one session. Choose the session.",
        path: ["occurrenceId"],
      });
  });
export type TeachingResourceTeamAction = z.infer<typeof teachingResourceTeamActionSchema>;
