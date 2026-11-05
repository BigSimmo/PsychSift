import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertExpectedRegistryProjectRef,
  applyRegistryGovernancePlan,
  buildRegistryGovernancePlan,
  type RegistryGovernanceDocument,
  type RegistryGovernanceLabel,
} from "../scripts/reconcile-registry-governance";
import {
  registryCorpusDocumentId,
  registryDocumentIntent,
  type RegistryCorpusKind,
  type RegistryGovernanceProjection,
} from "@/lib/registry-corpus";

const expectedCounts = { service: 1, form: 1, medication: 1, differential: 1 };

function projection(kind: RegistryCorpusKind): RegistryGovernanceProjection {
  const recordId = `${kind}-record`;
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const documentId = registryCorpusDocumentId(kind, recordId);
  return {
    kind,
    recordId,
    slug: `${kind}-slug`,
    ownerId,
    documentId,
    requiredMetadata: {
      source_kind: "registry_record",
      registry_record_kind: kind,
      registry_record_id: recordId,
      registry_record_slug: `${kind}-slug`,
      publisher: "PsychSift registry",
      document_status: "current",
      clinical_validation_status: "locally_reviewed",
      clinical_validation_evidence: {
        status: "locally_reviewed",
        evidence_type: "registry_governance_record",
      },
      extraction_quality: "good",
    },
    intentLabel: {
      document_id: documentId,
      owner_id: ownerId,
      label: registryDocumentIntent(kind),
      label_type: "document_intent",
      confidence: 1,
      source: "generated",
      metadata: { generated_by: "registry-corpus-producer" },
    },
  };
}

function documentFor(value: RegistryGovernanceProjection): RegistryGovernanceDocument {
  return {
    id: value.documentId,
    owner_id: value.ownerId,
    metadata: { preserved_manual_field: `${value.kind}-manual` },
  };
}

function label(
  value: RegistryGovernanceProjection,
  overrides: Partial<RegistryGovernanceLabel> = {},
): RegistryGovernanceLabel {
  return {
    id: `${value.kind}-${overrides.label_type ?? "document_intent"}-${overrides.label ?? value.intentLabel.label}`,
    document_id: value.documentId,
    owner_id: value.ownerId,
    label: value.intentLabel.label,
    label_type: "document_intent",
    source: "generated",
    confidence: 1,
    metadata: value.intentLabel.metadata ?? null,
    ...overrides,
  };
}

describe("registry governance reconciliation", () => {
  it("merges governance metadata, preserves manual labels, and converges idempotently", () => {
    const projections = (["service", "form", "medication", "differential"] as RegistryCorpusKind[]).map(projection);
    const [service, form, , differential] = projections;
    const documents = projections.map(documentFor);
    const labels = [
      label(service!, { id: "generated-site", label: "fsh", label_type: "site" }),
      label(service!, { id: "wrong-intent", label: "staff-guidance" }),
      label(service!, { id: "manual-site", label: "manual-fsh", label_type: "site", source: "manual" }),
      label(form!, {
        id: "stale-expected",
        confidence: 0.5,
        metadata: {
          generated_by: "legacy-producer",
          review_status: "approved",
          reviewed_by: "clinical-reviewer",
        },
      }),
      label(differential!, { id: "current-expected" }),
    ];

    const first = buildRegistryGovernancePlan({ projections, documents, labels, expectedCounts });
    expect(first.documentUpdates).toHaveLength(4);
    expect(first.documentUpdates[0]?.metadata.preserved_manual_field).toBe("service-manual");
    expect(first.labelIdsToDelete).toEqual(["generated-site", "wrong-intent"]);
    expect(first.labelIdsToDelete).not.toContain("manual-site");
    expect(first.labelsToInsert).toHaveLength(2);
    expect(first.labelsToUpdate).toHaveLength(1);
    expect(first.labelsToUpdate[0]?.confidence).toBe(0.5);
    expect(first.labelsToUpdate[0]?.metadata).toMatchObject({
      generated_by: "registry-corpus-producer",
      review_status: "approved",
      reviewed_by: "clinical-reviewer",
    });

    const updatedDocuments = documents.map((document) => {
      const update = first.documentUpdates.find((candidate) => candidate.id === document.id);
      return update ? { ...document, metadata: update.metadata } : document;
    });
    const deleted = new Set(first.labelIdsToDelete);
    const expectedByKey = new Map(
      [...first.labelsToInsert, ...first.labelsToUpdate].map((item, index) => [
        `${item.document_id}:${item.label_type}:${item.label}:${item.source}`,
        {
          id: `upserted-${index}`,
          document_id: item.document_id!,
          owner_id: item.owner_id!,
          label: item.label!,
          label_type: item.label_type!,
          source: item.source!,
          confidence: item.confidence ?? null,
          metadata: item.metadata ?? null,
        } satisfies RegistryGovernanceLabel,
      ]),
    );
    const updatedLabels = labels
      .filter((item) => !deleted.has(item.id))
      .filter((item) => !expectedByKey.has(`${item.document_id}:${item.label_type}:${item.label}:${item.source}`));
    updatedLabels.push(...expectedByKey.values());

    const second = buildRegistryGovernancePlan({
      projections,
      documents: updatedDocuments,
      labels: updatedLabels,
      expectedCounts,
    });
    expect(second.documentUpdates).toEqual([]);
    expect(second.labelsToInsert).toEqual([]);
    expect(second.labelsToUpdate).toEqual([]);
    expect(second.labelIdsToDelete).toEqual([]);
  });

  it("preserves existing generated labels when registry replacement fails", async () => {
    const projections = (["service", "form", "medication", "differential"] as RegistryCorpusKind[]).map(projection);
    const documents = projections.map((value) => ({
      ...documentFor(value),
      metadata: value.requiredMetadata,
      updated_at: "snapshot-A",
    }));
    let rows = projections.map((value) =>
      label(value, value.kind === "service" ? { id: "old-service-intent", label: "old intent" } : {}),
    );
    const before = structuredClone(rows);
    const plan = buildRegistryGovernancePlan({ projections, documents, labels: rows, expectedCounts });
    const supabase = {
      rpc: async () => ({ data: null, error: { message: "synthetic atomic replacement failure" } }),
      from: () => ({
        delete: () => ({
          in: async (_column: string, ids: string[]) => {
            rows = rows.filter((row) => !ids.includes(row.id));
            return { error: null };
          },
        }),
        upsert: async () => ({ error: { message: "synthetic replacement failure" } }),
      }),
    };
    await expect(applyRegistryGovernancePlan(supabase as never, plan)).rejects.toThrow();
    expect(rows).toEqual(before);
  });

  it("aborts before writing on missing, duplicate, or owner-mismatched projections", () => {
    const projections = (["service", "form", "medication", "differential"] as RegistryCorpusKind[]).map(projection);
    const documents = projections.map(documentFor);
    expect(() =>
      buildRegistryGovernancePlan({ projections, documents: documents.slice(1), labels: [], expectedCounts }),
    ).toThrow(/Missing 1 deterministic registry document projection/);
    expect(() =>
      buildRegistryGovernancePlan({
        projections,
        documents: [...documents, documents[0]!],
        labels: [],
        expectedCounts,
      }),
    ).toThrow(/Duplicate registry governance identities/);
    expect(() =>
      buildRegistryGovernancePlan({
        projections,
        documents: [{ ...documents[0]!, owner_id: "22222222-2222-4222-8222-222222222222" }, ...documents.slice(1)],
        labels: [],
        expectedCounts,
      }),
    ).toThrow(/owner mismatch/);
    expect(() =>
      buildRegistryGovernancePlan({
        projections,
        documents: documents.map((document) =>
          document.id === projections[3]!.documentId ? { ...document, owner_id: null } : document,
        ),
        labels: [],
        expectedCounts,
      }),
    ).toThrow(/owner mismatch/);
  });

  it("preserves public projection ownership and scopes generated labels to the public document", () => {
    const projections = (["service", "form", "medication", "differential"] as RegistryCorpusKind[]).map(projection);
    const documents = projections.map((value) =>
      value.kind === "differential" ? documentFor(value) : { ...documentFor(value), owner_id: null },
    );

    const plan = buildRegistryGovernancePlan({ projections, documents, labels: [], expectedCounts });

    expect(plan.publicDocumentCount).toBe(3);
    expect(plan.ownerScopedDocumentCount).toBe(1);
    expect(plan.documentUpdates.find((update) => update.id === projections[0]!.documentId)?.ownerId).toBeNull();
    expect(plan.labelsToInsert.find((item) => item.document_id === projections[0]!.documentId)?.owner_id).toBeNull();
    expect(plan.labelsToInsert.find((item) => item.document_id === projections[3]!.documentId)?.owner_id).toBe(
      projections[3]!.ownerId,
    );
  });

  it("rejects a generated label owned by a different scope than its document", () => {
    const projections = (["service", "form", "medication", "differential"] as RegistryCorpusKind[]).map(projection);
    const documents = projections.map(documentFor);
    const mismatchedLabel = label(projections[0]!, { owner_id: null });

    expect(() =>
      buildRegistryGovernancePlan({ projections, documents, labels: [mismatchedLabel], expectedCounts }),
    ).toThrow(/label owner mismatch/);
  });

  it("requires both configured identity signals to match the expected project", () => {
    expect(() =>
      assertExpectedRegistryProjectRef({
        expectedProjectRef: "expected",
        configuredProjectRef: "other",
        supabaseUrl: "https://expected.supabase.co",
      }),
    ).toThrow(/project ref mismatch/);
    expect(() =>
      assertExpectedRegistryProjectRef({
        expectedProjectRef: "expected",
        configuredProjectRef: "expected",
        supabaseUrl: "https://other.supabase.co",
      }),
    ).toThrow(/URL project mismatch/);
  });

  it("keeps the command provider-free and chunk-free", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "reconcile-registry-governance.ts"), "utf8");
    expect(source).not.toMatch(/(?:from|import\()\s*["']@\/lib\/openai/);
    expect(source).not.toContain("document_chunks");
  });
});
