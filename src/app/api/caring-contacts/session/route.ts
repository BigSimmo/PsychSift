// src/app/api/caring-contacts/session/route.ts
//
// The demo role switcher's route handler. GET reports the currently resolved role; POST switches
// it. This is deliberately not a login: the body carries only a role name from DEMO_ROLES, never a
// credential, and an invalid role is a 400 -- the "fall back rather than fail" behaviour belongs
// to an unreadable COOKIE (see ../../../../lib/caring-contacts-server/session.ts), not to a bad
// request this endpoint was asked to act on.
import { cookies } from "next/headers";
import { z } from "zod";

import {
  CARING_CONTACTS_ROLE_COOKIE,
  DEMO_ROLES,
  demoActorForRole,
  isCaringContactsDemoEnabled,
  isDemoRole,
  resolveDemoActor,
} from "@/lib/caring-contacts-server/session";
import type { CaringContactRole } from "@/lib/caring-contacts/permissions";
import { jsonError, PublicApiError } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const setRoleSchema = z
  .object({ role: z.string() })
  .strict()
  .refine((body): body is { role: CaringContactRole } => isDemoRole(body.role), {
    message: "role must be one of the caring-contacts demo roles.",
    path: ["role"],
  });

/** The demo role switcher is not an authentication surface and is absent in production. */
function demoUnavailableResponse(): Response {
  return jsonError(new PublicApiError("Not found.", 404), 404, { log: false });
}

/** The role the switcher currently shows, resolved the same way every other reader does. */
export async function GET() {
  if (!isCaringContactsDemoEnabled()) return demoUnavailableResponse();
  const actor = await resolveDemoActor();
  return Response.json({ role: actor.roles[0], roles: DEMO_ROLES });
}

/** Switches the demo role. `{ role }` not in DEMO_ROLES is refused with 400. */
export async function POST(request: Request) {
  if (!isCaringContactsDemoEnabled()) return demoUnavailableResponse();
  try {
    const body = await parseJsonBody(request, setRoleSchema, "role must be one of the caring-contacts demo roles.");
    const actor = demoActorForRole(body.role);

    const cookieStore = await cookies();
    cookieStore.set(CARING_CONTACTS_ROLE_COOKIE, body.role, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });

    return Response.json({ role: actor.roles[0] });
  } catch (error) {
    // The EXPECTED error is the 400 `PublicApiError` setRoleSchema raises on a role the demo does
    // not offer. That is the caller's mistake, not a fault, so it must not write an error log the
    // way a genuine server fault does elsewhere in this repo.
    //
    // Anything else -- `cookies()` rejecting, `cookieStore.set` throwing -- is a real 500, and
    // suppressing its log made the only server fault this route can produce the one fault that
    // never reached the logs. So the suppression is scoped to the expected case rather than
    // applied to the whole `catch`.
    return jsonError(error, 500, { log: !(error instanceof PublicApiError) });
  }
}
