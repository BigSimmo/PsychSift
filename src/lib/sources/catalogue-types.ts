import type { AppModeId } from "@/lib/app-modes";

export type ClinicalSourceType =
  | "guideline"
  | "systematic_review"
  | "primary_study"
  | "standard"
  | "legislation"
  | "regulatory"
  | "professional_reference"
  | "consumer_reference"
  | "uploaded_document"
  | "dataset"
  | "other"
  | "unknown";

export type SourceGeographyScope = "wa" | "australian_national" | "australian_state" | "international" | "unknown";
export type SourceLifecycleStatus = "active" | "inactive" | "excluded";
export type SourceContentMode = "indexed_content" | "link_only" | "metadata_only";
export type SourceQualityBand = "A" | "B" | "C" | "D" | "excluded";
/**
 * How a catalogue date is named to a reader. "last updated" is a publisher's
 * update stamp and is never shown as a publication or a review.
 */
export type SourceDateLabel = "published" | "reviewed" | "last updated";

export type SourceCatalogueWarning =
  | "ambiguous_identity"
  | "metadata_conflict"
  | "unsafe_location"
  | "invalid_date"
  | "missing_publisher"
  | "missing_version"
  | "missing_dates"
  | "unknown_jurisdiction"
  | "unknown_evidence_type"
  | "verification_unknown"
  | "outdated"
  | "superseded";

export type SourceUsage = {
  modeId: AppModeId;
  recordId: string;
  recordLabel: string;
  field: string;
};

export type SourceCanonicalLocation =
  | { kind: "url"; href: string }
  | { kind: "document"; documentId: string; href: string }
  | { kind: "dataset"; label: string }
  | { kind: "none" };

export type ClinicalSourceReferenceInput = {
  sourceId: string | null;
  documentId: string | null;
  title: string | null;
  aliases: string[];
  publisher: string | null;
  publisherCode: string | null;
  canonicalUrl: string | null;
  datasetLocation: string | null;
  version: string | null;
  publicationDate: string | null;
  reviewDate: string | null;
  /**
   * A publisher's "last updated" stamp on a continuously maintained page. It is a
   * third event, neither a publication nor a review, and is only ever shown as
   * "last updated". Optional because only the acquisition ledger's `last_updated`
   * records carry it.
   */
  lastUpdatedDate?: string | null;
  /**
   * Set only by the acquisition ledger's `live_product_information` records: the
   * TGA Product Information search, which has no date by design. The catalogue
   * then does not count the absent date as missing metadata, and only for a URL
   * that really is that search.
   */
  liveProductInformation?: boolean;
  expiryDate: string | null;
  jurisdiction: string | null;
  evidenceType: ClinicalSourceType;
  documentStatus: "current" | "review_due" | "outdated" | "unknown";
  validationStatus: "approved" | "locally_reviewed" | "unverified" | "unknown";
  contentMode: SourceContentMode;
  lifecycleStatus: SourceLifecycleStatus;
  supersedes: string[];
  supersededBy: string[];
  topics: string[];
  usage: SourceUsage;
  referenceText: string | null;
};

export type ClinicalSourceRating = {
  score: number;
  band: SourceQualityBand;
  dimensions: {
    accuracyAssurance: number;
    reliability: number;
    evidenceQuality: number;
    currency: number;
    australianApplicability: number;
    traceability: number;
  };
  weights: typeof SOURCE_RATING_WEIGHTS;
  reasons: string[];
};

export const SOURCE_RATING_WEIGHTS = {
  accuracyAssurance: 25,
  reliability: 20,
  evidenceQuality: 20,
  currency: 15,
  australianApplicability: 15,
  traceability: 5,
} as const;

export type ClinicalSourceCatalogueEntry = {
  id: string;
  sourceId: string | null;
  title: string;
  aliases: string[];
  version: string | null;
  publisher: string | null;
  publisherCode: string | null;
  sourceType: ClinicalSourceType;
  canonicalLocation: SourceCanonicalLocation;
  geography: { scope: SourceGeographyScope; label: string };
  topics: string[];
  publicationDate: string | null;
  reviewDate: string | null;
  /** Present only when a reference carried an update stamp; see the input type. */
  lastUpdatedDate?: string | null;
  expiryDate: string | null;
  documentStatus: ClinicalSourceReferenceInput["documentStatus"];
  validationStatus: ClinicalSourceReferenceInput["validationStatus"];
  contentMode: SourceContentMode;
  lifecycleStatus: SourceLifecycleStatus;
  supersedes: string[];
  supersededBy: string[];
  usedBy: SourceUsage[];
  rating: ClinicalSourceRating;
  warnings: SourceCatalogueWarning[];
};

/**
 * A catalogue entry as the browser receives it.
 *
 * `rating.weights` is the `SOURCE_RATING_WEIGHTS` constant, byte-identical on
 * every entry, and `rating.reasons` restates `rating.dimensions` as prose
 * ("Reliability: 16/20"). Nothing in the application reads either one — the
 * method page imports the weights constant directly — so serialising them into
 * a list page shipped 266 KB of duplicated constant and derived text across 866
 * entries, about a fifth of that payload.
 *
 * Both stay on `ClinicalSourceCatalogueEntry`, because the rating record is the
 * governance artefact and `tests/source-catalogue-core.test.ts` pins its shape.
 * This is the narrower view that crosses the wire. Every list-page consumer is
 * typed against it, and a full entry still satisfies it, so a server-side caller
 * holding the complete record needs no change.
 */
export type ClinicalSourceClientRating = Omit<ClinicalSourceRating, "weights" | "reasons">;

export type ClinicalSourceClientEntry = Omit<ClinicalSourceCatalogueEntry, "rating"> & {
  rating: ClinicalSourceClientRating;
};

export type SourceCatalogueFilters = {
  q: string;
  bands: SourceQualityBand[];
  jurisdictions: SourceGeographyScope[];
  sourceTypes: ClinicalSourceType[];
  publishers: string[];
  topics: string[];
  lifecycleStatuses: SourceLifecycleStatus[];
  documentStatuses: ClinicalSourceReferenceInput["documentStatus"][];
  validationStatuses: ClinicalSourceReferenceInput["validationStatus"][];
  usedBy: AppModeId[];
  sort: "quality" | "title" | "currency";
};
