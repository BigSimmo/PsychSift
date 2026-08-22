// src/app/api/caring-contacts/plans/route.ts
//
// The plan collection. GET lists the plans this actor's team may see; POST creates one.
//
// Neither method records an access event of its own -- `readHandler` does that, on every call, for
// every read. A route that could forget the call is exactly the failure this boundary removes.
import { z } from "zod";

import { auditableIdentifier, readHandler, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";
import { pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";

export const runtime = "nodejs";

/** A collection read names no single object; the actor's own team scopes what it returns. */
const COLLECTION = "all";

const isoInstant = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: "must be an ISO-8601 instant" });

// The patient's name and mobile number travel in the BODY, never in the URL -- a query string is
// logged by every proxy between here and the browser.
const createPlanSchema = z
  .object({
    planId: auditableIdentifier,
    referralId: auditableIdentifier,
    patientId: auditableIdentifier,
    pathwayVersionId: auditableIdentifier,
    dischargeAt: isoInstant,
    sendingPreference: z.enum(["morning", "afternoon", "earlyEvening"]),
    firstContactDate: z.string().min(1).optional(),
    firstContactReason: z.string().min(1).optional(),
    patientDetail: z
      .object({
        patientName: z.string().min(1),
        patientMobileNumber: z.string().min(1),
        patientIdentifiers: z.array(z.string().min(1)),
        culturalIdentity: z.string().min(1).nullable(),
      })
      .strict(),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

export const GET = readHandler({
  access: { kind: "search", objectType: "plan", objectId: () => COLLECTION },
  read: async (store, actor) => store.listPlans({ actor }),
});

export const POST = writeHandler({
  schema: createPlanSchema,
  action: "claimPlan",
  access: { objectType: "plan", objectId: (body) => body.planId },
  write: async (store, actor, body) =>
    store.createPlan(
      {
        planId: planId(body.planId),
        referralId: referralId(body.referralId),
        patientId: patientId(body.patientId),
        pathwayVersionId: pathwayVersionId(body.pathwayVersionId),
        dischargeAt: new Date(body.dischargeAt),
        sendingPreference: body.sendingPreference,
        firstContactDate: body.firstContactDate,
        firstContactReason: body.firstContactReason,
        patientDetail: body.patientDetail,
      },
      writeContextFor(actor, body.idempotencyKey),
    ),
});
