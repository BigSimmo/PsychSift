/**
 * Build an offline, owner-reviewed first-publication catalogue plan for Services (222) and
 * Forms (54) (#HTZPQ8 / #ZPHK2F).
 *
 * WHY THIS EXISTS
 * ---------------
 * Owner decision 2026-09-25 (#ZPHK2F): the 222 service rows and 54 form rows go public through
 * the administrator first-publication flow in owner-approved batches, each batch clinically
 * signed off by a named person (`isNamedPerson`). They must NOT be forced through the adoption
 * reconciliation triage by relaxing `reconcileCanonicalPublicSiteContent`.
 *
 * SAFETY GATES
 * ------------
 * 1. Fail-closed clinical sign-off check: every record included in the plan must carry
 *    `status === "reviewed"`, a named human reviewer (`isNamedPerson(reviewedBy)` — rejecting
 *    `"PsychSift"`, `"System"`, bare titles, etc.), and a valid UTC `reviewedAt` timestamp.
 * 2. Offline by default: `--dry-run` and `--out <path>` never import or call a live Supabase
 *    client. Live execution requires BOTH `--execute` and `ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT=true`.
 *
 * USAGE
 *   node scripts/run-tsx.mjs scripts/publish-site-content-first-catalogue.ts --dry-run
 *   node scripts/run-tsx.mjs scripts/publish-site-content-first-catalogue.ts \
 *     --kind all --batch-size 100 --out first-publication-plan.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isNamedPerson } from "@/lib/admin/rule-sign-off";
import { formRecords, type FormRecord } from "@/lib/forms";
import { clinicalRegistryRowsToCorpusEntries } from "@/lib/registry-corpus";
import { recordToRow, type RegistryRecordRow } from "@/lib/registry-records";
import { defaultServiceRecords } from "@/lib/registry-fixtures";
import type { ServiceRecord } from "@/lib/services";
import { dynamicLogicalId } from "@/lib/site-content/adapters";
import {
  canonicalRegistrySiteContentProjection,
  expectedCanonicalPublicRegistrySnapshot,
  registryEntryToSiteContentRecord,
  type CanonicalPublicRegistrySnapshot,
  type CanonicalRegistrySiteContentProjection,
} from "@/lib/site-content/adapters/registry";
import { compareCanonicalSiteContentIdentifiers, siteContentValueHash } from "@/lib/site-content/site-content-manifest";
import { reconciliationHash } from "@/lib/site-content/site-content-reconciliation";

export type FirstPublicationKind = "service" | "form" | "all";

export type ClinicalSignOffEntry = {
  id?: string;
  code?: string;
  slug?: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedContentSha256?: string | null;
};

export type FirstPublicationRejectedRecord = {
  kind: "service" | "form";
  recordId: string;
  slug: string;
  reason: string;
};

export type FirstPublicationBatch = {
  batchIndex: number;
  logicalIds: string[];
  records: CanonicalRegistrySiteContentProjection[];
};

export type FirstPublicationCataloguePlan = {
  version: "site-content-first-publication-plan-v1";
  kind: FirstPublicationKind;
  batchSize: number;
  batchCount: number;
  expectedRecordCount: number;
  counts: {
    services: number;
    forms: number;
    total: number;
  };
  trustedSnapshotDigest: string;
  planDigest: string;
  trustedSnapshots: CanonicalPublicRegistrySnapshot[];
  batches: FirstPublicationBatch[];
};

export type BuildFirstPublicationOptions = {
  kind?: FirstPublicationKind;
  batchSize?: number;
  services?: readonly ServiceRecord[];
  forms?: readonly FormRecord[];
  serviceReviews?: readonly ClinicalSignOffEntry[];
  formReviews?: readonly ClinicalSignOffEntry[];
  onlySlugs?: readonly string[];
};

export type FirstPublicationCliOptions = {
  kind: FirstPublicationKind;
  batchSize: number;
  dryRun: boolean;
  execute: boolean;
  out?: string;
  servicesReviewPath: string;
  formsReviewPath: string;
};

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function isValidReviewTimestamp(value: string | null | undefined): boolean {
  if (typeof value !== "string" || !ISO_TIMESTAMP_RE.test(value.trim())) return false;
  return Number.isFinite(Date.parse(value.trim()));
}

function validateSignOffEntry(
  kind: "service" | "form",
  recordId: string,
  slug: string,
  review: ClinicalSignOffEntry | undefined,
): FirstPublicationRejectedRecord | null {
  if (!review) {
    return {
      kind,
      recordId,
      slug,
      reason: "missing clinical review record",
    };
  }
  if (review.status !== "reviewed") {
    return {
      kind,
      recordId,
      slug,
      reason: `status is "${review.status}" (requires "reviewed")`,
    };
  }
  if (
    typeof review.reviewedContentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(review.reviewedContentSha256.trim())
  ) {
    return {
      kind,
      recordId,
      slug,
      reason: "reviewedContentSha256 is missing or is not a valid SHA-256 content pin",
    };
  }
  if (!isNamedPerson(review.reviewedBy)) {
    return {
      kind,
      recordId,
      slug,
      reason: `reviewedBy ${JSON.stringify(review.reviewedBy)} is not a named clinician (isNamedPerson check failed)`,
    };
  }
  if (!isValidReviewTimestamp(review.reviewedAt)) {
    return {
      kind,
      recordId,
      slug,
      reason: `reviewedAt ${JSON.stringify(review.reviewedAt)} is not a valid UTC ISO timestamp`,
    };
  }
  return null;
}

function toOwnerlessRegistryRow(
  record: ServiceRecord | FormRecord,
  kind: "service" | "form",
  recordId: string,
  reviewedAt: string,
): RegistryRecordRow {
  const inserted = recordToRow(record, "00000000-0000-0000-0000-000000000000", kind);
  return {
    ...inserted,
    id: recordId,
    owner_id: null as unknown as string,
    validation_status: "locally_reviewed",
    created_at: reviewedAt,
    updated_at: reviewedAt,
  } as RegistryRecordRow;
}

export function buildFirstPublicationCataloguePlan(
  options: BuildFirstPublicationOptions = {},
): FirstPublicationCataloguePlan {
  const kind = options.kind ?? "all";
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("--batch-size must be an integer between 1 and 500.");
  }

  const slugFilter = options.onlySlugs ? new Set(options.onlySlugs.map((slug) => slug.trim().toLowerCase())) : null;
  const services =
    kind === "form"
      ? []
      : (options.services ?? defaultServiceRecords()).filter((record) =>
          slugFilter ? slugFilter.has(record.slug.toLowerCase()) : true,
        );
  const forms =
    kind === "service"
      ? []
      : (options.forms ?? formRecords).filter((record) =>
          slugFilter ? slugFilter.has(record.slug.toLowerCase()) : true,
        );

  const serviceReviews = options.serviceReviews ?? loadDefaultServiceReviews();
  const formReviews = options.formReviews ?? loadDefaultFormReviews();

  const serviceReviewByKey = new Map<string, ClinicalSignOffEntry>();
  for (const entry of serviceReviews) {
    for (const candidateKey of [entry.id, entry.slug, entry.code]) {
      if (typeof candidateKey === "string" && candidateKey.trim()) {
        serviceReviewByKey.set(candidateKey.trim().toLowerCase(), entry);
      }
    }
  }

  const formReviewByKey = new Map<string, ClinicalSignOffEntry>();
  for (const entry of formReviews) {
    for (const candidateKey of [entry.code, entry.id, entry.slug]) {
      if (typeof candidateKey === "string" && candidateKey.trim()) {
        formReviewByKey.set(candidateKey.trim().toLowerCase(), entry);
      }
    }
  }

  const rejected: FirstPublicationRejectedRecord[] = [];
  const ownerlessRows: RegistryRecordRow[] = [];

  for (const service of services) {
    const serviceWithId = service as ServiceRecord & { id?: string };
    const stableId = String(service.catalogPayload?.stableId ?? serviceWithId.id ?? service.slug).trim();
    const review =
      serviceReviewByKey.get(stableId.toLowerCase()) ??
      serviceReviewByKey.get(service.slug.trim().toLowerCase()) ??
      (serviceWithId.id ? serviceReviewByKey.get(serviceWithId.id.trim().toLowerCase()) : undefined);
    const problem = validateSignOffEntry("service", stableId, service.slug, review);
    if (problem) {
      rejected.push(problem);
      continue;
    }
    ownerlessRows.push(toOwnerlessRegistryRow(service, "service", stableId, review!.reviewedAt!.trim()));
  }

  for (const form of forms) {
    const formWithOptionalFields = form as FormRecord & { id?: string; formNumber?: string };
    const payload = (form.catalogPayload ?? {}) as { form?: string; id?: string };
    const rawFormCode =
      payload.form ??
      formWithOptionalFields.formNumber ??
      form.catalogueLabel ??
      form.primaryContact?.value ??
      form.slug;
    const formCode = String(rawFormCode)
      .replace(/^Form\s+/i, "")
      .trim();
    const formRecordId = String(payload.id ?? formWithOptionalFields.id ?? form.slug).trim();
    const review =
      formReviewByKey.get(formCode.toLowerCase()) ??
      formReviewByKey.get(form.slug.trim().toLowerCase()) ??
      formReviewByKey.get(formRecordId.toLowerCase());
    const problem = validateSignOffEntry("form", formCode, form.slug, review);
    if (problem) {
      rejected.push(problem);
      continue;
    }
    ownerlessRows.push(toOwnerlessRegistryRow(form, "form", formRecordId, review!.reviewedAt!.trim()));
  }

  if (rejected.length > 0) {
    const preview = rejected
      .slice(0, 10)
      .map((item) => `  - [${item.kind}] ${item.recordId} (${item.slug}): ${item.reason}`)
      .join("\n");
    const remainder = rejected.length > 10 ? `\n  ...and ${rejected.length - 10} more record(s).` : "";
    throw new Error(
      `First-publication plan refused: ${rejected.length} record(s) lack clinical sign-off by a named person:\n${preview}${remainder}`,
    );
  }

  if (ownerlessRows.length === 0) {
    throw new Error("First-publication plan refused: no signed-off records matched the selection.");
  }

  const corpusEntries = clinicalRegistryRowsToCorpusEntries(ownerlessRows);
  const projections: CanonicalRegistrySiteContentProjection[] = [];
  const trustedSnapshots: CanonicalPublicRegistrySnapshot[] = [];

  const sortedEntries = [...corpusEntries].sort((left, right) =>
    compareCanonicalSiteContentIdentifiers(dynamicLogicalId(left), dynamicLogicalId(right)),
  );

  for (const entry of sortedEntries) {
    const logicalId = dynamicLogicalId(entry);
    const sourceLineage = [
      {
        sourceId:
          entry.kind === "service"
            ? `repository:data/services-snapshot.json#${entry.slug}`
            : `repository:data/forms-catalog.json#${entry.slug}`,
        sourceHash: siteContentValueHash(entry),
        relationship: "derived_from" as const,
      },
    ];
    const siteRecord = registryEntryToSiteContentRecord(entry, { logicalId, sourceLineage });
    const snapshot = expectedCanonicalPublicRegistrySnapshot(entry.recordId, siteRecord);
    const projection = canonicalRegistrySiteContentProjection(
      entry,
      {
        logicalId,
        publicRecordId: entry.recordId,
        rowOwnerId: null,
        publicationState: "published",
        renderedByPublicSite: true,
        explicitlyReconciled: true,
        sourceLineage,
      },
      snapshot,
    );
    trustedSnapshots.push(snapshot);
    projections.push(projection);
  }

  const batches: FirstPublicationBatch[] = [];
  for (let offset = 0; offset < projections.length; offset += batchSize) {
    const slice = projections.slice(offset, offset + batchSize);
    batches.push({
      batchIndex: batches.length,
      logicalIds: slice.map((item) => item.record.logicalId),
      records: slice,
    });
  }

  const trustedSnapshotDigest = reconciliationHash({
    version: "site-content-trusted-snapshot-v1",
    records: trustedSnapshots,
  });

  const unsignedPlan = {
    version: "site-content-first-publication-plan-v1" as const,
    kind,
    batchSize,
    batchCount: batches.length,
    expectedRecordCount: projections.length,
    counts: {
      services: services.length,
      forms: forms.length,
      total: projections.length,
    },
    trustedSnapshotDigest,
    trustedSnapshots,
    batches,
  };

  return {
    ...unsignedPlan,
    planDigest: reconciliationHash(unsignedPlan),
  };
}

function loadDefaultServiceReviews(path = "data/service-records-review.json"): ClinicalSignOffEntry[] {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as { entries?: ClinicalSignOffEntry[] };
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

function loadDefaultFormReviews(path = "data/forms-content-review.json"): ClinicalSignOffEntry[] {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as { forms?: ClinicalSignOffEntry[] };
  return Array.isArray(parsed.forms) ? parsed.forms : [];
}

export function parseFirstPublicationCliArgs(argv: readonly string[]): FirstPublicationCliOptions {
  const options: FirstPublicationCliOptions = {
    kind: "all",
    batchSize: 100,
    dryRun: false,
    execute: false,
    servicesReviewPath: "data/service-records-review.json",
    formsReviewPath: "data/forms-content-review.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--execute") {
      options.execute = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Flag ${flag} requires a value.`);
    }
    index += 1;
    if (flag === "--kind") {
      if (value !== "service" && value !== "form" && value !== "all") {
        throw new Error("--kind must be service, form, or all.");
      }
      options.kind = value;
    } else if (flag === "--batch-size") {
      options.batchSize = Number(value);
    } else if (flag === "--out") {
      options.out = value;
    } else if (flag === "--services-review") {
      options.servicesReviewPath = value;
    } else if (flag === "--forms-review") {
      options.formsReviewPath = value;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (options.execute && options.dryRun) {
    throw new Error("Specify at most one of --dry-run or --execute.");
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500) {
    throw new Error("--batch-size must be an integer between 1 and 500.");
  }
  return options;
}

export async function runFirstPublicationCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirstPublicationCataloguePlan> {
  const options = parseFirstPublicationCliArgs(argv);
  if (options.execute && env.ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT !== "true") {
    throw new Error(
      "Refusing live first-publication execution: --execute requires ALLOW_DESTRUCTIVE_SITE_CONTENT_INIT=true.",
    );
  }

  if (options.execute) {
    throw new Error("--execute is not implemented; run without it to generate a publication plan.");
  }

  const plan = buildFirstPublicationCataloguePlan({
    kind: options.kind,
    batchSize: options.batchSize,
    serviceReviews: loadDefaultServiceReviews(options.servicesReviewPath),
    formReviews: loadDefaultFormReviews(options.formsReviewPath),
  });

  if (options.out) {
    writeFileSync(resolve(options.out), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }

  return plan;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runFirstPublicationCli().then(
    (plan) => {
      console.log(
        `First-publication plan ready: ${plan.counts.total} record(s) across ${plan.batchCount} batch(es) (digest ${plan.planDigest}).`,
      );
    },
    (error) => {
      console.error(`publish-site-content-first-catalogue: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
