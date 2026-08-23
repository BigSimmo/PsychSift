import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import {
  approvedPublicationManifestV2Documents,
  assertPublicationApplyConfirmation,
  parsePublicationCommandArgs,
  parsePublicationManifest,
  publicationManifestDigest,
  publicationManifestV2StateDigest,
} from "@/lib/publication-manifest";
import type { Database, Json } from "@/lib/supabase/database.types";

loadEnvConfig(process.cwd());

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function main() {
  const args = parsePublicationCommandArgs(process.argv.slice(2));
  const raw = await readFile(args.manifestPath, "utf8");
  const manifest = parsePublicationManifest(raw);
  const digest = publicationManifestDigest(raw);
  const supabase = await loadAdminClient();
  const ids = manifest.documents.map((document) => document.documentId);

  const { data: documents, error: documentError } = await supabase
    .from("documents")
    .select("id, owner_id, status, title, metadata, index_generation_id")
    .in("id", ids);
  if (documentError) throw new Error(documentError.message);

  const documentsById = new Map((documents ?? []).map((document) => [document.id, document]));
  const validationErrors: string[] = [];
  const metadataRecord = (value: Json): Record<string, Json | undefined> =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  for (const entry of manifest.documents) {
    const document = documentsById.get(entry.documentId);
    if (!document) validationErrors.push(`${entry.documentId}: not found`);
    else if (document.owner_id !== entry.expectedOwnerId) validationErrors.push(`${entry.documentId}: owner changed`);
    else if (document.status !== "indexed") validationErrors.push(`${entry.documentId}: status is ${document.status}`);
    else {
      const { data: currentStateDigest, error: digestError } = await supabase.rpc("document_publication_state_digest", {
        p_document_id: entry.documentId,
        p_expected_owner_id: entry.expectedOwnerId,
      });
      if (digestError) throw new Error(digestError.message);
      if (currentStateDigest !== entry.expectedStateDigest) {
        validationErrors.push(`${entry.documentId}: reviewed content/state digest changed`);
      }
    }
  }
  if (manifest.version === 2) {
    for (const entry of manifest.documents) {
      const document = documentsById.get(entry.documentId);
      if (!document) continue;
      const metadata = metadataRecord(document.metadata);
      if (document.index_generation_id !== entry.expectedIndexGenerationId) {
        validationErrors.push(`${entry.documentId}: committed index generation changed`);
      }
      if (metadata.corpus_scope !== "australian_public") {
        validationErrors.push(`${entry.documentId}: corpus scope is not australian_public`);
      }
      if (metadata.source_catalogue_key !== entry.sourceCatalogueKey) {
        validationErrors.push(`${entry.documentId}: catalogue key changed`);
      }
      if (metadata.source_policy_version !== manifest.sourcePolicyVersion) {
        validationErrors.push(`${entry.documentId}: source policy version changed`);
      }
      if (metadata.content_mode !== "indexed_content") {
        validationErrors.push(`${entry.documentId}: content mode is not indexed_content`);
      }
      if (metadata.licence_policy !== "public_index_permitted") {
        validationErrors.push(`${entry.documentId}: licence does not permit public indexing`);
      }
      if (metadata.document_status !== "current") {
        validationErrors.push(`${entry.documentId}: source is not current`);
      }
      if (metadata.change_state === "withdrawn") {
        validationErrors.push(`${entry.documentId}: source is withdrawn`);
      }
    }
  }
  if (validationErrors.length > 0) {
    throw new Error(`Publication manifest validation failed:\n${validationErrors.join("\n")}`);
  }

  const decisionCounts = Object.fromEntries(
    ["approved", "keep_private", "quarantine"].map((decision) => [
      decision,
      manifest.documents.filter((document) => document.decision === decision).length,
    ]),
  );
  console.log(`[public-documents:promote] manifest SHA-256: ${digest}`);
  console.log(`[public-documents:promote] explicit document count: ${manifest.documents.length}`);
  console.log(`[public-documents:promote] decisions: ${JSON.stringify(decisionCounts)}`);

  if (!args.apply) {
    console.log("[public-documents:promote] dry run only; no approvals or document ownership were changed.");
    console.log(
      `[public-documents:promote] apply with --expected-count ${manifest.documents.length} --confirm-sha256 ${digest} --apply`,
    );
    return;
  }

  assertPublicationApplyConfirmation({
    manifest,
    digest,
    expectedCount: args.expectedCount,
    confirmSha256: args.confirmSha256,
  });

  const { data: existingApprovals, error: existingApprovalError } = await supabase
    .from("document_publication_approvals")
    .select(
      "document_id, expected_prior_owner_id, decision, manifest_digest, reviewed_state_digest, source_catalogue_key, source_policy_version, reviewed_index_generation_id",
    )
    .eq("manifest_digest", digest)
    .in("document_id", ids);
  if (existingApprovalError) throw new Error(existingApprovalError.message);
  type PublicationApprovalInsert = Database["public"]["Tables"]["document_publication_approvals"]["Insert"];
  const approvals: PublicationApprovalInsert[] =
    manifest.version === 2
      ? manifest.documents
          .filter(
            (document) =>
              !(existingApprovals ?? []).some(
                (approval) =>
                  approval.document_id === document.documentId &&
                  approval.expected_prior_owner_id === document.expectedOwnerId &&
                  approval.decision === document.decision &&
                  approval.manifest_digest === digest &&
                  approval.reviewed_state_digest === document.expectedStateDigest &&
                  approval.source_catalogue_key === document.sourceCatalogueKey &&
                  approval.source_policy_version === manifest.sourcePolicyVersion &&
                  approval.reviewed_index_generation_id === document.expectedIndexGenerationId,
              ),
          )
          .map((document) => ({
            document_id: document.documentId,
            expected_prior_owner_id: document.expectedOwnerId,
            approving_operator_id: manifest.approvingOperatorId,
            decision: document.decision,
            reason: manifest.reason,
            evidence_references: manifest.evidenceReferences,
            manifest_digest: digest,
            reviewed_state_digest: document.expectedStateDigest,
            source_catalogue_key: document.sourceCatalogueKey,
            source_policy_version: manifest.sourcePolicyVersion,
            reviewed_index_generation_id: document.expectedIndexGenerationId,
          }))
      : manifest.documents
          .filter(
            (document) =>
              !(existingApprovals ?? []).some(
                (approval) =>
                  approval.document_id === document.documentId &&
                  approval.expected_prior_owner_id === document.expectedOwnerId &&
                  approval.decision === document.decision &&
                  approval.manifest_digest === digest &&
                  approval.reviewed_state_digest === document.expectedStateDigest,
              ),
          )
          .map((document) => ({
            document_id: document.documentId,
            expected_prior_owner_id: document.expectedOwnerId,
            approving_operator_id: manifest.approvingOperatorId,
            decision: document.decision,
            reason: manifest.reason,
            evidence_references: manifest.evidenceReferences,
            manifest_digest: digest,
            reviewed_state_digest: document.expectedStateDigest,
          }));
  if (approvals.length > 0) {
    const { error: approvalError } = await supabase.from("document_publication_approvals").insert(approvals);
    if (approvalError) throw new Error(approvalError.message);
  }

  const approvedDocuments = manifest.documents
    .filter((document) => document.decision === "approved")
    .map((document) => ({
      document_id: document.documentId,
      expected_owner_id: document.expectedOwnerId,
      expected_state_digest: document.expectedStateDigest,
    }));
  if (approvedDocuments.length === 0) {
    console.log("[public-documents:promote] decisions recorded; no documents were approved for publication.");
    return;
  }

  const activation =
    manifest.version === 2
      ? await supabase.rpc("activate_approved_public_documents", {
          p_manifest: manifest as Json,
          p_expected_state_digest: publicationManifestV2StateDigest(manifest),
          p_expected_generation_ids: approvedPublicationManifestV2Documents(manifest).map(
            (document) => document.expectedIndexGenerationId,
          ),
        })
      : await supabase.rpc("publish_approved_documents", {
          p_documents: approvedDocuments,
          p_manifest_digest: digest,
          p_expected_count: approvedDocuments.length,
        });
  const { data: result, error: publishError } = activation;
  if (publishError) throw new Error(publishError.message);
  console.log(`[public-documents:promote] result: ${JSON.stringify(result)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
