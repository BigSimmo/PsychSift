import { z } from "zod";

import { ROSTER_LEAVE_KINDS } from "@/lib/roster/leave-kinds";

/**
 * Roster for a health service: the shapes of every team read and write.
 *
 * Each read schema carries exactly the keys `roster_read` builds with
 * `jsonb_build_object` (supabase/migrations/20260926225409_roster_mode.sql),
 * and every assignment is `roster_assignment_json`. The action union carries
 * exactly the payload keys `roster_command` reads. Every object is strict on
 * the way in, so a body that names an actor (`actorId`, `ownerId`,
 * `p_actor_id`) is refused before the database is asked anything.
 *
 * `publish` and `codes.set` are deliberately absent from the action union:
 * only the publish route sends them. `needs.set`, `draft.*` and
 * `agreement.record` belong to Release 3.
 */

export const ROSTER_GRADES = ["intern", "resident", "registrar", "fellow", "consultant", "other"] as const;
export type RosterGrade = (typeof ROSTER_GRADES)[number];

export const ROSTER_READS = [
  "overview",
  "assignments",
  "requests",
  "unavailability",
  "leave_overlap",
  "manage",
  "people",
  "publications",
  "maker",
  "members",
] as const;

/**
 * Reads the follow-up database change adds (gaps G1, G4 and G2). The route
 * accepts them; until they are live the database answers
 * `roster_invalid_request` and the hook reports them `unavailable`.
 */
export const ROSTER_FOLLOW_UP_READS = ["changes", "team_leave", "my_changes"] as const;

export const ROSTER_ALL_READS = [...ROSTER_READS, ...ROSTER_FOLLOW_UP_READS] as const;
export type RosterReadWhat = (typeof ROSTER_ALL_READS)[number];

/** Reads that need a `from`/`to` window, at most 62 days (the SQL checks the same). */
export const ROSTER_WINDOWED_READS: readonly RosterReadWhat[] = [
  "assignments",
  "unavailability",
  "leave_overlap",
  "changes",
  "team_leave",
];
export const ROSTER_MAX_WINDOW_DAYS = 62;

export const ROSTER_ASSIGNMENT_KINDS = ["day", "evening", "night", "on_call", "leave", "other"] as const;
export type RosterAssignmentKind = (typeof ROSTER_ASSIGNMENT_KINDS)[number];
/** An open shift is never leave. */
export const ROSTER_OPEN_SHIFT_KINDS = ["day", "evening", "night", "on_call", "other"] as const;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Postgres renders timestamptz in jsonb with an offset; accept any parseable instant. */
const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Expected a timestamp");
const grade = z.enum(ROSTER_GRADES);
const role = z.enum(["member", "manager"]);

// ------------------------------------------------------------------ reads

export const rosterTeamSchema = z.object({
  serviceId: uuid,
  name: z.string(),
  enabled: z.boolean(),
  role,
  grade: grade.nullable(),
});
export type RosterTeam = z.infer<typeof rosterTeamSchema>;
export const rosterTeamsSchema = z.object({ teams: z.array(rosterTeamSchema) });

export const rosterRulesSchema = z
  .object({
    minBreakHours: z.number().min(0).max(48).optional(),
    maxNightsInRow: z.number().int().min(1).max(14).optional(),
    maxDaysInRow: z.number().int().min(1).max(21).optional(),
    maxHours7d: z.number().min(1).max(168).optional(),
    maxHours14d: z.number().min(1).max(336).optional(),
  })
  .strict();
export type RosterRules = z.infer<typeof rosterRulesSchema>;

export const rosterSettingsSchema = z.object({
  swapApproval: z.enum(["auto_same_grade", "manager"]),
  // Read leniently: a rule the app no longer knows must not blank the page.
  rules: z.record(z.string(), z.unknown()).transform((raw) => {
    const parsed = rosterRulesSchema.safeParse(
      Object.fromEntries(Object.entries(raw).filter(([key]) => key in rosterRulesSchema.shape)),
    );
    return parsed.success ? parsed.data : {};
  }),
  rulesSource: z.string().nullable(),
  payFortnightAnchor: isoDate.nullable(),
});
export type RosterSettings = z.infer<typeof rosterSettingsSchema>;

export const rosterPublicationSummarySchema = z.object({
  id: uuid,
  version: z.number().int(),
  publishedAt: instant,
  periodStart: isoDate,
  periodEnd: isoDate,
});

export const rosterManagerSchema = z.object({ userId: uuid, name: z.string().nullable() });

export const rosterOverviewSchema = z.object({
  service: z.object({ id: uuid, name: z.string() }),
  me: z.object({ role, grade: grade.nullable(), rotationEndsOn: isoDate.nullable() }),
  latestPublication: rosterPublicationSummarySchema.nullable(),
  seenLatest: z.boolean(),
  settings: rosterSettingsSchema,
  sites: z.array(z.object({ id: uuid, name: z.string() })),
  /** G3: live once the follow-up database change is merged. */
  managers: z.array(rosterManagerSchema).optional(),
  /** G5: live once the follow-up database change is merged. */
  nextCutoffOn: isoDate.nullable().optional(),
});
export type RosterOverview = z.infer<typeof rosterOverviewSchema>;

export const rosterAssignmentSchema = z.object({
  id: uuid,
  userId: uuid.nullable(),
  name: z.string().nullable(),
  grade: grade.nullable(),
  siteId: uuid.nullable(),
  siteName: z.string().nullable(),
  startsAt: instant,
  endsAt: instant,
  shiftCode: z.string(),
  kind: z.enum(ROSTER_ASSIGNMENT_KINDS),
});
export type RosterAssignment = z.infer<typeof rosterAssignmentSchema>;
export const rosterAssignmentsSchema = z.object({ assignments: z.array(rosterAssignmentSchema) });

export const SWAP_STATUSES = [
  "requested",
  "accepted",
  "approved",
  "declined",
  "cancelled",
  "expired",
  "undone",
] as const;
export const SWAP_NEEDS_MANAGER = ["team_setting", "within_7_days", "different_grade", "team_rule"] as const;
export type SwapNeedsManagerReason = (typeof SWAP_NEEDS_MANAGER)[number];
export const SWAP_CANCEL_REASONS = ["withdrawn", "roster_changed", "member_left", "no_longer_fits"] as const;
export const OPEN_SHIFT_STATUSES = ["reported", "open", "claimed", "approved", "cancelled", "expired"] as const;

export const rosterSwapSchema = z.object({
  id: uuid,
  status: z.enum(SWAP_STATUSES),
  autoApproved: z.boolean(),
  needsManagerBecause: z.enum(SWAP_NEEDS_MANAGER).nullable(),
  cancelReason: z.enum(SWAP_CANCEL_REASONS).nullable(),
  requesterId: uuid,
  counterpartyId: uuid,
  give: rosterAssignmentSchema.nullable(),
  take: rosterAssignmentSchema.nullable(),
  expiresAt: instant,
  createdAt: instant,
  decidedAt: instant.nullable(),
  /** G3: live once the follow-up database change is merged. */
  requesterName: z.string().nullable().optional(),
  counterpartyName: z.string().nullable().optional(),
});
export type RosterSwap = z.infer<typeof rosterSwapSchema>;

const openShiftBase = {
  id: uuid,
  status: z.enum(OPEN_SHIFT_STATUSES),
  urgent: z.boolean(),
  startsAt: instant,
  endsAt: instant,
  shiftCode: z.string(),
  kind: z.enum(ROSTER_OPEN_SHIFT_KINDS),
  minGrade: grade.nullable(),
  siteId: uuid.nullable(),
};

export const rosterOpenShiftSchema = z.object({
  ...openShiftBase,
  mine: z.boolean(),
  claimedByMe: z.boolean(),
});
export type RosterOpenShift = z.infer<typeof rosterOpenShiftSchema>;

export const rosterRequestsSchema = z.object({
  swaps: z.array(rosterSwapSchema),
  openShifts: z.array(rosterOpenShiftSchema),
});
export type RosterRequests = z.infer<typeof rosterRequestsSchema>;

export const rosterUnavailabilitySchema = z.object({
  unavailability: z.array(z.object({ userId: uuid, date: isoDate, kind: z.enum(["cant", "prefer_off"]) })),
});
export type RosterUnavailability = z.infer<typeof rosterUnavailabilitySchema>;

export const rosterLeaveOverlapSchema = z.object({ alreadyOff: z.number().int().min(0) });
export type RosterLeaveOverlap = z.infer<typeof rosterLeaveOverlapSchema>;

export const rosterManageSwapSchema = rosterSwapSchema
  .pick({
    id: true,
    status: true,
    autoApproved: true,
    needsManagerBecause: true,
    requesterId: true,
    counterpartyId: true,
    give: true,
    take: true,
    decidedAt: true,
  })
  .extend({ requesterName: z.string().nullable().optional(), counterpartyName: z.string().nullable().optional() });
export type RosterManageSwap = z.infer<typeof rosterManageSwapSchema>;

export const rosterManageOpenShiftSchema = z.object({
  ...openShiftBase,
  postedBy: uuid.nullable(),
  claimedBy: uuid.nullable(),
  claimedAt: instant.nullable(),
});
export type RosterManageOpenShift = z.infer<typeof rosterManageOpenShiftSchema>;

export const rosterManageSchema = z.object({
  swaps: z.array(rosterManageSwapSchema),
  openShifts: z.array(rosterManageOpenShiftSchema),
  seen: z
    .object({
      publicationId: uuid,
      version: z.number().int(),
      seen: z.number().int(),
      members: z.number().int(),
      notSeen: z.array(uuid),
    })
    .nullable(),
});
export type RosterManage = z.infer<typeof rosterManageSchema>;

export const rosterPersonSchema = z.object({
  userId: uuid,
  displayName: z.string().nullable(),
  joinedAt: instant,
  serviceRole: z.enum(["member", "editor", "admin"]),
  role,
  grade: grade.nullable(),
  rosterName: z.string().nullable(),
  rotationEndsOn: isoDate.nullable(),
});
export type RosterPerson = z.infer<typeof rosterPersonSchema>;
export const rosterPeopleSchema = z.object({ people: z.array(rosterPersonSchema) });

/**
 * The `members` read: the team's current members as any member may see them,
 * names and grades only (`roster_team_members`). The manager-only `people`
 * read stays the one that carries roles, join dates and rotations.
 */
export const rosterTeamMemberSchema = z.object({ userId: uuid, name: z.string().nullable(), grade: grade.nullable() });
export type RosterTeamMember = z.infer<typeof rosterTeamMemberSchema>;
export const rosterTeamMembersSchema = z.object({ members: z.array(rosterTeamMemberSchema) });

export const rosterPublicationSchema = z.object({
  id: uuid,
  version: z.number().int(),
  kind: z.enum(["full", "single_change"]),
  periodStart: isoDate,
  periodEnd: isoDate,
  sourceName: z.string().nullable(),
  publishedAt: instant,
});
export type RosterPublication = z.infer<typeof rosterPublicationSchema>;
export const rosterPublicationsSchema = z.object({ publications: z.array(rosterPublicationSchema) });

/** Postgres `time` renders as HH:MM:SS; the app works in HH:MM. */
const clock = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/)
  .transform((value) => value.slice(0, 5));

export const rosterShiftCodeSchema = z.object({
  code: z.string(),
  kind: z.enum([...ROSTER_ASSIGNMENT_KINDS, "off"]),
  starts: clock.nullable(),
  ends: clock.nullable(),
  label: z.string().nullable(),
});
export type RosterShiftCode = z.infer<typeof rosterShiftCodeSchema>;

export const rosterMakerSchema = z.object({
  codes: z.array(rosterShiftCodeSchema),
  needs: z.array(
    z.object({
      id: uuid,
      weekday: z.number().int().nullable(),
      date: isoDate.nullable(),
      kind: z.enum(ROSTER_ASSIGNMENT_KINDS),
      grade: grade.nullable(),
      siteId: uuid.nullable(),
      needed: z.number().int(),
    }),
  ),
  drafts: z.array(z.unknown()),
});
export type RosterMaker = z.infer<typeof rosterMakerSchema>;

// Follow-up reads (gaps section of the plan). Parsed now so the screens are
// ready the moment the follow-up database change lands.

export const rosterChangesSchema = z.object({
  swaps: z.array(
    z.object({
      swapId: uuid,
      giveAssignmentId: uuid,
      takeAssignmentId: uuid.nullable(),
      requesterId: uuid,
      counterpartyId: uuid,
      decidedAt: instant,
      autoApproved: z.boolean(),
    }),
  ),
  openShifts: z.array(
    z.object({ openShiftId: uuid, assignmentId: uuid.nullable(), claimedBy: uuid.nullable(), decidedAt: instant }),
  ),
});
export type RosterChanges = z.infer<typeof rosterChangesSchema>;

export const rosterTeamLeaveSchema = z.object({
  leave: z.array(
    z.object({
      userId: uuid,
      name: z.string().nullable(),
      kind: z.enum(ROSTER_LEAVE_KINDS),
      startsOn: isoDate,
      endsOn: isoDate,
      status: z.enum(["planned", "applied", "approved"]),
    }),
  ),
});
export type RosterTeamLeave = z.infer<typeof rosterTeamLeaveSchema>;

export const rosterMyChangesSchema = z.object({
  before: z.array(rosterAssignmentSchema),
  after: z.array(rosterAssignmentSchema),
});
export type RosterMyChanges = z.infer<typeof rosterMyChangesSchema>;

export const ROSTER_READ_SCHEMAS = {
  overview: rosterOverviewSchema,
  assignments: rosterAssignmentsSchema,
  requests: rosterRequestsSchema,
  unavailability: rosterUnavailabilitySchema,
  leave_overlap: rosterLeaveOverlapSchema,
  manage: rosterManageSchema,
  people: rosterPeopleSchema,
  publications: rosterPublicationsSchema,
  maker: rosterMakerSchema,
  members: rosterTeamMembersSchema,
  changes: rosterChangesSchema,
  team_leave: rosterTeamLeaveSchema,
  my_changes: rosterMyChangesSchema,
} as const satisfies Record<RosterReadWhat, z.ZodType>;

export type RosterReadResult<W extends RosterReadWhat> = z.infer<(typeof ROSTER_READ_SCHEMAS)[W]>;

// ------------------------------------------------------------------ actions

const nullableOptional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const swapIdAction = <A extends string>(action: A) => z.object({ action: z.literal(action), swapId: uuid }).strict();
const openIdAction = <A extends string>(action: A) =>
  z.object({ action: z.literal(action), openShiftId: uuid }).strict();

const openPostSchema = z
  .object({
    action: z.literal("open.post"),
    assignmentId: uuid.optional(),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    shiftCode: z.string().trim().min(1).max(12).optional(),
    kind: z.enum(ROSTER_OPEN_SHIFT_KINDS).optional(),
    siteId: nullableOptional(uuid),
    minGrade: nullableOptional(z.enum(["intern", "resident", "registrar", "fellow", "consultant"])),
    urgent: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const gapKeys = [value.startsAt, value.endsAt, value.shiftCode, value.kind];
    if (value.assignmentId) {
      if (gapKeys.some((key) => key !== undefined) || value.siteId !== undefined || value.minGrade !== undefined) {
        context.addIssue({ code: "custom", message: "Give either a shift or a gap, not both." });
      }
      return;
    }
    if (gapKeys.some((key) => key === undefined)) {
      context.addIssue({ code: "custom", message: "A gap needs its start, end, code and kind." });
      return;
    }
    if (Date.parse(value.endsAt!) <= Date.parse(value.startsAt!)) {
      context.addIssue({ code: "custom", message: "A gap must end after it starts." });
    }
  });

export const rosterActionSchema = z.union([
  z
    .object({
      action: z.literal("role.set"),
      userId: uuid,
      grade: nullableOptional(grade),
      rosterName: nullableOptional(z.string().trim().max(80)),
      rotationEndsOn: nullableOptional(isoDate),
    })
    .strict(),
  z.object({ action: z.literal("member.remove"), userId: uuid }).strict(),
  z
    .object({
      action: z.literal("settings.set"),
      swapApproval: z.enum(["auto_same_grade", "manager"]),
      rules: rosterRulesSchema,
      rulesSource: z.string().trim().max(200).nullable(),
      payFortnightAnchor: isoDate.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("unavailability.set"),
      set: z.array(z.object({ date: isoDate, kind: z.enum(["cant", "prefer_off"]) }).strict()).max(120),
      clear: z.array(isoDate).max(120),
    })
    .strict(),
  z
    .object({
      action: z.literal("swap.create"),
      giveAssignmentId: uuid,
      counterpartyId: uuid,
      takeAssignmentId: uuid.nullable().optional(),
    })
    .strict(),
  swapIdAction("swap.accept"),
  swapIdAction("swap.approve"),
  swapIdAction("swap.decline"),
  swapIdAction("swap.cancel"),
  swapIdAction("swap.undo"),
  openPostSchema,
  z.object({ action: z.literal("open.report"), assignmentId: uuid }).strict(),
  openIdAction("open.claim"),
  openIdAction("open.approve"),
  openIdAction("open.decline"),
  openIdAction("open.cancel"),
  z.object({ action: z.literal("open.release"), openShiftId: uuid, urgent: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("seen.mark"), publicationId: uuid }).strict(),
]);
export type RosterAction = z.infer<typeof rosterActionSchema>;
export type RosterActionName = RosterAction["action"];

/** The SQL's answer to a write: `{ok}`, or a swap / open-shift receipt. */
export const rosterCommandResultSchema = z
  .object({
    ok: z.boolean().optional(),
    swapId: uuid.optional(),
    openShiftId: uuid.optional(),
    status: z.string().optional(),
    autoApproved: z.boolean().optional(),
    needsManagerBecause: z.string().optional(),
    cancelReason: z.string().optional(),
    assignmentId: uuid.optional(),
  })
  .passthrough();
export type RosterCommandResult = z.infer<typeof rosterCommandResultSchema>;
