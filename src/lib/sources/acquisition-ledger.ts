import { createHash } from "node:crypto";

import { canonicalizeSourceReferences, safeHttpsUrl } from "@/lib/sources/catalogue-core";
import type {
  ClinicalSourceReferenceInput,
  ClinicalSourceType,
  SourceCatalogueWarning,
  SourceContentMode,
  SourceGeographyScope,
  SourceUsage,
} from "@/lib/sources/catalogue-types";
import { strictSourceDate } from "@/lib/sources/source-date-policy";
import acquisitionLedger from "@/data/source-acquisitions.json";

const TITLE_COLLATOR = new Intl.Collator("en-AU");

/**
 * Acquisition rungs are the search order the source-acquisition protocol follows:
 * exhaust local WA material before state, state before national, national before
 * other Australian states, and only then look overseas. The rung a record claims
 * is checked against the geography the catalogue independently derives from its
 * publisher, so a source cannot be filed at a rung it does not belong to.
 *
 * See docs/source-acquisition-protocol.md.
 */
export const SOURCE_ACQUISITION_RUNGS = [
  { rung: 1, label: "WA local (hospital or health service)", scope: "wa" },
  { rung: 2, label: "WA state", scope: "wa" },
  { rung: 3, label: "Australian national", scope: "australian_national" },
  { rung: 4, label: "Other Australian state", scope: "australian_state" },
  { rung: 5, label: "International", scope: "international" },
] as const satisfies readonly { rung: number; label: string; scope: SourceGeographyScope }[];

export type SourceAcquisitionRung = (typeof SOURCE_ACQUISITION_RUNGS)[number]["rung"];

/**
 * `adopted` sources are cited by clinical content and must be signed off.
 * `candidate` sources are captured and awaiting review, which is the ordinary
 * state of a freshly pulled source. `rejected` sources are kept deliberately so
 * the same ground is not searched twice; they enter the catalogue as excluded.
 */
export type SourceAcquisitionDisposition = "adopted" | "candidate" | "rejected";

/** Publishers frequently date a document to a year or month only. Recording the
 * precision keeps 2020-01-01 from being read as a real publication day. */
export type SourceAcquisitionDatePrecision = "day" | "month" | "year";

/**
 * How the publisher dates a source at all.
 *
 * `published` is a discrete publication event with a date, which is what most
 * guidelines, standards and manuals have.
 *
 * `continuously_updated` is a page the publisher maintains rather than issues, and
 * stamps with a review date instead. Healthdirect stamps every article
 * `Last reviewed: <Month Year>`; WA Health's articles carry a review day; the WA
 * Chief Psychiatrist's forms, AMHP and PMP registers carry no publication date
 * because there is no publication event to date. Requiring a publication date of
 * these meant the register could not hold Australia's most-used official clinical
 * web sources at all — thirteen of them, all governed WA, national or WHO
 * publishers, blocked not for missing metadata but for having the wrong shape of it.
 *
 * This is deliberately not a relaxation. A `continuously_updated` record must carry
 * a real review date and must not carry a publication date, so it asserts exactly
 * what the publisher says and nothing more. Recording a review date in
 * `publicationDate` would still be wrong, and is still rejected.
 *
 * `last_updated` is a maintained page whose publisher states only when it was last
 * updated — AIHW's monitoring hubs, the Royal Children's Hospital guidelines and
 * several WA agency pages. An update is a third event, neither a publication nor a
 * review: a page can be updated for a data refresh, a broken link or a typo without
 * anyone reviewing it. The owner decided on 2026-09-26 that the register may carry
 * that stamp, on condition that it is only ever shown and recorded as "last
 * updated". So a `last_updated` record carries the stamp in `lastUpdatedDate` and
 * must leave both `publicationDate` and `reviewDate` null; filing the stamp in
 * either would assert an event the publisher never stated, and is rejected.
 */
export type SourceDateModel = "published" | "continuously_updated" | "last_updated";

export type SourceAcquisitionRecord = {
  id: string;
  title: string;
  publisher: string;
  publisherCode: string | null;
  canonicalUrl: string | null;
  jurisdiction: string;
  version: string;
  publicationDate: string | null;
  /**
   * The precision of whichever date the record carries — `publicationDate` for a
   * published source, `reviewDate` for a continuously updated one, and
   * `lastUpdatedDate` for a last-updated one.
   */
  datePrecision: SourceAcquisitionDatePrecision;
  /** Omitted means `published`, which is the shape of most captures. */
  dateModel?: SourceDateModel;
  reviewDate: string | null;
  /**
   * The publisher's own "last updated" stamp, for a `last_updated` record only.
   * Omitted (or null) on every other date model. Never a publication or review date.
   */
  lastUpdatedDate?: string | null;
  expiryDate: string | null;
  evidenceType: Exclude<ClinicalSourceType, "unknown">;
  documentStatus: "current" | "review_due" | "outdated";
  validationStatus: "approved" | "locally_reviewed" | "unverified";
  contentMode: SourceContentMode;
  topics: string[];
  rung: SourceAcquisitionRung;
  capturedAt: string;
  capturedFor: string;
  disposition: SourceAcquisitionDisposition;
  dispositionReason: string | null;
  supersededBy: string[];
  notes: string | null;
  /**
   * Structured owner attestation. All three fields are optional, and they are the
   * owner's to write: no agent may record a sign-off on the owner's behalf.
   *
   * Until now a record said who signed it off and when only in prose, inside
   * `dispositionReason` and `notes`. Nothing read that prose, so the metadata
   * corrections of 2026-09-16 silently invalidated six earlier owner sign-offs and
   * the six records stayed `locally_reviewed` as though nothing had happened.
   *
   * `attestedAgainstSha256` pins the record's own content at the moment of
   * sign-off. A later edit to any field the attestation covers no longer matches
   * that digest, so `acquisitionLedgerIssues` reports the attestation as stale
   * instead of letting the record keep a review it no longer has. This is the
   * Therapy catalogue's proven `therapyReviewedContentSha256` pattern
   * (`scripts/lib/therapy-review-contract.mjs`), applied to the source ledger.
   */
  attestedBy?: string | null;
  /** A UTC ISO timestamp as `npm run clinical:review` writes it, or an exact YYYY-MM-DD date. */
  attestedAt?: string | null;
  attestedAgainstSha256?: string | null;
};

/**
 * The attestation fields themselves, which are excluded from the digest they
 * attest to — otherwise writing the digest would immediately invalidate it.
 */
export const ACQUISITION_ATTESTATION_FIELDS = ["attestedBy", "attestedAt", "attestedAgainstSha256"] as const;

const attestationFields = new Set<string>(ACQUISITION_ATTESTATION_FIELDS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalJson(record[key])]),
    );
  }
  return value;
}

/**
 * A content-only digest of a ledger record: changing any field other than the
 * attestation itself invalidates the sign-off that pinned it.
 */
export function acquisitionAttestedContentSha256(record: SourceAcquisitionRecord): string {
  const content = Object.fromEntries(Object.entries(record).filter(([key]) => !attestationFields.has(key)));
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(content)))
    .digest("hex");
}

/**
 * Warnings that mean the metadata itself is incomplete or contradictory. These
 * are what produced the existing D-band backlog, and no new capture may carry
 * one. `verification_unknown`, `outdated` and `superseded` are deliberately not
 * here: they are true governance states, not defects, and an unreviewed source
 * is the expected state of a fresh capture.
 */
export const ACQUISITION_METADATA_DEFECTS = [
  "ambiguous_identity",
  "invalid_date",
  "metadata_conflict",
  "missing_dates",
  "missing_publisher",
  "missing_version",
  "unknown_evidence_type",
  "unknown_jurisdiction",
  "unsafe_location",
] as const satisfies readonly SourceCatalogueWarning[];

const metadataDefects = new Set<SourceCatalogueWarning>(ACQUISITION_METADATA_DEFECTS);
const rungScopes = new Map(SOURCE_ACQUISITION_RUNGS.map((entry) => [entry.rung, entry.scope]));
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const sourceAcquisitionRecords = acquisitionLedger as readonly SourceAcquisitionRecord[];

/**
 * The catalogue reference for one ledger record. `usage` defaults to the
 * ledger's own row; a content surface that shows the record (a medication page)
 * passes its own usage so the catalogue traces where the source is used, while
 * every metadata field stays identical and the two merge into one entry.
 */
export function acquisitionReference(
  record: SourceAcquisitionRecord,
  usage: SourceUsage = {
    modeId: "sources",
    recordId: record.id,
    recordLabel: record.title,
    field: "acquisition_ledger",
  },
): ClinicalSourceReferenceInput {
  return {
    // Left null so a captured source shares catalogue identity with any content
    // reference to the same URL, rather than splitting into a second entry.
    sourceId: null,
    documentId: null,
    title: record.title,
    aliases: [],
    publisher: record.publisher,
    publisherCode: record.publisherCode,
    canonicalUrl: record.canonicalUrl,
    datasetLocation: null,
    version: record.version,
    publicationDate: record.publicationDate,
    reviewDate: record.reviewDate,
    // Carried only when present, so every other record's reference is unchanged.
    ...(record.lastUpdatedDate ? { lastUpdatedDate: record.lastUpdatedDate } : {}),
    expiryDate: record.expiryDate,
    jurisdiction: record.jurisdiction,
    evidenceType: record.evidenceType,
    documentStatus: record.documentStatus,
    validationStatus: record.validationStatus,
    contentMode: record.contentMode,
    lifecycleStatus: record.disposition === "rejected" ? "excluded" : "active",
    supersedes: [],
    supersededBy: record.supersededBy,
    topics: record.topics,
    usage,
    referenceText: null,
  };
}

export function acquisitionSourceReferences(
  records: readonly SourceAcquisitionRecord[] = sourceAcquisitionRecords,
): ClinicalSourceReferenceInput[] {
  return records.map((record) => acquisitionReference(record));
}

/** The warnings the real catalogue pipeline raises for one record on its own. */
export function acquisitionRecordWarnings(record: SourceAcquisitionRecord): SourceCatalogueWarning[] {
  const [entry] = canonicalizeSourceReferences([acquisitionReference(record)]);
  return entry ? entry.warnings : [];
}

export function acquisitionRecordGeography(record: SourceAcquisitionRecord): SourceGeographyScope {
  const [entry] = canonicalizeSourceReferences([acquisitionReference(record)]);
  return entry ? entry.geography.scope : "unknown";
}

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** A real UTC ISO instant (never an offset, never a rolled-over calendar value), or null. */
function strictUtcTimestamp(value: string): string | null {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const normalized = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return new Date(milliseconds).toISOString() === normalized ? value : null;
}

/** An optional field counts as written only when it carries real text. */
function presentText(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireText(value: string | null, field: string, id: string, issues: string[]) {
  if (!value?.trim()) issues.push(`${id}: ${field} is required`);
}

function requireStrictDate(value: string | null, field: string, id: string, issues: string[]) {
  if (value !== null && !strictSourceDate(value)) {
    issues.push(`${id}: ${field} must be an exact YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
}

/**
 * Every rule a capture must satisfy before it is allowed into the register.
 * Returns human-readable issues; an empty array means the ledger is clean.
 */
export function acquisitionLedgerIssues(
  records: readonly SourceAcquisitionRecord[] = sourceAcquisitionRecords,
): string[] {
  const issues: string[] = [];
  const seenIds = new Set<string>();

  for (const record of records) {
    const id = record.id || "(record with no id)";
    if (!idPattern.test(record.id ?? "")) {
      issues.push(`${id}: id must be a lower-case hyphenated slug`);
    }
    if (seenIds.has(record.id)) issues.push(`${id}: duplicate ledger id`);
    seenIds.add(record.id);

    // Identity is required of every record, including a rejection: without it the
    // same source cannot be recognised the next time it surfaces in a search.
    requireText(record.title, "title", id, issues);
    requireText(record.publisher, "publisher", id, issues);
    requireText(record.jurisdiction, "jurisdiction", id, issues);
    requireText(record.capturedFor, "capturedFor", id, issues);
    requireStrictDate(record.publicationDate, "publicationDate", id, issues);
    requireStrictDate(record.reviewDate, "reviewDate", id, issues);
    requireStrictDate(record.lastUpdatedDate ?? null, "lastUpdatedDate", id, issues);
    requireStrictDate(record.expiryDate, "expiryDate", id, issues);
    requireStrictDate(record.capturedAt, "capturedAt", id, issues);
    if (!record.capturedAt) issues.push(`${id}: capturedAt is required`);
    // The update stamp is its own event and belongs only to the date model that
    // says so; on any other record it would render as a date nobody asserted.
    if (record.lastUpdatedDate && record.dateModel !== "last_updated") {
      issues.push(
        `${id}: lastUpdatedDate is recorded only under dateModel "last_updated"; ` +
          `set dateModel to "last_updated" or remove lastUpdatedDate.`,
      );
    }

    // Completeness is required only of sources still in play. Metadata that could
    // not be established is frequently the reason a source was rejected, and a
    // rejection must stay recordable so the ground is not searched again.
    if (record.disposition !== "rejected") {
      requireText(record.version, "version", id, issues);

      // A continuously updated page is dated by its review stamp, and a
      // last-updated page by its update stamp, so that is the date the precision
      // rules apply to — and neither may also claim an event it does not have.
      const continuous = record.dateModel === "continuously_updated";
      const lastUpdated = record.dateModel === "last_updated";
      const datedField = lastUpdated ? "lastUpdatedDate" : continuous ? "reviewDate" : "publicationDate";
      const dated = lastUpdated
        ? (record.lastUpdatedDate ?? null)
        : continuous
          ? record.reviewDate
          : record.publicationDate;

      if (!dated) issues.push(`${id}: ${datedField} is required`);
      if (continuous && record.publicationDate) {
        issues.push(
          `${id}: a continuously updated source has no publication event. Record the publisher's review ` +
            `date in reviewDate and leave publicationDate null, or set dateModel to "published".`,
        );
      }
      if (lastUpdated && record.publicationDate) {
        issues.push(
          `${id}: a last-updated source has no publication event. Record the publisher's update stamp ` +
            `in lastUpdatedDate and leave publicationDate null, or set dateModel to "published".`,
        );
      }
      if (lastUpdated && record.reviewDate) {
        issues.push(
          `${id}: a last-updated source states no review. An update is not a review, so record the ` +
            `publisher's update stamp in lastUpdatedDate and leave reviewDate null, or set dateModel ` +
            `to "continuously_updated" if the publisher states a review.`,
        );
      }
      if (record.datePrecision === "year" && !dated?.endsWith("-01-01")) {
        issues.push(`${id}: year-precision ${datedField} must be recorded as the first of January`);
      }
      if (record.datePrecision === "month" && !dated?.endsWith("-01")) {
        issues.push(`${id}: month-precision ${datedField} must be recorded as the first of the month`);
      }
    }

    if (record.canonicalUrl && !safeHttpsUrl(record.canonicalUrl)) {
      let host = "(unparseable URL)";
      try {
        host = new URL(record.canonicalUrl).hostname;
      } catch {
        host = "(unparseable URL)";
      }
      issues.push(
        `${id}: ${host} is not a governed source host. Add it to GOVERNED_SOURCE_HOSTS in ` +
          `src/lib/sources/source-url-policy.ts and update the pinned host count, or drop the URL.`,
      );
    }

    const expectedScope = rungScopes.get(record.rung);
    if (!expectedScope) {
      issues.push(`${id}: rung must be one of 1, 2, 3, 4 or 5`);
    } else {
      const scope = acquisitionRecordGeography(record);
      if (scope === "unknown") {
        issues.push(
          `${id}: publisher ${JSON.stringify(record.publisher)} is not in the source authority register, ` +
            `so the catalogue cannot place it in a jurisdiction and it can never leave D band. ` +
            `Registering it changes retrieval selection, so raise it with the owner before editing ` +
            `src/lib/source-authority-registry.ts.`,
        );
      } else if (scope !== expectedScope) {
        issues.push(
          `${id}: filed at rung ${record.rung} (expects ${expectedScope}) but the register places it in ${scope}`,
        );
      }
    }

    if (record.disposition === "adopted" && record.validationStatus === "unverified") {
      issues.push(`${id}: an adopted source must be reviewed before clinical content cites it`);
    }
    if (record.disposition !== "adopted" && !record.dispositionReason?.trim()) {
      issues.push(`${id}: a ${record.disposition} source must record why`);
    }

    // Structured attestation. A record carries none until the owner writes one, so
    // absence is normal and never an issue. Once written, the sign-off must name
    // who and when, and must still be against the record as it now stands — the
    // check the six silently invalidated 2026-09-16 sign-offs had no way to fail.
    const attestation = ACQUISITION_ATTESTATION_FIELDS.filter((field) => presentText(record[field]) !== null);
    if (attestation.length > 0 && attestation.length < ACQUISITION_ATTESTATION_FIELDS.length) {
      const missing = ACQUISITION_ATTESTATION_FIELDS.filter((field) => presentText(record[field]) === null);
      issues.push(
        `${id}: an attestation must record attestedBy, attestedAt and attestedAgainstSha256; missing ${missing.join(", ")}`,
      );
    }
    // `npm run clinical:review -- --kind source` writes the exact UTC instant of the
    // sign-off, the same rule every other sign-off kind holds; a bare date is still
    // accepted for an attestation written by hand.
    const attestedAt = presentText(record.attestedAt);
    if (!attestedAt || !strictUtcTimestamp(attestedAt)) requireStrictDate(attestedAt, "attestedAt", id, issues);
    const attestedAgainst = presentText(record.attestedAgainstSha256);
    if (attestedAgainst && !SHA256_PATTERN.test(attestedAgainst)) {
      issues.push(`${id}: attestedAgainstSha256 must be a lower-case 64-character SHA-256 digest`);
    } else if (attestedAgainst && attestedAgainst !== acquisitionAttestedContentSha256(record)) {
      issues.push(`${id}: attestedAgainstSha256 is stale; content changed after sign-off`);
    }

    if (record.disposition !== "rejected") {
      const defects = acquisitionRecordWarnings(record).filter((warning) => metadataDefects.has(warning));
      if (defects.length > 0) {
        issues.push(`${id}: incomplete source metadata (${defects.join(", ")})`);
      }
    }
  }

  return issues;
}

/** Records awaiting the owner's clinical sign-off, worst rung first. */
export function acquisitionReviewQueue(records: readonly SourceAcquisitionRecord[] = sourceAcquisitionRecords) {
  return records
    .filter((record) => record.disposition !== "rejected" && record.validationStatus === "unverified")
    .sort((left, right) => left.rung - right.rung || TITLE_COLLATOR.compare(left.title, right.title));
}
