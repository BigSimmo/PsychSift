// src/app/api/caring-contacts/training/route.ts
//
// The acting actor's own training record. GET reads it; POST records one competency.
//
// Training is a per-person record, never a patient one, so the read is an administrative access.
// It is still recorded: "every search, view, decision, mutation, write-back and administrative
// access" is the whole of the trail's contract, not the patient-facing half of it.
import { z } from "zod";

import { auditableIdentifier, readHandler, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";

export const runtime = "nodejs";

const OBJECT_ID = "trainingRecord";

const competencySchema = z
  .object({
    competency: z.enum([
      "identityReview",
      "activation",
      "withdrawal",
      "deliveryFailure",
      "readmission",
      "downtime",
      "incidentHandling",
    ]),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

export const GET = readHandler({
  access: { kind: "administrative", objectType: "trainingRecord", objectId: () => OBJECT_ID },
  read: async (store, actor) => store.getTrainingRecord({ actor }),
});

export const POST = writeHandler({
  schema: competencySchema,
  action: "enterTrainingMode",
  access: { objectType: "trainingRecord", objectId: () => OBJECT_ID },
  write: async (store, actor, body) =>
    store.recordTrainingCompetency({ competency: body.competency }, writeContextFor(actor, body.idempotencyKey)),
});
