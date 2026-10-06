import { z } from "zod";

import { cmeDateSchema } from "@/lib/cme/schemas";
import { cmeCategories, type CmeCategory } from "@/lib/cme/types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * A half-finished activity, saved to the account so it survives a reload, a
 * dropped connection, a phone change — anything short of signing out, which
 * clears it like the rest of CME.
 *
 * The payload is deliberately the entry form's own RAW field state — the same
 * shape `StoredDraft` in `cme-entry-form.tsx` keeps in session storage for an
 * unsaved new entry — not the validated `cmeEntryCreateSchema` shape. A draft
 * is captured mid-typing: the date might be blank, the hours text might be
 * "1." with a trailing dot, no category might be chosen yet. Every field is
 * therefore optional/lenient text or a small bounded array, never a real-date
 * or real-number check, and unknown keys are stripped rather than rejected so
 * an older or newer client's field set never breaks a save.
 *
 * This file defines the shape only — no `server-only`, because
 * `cme-drafts-section.tsx` (a client component) needs the type and the
 * grouping/label helpers below. Reads and writes to the database live in
 * `drafts-repository.ts` instead.
 *
 * A draft never counts toward hours: nothing here is read by
 * `evaluate.ts`, `export.ts` or `year-close.ts`, and it must stay that way —
 * see the static import-boundary test in `tests/cme-drafts.test.ts`.
 */

/** Matches the `cme_entry_drafts.payload` column's own limit (`octet_length(payload::text) <= 16384`). */
export const CME_DRAFT_PAYLOAD_MAX_BYTES = 16384;

export const CME_DRAFT_WAITING_NOTE_MAX_LENGTH = 200;

export const cmeDraftWaitingOnValues = ["supervisor", "workforce"] as const;
export type CmeDraftWaitingOn = (typeof cmeDraftWaitingOnValues)[number];

/** The category chip choice, or "split", or nothing chosen yet — mirrors the form's own `CategoryMode`. */
export type CmeDraftMode = CmeCategory | "split" | null;

export type CmeDraftAllocation = { readonly category: CmeCategory; readonly hours: number };

export type CmeDraftPayload = {
  readonly title: string;
  readonly date: string;
  readonly statedHoursText: string;
  readonly mode: CmeDraftMode;
  readonly allocations: readonly CmeDraftAllocation[];
  readonly reflection: string;
  readonly sourceUrl: string;
  readonly formalPeerReviewText: string;
  readonly buckets: readonly string[];
  readonly costText: string;
  readonly routineId: string | null;
  readonly documentId: string | null;
};

const cmeDraftAllocationSchema = z.object({
  category: z.enum(cmeCategories),
  // A typed-but-not-yet-valid split can transiently carry an odd figure; the real
  // ceiling (24h/activity, `hours <= 24`) belongs to `cmeEntryCreateSchema`, which
  // validates the real entry once the draft is turned into one. This only keeps a
  // rogue number from inflating the stored payload.
  hours: z.number().finite().min(-1000).max(1000),
});

/** Every field optional/defaulted, every string length-capped: a half-filled form must always save. */
const cmeDraftPayloadShape = z.object({
  title: z.string().max(200).default(""),
  date: z.string().max(40).default(""),
  statedHoursText: z.string().max(40).default(""),
  mode: z.enum(["educational", "reviewing", "measuring", "split"]).nullable().default(null),
  allocations: z.array(cmeDraftAllocationSchema).max(3).default([]),
  reflection: z.string().max(2000).default(""),
  sourceUrl: z.string().max(2000).default(""),
  formalPeerReviewText: z.string().max(40).default(""),
  buckets: z.array(z.string().max(80)).max(8).default([]),
  costText: z.string().max(40).default(""),
  routineId: z.string().uuid().nullable().default(null),
  documentId: z.string().uuid().nullable().default(null),
});

/** UTF-8 byte length, matching what Postgres' `octet_length(payload::text)` measures. */
export function cmeDraftPayloadByteSize(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload ?? {})).length;
}

export const cmeDraftPayloadSchema = cmeDraftPayloadShape.refine(
  (payload) => cmeDraftPayloadByteSize(payload) <= CME_DRAFT_PAYLOAD_MAX_BYTES,
  { message: `A draft can be at most ${CME_DRAFT_PAYLOAD_MAX_BYTES} bytes.` },
);

// A real calendar date, so an impossible one (2026-02-30) is a 400 here rather than a
// Postgres `date` error surfacing as a 500.
const cmeDraftFollowUpOnSchema = cmeDateSchema.nullable();

const cmeDraftWaitingFields = {
  waitingOn: z.enum(cmeDraftWaitingOnValues).nullable().optional(),
  waitingNote: z.string().trim().max(CME_DRAFT_WAITING_NOTE_MAX_LENGTH).nullable().optional(),
  followUpOn: cmeDraftFollowUpOnSchema.optional(),
};

/** `POST /api/cme/drafts` body. An empty body creates a blank draft; waiting fields are optional. */
export const cmeDraftCreateSchema = z
  .object({ payload: cmeDraftPayloadSchema.optional(), ...cmeDraftWaitingFields })
  .strict();

/** `PATCH /api/cme/drafts/[id]` body. Any of payload / waiting fields, at least one. */
export const cmeDraftUpdateSchema = z
  .object({ payload: cmeDraftPayloadSchema.optional(), ...cmeDraftWaitingFields })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update." });

export type CmeDraftUpdate = z.infer<typeof cmeDraftUpdateSchema>;

export type CmeDraft = {
  readonly id: string;
  readonly payload: CmeDraftPayload;
  readonly waitingOn: CmeDraftWaitingOn | null;
  readonly waitingNote: string | null;
  readonly followUpOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type CmeDraftRow = Pick<
  Database["public"]["Tables"]["cme_entry_drafts"]["Row"],
  "id" | "payload" | "waiting_on" | "waiting_note" | "follow_up_on" | "created_at" | "updated_at"
>;

const blankDraftPayload = cmeDraftPayloadShape.parse({});

/** A row whose stored payload somehow fails the lenient schema degrades to blank rather than throwing. */
export function rowToCmeDraft(row: CmeDraftRow): CmeDraft {
  const parsedPayload = cmeDraftPayloadShape.safeParse(row.payload);
  return {
    id: row.id,
    payload: parsedPayload.success ? parsedPayload.data : blankDraftPayload,
    waitingOn: row.waiting_on,
    waitingNote: row.waiting_note,
    followUpOn: row.follow_up_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CmeDraftGroups = {
  readonly nextAction: readonly CmeDraft[];
  readonly supervisor: readonly CmeDraft[];
  readonly workforce: readonly CmeDraft[];
};

/** Yours to do (the Log tab's count) / waiting on a supervisor / waiting on workforce, most-recently-edited first. */
export function groupDrafts(drafts: readonly CmeDraft[]): CmeDraftGroups {
  const sorted = [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    nextAction: sorted.filter((draft) => draft.waitingOn === null),
    supervisor: sorted.filter((draft) => draft.waitingOn === "supervisor"),
    workforce: sorted.filter((draft) => draft.waitingOn === "workforce"),
  };
}

export function draftTitle(draft: Pick<CmeDraft, "payload">): string {
  const title = draft.payload.title.trim();
  return title.length > 0 ? title : "Untitled draft";
}
