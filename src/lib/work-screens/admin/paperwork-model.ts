import { z } from "zod";

/**
 * Admin's own-paperwork record: the requests a doctor sends and tracks, what
 * they chose to share and when they shared it themselves, where their work
 * documents are kept, the payslips they checked against their roster, and
 * their tax checklist and expenses.
 *
 * None of this fits a stored kind in the personal entries store
 * (`on_call_entries`): a request, a share choice or a payslip check is not a
 * compliance requirement, and a plain Admin row would surface as a Help guide.
 * Adding a kind needs a schema change, so these records live on this device
 * only, under one account-scoped key (`paperwork-store.ts`). Nothing here is
 * sent anywhere. Every free-text field is checked for patient details before
 * it is saved.
 */

export const ADMIN_PAPERWORK_VERSION = 1 as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const shortText = (max: number) => z.string().trim().max(max);
/** Own records use plain ids. Sample records (sample.ts) start "example:" and are never stored. */
const id = z.string().regex(/^(?:example:)?[a-z0-9-]{1,48}$/);

/* -------------------------------------------------------------- requests */

export const REQUEST_KINDS = ["more-time", "document", "leave", "question", "other"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATUSES = ["draft", "sent", "seen", "decided"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_OUTCOMES = ["agreed", "declined", "other"] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export const requestSchema = z
  .object({
    id,
    kind: z.enum(REQUEST_KINDS),
    title: shortText(120).min(1),
    to: shortText(60).min(1),
    toEmail: shortText(120).optional(),
    message: shortText(1200),
    /** The date the item was due, when the ask is about one. */
    dueOn: isoDate.optional(),
    /** The new date asked for, for "more time". */
    askedFor: isoDate.optional(),
    status: z.enum(REQUEST_STATUSES),
    outcome: z.enum(REQUEST_OUTCOMES).optional(),
    outcomeNote: shortText(200).optional(),
    createdOn: isoDate,
    sentOn: isoDate.optional(),
    seenOn: isoDate.optional(),
    decidedOn: isoDate.optional(),
    /** A date to chase it by, when nothing has come back. */
    followUpOn: isoDate.optional(),
  })
  .strict();
export type AdminRequest = z.infer<typeof requestSchema>;

/* --------------------------------------------------------------- sharing */

export const SHARE_GROUPS = ["registration", "checks", "training", "job", "health"] as const;
export type ShareGroup = (typeof SHARE_GROUPS)[number];

export const SHARE_METHODS = ["download", "copy", "email"] as const;
export type ShareMethod = (typeof SHARE_METHODS)[number];

export const shareLogSchema = z
  .object({
    id,
    on: isoDate,
    to: shortText(60).min(1),
    method: z.enum(SHARE_METHODS),
    groups: z.array(z.enum(SHARE_GROUPS)).max(SHARE_GROUPS.length),
    itemCount: z.number().int().min(0).max(500),
  })
  .strict();
export type ShareLogEntry = z.infer<typeof shareLogSchema>;

export const sharingSchema = z
  .object({
    /** Every switch starts off. */
    groups: z.partialRecord(z.enum(SHARE_GROUPS), z.boolean()).default({}),
    /** Who the doctor shares with, by their own name for them. */
    recipient: shortText(60).default("Medical Workforce"),
    recipientEmail: shortText(120).optional(),
    log: z.array(shareLogSchema).max(50).default([]),
  })
  .strict();
export type AdminSharing = z.infer<typeof sharingSchema>;

/* ------------------------------------------------------------- documents */

export const DOCUMENT_FOLDERS = ["contracts", "registration", "certificates", "training", "pay", "other"] as const;
export type DocumentFolder = (typeof DOCUMENT_FOLDERS)[number];

export const documentSchema = z
  .object({
    id,
    title: shortText(80).min(1),
    folder: z.enum(DOCUMENT_FOLDERS),
    issuedOn: isoDate.optional(),
    expiresOn: isoDate.optional(),
    /** Where the real file sits, in the doctor's words: "OneDrive, Work folder". */
    keptAt: shortText(80).optional(),
    /** A link the doctor owns. http or https only. */
    url: z
      .string()
      .trim()
      .max(400)
      .refine((value) => /^https?:\/\//i.test(value), "Use an http or https link.")
      .optional(),
    note: shortText(120).optional(),
    addedOn: isoDate,
  })
  .strict();
export type AdminDocument = z.infer<typeof documentSchema>;

/* ------------------------------------------------------------------- pay */

export const payslipCheckSchema = z
  .object({
    id,
    periodStart: isoDate,
    periodEnd: isoDate,
    paidOn: isoDate.optional(),
    /** Hours as printed on the payslip, typed by the doctor. */
    payslipOrdinaryHours: z.number().min(0).max(400),
    payslipExtraHours: z.number().min(0).max(400).optional(),
    /** What the roster said at the time of the check, kept so the record still reads later. */
    rosteredHours: z.number().min(0).max(400),
    loggedExtraHours: z.number().min(0).max(400),
    note: shortText(160).optional(),
    checkedOn: isoDate,
    /** The doctor's own follow-up once a difference was raised. */
    resolved: z.boolean().optional(),
  })
  .strict();
export type PayslipCheck = z.infer<typeof payslipCheckSchema>;

/* ------------------------------------------------------------------- tax */

export const EXPENSE_KINDS = [
  "registration",
  "indemnity",
  "college",
  "courses",
  "books",
  "equipment",
  "phone",
  "travel",
  "other",
] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const expenseSchema = z
  .object({
    id,
    on: isoDate,
    kind: z.enum(EXPENSE_KINDS),
    title: shortText(80).min(1),
    /** Whole cents, typed by the doctor from their receipt. */
    cents: z.number().int().min(0).max(100_000_000),
    receiptKept: z.boolean(),
  })
  .strict();
export type AdminExpense = z.infer<typeof expenseSchema>;

export const taxYearSchema = z
  .object({
    ticks: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), z.boolean()).default({}),
    expenses: z.array(expenseSchema).max(500).default([]),
  })
  .strict();
export type AdminTaxYear = z.infer<typeof taxYearSchema>;

/* ---------------------------------------------------------------- record */

export const paperworkSchema = z
  .object({
    version: z.literal(ADMIN_PAPERWORK_VERSION),
    requests: z.array(requestSchema).max(200).default([]),
    sharing: sharingSchema.default({ groups: {}, recipient: "Medical Workforce", log: [] }),
    documents: z.array(documentSchema).max(300).default([]),
    payslips: z.array(payslipCheckSchema).max(200).default([]),
    /** Keyed by the financial year's first calendar year: "2026" is 1 July 2026 to 30 June 2027. */
    tax: z.record(z.string().regex(/^\d{4}$/), taxYearSchema).default({}),
  })
  .strict();
export type AdminPaperwork = z.infer<typeof paperworkSchema>;

export function emptyPaperwork(): AdminPaperwork {
  return {
    version: ADMIN_PAPERWORK_VERSION,
    requests: [],
    sharing: { groups: {}, recipient: "Medical Workforce", log: [] },
    documents: [],
    payslips: [],
    tax: {},
  };
}

/** Reads a stored record. Anything unreadable comes back empty rather than throwing into render. */
export function parsePaperwork(raw: string | null): AdminPaperwork {
  if (!raw) return emptyPaperwork();
  try {
    const parsed = paperworkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyPaperwork();
  } catch {
    return emptyPaperwork();
  }
}

export function isValidPaperwork(state: AdminPaperwork): boolean {
  return paperworkSchema.safeParse(state).success;
}

/** A short random id: no title, no date, nothing that says what the record is. */
export function newPaperworkId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
