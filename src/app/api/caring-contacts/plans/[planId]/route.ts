// src/app/api/caring-contacts/plans/[planId]/route.ts
//
// One plan. GET reads it; POST moves it through its lifecycle.
//
// Next 16: `params` is a Promise and must be awaited (`context.params` became a promise in 15.0).
// The plan identifier is a synthetic id, never a name, so it is safe in the path -- everything
// that could carry patient text stays in the body.
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  auditableIdentifier,
  invalidRequestResponse,
  readHandler,
  writeContextFor,
  writeHandler,
} from "@/lib/caring-contacts-server/handler";
import { isAccessObjectIdShape } from "@/lib/caring-contacts/access-audit";
import { planId } from "@/lib/caring-contacts/ids";
import type { CaringContactAction } from "@/lib/caring-contacts/permissions";

export const runtime = "nodejs";

type PlanRouteContext = { params: Promise<{ planId: string }> };

const common = { expectedVersion: z.number().int().positive(), idempotencyKey: auditableIdentifier };

// A discriminated union rather than one shape with an optional `origin`: who asked for a
// withdrawal is a recorded fact, and defaulting an absent origin to "patient" would put words in
// a patient's mouth. A withdrawal must say where it came from; the domain then decides what a
// third-party request is allowed to do.
const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate"), ...common }).strict(),
  z.object({ action: z.literal("pause"), ...common }).strict(),
  z.object({ action: z.literal("resume"), ...common }).strict(),
  z
    .object({ action: z.literal("withdraw"), origin: z.enum(["patient", "clinician", "thirdParty"]), ...common })
    .strict(),
]);

/** The capability the store itself checks for each transition -- not a broader stand-in for them. */
const LIFECYCLE_ACTIONS: Readonly<Record<z.infer<typeof lifecycleSchema>["action"], CaringContactAction>> =
  Object.freeze({
    activate: "activatePlan",
    pause: "pausePlan",
    resume: "resumePlan",
    withdraw: "withdrawPlan",
  });

export async function GET(request: NextRequest, context: PlanRouteContext): Promise<Response> {
  const { planId: id } = await context.params;
  // A path segment is caller input like any other. It becomes this read's audit `objectId`, so it
  // is held to the audit trail's id grammar before it goes anywhere near the trail.
  if (!isAccessObjectIdShape(id)) return invalidRequestResponse();
  return readHandler({
    access: { kind: "view", objectType: "plan", objectId: () => id },
    read: async (store, actor) => store.getPlan(planId(id), { actor }),
  })(request);
}

export async function POST(request: NextRequest, context: PlanRouteContext): Promise<Response> {
  const { planId: id } = await context.params;
  if (!isAccessObjectIdShape(id)) return invalidRequestResponse();
  return writeHandler({
    schema: lifecycleSchema,
    action: (body) => LIFECYCLE_ACTIONS[body.action],
    access: { objectType: "plan", objectId: () => id },
    write: async (store, actor, body) => {
      const write = writeContextFor(actor, body.idempotencyKey);
      const input = { planId: planId(id), expectedVersion: body.expectedVersion };
      switch (body.action) {
        case "activate":
          return store.activatePlan(input, write);
        case "pause":
          return store.pausePlan(input, write);
        case "resume":
          return store.resumePlan(input, write);
        case "withdraw":
          return store.withdrawPlan({ ...input, origin: body.origin }, write);
      }
    },
  })(request);
}
