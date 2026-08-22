// src/app/api/caring-contacts/dispatches/route.ts
//
// Reconciliation: what the dispatcher expected against what the provider reported. GET lists the
// attempts in a window; POST records how one discrepancy was resolved.
//
// The window bounds are ISO instants, so they are safe in the query string -- no patient data ever
// reaches a URL here. A dispatch attempt is a contact-level record, so the read is recorded
// against `contact`.
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  auditableIdentifier,
  invalidRequestResponse,
  readHandler,
  writeContextFor,
  writeHandler,
} from "@/lib/caring-contacts-server/handler";
import { contactId } from "@/lib/caring-contacts/ids";

export const runtime = "nodejs";

const COLLECTION = "all";

const windowSchema = z
  .object({
    from: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())),
    to: z.string().refine((value) => !Number.isNaN(new Date(value).getTime())),
  })
  .strict();

const resolveSchema = z
  .object({
    contactId: auditableIdentifier,
    attempt: z.number().int().positive(),
    resolution: z.enum(["confirmedDelivered", "confirmedNotDelivered", "unresolvedNoResend"]),
    /** The domain requires a non-blank note for a resolution; a blank one is refused by name. */
    note: z.string().min(1),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = windowSchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
  });
  // Refused before any access event is recorded, and intended: a window that cannot be read is
  // not a read of anything, so there is nothing to record an access to.
  if (!parsed.success) return invalidRequestResponse();
  const { from, to } = parsed.data;

  return readHandler({
    access: { kind: "search", objectType: "contact", objectId: () => COLLECTION },
    read: async (store, actor) => store.listDispatches({ fromIso: from, toIso: to }, { actor }),
  })(request);
}

export const POST = writeHandler({
  schema: resolveSchema,
  action: "reconcileProviderDispatch",
  access: { objectType: "contact", objectId: (body) => body.contactId },
  write: async (store, actor, body) =>
    store.resolveDispatchDiscrepancy(
      {
        contactId: contactId(body.contactId),
        attempt: body.attempt,
        resolution: body.resolution,
        note: body.note,
      },
      writeContextFor(actor, body.idempotencyKey),
    ),
});
