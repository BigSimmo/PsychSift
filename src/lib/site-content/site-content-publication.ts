import "server-only";

import { createHash } from "node:crypto";

import { curatedEntryFor } from "@/lib/differential-curated";
import { withholdGeneratedBody } from "@/lib/differential-detail";
import {
  rowToDifferentialRecord,
  rowToPresentationWorkflow,
  type DifferentialRecordRow,
} from "@/lib/differential-records";
import { rowToMedicationRecord, type MedicationRecordRow } from "@/lib/medication-records";
import {
  clinicalRegistryRecordToCorpusEntry,
  differentialRecordToCorpusEntry,
  medicationRecordToCorpusEntry,
} from "@/lib/registry-corpus";
import { type RegistryRecordKind, type RegistryRecordRow } from "@/lib/registry-records";
import { mergeRegistryRecordWithDefault } from "@/lib/registry-seed";
import {
  assertRecoveryReadinessForOperation,
  parseActivationReceipt,
  parseRollbackReceipt,
  type ActivationReceipt,
  type RecoveryReadinessEvidence,
} from "@/lib/recovery-readiness-evidence";
import { registryEntryToSiteContentRecord } from "@/lib/site-content/adapters/registry";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import { siteContentValueHash } from "@/lib/site-content/site-content-manifest";
import { readSiteContentRecordsCached } from "@/lib/site-content/site-content-record-cache";
import type { SiteContentReconciliationInput } from "@/lib/site-content/site-content-reconciliation";
import {
  parseSiteContentReleaseEvidence,
  type SiteContentReleaseEvidence,
} from "@/lib/site-content/site-content-health";

export type DynamicSiteContentKind = "service" | "form" | "medication" | "differential" | "presentation";

// Explicit public field vocabulary for every nested public render type. Unknown
// keys are omitted recursively, so an owner/editor/private-document identifier
// cannot become public merely because it is nested below an otherwise public
// JSON column.
const publicKeys = new Set([
  "accent",
  "action",
  "acuity_flags",
  "actSections",
  "after",
  "aliases",
  "age_groups",
  "age",
  "archiveGeneratedAt",
  "authorises",
  "authority",
  "availability",
  "before",
  "bedside-question",
  "bestUse",
  "body",
  "candidates",
  "catalogPayload",
  "catalogueLabel",
  "category",
  "catchments",
  "class",
  "clinicalHinge",
  "clock",
  "cls",
  "comparison",
  "confidence",
  "contacts",
  "copies",
  "cost",
  "criteria",
  "currentPresentation",
  "destination",
  "detail",
  "doesNotAuthorise",
  "documentTitle",
  "documentationStem",
  "eligibility",
  "factors",
  "fileName",
  "flag",
  "form",
  "gt",
  "hepatic",
  "highestUrgencyNote",
  "housing_flags",
  "immediateActions",
  "immediate-action",
  "indexedAt",
  "indexedClock",
  "indexedTerms",
  "investigations",
  "involved",
  "items",
  "key",
  "kind",
  "label",
  "lastUpdated",
  "legalNote",
  "likelihood",
  "localPdfBytes",
  "localPdfPath",
  "localPdfSha256",
  "locallyVerified",
  "location",
  "lt",
  "maker",
  "match",
  "mimics-overlap",
  "must-not-miss",
  "name",
  "navigatorQuery",
  "note",
  "notes",
  "officialPdfPasswordProtected",
  "officialPdfUrl",
  "officialRegisterUrl",
  "officialTitleCheckedAt",
  "parallel",
  "pages",
  "patient",
  "practicePearls",
  "preUseChecks",
  "primaryContact",
  "priorityFacts",
  "published",
  "purpose",
  "quick",
  "referral",
  "referralInfo",
  "related",
  "reviewChecklist",
  "reviewStatus",
  "reviewed",
  "riskLevel",
  "route",
  "rows",
  "safetyPearl",
  "safetySnapshot",
  "schedule",
  "scopeLabel",
  "scr",
  "searchTerms",
  "setting_flags",
  "section",
  "sectionCue",
  "scope",
  "sections",
  "selected",
  "selectedCount",
  "severity",
  "slug",
  "source",
  "sourceFacts",
  "sourceNote",
  "sourceStatus",
  "sourceTitle",
  "substance_flags",
  "stats",
  "status",
  "statusChips",
  "subclass",
  "subtitle",
  "summary",
  "summaryCards",
  "tag",
  "tags",
  "threshold",
  "timings",
  "title",
  "titleAliases",
  "tone",
  "totalCount",
  "traps",
  "type",
  "url",
  "val",
  "value",
  "verification",
  "what-argues-against",
  "why-it-fits",
  "version",
]);

const topLevelKeys: Record<DynamicSiteContentKind, ReadonlySet<string>> = {
  service: new Set([
    "slug",
    "title",
    "subtitle",
    "statusChips",
    "primaryContact",
    "contacts",
    "route",
    "eligibility",
    "cost",
    "referral",
    "location",
    "summaryCards",
    "referralInfo",
    "bestUse",
    "criteria",
    "verification",
    "tags",
    "catchments",
    "catalogueLabel",
    "navigatorQuery",
    "source",
    "catalogPayload",
  ]),
  form: new Set([
    "slug",
    "title",
    "subtitle",
    "statusChips",
    "primaryContact",
    "contacts",
    "route",
    "eligibility",
    "cost",
    "referral",
    "location",
    "summaryCards",
    "referralInfo",
    "bestUse",
    "criteria",
    "verification",
    "tags",
    "catchments",
    "catalogueLabel",
    "navigatorQuery",
    "source",
    "catalogPayload",
  ]),
  medication: new Set([
    "slug",
    "name",
    "class",
    "subclass",
    "category",
    "accent",
    "tag",
    "schedule",
    "stats",
    "sections",
    "quick",
  ]),
  differential: new Set([
    "slug",
    "title",
    "status",
    "subtitle",
    "clinicalHinge",
    // Whether the hinge describes this diagnosis or its presentation group. The
    // published surface must carry it: without it a reader sees acute dystonia's
    // record asserting the akathisia discriminator as its own.
    "clinicalHingeScope",
    "safetySnapshot",
    "sections",
    "related",
    "currentPresentation",
    "investigations",
    "immediateActions",
  ]),
  presentation: new Set([
    "id",
    "title",
    "sourceTitle",
    "scopeLabel",
    "titleAliases",
    "status",
    "subtitle",
    "selectedCount",
    "totalCount",
    "safetySnapshot",
    "criteria",
    "candidates",
    "reviewChecklist",
    "highestUrgencyNote",
    "sourceStatus",
  ]),
};

const nestedPathKeys: Record<string, ReadonlySet<string>> = {
  source: new Set([
    "label",
    "status",
    "url",
    "published",
    "reviewed",
    "notes",
    "summary",
    "title",
    "version",
    "lastUpdated",
  ]),
  patient: new Set(["factors", "action", "severity", "match", "note"]),
  summaryCards: new Set(["id", "label", "title", "detail"]),
  catalogPayload: new Set([...publicKeys, "id"]),
  sections: new Set([...publicKeys, "id"]),
  related: new Set(["id", "label", "likelihood", "note"]),
  candidates: new Set([...publicKeys, "id"]),
  criteria: new Set([...publicKeys, "id"]),
};

function publicValue(kind: DynamicSiteContentKind, value: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((entry) => publicValue(kind, entry, path));
  if (!value || typeof value !== "object") return value;
  const allowed = path.length === 0 ? topLevelKeys[kind] : (nestedPathKeys[path.at(-1)!] ?? publicKeys);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, child]) => allowed.has(key) && !isPrivateKey(key) && child !== undefined)
      .map(([key, child]) => [key, publicValue(kind, child, [...path, key])]),
  );
}

const projectionDigestEncoder = new TextEncoder();

function framedProjectionValue(tag: string, payload: string): string {
  return `${tag}${projectionDigestEncoder.encode(payload).byteLength}:${payload}`;
}

function canonicalTypedProjectionValue(value: unknown): string {
  if (value === null) return framedProjectionValue("n", "");
  if (typeof value === "string") return framedProjectionValue("s", value);
  if (typeof value === "boolean") return framedProjectionValue("b", value ? "1" : "0");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Site-content projection digest cannot encode non-finite numbers.");
    const bytes = new ArrayBuffer(8);
    new DataView(bytes).setFloat64(0, Object.is(value, -0) ? 0 : value, false);
    const payload = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return framedProjectionValue("d", payload);
  }
  if (Array.isArray(value)) {
    return framedProjectionValue("a", value.map(canonicalTypedProjectionValue).join(""));
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const payload = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => framedProjectionValue("k", key) + canonicalTypedProjectionValue(object[key]))
      .join("");
    return framedProjectionValue("o", payload);
  }
  throw new Error(`Site-content projection digest cannot encode ${typeof value}.`);
}

export function siteContentProjectionDigest(projection: {
  record: SiteContentRecord;
  renderPayload: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(
      canonicalTypedProjectionValue({
        projectionVersion: "site-content-public-projection-v1",
        record: projection.record,
        renderPayload: projection.renderPayload,
      }),
    )
    .digest("hex");
}

function recordIdentity(kind: DynamicSiteContentKind, slug: string) {
  if (kind === "service") return `services:${slug}`;
  if (kind === "form") return `forms:${slug}`;
  if (kind === "medication") return `medications:${slug}`;
  return `differentials:${kind === "presentation" ? "presentation" : "diagnosis"}:${slug}`;
}

export function canonicalDynamicSiteContentProjection(
  kind: DynamicSiteContentKind,
  row: RegistryRecordRow | MedicationRecordRow | DifferentialRecordRow,
): { record: SiteContentRecord; renderPayload: Record<string, unknown> } {
  if (kind === "service" || kind === "form") {
    const typedRow = row as RegistryRecordRow;
    if (typedRow.kind !== kind) throw new Error("Registry source kind does not match the publication command.");
    const render = mergeRegistryRecordWithDefault(kind as RegistryRecordKind, typedRow);
    const logicalId = recordIdentity(kind, render.slug);
    const entry = clinicalRegistryRecordToCorpusEntry(render, kind, {
      ownerId: null,
      recordId: logicalId,
      sourceStatus: typedRow.source_status,
      validationStatus: typedRow.validation_status,
    });
    return {
      record: registryEntryToSiteContentRecord(entry, { logicalId, sourceLineage: [] }),
      renderPayload: publicValue(kind, render) as Record<string, unknown>,
    };
  }
  if (kind === "medication") {
    const typedRow = row as MedicationRecordRow;
    const render = rowToMedicationRecord(typedRow);
    const logicalId = recordIdentity(kind, render.slug);
    const entry = medicationRecordToCorpusEntry(render, {
      ownerId: null,
      recordId: logicalId,
      sourceStatus: typedRow.source_status,
      validationStatus: typedRow.validation_status,
    });
    return {
      record: registryEntryToSiteContentRecord(entry, { logicalId, sourceLineage: [] }),
      renderPayload: publicValue(kind, render) as Record<string, unknown>,
    };
  }
  const typedRow = row as DifferentialRecordRow;
  const expectedKind = kind === "presentation" ? "presentation" : "diagnosis";
  if (typedRow.kind !== expectedKind)
    throw new Error("Differential source kind does not match the publication command.");
  // Bare `rowToDifferentialRecord` is a bare `row.payload`, so a persisted row
  // that predates a withhold arrives with its contaminated body intact — the
  // same hole `differentialRowsToCorpusEntries` had until #2838 closed it.
  // This is the canonical publication conversion the bootstrap and P03-baseline
  // scripts build published site content from, so it needs the same withhold
  // applied at the read boundary; a record with no withhold flag is returned by
  // identity, so this changes nothing for the other records.
  function withheldDiagnosisRecord(diagnosisRow: DifferentialRecordRow) {
    const diagnosisRecord = rowToDifferentialRecord(diagnosisRow);
    return withholdGeneratedBody(diagnosisRecord, curatedEntryFor(diagnosisRecord.slug));
  }
  const render =
    kind === "presentation"
      ? ({ kind, value: rowToPresentationWorkflow(typedRow) } as const)
      : ({ kind, value: withheldDiagnosisRecord(typedRow) } as const);
  const logicalId = recordIdentity(kind, render.kind === "presentation" ? render.value.id : render.value.slug);
  const entry = differentialRecordToCorpusEntry(render.value, expectedKind, {
    ownerId: null,
    recordId: logicalId,
    sourceStatus: typedRow.source_status,
    validationStatus: typedRow.validation_status,
  });
  return {
    record: registryEntryToSiteContentRecord(entry, { logicalId, sourceLineage: [] }),
    renderPayload: publicValue(kind, render.value) as Record<string, unknown>,
  };
}

const privateKeys = new Set([
  "actor",
  "actorid",
  "authorid",
  "createdby",
  "creatorid",
  "editorid",
  "owner",
  "ownerid",
  "publishedby",
  "publisherid",
  "retireeid",
  "reviewedby",
  "reviewerid",
  "sourceownerid",
  "sourcerowid",
  "privatedocumentid",
  "updatedby",
  "updaterid",
]);

function isPrivateKey(key: string) {
  return privateKeys.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
}

type RpcClient = {
  rpc: unknown;
  from?: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        single: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

async function callRpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  columns?: string,
) {
  signal?.throwIfAborted();
  const request = (
    client.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }> & {
      select?: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> & {
        abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
      abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    }
  )(name, args);
  if (columns && !request.select)
    throw new Error(`Canonical site-content read failed: RPC ${name} cannot project columns.`);
  const selected = columns ? request.select!(columns) : request;
  const result = await (signal && selected.abortSignal ? selected.abortSignal(signal) : selected);
  signal?.throwIfAborted();
  return result;
}

function publicProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicProjection);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isPrivateKey(key))
      .map(([key, child]) => [key, publicProjection(child)]),
  );
}

export async function readCanonicalSiteContentRecords<T>(input: {
  supabase: unknown;
  kind: string;
  slug: string | null;
  seeds: readonly T[];
  signal?: AbortSignal;
  /**
   * Opt in to the short-lived process cache in `site-content-record-cache`. Search sets this:
   * it reads the same catalogue once per registry domain per search and only ever renders the
   * public projection. Publication, reconciliation and detail-page reads deliberately do not,
   * so an operator always sees their own change immediately.
   */
  cache?: boolean;
  /**
   * Search-only projection: `initialized,render_payload,snapshot`, without the `record` column.
   * Search never reads `record` when a render payload is present (the full read falls back to it
   * only when one is missing, and a projected read refuses that case below instead), so the rows it
   * ranks are identical and the payload roughly halves. Full list reads still need canonicalRecord
   * for governance.
   */
  renderOnly?: boolean;
  mapRecord?: (representation: {
    canonicalRecord: Record<string, unknown>;
    finalRenderPayload: Record<string, unknown>;
  }) => T;
}): Promise<{ records: T[]; source: "canonical_public" | "seed_uninitialized"; snapshot: unknown | null }> {
  if (input.renderOnly && (input.mapRecord || !input.cache || input.slug !== null)) {
    throw new Error("Render-only catalogue reads require a cached list without a governance mapper.");
  }
  const readRows = async (signal?: AbortSignal) => {
    const { data, error } = await callRpc(
      input.supabase as RpcClient,
      "read_site_content_public_records",
      {
        p_kind: input.kind,
        p_slug: input.slug,
      },
      signal,
      input.renderOnly ? "initialized,render_payload,snapshot" : undefined,
    );
    if (error) throw new Error(`Canonical site-content read failed: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Canonical site-content read failed: invalid RPC response.");
    // Full reads can use `record` when a render payload is absent. A projected read cannot;
    // fail into the visible degraded path instead of silently dropping a published medication.
    if (
      input.renderOnly &&
      data.some((row) => {
        if (!row || typeof row !== "object") return true;
        if (row.render_payload && typeof row.render_payload === "object" && !Array.isArray(row.render_payload)) {
          return false;
        }
        const snapshot = row.snapshot;
        return (
          row.initialized === true ||
          (snapshot && typeof snapshot === "object" && typeof snapshot.releaseId === "string")
        );
      })
    ) {
      throw new Error(`Canonical ${input.kind} search read failed: missing or invalid render payload.`);
    }
    return data as Array<Record<string, unknown>>;
  };
  const rows = input.cache
    ? (
        await readSiteContentRecordsCached({
          kind: input.kind,
          slug: input.slug,
          projection: input.renderOnly ? "render" : "full",
          signal: input.signal,
          read: readRows,
        })
      ).rows
    : await readRows(input.signal);
  const initialized = rows.some((row) => row.initialized === true);
  const snapshot = rows.find((row) => row.snapshot != null)?.snapshot ?? null;
  const retainedReleaseId =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).releaseId
      : null;
  if (rows.length > 0 && !initialized && snapshot === null && typeof retainedReleaseId !== "string") {
    const seeds = input.slug
      ? input.seeds.filter((seed) => {
          const value = seed as Record<string, unknown>;
          const record = value.record as Record<string, unknown> | undefined;
          const workflow = value.workflow as Record<string, unknown> | undefined;
          return value.slug === input.slug || record?.slug === input.slug || workflow?.id === input.slug;
        })
      : [...input.seeds];
    return { records: seeds, source: "seed_uninitialized", snapshot };
  }
  const records = rows.flatMap((row) => {
    const canonicalRecord = row.record;
    const finalRenderPayload = input.mapRecord ? row.render_payload : (row.render_payload ?? canonicalRecord);
    if (!finalRenderPayload || typeof finalRenderPayload !== "object" || Array.isArray(finalRenderPayload)) return [];
    if (
      input.mapRecord &&
      (!canonicalRecord || typeof canonicalRecord !== "object" || Array.isArray(canonicalRecord))
    ) {
      return [];
    }
    const mapped = input.mapRecord
      ? input.mapRecord({
          canonicalRecord: canonicalRecord as Record<string, unknown>,
          finalRenderPayload: finalRenderPayload as Record<string, unknown>,
        })
      : (finalRenderPayload as T);
    return [publicProjection(mapped) as T];
  });
  return { records, source: "canonical_public", snapshot };
}

export function canonicalSiteContentGovernance(canonicalRecord: Record<string, unknown>) {
  const sourceStatus = canonicalRecord.sourceStatus;
  const validationStatus = canonicalRecord.validationStatus;
  return {
    sourceStatus:
      sourceStatus === "current" || sourceStatus === "review_due" || sourceStatus === "outdated"
        ? sourceStatus
        : "unknown",
    validationStatus:
      validationStatus === "approved" || validationStatus === "locally_reviewed" ? validationStatus : "unverified",
    lastReviewedAt: null,
    reviewDueAt: null,
  } as const;
}

export type SiteContentPublicationCommand = {
  action: "publish" | "retire";
  kind: "service" | "form" | "medication" | "differential" | "presentation";
  sourceRowId: string;
  expectedSourceVersion: string;
  expectedChangeEpoch: string;
  reconciliationPlanDigest?: string;
};

export async function recordSiteContentReconciliationPlan(input: {
  publicationSupabase: RpcClient;
  plan: SiteContentReconciliationInput;
}) {
  const { data, error } = await callRpc(input.publicationSupabase, "record_site_content_reconciliation_plan", {
    p_plan: input.plan,
  });
  if (error) throw new Error(`Site-content reconciliation command failed: ${error.message}`);
  if (data !== true) throw new Error("Site-content reconciliation command failed: invalid RPC response.");
  return { outcome: "recorded" as const, planDigest: input.plan.planDigest };
}

export async function publishSiteContentCommand(input: {
  sourceSupabase: RpcClient;
  publicationSupabase: RpcClient;
  command: SiteContentPublicationCommand;
}) {
  if (!input.sourceSupabase.from) throw new Error("Site-content source reader is unavailable.");
  const sourceTable =
    input.command.kind === "service" || input.command.kind === "form"
      ? "clinical_registry_records"
      : input.command.kind === "medication"
        ? "medication_records"
        : "differential_records";
  const sourceResult = await input.sourceSupabase
    .from(sourceTable)
    .select("*")
    .eq("id", input.command.sourceRowId)
    .single();
  if (sourceResult.error || !sourceResult.data || typeof sourceResult.data !== "object") {
    throw new Error(`Site-content source read failed: ${sourceResult.error?.message ?? "not found"}`);
  }
  const canonical = canonicalDynamicSiteContentProjection(input.command.kind, sourceResult.data as never);
  const rpcName = input.command.action === "publish" ? "publish_site_content_record" : "retire_site_content_record";
  const { data, error } = await callRpc(input.publicationSupabase, rpcName, {
    p_kind: input.command.kind,
    p_source_row_id: input.command.sourceRowId,
    p_expected_source_version: input.command.expectedSourceVersion,
    p_expected_change_epoch: input.command.expectedChangeEpoch,
    p_reconciliation_plan_digest: input.command.reconciliationPlanDigest ?? null,
    p_expected_record_digest: siteContentValueHash(canonical.record),
    p_expected_projection_digest: siteContentProjectionDigest(canonical),
  });
  if (error) throw new Error(`Site-content publication command failed: ${error.message}`);
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") {
    throw new Error("Site-content publication command failed: invalid RPC response.");
  }
  const result = data[0] as Record<string, unknown>;
  if (result.outcome === "conflict") {
    return {
      outcome: "conflict" as const,
      reason: typeof result.conflict_code === "string" ? result.conflict_code : "stale_or_noop",
    };
  }
  if (result.outcome !== "applied") {
    throw new Error("Site-content publication command failed: invalid RPC outcome.");
  }
  return { outcome: "applied" as const, result };
}

/**
 * `signal` is not optional decoration: `read_site_content_health()` is a whole-corpus integrity
 * audit, and on 2026-09-13 an unbounded call to it from `/api/health/ready` was what stopped
 * production deploying for three days (see `docs/deployment-architecture.md` § Readiness).
 * Every request-path caller must bound it; `callRpc` forwards the signal to PostgREST, so an
 * expired deadline cancels the query rather than merely abandoning the promise.
 */
export async function readSiteContentHealthEvidence(
  supabase: unknown,
  signal?: AbortSignal,
): Promise<SiteContentReleaseEvidence> {
  const { data, error } = await callRpc(supabase as RpcClient, "read_site_content_health", {}, signal);
  if (error) throw new Error("Site-content health evidence is unavailable.");
  try {
    return parseSiteContentReleaseEvidence(data);
  } catch {
    throw new Error("Site-content health evidence is unavailable.");
  }
}

export async function activateSiteContentRelease(input: {
  supabase: RpcClient;
  projectRef: string;
  releaseId: string;
  releaseDigest: string;
  expectedChangeEpoch: string;
  recoveryEvidence: RecoveryReadinessEvidence;
  activationReceipt: unknown;
}) {
  const evidence = assertRecoveryReadinessForOperation(input.recoveryEvidence, "site_release", input.projectRef);
  const receipt = parseActivationReceipt(input.activationReceipt);
  if (
    receipt.projectRef !== input.projectRef ||
    receipt.recoveryReadinessDigest !== evidence.digest ||
    receipt.resource.kind !== "site_release" ||
    receipt.resource.siteReleaseId !== input.releaseId ||
    receipt.resource.siteReleaseDigest !== input.releaseDigest
  )
    throw new Error("Activation receipt does not match the requested site-content release.");
  const { data, error } = await callRpc(input.supabase, "activate_site_content_release", {
    p_release_id: input.releaseId,
    p_expected_release_digest: input.releaseDigest,
    p_expected_change_epoch: input.expectedChangeEpoch,
    p_recovery_digest: evidence.digest,
    p_activation_receipt: receipt,
  });
  if (error) throw new Error(`Site-content activation failed: ${error.message}`);
  return data === true;
}

export async function rollbackSiteContentRelease(input: {
  supabase: RpcClient;
  projectRef: string;
  expectedActiveReleaseId: string;
  targetReleaseId: string;
  recoveryEvidence: RecoveryReadinessEvidence;
  activationReceipt: ActivationReceipt;
  rollbackReceipt: unknown;
}) {
  const evidence = assertRecoveryReadinessForOperation(input.recoveryEvidence, "site_release", input.projectRef);
  const activation = parseActivationReceipt(input.activationReceipt);
  const receipt = parseRollbackReceipt(input.rollbackReceipt, activation);
  if (
    activation.projectRef !== input.projectRef ||
    activation.resource.kind !== "site_release" ||
    activation.resource.siteReleaseId !== input.expectedActiveReleaseId ||
    receipt.target.kind !== "site_release" ||
    receipt.target.siteReleaseId !== input.targetReleaseId
  )
    throw new Error("Rollback receipt does not match the retained site-content release.");
  const { data, error } = await callRpc(input.supabase, "rollback_site_content_release", {
    p_expected_active_release_id: input.expectedActiveReleaseId,
    p_target_release_id: input.targetReleaseId,
    p_recovery_digest: evidence.digest,
    p_rollback_receipt: receipt,
  });
  if (error) throw new Error(`Site-content rollback failed: ${error.message}`);
  return data === true;
}
