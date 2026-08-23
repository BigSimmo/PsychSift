import { describe, expect, it, vi } from "vitest";

import { buildDefaultMedicationRows } from "../src/lib/medication-fixtures";
import {
  clinicalRegistryRowsToCorpusEntries,
  embedRegistryCorpusEntries,
  medicationRowsToCorpusEntries,
  registryGovernanceProjection,
  registryDocumentIntent,
  type RegistryCorpusEntry,
} from "../src/lib/registry-corpus";
import { registryCorpusDetailHref } from "../src/lib/registry-corpus-links";
import type { MedicationRecordRow } from "../src/lib/medication-records";
import type { RegistryRecordRow } from "../src/lib/registry-records";

const { embedTextsMock } = vi.hoisted(() => ({ embedTextsMock: vi.fn() }));

vi.mock("@/lib/openai", () => ({ embedTexts: embedTextsMock }));

function registryRow(overrides: Partial<RegistryRecordRow> = {}): RegistryRecordRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    kind: "service",
    slug: "crisis-service",
    title: "Crisis service",
    subtitle: "Urgent mental health access",
    route: "Call the crisis line before transfer",
    eligibility: "Acute mental health crisis",
    cost: "No cost",
    referral: "Phone referral required",
    location: "Perth",
    best_use: "Use for urgent triage",
    catalogue_label: "Service",
    navigator_query: "crisis service urgent triage",
    tags: ["crisis", "triage"],
    catchments: ["Perth"],
    status_chips: [],
    primary_contact: { label: "Phone", value: "Crisis line", kind: "phone" },
    contacts: [],
    summary_cards: [],
    referral_info: [],
    criteria: [],
    verification: { locallyVerified: true, confidence: "High", notes: ["Fixture"] },
    source: { label: "Local source", status: "Checked", reviewed: "July 2026", notes: [] },
    source_status: "current",
    validation_status: "locally_reviewed",
    last_reviewed_at: null,
    review_due_at: null,
    catalog_payload: {},
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function corpusHarness() {
  const documents = new Map<string, Record<string, unknown>>();
  const chunks = new Map<string, Record<string, unknown>>();
  const labels = new Map<string, Record<string, unknown>>();
  const tableState = { documents, document_chunks: chunks, document_labels: labels };
  const supabase = {
    from: vi.fn((table: keyof typeof tableState) => {
      let selectedColumn = "id";
      let selectedIds: string[] = [];
      let deleting = false;
      const query = {
        select: vi.fn(() => query),
        in: vi.fn((column: string, ids: string[]) => {
          selectedColumn = column;
          selectedIds = ids;
          if (deleting) {
            for (const [key, row] of tableState[table]) {
              if (ids.includes(String(row[column]))) tableState[table].delete(key);
            }
          }
          return query;
        }),
        upsert: vi.fn(async (rows: Array<Record<string, unknown>>) => {
          for (const row of rows) {
            const key =
              table === "document_labels"
                ? `${row.document_id}|${row.label_type}|${row.label}|${row.source}`
                : String(row.id);
            tableState[table].set(key, { id: String(row.id ?? key), ...row });
          }
          return { data: rows, error: null };
        }),
        delete: vi.fn(() => {
          deleting = true;
          return query;
        }),
        then: (
          resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            data: [...tableState[table].values()].filter((row) => selectedIds.includes(String(row[selectedColumn]))),
            error: null,
          }).then(resolve, reject),
      };
      return query;
    }),
  };
  return { supabase, documents, chunks, labels };
}

describe("registry corpus", () => {
  it("rejects link-only Australian references before document/chunk construction or embedding", async () => {
    embedTextsMock.mockReset().mockResolvedValue([[0.1]]);
    for (const key of ["etg-complete", "australian-medicines-handbook"]) {
      const { supabase, documents, chunks } = corpusHarness();
      const entry: RegistryCorpusEntry = {
        kind: "service",
        subkind: null,
        ownerId: "22222222-2222-4222-8222-222222222222",
        recordId: key,
        slug: key,
        title: "Authenticated clinical reference",
        subtitle: null,
        content: "Synthetic content that must never be indexed for a link-only source.",
        searchText: "authenticated clinical reference",
        sourceStatus: "current",
        validationStatus: "approved",
        metadata: { source_catalogue_key: key },
      };

      await expect(embedRegistryCorpusEntries(supabase as never, [entry])).rejects.toThrow(/link-only/i);
      expect(embedTextsMock).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
      expect(documents.size).toBe(0);
      expect(chunks.size).toBe(0);
    }
  });

  it("retries a failed embed and stops calling OpenAI once corpus hashes are current", async () => {
    const { supabase, documents, chunks } = corpusHarness();
    embedTextsMock
      .mockReset()
      .mockRejectedValueOnce(new Error("embedding unavailable"))
      .mockResolvedValue([[0.1]]);

    await expect(
      (async () => {
        const { embedClinicalRegistryRows } = await import("../src/lib/registry-corpus");
        return embedClinicalRegistryRows(supabase as never, [registryRow()]);
      })(),
    ).rejects.toThrow("embedding unavailable");
    expect(documents.size).toBe(0);
    expect(chunks.size).toBe(0);

    const { embedClinicalRegistryRows } = await import("../src/lib/registry-corpus");
    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 1,
      chunkCount: 1,
    });
    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 0,
      chunkCount: 0,
    });
    expect(embedTextsMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes stored rows without re-embedding when derived metadata drifts", async () => {
    const { supabase, documents, chunks } = corpusHarness();
    embedTextsMock.mockReset().mockResolvedValue([[0.1]]);
    const { embedClinicalRegistryRows } = await import("../src/lib/registry-corpus");

    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 1,
      chunkCount: 1,
    });
    expect(embedTextsMock).toHaveBeenCalledTimes(1);

    // Simulate a row written by an older derivation: same content hash, stale
    // derived metadata that content_hash cannot see.
    const [documentId] = [...documents.keys()];
    const stored = documents.get(documentId!)!;
    documents.set(documentId!, {
      ...stored,
      metadata: { ...(stored.metadata as Record<string, unknown>), registry_detail_href: "/legacy/crisis-service" },
    });

    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 1,
      chunkCount: 1,
    });
    // The refresh rewrites the rows but reuses the stored embedding.
    expect(embedTextsMock).toHaveBeenCalledTimes(1);
    const refreshed = documents.get(documentId!) as { metadata: Record<string, unknown> };
    expect(refreshed.metadata.registry_detail_href).toBe("/services/crisis-service");
    const [chunk] = [...chunks.values()];
    expect(chunk?.embedding).toEqual([0.1]);

    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 0,
      chunkCount: 0,
    });
    expect(embedTextsMock).toHaveBeenCalledTimes(1);
  });

  it("preserves public ownership during metadata and generated-label refreshes", async () => {
    const { supabase, documents, labels } = corpusHarness();
    embedTextsMock.mockReset().mockResolvedValue([[0.1]]);
    const { embedClinicalRegistryRows } = await import("../src/lib/registry-corpus");

    await embedClinicalRegistryRows(supabase as never, [registryRow()]);
    const [documentId] = [...documents.keys()];
    const stored = documents.get(documentId!)!;
    documents.set(documentId!, {
      ...stored,
      owner_id: null,
      metadata: { ...(stored.metadata as Record<string, unknown>), registry_detail_href: "/legacy/crisis-service" },
    });
    const [intentLabelKey] = [...labels.keys()];
    labels.set(intentLabelKey!, {
      ...labels.get(intentLabelKey!)!,
      owner_id: null,
      confidence: 0.75,
      metadata: {
        ...((labels.get(intentLabelKey!)?.metadata as Record<string, unknown>) ?? {}),
        review_status: "approved",
        reviewed_by: "clinical-reviewer",
      },
    });

    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 1,
      chunkCount: 1,
    });
    expect(documents.get(documentId!)?.owner_id).toBeNull();
    expect(labels.get(intentLabelKey!)?.owner_id).toBeNull();
    expect(labels.get(intentLabelKey!)?.confidence).toBe(0.75);
    expect(labels.get(intentLabelKey!)?.metadata).toMatchObject({
      review_status: "approved",
      reviewed_by: "clinical-reviewer",
    });
    expect(embedTextsMock).toHaveBeenCalledTimes(1);
    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 0,
      chunkCount: 0,
    });
  });

  it("refuses to move a registry document from another tenant", async () => {
    const { supabase, documents } = corpusHarness();
    embedTextsMock.mockReset().mockResolvedValue([[0.1]]);
    const { embedClinicalRegistryRows } = await import("../src/lib/registry-corpus");

    await embedClinicalRegistryRows(supabase as never, [registryRow()]);
    const [documentId] = [...documents.keys()];
    documents.set(documentId!, { ...documents.get(documentId!)!, owner_id: "33333333-3333-4333-8333-333333333333" });

    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).rejects.toThrow(
      /owner mismatch.*refusing to change tenant scope/i,
    );
  });

  it("writes validation evidence and reconciles registry smart-v2 labels without generated sites", async () => {
    const { supabase, documents, chunks, labels } = corpusHarness();
    embedTextsMock.mockReset().mockResolvedValue([[0.1]]);
    const { embedClinicalRegistryRows } = await import("../src/lib/registry-corpus");

    await embedClinicalRegistryRows(supabase as never, [registryRow()]);
    const [document] = [...documents.values()];
    const [chunk] = [...chunks.values()];
    expect(document?.metadata).toMatchObject({
      source_kind: "registry_record",
      registry_record_kind: "service",
      publisher: "Clinical KB registry",
      clinical_validation_evidence: {
        status: "locally_reviewed",
        evidence_type: "registry_governance_record",
        registry_record_kind: "service",
      },
    });
    expect(chunk?.metadata).toMatchObject({
      clinical_validation_evidence: { status: "locally_reviewed" },
    });
    expect([...labels.values()]).toEqual([
      expect.objectContaining({
        label: "operational-process",
        label_type: "document_intent",
        source: "generated",
      }),
    ]);

    const documentId = String(document?.id);
    labels.set("generic", {
      id: "generic",
      document_id: documentId,
      owner_id: registryRow().owner_id,
      label: "staff-guidance",
      label_type: "document_intent",
      source: "generated",
      confidence: 0.55,
    });
    labels.set("fabricated-site", {
      id: "fabricated-site",
      document_id: documentId,
      owner_id: registryRow().owner_id,
      label: "fsh",
      label_type: "site",
      source: "generated",
      confidence: 0.8,
    });
    labels.set("manual", {
      id: "manual",
      document_id: documentId,
      owner_id: registryRow().owner_id,
      label: "clinician-reviewed-service",
      label_type: "document_intent",
      source: "manual",
      confidence: 1,
    });

    await expect(embedClinicalRegistryRows(supabase as never, [registryRow()])).resolves.toEqual({
      documentCount: 0,
      chunkCount: 0,
    });
    expect([...labels.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "operational-process", source: "generated" }),
        expect.objectContaining({ label: "clinician-reviewed-service", source: "manual" }),
      ]),
    );
    expect([...labels.values()]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "staff-guidance", source: "generated" })]),
    );
    expect([...labels.values()]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label_type: "site", source: "generated" })]),
    );
  });

  it("maps every registry family to its deterministic smart-v2 intent", () => {
    expect(registryDocumentIntent("medication")).toBe("medication-instruction");
    expect(registryDocumentIntent("differential")).toBe("decision-support");
    expect(registryDocumentIntent("form")).toBe("documentation-requirement");
    expect(registryDocumentIntent("service")).toBe("operational-process");
  });

  it("converts registry rows into source-governed corpus entries", () => {
    const [entry] = clinicalRegistryRowsToCorpusEntries([registryRow()]);

    expect(entry).toMatchObject({
      kind: "service",
      subkind: "service",
      ownerId: "22222222-2222-4222-8222-222222222222",
      recordId: "11111111-1111-4111-8111-111111111111",
      slug: "crisis-service",
      title: "Crisis service",
      sourceStatus: "current",
      validationStatus: "locally_reviewed",
    });
    expect(entry?.content).toContain("Service: Crisis service");
    expect(entry?.content).toContain("Route: Call the crisis line before transfer");
    expect(entry?.searchText).toContain("crisis");
    expect(registryGovernanceProjection(entry!)).toMatchObject({
      documentId: expect.any(String),
      requiredMetadata: {
        corpus_scope: "clinical_kb_site",
        source_role: "service_directory",
        site_content_domain: "services",
        logical_id: "service:crisis-service",
        publication_version: "2026-07-01T00:00:00.000Z",
        site_content_release_id: null,
      },
    });
    expect(JSON.stringify(registryGovernanceProjection(entry!).requiredMetadata)).not.toContain(entry?.ownerId);
  });

  it("preserves form kind separately from service kind", () => {
    const [entry] = clinicalRegistryRowsToCorpusEntries([
      registryRow({ kind: "form", slug: "transport-order", title: "Transport order", catalogue_label: "Form" }),
    ]);

    expect(entry).toMatchObject({ kind: "form", subkind: "form", slug: "transport-order" });
    expect(entry?.content).toContain("Form: Transport order");
  });

  it("keeps re-embed-on-edit hooks inert unless registry corpus embedding is enabled", async () => {
    vi.stubEnv("RAG_REGISTRY_CORPUS_EMBEDDING", "false");
    vi.resetModules();
    try {
      const { reembedRegistryRecordAfterEdit } = await import("../src/lib/registry-corpus");
      const supabase = {
        from: vi.fn(() => {
          throw new Error("should not touch Supabase when disabled");
        }),
      };

      await expect(
        reembedRegistryRecordAfterEdit(supabase as never, {
          corpusKind: "medication",
          ownerId: "22222222-2222-4222-8222-222222222222",
          slug: "clozapine",
        }),
      ).resolves.toEqual({ documentCount: 0, chunkCount: 0, skipped: true, reason: "disabled" });
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("maps scalar medication tags into metadata.tags", () => {
    const rows = buildDefaultMedicationRows("22222222-2222-4222-8222-222222222222") as MedicationRecordRow[];
    const [entry] = medicationRowsToCorpusEntries(rows.map((row) => ({ ...row, tag: "alcohol" })));

    expect(entry?.metadata.tags).toEqual(["alcohol"]);
  });

  it("builds registry detail hrefs for embedded corpus rows", () => {
    expect(
      registryCorpusDetailHref({
        kind: "service",
        slug: "crisis-service",
      }),
    ).toBe("/services/crisis-service");
    expect(
      registryCorpusDetailHref({
        kind: "differential",
        slug: "first-episode-psychosis",
        subkind: "presentation",
        recordId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toBe("/differentials/presentations/first-episode-psychosis");
  });

  it("accepts loosely typed registry metadata and rejects invalid route fields", () => {
    const metadata: Record<string, unknown> = {
      registry_record_kind: "form",
      registry_record_slug: "adult-adhd-screen",
      registry_record_subkind: null,
      registry_record_id: "not-required-for-routing",
    };

    expect(
      registryCorpusDetailHref({
        kind: metadata.registry_record_kind as string | undefined,
        slug: metadata.registry_record_slug as string | undefined,
        subkind: metadata.registry_record_subkind as string | undefined,
        recordId: metadata.registry_record_id as string | undefined,
      }),
    ).toBe("/forms/adult-adhd-screen");
    expect(registryCorpusDetailHref({ kind: "service", slug: 42 as unknown as string })).toBeNull();
  });
});
