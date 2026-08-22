// src/app/api/caring-contacts/pathway-versions/route.ts
//
// Pathway version governance. GET lists the versions this actor may read; POST moves one through
// review, dual approval, publication, or retirement.
//
// Deliberately no "save a draft" method here. `savePathwayVersion` takes a whole `PathwayVersion`,
// including its state and its recorded approvals, and accepting that shape from the wire would let
// a caller post a version that arrives already approved. Authoring belongs behind a narrower
// surface than this one; the governance transitions, which the domain checks one at a time, do not.
import { z } from "zod";

import { auditableIdentifier, readHandler, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";
import { pathwayVersionId } from "@/lib/caring-contacts/ids";
import type { CaringContactAction } from "@/lib/caring-contacts/permissions";

export const runtime = "nodejs";

const COLLECTION = "all";

const transitionSchema = z
  .object({
    pathwayVersionId: auditableIdentifier,
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("submitForReview") }).strict(),
      z
        .object({
          type: z.literal("approve"),
          role: z.enum(["clinicalProgrammeLead", "livedExperienceRepresentative"]),
        })
        .strict(),
      z.object({ type: z.literal("publish") }).strict(),
      z.object({ type: z.literal("retire"), urgency: z.enum(["routine", "urgentSafety"]) }).strict(),
    ]),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

/** The same capability the store checks for each transition, resolved from the request's intent. */
function capabilityFor(body: z.infer<typeof transitionSchema>): CaringContactAction {
  switch (body.action.type) {
    case "submitForReview":
      return "authorPathwayVersion";
    case "approve":
      return "approvePathwayVersion";
    case "publish":
      return "publishPathwayVersion";
    case "retire":
      return "retirePathwayVersion";
  }
}

export const GET = readHandler({
  access: { kind: "view", objectType: "pathwayVersion", objectId: () => COLLECTION },
  read: async (store, actor) => store.listPathwayVersions({ actor }),
});

export const POST = writeHandler({
  schema: transitionSchema,
  action: capabilityFor,
  access: { objectType: "pathwayVersion", objectId: (body) => body.pathwayVersionId },
  write: async (store, actor, body) => {
    // `approve` and `publish` are attributed to the ACTING actor, never to an identifier supplied
    // by the caller: no single actor may both author and approve the same version, and that check
    // is worthless if the approver's identity can be chosen in the request body.
    const action =
      body.action.type === "approve"
        ? { type: "approve" as const, role: body.action.role, actorId: actor.id }
        : body.action.type === "publish"
          ? { type: "publish" as const, actorId: actor.id }
          : body.action;
    return store.transitionPathwayVersion(
      { pathwayVersionId: pathwayVersionId(body.pathwayVersionId), action },
      writeContextFor(actor, body.idempotencyKey),
    );
  },
});
