import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import {
  analyzeSourceLocality,
  assertLocalityMetadataPatch,
  auditProposedSourcePolicyMetadata,
  auditSourceAuthorityDocuments,
  inferSourceAuthorityFromIdentity,
  isRegistryRecordSource,
  localityMetadataKeys,
  type SourceAuthorityDocument,
} from "@/lib/source-authority-metadata";
import { australianSourceByKey, australianSourcePolicyVersion } from "@/lib/australian-source-catalogue";
import { authorityIdentityForCatalogueEntry, classifySourceAuthority } from "@/lib/source-authority-registry";
import { parseBackfillSourceMetadataArgs, runLocalityOnlyBackfill } from "../scripts/backfill-source-metadata";

function document(
  overrides: Partial<SourceAuthorityDocument> & Pick<SourceAuthorityDocument, "file_name">,
): SourceAuthorityDocument {
  return {
    id: overrides.id ?? "document-id",
    title: overrides.title ?? overrides.file_name,
    file_name: overrides.file_name,
    source_path: overrides.source_path ?? null,
    metadata: overrides.metadata ?? {},
  };
}

describe("source authority metadata tooling", () => {
  const activeAustralianMetadata = (overrides: Record<string, unknown> = {}) => ({
    source_kind: "document",
    corpus_scope: "australian_public",
    source_role: "clinical_guideline",
    content_mode: "indexed_content",
    source_policy_version: australianSourcePolicyVersion,
    licence_policy: "public_index_permitted",
    document_status: "current",
    clinical_validation_status: "approved",
    extraction_quality: "good",
    ...overrides,
  });

  it("binds catalogue-only identities only through an exact catalogue tuple", () => {
    for (const [key, publisherCode, jurisdiction, tier] of [
      ["wa-chief-psychiatrist", "OCPWA", "Australia/WA", "wa_validated"],
      ["wa-legislation", "WALEG", "Australia/WA", "wa_validated"],
      ["australian-prescriber", "AUSPRES", "Australia", "australian_national"],
    ] as const) {
      const entry = australianSourceByKey(key);
      expect(entry).not.toBeNull();
      expect(authorityIdentityForCatalogueEntry(entry!)?.codes).toContain(publisherCode);
      expect(
        classifySourceAuthority(
          activeAustralianMetadata({
            source_catalogue_key: key,
            publisher_code: publisherCode,
            publisher: entry!.publisher,
            jurisdiction,
            source_role: entry!.roles[0],
          }),
        ),
      ).toMatchObject({
        tier,
        designation: "trusted",
        authorityKey: key,
        matchedBy: "source_catalogue_key",
        cataloguePolicyResolved: true,
        australianAugmentationEligible: true,
      });

      expect(classifySourceAuthority(activeAustralianMetadata({ publisher_code: publisherCode }))).toMatchObject({
        tier: "supplementary",
        designation: "unclassified",
        cataloguePolicyResolved: false,
        australianAugmentationEligible: false,
      });
    }
  });

  it("requires the exact catalogue key, compatible publisher code, jurisdiction, and active policy semantics", () => {
    const valid = activeAustralianMetadata({
      source_catalogue_key: "wa-health",
      publisher_code: "WAHEALTH",
      publisher: "WA Health",
      jurisdiction: "Australia/WA",
      source_role: "service_policy",
    });

    expect(classifySourceAuthority({ ...valid, publisher_code: "TGA" })).toMatchObject({
      cataloguePolicyResolved: false,
      australianAugmentationEligible: false,
      tier: "supplementary",
    });
    expect(classifySourceAuthority({ ...valid, jurisdiction: "Australia/NSW" })).toMatchObject({
      cataloguePolicyResolved: false,
      australianAugmentationEligible: false,
      tier: "supplementary",
    });
    expect(classifySourceAuthority({ ...valid, content_mode: "link_only" })).toMatchObject({
      cataloguePolicyResolved: true,
      australianAugmentationEligible: false,
      eligibilityReasons: expect.arrayContaining(["catalogue_content_mode_mismatch"]),
    });
    expect(classifySourceAuthority({ ...valid, licence_policy: "review_required" })).toMatchObject({
      cataloguePolicyResolved: true,
      australianAugmentationEligible: false,
      eligibilityReasons: expect.arrayContaining(["catalogue_licence_ineligible"]),
    });
  });

  it("keeps historical NPS recognisable but never active Australian augmentation", () => {
    expect(
      classifySourceAuthority(
        activeAustralianMetadata({
          source_catalogue_key: "nps-medicinewise",
          publisher_code: "NPS",
          publisher: "NPS MedicineWise",
          jurisdiction: "Australia",
          source_role: "professional_review",
        }),
      ),
    ).toMatchObject({
      designation: "trusted",
      authorityKey: "nps-medicinewise",
      cataloguePolicyResolved: true,
      australianAugmentationEligible: false,
      tier: "supplementary",
      eligibilityReasons: expect.arrayContaining(["catalogue_inactive"]),
    });
  });

  it("does not let title, prose, or first-party registry projections self-assert Australian policy", () => {
    expect(
      classifySourceAuthority(
        activeAustralianMetadata({
          source_title: "WA Health policy",
          body: "Official WA Health guidance from the Australian Prescriber.",
          publisher_code: null,
          jurisdiction: "Australia/WA",
        }),
      ),
    ).toMatchObject({
      cataloguePolicyResolved: false,
      australianAugmentationEligible: false,
      tier: "supplementary",
      eligibilityReasons: expect.not.arrayContaining(["catalogue_inactive"]),
    });

    expect(
      classifySourceAuthority(
        activeAustralianMetadata({
          source_kind: "registry_record",
          corpus_scope: "clinical_kb_site",
          source_catalogue_key: "wa-health",
          publisher_code: "WAHEALTH",
          publisher: "WA Health",
          jurisdiction: "Australia/WA",
          source_role: "service_policy",
        }),
      ),
    ).toMatchObject({
      designation: "unclassified",
      cataloguePolicyResolved: false,
      australianAugmentationEligible: false,
      tier: "supplementary",
      reasonCodes: expect.arrayContaining(["registry_summary_identity"]),
    });

    for (const sourceKind of [undefined, "future_import"]) {
      expect(
        classifySourceAuthority(
          activeAustralianMetadata({
            source_kind: sourceKind,
            source_catalogue_key: "wa-health",
            publisher_code: "WAHEALTH",
            publisher: "WA Health",
            jurisdiction: "Australia/WA",
            source_role: "service_policy",
          }),
        ),
      ).toMatchObject({
        cataloguePolicyResolved: false,
        australianAugmentationEligible: false,
      });
    }
  });

  it("reports proposed policy metadata separately without widening locality mutations", () => {
    const candidate = document({
      file_name: "policy.pdf",
      metadata: {
        source_kind: "document",
        source_catalogue_key: "wa-health",
        publisher_code: "WAHEALTH",
        publisher: "WA Health",
        jurisdiction: "Australia/WA",
      },
    });
    const before = structuredClone(candidate);
    const report = auditProposedSourcePolicyMetadata([candidate]);

    expect(report).toMatchObject({
      candidate_count: 1,
      proposals: [
        expect.objectContaining({
          source_catalogue_key: "wa-health",
          corpus_scope: "australian_public",
          source_policy_version: australianSourcePolicyVersion,
          content_mode: "indexed_content",
          lifecycle: "active",
        }),
      ],
    });
    expect(candidate).toEqual(before);
    expect(localityMetadataKeys).toEqual(["publisher_code", "publisher", "jurisdiction"]);
  });

  it("infers WA and national authorities from exact registry code tokens", () => {
    expect(inferSourceAuthorityFromIdentity(document({ file_name: "WACHS-lithium-guideline.pdf" }))).toMatchObject({
      code: "WACHS",
      authority: { key: "wa-country-health-service", scope: "wa" },
      conflict: false,
    });
    expect(
      inferSourceAuthorityFromIdentity(document({ file_name: "TGA/lithium-product-information.pdf" })),
    ).toMatchObject({
      code: "TGA",
      authority: { key: "tga", scope: "australian_national" },
      conflict: false,
    });
  });

  it("requires governed catalogue metadata before trusting the OCP WA alias", () => {
    expect(
      classifySourceAuthority({
        publisher_code: "OCP WA",
        publisher: "Office of the Chief Psychiatrist WA",
        jurisdiction: "Australia/WA",
        document_status: "current",
        clinical_validation_status: "locally_reviewed",
        extraction_quality: "good",
      }),
    ).toMatchObject({
      authorityKey: null,
      authority: null,
      designation: "unclassified",
      cataloguePolicyResolved: false,
      australianAugmentationEligible: false,
      conflict: false,
    });
  });

  it("prefers the document identity over parent health-service path segments", () => {
    expect(
      inferSourceAuthorityFromIdentity(
        document({
          file_name: "RPBG-lithium-guideline.pdf",
          source_path: "WA Health/EMHS/Clinical resources/RPBG/RPBG-lithium-guideline.pdf",
        }),
      ),
    ).toMatchObject({
      code: "RPBG",
      authority: { key: "royal-perth-bentley-group" },
      conflict: false,
    });

    expect(
      inferSourceAuthorityFromIdentity(
        document({
          file_name: "lithium-guideline.pdf",
          title: "FSH lithium guideline",
          source_path: "WA Health/SMHS/Clinical resources/FSH/lithium-guideline.pdf",
        }),
      ),
    ).toMatchObject({
      code: "FSH",
      authority: { key: "fiona-stanley-fremantle-hospitals-group" },
      conflict: false,
    });
  });

  it("treats a trailing parenthetical code as publisher identity rather than subject acronyms", () => {
    expect(
      inferSourceAuthorityFromIdentity(
        document({ file_name: "MDU Booking Process Pharmacy PBS and IPA Process (RPBG).pdf" }),
      ),
    ).toMatchObject({ code: "RPBG", authority: { key: "royal-perth-bentley-group" }, conflict: false });
    expect(
      inferSourceAuthorityFromIdentity(
        document({ file_name: "Governance of ACSQHC Clinical Care Standards (PHC).pdf" }),
      ),
    ).toMatchObject({ code: "PHC", authority: { key: "peel-health-campus" }, conflict: false });
  });

  it("does not infer WHO from ordinary lowercase prose", () => {
    expect(
      inferSourceAuthorityFromIdentity(
        document({
          file_name: "people-who-care.pdf",
          title: "People who care for patients",
        }),
      ),
    ).toEqual({ code: null, authority: null, codes: [], authorityKeys: [], conflict: false });
  });

  it("does not infer NICE from the ordinary word nice, but still reads the capitalised code", () => {
    expect(
      inferSourceAuthorityFromIdentity(
        document({ file_name: "sleep.pdf", title: "Nice and easy guide to sleep hygiene" }),
      ),
    ).toEqual({ code: null, authority: null, codes: [], authorityKeys: [], conflict: false });
    expect(
      inferSourceAuthorityFromIdentity(document({ file_name: "nice-and-easy-sleep.pdf", title: "Sleep hygiene" })),
    ).toEqual({ code: null, authority: null, codes: [], authorityKeys: [], conflict: false });
    expect(inferSourceAuthorityFromIdentity(document({ file_name: "Depression in adults (NICE).pdf" }))).toMatchObject({
      code: "NICE",
      conflict: false,
    });
  });

  it("does not require locality metadata for unknown or international documents", () => {
    const report = auditSourceAuthorityDocuments([
      document({ file_name: "unknown-clinical-reference.pdf" }),
      document({ file_name: "BMJ-lithium.pdf", metadata: { publisher_code: "BMJ" } }),
    ]);

    expect(report.missing_australian_locality_count).toBe(0);
    expect(report.passed).toBe(true);
  });

  it("excludes registry projections from document locality governance", () => {
    const registryRecord = document({
      file_name: "emhs-crisis-service.json",
      source_path: "WA Health/EMHS/Registry/emhs-crisis-service.json",
      metadata: {
        source_kind: "registry_record",
        corpus_scope: "clinical_kb_site",
        source_role: "service_directory",
        publisher: "PsychSift registry",
        jurisdiction: "WA/local clinical workspace",
      },
    });
    const analysis = analyzeSourceLocality(registryRecord);
    const report = auditSourceAuthorityDocuments([registryRecord]);

    expect(isRegistryRecordSource(registryRecord)).toBe(true);
    expect(analysis).toMatchObject({
      authority: null,
      matchedBy: "none",
      excludedReason: "registry_record",
      missingLocalityKeys: [],
      changes: {},
      unresolvedConflict: false,
    });
    expect(report).toMatchObject({
      excluded_registry_record_count: 1,
      authority_conflict_count: 0,
      missing_australian_locality_count: 0,
      proposed_locality_correction_count: 0,
      passed: true,
    });
    expect(classifySourceAuthority(registryRecord.metadata)).toMatchObject({
      designation: "unclassified",
      australianAugmentationEligible: false,
      reasonCodes: expect.arrayContaining(["registry_summary_identity"]),
    });
  });

  it("gates inferable Australian sources with missing locality and proposes only safe fields", () => {
    const candidate = document({ file_name: "WACHS-lithium-guideline.pdf" });
    const analysis = analyzeSourceLocality(candidate);
    const report = auditSourceAuthorityDocuments([candidate]);

    expect(analysis.missingLocalityKeys).toEqual(["publisher_code", "publisher", "jurisdiction"]);
    expect(analysis.changes).toEqual({
      publisher_code: "WACHS",
      publisher: "WA Country Health Service",
      jurisdiction: "Australia/WA",
    });
    expect(report.passed).toBe(false);
    expect(report.missing_australian_locality_count).toBe(1);
    expect(report.proposed_locality_corrections[0]?.changed_keys).toEqual([
      "publisher_code",
      "publisher",
      "jurisdiction",
    ]);
  });

  it("counts designations from the full proposed locality patch, not publisher_code alone", () => {
    // Identity infers WACHS, but the stale free-text publisher would conflict if only
    // publisher_code were projected — the full locality patch must replace publisher too.
    const stalePublisherNeedsFullPatch = document({
      file_name: "WACHS-lithium-guideline.pdf",
      metadata: { publisher: "Local clinic handout" },
    });
    const conflictedStaysUnclassified = document({
      file_name: "conflicted.pdf",
      metadata: {
        publisher_code: "WACHS",
        publisher: "NPS MedicineWise",
        jurisdiction: "Australia/WA",
      },
    });
    const analysis = analyzeSourceLocality(stalePublisherNeedsFullPatch);
    const report = auditSourceAuthorityDocuments([stalePublisherNeedsFullPatch, conflictedStaysUnclassified]);

    expect(analysis.changes).toEqual({
      publisher_code: "WACHS",
      publisher: "WA Country Health Service",
      jurisdiction: "Australia/WA",
    });
    // Code-only projection would keep "Local clinic handout" and classify as unclassified
    // via publisher_mismatch; the full patch correctly counts Official.
    expect(report.designation_counts).toEqual({ official: 1, trusted: 0, unclassified: 1 });
    expect(report.missing_australian_locality_count).toBe(1);
    expect(report.unclassified_samples).toEqual([
      expect.objectContaining({
        file_name: "conflicted.pdf",
        publisher_code: "WACHS",
        publisher: "NPS MedicineWise",
      }),
    ]);
  });

  it("fails closed on cross-authority code and publisher claims", () => {
    const conflicted = document({
      file_name: "lithium-guideline.pdf",
      metadata: {
        publisher_code: "WACHS",
        publisher: "NPS MedicineWise",
        jurisdiction: "Australia/WA",
      },
    });
    const analysis = analyzeSourceLocality(conflicted);
    const report = auditSourceAuthorityDocuments([conflicted]);

    expect(analysis.unresolvedConflict).toBe(true);
    expect(analysis.conflicts).toContain(
      "publisher_code_publisher_conflict:wa-country-health-service/nps-medicinewise",
    );
    expect(analysis.changes).toEqual({});
    expect(report.authority_conflict_reason_counts).toMatchObject({
      publisher_mismatch: 1,
      "publisher_code_publisher_conflict:wa-country-health-service/nps-medicinewise": 1,
    });
  });

  it("canonicalizes compatible aliases without broad metadata changes", () => {
    const analysis = analyzeSourceLocality(
      document({
        file_name: "WACHS-lithium-guideline.pdf",
        metadata: {
          publisher_code: "WACHS",
          publisher: "WA Health",
          jurisdiction: "WA",
          clinical_validation_status: "approved",
        },
      }),
    );

    expect(analysis.unresolvedConflict).toBe(false);
    expect(analysis.changes).toEqual({
      publisher: "WA Country Health Service",
      jurisdiction: "Australia/WA",
    });
    expect(Object.keys(analysis.changes)).not.toContain("clinical_validation_status");
  });

  it("enforces the locality patch allowlist", () => {
    expect(() =>
      assertLocalityMetadataPatch({
        publisher_code: "WACHS",
        publisher: "WA Country Health Service",
        jurisdiction: "Australia/WA",
      }),
    ).not.toThrow();
    expect(() => assertLocalityMetadataPatch({ publisher_code: "WACHS", document_status: "current" })).toThrow(
      /disallowed keys: document_status/,
    );
  });

  it("refuses every write form except confirmed locality-only apply", () => {
    expect(() => parseBackfillSourceMetadataArgs(["--apply"])).toThrow(/requires both --locality-only and --confirm/);
    expect(() => parseBackfillSourceMetadataArgs(["--apply", "--confirm"])).toThrow(
      /requires both --locality-only and --confirm/,
    );
    expect(() => parseBackfillSourceMetadataArgs(["--confirm"])).toThrow(/only valid together with --apply/);
    expect(parseBackfillSourceMetadataArgs(["--locality-only", "--apply", "--confirm"])).toMatchObject({
      localityOnly: true,
      apply: true,
      confirm: true,
    });
  });

  it("applies only bounded locality fields through the metadata patch RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const target = {
      ...document({
        file_name: "WACHS-lithium-guideline.pdf",
        metadata: { publisher_code: "WACHS" },
      }),
      id: "document-1",
      source_path: null,
      status: "active",
    };

    try {
      await runLocalityOnlyBackfill(
        parseBackfillSourceMetadataArgs(["--locality-only", "--apply", "--confirm"]),
        [target],
        { rpc } as never,
      );
    } finally {
      log.mockRestore();
    }

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("apply_document_metadata_patch", {
      p_document_id: "document-1",
      p_metadata_patch: {
        publisher: "WA Country Health Service",
        jurisdiction: "Australia/WA",
      },
    });
  });

  it("classifies source designation independently from currency and local validation", () => {
    expect(
      analyzeSourceLocality(
        document({
          file_name: "CAHS-clozapine.pdf",
          metadata: {
            publisher_code: "CAHS",
            publisher: "Child and Adolescent Health Service",
            jurisdiction: "Australia/WA",
          },
        }),
      ).authority,
    ).toMatchObject({ designation: "official", officialBasis: "wa_health_service_network" });

    expect(
      classifySourceAuthority({
        publisher_code: "EMHS",
        publisher: "East Metropolitan Health Service",
        jurisdiction: "Australia/WA",
        document_status: "outdated",
        clinical_validation_status: "unverified",
        extraction_quality: "poor",
      }),
    ).toMatchObject({
      designation: "official",
      officialBasis: "wa_health_service_network",
      tier: "supplementary",
    });
    expect(
      classifySourceAuthority({
        publisher_code: "WAHEALTH",
        publisher: "WA Health",
        jurisdiction: "Australia/WA",
      }),
    ).toMatchObject({ designation: "trusted", officialBasis: null });
    expect(
      classifySourceAuthority({
        publisher_code: "CAMHS",
        publisher: "Child and Adolescent Mental Health Service",
        jurisdiction: "Australia/WA",
      }),
    ).toMatchObject({ designation: "trusted", officialBasis: null });
    expect(classifySourceAuthority({ publisher_code: "BMJ" })).toMatchObject({ designation: "trusted" });
    expect(classifySourceAuthority({ publisher: "BMJ Best Practice" })).toMatchObject({
      designation: "unclassified",
      reasonCodes: expect.arrayContaining(["publisher_alias_requires_jurisdiction"]),
    });
    expect(
      classifySourceAuthority({ source_kind: "registry_record", publisher_code: "EMHS", jurisdiction: "Australia/WA" }),
    ).toMatchObject({
      designation: "unclassified",
      reasonCodes: expect.arrayContaining(["registry_summary_identity"]),
    });
  });

  it("keeps catalogue-only publisher identities out of runtime authority priority", () => {
    for (const publisherCode of ["OCPWA", "WALEG", "AUSPRES"]) {
      expect(
        classifySourceAuthority({
          source_kind: "document",
          publisher_code: publisherCode,
          document_status: "current",
          clinical_validation_status: "approved",
          extraction_quality: "good",
        }),
      ).toMatchObject({
        tier: "supplementary",
        designation: "unclassified",
        authorityKey: null,
        authority: null,
        matchedBy: "none",
        codeKnown: false,
        eligibilityReasons: expect.arrayContaining(["unrecognized_authority"]),
        reasonCodes: expect.arrayContaining(["unrecognized_authority"]),
      });
    }
  });

  it("fails closed when a locality metadata patch RPC is rejected", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "write denied" } });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const target = {
      ...document({
        file_name: "WACHS-lithium-guideline.pdf",
        metadata: { publisher_code: "WACHS" },
      }),
      id: "document-2",
      source_path: null,
      status: "active",
    };

    try {
      await expect(
        runLocalityOnlyBackfill(
          parseBackfillSourceMetadataArgs(["--locality-only", "--apply", "--confirm"]),
          [target],
          { rpc } as never,
        ),
      ).rejects.toThrow("Failed to patch WACHS-lithium-guideline.pdf: write denied");
    } finally {
      log.mockRestore();
    }
  });

  it("caps locality audit details without changing aggregate counts", async () => {
    const logged: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((value) => logged.push(String(value)));
    const targets = Array.from({ length: 25 }, (_, index) => ({
      ...document({
        file_name: `WACHS-conflict-${index}.pdf`,
        metadata: { publisher_code: "TGA", publisher: "Therapeutic Goods Administration", jurisdiction: "Australia" },
      }),
      id: `document-${index}`,
      source_path: null,
      status: "active",
    }));

    try {
      await runLocalityOnlyBackfill(parseBackfillSourceMetadataArgs(["--locality-only"]), targets, {
        rpc: vi.fn(),
      } as never);
    } finally {
      log.mockRestore();
    }

    const summary = JSON.parse(logged[0]) as {
      authority_conflict_count: number;
      conflicts: unknown[];
      detail_limit: number;
    };
    expect(summary.authority_conflict_count).toBe(25);
    expect(summary.detail_limit).toBe(20);
    expect(summary.conflicts).toHaveLength(20);
  });

  it("makes both governance scripts consume the shared authority helper", () => {
    const auditScript = readFileSync("scripts/audit-source-governance.ts", "utf8");
    const backfillScript = readFileSync("scripts/backfill-source-metadata.ts", "utf8");

    expect(auditScript).toContain('from "@/lib/source-authority-metadata"');
    expect(auditScript).toContain("documents.filter((document) => !isRegistryRecordSource(document))");
    expect(auditScript).toContain('"source_review_events"');
    expect(auditScript).toContain("bmjAttestationEvents");
    expect(backfillScript).toContain('from "@/lib/source-authority-metadata"');
    expect(backfillScript).not.toContain("const publisherByCode");
  });

  it("keeps upload from minting authority from user-controlled filename or title identity", () => {
    const uploadRoute = readFileSync("src/app/api/upload/route.ts", "utf8");
    expect(uploadRoute).not.toContain("inferSourceAuthorityFromIdentity");
    expect(uploadRoute).toContain("publisher_code: null");
  });
});
