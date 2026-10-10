import "server-only";

import {
  readStarterSharingChoice,
  STARTER_SHARING_PREFERENCE_KEY,
  type StarterSharingChoice,
} from "@/lib/work-roles/hospital-starters-model";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * A doctor's own choice to share their New job progress with Medical Workforce.
 *
 * It lives at `user_preferences.preferences.starterSharing` (`{ workforce, updatedAt }`), a key of
 * the doctor's own account settings row, because it is a choice about their account, not a fact
 * about any one checklist row: deleting, editing or making private a New job row never changes it,
 * and turning it off is one write that the Workforce reader sees on its very next read. It is off
 * until the doctor turns it on. `/api/work/starters/sharing` is the only route that writes this
 * key; `/api/account/preferences` carries it through untouched and never returns it, so it is
 * never copied into the phone's local storage.
 */

function requireOwner(ownerId: string) {
  if (!ownerId) throw new Error("Missing sharing owner.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The doctor's own choice, read from their own preferences row only. Off when there is none. */
export async function fetchStarterSharing(supabase: AdminClient, ownerId: string): Promise<StarterSharingChoice> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("user_preferences")
    .select("preferences")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return readStarterSharingChoice(data?.preferences);
}

const MAX_WRITE_ATTEMPTS = 3;

function nextUpdatedAt(previous: string | null): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  const minimumTime = Number.isFinite(previousTime) ? previousTime + 1 : 0;
  return new Date(Math.max(Date.now(), minimumTime)).toISOString();
}

/**
 * Turns sharing on or off, touching only the `starterSharing` key: every other key on the row is
 * carried through unchanged. A compare-and-swap on the row's `updated_at`, the same guard the
 * account preferences, Roster settings and work sync writers use on this row.
 */
export async function writeStarterSharing(
  supabase: AdminClient,
  ownerId: string,
  share: boolean,
): Promise<StarterSharingChoice> {
  requireOwner(ownerId);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data: existing, error: readError } = await supabase
      .from("user_preferences")
      .select("preferences,updated_at")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (readError) throw readError;

    const rawPreferences = isPlainObject(existing?.preferences) ? existing.preferences : {};
    const updatedAt = nextUpdatedAt(existing?.updated_at ?? null);
    const choice: StarterSharingChoice = { workforce: share, updatedAt };
    const next = { ...rawPreferences, [STARTER_SHARING_PREFERENCE_KEY]: choice };

    if (!existing) {
      const { error: insertError } = await supabase
        .from("user_preferences")
        .insert({ user_id: ownerId, preferences: next, updated_at: updatedAt });
      if (!insertError) return choice;
      if (insertError.code === "23505") continue;
      throw insertError;
    }

    const { data: updated, error: updateError } = await supabase
      .from("user_preferences")
      .update({ preferences: next, updated_at: updatedAt })
      .eq("user_id", ownerId)
      .eq("updated_at", existing.updated_at)
      .select("updated_at")
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return choice;
  }
  throw new Error("Your sharing choice changed too often. Please try again.");
}
