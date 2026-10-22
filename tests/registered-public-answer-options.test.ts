import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../src/lib/types";

// Synthetic coverage for the registered public answer path (audit DOC-18). The planned tests for
// this file depended on a private capture and never landed, so these pin its own gating rules:
// who may get the loader at all, which selected rows may ask for a service-role read, and that
// every failure is the named binding error rather than a silent fallback.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  resolvePlan: vi.fn(),
  readLayout: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/registered-published-admin-source-plan", () => ({
  createRegisteredPublishedAdminSourcePlanResolver: () => mocks.resolvePlan,
}));
vi.mock("@/lib/publication/published-admin-layout", () => ({
  createPublishedAdminTextSectionLayoutLoader: () => mocks.readLayout,
}));
vi.mock("@/lib/rag/rag-source-block", () => ({
  publishedOriginalSectionMetadataForResult: (row: SearchResult) => ({
    index_generation_id: (row.source_metadata as Record<string, unknown>).index_generation_id,
    publication_approval_id: (row.source_metadata as Record<string, unknown>).publication_approval_id,
  }),
  validateCheckedPublishedOriginalSectionLayout: (_request: unknown, projection: unknown) => projection,
}));

const { registeredPublicAnswerOptions } = await import("../src/lib/registered-public-answer-options");

const requesterId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const generationId = "33333333-3333-4333-8333-333333333333";
const approvalId = "44444444-4444-4444-8444-444444444444";
const publicScope = { ownerId: requesterId, includePublic: true } as never;

function row(id: string, overrides: Partial<SearchResult> = {}, metadata: Record<string, unknown> = {}) {
  return {
    id,
    document_id: documentId,
    corpus_scope: "australian_public",
    source_metadata: {
      publication_manifest_version: 2,
      index_generation_id: generationId,
      publication_approval_id: approvalId,
      ...metadata,
    },
    ...overrides,
  } as unknown as SearchResult;
}

const rowIds = Array.from({ length: 7 }, (_, index) => `5555555${index}-5555-4555-8555-555555555555`);

function loader(input: Partial<Parameters<typeof registeredPublicAnswerOptions>[0]> = {}) {
  const options = registeredPublicAnswerOptions({ requesterId, accessScope: publicScope, ...input });
  if (!options) throw new Error("expected registered public answer options");
  return options.loadRegisteredPublishedOriginalSectionLayout;
}

beforeEach(() => {
  mocks.createAdminClient.mockReset().mockReturnValue({ rpc: vi.fn() });
  mocks.resolvePlan.mockReset().mockResolvedValue({
    documentId,
    generationId,
    publicationApprovalId: approvalId,
    sourceExpectation: {},
    sourceSectionLayout: {},
  });
  mocks.readLayout.mockReset().mockResolvedValue({ checked: true });
});

describe("registeredPublicAnswerOptions gating", () => {
  it("offers no loader without a requester, without public scope, or in summary mode", () => {
    expect(registeredPublicAnswerOptions({ accessScope: publicScope })).toBeUndefined();
    expect(
      registeredPublicAnswerOptions({
        requesterId,
        accessScope: { ownerId: requesterId, includePublic: false } as never,
      }),
    ).toBeUndefined();
    expect(registeredPublicAnswerOptions({ requesterId, accessScope: publicScope, summaryMode: true })).toBeUndefined();
  });

  it("refuses a requester that is not the scope owner or not a UUID", () => {
    const otherOwner = { ownerId: "99999999-9999-4999-8999-999999999999", includePublic: true } as never;
    expect(() => registeredPublicAnswerOptions({ requesterId, accessScope: otherOwner })).toThrow(
      expect.objectContaining({ name: "OriginalSectionLayoutBindingError" }),
    );
    expect(() =>
      registeredPublicAnswerOptions({
        requesterId: "not-a-uuid",
        accessScope: { ownerId: "not-a-uuid", includePublic: true } as never,
      }),
    ).toThrow(expect.objectContaining({ name: "OriginalSectionLayoutBindingError" }));
  });
});

describe("registered public section layout loader", () => {
  it("keeps ordinary non-V2 rows on baseline behaviour with no service-role read", async () => {
    const result = await loader()({
      selectedResults: [row(rowIds[0], {}, { publication_manifest_version: 1 })],
    } as never);
    expect(result).toBeNull();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns the checked layout when registration and every selected row agree", async () => {
    const result = await loader({ explicitDocumentIds: [documentId] })({
      selectedResults: [row(rowIds[0]), row(rowIds[1])],
    } as never);
    expect(result).toEqual({ checked: true });
    expect(mocks.resolvePlan).toHaveBeenCalledWith(expect.objectContaining({ requesterId, documentId }));
    expect(mocks.readLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId,
        documentId,
        expectedIndexGenerationId: generationId,
        publicationApprovalId: approvalId,
      }),
    );
  });

  const bindingFailures: Array<
    [string, () => Parameters<ReturnType<typeof loader>>[0], Parameters<typeof loader>[0]?]
  > = [
    ["more than six selected rows", () => ({ selectedResults: rowIds.map((id) => row(id)) }) as never],
    [
      "a document outside the explicit document filter",
      () => ({ selectedResults: [row(rowIds[0])] }) as never,
      { explicitDocumentIds: ["66666666-6666-4666-8666-666666666666"] },
    ],
    [
      "a document outside the resolved document set",
      () => ({ selectedResults: [row(rowIds[0])] }) as never,
      { resolvedDocumentIds: [] },
    ],
    [
      "rows from two documents",
      () =>
        ({
          selectedResults: [row(rowIds[0]), row(rowIds[1], { document_id: "77777777-7777-4777-8777-777777777777" })],
        }) as never,
    ],
    ["a repeated row", () => ({ selectedResults: [row(rowIds[0]), row(rowIds[0])] }) as never],
    [
      "a row from a non-public corpus",
      () => ({ selectedResults: [row(rowIds[0], { corpus_scope: "uploaded_local" } as never)] }) as never,
    ],
    [
      "rows from two index generations",
      () =>
        ({
          selectedResults: [
            row(rowIds[0]),
            row(rowIds[1], {}, { index_generation_id: "88888888-8888-4888-8888-888888888888" }),
          ],
        }) as never,
    ],
  ];

  it.each(bindingFailures)("fails with the named binding error for %s", async (_label, request, input) => {
    await expect(loader(input)(request())).rejects.toMatchObject({ name: "OriginalSectionLayoutBindingError" });
    expect(mocks.readLayout).not.toHaveBeenCalled();
  });

  it("fails closed when the registration plan disagrees with the selected rows", async () => {
    mocks.resolvePlan.mockResolvedValue({
      documentId,
      generationId: "88888888-8888-4888-8888-888888888888",
      publicationApprovalId: approvalId,
      sourceExpectation: {},
      sourceSectionLayout: {},
    });
    await expect(loader()({ selectedResults: [row(rowIds[0])] } as never)).rejects.toMatchObject({
      name: "OriginalSectionLayoutBindingError",
    });
    expect(mocks.readLayout).not.toHaveBeenCalled();
  });

  it("turns a supplier error into the named binding error", async () => {
    mocks.readLayout.mockRejectedValue(new Error("supplier unavailable"));
    await expect(loader()({ selectedResults: [row(rowIds[0])] } as never)).rejects.toMatchObject({
      name: "OriginalSectionLayoutBindingError",
    });
  });

  it("reports caller cancellation as cancellation, not as a binding failure", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("caller left", "AbortError"));
    await expect(
      loader({ signal: controller.signal })({ selectedResults: [row(rowIds[0])] } as never),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
