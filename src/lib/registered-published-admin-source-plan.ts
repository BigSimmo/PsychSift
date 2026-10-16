import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseSourceExpectation,
  type SourceExpectation,
} from "./ingestion-generation-evidence";
import type { ManagedAdminTextSourceSectionLayout } from "./admin-text-source-section-layout";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const layoutSchema = z
  .object({
    sourceSha256: digest,
    units: z
      .array(
        z
          .object({
            sourceUnitId: z.string().min(1),
            headingByteStart: z.number().int().nonnegative().safe().nullable(),
            headingByteEnd: z.number().int().positive().safe().nullable(),
          })
          .strict(),
      )
      .length(6),
  })
  .strict();
const replySchema = z
  .object({
    version: z.literal("registered-published-admin-source-plan-v1"),
    requesterId: z.uuid(),
    documentId: z.uuid(),
    generationId: z.uuid(),
    publicationApprovalId: z.uuid(),
    sourceExpectation: z.unknown(),
    sourceExpectationBytesHex: z
      .string()
      .regex(/^(?:[0-9a-f]{2})+$/)
      .max(2097152),
    sourceSectionLayout: layoutSchema,
    sourceSectionLayoutBytesHex: z
      .string()
      .regex(/^(?:[0-9a-f]{2})+$/)
      .max(2097152),
    registrationEvidence: z
      .object({
        sourceSha256: digest,
        sourceExpectationDigest: digest,
        sourceSectionLayoutDigest: digest,
        registrationDigest: digest,
      })
      .strict(),
  })
  .strict();

export type RegisteredPublishedAdminSourcePlan = Readonly<{
  documentId: string;
  generationId: string;
  publicationApprovalId: string;
  sourceExpectation: SourceExpectation;
  sourceSectionLayout: ManagedAdminTextSourceSectionLayout;
  registrationEvidence: Readonly<{
    sourceSha256: string;
    sourceExpectationDigest: string;
    sourceSectionLayoutDigest: string;
    registrationDigest: string;
  }>;
}>;
type Read = PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?: (signal: AbortSignal) => Read };
type Rpc = (
  name: "resolve_registered_published_admin_source_plan",
  args: { p_requester_id: string; p_document_id: string },
) => Read;
const refuse = (): never => {
  throw new Error("registered_published_admin_source_plan_refused");
};

/** Server dependency injection only. Call after deriving the authenticated requester and document scope. */
export function createRegisteredPublishedAdminSourcePlanResolver({ rpc }: { rpc: Rpc }) {
  return async function resolveRegisteredPublishedAdminSourcePlan({
    requesterId,
    documentId,
    signal,
  }: {
    requesterId: string;
    documentId: string;
    signal?: AbortSignal;
  }): Promise<RegisteredPublishedAdminSourcePlan | null> {
    signal?.throwIfAborted();
    z.uuid().parse(requesterId);
    z.uuid().parse(documentId);
    let read = rpc("resolve_registered_published_admin_source_plan", {
      p_requester_id: requesterId,
      p_document_id: documentId,
    });
    if (signal) {
      if (!read.abortSignal) return refuse();
      read = read.abortSignal(signal);
    }
    const response = await read;
    signal?.throwIfAborted();
    if (response.error) return refuse();
    if (response.data === null) return null;
    if (generationEvidenceBytes(response.data).length > 2097152) return refuse();
    const reply = replySchema.parse(response.data);
    if (reply.requesterId !== requesterId || reply.documentId !== documentId) return refuse();
    const expectation = parseSourceExpectation(reply.sourceExpectation);
    const layout = reply.sourceSectionLayout;
    const evidence = reply.registrationEvidence;
    const expectationBytes = Buffer.from(reply.sourceExpectationBytesHex, "hex");
    const layoutBytes = Buffer.from(reply.sourceSectionLayoutBytesHex, "hex");
    if (
      expectation.tag !== "known" ||
      expectation.units?.length !== 6 ||
      expectation.sourceSha256 !== evidence.sourceSha256 ||
      layout.sourceSha256 !== evidence.sourceSha256 ||
      bytesDigest(expectationBytes) !== evidence.sourceExpectationDigest ||
      bytesDigest(layoutBytes) !== evidence.sourceSectionLayoutDigest ||
      !expectationBytes.equals(generationEvidenceBytes(expectation)) ||
      !layoutBytes.equals(generationEvidenceBytes(layout)) ||
      generationEvidenceDigest(expectation) !== evidence.sourceExpectationDigest ||
      generationEvidenceDigest(layout) !== evidence.sourceSectionLayoutDigest ||
      new Set(layout.units.map((unit) => unit.sourceUnitId)).size !== 6 ||
      layout.units.some((unit) => !expectation.units!.some((sourceUnit) => sourceUnit.id === unit.sourceUnitId))
    )
      return refuse();
    // No source text, plan synthesis, authority promotion or fallback to producer metadata.
    return freezeGenerationEvidence({
      documentId,
      generationId: reply.generationId,
      publicationApprovalId: reply.publicationApprovalId,
      sourceExpectation: expectation,
      sourceSectionLayout: layout,
      registrationEvidence: evidence,
    });
  };
}
