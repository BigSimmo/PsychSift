import "server-only";

import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import { WORK_AREAS } from "@/lib/work-frame/areas";
import { myDayCardIds } from "@/lib/my-day/dashboard";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";
import { WORK_SYNC_QUICK_NOTE_LIMIT, WORK_SYNC_SECTIONS, type WorkSyncSection } from "@/lib/work-sync/sections";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * The account copy of the work-mode choices listed in `sections.ts`, kept at
 * `user_preferences.preferences.work`. Like Roster's settings at
 * `preferences.roster`, this key is written only here (through
 * `/api/work/sync`); every other key on the row is carried through
 * untouched, and `/api/account/preferences` splices this key back in on its
 * own writes.
 *
 * Each section is replaced whole and stamped with the server's own time, so
 * the newest save from any device wins and a phone with a wrong clock cannot
 * hold a section hostage. Values hold ids, times and the doctor's quick note
 * only, and the note is refused when it reads as a patient detail.
 */

const WORK_SYNC_MAX_FAVOURITES = 60;
const MAX_SNOOZES = 100;

const epochMs = z.number().int().positive().max(8_640_000_000_000_000);
const areaIds = Object.keys(WORK_AREAS) as [string, ...string[]];

const favouriteSchema = z
  .object({
    areaId: z.enum(areaIds),
    itemId: z.string().min(1).max(80),
    starredAt: epochMs,
    pinnedAt: epochMs.nullable(),
    openedAt: epochMs.nullable(),
  })
  .strict();

const WORK_SYNC_VALUE_SCHEMAS = {
  favouriteWorkPages: z.array(favouriteSchema).max(WORK_SYNC_MAX_FAVOURITES),
  myDayHiddenCards: z.array(z.enum(myDayCardIds)).max(myDayCardIds.length),
  myDaySnoozes: z
    .record(z.string().min(1).max(160), z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .refine((value) => Object.keys(value).length <= MAX_SNOOZES, { message: `At most ${MAX_SNOOZES} items.` }),
  myDayQuickNote: z.string().max(WORK_SYNC_QUICK_NOTE_LIMIT),
} as const satisfies Record<WorkSyncSection, z.ZodType>;

/** A stored section: its value (null once cleared on a device) and when the server took it. */
export type WorkSyncEntry = { readonly value: unknown; readonly updatedAt: string };
type WorkSyncState = Partial<Record<WorkSyncSection, WorkSyncEntry>>;

export const workSyncPutSchema = z
  .object({
    section: z.enum(WORK_SYNC_SECTIONS),
    value: z.unknown(),
  })
  .strict();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates one section's value; null clears it. Throws a 400 the doctor can read. */
function parseWorkSyncValue(section: WorkSyncSection, value: unknown): unknown {
  if (value === null) return null;
  const parsed = WORK_SYNC_VALUE_SCHEMAS[section].safeParse(value);
  if (!parsed.success) {
    throw new PublicApiError("That choice could not be saved to your account.", 400, { code: "invalid_body" });
  }
  if (section === "myDayQuickNote") {
    const note = parsed.data as string;
    if (!note.trim()) return null;
    if (checkPatientDetail(note, { thisYear: new Date().getUTCFullYear() })) {
      throw new PublicApiError("The note looks like it holds a patient detail, so it stays on this device.", 422, {
        code: "patient_detail",
      });
    }
  }
  return parsed.data;
}

/** Whatever is stored, including garbage, becomes only the sections that still validate. */
function normalizeWorkSyncState(input: unknown): WorkSyncState {
  if (!isPlainObject(input)) return {};
  const out: Partial<Record<WorkSyncSection, WorkSyncEntry>> = {};
  for (const section of WORK_SYNC_SECTIONS) {
    const entry = input[section];
    if (!isPlainObject(entry) || typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) {
      continue;
    }
    if (entry.value === null) {
      out[section] = { value: null, updatedAt: entry.updatedAt };
      continue;
    }
    const parsed = WORK_SYNC_VALUE_SCHEMAS[section].safeParse(entry.value);
    if (parsed.success) out[section] = { value: parsed.data, updatedAt: entry.updatedAt };
  }
  return out;
}

function requireOwner(ownerId: string) {
  if (!ownerId) throw new Error("Missing work sync owner.");
}

export async function fetchWorkSyncState(supabase: AdminClient, ownerId: string): Promise<WorkSyncState> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("user_preferences")
    .select("preferences")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  const preferences = data?.preferences as { work?: unknown } | null | undefined;
  return normalizeWorkSyncState(preferences?.work);
}

const MAX_WRITE_ATTEMPTS = 3;

function nextUpdatedAt(previous: string | null): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  const minimumTime = Number.isFinite(previousTime) ? previousTime + 1 : 0;
  return new Date(Math.max(Date.now(), minimumTime)).toISOString();
}

/**
 * Replaces one section, touching only `preferences.work.<section>`. A
 * compare-and-swap on the row's `updated_at`, the same guard the account
 * preferences and Roster settings writers use on this row.
 */
export async function writeWorkSyncSection(
  supabase: AdminClient,
  ownerId: string,
  section: WorkSyncSection,
  value: unknown,
): Promise<WorkSyncEntry> {
  requireOwner(ownerId);
  const parsed = parseWorkSyncValue(section, value);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data: existing, error: readError } = await supabase
      .from("user_preferences")
      .select("preferences,updated_at")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (readError) throw readError;

    const rawPreferences = isPlainObject(existing?.preferences) ? existing.preferences : {};
    const updatedAt = nextUpdatedAt(existing?.updated_at ?? null);
    const work = { ...normalizeWorkSyncState(rawPreferences.work), [section]: { value: parsed, updatedAt } };
    const next = { ...rawPreferences, work };
    const entry = { value: parsed, updatedAt };

    if (!existing) {
      const { error: insertError } = await supabase
        .from("user_preferences")
        .insert({ user_id: ownerId, preferences: next, updated_at: updatedAt });
      if (!insertError) return entry;
      if (insertError.code === "23505") continue;
      throw tooLargeOr(insertError);
    }

    const { data: updated, error: updateError } = await supabase
      .from("user_preferences")
      .update({ preferences: next, updated_at: updatedAt })
      .eq("user_id", ownerId)
      .eq("updated_at", existing.updated_at)
      .select("updated_at")
      .maybeSingle();
    if (updateError) throw tooLargeOr(updateError);
    if (updated) return entry;
  }
  throw new Error("Work choices changed too frequently. Please retry.");
}

/** The row's size check (16 KB) is the only check this write can trip; say so plainly. */
function tooLargeOr(error: { code?: string }): unknown {
  if (error.code === "23514") {
    return new PublicApiError("Your account has no room for more saved choices. They stay on this device.", 413, {
      code: "work_sync_full",
    });
  }
  return error;
}
