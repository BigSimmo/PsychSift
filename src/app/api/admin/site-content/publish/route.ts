import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import {
  createSiteContentEvidenceValidationBinding,
  createSiteContentRecoveryValidationBinding,
} from "@/lib/site-content/site-content-recovery-authority";
import { assertSiteContentSyncPlan } from "@/lib/site-content/site-content-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const adminSupabase = createAdminClient();
    await requireAuthenticatedUser(request, adminSupabase, { administrator: true });
    const userSupabase = await createSupabaseServerClient();
    if (!userSupabase) throw new AuthenticationError("Authenticated administrator session is required.");
    const body = await request.json();
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
    const projectRef = env.SUPABASE_PROJECT_REF;
    const secret = env.SITE_CONTENT_RECOVERY_VALIDATION_SECRET;
    const now = new Date();
    if (action === "provision-secret") {
      if (!secret) throw new Error("Site-content recovery authority is not configured.");
      const configuration = {
        secret,
        expectedCurrentDigest: (body as { expectedCurrentDigest?: unknown }).expectedCurrentDigest ?? null,
        rotationReason: (body as { rotationReason?: unknown }).rotationReason ?? null,
      };
      const { data, error } = await adminSupabase.rpc("provision_site_content_validation_secret", {
        p_configuration: configuration,
      });
      if (error) throw new Error("Site-content validation-secret provisioning failed.");
      return Response.json(data, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }
    let mutation:
      | { rpc: "adopt_site_content_baseline"; args: { p_adoption: unknown; p_validation_binding: unknown } }
      | { rpc: "begin_site_content_candidate_release"; args: { p_plan: unknown; p_validation_binding: unknown } }
      | { rpc: "publish_site_content_record"; args: { p_record: unknown } }
      | {
          rpc: "verify_site_content_candidate_release";
          args: { p_verification: unknown; p_validation_binding: unknown };
        }
      | { rpc: "activate_site_content_release"; args: Record<string, unknown> }
      | { rpc: "rollback_site_content_release"; args: Record<string, unknown> };
    if (
      action === "adopt" ||
      action === "begin" ||
      action === "verify" ||
      action === "activate" ||
      action === "rollback"
    ) {
      if (!projectRef || !secret) throw new Error("Site-content recovery authority is not configured.");
    }
    if (action === "adopt") {
      const adoption = {
        plan: (body as { plan?: unknown }).plan,
        records: (body as { records?: unknown }).records,
        verificationEvidence: (body as { verificationEvidence?: unknown }).verificationEvidence,
      };
      const plan = assertSiteContentSyncPlan(adoption.plan);
      if (plan.projectRef !== projectRef) throw new Error("Adoption target project mismatch.");
      const binding = createSiteContentEvidenceValidationBinding("adopt", plan.recoveryEvidence, adoption, {
        expectedProjectRef: projectRef!,
        now,
        secret: secret!,
      });
      mutation = { rpc: "adopt_site_content_baseline", args: { p_adoption: adoption, p_validation_binding: binding } };
    } else if (action === "begin") {
      const plan = assertSiteContentSyncPlan((body as { plan?: unknown }).plan);
      if (plan.mode !== "write" || plan.projectRef !== projectRef)
        throw new Error("Canonical write plan target mismatch.");
      const binding = createSiteContentEvidenceValidationBinding("begin", plan.recoveryEvidence, plan, {
        expectedProjectRef: projectRef!,
        now,
        secret: secret!,
      });
      mutation = { rpc: "begin_site_content_candidate_release", args: { p_plan: plan, p_validation_binding: binding } };
    } else if (action === "verify") {
      const verification = {
        plan: (body as { plan?: unknown }).plan,
        verificationEvidence: (body as { verificationEvidence?: unknown }).verificationEvidence,
      };
      const plan = assertSiteContentSyncPlan(verification.plan);
      if (plan.projectRef !== projectRef) throw new Error("Verification target mismatch.");
      const binding = createSiteContentEvidenceValidationBinding("verify", plan.recoveryEvidence, verification, {
        expectedProjectRef: projectRef!,
        now,
        secret: secret!,
      });
      mutation = {
        rpc: "verify_site_content_candidate_release",
        args: { p_verification: verification, p_validation_binding: binding },
      };
    } else if (action === "activate" || action === "rollback") {
      const releaseId = (body as { releaseId?: unknown }).releaseId;
      const { data: context, error: contextError } = await userSupabase.rpc(
        "read_site_content_release_activation_context",
        { p_release_id: releaseId as string },
      );
      if (contextError || !context || typeof context !== "object")
        throw new Error("Activation context is unavailable.");
      const evidence = (body as { evidence?: unknown }).evidence;
      const activation = (body as { activation?: unknown }).activation;
      const expected = context as never;
      if (action === "activate") {
        const binding = createSiteContentRecoveryValidationBinding(
          { action, evidence, activation, expected },
          { expectedProjectRef: projectRef!, now, secret: secret! },
        );
        mutation = {
          rpc: "activate_site_content_release",
          args: {
            p_release_id: releaseId,
            p_expected_release_digest: (context as { resource?: { releaseDigest?: string } }).resource?.releaseDigest,
            p_recovery_evidence: evidence,
            p_activation_receipt: activation,
            p_validation_binding: binding,
          },
        };
      } else {
        const rollback = (body as { rollback?: unknown }).rollback;
        const binding = createSiteContentRecoveryValidationBinding(
          { action, evidence, activation, rollback, expected },
          { expectedProjectRef: projectRef!, now, secret: secret! },
        );
        mutation = {
          rpc: "rollback_site_content_release",
          args: {
            p_failed_release_id: releaseId,
            p_activation_receipt: activation,
            p_rollback_receipt: rollback,
            p_recovery_evidence: evidence,
            p_validation_binding: binding,
          },
        };
      }
    } else {
      const record = action === "publish" ? (body as { record?: unknown }).record : body;
      mutation = { rpc: "publish_site_content_record", args: { p_record: record } };
    }
    const { data, error } = await userSupabase.rpc(mutation.rpc, mutation.args as never);
    if (error) throw new Error("Site-content publication failed.");
    return Response.json(data, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse(error);
    return jsonError(error);
  }
}
