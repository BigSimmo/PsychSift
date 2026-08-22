// src/app/api/caring-contacts/assignments/[planId]/route.ts
//
// Who is carrying one plan. GET reads the assignment; POST claims, reassigns, or covers it.
// An assignment is a fact about a plan, so its read is recorded against that plan.
//
// Next 16: `params` is a Promise and must be awaited.
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
import { actorId, planId } from "@/lib/caring-contacts/ids";
import type { CaringContactAction } from "@/lib/caring-contacts/permissions";
import { isAwstCalendarDay } from "@/lib/caring-contacts/schedule";

export const runtime = "nodejs";

type AssignmentRouteContext = { params: Promise<{ planId: string }> };

/**
 * A coverage window end, held to the SAME predicate the domain uses.
 *
 * `../assignment` refuses a window that is not an AWST calendar day, by name
 * (`coverage-window-not-calendar-day`), and the Postgres schema carries a matching regular
 * expression. This boundary accepted any non-empty string, so the store's refusal was the only
 * thing between nonsense and the database check -- and a boundary that lets a malformed request
 * through to be refused deeper is a boundary that is not doing its job. One rule, one source:
 * `isAwstCalendarDay` is imported rather than the pattern being restated here.
 */
const calendarDay = z.string().refine(isAwstCalendarDay, { message: "not-an-awst-calendar-day" });

const assignmentSchema = z
  .object({
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("claim"), actorId: auditableIdentifier }).strict(),
      z.object({ type: z.literal("reassign"), toActorId: auditableIdentifier, reason: z.string().min(1) }).strict(),
      z
        .object({
          type: z.literal("startCoverage"),
          actorId: auditableIdentifier,
          from: calendarDay,
          until: calendarDay,
        })
        .strict(),
      z.object({ type: z.literal("endCoverage") }).strict(),
    ]),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

/** Exactly what the store checks: claim, reassign, and either coverage move under coverCoordinator. */
function capabilityFor(body: z.infer<typeof assignmentSchema>): CaringContactAction {
  if (body.action.type === "claim") return "claimPlan";
  if (body.action.type === "reassign") return "reassignPlan";
  return "coverCoordinator";
}

export async function GET(request: NextRequest, context: AssignmentRouteContext): Promise<Response> {
  const { planId: id } = await context.params;
  // A path segment is caller input like any other. It becomes this read's audit `objectId`, so it
  // is held to the audit trail's id grammar before it goes anywhere near the trail.
  if (!isAccessObjectIdShape(id)) return invalidRequestResponse();
  return readHandler({
    access: { kind: "view", objectType: "plan", objectId: () => id },
    read: async (store, actor) => store.getAssignment(planId(id), { actor }),
  })(request);
}

export async function POST(request: NextRequest, context: AssignmentRouteContext): Promise<Response> {
  const { planId: id } = await context.params;
  if (!isAccessObjectIdShape(id)) return invalidRequestResponse();
  return writeHandler({
    schema: assignmentSchema,
    action: capabilityFor,
    access: { objectType: "plan", objectId: () => id },
    write: async (store, actor, body) => {
      const action =
        body.action.type === "claim"
          ? { type: "claim" as const, actorId: actorId(body.action.actorId) }
          : body.action.type === "reassign"
            ? { type: "reassign" as const, toActorId: actorId(body.action.toActorId), reason: body.action.reason }
            : body.action.type === "startCoverage"
              ? {
                  type: "startCoverage" as const,
                  actorId: actorId(body.action.actorId),
                  from: body.action.from,
                  until: body.action.until,
                }
              : { type: "endCoverage" as const };
      return store.applyAssignment({ planId: planId(id), action }, writeContextFor(actor, body.idempotencyKey));
    },
  })(request);
}
