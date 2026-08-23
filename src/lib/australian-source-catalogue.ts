import verificationManifest from "../../data/australian-source-verification.v1.json";

import type { ClinicalSourceRole, SourceCorpusScope } from "@/lib/types";

export type SourceContentMode = "indexed_content" | "link_only";
export type SourceLifecycle = "active" | "historical" | "retired";
export type SourceLicencePolicy =
  "review_required" | "public_index_permitted" | "metadata_link_only" | "index_forbidden";

export type AustralianSourceDefinition = Readonly<{
  key: string;
  publisherCode: string;
  publisher: string;
  canonicalUrl: string;
  jurisdiction: string;
  corpusScope: Extract<SourceCorpusScope, "australian_public">;
  roles: readonly ClinicalSourceRole[];
  contentMode: SourceContentMode;
  licencePolicy: SourceLicencePolicy;
  lifecycle: SourceLifecycle;
  fallbackRank: number;
}>;

type AustralianSourceVerificationRow = AustralianSourceDefinition &
  Readonly<{
    checkedAt: string;
    reviewerRole: string;
    evidenceReference: string;
  }>;

type AustralianSourceVerificationManifest = Readonly<{
  schemaVersion: "australian-source-verification-v1";
  policyVersion: typeof australianSourcePolicyVersion;
  connectedVerificationRequired: true;
  sources: readonly AustralianSourceVerificationRow[];
}>;

export const australianSourcePolicyVersion = "australian-source-policy-v1" as const;

const sourceRoles = new Set<ClinicalSourceRole>([
  "local_guideline",
  "clinical_guideline",
  "clinical_reference",
  "service_directory",
  "form_reference",
  "tool_reference",
  "safety_alert",
  "regulatory",
  "quality_standard",
  "legal",
  "subsidy",
  "professional_review",
  "service_policy",
  "reference_link",
]);
const contentModes = new Set<SourceContentMode>(["indexed_content", "link_only"]);
const licencePolicies = new Set<SourceLicencePolicy>([
  "review_required",
  "public_index_permitted",
  "metadata_link_only",
  "index_forbidden",
]);
const lifecycles = new Set<SourceLifecycle>(["active", "historical", "retired"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isVerificationRow(value: unknown): value is AustralianSourceVerificationRow {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.publisherCode) &&
    isNonEmptyString(value.publisher) &&
    isHttpsUrl(value.canonicalUrl) &&
    isNonEmptyString(value.jurisdiction) &&
    value.corpusScope === "australian_public" &&
    Array.isArray(value.roles) &&
    value.roles.length > 0 &&
    value.roles.every((role) => sourceRoles.has(role as ClinicalSourceRole)) &&
    contentModes.has(value.contentMode as SourceContentMode) &&
    licencePolicies.has(value.licencePolicy as SourceLicencePolicy) &&
    lifecycles.has(value.lifecycle as SourceLifecycle) &&
    Number.isSafeInteger(value.fallbackRank) &&
    Number(value.fallbackRank) >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value.checkedAt)) &&
    isNonEmptyString(value.reviewerRole) &&
    isNonEmptyString(value.evidenceReference)
  );
}

function assertVerificationManifest(input: unknown): asserts input is AustralianSourceVerificationManifest {
  if (!isRecord(input)) throw new Error("Australian source verification manifest must be an object.");
  if (input.schemaVersion !== "australian-source-verification-v1") {
    throw new Error("Unsupported Australian source verification manifest version.");
  }
  if (input.policyVersion !== australianSourcePolicyVersion) {
    throw new Error("Australian source verification policy version does not match the catalogue.");
  }
  if (input.connectedVerificationRequired !== true) {
    throw new Error("Australian source verification must retain its connected review checkpoint.");
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0 || !input.sources.every(isVerificationRow)) {
    throw new Error("Australian source verification contains an invalid source row.");
  }

  const keys = new Set<string>();
  const canonicalUrls = new Set<string>();
  for (const source of input.sources) {
    if (keys.has(source.key)) throw new Error(`Duplicate Australian source key: ${source.key}`);
    if (canonicalUrls.has(source.canonicalUrl)) {
      throw new Error(`Duplicate Australian source canonical URL: ${source.canonicalUrl}`);
    }
    if (/healthdirect/i.test(`${source.key} ${source.publisher} ${source.canonicalUrl}`)) {
      throw new Error("Healthdirect is excluded from the Australian source catalogue.");
    }
    if (source.contentMode === "link_only" && source.licencePolicy !== "metadata_link_only") {
      throw new Error(`Link-only Australian source ${source.key} must use metadata_link_only policy.`);
    }
    if (source.contentMode === "indexed_content" && source.licencePolicy === "metadata_link_only") {
      throw new Error(`Indexed Australian source ${source.key} cannot use metadata_link_only policy.`);
    }
    keys.add(source.key);
    canonicalUrls.add(source.canonicalUrl);
  }
}

const reviewedVerificationManifest: unknown = verificationManifest;
assertVerificationManifest(reviewedVerificationManifest);

export const australianSourceCatalogue: readonly AustralianSourceDefinition[] = Object.freeze(
  reviewedVerificationManifest.sources.map(
    ({ checkedAt: _checkedAt, reviewerRole: _reviewerRole, evidenceReference: _evidenceReference, ...source }) =>
      Object.freeze({ ...source, roles: Object.freeze([...source.roles]) }),
  ),
);

const australianSourceCatalogueByKey = new Map(australianSourceCatalogue.map((source) => [source.key, source]));

export function australianSourceByKey(key: string): AustralianSourceDefinition | null {
  return australianSourceCatalogueByKey.get(key) ?? null;
}

export function isIndexableAustralianSource(key: string, exactDocumentLicence: SourceLicencePolicy): boolean {
  const source = australianSourceByKey(key);
  return (
    source?.contentMode === "indexed_content" &&
    source.lifecycle === "active" &&
    source.licencePolicy !== "index_forbidden" &&
    exactDocumentLicence === "public_index_permitted"
  );
}

export function assertIndexableCatalogueEntry(
  source: AustralianSourceDefinition | null,
): asserts source is AustralianSourceDefinition {
  if (!source) throw new Error("Unknown Australian source catalogue entry.");
  if (source.contentMode === "link_only") {
    throw new Error(`Australian source ${source.key} is link-only and cannot enter a content-bearing index.`);
  }
  if (source.lifecycle !== "active") {
    throw new Error(`Australian source ${source.key} is ${source.lifecycle} and cannot enter a current index.`);
  }
  if (source.licencePolicy === "index_forbidden" || source.licencePolicy === "metadata_link_only") {
    throw new Error(`Australian source ${source.key} has a non-indexable catalogue licence policy.`);
  }
}
