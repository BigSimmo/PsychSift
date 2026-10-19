import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import {
  diagnosisToRow,
  presentationToRow,
  rowToDifferentialRecord,
  rowToPresentationWorkflow,
  type DifferentialRecordRow,
} from "@/lib/differential-records";
import { formRecords } from "@/lib/forms";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import {
  recordToRow as medicationToRow,
  rowToMedicationRecord,
  type MedicationRecordRow,
} from "@/lib/medication-records";
import {
  clinicalRegistryRecordToCorpusEntry,
  differentialRecordToCorpusEntry,
  medicationRecordToCorpusEntry,
} from "@/lib/registry-corpus";
import { recordToRow as registryToRow, type RegistryRecordRow } from "@/lib/registry-records";
import { mergeRegistryRecordWithDefault } from "@/lib/registry-seed";
import { serviceRecords } from "@/lib/services";
import { registryEntryToSiteContentRecord } from "@/lib/site-content/adapters/registry";
import {
  canonicalDynamicSiteContentProjection,
  siteContentProjectionDigest,
} from "@/lib/site-content/site-content-publication";
import { siteContentValueHash } from "@/lib/site-content/site-content-manifest";

const rpc = vi.fn();
const sourceRpc = vi.fn();
const sourceRow = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  slug: "sertraline",
  name: "Sertraline",
  class: "SSRI",
  subclass: "SSRI",
  category: "Antidepressant",
  accent: "#000000",
  tag: "Medication",
  schedule: "S4",
  stats: [],
  sections: [],
  quick: [],
  source_status: "current",
  validation_status: "approved",
  last_reviewed_at: null,
  review_due_at: null,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};
const requireAuthenticatedUserContext = vi.fn();
const requireRecentAdministratorAssurance = vi.fn(async () => undefined);

const ownerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rowAudit = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
  last_reviewed_at: null,
  review_due_at: null,
};

function assertNoPrivateKeys(value: unknown) {
  if (Array.isArray(value)) return value.forEach(assertNoPrivateKeys);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expect(key.replace(/[^a-z0-9]/gi, "").toLowerCase()).not.toMatch(
      /^(actor|actorid|owner|ownerid|publishedby|sourceownerid|sourcerowid|privatedocumentid)$/,
    );
    assertNoPrivateKeys(child);
  }
}

function requireObjectFixture(value: unknown, label: string): asserts value is Record<string, unknown> {
  expect(value, `${label} fixture must be present`).toBeDefined();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} fixture must be an object.`);
  }
}

function mockRuntime() {
  vi.resetModules();
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc: sourceRpc,
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: sourceRow, error: null }) }),
        }),
      }),
    }),
  }));
  vi.doMock("@/lib/supabase/auth", async (original) => {
    const actual = await original<typeof import("@/lib/supabase/auth")>();
    return { ...actual, requireAuthenticatedUserContext };
  });
  vi.doMock("@/lib/supabase/admin-assurance", () => ({ requireRecentAdministratorAssurance }));
}

afterEach(() => {
  vi.restoreAllMocks();
  rpc.mockReset();
  sourceRpc.mockReset();
  requireAuthenticatedUserContext.mockReset();
  requireRecentAdministratorAssurance.mockReset();
  requireRecentAdministratorAssurance.mockImplementation(async () => undefined);
});

describe("site-content publication POST", () => {
  it("records an exact reconciliation plan only through the authenticated user-context client", async () => {
    mockRuntime();
    requireAuthenticatedUserContext.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      publicationClient: { rpc },
    });
    rpc.mockResolvedValue({ data: true, error: null });
    const trustedSnapshots = [
      {
        logicalId: "medications:sertraline",
        publicRecordId: "medications:sertraline",
        route: "/medications/sertraline",
        contentHash: "a".repeat(64),
        publicationVersion: "b".repeat(64),
        governanceHash: "c".repeat(64),
      },
    ];
    const dispositions = [
      {
        logicalId: "medications:sertraline",
        disposition: "adopt",
        sourceKind: "medication",
        sourceRowId: "11111111-1111-4111-8111-111111111111",
        sourceVersion: "2026-08-24T00:00:00.000Z",
        contentHash: "a".repeat(64),
        publicationVersion: "b".repeat(64),
        trustedPublicRecordId: "medications:sertraline",
        trustedRoute: "/medications/sertraline",
        trustedGovernanceHash: "c".repeat(64),
      },
    ];
    const governed = {
      version: "site-content-reconciliation-plan-v1" as const,
      trustedSnapshotDigest: siteContentValueHash({
        version: "site-content-trusted-snapshot-v1",
        records: trustedSnapshots,
      }),
      expectedRecordCount: 1,
      expectedGroupCount: 1,
      batchSize: 1,
      batchCount: 1,
      counts: { adopt: 1, retire: 0, identicalDuplicate: 0, total: 1 },
      trustedSnapshots,
      dispositions,
    };
    const plan = { ...governed, planDigest: siteContentValueHash(governed) };
    const { POST } = await import("../src/app/api/site-content/publications/route");

    const response = await POST(
      new Request("http://localhost/api/site-content/publications", {
        method: "POST",
        body: JSON.stringify({ action: "record_reconciliation", plan }),
      }),
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_site_content_reconciliation_plan", { p_plan: plan });
    expect(sourceRpc).not.toHaveBeenCalled();

    for (const forbidden of ["reviewedBy", "actorId", "serviceRole"]) {
      rpc.mockClear();
      const invalid = await POST(
        new Request("http://localhost/api/site-content/publications", {
          method: "POST",
          body: JSON.stringify({ action: "record_reconciliation", plan, [forbidden]: "attacker" }),
        }),
      );
      expect(invalid.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("uses service authority only for source preflight and user-context authority for SQL mutation", () => {
    const route = readFileSync("src/app/api/site-content/publications/route.ts", "utf8");
    const publication = readFileSync("src/lib/site-content/site-content-publication.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20260824123000_add_site_content_health_probe.sql", "utf8");

    expect(route).toContain("requireAuthenticatedUserContext");
    expect(route).toContain("sourceSupabase:");
    expect(route).toContain("publicationSupabase:");
    expect(publication).not.toContain("p_published_by: input.actorId");
    expect(publication).toContain("sourceSupabase: RpcClient");
    expect(publication).toContain("publicationSupabase: RpcClient");
    expect(migration).toContain("raw_app_meta_data->>'site_role' is not distinct from 'administrator'");
    expect(migration).toContain("administrator_authorization_version");
    expect(migration).toContain("site-content-admin-authorization-v1");
    expect(migration).toContain(
      "drop function if exists public.publish_site_content_record(text, uuid, text, bigint, text, text, text, uuid)",
    );
  });

  it("normalizes only the selected locked legacy row through static SQL branches", () => {
    const migration = readFileSync(
      "supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql",
      "utf8",
    );
    expect(migration).toContain("from public.clinical_registry_records r");
    expect(migration).toContain("from public.medication_records r");
    expect(migration).toContain("from public.differential_records r");
    expect(migration).toContain("for update;");
    expect(migration).not.toMatch(/execute\s+format/i);
  });

  it("denies a non-administrator before any command RPC can change state", async () => {
    mockRuntime();
    const { AuthenticationError } = await import("@/lib/supabase/auth");
    requireAuthenticatedUserContext.mockRejectedValue(new AuthenticationError("Administrator access required."));
    const { POST } = await import("../src/app/api/site-content/publications/route");

    const response = await POST(
      new Request("http://localhost/api/site-content/publications", {
        method: "POST",
        body: JSON.stringify({
          action: "publish",
          kind: "medication",
          sourceRowId: "11111111-1111-4111-8111-111111111111",
          expectedSourceVersion: "2026-08-24T00:00:00.000Z",
          expectedChangeEpoch: "0",
          reconciliationPlanDigest: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an administrator without a recent multi-factor sign-in before any RPC (audit F-12)", async () => {
    mockRuntime();
    const { PublicApiError } = await import("@/lib/http");
    requireAuthenticatedUserContext.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      publicationClient: { rpc },
    });
    requireRecentAdministratorAssurance.mockRejectedValue(
      new PublicApiError("Recent multi-factor administrator authentication is required.", 403, {
        code: "administrator_recent_authentication_required",
      }),
    );
    const { POST } = await import("../src/app/api/site-content/publications/route");

    const response = await POST(
      new Request("http://localhost/api/site-content/publications", {
        method: "POST",
        body: JSON.stringify({
          action: "publish",
          kind: "medication",
          sourceRowId: "11111111-1111-4111-8111-111111111111",
          expectedSourceVersion: "2026-08-24T00:00:00.000Z",
          expectedChangeEpoch: "0",
          reconciliationPlanDigest: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(requireRecentAdministratorAssurance).toHaveBeenCalledWith(
      expect.any(Request),
      expect.anything(),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(sourceRpc).not.toHaveBeenCalled();
  });

  it("derives the actor from administrator authentication and never accepts public JSON", async () => {
    mockRuntime();
    requireAuthenticatedUserContext.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      publicationClient: { rpc },
    });
    rpc.mockResolvedValue({
      data: [{ outcome: "applied", logical_id: "medications:sertraline", change_epoch: 1 }],
      error: null,
    });
    const { POST } = await import("../src/app/api/site-content/publications/route");

    const response = await POST(
      new Request("http://localhost/api/site-content/publications", {
        method: "POST",
        body: JSON.stringify({
          action: "publish",
          kind: "medication",
          sourceRowId: "11111111-1111-4111-8111-111111111111",
          expectedSourceVersion: "2026-08-24T00:00:00.000Z",
          expectedChangeEpoch: "0",
          reconciliationPlanDigest: "a".repeat(64),
          actorId: "attacker",
          record: { body: "crafted public JSON" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    const validResponse = await POST(
      new Request("http://localhost/api/site-content/publications", {
        method: "POST",
        body: JSON.stringify({
          action: "publish",
          kind: "medication",
          sourceRowId: "11111111-1111-4111-8111-111111111111",
          expectedSourceVersion: "2026-08-24T00:00:00.000Z",
          expectedChangeEpoch: "0",
          reconciliationPlanDigest: "a".repeat(64),
        }),
      }),
    );
    expect(validResponse.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "publish_site_content_record",
      expect.objectContaining({
        p_expected_record_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_expected_projection_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("returns 409 when the optimistic publication command is stale or a no-op", async () => {
    mockRuntime();
    requireAuthenticatedUserContext.mockResolvedValue({
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      publicationClient: { rpc },
    });
    rpc.mockResolvedValue({ data: [{ outcome: "conflict", conflict_code: "already_retired" }], error: null });
    const { POST } = await import("../src/app/api/site-content/publications/route");

    const response = await POST(
      new Request("http://localhost/api/site-content/publications", {
        method: "POST",
        body: JSON.stringify({
          action: "retire",
          kind: "medication",
          sourceRowId: "11111111-1111-4111-8111-111111111111",
          expectedSourceVersion: "2026-08-24T00:00:00.000Z",
          expectedChangeEpoch: "0",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/conflict|no-op/i) });
  });
});

describe("canonical dynamic public projection", () => {
  it("binds render-only nullable overrides and numeric values into the typed projection digest", () => {
    const row = {
      ...registryToRow(serviceRecords[0]!, ownerId, "service"),
      ...rowAudit,
      verification: {
        ...serviceRecords[0]!.verification,
        locallyVerified: null,
        confidence: null,
      },
    } as RegistryRecordRow;
    const projection = canonicalDynamicSiteContentProjection("service", row);
    expect(projection.renderPayload).toMatchObject({
      verification: { locallyVerified: null, confidence: null },
    });
    const changedRender = {
      ...projection,
      renderPayload: {
        ...projection.renderPayload,
        verification: {
          ...(projection.renderPayload.verification as Record<string, unknown>),
          locallyVerified: false,
        },
      },
    };
    expect(siteContentProjectionDigest(projection)).toMatch(/^[0-9a-f]{64}$/);
    expect(siteContentProjectionDigest(changedRender)).not.toBe(siteContentProjectionDigest(projection));
    expect(
      siteContentProjectionDigest({
        ...projection,
        renderPayload: { ...projection.renderPayload, numericProbe: [0, -0, 1.25, 1e30] },
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches every P03 converter and preserves the approved public fixture fields without audit identifiers", () => {
    const serviceRow = {
      ...registryToRow(serviceRecords[0]!, ownerId, "service"),
      ...rowAudit,
    } as RegistryRecordRow;
    const formRow = { ...registryToRow(formRecords[0]!, ownerId, "form"), ...rowAudit } as RegistryRecordRow;
    const medicationRow = {
      ...medicationToRow(loadMedicationSnapshot()[0]!, ownerId),
      ...rowAudit,
    } as MedicationRecordRow;
    const snapshot = loadDifferentialSnapshot();
    const diagnosisRow = {
      ...diagnosisToRow(snapshot.diagnoses[0]!, ownerId, snapshot),
      ...rowAudit,
    } as DifferentialRecordRow;
    const presentationRow = {
      ...presentationToRow(snapshot.presentations[0]!, ownerId, snapshot),
      ...rowAudit,
    } as DifferentialRecordRow;

    for (const [kind, row] of [
      ["service", serviceRow],
      ["form", formRow],
    ] as const) {
      const render = mergeRegistryRecordWithDefault(kind, row);
      const logicalId = `${kind === "service" ? "services" : "forms"}:${render.slug}`;
      const entry = clinicalRegistryRecordToCorpusEntry(render, kind, {
        ownerId: null,
        recordId: logicalId,
        sourceStatus: row.source_status,
        validationStatus: row.validation_status,
      });
      const projected = canonicalDynamicSiteContentProjection(kind, row);
      expect(projected.record).toEqual(registryEntryToSiteContentRecord(entry, { logicalId, sourceLineage: [] }));
      expect(projected.renderPayload).toMatchObject({
        slug: render.slug,
        title: render.title,
        subtitle: render.subtitle,
        route: render.route,
        eligibility: render.eligibility,
        cost: render.cost,
        referral: render.referral,
        location: render.location,
        bestUse: render.bestUse,
        catchments: render.catchments,
        catalogueLabel: render.catalogueLabel,
        navigatorQuery: render.navigatorQuery,
      });
      requireObjectFixture(render.verification, `${kind} verification`);
      expect(projected.renderPayload.verification).toMatchObject({
        locallyVerified: render.verification.locallyVerified,
        confidence: render.verification.confidence,
        notes: render.verification.notes,
      });
      requireObjectFixture(render.source, `${kind} source`);
      expect(projected.renderPayload.source).toMatchObject({
        label: render.source.label,
        status: render.source.status,
        ...(render.source.url === undefined ? {} : { url: render.source.url }),
        ...(render.source.published === undefined ? {} : { published: render.source.published }),
        reviewed: render.source.reviewed,
        notes: render.source.notes,
      });
      requireObjectFixture(render.catalogPayload, `${kind} catalogue payload`);
      if (kind === "service") {
        const tags = render.catalogPayload.tags;
        requireObjectFixture(tags, "service catalogue tags");
        expect(projected.renderPayload.catalogPayload).toMatchObject({
          tags: {
            catchments: tags.catchments,
            age_groups: tags.age_groups,
            setting_flags: tags.setting_flags,
            acuity_flags: tags.acuity_flags,
            substance_flags: tags.substance_flags,
            housing_flags: tags.housing_flags,
          },
        });
      } else {
        const actSections = render.catalogPayload.actSections;
        if (actSections === undefined) {
          expect(projected.renderPayload.catalogPayload).not.toHaveProperty("actSections");
        } else {
          expect(projected.renderPayload.catalogPayload).toMatchObject({ actSections });
        }
      }
      for (const auditPath of [
        "verification.availabilityStatus",
        "verification.lastVerifiedAt",
        "verification.nextReviewAt",
        "verification.reviewer",
        "verification.unresolvedIssues",
        "catalogPayload.tags.availability_flags",
        "catalogPayload.tags.specialist_groups",
      ]) {
        expect(projected.renderPayload).not.toHaveProperty(auditPath);
      }
      assertNoPrivateKeys(projected.renderPayload);
    }

    const medication = rowToMedicationRecord(medicationRow);
    const medicationId = `medications:${medication.slug}`;
    const medicationEntry = medicationRecordToCorpusEntry(medication, {
      ownerId: null,
      recordId: medicationId,
      sourceStatus: medicationRow.source_status,
      validationStatus: medicationRow.validation_status,
    });
    const projectedMedication = canonicalDynamicSiteContentProjection("medication", medicationRow);
    expect(projectedMedication.record).toEqual(
      registryEntryToSiteContentRecord(medicationEntry, { logicalId: medicationId, sourceLineage: [] }),
    );
    expect(projectedMedication.renderPayload).toEqual(JSON.parse(JSON.stringify(medication)));

    const diagnosis = rowToDifferentialRecord(diagnosisRow);
    const diagnosisId = `differentials:diagnosis:${diagnosis.slug}`;
    const diagnosisEntry = differentialRecordToCorpusEntry(diagnosis, "diagnosis", {
      ownerId: null,
      recordId: diagnosisId,
      sourceStatus: diagnosisRow.source_status,
      validationStatus: diagnosisRow.validation_status,
    });
    const projectedDiagnosis = canonicalDynamicSiteContentProjection("differential", diagnosisRow);
    expect(projectedDiagnosis.record).toEqual(
      registryEntryToSiteContentRecord(diagnosisEntry, { logicalId: diagnosisId, sourceLineage: [] }),
    );
    expect(projectedDiagnosis.renderPayload).toEqual(JSON.parse(JSON.stringify(diagnosis)));

    const presentation = rowToPresentationWorkflow(presentationRow);
    const presentationId = `differentials:presentation:${presentation.id}`;
    const presentationEntry = differentialRecordToCorpusEntry(presentation, "presentation", {
      ownerId: null,
      recordId: presentationId,
      sourceStatus: presentationRow.source_status,
      validationStatus: presentationRow.validation_status,
    });
    const projectedPresentation = canonicalDynamicSiteContentProjection("presentation", presentationRow);
    expect(projectedPresentation.record).toEqual(
      registryEntryToSiteContentRecord(presentationEntry, { logicalId: presentationId, sourceLineage: [] }),
    );
    expect(projectedPresentation.renderPayload).toEqual(JSON.parse(JSON.stringify(presentation)));
    for (const projected of [projectedMedication, projectedDiagnosis, projectedPresentation]) {
      assertNoPrivateKeys(projected.renderPayload);
      expect(JSON.stringify(projected)).not.toContain(ownerId);
    }

    const privateToken = "99999999-9999-4999-8999-999999999999";
    const privateMedicationRow = {
      ...medicationRow,
      sections: [
        {
          title: "Safe section",
          type: "safe",
          ownerId: privateToken,
          rows: [
            {
              key: "Safe row",
              val: "Public value",
              privateDocumentId: privateToken,
              patient: { note: "Public note", actor: { id: privateToken } },
            },
          ],
        },
      ],
    } as unknown as MedicationRecordRow;
    const privateProjection = canonicalDynamicSiteContentProjection("medication", privateMedicationRow);
    assertNoPrivateKeys(privateProjection.renderPayload);
    expect(JSON.stringify(privateProjection)).not.toContain(privateToken);

    const privateSourceRow = {
      ...serviceRow,
      source: { label: "Public source", id: privateToken },
    } as unknown as RegistryRecordRow;
    const privateSourceProjection = canonicalDynamicSiteContentProjection("service", privateSourceRow);
    expect(privateSourceProjection.renderPayload).toMatchObject({ source: { label: "Public source" } });
    expect(JSON.stringify(privateSourceProjection)).not.toContain(privateToken);
  });

  /**
   * SHAPE, NOT CONTENT — and the difference is why 2026-09-16 happened.
   *
   * This population is frozen inside an APPLIED migration, and the epoch-zero release id is derived
   * from its digest. The test here used to assert `frozen` equalled the whole current catalogue, so
   * adding or editing a single record failed by construction and the only way to pass was to
   * regenerate `20260824122000`. Regenerating it moves a release identity the live database can
   * never adopt, because an applied migration is never re-run. PR #2814 did exactly that: the
   * repository went on to describe a bootstrap (`91ceaa8d…`, 860 records) that no database has ever
   * held, live kept `e4a1dd29…` and 843, and `check:drift` went red on two constraints.
   *
   * Content divergence is not a defect. Epoch zero is a frozen snapshot of 2026-08-24; the catalogue
   * is curated continuously, and curated content reaches live through the publication pipeline
   * (`docs/site-content-sync-runbook.md`), never by editing this migration. So a record whose text
   * has since been revised SHOULD differ here.
   *
   * What must not drift is the projection FORMAT. If `canonicalDynamicSiteContentProjection` changes
   * the keys it emits, the frozen bytes stop being readable as that projection, and this fails.
   * Identity of the freeze itself (release id, digest, counts) is pinned separately in
   * `tests/site-content-epoch-zero-freeze.test.ts`.
   */
  it("keeps the frozen epoch-zero seed readable as the current P03 projection format", () => {
    const migration = readFileSync(
      "supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql",
      "utf8",
    );
    const match = migration.match(/\$site_content_bootstrap_records\$([\s\S]*?)\$site_content_bootstrap_records\$/);
    expect(match).not.toBeNull();
    if (!match) return;
    const frozen = (JSON.parse(match[1]!) as Array<Record<string, unknown>>).map(
      ({ logicalId, record, renderPayload }) => ({ logicalId, record, renderPayload }),
    );
    const snapshot = loadDifferentialSnapshot();
    const audit = {
      id: ownerId,
      owner_id: ownerId,
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
      last_reviewed_at: null,
      review_due_at: null,
    };
    const current = [
      ...serviceRecords.map((record) =>
        canonicalDynamicSiteContentProjection("service", {
          ...registryToRow(record, ownerId, "service"),
          ...audit,
        } as RegistryRecordRow),
      ),
      ...formRecords.map((record) =>
        canonicalDynamicSiteContentProjection("form", {
          ...registryToRow(record, ownerId, "form"),
          ...audit,
        } as RegistryRecordRow),
      ),
      ...loadMedicationSnapshot().map((record) =>
        canonicalDynamicSiteContentProjection("medication", {
          ...medicationToRow(record, ownerId),
          ...audit,
        } as MedicationRecordRow),
      ),
      ...snapshot.diagnoses.map((record) =>
        canonicalDynamicSiteContentProjection("differential", {
          ...diagnosisToRow(record, ownerId, snapshot),
          ...audit,
        } as DifferentialRecordRow),
      ),
      ...snapshot.presentations.map((record) =>
        canonicalDynamicSiteContentProjection("presentation", {
          ...presentationToRow(record, ownerId, snapshot),
          ...audit,
        } as DifferentialRecordRow),
      ),
    ]
      .map(({ record, renderPayload }) => ({ logicalId: record.logicalId, record, renderPayload }))
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId));

    // Non-vacuous: the 2026-08-24 freeze carries 843 records, so a truncated or empty blob fails
    // here rather than passing as "every frozen record had the right shape".
    expect(frozen.length).toBe(843);
    expect(current.length).toBeGreaterThanOrEqual(frozen.length);

    const keysOf = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : null;
    /** `services:x` -> `services`, `differentials:diagnosis:x` -> `differentials:diagnosis`. */
    const kindOf = (logicalId: string) => logicalId.split(":").slice(0, -1).join(":");

    // An optional field is absent from a record that has no value for it, so the key set of one
    // record is content-dependent and cannot be compared to another record's. What is NOT
    // content-dependent is the VOCABULARY: every key the projection can emit today. A rename or a
    // removal leaves the frozen bytes carrying a key nothing reads, and that is what this catches.
    //
    // PER KIND, not pooled. A medication payload and a service payload share almost nothing — the
    // union across all five kinds is 49 keys while any one kind emits 11 to 22, so a pooled
    // vocabulary silently tolerates dropping a service key that medications happen to also emit.
    //
    // Only the "no longer emitted" direction is checked. A key added after 2026-08-24 is absent
    // from the freeze by definition, so requiring the freeze to carry today's mandatory keys would
    // re-create the failure-by-construction this test was rewritten to remove.
    const universes = new Map<string, { record: Set<string>; render: Set<string> }>();
    for (const entry of current) {
      const kind = kindOf(entry.logicalId as string);
      const bucket = universes.get(kind) ?? { record: new Set<string>(), render: new Set<string>() };
      for (const key of keysOf(entry.record) ?? []) bucket.record.add(key);
      for (const key of keysOf(entry.renderPayload) ?? []) bucket.render.add(key);
      universes.set(kind, bucket);
    }
    expect(universes.size, "the projection must emit more than one kind to pin per kind").toBeGreaterThan(1);

    for (const entry of frozen) {
      const logicalId = entry.logicalId as string;
      const kind = kindOf(logicalId);
      const bucket = universes.get(kind);
      // A frozen record whose whole KIND has gone is a real break: nothing in the catalogue can
      // still render what live is serving from the freeze.
      expect(bucket, `frozen seed record ${logicalId} belongs to a kind the catalogue no longer emits`).toBeDefined();
      const recordKeys = keysOf(entry.record);
      const renderKeys = keysOf(entry.renderPayload);
      expect(recordKeys, `frozen seed record ${logicalId} is not an object`).not.toBeNull();
      expect(renderKeys, `frozen seed record ${logicalId} render payload is not an object`).not.toBeNull();
      expect(
        recordKeys!.filter((key) => !bucket!.record.has(key)),
        `frozen seed record ${logicalId} carries record keys the projection no longer emits`,
      ).toEqual([]);
      expect(
        renderKeys!.filter((key) => !bucket!.render.has(key)),
        `frozen seed record ${logicalId} carries render keys the projection no longer emits`,
      ).toEqual([]);
    }
  });
});
