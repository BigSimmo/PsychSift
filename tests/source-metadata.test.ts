import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { australianSourceByKey, australianSourcePolicyVersion } from "../src/lib/australian-source-catalogue";
import {
  clipboardProvenanceLine,
  formatClinicalDate,
  hasRecordedGovernanceFields,
  normalizeClinicalSourceMetadata,
  normalizeOptionalSourceMetadata,
  normalizeSourceMetadata,
  sourceMetadataDiagnostics,
  sourceProvenanceSummary,
  sourceStatusLabel,
  validationStatusLabel,
} from "../src/lib/source-metadata";
import { authorityIdentityForCatalogueEntry, classifySourceAuthority } from "../src/lib/source-authority-registry";
import type { ClinicalSourceMetadata } from "../src/lib/types";

type RequiredGovernedMetadata = Required<
  Pick<
    ClinicalSourceMetadata,
    | "corpus_scope"
    | "source_role"
    | "content_mode"
    | "source_catalogue_key"
    | "source_policy_version"
    | "canonical_url"
    | "effective_date"
    | "expiry_date"
    | "supersedes_document_id"
    | "superseded_by_document_id"
    | "retrieved_at"
    | "content_hash"
    | "change_state"
    | "licence_policy"
  >
>;

type GovernedMetadataFieldsAreRequired = ClinicalSourceMetadata extends RequiredGovernedMetadata ? true : false;

describe("source metadata helpers", () => {
  it("exposes the governed clinical normalizer and exact catalogue identity resolver", () => {
    expect(normalizeClinicalSourceMetadata).toBeTypeOf("function");
    expect(authorityIdentityForCatalogueEntry).toBeTypeOf("function");
  });

  it("makes every governed field required on normalized metadata", () => {
    expectTypeOf<GovernedMetadataFieldsAreRequired>().toEqualTypeOf<true>();
  });

  it("preserves recognized governed policy, date, URL, and hash metadata", () => {
    const metadata = normalizeClinicalSourceMetadata({
      source_kind: "document",
      publisher_code: "WACP",
      publisher: "Office of the Chief Psychiatrist WA",
      jurisdiction: "Australia/WA",
      corpus_scope: "australian_public",
      source_role: "quality_standard",
      content_mode: "indexed_content",
      source_catalogue_key: "wa-chief-psychiatrist",
      source_policy_version: australianSourcePolicyVersion,
      canonical_url: "https://www.chiefpsychiatrist.wa.gov.au/standards/standard-1",
      effective_date: "2026-08-20",
      expiry_date: "2028-08-20",
      supersedes_document_id: "doc-previous",
      superseded_by_document_id: "doc-next",
      retrieved_at: "2026-08-20T08:30:00.000Z",
      content_hash: `sha256:${"a".repeat(64)}`,
      change_state: "changed",
      licence_policy: "public_index_permitted",
    });

    expect(metadata).toMatchObject({
      corpus_scope: "australian_public",
      source_role: "quality_standard",
      content_mode: "indexed_content",
      source_catalogue_key: "wa-chief-psychiatrist",
      source_policy_version: australianSourcePolicyVersion,
      canonical_url: "https://www.chiefpsychiatrist.wa.gov.au/standards/standard-1",
      effective_date: "2026-08-20",
      expiry_date: "2028-08-20",
      supersedes_document_id: "doc-previous",
      superseded_by_document_id: "doc-next",
      retrieved_at: "2026-08-20T08:30:00.000Z",
      content_hash: `sha256:${"a".repeat(64)}`,
      change_state: "changed",
      licence_policy: "public_index_permitted",
    });
  });

  it("keeps absent governed metadata neutral", () => {
    expect(normalizeClinicalSourceMetadata(null)).toMatchObject({
      corpus_scope: null,
      source_role: null,
      content_mode: null,
      source_catalogue_key: null,
      source_policy_version: null,
      canonical_url: null,
      effective_date: null,
      expiry_date: null,
      supersedes_document_id: null,
      superseded_by_document_id: null,
      retrieved_at: null,
      content_hash: null,
      change_state: "unknown",
      licence_policy: null,
    });
  });

  it("fails malformed policy URLs, dates, and hashes closed with diagnostics", () => {
    const warnSpy = vi.spyOn(sourceMetadataDiagnostics, "warn").mockImplementation(() => {});
    try {
      const metadata = normalizeClinicalSourceMetadata({
        canonical_url: "http://example.test/guideline",
        effective_date: "20 August 2026",
        expiry_date: "2026-13-40",
        retrieved_at: "yesterday",
        content_hash: "sha256:not-a-digest",
      });

      expect(metadata).toMatchObject({
        canonical_url: null,
        effective_date: null,
        expiry_date: null,
        retrieved_at: null,
        content_hash: null,
      });
      expect(warnSpy).toHaveBeenCalledWith("canonical_url", "unsafe_or_invalid_format");
      expect(warnSpy).toHaveBeenCalledWith("effective_date", "unsafe_or_invalid_format");
      expect(warnSpy).toHaveBeenCalledWith("expiry_date", "unsafe_or_invalid_format");
      expect(warnSpy).toHaveBeenCalledWith("retrieved_at", "unsafe_or_invalid_format");
      expect(warnSpy).toHaveBeenCalledWith("content_hash", "unsafe_or_invalid_format");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("never emits rejected governed values to diagnostics and rejects impossible timestamps", () => {
    const marker = "REGISTERED_PRIVACY_CANARY_20260823";
    const warnSpy = vi.spyOn(sourceMetadataDiagnostics, "warn").mockImplementation(() => {});
    try {
      const metadata = normalizeClinicalSourceMetadata({
        canonical_url: `https://user:${marker}@example.test/guideline?token=${marker}`,
        retrieved_at: "2026-02-29T00:00:00.000Z",
        content_hash: `sha256:${marker}`,
      });

      expect(metadata).toMatchObject({ canonical_url: null, retrieved_at: null, content_hash: null });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(marker);
      expect(warnSpy).toHaveBeenCalledWith("canonical_url", "unsafe_or_invalid_format");
      expect(warnSpy).toHaveBeenCalledWith("retrieved_at", "unsafe_or_invalid_format");
      expect(warnSpy).toHaveBeenCalledWith("content_hash", "unsafe_or_invalid_format");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("preserves exact link-only catalogue policy without granting indexed authority", () => {
    for (const key of ["etg-complete", "australian-medicines-handbook"] as const) {
      const source = australianSourceByKey(key)!;
      const metadata = normalizeClinicalSourceMetadata({
        source_kind: "document",
        publisher_code: source.publisherCode,
        publisher: source.publisher,
        jurisdiction: source.jurisdiction,
        source_catalogue_key: source.key,
        source_policy_version: australianSourcePolicyVersion,
        corpus_scope: "australian_public",
        source_role: "reference_link",
        content_mode: "link_only",
        licence_policy: "metadata_link_only",
      });

      expect(metadata).toMatchObject({
        source_catalogue_key: key,
        source_policy_version: australianSourcePolicyVersion,
        content_mode: "link_only",
        licence_policy: "metadata_link_only",
      });
      expect(classifySourceAuthority(metadata)).toMatchObject({ tier: "supplementary", authorityKey: null });
    }
  });

  it("does not mint catalogue policy from document-controlled prose or a mismatched identity", () => {
    expect(
      normalizeClinicalSourceMetadata({
        source_kind: "document",
        source_title: "WA Chief Psychiatrist standard wa-chief-psychiatrist",
        description: "Published by WACP under the Australian source policy",
        source_catalogue_key: "wa-chief-psychiatrist",
        source_policy_version: australianSourcePolicyVersion,
        content_mode: "indexed_content",
        licence_policy: "public_index_permitted",
      }),
    ).toMatchObject({
      source_catalogue_key: null,
      source_policy_version: null,
      content_mode: null,
      licence_policy: null,
    });

    expect(
      normalizeClinicalSourceMetadata({
        source_kind: "document",
        publisher_code: "TGA",
        jurisdiction: "Australia/National",
        source_catalogue_key: "wa-chief-psychiatrist",
        source_policy_version: australianSourcePolicyVersion,
        content_mode: "indexed_content",
        licence_policy: "public_index_permitted",
      }),
    ).toMatchObject({
      source_catalogue_key: null,
      source_policy_version: null,
      content_mode: null,
      licence_policy: null,
    });
  });

  it("allows partition-bound registry scope without Australian catalogue or activation authority", () => {
    const metadata = normalizeClinicalSourceMetadata({
      source_kind: "registry_record",
      registry_record_kind: "service",
      registry_record_id: "svc-123",
      corpus_scope: "clinical_kb_site",
      publisher_code: "WACP",
      jurisdiction: "Australia/WA",
      source_catalogue_key: "wa-chief-psychiatrist",
      source_policy_version: australianSourcePolicyVersion,
      content_mode: "indexed_content",
      licence_policy: "public_index_permitted",
    });

    expect(metadata).toMatchObject({
      corpus_scope: "clinical_kb_site",
      source_catalogue_key: null,
      source_policy_version: null,
      content_mode: null,
      licence_policy: null,
    });
    expect(classifySourceAuthority(metadata)).toMatchObject({
      tier: "supplementary",
      designation: "unclassified",
      authorityKey: null,
    });
  });

  it("resolves catalogue identity only for an exact key, code, and compatible jurisdiction", () => {
    const source = australianSourceByKey("wa-chief-psychiatrist");

    expect(source).not.toBeNull();
    expect(authorityIdentityForCatalogueEntry(source!)).toMatchObject({
      key: "wa-chief-psychiatrist",
      lifecycle: "active",
    });
    expect(authorityIdentityForCatalogueEntry({ ...source!, publisherCode: "TGA" })).toBeNull();
    expect(authorityIdentityForCatalogueEntry({ ...source!, jurisdiction: "Australia/National" })).toBeNull();
  });

  it("normalizes missing legacy metadata to explicit unknown labels without suppressing content", () => {
    const metadata = normalizeSourceMetadata(null);

    expect(metadata.document_status).toBe("unknown");
    expect(metadata.clinical_validation_status).toBe("unverified");
    expect(sourceStatusLabel(metadata)).toBe("Review status unknown");
    expect(validationStatusLabel(metadata)).toBe("Not locally validated");
    expect(sourceProvenanceSummary(metadata)).toContain("Review status unknown");
  });

  it("preserves empty and index-only metadata as unrecorded for optional normalization", () => {
    expect(hasRecordedGovernanceFields({})).toBe(false);
    expect(hasRecordedGovernanceFields({ index_generation_id: "gen-1" })).toBe(false);
    expect(hasRecordedGovernanceFields({ document_status: "   " })).toBe(false);
    expect(normalizeOptionalSourceMetadata(undefined)).toBeNull();
    expect(normalizeOptionalSourceMetadata(null)).toBeNull();
    expect(normalizeOptionalSourceMetadata({})).toBeNull();
    expect(normalizeOptionalSourceMetadata({ index_generation_id: "gen-1" })).toBeNull();
    expect(normalizeOptionalSourceMetadata({ clinical_validation_status: "unverified" })).toMatchObject({
      clinical_validation_status: "unverified",
    });
    expect(normalizeOptionalSourceMetadata({ document_status: "current" })).toMatchObject({
      document_status: "current",
      clinical_validation_status: "unknown",
      extraction_quality: "unknown",
    });
  });

  it("traces unrecognized enum values while keeping the safe fallback, and stays silent for absent/blank inputs", () => {
    // Issue 1: a present-but-unrecognized value (data-entry typo) is traced but must
    // still coerce to the same safe fallback as before, so no downstream
    // ranking/rendering behaviour changes. Absent/blank inputs are the legitimate
    // default and must stay silent so the trace signal is not drowned.
    // The trace goes through a browser-safe seam rather than the server logger: this
    // module renders client-side, and the logger's `process.env` read is a
    // ReferenceError in a browser.
    const warnSpy = vi.spyOn(sourceMetadataDiagnostics, "warn").mockImplementation(() => {});
    try {
      const metadata = normalizeSourceMetadata({
        document_status: "revieww_due",
        clinical_validation_status: "aproved",
        extraction_quality: "gud",
      });

      // Return value is unchanged — the same safe fallbacks as before.
      expect(metadata.document_status).toBe("unknown");
      expect(metadata.clinical_validation_status).toBe("unverified");
      expect(metadata.extraction_quality).toBe("unknown");

      // Each unrecognized non-empty value is traced once with bounded field/reason metadata.
      expect(warnSpy).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledWith("document_status", "unsupported_value");
      expect(warnSpy).toHaveBeenCalledWith("clinical_validation_status", "unsupported_value");
      expect(warnSpy).toHaveBeenCalledWith("extraction_quality", "unsupported_value");

      // Absent (null / undefined) and blank/whitespace values are the legitimate
      // default and never warn.
      warnSpy.mockClear();
      normalizeSourceMetadata(null);
      normalizeSourceMetadata({ document_status: "", clinical_validation_status: "   " });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("formats dates using Australian date order", () => {
    expect(formatClinicalDate("2026-05-18T10:00:00.000+08:00")).toBe("18/05/2026");
  });

  it("includes source status in copied provenance lines", () => {
    const line = clipboardProvenanceLine(
      normalizeSourceMetadata({
        document_status: "current",
        clinical_validation_status: "approved",
        review_date: "2026-05-18",
        jurisdiction: "Australia/WA",
      }),
    );

    expect(line).toContain("Review status: Current source");
    expect(line).toContain("Validation: Approved");
    expect(line).toContain("Review date: 18/05/2026");
    expect(line).toContain("Jurisdiction: Australia/WA");
  });

  it("preserves registry route metadata during normalization", () => {
    const metadata = normalizeSourceMetadata({
      source_kind: "registry_record",
      registry_record_kind: "service",
      registry_record_subkind: null,
      registry_record_id: "svc-123",
      registry_record_slug: "perth-adult-mental-health",
      source_title: "Perth Adult Mental Health",
      document_status: "current",
      clinical_validation_status: "approved",
    });

    expect(metadata.registry_record_kind).toBe("service");
    expect(metadata.registry_record_subkind).toBeNull();
    expect(metadata.registry_record_id).toBe("svc-123");
    expect(metadata.registry_record_slug).toBe("perth-adult-mental-health");
  });

  it("preserves stale status labels for registry summaries", () => {
    const metadata = normalizeSourceMetadata({
      source_kind: "registry_record",
      document_status: "outdated",
      clinical_validation_status: "locally_reviewed",
    });

    expect(sourceStatusLabel(metadata)).toBe("Registry summary · Outdated source");
    expect(sourceProvenanceSummary(metadata)).toContain("Registry summary · Outdated source");
    expect(clipboardProvenanceLine(metadata)).toContain("Review status: Registry summary · Outdated source");
  });

  it("drops unknown filler segments but keeps governance warnings", () => {
    const emptySummary = sourceProvenanceSummary(normalizeSourceMetadata(null));

    // No "Publisher unknown · Jurisdiction unknown · review Unknown" filler —
    // only the clinical governance warnings remain visible. (The clipboard
    // line intentionally stays explicit; see the dedicated test below.)
    expect(emptySummary).toBe("Review status unknown · Not locally validated");

    const fullSummary = sourceProvenanceSummary(
      normalizeSourceMetadata({
        publisher: "WA Health",
        jurisdiction: "Australia/WA",
        review_date: "2026-05-18",
        document_status: "current",
        clinical_validation_status: "approved",
      }),
    );
    expect(fullSummary).toBe("WA Health · Australia/WA · review 18/05/2026 · Current source · Approved");
  });

  it("keeps copied provenance explicit when review metadata is absent", () => {
    const line = clipboardProvenanceLine(null);

    expect(line).toContain("Review status: Review status unknown");
    expect(line).toContain("Validation: Not locally validated");
    expect(line).toContain("Review date: Unknown");
    expect(line).toContain("Jurisdiction: Unknown");
  });
});

describe("source authority classification", () => {
  const usable = {
    document_status: "current",
    clinical_validation_status: "approved",
    extraction_quality: "good",
  } as const;

  it("recognizes NPS as historical provenance without active Australian augmentation eligibility", () => {
    expect(
      classifySourceAuthority({
        ...usable,
        publisher_code: "NPS",
        publisher: "NPS MedicineWise",
        jurisdiction: "Australia/National",
      }),
    ).toMatchObject({
      designation: "trusted",
      authorityKey: "nps-medicinewise",
      authority: { lifecycle: "historical" },
      tier: "supplementary",
      eligibilityReasons: expect.arrayContaining(["source_lifecycle_not_active"]),
    });
  });

  it.each([
    {
      label: "known WA code",
      metadata: {
        ...usable,
        publisher_code: "FSH",
        publisher: "Fiona Stanley Hospital",
        jurisdiction: "Australia/WA",
      },
      tier: "wa_validated",
      matchedBy: "publisher_code",
    },
    {
      label: "generic WA Health alias",
      metadata: { ...usable, publisher: "WA Health", jurisdiction: "Western Australia" },
      tier: "wa_validated",
      matchedBy: "publisher_alias",
    },
    {
      label: "WA department alias",
      metadata: {
        ...usable,
        publisher: "Western Australian Department of Health",
        jurisdiction: "Australia/WA",
      },
      tier: "wa_validated",
      matchedBy: "publisher_alias",
    },
    {
      label: "WACHS alias with an unrecognised code",
      metadata: {
        ...usable,
        publisher_code: "LOCAL",
        publisher: "WA Country Health Service",
        jurisdiction: "Australia/WA",
      },
      tier: "wa_validated",
      matchedBy: "publisher_alias",
    },
    {
      label: "Australian national code",
      metadata: {
        ...usable,
        publisher_code: "TGA",
        publisher: "Therapeutic Goods Administration",
        jurisdiction: "Australia/National",
        clinical_validation_status: "unverified",
      },
      tier: "australian_national",
      matchedBy: "publisher_code",
    },
    {
      label: "Australian national alias",
      metadata: {
        ...usable,
        publisher: "Australian Commission on Safety and Quality in Healthcare",
        jurisdiction: "Commonwealth of Australia",
      },
      tier: "australian_national",
      matchedBy: "publisher_alias",
    },
    {
      label: "other Australian state authority",
      metadata: { ...usable, publisher: "NSW Health", jurisdiction: "Australia/NSW" },
      tier: "australian_state",
      matchedBy: "publisher_alias",
    },
    {
      label: "international source",
      metadata: {
        ...usable,
        publisher_code: "BMJ",
        publisher: "BMJ Best Practice",
        jurisdiction: "International",
      },
      tier: "supplementary",
      matchedBy: "publisher_code",
    },
  ])("classifies $label from exact metadata", ({ metadata, tier, matchedBy }) => {
    expect(classifySourceAuthority(metadata)).toMatchObject({ tier, matchedBy, conflict: false });
  });

  it.each([
    {
      label: "international code with WA jurisdiction",
      metadata: {
        ...usable,
        publisher_code: "BMJ",
        publisher: "BMJ Best Practice",
        jurisdiction: "Australia/WA",
      },
      conflicts: ["jurisdiction_mismatch"],
    },
    {
      label: "international code with a WA publisher and jurisdiction",
      metadata: { ...usable, publisher_code: "BMJ", publisher: "WA Health", jurisdiction: "Australia/WA" },
      conflicts: ["publisher_mismatch", "jurisdiction_mismatch"],
    },
    {
      label: "WA code with a conflicting known WA publisher",
      metadata: {
        ...usable,
        publisher_code: "FSH",
        publisher: "WA Country Health Service",
        jurisdiction: "Australia/WA",
      },
      conflicts: ["publisher_mismatch"],
    },
    {
      label: "trusted alias with an incompatible jurisdiction",
      metadata: { ...usable, publisher: "NSW Health", jurisdiction: "Australia/WA" },
      conflicts: ["jurisdiction_mismatch"],
    },
  ])("fails closed for $label", ({ metadata, conflicts }) => {
    const classification = classifySourceAuthority(metadata);

    expect(classification.tier).toBe("supplementary");
    expect(classification.conflict).toBe(true);
    expect(classification.conflicts).toEqual(conflicts);
  });

  it.each([
    {
      label: "jurisdiction without a trusted authority",
      metadata: { ...usable, jurisdiction: "Australia/WA" },
      reason: "unrecognized_authority",
    },
    {
      label: "authority text only in source title",
      metadata: {
        ...usable,
        source_title: "WA Country Health Service lithium guideline",
        jurisdiction: "Australia/WA",
      },
      reason: "unrecognized_authority",
    },
    {
      label: "publisher alias without jurisdiction",
      metadata: { ...usable, publisher: "WA Health" },
      reason: "publisher_alias_requires_jurisdiction",
    },
    {
      label: "review-due source",
      metadata: { ...usable, publisher_code: "WACHS", document_status: "review_due" },
      reason: "source_not_current_usable_document",
    },
    {
      label: "partial extraction",
      metadata: { ...usable, publisher_code: "WACHS", extraction_quality: "partial" },
      reason: "source_not_current_usable_document",
    },
    {
      label: "unvalidated WA source",
      metadata: { ...usable, publisher_code: "WACHS", clinical_validation_status: "unverified" },
      reason: "wa_source_not_locally_validated",
    },
  ])("does not promote $label", ({ metadata, reason }) => {
    const classification = classifySourceAuthority(metadata);

    expect(classification.tier).toBe("supplementary");
    expect(classification.eligibilityReasons).toContain(reason);
  });
});
