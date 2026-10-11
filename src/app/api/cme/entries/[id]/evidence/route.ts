import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeSubjectApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, PublicApiError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { acquireUploadAdmission } from "@/lib/upload-admission";
import {
  CME_EVIDENCE_BUCKET,
  CME_EVIDENCE_LIMIT,
  CME_EVIDENCE_MAX_BYTES,
  cmeEvidenceKindSchema,
} from "@/lib/cme/evidence-model";
import {
  assertEvidenceEntry,
  cleanUnlinkedCmeEvidence,
  evidenceFromRow,
  listCmeEvidence,
} from "@/lib/cme/evidence-repository";
import type { Database } from "@/lib/supabase/database.types";
import { readCmeEvidenceForm, validateCmeEvidenceFile } from "@/lib/cme/evidence-upload";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ id: string }> };

function evidenceError(error: unknown) {
  return error instanceof AuthenticationError
    ? unauthorizedResponse()
    : jsonError(error, error instanceof z.ZodError ? 400 : 500, { log: false });
}

export async function GET(request: Request, { params }: Context) {
  try {
    if (isDemoMode()) return NextResponse.json({ evidence: [], demoMode: true }, { headers: privateHeaders });
    const id = z.uuid().parse((await params).id);
    const client = createAdminClient();
    const user = await requireAuthenticatedUser(request, client);
    const rate = await consumeSubjectApiRateLimit({
      supabase: client,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (rate.limited) return rateLimitJsonResponse("Evidence requests are temporarily rate limited.", rate);
    const evidence = await listCmeEvidence(client, user.id, id);
    return NextResponse.json({ evidence }, { headers: privateHeaders });
  } catch (error) {
    return evidenceError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  let release: (() => void) | undefined;
  try {
    if (isDemoMode()) throw new PublicApiError("Sign in to attach evidence to your private record.", 400);
    const id = z.uuid().parse((await params).id);
    const client = createAdminClient();
    const user = await requireAuthenticatedUser(request, client);
    const rate = await consumeSubjectApiRateLimit({
      supabase: client,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (rate.limited) return rateLimitJsonResponse("Evidence uploads are temporarily rate limited.", rate);
    await assertEvidenceEntry(client, user.id, id, true);
    const admission = acquireUploadAdmission({
      bytes: CME_EVIDENCE_MAX_BYTES + 65536,
      maxConcurrent: 3,
      maxBytes: 33 * 1024 * 1024,
    });
    if (!admission.ok) throw new PublicApiError("Upload capacity is busy. Retry shortly.", 503);
    release = admission.release;
    const form = await readCmeEvidenceForm(request);
    const kind = cmeEvidenceKindSchema.parse(form.get("kind"));
    if (form.get("redactionConfirmed") !== "true" || form.get("previewConfirmed") !== "true") {
      throw new PublicApiError(
        "Preview the file and confirm that patient-identifying information has been removed.",
        400,
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new PublicApiError("Choose an evidence file.", 400);
    const bytes = await validateCmeEvidenceFile(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { data: existing, error: lookupError } = await client
      .from("cme_evidence")
      .select("*")
      .eq("owner_id", user.id)
      .eq("entry_id", id)
      .eq("sha256", sha256)
      .is("removed_at", null)
      .maybeSingle();
    if (lookupError) throw new PublicApiError("Evidence could not be checked. Try again.", 503);
    if (existing)
      return NextResponse.json({ evidence: evidenceFromRow(existing), duplicate: true }, { headers: privateHeaders });
    const { count, error: countError } = await client
      .from("cme_evidence")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("entry_id", id)
      .is("removed_at", null);
    if (countError) throw new PublicApiError("Evidence could not be checked. Try again.", 503);
    if ((count ?? 0) >= CME_EVIDENCE_LIMIT)
      throw new PublicApiError("This activity already has 20 evidence files.", 409);
    if (request.signal.aborted) throw new PublicApiError("Upload cancelled.", 499);
    const evidenceId = randomUUID();
    const storagePath = `${user.id}/${id}/${evidenceId}`;
    try {
      // Only the Storage transfer may outlast the default deadline.
      const upload = await createAdminClient({ timeoutMs: null })
        .storage.from(CME_EVIDENCE_BUCKET)
        .upload(storagePath, bytes, { contentType: file.type, cacheControl: "0", upsert: false });
      if (upload.error) throw new Error();
    } catch {
      await cleanUnlinkedCmeEvidence(client, user.id, storagePath);
      throw new PublicApiError("The file could not be uploaded. Your activity is unchanged.", 503);
    }
    const fileName = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) || "Evidence";
    let saved: Database["public"]["Tables"]["cme_evidence"]["Row"] | null = null;
    let saveError: { code?: string } | null = null;
    try {
      const persistence = await client
        .from("cme_evidence")
        .insert({
          id: evidenceId,
          owner_id: user.id,
          entry_id: id,
          file_name: fileName,
          content_type: file.type,
          byte_size: bytes.length,
          sha256,
          storage_path: storagePath,
          kind,
          redaction_confirmed: true,
          preview_confirmed: true,
        })
        .select("*")
        .single();
      saved = persistence.data;
      saveError = persistence.error;
    } catch {
      saveError = { code: "unknown" };
    }
    if (!saveError && saved)
      return NextResponse.json({ evidence: evidenceFromRow(saved) }, { status: 201, headers: privateHeaders });

    // A lost response may follow a committed insert. Reconcile before deleting any object.
    const { data: reconciled, error: reconcileError } = await client
      .from("cme_evidence")
      .select("*")
      .eq("owner_id", user.id)
      .eq("id", evidenceId)
      .maybeSingle();
    if (reconciled) return NextResponse.json({ evidence: evidenceFromRow(reconciled) }, { headers: privateHeaders });
    if (reconcileError)
      throw new PublicApiError("Upload status is uncertain. Refresh the evidence list before retrying.", 503);
    // A transport failure can arrive while the insert is still executing. An empty
    // read is not proof of rollback; compensate only a definitive PostgreSQL rejection.
    if (!saveError?.code || !/^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|P0001|42501)$/.test(saveError.code)) {
      throw new PublicApiError("Upload status is uncertain. Refresh the evidence list before retrying.", 503);
    }
    await cleanUnlinkedCmeEvidence(client, user.id, storagePath);
    if (saveError?.code === "23505") {
      const { data: duplicate } = await client
        .from("cme_evidence")
        .select("*")
        .eq("owner_id", user.id)
        .eq("entry_id", id)
        .eq("sha256", sha256)
        .is("removed_at", null)
        .maybeSingle();
      if (duplicate)
        return NextResponse.json(
          { evidence: evidenceFromRow(duplicate), duplicate: true },
          { headers: privateHeaders },
        );
    }
    throw new PublicApiError("Evidence was not attached. Refresh the activity and try again.", 409);
  } catch (error) {
    return evidenceError(error);
  } finally {
    release?.();
  }
}
