import { describe, expect, it } from "vitest";
import { currentDocumentPageRows } from "../src/lib/reindex-pipeline";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";

describe("currentDocumentPageRows (audit 2026-10-24, E2E-02)", () => {
  it("keeps every unstamped row for a legacy document", () => {
    const rows = [
      { page_number: 1, index_generation_id: null },
      { page_number: 2, index_generation_id: null },
    ];
    expect(currentDocumentPageRows(rows, { index_generation_id: G1 })).toEqual(rows);
  });

  it("shows only the committed generation once a document is typed", () => {
    const rows = [
      { page_number: 1, text: "pre-typed copy", index_generation_id: null },
      { page_number: 1, text: "previous generation", index_generation_id: G1 },
      { page_number: 1, text: "current generation", index_generation_id: G2 },
    ];
    expect(currentDocumentPageRows(rows, { index_generation_id: G2 }).map((row) => row.text)).toEqual([
      "current generation",
    ]);
    expect(currentDocumentPageRows(rows, { index_generation_id: G1 }).map((row) => row.text)).toEqual([
      "previous generation",
    ]);
  });

  it("reads the unstamped copy only when the document names no generation", () => {
    const rows = [
      { page_number: 1, text: "pre-typed copy", index_generation_id: null },
      { page_number: 1, text: "orphan", index_generation_id: G1 },
    ];
    expect(currentDocumentPageRows(rows, {}).map((row) => row.text)).toEqual(["pre-typed copy"]);
  });

  it("never passes older text off as current when the committed generation's page is missing", () => {
    const rows = [
      { page_number: 1, text: "pre-typed copy", index_generation_id: null },
      { page_number: 1, text: "orphan", index_generation_id: G1 },
    ];
    expect(currentDocumentPageRows(rows, { index_generation_id: G2 })).toEqual([]);
  });

  it("follows the document's page mode after a rollback to pre-cutover pages", () => {
    // The rollback names the restored generation in metadata but sets the mode back to legacy,
    // because that generation's pages were saved before pages carried a stamp.
    const rows = [
      { page_number: 1, text: "pre-typed copy", index_generation_id: null },
      { page_number: 1, text: "rolled-back generation", index_generation_id: G2 },
    ];
    expect(
      currentDocumentPageRows(rows, { index_generation_id: G1 }, "legacy_unqualified").map((row) => row.text),
    ).toEqual(["pre-typed copy"]);
    expect(currentDocumentPageRows(rows, { index_generation_id: G1 })).toEqual([]);
  });

  it("shows only the committed generation for a typed document, and nothing when it names none", () => {
    const rows = [
      { page_number: 1, text: "pre-typed copy", index_generation_id: null },
      { page_number: 1, text: "current generation", index_generation_id: G2 },
    ];
    expect(currentDocumentPageRows(rows, { index_generation_id: G2 }, "typed_exact").map((row) => row.text)).toEqual([
      "current generation",
    ]);
    expect(currentDocumentPageRows(rows, {}, "typed_exact")).toEqual([]);
  });
});
