import { z } from "zod";
import { bytesDigest, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import {
  INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
  type ContentSha256,
  type DocumentIngressSafetyObservations,
  type ProviderEgressBinding,
  type ProviderEgressPurpose,
} from "../src/lib/document-ingress-safety";
import type { IngestionProviderEgressRequest } from "../src/lib/ingestion-provider-egress";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  RICH_ADMIN_UNSCANNED_POLICY,
  issueRichAdminUnscannedReceipt,
  snapshotRichAdminUnscannedEvidence,
  type RichAdminUnscannedEvidence,
  type RichAdminUnscannedScope,
} from "../supabase/functions/_shared/rich-admin-unscanned-exception";
import {
  parseAdministratorReindexAuthorityFacts,
  type AdministratorReindexAuthorityFacts,
} from "./reindex-provider-authority";
import { inspectIdentifiers, bibliographicIdentifierAssessment } from "./admin-text-inspection";
import { inspectRichPdfSource, type RichPdfInspectionReview } from "./rich-pdf-inspection";
import type { CapturedGenerationImage } from "./generation-evidence";
import type { ManagedProviderEmbeddingRequestContext } from "./managed-provider-vectors";

export type RichPdfInspectionCurrent = {
  facts: AdministratorReindexAuthorityFacts;
  binding: ProviderEgressBinding;
  sourceMetadata: Record<string, unknown>;
  sourceBytes: Uint8Array;
  review: RichPdfInspectionReview;
  capturedImages: readonly CapturedGenerationImage[];
  policyObservations: {
    policyVersion: string;
    rights: "review_deferred";
    indexLicence: "review_deferred";
    legalReviewDeferral: typeof INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL;
    purposeClearance: "permitted";
  };
};
export type RichPdfInspectionOptions = {
  attempt: IngestionAttempt;
  binding: ProviderEgressBinding;
  nativePdfBatch?: ManagedProviderEmbeddingRequestContext;
  loadCurrent(
    request: IngestionProviderEgressRequest,
    binding: Readonly<ProviderEgressBinding>,
  ): Promise<RichPdfInspectionCurrent>;
  loadScannerConfiguration(args: {
    request: IngestionProviderEgressRequest;
    binding: Readonly<ProviderEgressBinding>;
    contentSha256: ContentSha256;
    phase: "source" | "payload";
  }): Promise<{ backend: "administrator_rich_unscanned_exception"; evidence: RichAdminUnscannedEvidence }>;
  /** Disabled by default. Implementations must build from their current inspected
   * source/verified derivative rows, never echo the untrusted actual request. */
  expectedPayloadForPurpose?(
    purpose: Exclude<ProviderEgressPurpose, "embedding">,
    source: RichPdfInspectionCurrent,
  ): Promise<string | Uint8Array | { payload: string; identifierTexts: readonly string[] } | undefined>;
};
function refuse(reason: string): never {
  throw new Error(`rich_pdf_provider_egress_${reason}`);
}
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const embeddingBody = z
  .object({
    model: z.literal("text-embedding-3-small"),
    dimensions: z.literal(1536),
    encoding_format: z.enum(["base64", "float"]).optional(),
    input: z.array(z.string().min(1)).min(1).max(128),
  })
  .strict();

/** Separate stewardship-aware loader. Null document ownership is never replaced
 * by administrator identity. Every actual dispatch reloads fenced source facts. */
export function createRichPdfInspectionLoader(options: RichPdfInspectionOptions): (
  request: IngestionProviderEgressRequest,
  binding: Readonly<ProviderEgressBinding>,
) => Promise<{
  sourceObservations: DocumentIngressSafetyObservations;
  observations: DocumentIngressSafetyObservations;
}> {
  const batch = options.nativePdfBatch === undefined ? undefined : snapshot(options.nativePdfBatch);
  const capturedBinding = Object.freeze({ ...options.binding });
  return async (request, initialBinding) => {
    options.attempt.check();
    request.signal?.throwIfAborted();
    const binding = capturedBinding;
    if (!same(initialBinding, binding)) refuse("binding_mismatch");
    const source = await options.loadCurrent(request, binding);
    if (!same(source.binding, binding)) refuse("binding_mismatch");
    const facts = parseAdministratorReindexAuthorityFacts(
      { ok: true, providerAuthority: source.facts },
      options.attempt.fence,
      binding.generationId,
      binding,
    );
    const review = inspectRichPdfSource(source.review, source.sourceBytes, binding);
    const shared = facts.scope === "existing_shared_library_stewardship";
    if (
      (shared
        ? facts.documentOwnerId !== null || source.sourceMetadata.public_corpus !== true
        : facts.documentOwnerId !== facts.stewardId) ||
      source.policyObservations.rights !== "review_deferred" ||
      source.policyObservations.indexLicence !== "review_deferred" ||
      source.policyObservations.legalReviewDeferral !== INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL ||
      source.policyObservations.purposeClearance !== "permitted" ||
      !source.policyObservations.policyVersion ||
      facts.declaredAuthority.providerProcessing !== "permitted" ||
      !["current", "unknown"].includes(facts.declaredAuthority.currentness)
    )
      refuse("current_policy");
    const today = new Date().toISOString().slice(0, 10),
      authority = facts.declaredAuthority;
    if (
      (authority.effectiveDate !== null && authority.effectiveDate > today) ||
      (authority.expiryDate !== null && authority.expiryDate <= today) ||
      (authority.reviewDate !== null && authority.reviewDate <= today)
    )
      refuse("authority_not_current");
    if (
      review.images.length !== source.capturedImages.length ||
      source.capturedImages.some((image, index) => {
        const expected = review.images[index];
        return (
          !expected ||
          image.ordinal !== expected.ordinal ||
          image.sha256 !== expected.sha256 ||
          image.byteLength !== expected.byteLength ||
          bytesDigest(Buffer.from(image.bytesHex, "hex")) !== expected.sha256 ||
          generationEvidenceDigest(image.descriptor) !== expected.descriptorSha256
        );
      })
    )
      refuse("image_binding");
    for (const page of review.pages) inspectIdentifiers(page.text, bibliographicIdentifierAssessment(page.text));
    for (const table of review.tables)
      for (const row of table.rows)
        for (const cell of row) inspectIdentifiers(cell, bibliographicIdentifierAssessment(cell));
    const payloadBytes =
      typeof request.payload === "string" ? Buffer.from(request.payload) : Buffer.from(request.payload);
    if (bytesDigest(payloadBytes) !== request.payloadSha256) refuse("payload_hash");
    if (request.purpose === "embedding") {
      const text = payloadBytes.toString("utf8");
      if (!Buffer.from(text).equals(payloadBytes)) refuse("payload_utf8");
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        return refuse("payload_json");
      }
      const parsed = embeddingBody.safeParse(decoded);
      if (!parsed.success || JSON.stringify(decoded) !== text) refuse("embedding_schema");
      const body = parsed.data;
      if (
        !batch ||
        !/^sha256:[a-f0-9]{64}$/.test(batch.planDigest) ||
        batch.inputs.length !== body.input.length ||
        batch.inputs.some(
          (input, index) =>
            input.providerInputText !== body.input[index] ||
            !input.sourceUnitIds.length ||
            input.sourceUnitIds.some(
              (unit) =>
                !["chunks", "embedding_fields", "index_units", "memory_cards"].includes(unit.family) ||
                !z.uuid().safeParse(unit.key).success,
            ),
        )
      )
        refuse("embedding_source_plan");
      if (
        body.input.some((input) => Buffer.byteLength(input) > 8191) ||
        body.input.reduce((size, input) => size + Buffer.byteLength(input), 0) > 300000
      )
        refuse("embedding_budget");
      for (const input of body.input) inspectIdentifiers(input, bibliographicIdentifierAssessment(input));
    } else {
      const expected = await options.expectedPayloadForPurpose?.(request.purpose, source);
      const sourceFields =
        expected !== undefined && typeof expected === "object" && !(expected instanceof Uint8Array)
          ? expected
          : undefined;
      if (
        sourceFields &&
        (request.purpose !== "summary" ||
          !Array.isArray(sourceFields.identifierTexts) ||
          sourceFields.identifierTexts.some((text) => typeof text !== "string"))
      )
        refuse("purpose_source_body_unavailable");
      const expectedBytes = sourceFields ? sourceFields.payload : (expected as string | Uint8Array | undefined);
      if (expectedBytes === undefined || !Buffer.from(expectedBytes).equals(payloadBytes))
        refuse("purpose_source_body_unavailable");
      // Expected bodies are purpose-specific trusted derivations. No body, purpose
      // or dynamic provider result is automatically admitted merely by its hash.
      if (sourceFields)
        for (const text of sourceFields.identifierTexts)
          inspectIdentifiers(text, bibliographicIdentifierAssessment(text));
      else if (request.purpose !== "caption") inspectIdentifiers(payloadBytes.toString("utf8"));
    }
    const scope: RichAdminUnscannedScope = {
      binding,
      documentOwnerId: facts.documentOwnerId,
      stewardId: facts.stewardId,
      scope: facts.scope,
      existingSharedPublic: shared,
      admissionDigest: facts.admissionDigest,
    };
    const config = await options.loadScannerConfiguration({
      request,
      binding,
      contentSha256: binding.contentSha256,
      phase: "source",
    });
    options.attempt.check();
    request.signal?.throwIfAborted();
    if (config.backend !== "administrator_rich_unscanned_exception") refuse("scanner_profile");
    const sourceEvidence = snapshotRichAdminUnscannedEvidence(config.evidence);
    const sourceReceipt = issueRichAdminUnscannedReceipt(sourceEvidence, scope, request.purpose, binding.contentSha256);
    const payloadConfig = await options.loadScannerConfiguration({
      request,
      binding,
      contentSha256: request.payloadSha256,
      phase: "payload",
    });
    if (
      payloadConfig.backend !== "administrator_rich_unscanned_exception" ||
      !same(sourceEvidence, snapshotRichAdminUnscannedEvidence(payloadConfig.evidence))
    )
      refuse("scanner_authority_changed");
    const payloadReceipt = issueRichAdminUnscannedReceipt(
      payloadConfig.evidence,
      scope,
      request.purpose,
      request.payloadSha256,
    );
    const after = await options.loadCurrent(request, binding);
    options.attempt.check();
    request.signal?.throwIfAborted();
    if (
      !same(after.facts, facts) ||
      !same(after.binding, binding) ||
      !same(after.review, review) ||
      !same(after.policyObservations, source.policyObservations) ||
      (shared && after.sourceMetadata.public_corpus !== true) ||
      bytesDigest(Buffer.from(after.sourceBytes)) !== binding.contentSha256
    )
      refuse("current_authority_changed");
    const policyVersion = `${source.policyObservations.policyVersion}:${generationEvidenceDigest({ binding, review, facts, scope })}`;
    const observations = (
      contentSha256: ContentSha256,
      exceptionReceipt: typeof sourceReceipt,
    ): DocumentIngressSafetyObservations => ({
      binding: { ...binding, contentSha256 },
      policyVersion,
      purpose: request.purpose,
      admission: "current",
      ownerScope: "permitted",
      rights: "review_deferred",
      indexLicence: "review_deferred",
      legalReviewDeferral: INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
      processingScope: shared ? "existing_shared_library_reindex" : "owner_internal_build",
      purposeClearance: "permitted",
      scanner: { verdict: "unscanned", scannerVersion: RICH_ADMIN_UNSCANNED_POLICY, contentSha256, exceptionReceipt },
      activeContent: "absent",
      identifiers: "absent",
      hiddenText: "consistent",
      encryption: "not_encrypted",
      source: "eligible",
      sourcePolicy: "matched",
    });
    return {
      sourceObservations: observations(binding.contentSha256, sourceReceipt),
      observations: observations(request.payloadSha256, payloadReceipt),
    };
  };
}
