import { describe, expect, it, vi } from "vitest";
import { createPublishedOriginalReceiptCapture } from "@/lib/rag/rag-source-block";
import { registeredPublicAnswerOptions } from "@/lib/registered-public-answer-options";
import { clinicalQueryModes } from "@/lib/clinical-query-mode";
import { normalizeClinicalSourceMetadata } from "@/lib/source-metadata";
import type { SearchResult } from "@/lib/types";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Unexpected provider access");
  }),
}));

const requesterId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const generationId = "00000000-0000-4000-8000-000000000003";
const approvalId = "00000000-0000-4000-8000-000000000004";
type PublishedRowFixture = SearchResult & {
  source_metadata: ReturnType<typeof normalizeClinicalSourceMetadata> & Record<string, unknown>;
};
function row(): PublishedRowFixture {
  return {
    id: "00000000-0000-4000-8000-000000000005",
    document_id: documentId,
    title: "Synthetic source",
    file_name: "synthetic.txt",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Synthetic heading",
    content: "Synthetic source evidence",
    image_ids: [],
    images: [],
    similarity: 0.9,
    source_metadata: {
      ...normalizeClinicalSourceMetadata({}),
      index_generation_id: generationId,
      public_corpus: true,
      corpus_scope: "australian_public",
      publication_approval_id: approvalId,
      publication_manifest_version: 2,
      publication_manifest_digest: "a".repeat(64),
      publication_reviewed_state_digest: "b".repeat(64),
      publication_reviewed_index_generation_id: generationId,
      source_catalogue_key: "nhmrc",
      source_policy_version: "synthetic-v1",
      publication_source_policy_version: "synthetic-v1",
    },
  };
}
function pathFact(source: SearchResult, section_path = ["Synthetic heading"]) {
  return {
    id: source.id,
    document_id: source.document_id,
    index_generation_id: generationId,
    content: source.content,
    section_path,
  };
}

describe("request-local original-section receipts", () => {
  it.each([true, false])(
    "retains supplementary path across lexical/hybrid overlap (supplement first: %s)",
    (supplementFirst) => {
      const capture = createPublishedOriginalReceiptCapture(),
        source = row(),
        fact = pathFact(source);
      if (supplementFirst) capture.observeRawPublishedRow(source, fact);
      capture.observeRawPublishedRow({ ...source });
      if (!supplementFirst) capture.observeRawPublishedRow(source, fact);
      fact.section_path[0] = "Changed caller-owned fact";
      expect(capture.projectSelectedResults([{ ...source }])?.[0].section_path).toEqual(["Synthetic heading"]);
      expect(source).not.toHaveProperty("section_path");
    },
  );

  it.each(["path", "content", "metadata", "malformed", "failed-read", "non-v2"])(
    "keeps %s conflicts permanently poisoned",
    (conflict) => {
      const capture = createPublishedOriginalReceiptCapture(),
        source = row();
      capture.observeRawPublishedRow(source, pathFact(source));
      const changed = structuredClone(source);
      if (conflict === "content") changed.content += " changed";
      if (conflict === "metadata") changed.source_metadata!.publication_manifest_digest = "c".repeat(64);
      if (conflict === "malformed") changed.source_metadata!.publication_reviewed_index_generation_id = approvalId;
      if (conflict === "non-v2") changed.source_metadata = { ...normalizeClinicalSourceMetadata({}) };
      capture.observeRawPublishedRow(
        changed,
        conflict === "failed-read" ? null : conflict === "path" ? pathFact(source, ["Conflicting heading"]) : undefined,
      );
      capture.observeRawPublishedRow(source, pathFact(source));
      expect(() => capture.projectSelectedResults([source])).toThrow();
    },
  );

  it("requires a fresh request receipt and refuses altered selected content", () => {
    const source = row(),
      capture = createPublishedOriginalReceiptCapture();
    capture.observeRawPublishedRow(source, pathFact(source));
    expect(() => capture.projectSelectedResults([{ ...source, content: "Changed selected content" }])).toThrow();
    expect(() => createPublishedOriginalReceiptCapture().projectSelectedResults([source])).toThrow();
  });
});

describe("original-section cache bypass eligibility", () => {
  const input = { requesterId, accessScope: { ownerId: requesterId, includePublic: true } };
  it.each(["explicitDocumentIds", "resolvedDocumentIds"] as const)("retains normal cache policy for %s", (field) => {
    expect(registeredPublicAnswerOptions({ ...input, [field]: [documentId] })).toBeUndefined();
  });
  it.each(clinicalQueryModes.filter((mode) => mode !== "auto"))(
    "retains normal cache policy for explicit %s",
    (queryMode) => {
      expect(registeredPublicAnswerOptions({ ...input, queryMode })).toBeUndefined();
    },
  );
  it("keeps fresh authority for uncertain unscoped auto and refuses claimed V2 without real registration", async () => {
    const options = registeredPublicAnswerOptions({
      ...input,
      queryMode: "auto",
      explicitDocumentIds: [],
      resolvedDocumentIds: [],
    });
    expect(options?.skipCache).toBe(true);
    await expect(options!.loadRegisteredPublishedOriginalSectionLayout({ selectedResults: [row()] })).rejects.toThrow(
      "Complete original-section layout binding could not be confirmed",
    );
  });
  it("does not attach authority to anonymous, private-only or summary requests", () => {
    expect(registeredPublicAnswerOptions({ accessScope: { includePublic: true } })).toBeUndefined();
    expect(
      registeredPublicAnswerOptions({ ...input, accessScope: { ownerId: requesterId, includePublic: false } }),
    ).toBeUndefined();
    expect(registeredPublicAnswerOptions({ ...input, summaryMode: true })).toBeUndefined();
  });
});
