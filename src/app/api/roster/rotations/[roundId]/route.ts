import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { PublicApiError, publicErrorResponse } from "@/lib/http";
import { withRosterApi } from "@/lib/roster/team/api";
import {
  roundCommandSchema,
  rotationRuleToPublicError,
  ROTATIONS_NOT_LIVE_MESSAGE,
  runRoundCommand,
} from "@/lib/roster/rotations/repository";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/**
 * One action on one rotation round (POST). A doctor may save or withdraw only
 * their own preference; every other action needs the team's rotation
 * administrator (or the site administrator), checked on the server. The actor
 * is the session user only, and the body is strict.
 */

type Context = { params: Promise<{ roundId: string }> };

const roundIdSchema = z.string().uuid();

function notLive(): Response {
  return publicErrorResponse(ROTATIONS_NOT_LIVE_MESSAGE, 503, { code: "rotations_not_live" });
}

export async function POST(request: Request, context: Context) {
  if (isDemoMode()) return notLive();
  return withRosterApi(
    request,
    async (client, actorId) => {
      const roundId = roundIdSchema.safeParse((await context.params).roundId);
      if (!roundId.success) {
        throw new PublicApiError("That round is no longer here.", 404, { code: "rotations_not_found" });
      }
      const command = await parseJsonBody(request, roundCommandSchema, "Check the request and try again.");
      try {
        return await runRoundCommand(client, actorId, roundId.data, command);
      } catch (error) {
        throw rotationRuleToPublicError(error);
      }
    },
    { sample: notLive },
  );
}
