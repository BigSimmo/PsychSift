import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import { withTeachingApi } from "@/lib/teaching/api";
import { DurableEpaMagicLinkRepository } from "@/lib/teaching/assessments/magic-link-repository";

export const runtime = "nodejs";

/** Cancels one of the signed-in doctor's own waiting supervisor links (#MAAXAX). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTeachingApi(request, async (client, ownerId) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw new PublicApiError("That supervisor link was not found.", 404, { code: "magic_link_not_found" });
    }
    const revoked = await new DurableEpaMagicLinkRepository(client).revoke(ownerId, id);
    if (!revoked) {
      throw new PublicApiError("That link was not found, or has already been used, cancelled or expired.", 404, {
        code: "magic_link_not_found",
      });
    }
    return { ok: true };
  });
}
