import { z } from "zod";

import { ADMIN_REQUIREMENT_IDS } from "@/lib/admin/requirement-ids";

export const ON_CALL_SECTIONS = ["contacts", "playbook", "referrals", "orientation", "education", "logistics"] as const;

export type OnCallSection = (typeof ON_CALL_SECTIONS)[number];

export const ON_CALL_VIEW_PAGES = [
  "contacts",
  "who-is-who",
  "playbook",
  "referrals",
  "orientation",
  "education",
  "logistics",
  "compliance",
] as const;

export type OnCallPageView = (typeof ON_CALL_VIEW_PAGES)[number];

/** Twelve months. Derived at read time, never stored, so changing this number
 *  never needs a migration or a backfill. */
export const ON_CALL_REVIEW_INTERVAL_MONTHS = 12;

/**
 * What lapsing costs, worst first. The Compliance page sorts on this rather
 * than on the expiry date — see `logisticsDetails.consequence`.
 *
 * Order is load-bearing: `ON_CALL_COMPLIANCE_CONSEQUENCES.indexOf` is the sort
 * key, so a value added in the middle re-orders the page.
 */
export const ON_CALL_COMPLIANCE_CONSEQUENCES = ["stops-work", "stops-part", "chased"] as const;
export type OnCallComplianceConsequence = (typeof ON_CALL_COMPLIANCE_CONSEQUENCES)[number];

/**
 * How a recorded date came to be believed. Never a verdict — nothing in this
 * app is checked with an issuing body, so no surface may render any of these
 * as "compliant", "valid" or "current to".
 */
export const ON_CALL_COMPLIANCE_PROVENANCE = ["confirmed", "typed", "read-from-certificate"] as const;
export type OnCallComplianceProvenance = (typeof ON_CALL_COMPLIANCE_PROVENANCE)[number];

export type OnCallFreshness =
  | { state: "fresh"; lastVerifiedAt: string }
  | { state: "stale"; reason: "never-verified"; lastVerifiedAt: null }
  | { state: "stale"; reason: "overdue"; lastVerifiedAt: string };

export function onCallEntryFreshness(
  entry: { lastVerifiedAt: string | null },
  now: Date = new Date(),
): OnCallFreshness {
  if (!entry.lastVerifiedAt) return { state: "stale", reason: "never-verified", lastVerifiedAt: null };
  const due = new Date(entry.lastVerifiedAt);
  // An unparseable date makes every comparison below false, which would return
  // "fresh" — the one wrong answer. A date we cannot read is not evidence that
  // anyone checked this entry, so it fails to stale and stays off the printed
  // card, exactly like an entry nobody has ever verified.
  if (Number.isNaN(due.getTime())) {
    return { state: "stale", reason: "never-verified", lastVerifiedAt: null };
  }
  const dayOfMonth = due.getUTCDate();
  due.setUTCMonth(due.getUTCMonth() + ON_CALL_REVIEW_INTERVAL_MONTHS);
  // A leap-day anniversary has no 29 February to land on, and setUTCMonth silently
  // rolls it into 1 March. Clamp back to the last day of the intended month so a
  // leap-day entry does not stay fresh a day longer than every other entry.
  if (due.getUTCDate() !== dayOfMonth) due.setUTCDate(0);
  // On the boundary counts as overdue: a year-old number is not "still fine today".
  if (due.getTime() <= now.getTime()) {
    return { state: "stale", reason: "overdue", lastVerifiedAt: entry.lastVerifiedAt };
  }
  return { state: "fresh", lastVerifiedAt: entry.lastVerifiedAt };
}

const trimmed = z.string().trim().min(1);

/**
 * Whether a stored link may be drawn as a link: `http:` or `https:` only.
 *
 * `z.string().url()` accepts any scheme the URL parser does, `javascript:`
 * included, and every URL field below is rendered as an anchor — so the
 * schema refuses other schemes on write, and each renderer asks this again
 * before drawing one, because a row stored before the schema tightened (or
 * edited directly in the database) never went through it.
 */
export function isOnCallHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrl = z.string().url().refine(isOnCallHttpUrl, "Use an http or https link.");

/** When an escalation step applies. Working hours are Mon–Fri 08:00–17:00, not a public holiday. */
export const ON_CALL_STEP_HOURS = ["any", "in-hours", "after-hours"] as const;
export type OnCallStepHours = (typeof ON_CALL_STEP_HOURS)[number];

const contactsDetails = z
  .object({
    role: trimmed,
    phone: trimmed.optional(),
    extension: trimmed.optional(),
    afterHoursPhone: trimmed.optional(),
    pager: trimmed.optional(),
    contactName: trimmed.optional(),
    availability: trimmed.optional(),
    // Who's who lives in this section rather than a seventh one, because
    // `section` is a database CHECK constraint and a role explainer is a contact
    // whose point is the role rather than the number. An enum, not a free
    // string: an unrecognised value must fail validation rather than fall back
    // to "ordinary contact", which would put an explainer in the dialling list.
    // See src/lib/on-call/who-is-who.ts.
    kind: z.literal("role-explainer").optional(),
  })
  .strict();

const playbookDetails = z
  .object({
    trigger: trimmed,
    escalationSteps: z
      .array(
        z
          .object({
            order: z.number().int().min(1),
            whoToCall: trimmed,
            when: trimmed,
            phone: trimmed.optional(),
            // Optional, so every stored ladder parses unchanged. "Who do I call
            // now" leads with the steps that apply at this hour; a step with no
            // value applies at any time.
            hours: z.enum(ON_CALL_STEP_HOURS).optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const referralsDetails = z
  .object({
    accepts: z.array(trimmed).default([]),
    exclusions: z.array(trimmed).default([]),
    catchment: trimmed.optional(),
    hours: trimmed.optional(),
    howToRefer: trimmed.optional(),
    phone: trimmed.optional(),
    fax: trimmed.optional(),
    referralFormUrl: httpUrl.optional(),
  })
  .strict();

const orientationDetails = z
  .object({
    pinnedSummaryIsOwnerNote: z.literal(true),
    /**
     * The folder this manual files under — "Induction", "Manuals",
     * "Departure".
     *
     * One word each, deliberately: a folder name is both a heading on the page
     * and a slot in a 48px bar of bare words, where a long label measured
     * 165px against a 288px phone.
     *
     * Optional, unlike the Admin section's required `category`: orientation
     * rows already exist without one and a required field would invalidate
     * every one of them on read. Rows with no folder render under a single
     * fallback heading rather than disappearing.
     */
    category: trimmed.optional(),
    /**
     * A checklist for this manual — the drawing's "your first fifteen minutes"
     * and "before you leave".
     *
     * `details` is JSONB, so this needs no migration, the same route
     * `nextOccurrenceDate` took. Optional throughout: an orientation entry is
     * still a document shelf with an owner's note, and most will carry no
     * checklist at all.
     *
     * Administrative steps only — collect the phone, hand back the keycard.
     * Nothing here is clinical, and the section's own boundary already forbids
     * it.
     */
    checklist: z
      .array(
        z
          .object({
            text: trimmed,
            note: trimmed.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * The repeat patterns the roll-forward knows how to compute.
 *
 * Three, deliberately, and each one is a fixed step from a known anchor:
 * add seven days, add fourteen days, add a month. "First Tuesday of term",
 * "every second Thursday except school holidays" and the rest of a real
 * teaching calendar are not in here and must not be — a half-right repeat rule
 * puts a junior doctor outside a locked seminar room, which is worse than the
 * owner's own sentence saying when it runs.
 */
export const ON_CALL_RECURRENCE_FREQUENCIES = ["weekly", "fortnightly", "monthly"] as const;

export type OnCallRecurrenceFrequency = (typeof ON_CALL_RECURRENCE_FREQUENCIES)[number];

const educationDetails = z
  .object({
    /**
     * How the owner describes the pattern, in their own words — "Thursday 1pm",
     * "first Tuesday of term", "fortnightly, weeks 1-10".
     *
     * This is the field a reader reads, and it is NOT the same thing as
     * `recurrenceRule` below and never becomes redundant to it. Free text
     * carries the exceptions and the qualifications a three-value enum cannot
     * hold, and it is the owner's own wording, which this app does not rewrite.
     * Nothing computes with it: `new Date("Thursday")` is `Invalid Date` on some
     * engines and a real date on others, which is exactly the class of bug that
     * puts a session on the wrong day.
     */
    recurrence: trimmed.optional(),
    nextOccurrence: trimmed.optional(),
    /**
     * The same occurrence as `nextOccurrence`, as a date the app can order on.
     *
     * `nextOccurrence` is free text ("Thursday 1pm", "first Tuesday of term")
     * and always will be, because that is how a teaching calendar is actually
     * described. The home's "Coming up" module has to pick the NEXT session out
     * of several, which free text cannot answer, so an owner who wants a session
     * to appear there gives it a date as well. Optional on purpose: an undated
     * session still lists on the Teaching page, it simply cannot be ranked.
     *
     * `YYYY-MM-DD`, matched rather than parsed — `new Date("Thursday")` is
     * `Invalid Date` on some engines and a real date on others.
     */
    nextOccurrenceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional(),
    /**
     * How the session repeats, as something the app can actually step forward.
     *
     * The counterpart to the free-text `recurrence` above, not a replacement
     * for it: this one exists only so a session that runs every week stops
     * vanishing off the home the moment its typed date passes, which is what
     * happened every Thursday afternoon before this field existed. It holds a
     * frequency and nothing else, because the anchor it counts from is already
     * stored — `nextOccurrenceDate` is that anchor.
     *
     * Optional, and an entry that has never had one parses exactly as it did
     * before it was added: no structured rule means no repeat, and the stored
     * date is read as a one-off, which is today's behaviour unchanged.
     * `src/lib/on-call/teaching-schedule.ts` does the rolling.
     */
    recurrenceRule: z
      .object({
        frequency: z.enum(ON_CALL_RECURRENCE_FREQUENCIES),
      })
      .strict()
      .optional(),
    presenter: trimmed.optional(),
    location: trimmed.optional(),
    recordingUrl: httpUrl.optional(),
    topics: z.array(trimmed).default([]),
  })
  .strict();

/**
 * Admin — and Compliance, which rides the same stored section.
 *
 * The section id stays `logistics` (route segment, database CHECK constraint);
 * only the label is "Admin", the same decision `education` → "Teaching" already
 * took. Renaming the id would be a migration for no functional gain.
 *
 * What the section holds DID change: it was site logistics (rooms, food,
 * access) and is now the work admin a doctor does for themselves — leave, pay,
 * rosters, forms — with facilities kept as one category so nothing already
 * stored is orphaned.
 *
 * Compliance is not a seventh section, for the same reason Who's who is not:
 * `section` is a database CHECK constraint, so a new value costs a migration
 * that reaches the live clinical database on merge. The discriminator lives in
 * `details.kind`, which is JSONB and therefore free. See
 * `src/lib/on-call/compliance.ts`, which owns the split.
 */
const logisticsDetails = z
  .object({
    /** The folder this row files under, on either page. Required, so no row
     *  lands in an "Other" bucket by accident. */
    category: trimmed,
    location: trimmed.optional(),
    hours: trimmed.optional(),
    phone: trimmed.optional(),
    url: httpUrl.optional(),
    /**
     * Marks this row as a compliance requirement rather than an admin entry.
     *
     * An enum, not a free string: an unrecognised value must fail validation
     * rather than fall back to "ordinary admin row", which would hide a
     * requirement whose expiry stops someone working.
     */
    kind: z.literal("compliance").optional(),
    /**
     * What happens when this requirement lapses — the field the Compliance page
     * SORTS BY, in place of the expiry date.
     *
     * Date order answers "what expires soonest", which is not the question. A
     * registration that lapses next month stops you working; a training module
     * three weeks overdue gets you an email. Ordering by consequence puts those
     * in the order a person actually needs to act on them.
     */
    consequence: z.enum(ON_CALL_COMPLIANCE_CONSEQUENCES).optional(),
    /** `YYYY-MM-DD`, matched rather than parsed, as `nextOccurrenceDate` is. */
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional(),
    /** How far ahead this one needs starting — a police check is not a form you
     *  submit the week it expires. Per requirement, because the lead times
     *  genuinely differ by months. */
    leadTimeDays: z.number().int().min(0).optional(),
    /** Who issues it (Ahpra, the college, the health service). Never contacted
     *  by this app — recorded so the holder knows who to chase. */
    issuingBody: trimmed.optional(),
    /**
     * Where the evidence sits, as a link the holder owns.
     *
     * Deliberately a URL and not an upload: the default upload path indexes a
     * document and sends it to a provider, and a registration certificate is
     * identity data that has no business in the clinical corpus.
     */
    evidenceUrl: httpUrl.optional(),
    /**
     * How the app came to believe the date above — never a verdict on whether
     * the person is compliant.
     *
     * Nothing here is checked with the issuing body, so no surface built on
     * this field may say "compliant", "valid" or "current to". It says what was
     * recorded and who recorded it, and leaves the judgement to the reader.
     */
    provenance: z.enum(ON_CALL_COMPLIANCE_PROVENANCE).optional(),
    /**
     * Earlier recorded expiry dates, newest first, written by Admin's Renewed
     * sheet (spec: "The previous date is kept in history"). JSONB, so no
     * migration. Each was typed by the holder; none was checked. At most ten.
     */
    expiryHistory: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."))
      .max(10)
      .optional(),
    /** "Where's your proof": a note to self of up to 120 characters, never the proof itself. */
    proofNote: trimmed.max(120).optional(),
    /**
     * Calendar day (`YYYY-MM-DD`) the holder pressed "Record issuer check
     * today" after looking at the real register themselves.
     *
     * Never inferred from Renewed, open, or view, and never reused from
     * `lastVerifiedAt` (On Call freshness). Surfaces may say "Last checked
     * with issuer · {date} · by you" or "No issuer check recorded" — never
     * "verified" or "compliant". Optional JSONB, so older rows keep parsing.
     */
    issuerCheckedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional(),
    /**
     * Owner-only: this requirement does not apply to the doctor's current job
     * (spec review 27/28, "Not for this job", approved by Josh 18:48Z). Storing
     * it moves the row to a final section on Renewals and takes it out of the
     * "X of Y recorded" count entirely — it is not counted as either recorded
     * or unrecorded. Never a verdict about the requirement itself, only about
     * whether it applies to this doctor. Absent (rather than `false`) is the
     * ordinary case, so an entry written before this field existed is
     * unaffected.
     */
    notForThisJob: z.boolean().optional(),
    /**
     * Links this compliance row to a statewide Requirements catalogue item
     * (`src/lib/admin/requirements.ts`) by id, so a renamed or reworded entry
     * still matches its catalogue slot. Optional: most rows match by title
     * instead, and a row with no catalogue counterpart carries none.
     *
     * A short, fixed-charset slug — never free text, so it cannot be used to
     * smuggle an unbounded or identifier-shaped string past `proofNote`'s own
     * guard — and, when present, one of the catalogue's own ids. The id list
     * lives in `@/lib/admin/requirement-ids`, a leaf module with no imports of
     * its own, precisely so this schema can depend on it without closing a
     * circular import back through `on-call/compliance.ts` into
     * `admin/requirements.ts` (see that module's docblock).
     */
    requirementId: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/, "Use a short lowercase slug.")
      .refine(
        (value) => (ADMIN_REQUIREMENT_IDS as readonly string[]).includes(value),
        "Not a Requirements catalogue id.",
      )
      .optional(),
    /**
     * New job's checklist tick for this step — owner-only, same as
     * `contactName` on a `contacts` row (see `OWNER_ONLY_DETAIL_KEYS`,
     * `src/lib/on-call/repository.ts`, which strips it from every shared
     * read). A colleague's progress through their own setup is not this
     * doctor's business, and the ticks New job shows are real saved toggles,
     * never a guess. Set by `setNewJobStepDone`
     * (`src/lib/admin/new-job-progress.ts`).
     */
    done: z.boolean().optional(),
    /**
     * The Perth calendar date (`YYYY-MM-DD`, matched rather than parsed, as
     * `expiresOn` is) the owner's new job starts — owner-only, stripped from
     * shared reads the same way `done` above is. `selectNewJobProgress`
     * (`src/lib/admin/new-job-progress.ts`) reads it from the most recently
     * updated own New job row that carries one; every other own row's copy,
     * if any, is ignored.
     */
    jobStartsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional(),
  })
  .strict();

const detailsSchemas = {
  contacts: contactsDetails,
  playbook: playbookDetails,
  referrals: referralsDetails,
  orientation: orientationDetails,
  education: educationDetails,
  logistics: logisticsDetails,
} as const satisfies Record<OnCallSection, z.ZodTypeAny>;

export function onCallDetailsSchemaFor(section: OnCallSection) {
  return detailsSchemas[section];
}

export const onCallEntrySchema = z
  .object({
    id: z.string().uuid(),
    section: z.enum(ON_CALL_SECTIONS),
    slug: trimmed,
    title: trimmed,
    subtitle: trimmed.nullable().default(null),
    body: z.string().nullable().default(null),
    details: z.unknown(),
    linkedDocumentIds: z.array(z.string().uuid()).default([]),
    tags: z.array(trimmed).default([]),
    isPersonal: z.boolean().default(false),
    includeOnCard: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    lastVerifiedAt: z.string().nullable().default(null),
    /**
     * Whether the signed-in reader owns this row, set by the server on read
     * and write responses — never stored, never accepted from a client (the
     * create/update schemas omit it). Shared reads return every account's
     * non-personal rows, and only the owner may edit or verify one, so the
     * page needs this to stop offering controls the server will refuse.
     * Optional so a cache written before the field existed still parses;
     * `onCallEntryIsEditable` treats "unknown" as editable, and the server
     * remains the authority either way.
     */
    isOwn: z.boolean().optional(),
    /**
     * Virtual view presentation model derived at read time from stored section
     * and details — never stored directly in the database, never accepted from
     * a client write (the create/update schemas omit it). Consumers read
     * entry.view for flexible UI presentation across virtual and stored views.
     */
    view: z.enum(ON_CALL_VIEW_PAGES).optional(),
  })
  .strict();

/**
 * Whether the page may offer edit and verify on this row. `false` only when
 * the server has said the row belongs to another account.
 */
export function onCallEntryIsEditable(entry: Pick<OnCallEntry, "isOwn">): boolean {
  return entry.isOwn !== false;
}

export type OnCallEntry = z.infer<typeof onCallEntrySchema>;

/**
 * The one fact an On Call surface may state about a document it links to: its
 * title and its date. Declared here in the domain layer rather than beside the
 * Playbook that renders it, because `src/lib` may not import from
 * `src/components` (tests/lib-layering.test.ts) and the resolver that builds
 * these lives in `src/lib/on-call/linked-documents.ts`.
 */
export interface OnCallLinkedDocument {
  id: string;
  title: string;
  /** ISO date string (publication or review date), or null if unknown. */
  date: string | null;
}
