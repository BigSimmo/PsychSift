import { createHash } from "node:crypto";

import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import {
  assertSiteContentRecordEligible,
  siteContentProducerForDomain,
} from "@/lib/site-content/site-content-registry";
import type { SiteContentDomain } from "@/lib/types";

export type StaticSiteContentManifest = {
  version: "clinical-kb-site-static-manifest-v1";
  gitSha: string;
  registryVersion: string;
  generatedAt: string;
  records: Array<{
    logicalId: string;
    domain: SiteContentDomain;
    route: string;
    contentHash: string;
    lineageDigest: string;
    validationStatus: SiteContentRecord["validationStatus"];
    sourceStatus: SiteContentRecord["sourceStatus"];
    eligible: boolean;
    exclusionReason: string | null;
  }>;
  staticManifestDigest: string;
};

export type StaticSiteContentManifestDiff = {
  baselineDigest: string;
  candidateDigest: string;
  added: string[];
  removed: string[];
  changed: string[];
};

type SiteContentRecordInput = Omit<SiteContentRecord, "version" | "contentHash"> & {
  version?: SiteContentRecord["version"];
  contentHash?: string;
};

const recordKeys = new Set([
  "version",
  "logicalId",
  "producerClass",
  "domain",
  "route",
  "title",
  "body",
  "sourceRole",
  "access",
  "validationStatus",
  "sourceStatus",
  "publicationVersion",
  "sourceLineage",
  "contentHash",
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function siteContentSha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : stableJson(value))
    .digest("hex")}`;
}

export function canonicalSiteContentWhitespace(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertCanonicalRoute(route: string) {
  if (
    !route.startsWith("/") ||
    route.length < 2 ||
    route.includes("//") ||
    route.includes("?") ||
    route.includes("#") ||
    route.includes("\\") ||
    /\s/.test(route) ||
    route.split("/").some((segment) => segment === "." || segment === "..") ||
    (route.endsWith("/") && route !== "/")
  ) {
    throw new Error(`Site-content route ${JSON.stringify(route)} is not canonical.`);
  }
}

function assertNoActorIdentity(value: unknown) {
  const serialized = stableJson(value);
  if (
    /"(?:ownerId|owner_id|actorId|actor_id|created_by|updated_by|published_by|administratorId|administrator_id)"/i.test(
      serialized,
    ) ||
    /\b(?:owner|actor|administrator)[-_ ](?:id\b|[a-z]*\d[a-z0-9-]*)/i.test(serialized)
  ) {
    throw new Error("Site-content records and digests cannot contain owner, actor, or administrator identity.");
  }
}

function canonicalLineage(lineage: SiteContentRecord["sourceLineage"]) {
  const normalized = lineage.map((item) => ({
    sourceId: canonicalSiteContentWhitespace(item.sourceId).toLowerCase(),
    sourceHash: canonicalSiteContentWhitespace(item.sourceHash).toLowerCase(),
    relationship: item.relationship,
  }));
  const encoded = normalized.map(stableJson).sort();
  if (new Set(encoded).size !== encoded.length) {
    throw new Error("Site-content source lineage contains an exact duplicate.");
  }
  return encoded.map((item) => JSON.parse(item) as SiteContentRecord["sourceLineage"][number]);
}

function canonicalRecordIdentity(record: Omit<SiteContentRecord, "contentHash">) {
  return {
    version: record.version,
    logicalId: record.logicalId,
    producerClass: record.producerClass,
    domain: record.domain,
    route: record.route,
    title: record.title,
    body: record.body,
    sourceRole: record.sourceRole,
    access: record.access,
    validationStatus: record.validationStatus,
    sourceStatus: record.sourceStatus,
    publicationVersion: record.publicationVersion,
    sourceLineage: record.sourceLineage,
  };
}

export function createSiteContentRecord(input: SiteContentRecordInput): SiteContentRecord {
  const logicalId = canonicalSiteContentWhitespace(input.logicalId).toLowerCase();
  const route = canonicalSiteContentWhitespace(input.route);
  const title = canonicalSiteContentWhitespace(input.title);
  const body = canonicalSiteContentWhitespace(input.body);
  const publicationVersion = canonicalSiteContentWhitespace(input.publicationVersion);
  const sourceLineage = canonicalLineage(input.sourceLineage);
  assertCanonicalRoute(route);
  if (!/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$/.test(logicalId)) {
    throw new Error(`Site-content logical ID ${JSON.stringify(logicalId)} is not canonical.`);
  }
  if (!title || !body || !publicationVersion) {
    throw new Error(`Site-content record ${logicalId} requires title, body, and publication version.`);
  }
  assertNoActorIdentity({ logicalId, route, title, body, publicationVersion, sourceLineage });
  const canonical = {
    version: "site-content-record-v1" as const,
    logicalId,
    producerClass: input.producerClass,
    domain: input.domain,
    route,
    title,
    body,
    sourceRole: input.sourceRole,
    access: input.access,
    validationStatus: input.validationStatus,
    sourceStatus: input.sourceStatus,
    publicationVersion,
    sourceLineage,
  };
  return { ...canonical, contentHash: siteContentSha256(canonicalRecordIdentity(canonical)) };
}

function assertSiteContentRecord(record: SiteContentRecord) {
  const unknownKeys = Object.keys(record).filter((key) => !recordKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Site-content record ${record.logicalId} contains owner, actor, audit, or unknown fields.`);
  }
  assertNoActorIdentity(record);
  if (record.access !== "public") throw new Error(`Site-content record ${record.logicalId} must be public.`);
  const canonical = createSiteContentRecord(record);
  if (stableJson(record) !== stableJson(canonical)) {
    throw new Error(`Site-content record ${record.logicalId} is non-canonical or has an invalid content hash.`);
  }
  const producer = siteContentProducerForDomain(record.domain);
  if (!producer || producer.producerClass !== record.producerClass) {
    throw new Error(`Site-content record ${record.logicalId} has no matching registered producer.`);
  }
}

function recordEligibility(record: SiteContentRecord) {
  const producer = siteContentProducerForDomain(record.domain)!;
  if (producer.activationState !== "eligible") {
    return { eligible: false, exclusionReason: producer.ineligibilityReason ?? "producer_review_required" };
  }
  try {
    assertSiteContentRecordEligible(record);
    return { eligible: true, exclusionReason: null };
  } catch {
    if (record.validationStatus === "unverified") {
      return { eligible: false, exclusionReason: "validation_status_unverified" };
    }
    if (record.sourceStatus !== "current") {
      return { eligible: false, exclusionReason: `source_status_${record.sourceStatus}` };
    }
    return { eligible: false, exclusionReason: "record_not_eligible" };
  }
}

export function buildStaticSiteContentManifest(
  records: readonly SiteContentRecord[],
  metadata: { gitSha: string; registryVersion: string },
  options: { generatedAt?: string } = {},
): StaticSiteContentManifest {
  const logicalIds = new Set<string>();
  for (const record of records) {
    assertSiteContentRecord(record);
    if (logicalIds.has(record.logicalId)) throw new Error(`Duplicate site-content logical ID: ${record.logicalId}.`);
    logicalIds.add(record.logicalId);
  }

  const manifestRecords = records
    .filter((record) => record.producerClass === "static_repository")
    .map((record) => {
      const eligibility = recordEligibility(record);
      return {
        logicalId: record.logicalId,
        domain: record.domain,
        route: record.route,
        contentHash: record.contentHash,
        lineageDigest: siteContentSha256(canonicalLineage(record.sourceLineage)),
        validationStatus: record.validationStatus,
        sourceStatus: record.sourceStatus,
        ...eligibility,
      };
    })
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));

  const digestPayload = {
    version: "clinical-kb-site-static-manifest-v1",
    registryVersion: metadata.registryVersion,
    records: manifestRecords,
  };
  assertNoActorIdentity(digestPayload);
  return {
    version: "clinical-kb-site-static-manifest-v1",
    gitSha: metadata.gitSha,
    registryVersion: metadata.registryVersion,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    records: manifestRecords,
    staticManifestDigest: siteContentSha256(digestPayload),
  };
}

export function diffStaticSiteContentManifests(
  baseline: StaticSiteContentManifest,
  candidate: StaticSiteContentManifest,
): StaticSiteContentManifestDiff {
  const baselineById = new Map(baseline.records.map((record) => [record.logicalId, record]));
  const candidateById = new Map(candidate.records.map((record) => [record.logicalId, record]));
  const added = [...candidateById.keys()].filter((id) => !baselineById.has(id)).sort();
  const removed = [...baselineById.keys()].filter((id) => !candidateById.has(id)).sort();
  const changed = [...candidateById.keys()]
    .filter((id) => baselineById.has(id) && stableJson(baselineById.get(id)) !== stableJson(candidateById.get(id)))
    .sort();
  return {
    baselineDigest: baseline.staticManifestDigest,
    candidateDigest: candidate.staticManifestDigest,
    added,
    removed,
    changed,
  };
}
