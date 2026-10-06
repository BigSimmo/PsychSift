import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, publicErrorResponse } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation/body";
import {
  publishSiteContentCommand,
  recordSiteContentReconciliationPlan,
} from "@/lib/site-content/site-content-publication";
import {
  assertSiteContentReconciliationInput,
  type SiteContentReconciliationInput,
} from "@/lib/site-content/site-content-reconciliation";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUserContext, unauthorizedResponse } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicationCommandSchema = z
  .object({
    action: z.enum(["publish", "retire"]),
    kind: z.enum(["service", "form", "medication", "differential", "presentation"]),
    sourceRowId: z.uuid(),
    expectedSourceVersion: z.string().trim().min(1).max(128),
    expectedChangeEpoch: z.string().regex(/^\d+$/),
    reconciliationPlanDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

const reconciliationPlanSchema = z.custom<SiteContentReconciliationInput>((value) => {
  try {
    assertSiteContentReconciliationInput(value);
    return true;
  } catch {
    return false;
  }
});

const reconciliationCommandSchema = z
  .object({
    action: z.literal("record_reconciliation"),
    plan: reconciliationPlanSchema,
  })
  .strict();

const commandSchema = z.discriminatedUnion("action", [publicationCommandSchema, reconciliationCommandSchema]);

export async function POST(request: Request) {
  try {
    const sourceSupabase = createAdminClient();
    const { publicationClient } = await requireAuthenticatedUserContext(request, sourceSupabase, {
      administrator: true,
    });
    let parsed: z.infer<typeof commandSchema>;
    try {
      parsed = await parseJsonBody(request, commandSchema);
    } catch {
      return publicErrorResponse("Invalid site-content publication command.", 400);
    }
    const result =
      parsed.action === "record_reconciliation"
        ? await recordSiteContentReconciliationPlan({
            publicationSupabase: publicationClient as never,
            plan: parsed.plan,
          })
        : await publishSiteContentCommand({
            sourceSupabase: sourceSupabase as never,
            publicationSupabase: publicationClient as never,
            command: parsed,
          });
    if (result.outcome === "conflict") {
      return publicErrorResponse("Site-content publication conflict or no-op.", 409);
    }
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
