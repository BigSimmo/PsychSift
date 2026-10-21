import { describe, expect, it } from "vitest";
import { groupTableFactMatches } from "../src/lib/rag/rag-candidate-sources";

type Row = Parameters<typeof groupTableFactMatches>[0][number];

function fact(id: string, chunk: string, textRank: number): Row {
  return {
    id,
    document_id: "doc-1",
    source_chunk_id: chunk,
    source_image_id: null,
    page_number: 1,
    table_title: "Synthetic lithium monitoring",
    row_label: `Row ${id}`,
    clinical_parameter: "Serum level",
    threshold_value: `${textRank} mmol/L`,
    action: "Repeat level",
    text_rank: textRank,
  } as Row;
}

// Audit 2026-10-20 RAG-A-02: a lower-ranked fact for a chunk used to be dropped, so only about
// one structured row survived per chunk.
describe("table-fact grouping keeps every matched row per chunk", () => {
  it("keeps three facts for one chunk whatever their order, with the best fact's score", () => {
    const [match] = groupTableFactMatches([
      fact("a", "chunk-1", 0.9),
      fact("b", "chunk-1", 0.4),
      fact("c", "chunk-1", 0.6),
    ]);
    expect(match?.tableFacts?.map((row) => row.id)).toEqual(["a", "c", "b"]);
    expect(match?.textRank).toBe(0.9);
    expect(match?.hybridScore).toBeCloseTo(0.66 + 0.9 * 0.3);
  });

  it("does not repeat a fact returned by two query variants, and caps a chunk at five facts", () => {
    const rows = [fact("a", "chunk-1", 0.5), fact("a", "chunk-1", 0.5)];
    for (const id of ["b", "c", "d", "e", "f", "g"]) rows.push(fact(id, "chunk-1", 0.3));
    const [match] = groupTableFactMatches(rows);
    expect(match?.tableFacts?.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps the higher-ranked copy of a fact returned by two variants", () => {
    const rows = ["b", "c", "d", "e"].map((id) => fact(id, "chunk-1", 0.3));
    rows.unshift(fact("a", "chunk-1", 0.1));
    rows.push(fact("a", "chunk-1", 0.9));
    const [match] = groupTableFactMatches(rows);
    expect(match?.tableFacts?.map((row) => [row.id, row.text_rank])).toEqual([
      ["a", 0.9],
      ["b", 0.3],
      ["c", 0.3],
      ["d", 0.3],
      ["e", 0.3],
    ]);
  });

  it("keeps a higher-ranked late fact when the cap is already full", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => fact(id, "chunk-1", 0.2));
    rows.push(fact("z", "chunk-1", 0.9));
    const [match] = groupTableFactMatches(rows);
    expect(match?.tableFacts?.map((row) => row.id)).toEqual(["z", "a", "b", "c", "d"]);
    expect(match?.textRank).toBe(0.9);
  });

  it("keeps chunks apart and leaves scores unchanged for a single fact", () => {
    const matches = groupTableFactMatches([fact("a", "chunk-1", 0.2), fact("b", "chunk-2", 0.8)]);
    expect(matches.map((match) => [match.chunkId, match.tableFacts?.length, match.similarity])).toEqual([
      ["chunk-1", 1, Math.min(0.94, 0.62 + 0.2 * 0.3)],
      ["chunk-2", 1, Math.min(0.94, 0.62 + 0.8 * 0.3)],
    ]);
  });
});
