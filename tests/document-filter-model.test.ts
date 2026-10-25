import { describe, expect, it } from "vitest";

import {
  filterDocumentsByRetrievalScope,
  mergePublicDocumentScopeFilters,
  sameDocumentScope,
} from "@/lib/document-filter-model";
import type { ClinicalDocument } from "@/lib/types";

function document(id: string, site: string, risk: string, status = "current"): ClinicalDocument {
  return {
    id,
    title: id,
    description: null,
    file_name: `${id}.pdf`,
    file_type: "application/pdf",
    file_size: 1,
    storage_path: id,
    status: "indexed",
    page_count: 1,
    chunk_count: 1,
    image_count: 0,
    error_message: null,
    metadata: { document_status: status },
    labels: [
      { id: `${id}-site`, document_id: id, label: site, label_type: "site", metadata: null, created_at: "" },
      { id: `${id}-risk`, document_id: id, label: risk, label_type: "risk", metadata: null, created_at: "" },
    ],
    created_at: "",
    updated_at: "",
  } as ClinicalDocument;
}

const documents = [document("a", "FSH", "High"), document("b", "RPH", "High"), document("c", "FSH", "Low")];

describe("document retrieval filter model", () => {
  it("uses OR within a group and AND across groups", () => {
    expect(filterDocumentsByRetrievalScope(documents, { sites: ["FSH", "RPH"], risks: ["High"] })).toHaveLength(2);
    expect(
      filterDocumentsByRetrievalScope(documents, { sites: ["FSH"], risks: ["High"] }).map((item) => item.id),
    ).toEqual(["a"]);
  });

  it("preserves internal request constraints while public filters change", () => {
    const merged = mergePublicDocumentScopeFilters(
      { importBatchIds: ["00000000-0000-0000-0000-000000000001"], labelTypesAny: ["service"] },
      { risks: ["High"] },
    );
    expect(merged.risks).toEqual(["High"]);
    expect(merged.importBatchIds).toHaveLength(1);
    expect(merged.labelTypesAny).toEqual(["service"]);
  });

  it("counts only WA health services as local, not interstate ones", () => {
    const withPublisher = (id: string, publisher: string) => ({
      ...document(id, "FSH", "High"),
      metadata: { document_status: "current", publisher },
    });
    const sources = [
      withPublisher("wa", "South Metropolitan Health Service"),
      withPublisher("qld", "Metro North Hospital and Health Service"),
    ];
    expect(filterDocumentsByRetrievalScope(sources, { locality: "local" }).map((item) => item.id)).toEqual(["wa"]);
    expect(filterDocumentsByRetrievalScope(sources, { locality: "non_local" }).map((item) => item.id)).toEqual(["qld"]);
  });

  it("compares order-independent scope state", () => {
    expect(sameDocumentScope({ risks: ["High", "Low"] }, { risks: ["Low", "High"] })).toBe(true);
  });
});
