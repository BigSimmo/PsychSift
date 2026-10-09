import "server-only";
import { PublicApiError } from "@/lib/http";
import { cmeEvidenceSchema } from "@/lib/cme/evidence-model";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";

type Client = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
type EvidenceRow = Database["public"]["Tables"]["cme_evidence"]["Row"];

/**
 * Deletes a stored evidence object, or queues its deletion if storage does not
 * answer. Returns false only when neither worked.
 */
async function deleteOrQueueCmeEvidenceObject(client: Client, ownerId: string, storagePath: string) {
  let removed = false;
  try {
    removed = !(await client.storage.from("cme-private-evidence").remove([storagePath])).error;
  } catch {
    /* queue compensation below */
  }
  if (removed) return true;
  const { error } = await client.from("storage_cleanup_jobs").insert({
    owner_id: ownerId,
    document_bucket: "cme-private-evidence",
    document_paths: [storagePath],
    image_bucket: "cme-private-evidence",
    image_paths: [],
    status: "pending",
  });
  return !error;
}

/** Only for a newly uploaded object proven to have no committed metadata. */
export async function cleanUnlinkedCmeEvidence(client: Client, ownerId: string, storagePath: string) {
  if (!(await deleteOrQueueCmeEvidenceObject(client, ownerId, storagePath)))
    throw new PublicApiError("Evidence was not attached. An unlinked upload needs administrator cleanup.", 503);
}

export async function fetchCmeEvidenceCounts(
  client: Client,
  ownerId: string,
  year: number,
): Promise<Record<string, number>> {
  const { data, error } = await client.rpc("cme_evidence_counts", { p_owner_id: ownerId, p_year: year });
  if (error) throw new PublicApiError("Evidence counts could not be loaded. Try again.", 503);
  return z.record(z.string(), z.number().int().nonnegative()).parse(data);
}

/**
 * Entry ids that hold at least one active (not removed) certificate. Other evidence kinds
 * (receipt, assessment, other) do not satisfy "Certificates to add".
 */
export async function fetchCmeCertificateEntryIds(client: Client, ownerId: string): Promise<ReadonlySet<string>> {
  const { data, error } = await client
    .from("cme_evidence")
    .select("entry_id")
    .eq("owner_id", ownerId)
    .eq("kind", "certificate")
    .is("removed_at", null);
  if (error) throw new PublicApiError("Evidence counts could not be loaded. Try again.", 503);
  return new Set((data ?? []).map((row) => row.entry_id));
}

export function evidenceFromRow(row: EvidenceRow) {
  return cmeEvidenceSchema.parse({
    id: row.id,
    entryId: row.entry_id,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    kind: row.kind,
    uploadedAt: row.uploaded_at,
    removedAt: row.removed_at ?? null,
    removalReason: row.removal_reason ?? null,
  });
}

/**
 * Removes a file at its owner's request. The database records when and why
 * (and blanks the stored file name, which may itself carry an identifier);
 * the stored object is then deleted, or queued for cleanup if storage does
 * not answer. Allowed in a closed year and on an archived entry: removal
 * exists for privacy, not bookkeeping.
 */
export async function removeCmeEvidence(
  client: Client,
  ownerId: string,
  entryId: string,
  evidenceId: string,
  reason: string,
) {
  await assertEvidenceEntry(client, ownerId, entryId);
  const { data: existing, error: lookupError } = await client
    .from("cme_evidence")
    .select("id,storage_path,removed_at")
    .eq("owner_id", ownerId)
    .eq("entry_id", entryId)
    .eq("id", evidenceId)
    .maybeSingle();
  if (lookupError) throw new PublicApiError("Evidence could not be loaded. Try again.", 503);
  if (!existing || existing.removed_at) throw new PublicApiError("Evidence not found.", 404);
  const { data, error } = await client.rpc("cme_remove_evidence", {
    p_owner_id: ownerId,
    p_evidence_id: evidenceId,
    p_reason: reason,
  });
  if (error) {
    if (error.message.includes("cme_evidence_not_found")) throw new PublicApiError("Evidence not found.", 404);
    if (error.message.includes("cme_evidence_removal_reason_invalid"))
      throw new PublicApiError("Say why the file is being removed (3 to 500 characters).", 400);
    throw new PublicApiError("The file could not be removed. Try again.", 503);
  }
  // The record of removal is committed; the stored object goes next, or is
  // queued for cleanup if storage does not answer.
  if (!(await deleteOrQueueCmeEvidenceObject(client, ownerId, existing.storage_path)))
    throw new PublicApiError(
      "The file was removed from this activity, but its stored copy still needs deleting by an administrator.",
      503,
    );
  return evidenceFromRow(data as EvidenceRow);
}

export async function assertEvidenceEntry(client: Client, ownerId: string, entryId: string, writable = false) {
  const { data: entry, error } = await client
    .from("cme_entries")
    .select("id,year_id,archived_at")
    .eq("owner_id", ownerId)
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw new PublicApiError("Your activity could not be checked. Try again.", 503);
  if (!entry) throw new PublicApiError("Activity not found.", 404);
  if (writable) {
    const { data: year, error: yearError } = await client
      .from("cme_years")
      .select("closed_at")
      .eq("owner_id", ownerId)
      .eq("id", entry.year_id)
      .maybeSingle();
    if (yearError || !year) throw new PublicApiError("Your activity year could not be checked.", 503);
    if (entry.archived_at || year.closed_at)
      throw new PublicApiError("Restore the activity in an open year before adding evidence.", 409);
  }
  return entry;
}

export async function listCmeEvidence(client: Client, ownerId: string, entryId: string) {
  await assertEvidenceEntry(client, ownerId, entryId);
  const { data, error } = await client
    .from("cme_evidence")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("entry_id", entryId)
    .order("uploaded_at");
  if (error) throw new PublicApiError("Evidence could not be loaded. Try again.", 503);
  return (data ?? []).map(evidenceFromRow);
}
