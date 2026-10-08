import "server-only";

import { z } from "zod";

import type { Json } from "@/lib/supabase/database.types";

import { isValidApplications, parseApplications, type ApplicationsState } from "@/lib/cme/applications";
import { PublicApiError } from "@/lib/http";
import {
  isValidExamPrep,
  isValidTermTracker,
  type ExamPrepState,
  type TermTrackerState,
} from "@/lib/teaching/term-tracker";
import { WORK_AREAS } from "@/lib/work-frame/areas";
import { myDayCardIds } from "@/lib/my-day/dashboard";
import { paperworkSchema } from "@/lib/work-screens/admin/paperwork-model";
import { checkPatientDetail, type PatientDetailCheckOptions } from "@/lib/work-text/patient-detail-check";
import {
  WORK_SYNC_ACCOUNT_STORES,
  WORK_SYNC_QUICK_NOTE_LIMIT,
  WORK_SYNC_SECTIONS,
  type WorkSyncSection,
} from "@/lib/work-sync/sections";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * The account copy of the work-mode choices listed in `sections.ts`, kept at
 * `user_preferences.preferences.work`. Like Roster's settings at
 * `preferences.roster`, this key is written only here (through
 * `/api/work/sync`); every other key on the row is carried through
 * untouched, and `/api/account/preferences` splices this key back in on its
 * own writes.
 *
 * Admin paperwork is kept in `work_admin_paperwork`, and the Teaching term
 * tracker, exam prep and CPD job applications in `work_backups` (owner decision
 * 8 Oct 2026, questions 3 and 4), because a whole record can outgrow the
 * preferences row's size check. Both tables are written only here.
 *
 * Each section is replaced whole and stamped with the server's own time, so
 * the newest save from any device wins and a phone with a wrong clock cannot
 * hold a section hostage. A record is checked against the same schema its page
 * saves with, so it always reads back. The quick note is refused when it reads
 * as a patient detail, and so are job applications holding text their own
 * checks would drop and Teaching records holding free text the shared check
 * flags. Admin paperwork's free text is checked on its page, field by field,
 * before it is ever saved on the device.
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

/** A whole record, valid exactly when its page's own check says it reads back. */
function wholeRecord<T>(isValid: (value: T) => boolean): z.ZodType<T> {
  return z.custom<T>((value) => typeof value === "object" && value !== null && isValid(value as T), {
    message: "That record could not be read.",
  });
}

const WORK_SYNC_VALUE_SCHEMAS = {
  favouriteWorkPages: z.array(favouriteSchema).max(WORK_SYNC_MAX_FAVOURITES),
  myDayHiddenCards: z.array(z.enum(myDayCardIds)).max(myDayCardIds.length),
  myDaySnoozes: z
    .record(z.string().min(1).max(160), z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .refine((value) => Object.keys(value).length <= MAX_SNOOZES, { message: `At most ${MAX_SNOOZES} items.` }),
  myDayQuickNote: z.string().max(WORK_SYNC_QUICK_NOTE_LIMIT),
  adminPaperwork: paperworkSchema,
  teachingTermTracker: wholeRecord<TermTrackerState>(isValidTermTracker),
  teachingExamPrep: wholeRecord<ExamPrepState>(isValidExamPrep),
  cpdApplications: wholeRecord<ApplicationsState>(isValidApplications),
} as const satisfies Record<WorkSyncSection, z.ZodType>;

/** The `work_backups.section` each backed-up section is kept under. */
const BACKUP_SECTION_NAMES = {
  teachingTermTracker: "term_tracker",
  teachingExamPrep: "exam_prep",
  cpdApplications: "job_applications",
} as const satisfies Partial<Record<WorkSyncSection, string>>;

type BackupSection = keyof typeof BACKUP_SECTION_NAMES;

function isBackupSection(section: WorkSyncSection): section is BackupSection {
  return section in BACKUP_SECTION_NAMES;
}

/** Fields that name a hospital, a unit, a supervisor or a place, where a person's name is expected. */
const NAMED_PLACE: PatientDetailCheckOptions = { allowName: true, allowCapitals: true };
const FREE_TEXT: PatientDetailCheckOptions = { allowCapitals: true };

/** Every piece of free text a Teaching record keeps, with the allowance its field needs. */
function teachingTexts(
  section: "teachingTermTracker" | "teachingExamPrep",
  value: unknown,
): [string, PatientDetailCheckOptions][] {
  if (section === "teachingTermTracker") {
    const state = value as TermTrackerState;
    return state.terms.flatMap((term): [string, PatientDetailCheckOptions][] => [
      [term.unit, NAMED_PLACE],
      [term.site, NAMED_PLACE],
      [term.supervisor, NAMED_PLACE],
      [term.meeting?.place ?? "", NAMED_PLACE],
      ...term.goals.map((goal): [string, PatientDetailCheckOptions] => [goal.text, FREE_TEXT]),
      ...term.toRaise.map((item): [string, PatientDetailCheckOptions] => [item.text, FREE_TEXT]),
    ]);
  }
  const state = value as ExamPrepState;
  return [
    [state.exam?.name ?? "", FREE_TEXT],
    [state.group?.title ?? "", FREE_TEXT],
    [state.group?.place ?? "", NAMED_PLACE],
    ...state.topics.map((topic): [string, PatientDetailCheckOptions] => [topic.name, FREE_TEXT]),
  ];
}

const PREFERENCE_SECTIONS = WORK_SYNC_SECTIONS.filter((section) => WORK_SYNC_ACCOUNT_STORES[section] === "preferences");

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
  if (section === "teachingTermTracker" || section === "teachingExamPrep") {
    const thisYear = new Date().getUTCFullYear();
    const flagged = teachingTexts(section, parsed.data).some(
      ([text, options]) => text.trim() !== "" && checkPatientDetail(text, { ...options, thisYear }),
    );
    if (flagged) {
      throw new PublicApiError("Something here looks like a patient detail, so it stays on this device.", 422, {
        code: "patient_detail",
      });
    }
  }
  if (section === "cpdApplications") {
    // Reading it back runs the page's own patient-detail checks; anything they would drop is refused.
    const text = JSON.stringify(parsed.data);
    if (JSON.stringify(parseApplications(text)) !== text) {
      throw new PublicApiError("Something here looks like a patient detail, so it stays on this device.", 422, {
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
  for (const section of PREFERENCE_SECTIONS) {
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

/** A table row back to an entry; a record that no longer validates is left out, as if never saved. */
function tableEntry(section: WorkSyncSection, record: unknown, updatedAt: unknown): WorkSyncEntry | null {
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) return null;
  if (record === null) return { value: null, updatedAt };
  const parsed = WORK_SYNC_VALUE_SCHEMAS[section].safeParse(record);
  return parsed.success ? { value: parsed.data, updatedAt } : null;
}

export async function fetchWorkSyncState(supabase: AdminClient, ownerId: string): Promise<WorkSyncState> {
  requireOwner(ownerId);
  const [preferencesRead, paperworkRead, backupsRead] = await Promise.all([
    supabase.from("user_preferences").select("preferences").eq("user_id", ownerId).maybeSingle(),
    supabase.from("work_admin_paperwork").select("record,updated_at").eq("owner_id", ownerId).maybeSingle(),
    supabase.from("work_backups").select("section,record,updated_at").eq("owner_id", ownerId),
  ]);
  if (preferencesRead.error) throw preferencesRead.error;
  if (paperworkRead.error) throw paperworkRead.error;
  if (backupsRead.error) throw backupsRead.error;

  const preferences = preferencesRead.data?.preferences as { work?: unknown } | null | undefined;
  const out: Partial<Record<WorkSyncSection, WorkSyncEntry>> = normalizeWorkSyncState(preferences?.work);
  if (paperworkRead.data) {
    const entry = tableEntry("adminPaperwork", paperworkRead.data.record, paperworkRead.data.updated_at);
    if (entry) out.adminPaperwork = entry;
  }
  for (const row of backupsRead.data ?? []) {
    const section = (Object.keys(BACKUP_SECTION_NAMES) as BackupSection[]).find(
      (key) => BACKUP_SECTION_NAMES[key] === row.section,
    );
    if (!section) continue;
    const entry = tableEntry(section, row.record, row.updated_at);
    if (entry) out[section] = entry;
  }
  return out;
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
  if (section === "adminPaperwork" || isBackupSection(section))
    return writeTableSection(supabase, ownerId, section, parsed);
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

/** Replaces one record in its own table. A single upsert, so the newest save wins. */
async function writeTableSection(
  supabase: AdminClient,
  ownerId: string,
  section: "adminPaperwork" | BackupSection,
  record: unknown,
): Promise<WorkSyncEntry> {
  const updatedAt = new Date().toISOString();
  const { error } =
    section === "adminPaperwork"
      ? await supabase
          .from("work_admin_paperwork")
          .upsert(
            { owner_id: ownerId, record: record as Json | null, updated_at: updatedAt },
            { onConflict: "owner_id" },
          )
      : await supabase.from("work_backups").upsert(
          {
            owner_id: ownerId,
            section: BACKUP_SECTION_NAMES[section],
            record: record as Json | null,
            updated_at: updatedAt,
          },
          { onConflict: "owner_id,section" },
        );
  if (error) throw tooLargeOr(error);
  return { value: record, updatedAt };
}

/** A size check (16 KB on the preferences row, more on the record tables) is the only check a write can trip; say so plainly. */
function tooLargeOr(error: { code?: string }): unknown {
  if (error.code === "23514") {
    return new PublicApiError("Your account has no room for more saved choices. They stay on this device.", 413, {
      code: "work_sync_full",
    });
  }
  return error;
}
