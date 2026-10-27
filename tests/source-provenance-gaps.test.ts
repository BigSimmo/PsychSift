import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSourceProvenanceGapReport, sourceProvenanceGaps } from "@/lib/source-provenance-gaps";

const complete = {
  licence_policy: "public_index_permitted",
  publication_date: "2024-03-01",
  clinical_validation_status: "locally_reviewed",
  document_status: "current",
};

describe("source provenance gaps (audit 2026-10-24 E2E-10)", () => {
  it("finds nothing missing on a complete, reviewed document", () => {
    expect(sourceProvenanceGaps({ id: "a", title: "A", status: "indexed", metadata: complete })).toEqual([]);
  });

  it("names each missing fact on a fresh upload", () => {
    expect(sourceProvenanceGaps({ id: "b", title: "B", status: "indexed", metadata: {} })).toEqual([
      "no_licence_basis",
      "no_publication_date",
      "not_reviewed",
    ]);
  });

  it("counts a licence still under review as no licence basis", () => {
    expect(
      sourceProvenanceGaps({
        id: "r",
        title: "R",
        status: "indexed",
        metadata: { ...complete, licence_policy: "review_required" },
      }),
    ).toEqual(["no_licence_basis"]);
  });

  it("puts a still-searchable document whose licence forbids indexing first", () => {
    const report = buildSourceProvenanceGapReport([
      { id: "fresh", title: "Fresh upload", status: "indexed", metadata: {} },
      {
        id: "downgraded",
        title: "Licence withdrawn",
        status: "indexed",
        metadata: { ...complete, licence_policy: "index_forbidden" },
      },
      { id: "fine", title: "Fine", status: "indexed", metadata: complete },
    ]);
    expect(report.searchable).toBe(3);
    expect(report.documents.map((document) => document.id)).toEqual(["downgraded", "fresh"]);
    expect(report.counts).toEqual({
      licence_forbids_indexing: 1,
      no_licence_basis: 1,
      no_publication_date: 1,
      not_reviewed: 1,
    });
  });

  it("leaves out documents that cannot answer: not indexed, or already marked outdated", () => {
    const report = buildSourceProvenanceGapReport([
      { id: "queued", title: null, status: "queued", metadata: {} },
      {
        id: "outdated",
        title: null,
        status: "indexed",
        metadata: { licence_policy: "index_forbidden", document_status: "outdated" },
      },
    ]);
    expect(report).toEqual({
      searchable: 0,
      counts: { licence_forbids_indexing: 0, no_licence_basis: 0, no_publication_date: 0, not_reviewed: 0 },
      documents: [],
    });
  });

  it("counts a row with no status column as searchable, so a thin export can only widen the report", () => {
    expect(buildSourceProvenanceGapReport([{ id: "x", title: null, metadata: {} }]).searchable).toBe(1);
  });
});

describe("database follow-ups (E2E-10, E2E-11, DB-N4)", () => {
  // Exercised against a scratch replay of schema.sql: a licence change to index_forbidden marked
  // the document outdated, a label edit changed rag_cache_scope_revision_v1, the index was gone.
  it("marks a document outdated when its licence stops permitting indexing, and bumps the cache on label edits", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261025171000_label_cache_revision_licence_withdrawal.sql", "utf8");
    expect(sql).toMatch(/new\.metadata->>'licence_policy' in \('index_forbidden', 'metadata_link_only'\)/);
    expect(sql).toMatch(/'document_status', 'outdated'/);
    for (const operation of ["insert", "update", "delete"]) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger document_labels_evidence_${operation} after ${operation} on public\\.document_labels`,
        ),
      );
    }
    expect(sql).toMatch(/drop index if exists public\.image_caption_cache_owner_hash_idx;/);
  });
});

describe("offline provenance export boundary", () => {
  function runReport(rows: unknown, args: string[] = []) {
    const directory = mkdtempSync(path.join(tmpdir(), "psychsift-provenance-"));
    const input = path.join(directory, "synthetic.json");
    try {
      writeFileSync(input, JSON.stringify(rows));
      return spawnSync(
        process.execPath,
        ["scripts/run-tsx.mjs", "scripts/source-provenance-gaps.ts", "--input", input, ...args],
        { encoding: "utf8", timeout: 10_000 },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  const row = { id: "synthetic-document", title: "Synthetic document", status: "indexed", metadata: {} };

  it.each([
    ["malformed row", [row, null]],
    ["missing id", [row, { title: "Synthetic missing identity", status: "indexed", metadata: {} }]],
    ["duplicate id", [row, { ...row }]],
    ["invalid status", [{ ...row, status: "INDEXED" }]],
    ["invalid metadata", [{ ...row, metadata: [] }]],
  ])("refuses the whole export for %s before emitting any totals", (_label, rows) => {
    const result = runReport(rows);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("Rows read:");
    expect(result.stderr).toMatch(/Export row/);
  });

  it("refuses a partial export against an independent expected population", () => {
    const result = runReport([row], ["--expected-count", "2"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Export row count does not match --expected-count");
    expect(result.stdout).not.toContain("Rows read:");
  });

  it("accounts for a valid thin export conservatively without asserting completeness", () => {
    const result = runReport([{ ...row, status: null }], ["--list"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Rows read: 1; searchable (indexed, not outdated): 1");
    expect(result.stdout).toContain("Export completeness unverified:");
    expect(result.stdout).toContain("No licence basis: 1");
  });

  it("acknowledges a matched count without turning it into clinical approval", () => {
    const result = runReport([row], ["--expected-count", "1"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Export row count matches --expected-count");
    expect(result.stdout).toContain("source fidelity and clinical approval are not assessed");
  });

  it("rejects unknown flags instead of suggesting an unrecognized policy was applied", () => {
    const result = runReport([row], ["--apply"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown provenance report option.");
    expect(result.stdout).not.toContain("Rows read:");
  });
});
