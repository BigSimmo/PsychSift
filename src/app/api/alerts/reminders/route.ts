import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import { ownerSubscriptionFor, validPushEndpoint } from "@/lib/roster/alerts/subscriptions";
import { withRosterApi } from "@/lib/roster/team/api";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/**
 * Remind me, timed: the phone tells the server only WHEN one of its notes is
 * due, under an id it chose, so the note can buzz while the app is closed.
 * It also names the one device to buzz: the phone that holds the words.
 * The words never come here (owner decision 1, 5 Oct 2026). The row is
 * deleted when the note is ticked off, removed, or sent.
 */
const refSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const MAX_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;

const setBodySchema = z
  .object({
    ref: refSchema,
    dueAt: z
      .string()
      .max(40)
      .refine((value) => Number.isFinite(Date.parse(value)), { message: "Expected a time." }),
    endpoint: z.string().max(1000).refine(validPushEndpoint, { message: "Expected this device's alert link." }),
  })
  .strict();
const removeBodySchema = z.object({ ref: refSchema }).strict();

export async function POST(request: Request) {
  return withRosterApi(
    request,
    async (client, ownerId) => {
      const body = await parseJsonBody(request, setBodySchema, "Choose when this reminder is due.");
      const due = Date.parse(body.dueAt);
      const now = Date.now();
      // A note already due, or more than a week away, is not queued; the phone still shows it.
      if (due <= now || due - now > MAX_AHEAD_MS) return { queued: false };
      // Only a device this owner linked for phone alerts can be buzzed.
      if (!(await ownerSubscriptionFor(client, ownerId, body.endpoint))) return { queued: false };
      const { error } = await client
        .from("alert_reminder_times")
        .upsert(
          { owner_id: ownerId, ref: body.ref, due_at: new Date(due).toISOString(), endpoint: body.endpoint },
          { onConflict: "owner_id,ref" },
        );
      if (error?.message?.includes("alerts_limit")) {
        throw new PublicApiError("Twenty reminders are already waiting to buzz this phone.", 409, {
          code: "roster_limit",
        });
      }
      if (error) {
        throw new PublicApiError("This reminder can't buzz your phone right now.", 503, {
          code: "roster_unavailable",
        });
      }
      return { queued: true };
    },
    { demo: () => ({ queued: false }) },
  );
}

export async function DELETE(request: Request) {
  return withRosterApi(
    request,
    async (client, ownerId) => {
      const body = await parseJsonBody(request, removeBodySchema, "Choose a reminder.");
      const { error } = await client.from("alert_reminder_times").delete().eq("owner_id", ownerId).eq("ref", body.ref);
      if (error) {
        throw new PublicApiError("This reminder may still buzz your phone. Try again shortly.", 503, {
          code: "roster_unavailable",
        });
      }
      return { ok: true };
    },
    { demo: () => ({ ok: true }) },
  );
}
