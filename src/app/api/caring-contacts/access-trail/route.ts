// src/app/api/caring-contacts/access-trail/route.ts
//
// The access trail itself, which only the auditor may read.
//
// POST, not GET, and the filters travel in the body: a trail query is the one read whose filters
// could grow to carry free text, and a query string is logged by every proxy between here and the
// browser. Reading the trail is itself an access, so this read is recorded like any other -- an
// auditor's own views sit in the trail beside everybody else's.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auditableIdentifier, invalidRequestResponse, readHandler } from "@/lib/caring-contacts-server/handler";
import { actorId } from "@/lib/caring-contacts/ids";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const COLLECTION = "all";

/** Matches the dispatch route's instant validation before a query reaches either datastore. */
const isoInstant = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "invalid-iso-instant",
});

const querySchema = z
  .object({
    fromIso: isoInstant.optional(),
    toIso: isoInstant.optional(),
    actorId: auditableIdentifier.optional(),
    objectType: z
      .enum([
        "plan",
        "contact",
        "episode",
        "auditTrail",
        "report",
        "patientDirectory",
        "notificationPreferences",
        "trainingRecord",
        "pathwayVersion",
        "serviceState",
      ])
      .optional(),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();

export async function POST(request: NextRequest): Promise<Response> {
  // A body is required; send `{}` for the default window. Deliberately NOT
  // `parseJsonBodyOrDefault`: that answers an UNPARSEABLE body with the schema's defaults, which
  // here is the broadest window there is -- so an audit reviewer would be handed a different
  // question's answer and no sign that it happened. On this surface above all, a query that
  // cannot be read is refused rather than guessed at.
  //
  // The refusal is returned before any access event is recorded, and that is intended: no read
  // was performed, so there is no access to record. It is not the audit gap fix round 1 closed --
  // that one was a write the boundary DENIED, which is an attempt on a named object.
  let query: z.infer<typeof querySchema>;
  try {
    query = await parseJsonBody(request, querySchema);
  } catch {
    return invalidRequestResponse();
  }

  return readHandler({
    access: { kind: "search", objectType: "auditTrail", objectId: () => COLLECTION },
    // The body is already consumed above; the handler never reads it again.
    read: async (store, actor) =>
      store.listAccessTrail(
        {
          fromIso: query.fromIso,
          toIso: query.toIso,
          actorId: query.actorId === undefined ? undefined : actorId(query.actorId),
          objectType: query.objectType,
          limit: query.limit,
          offset: query.offset,
        },
        { actor },
      ),
  })(request);
}
