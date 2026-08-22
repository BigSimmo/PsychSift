// src/app/api/caring-contacts/notification-preferences/route.ts
//
// The acting actor's own alert opt-ins. Opt-in is additive and explicit: a new user is opted in to
// nothing, and this route never assumes otherwise.
//
// Reading your own settings is an administrative access rather than a patient view, but it is
// still a read crossing this boundary, so it is recorded like every other one. The audit event's
// `actorId` already names whose record it was, so the object id records only which kind it was.
import { z } from "zod";

import { auditableIdentifier, readHandler, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";

export const runtime = "nodejs";

const OBJECT_ID = "notificationPreferences";

const preferencesSchema = z
  .object({
    optedIn: z.array(
      z.enum([
        "unclaimedWorkEscalation",
        "permanentDeliveryFailure",
        "serviceSafetyStop",
        "exceptionBacklog",
        "pathwayRetired",
      ]),
    ),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

export const GET = readHandler({
  access: { kind: "administrative", objectType: "notificationPreferences", objectId: () => OBJECT_ID },
  read: async (store, actor) => store.getNotificationPreferences({ actor }),
});

export const POST = writeHandler({
  schema: preferencesSchema,
  action: "manageNotificationPreferences",
  access: { objectType: "notificationPreferences", objectId: () => OBJECT_ID },
  write: async (store, actor, body) =>
    // The preferences belong to the acting actor and to nobody else; the store refuses a save
    // whose `actorId` is not the writer's, so the identifier comes from the resolved actor rather
    // than from the body.
    store.saveNotificationPreferences(
      { actorId: actor.id, optedIn: body.optedIn },
      writeContextFor(actor, body.idempotencyKey),
    ),
});
