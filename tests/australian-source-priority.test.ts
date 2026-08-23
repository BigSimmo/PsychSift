import { describe, expect, it } from "vitest";

import { selectAustralianClinicalContext } from "../src/lib/australian-source-priority";
import { australianSourcePolicyVersion } from "../src/lib/australian-source-catalogue";
import type { ClinicalSourceMetadata, SearchResult } from "../src/lib/types";

function result(
  id: string,
  sourceMetadata: Partial<ClinicalSourceMetadata>,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    id,
    document_id: `${id}-document`,
    title: `${id} source`,
    file_name: `${id}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: "Evidence",
    image_ids: [],
    similarity: 0.8,
    images: [],
    source_metadata: {
      source_kind: "document",
      source_title: `${id} source`,
      publisher: "WA Health",
      publisher_code: "WAHEALTH",
      jurisdiction: "Australia/WA",
      publication_date: "2025-01-01",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      corpus_scope: "uploaded_local",
      source_role: "local_guideline",
      content_mode: "indexed_content",
      source_catalogue_key: `local-${id}`,
      source_policy_version: australianSourcePolicyVersion,
      change_state: "unchanged",
      licence_policy: "public_index_permitted",
      ...sourceMetadata,
    },
    ...overrides,
  };
}

describe("selectAustralianClinicalContext role eligibility", () => {
  it("filters role-ineligible and link-only candidates before applying the existing ranking", () => {
    const local = result("local", {});
    const national = result("national", {
      publisher: "National Health and Medical Research Council",
      publisher_code: "NHMRC",
      jurisdiction: "Australia/National",
      corpus_scope: "australian_public",
      source_role: "clinical_guideline",
      source_catalogue_key: "nhmrc",
    });
    const pbs = result("pbs", {
      publisher: "Pharmaceutical Benefits Scheme",
      publisher_code: "PBS",
      jurisdiction: "Australia/National",
      corpus_scope: "australian_public",
      source_role: "subsidy",
      source_catalogue_key: "pbs",
    });
    const etg = result("etg", {
      publisher: "Therapeutic Guidelines",
      publisher_code: "ETG",
      jurisdiction: "Australia/National",
      corpus_scope: "australian_public",
      source_role: "reference_link",
      source_catalogue_key: "etg-complete",
      content_mode: "link_only",
      licence_policy: "metadata_link_only",
    });

    expect(
      selectAustralianClinicalContext([pbs, etg, national, local], {
        claimRole: "treatment",
        omitSupplementaryPadding: false,
      }).map((source) => source.id),
    ).toEqual([local.id, national.id]);
  });

  it("preserves the existing rank and relevance order when every candidate is eligible", () => {
    const candidates = [
      result("local", {}),
      result("national", {
        publisher: "National Health and Medical Research Council",
        publisher_code: "NHMRC",
        jurisdiction: "Australia/National",
        corpus_scope: "australian_public",
        source_role: "clinical_guideline",
        source_catalogue_key: "nhmrc",
      }),
    ];
    const options = { limit: 6, omitSupplementaryPadding: false } as const;

    const governedOrder = selectAustralianClinicalContext(candidates, {
      ...options,
      claimRole: "treatment",
    }).map((source) => source.id);

    expect(governedOrder).toEqual(["local", "national"]);
  });

  it("fails closed when an untyped caller omits the verified claim role", () => {
    const untypedSelect = selectAustralianClinicalContext as unknown as (
      candidates: SearchResult[],
      options: Record<string, unknown>,
    ) => SearchResult[];

    expect(() => untypedSelect([result("local", {})], {})).toThrowError("A verified claim role is required");
  });
});
