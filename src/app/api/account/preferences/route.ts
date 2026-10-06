import { z } from "zod";

import { mergeAccountPreferences, normalizePreferences } from "@/lib/account-preferences";
import { dateKeyToUtcMillis, isValidTime } from "@/lib/calendar/calendar-event";
import { MAX_ALERTS_PER_DAY, MIN_ALERTS_PER_DAY, REMINDER_LEAD_TIMES } from "@/lib/reminders/settings";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const MAX_PREFERENCE_WRITE_ATTEMPTS = 3;

const perthDateSchema = z
  .string()
  .max(10)
  .refine((value) => dateKeyToUtcMillis(value) !== null, { message: "Expected a YYYY-MM-DD date." });
const wallClockSchema = z
  .string()
  .max(5)
  .refine((value) => isValidTime(value), { message: "Expected an HH:MM time." });

const reminderTypePatchSchema = z
  .object({
    showInApp: z.boolean(),
    calendarAlert: z.enum(REMINDER_LEAD_TIMES),
    snoozedUntil: perthDateSchema.nullable(),
  })
  .partial()
  .strict();

// Every level is partial and strict: a client sends only what it changed (or
// the whole object), and an omitted type or field keeps its stored value.
const remindersPatchSchema = z
  .object({
    types: z
      .object({
        "compliance-dates": reminderTypePatchSchema,
        "on-call-checks": reminderTypePatchSchema,
        shifts: reminderTypePatchSchema,
        "cpd-year-end": reminderTypePatchSchema,
        "cpd-routines": reminderTypePatchSchema,
        teaching: reminderTypePatchSchema,
      })
      .partial()
      .strict(),
    quietHours: z.object({ enabled: z.boolean(), start: wallClockSchema, end: wallClockSchema }).partial().strict(),
    maxAlertsPerDay: z.number().int().min(MIN_ALERTS_PER_DAY).max(MAX_ALERTS_PER_DAY),
    brief: z.object({ enabled: z.boolean(), workday: wallClockSchema, dayOff: wallClockSchema }).partial().strict(),
  })
  .partial()
  .strict()
  // "Evening before" is a fixed 20:00 Perth alarm anchored to a shift's own
  // start date; it means nothing for any other reminder type, so it is
  // refused there rather than silently accepted.
  .refine(
    (patch) =>
      Object.entries(patch.types ?? {}).every(
        ([type, typePatch]) => type === "shifts" || typePatch?.calendarAlert !== "evening-before",
      ),
    { message: "The evening-before alert is only for Shifts." },
  );

const preferencesPatchSchema = z
  .object({
    density: z.enum(["comfortable", "compact", "spacious"]),
    motion: z.enum(["system", "reduced", "full"]),
    jurisdiction: z.enum(["wa", "nsw", "vic", "qld", "sa", "tas", "act", "nt", "national"]),
    population: z.enum(["adults", "older-adults", "adolescents", "all"]),
    answerStyle: z.enum(["conservative", "balanced", "comprehensive"]),
    landing: z.enum(["ask", "search", "browse"]),
    showRecentOnHome: z.boolean(),
    showProtocolsOnHome: z.boolean(),
    compactCitations: z.boolean(),
    // Omitted keys are preserved from the stored account row on PUT — never
    // defaulted here, or a pre-change tab can overwrite a stored opt-out.
    saveRecentSearches: z.boolean(),
    notifyGuidelineUpdates: z.boolean(),
    notifyProductNews: z.boolean(),
    notifySavedChanges: z.boolean(),
    workStage: z.enum(["intern", "resident", "registrar", "consultant", "other"]).nullable(),
    ranzcpStage: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    reminders: remindersPatchSchema,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Account preferences must include at least one field.",
  });

function nextUpdatedAt(previous: string | null): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  const minimumTime = Number.isFinite(previousTime) ? previousTime + 1 : 0;
  return new Date(Math.max(Date.now(), minimumTime)).toISOString();
}

/**
 * Roster's own settings live at `preferences.roster` on this same row, written
 * only by `/api/roster/settings` (see `@/lib/roster/settings`). This route
 * must never return that key — the phone caches this whole response in
 * `localStorage` via `useAppPreferences` — but a PUT here still round-trips
 * the stored JSON through the typed `AppPreferences` shape, which would
 * otherwise silently drop any unknown key including this one. So the raw
 * value is read once and spliced back into what gets persisted.
 */
function extractRoster(preferences: unknown): unknown {
  return preferences !== null && typeof preferences === "object" && !Array.isArray(preferences)
    ? (preferences as Record<string, unknown>).roster
    : undefined;
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const { data, error } = await supabase
      .from("user_preferences")
      .select("preferences,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Response.json({
      preferences: data ? normalizePreferences(data.preferences) : null,
      updatedAt: data?.updated_at,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const patch = await parseJsonBody(request, preferencesPatchSchema, "Account preferences are invalid.");

    for (let attempt = 0; attempt < MAX_PREFERENCE_WRITE_ATTEMPTS; attempt += 1) {
      const { data: existing, error: readError } = await supabase
        .from("user_preferences")
        .select("preferences,updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (readError) throw new Error(readError.message);

      const preferences = mergeAccountPreferences(existing?.preferences ?? null, patch);
      const updatedAt = nextUpdatedAt(existing?.updated_at ?? null);
      const roster = extractRoster(existing?.preferences);
      const storedPreferences = roster === undefined ? preferences : { ...preferences, roster };

      if (!existing) {
        const { error: insertError } = await supabase.from("user_preferences").insert({
          user_id: user.id,
          preferences: storedPreferences,
          updated_at: updatedAt,
        });
        if (!insertError) return Response.json({ preferences });
        if (insertError.code === "23505") continue;
        throw new Error(insertError.message);
      }

      const { data: updated, error: updateError } = await supabase
        .from("user_preferences")
        .update({ preferences: storedPreferences, updated_at: updatedAt })
        .eq("user_id", user.id)
        .eq("updated_at", existing.updated_at)
        .select("updated_at")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (updated) return Response.json({ preferences });
    }

    throw new Error("Account preferences changed too frequently. Please retry.");
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
