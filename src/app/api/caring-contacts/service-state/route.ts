// src/app/api/caring-contacts/service-state/route.ts
//
// The service-wide safety stop. GET reports it; POST raises one or records a restart approval.
//
// This is the designated narrowing boundary for Ruling 43. `getServiceState` returns the whole
// incident record, including the responder's free-text `note`, to any actor of any team -- because
// the store must not gate it, or a team with no part in the incident would never learn that
// sending is halted. `narrowServiceStateForActor` releases the stopped fact, the reason category
// and the timing to everyone, and the note only to an actor who may see incident detail.
import { z } from "zod";

import { auditableIdentifier, readHandler, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";
import {
  narrowServiceStateForActor,
  viewRestartOutcome,
  type ServiceRestartView,
  type ServiceStateView,
} from "@/lib/caring-contacts-server/service-state-view";
import type { CaringContactAction } from "@/lib/caring-contacts/permissions";

export const runtime = "nodejs";

/** One record for the whole service, never one per team -- so the object it names is the service. */
const SERVICE = "service";

const serviceStateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stop"),
      reason: z.enum([
        "wrong-recipient",
        "duplicate-send",
        "unauthorised-content",
        "privacy-or-security-incident",
        "audit-integrity-loss",
      ]),
      /** Free text about the incident. It is stored, and this route narrows who may read it back. */
      note: z.string().min(1),
      idempotencyKey: auditableIdentifier,
    })
    .strict(),
  z
    .object({
      type: z.literal("approveRestart"),
      role: z.enum(["incidentLead", "privacySecurityOwner", "clinicalProgrammeLead"]),
      idempotencyKey: auditableIdentifier,
    })
    .strict(),
]);

function capabilityFor(body: z.infer<typeof serviceStateSchema>): CaringContactAction {
  return body.type === "stop" ? "triggerServiceSafetyStop" : "approveServiceRestart";
}

export const GET = readHandler({
  access: { kind: "administrative", objectType: "serviceState", objectId: () => SERVICE },
  read: async (store, actor) => narrowServiceStateForActor(await store.getServiceState({ actor }), actor),
});

/**
 * The two branches now reach their reply by different routes, and the difference is the point.
 *
 * `stopService` still hands back the whole `ServiceState`, so its reply goes through the SAME
 * narrowing the GET does. `writeHandler` checks the action against the ACTOR'S OWN team, while
 * `narrowServiceStateForActor` checks `viewPatientRecord` against `state.reportedByTeamId` -- whose
 * incident the note describes -- so the capability that let the write happen and the capability
 * that releases the note stay separate questions. For a stop those are the same team by
 * construction (the raiser's team becomes the reporting team), but the narrowing is kept rather
 * than assumed away.
 *
 * `approveServiceRestart` no longer hands back the record at all (Ruling 65). Restart approvals are
 * service-wide, so a second team's `teamLead` legitimately approves an incident whose note they may
 * not read -- and the first two approvals leave the service stopped, so the record it used to
 * return was note-bearing. Narrowing it HERE was not enough: every store persists a write's return
 * value as its idempotency replay result, under the approving team's own id, in a row scoped to
 * that team -- somewhere no API boundary can reach. The domain type is narrow now, so this reply
 * has nothing to withhold and `viewRestartOutcome` takes no actor.
 *
 * Neither reply is emptied. The approver still sees what their approval did: the stop still
 * standing, and their own approval among `restartApprovals`.
 */
export const POST = writeHandler<z.infer<typeof serviceStateSchema>, ServiceStateView | ServiceRestartView>({
  schema: serviceStateSchema,
  action: capabilityFor,
  access: { objectType: "serviceState", objectId: () => SERVICE },
  write: async (store, actor, body) => {
    if (body.type === "stop") {
      const stopped = await store.stopService(
        { reason: body.reason, note: body.note },
        writeContextFor(actor, body.idempotencyKey),
      );
      return stopped.ok ? { ok: true, value: narrowServiceStateForActor(stopped.value, actor) } : stopped;
    }
    const approved = await store.approveServiceRestart(
      { role: body.role },
      writeContextFor(actor, body.idempotencyKey),
    );
    return approved.ok ? { ok: true, value: viewRestartOutcome(approved.value) } : approved;
  },
});
