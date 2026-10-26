import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
const createAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { canonicalizeSourceReferences } from "@/lib/sources/catalogue-core";
import {
  documentRowsToSourceReferences,
  loadVisibleDocumentSourceReferences,
} from "@/lib/sources/document-source-loader";

const metadata = {
  source_kind: "document",
  source_title: "WA clinical guidance",
  publisher: "Armadale Kalamunda Group",
  publisher_code: "AKG",
  jurisdiction: "Australia/WA",
  version: "2",
  publication_date: "2025-01-01",
  review_date: "2026-01-01",
  document_status: "current",
  clinical_validation_status: "locally_reviewed",
  topics: ["Mood", "Clinical governance"],
};

const indexedDocument = {
  id: "22222222-2222-4222-8222-222222222222",
  owner_id: null,
  title: "Fallback document title",
  file_name: "fallback.pdf",
  status: "indexed",
  metadata,
  updated_at: "2026-08-30T00:00:00.000Z",
};

const registryProjection = {
  ...indexedDocument,
  id: "33333333-3333-4333-8333-333333333333",
  metadata: { ...metadata, source_kind: "registry_record" },
};

const queuedUpload = {
  ...indexedDocument,
  id: "44444444-4444-4444-8444-444444444444",
  status: "queued",
};

class QueryDouble {
  filters: Array<["eq" | "is", string, unknown]> = [];
  orFilter = "";
  rows = [indexedDocument];
  error: { message: string } | null = null;

  eq(column: string, value: unknown) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  is(column: string, value: null) {
    this.filters.push(["is", column, value]);
    return this;
  }

  or(filters: string) {
    this.orFilter = filters;
    return this;
  }

  async order() {
    return { data: this.rows, error: this.error };
  }
}

describe("visible document source projection", () => {
  let queryDouble: QueryDouble;

  beforeEach(() => {
    queryDouble = new QueryDouble();
    createSupabaseServerClientMock.mockReset();
    createAdminClientMock.mockReset();
  });

  it("scopes anonymous reads to deliberately public indexed documents", async () => {
    const result = await loadVisibleDocumentSourceReferences({
      viewerId: async () => undefined,
      query: () => queryDouble as never,
    });
    expect(queryDouble.filters).toContainEqual(["is", "owner_id", null]);
    expect(queryDouble.filters).toContainEqual(["eq", "metadata->>public_corpus", "true"]);
    expect(queryDouble.filters).toContainEqual(["eq", "status", "indexed"]);
    expect(result.availability).toBe("available");
    expect(result.references.every((reference) => reference.documentId)).toBe(true);
  });

  it("includes a signed-in owner's documents plus deliberately public documents", async () => {
    await loadVisibleDocumentSourceReferences({
      viewerId: async () => "11111111-1111-4111-8111-111111111111",
      query: () => queryDouble as never,
    });
    expect(queryDouble.orFilter).toContain("owner_id.eq.11111111-1111-4111-8111-111111111111");
    expect(queryDouble.orFilter).toContain("metadata->>public_corpus.eq.true");
  });

  it("returns only allowlisted catalogue fields and omits ungoverned hosted-document topics", () => {
    const [reference] = documentRowsToSourceReferences([
      {
        ...indexedDocument,
        storage_path: "private/path",
        content: "private document text",
        metadata: { ...metadata, patient_name: "hidden", raw_notes: "hidden" },
      },
    ]);
    expect(reference).toMatchObject({
      documentId: indexedDocument.id,
      title: metadata.source_title,
      publisher: metadata.publisher,
      publisherCode: metadata.publisher_code,
      topics: [],
    });
    const serialised = JSON.stringify(reference);
    expect(serialised).not.toContain("private/path");
    expect(serialised).not.toContain("private document text");
    expect(serialised).not.toContain("patient_name");
    expect(serialised).not.toContain("raw_notes");
    expect(serialised).not.toContain("owner_id");
  });

  it("keeps missing hosted clinical validation distinct from explicit unverified status", () => {
    const [missing, explicit] = documentRowsToSourceReferences([
      {
        ...indexedDocument,
        id: "55555555-5555-4555-8555-555555555555",
        metadata: { ...metadata, clinical_validation_status: undefined },
      },
      {
        ...indexedDocument,
        id: "66666666-6666-4666-8666-666666666666",
        metadata: { ...metadata, clinical_validation_status: "unverified" },
      },
    ]);

    expect(missing.validationStatus).toBe("unknown");
    expect(explicit.validationStatus).toBe("unverified");
  });

  it("does not project patient names, identifiers, or secret-shaped metadata topics", () => {
    const sensitiveTopics = ["Jane Citizen", "MRN-123456", "api_key=super-secret"];
    const [reference] = documentRowsToSourceReferences([
      {
        ...indexedDocument,
        metadata: { ...metadata, topics: sensitiveTopics },
      },
    ]);
    const [entry] = canonicalizeSourceReferences([reference]);

    expect(reference.topics).toEqual([]);
    expect(entry.topics).toEqual([]);
    const projected = JSON.stringify({ reference, entry });
    for (const sensitiveTopic of sensitiveTopics) expect(projected).not.toContain(sensitiveTopic);
  });

  it("carries a recorded expiry date so an expired hosted document is not listed as current", () => {
    const [expired, timestamped, absent] = documentRowsToSourceReferences([
      { ...indexedDocument, metadata: { ...metadata, expiry_date: "2025-06-30" } },
      {
        ...indexedDocument,
        id: "77777777-7777-4777-8777-777777777777",
        metadata: { ...metadata, expiry_date: "2999-06-30T00:00:00Z" },
      },
      { ...indexedDocument, id: "88888888-8888-4888-8888-888888888888" },
    ]);

    expect(expired.expiryDate).toBe("2025-06-30");
    expect(timestamped.expiryDate).toBe("2999-06-30");
    expect(absent.expiryDate).toBeNull();
    const [entry] = canonicalizeSourceReferences([expired]);
    expect(entry.documentStatus).toBe("outdated");
    expect(entry.rating.dimensions.currency).toBe(0);
  });

  it("excludes registry projections and non-indexed uploads", () => {
    expect(documentRowsToSourceReferences([registryProjection, queuedUpload])).toEqual([]);
  });

  it("links visible documents directly to their encoded document route", () => {
    const [entry] = canonicalizeSourceReferences(documentRowsToSourceReferences([indexedDocument]));
    expect(entry.canonicalLocation).toEqual({
      kind: "document",
      documentId: indexedDocument.id,
      href: `/documents/${encodeURIComponent(indexedDocument.id)}`,
    });
  });

  it("reports hosted documents unavailable without leaking partial rows on query errors", async () => {
    queryDouble.error = { message: "unavailable" };
    const result = await loadVisibleDocumentSourceReferences({
      viewerId: async () => undefined,
      query: () => queryDouble as never,
    });
    expect(result).toEqual({ references: [], availability: "unavailable" });
  });

  it("reports hosted documents unavailable when the default authentication lookup errors", async () => {
    createSupabaseServerClientMock.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "sensitive authentication failure" },
        }),
      },
    });
    createAdminClientMock.mockReturnValue({
      from: () => ({ select: () => queryDouble }),
    });

    const result = await loadVisibleDocumentSourceReferences();

    expect(result).toEqual({ references: [], availability: "unavailable" });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("sensitive authentication failure");
  });
});
