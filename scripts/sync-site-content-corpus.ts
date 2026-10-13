import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { allSiteContentRecords } from "../src/lib/site-content/adapters";
import {
  planSiteContentSync,
  type ExistingSiteContentReleaseRecord,
  type SiteContentSyncSourceRecord,
} from "../src/lib/site-content/site-content-sync";
import {
  compareCanonicalSiteContentIdentifiers,
  siteContentValueHash,
  validateStaticSiteContentManifest,
} from "../src/lib/site-content/site-content-manifest";
import { SITE_CONTENT_REGISTRY_VERSION } from "../src/lib/site-content/site-content-registry";
import {
  assertSiteContentReconciliationInput,
  type SiteContentReconciliationInput,
} from "../src/lib/site-content/site-content-reconciliation";
import {
  assertRecoveryReadinessForOperation,
  parseRecoveryReadinessEvidence,
} from "../src/lib/recovery-readiness-evidence";

const SHA256 = /^[0-9a-f]{64}$/;
const PROJECT_REF = /^[a-z0-9][a-z0-9_-]{2,63}$/;

type Options = {
  manifest?: string;
  dynamic?: string;
  reconciliation?: string;
  out?: string;
  dryRun: boolean;
  write: boolean;
  projectRef?: string;
  confirmProjectRef?: string;
  expectedStateDigest?: string;
  expectedPlanDigest?: string;
  expectedReconciliationDigest?: string;
  recoveryEvidence?: string;
  providerAuthorization?: string;
  eventSequence?: string;
};

const valueOptions = new Map<string, keyof Options>([
  ["--manifest", "manifest"],
  ["--dynamic", "dynamic"],
  ["--reconciliation", "reconciliation"],
  ["--out", "out"],
  ["--project-ref", "projectRef"],
  ["--confirm-project-ref", "confirmProjectRef"],
  ["--expected-state-digest", "expectedStateDigest"],
  ["--expected-plan-digest", "expectedPlanDigest"],
  ["--expected-reconciliation-digest", "expectedReconciliationDigest"],
  ["--recovery-evidence", "recoveryEvidence"],
  ["--provider-authorization", "providerAuthorization"],
  ["--event-sequence", "eventSequence"],
]);

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dryRun: false, write: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || seen.has(token)) throw new Error("Site-content CLI arguments must be unique.");
    seen.add(token);
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--write") options.write = true;
    else {
      const key = valueOptions.get(token);
      if (!key) throw new Error(`Unknown argument: ${token}`);
      const value = argv[++index];
      if (!value || value.startsWith("--") || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error(`${token} requires a safe value.`);
      }
      (options as Record<string, unknown>)[key] = value;
    }
  }
  if (!options.manifest || !options.dynamic) throw new Error("--manifest and --dynamic are required.");
  if (options.write === options.dryRun) {
    if (options.write) throw new Error("--write and --dry-run are mutually exclusive.");
    options.dryRun = true;
  }
  if (options.write) {
    const required: Array<[keyof Options, string]> = [
      ["projectRef", "--project-ref"],
      ["confirmProjectRef", "--confirm-project-ref"],
      ["expectedStateDigest", "--expected-state-digest"],
      ["expectedPlanDigest", "--expected-plan-digest"],
      ["recoveryEvidence", "--recovery-evidence"],
      ["providerAuthorization", "--provider-authorization"],
      ["eventSequence", "--event-sequence"],
    ];
    const missing = required.filter(([key]) => !options[key]).map(([, flag]) => flag);
    if (missing.length) throw new Error(`Guarded write authorization requires ${missing.join(", ")}.`);
  }
  return options;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sourceRecord(record: (typeof allSiteContentRecords)[number]): SiteContentSyncSourceRecord {
  return {
    record,
    documentId: deterministicUuid(`site-content-document:${record.logicalId}`),
    chunkId: deterministicUuid(`site-content-chunk:${record.logicalId}`),
    publicMetadataFingerprint: siteContentValueHash({
      route: record.route,
      title: record.title,
      sourceRole: record.sourceRole,
    }),
    governanceFingerprint: siteContentValueHash({
      access: record.access,
      validationStatus: record.validationStatus,
      sourceStatus: record.sourceStatus,
    }),
    lineageFingerprint: siteContentValueHash(record.sourceLineage),
  };
}

type DynamicInput = {
  version: "site-content-dynamic-input-v1";
  initialAdoption: boolean;
  targetChangeEpoch: string;
  generationId: string;
  embedding: { model: string; dimensions: number; fingerprint: string };
  records: SiteContentSyncSourceRecord[];
  existingReleaseRecords: ExistingSiteContentReleaseRecord[];
  retirementTargets?: Array<{ logicalId: string; targetPublicationId: string }>;
};

function assertDynamicInput(value: unknown): asserts value is DynamicInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dynamic input must be an object.");
  const input = value as Record<string, unknown>;
  const expected = [
    "embedding",
    "existingReleaseRecords",
    "generationId",
    "initialAdoption",
    "records",
    "targetChangeEpoch",
    "version",
  ].sort();
  if ("retirementTargets" in input) expected.push("retirementTargets");
  expected.sort();
  if (
    JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected) ||
    input.version !== "site-content-dynamic-input-v1" ||
    !Array.isArray(input.records) ||
    !Array.isArray(input.existingReleaseRecords) ||
    ("retirementTargets" in input && !Array.isArray(input.retirementTargets))
  ) {
    throw new Error("Dynamic input has an invalid version or exact population shape.");
  }
}

function assertProviderAuthorization(value: unknown, projectRef: string, planDigest: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provider authorization is invalid.");
  const receipt = value as Record<string, unknown>;
  const exactKeys = ["authorizedAt", "expiresAt", "operation", "planDigest", "projectRef", "version"].sort();
  const authorizedAt = typeof receipt.authorizedAt === "string" ? Date.parse(receipt.authorizedAt) : Number.NaN;
  const expiresAt = typeof receipt.expiresAt === "string" ? Date.parse(receipt.expiresAt) : Number.NaN;
  if (
    JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(exactKeys) ||
    receipt.version !== "provider-authorization-v1" ||
    receipt.operation !== "site_content_sync_handoff" ||
    receipt.projectRef !== projectRef ||
    receipt.planDigest !== planDigest ||
    typeof receipt.authorizedAt !== "string" ||
    typeof receipt.expiresAt !== "string" ||
    !Number.isFinite(authorizedAt) ||
    !Number.isFinite(expiresAt) ||
    authorizedAt > Date.now() ||
    expiresAt <= Date.now() ||
    authorizedAt >= expiresAt
  ) {
    throw new Error("Provider authorization is invalid, expired, or mismatched.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = validateStaticSiteContentManifest(json(options.manifest!), {
    expectedRegistryVersion: SITE_CONTENT_REGISTRY_VERSION,
  });
  const dynamic = json(options.dynamic!);
  assertDynamicInput(dynamic);
  let reconciliation: SiteContentReconciliationInput | null = null;
  if (dynamic.initialAdoption && !options.reconciliation) {
    throw new Error("Initial adoption requires --reconciliation <reviewed-plan.json>.");
  }
  if (!dynamic.initialAdoption && (options.reconciliation || options.expectedReconciliationDigest)) {
    throw new Error("Post-adoption plans must omit reconciliation arguments.");
  }
  if (dynamic.initialAdoption && options.reconciliation) {
    const candidate = json(options.reconciliation);
    assertSiteContentReconciliationInput(candidate);
    reconciliation = candidate;
  }
  if (!options.write && options.expectedReconciliationDigest) {
    throw new Error("--expected-reconciliation-digest is a guarded-write authorization only.");
  }
  const staticRecords = allSiteContentRecords
    .filter((record) => record.producerClass === "static_repository")
    .map(sourceRecord)
    .sort((left, right) => compareCanonicalSiteContentIdentifiers(left.record.logicalId, right.record.logicalId));
  const plan = planSiteContentSync({
    manifest,
    staticRecords,
    dynamicRecords: dynamic.records,
    existingReleaseRecords: dynamic.existingReleaseRecords,
    registryVersion: SITE_CONTENT_REGISTRY_VERSION,
    targetChangeEpoch: dynamic.targetChangeEpoch,
    generationId: dynamic.generationId,
    embedding: dynamic.embedding,
    retirementTargets: dynamic.retirementTargets,
    reconciliationPlanDigest: reconciliation?.planDigest ?? null,
  });
  const summary = {
    version: plan.version,
    dryRun: !options.write,
    planDigest: plan.planDigest,
    releaseDigest: plan.releaseDigest,
    dynamicStateDigest: plan.dynamicStateDigest,
    currentStateDigest: siteContentValueHash({
      version: "site-content-current-release-state-v1",
      records: [...dynamic.existingReleaseRecords].sort((left, right) =>
        compareCanonicalSiteContentIdentifiers(left.logicalId, right.logicalId),
      ),
    }),
    targetChangeEpoch: plan.targetChangeEpoch,
    counts: plan.counts,
  };

  if (options.write) {
    if (!PROJECT_REF.test(options.projectRef!) || options.confirmProjectRef !== options.projectRef) {
      throw new Error("Exact --confirm-project-ref must match --project-ref.");
    }
    if (!SHA256.test(options.expectedStateDigest!) || options.expectedStateDigest !== summary.currentStateDigest) {
      throw new Error("Expected current-state digest does not match the deterministic plan.");
    }
    if (!SHA256.test(options.expectedPlanDigest!) || options.expectedPlanDigest !== plan.planDigest) {
      throw new Error("Expected plan digest does not match the deterministic plan.");
    }
    if (
      dynamic.initialAdoption &&
      (!reconciliation ||
        !options.expectedReconciliationDigest ||
        options.expectedReconciliationDigest !== reconciliation.planDigest ||
        plan.reconciliationPlanDigest !== reconciliation.planDigest)
    ) {
      throw new Error("Exact reconciliation digest does not match the durable handoff.");
    }
    if (!dynamic.initialAdoption && plan.reconciliationPlanDigest !== null) {
      throw new Error("Post-adoption plan unexpectedly carries a reconciliation digest.");
    }
    const evidence = parseRecoveryReadinessEvidence(json(options.recoveryEvidence!));
    assertRecoveryReadinessForOperation(evidence, "site_release", options.projectRef!);
    assertProviderAuthorization(json(options.providerAuthorization!), options.projectRef!, plan.planDigest);

    // Provider/environment-bearing modules and values are loaded only after
    // local content, target, reconciliation and recovery authorization passes.
    const { requireProviderTestPermission } = await import("./test-environment.mjs");
    requireProviderTestPermission({ ALLOW_PROVIDER_TESTS: process.env.ALLOW_PROVIDER_TESTS });
    const { checkSupabaseProjectConfig, formatSupabaseProjectCheck } = await import("../src/lib/supabase/project");
    const projectCheck = checkSupabaseProjectConfig(
      {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
        SUPABASE_PROJECT_NAME: process.env.SUPABASE_PROJECT_NAME,
        SUPABASE_STAGING_PROJECT_REF: process.env.SUPABASE_STAGING_PROJECT_REF,
        SUPABASE_STAGING_PROJECT_NAME: process.env.SUPABASE_STAGING_PROJECT_NAME,
      },
      { requireMetadata: true },
    );
    if (
      projectCheck.status !== "ready" ||
      projectCheck.expected.ref !== options.projectRef ||
      projectCheck.observed.configuredRef !== options.projectRef
    ) {
      throw new Error(
        `Configured Supabase project does not match the confirmed target: ${formatSupabaseProjectCheck(projectCheck)}`,
      );
    }
    const eventSequence = Number(options.eventSequence);
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) throw new Error("Event sequence is invalid.");
    const { createAdminClient } = await import("../src/lib/supabase/admin");
    const { data, error } = await createAdminClient({ timeoutMs: null }).rpc("record_site_content_sync_event_plan", {
      p_event_sequence: eventSequence,
      p_expected_change_epoch: Number(plan.targetChangeEpoch),
      p_plan_digest: plan.planDigest,
      p_plan: plan,
    });
    if (error || data !== true) throw new Error("Durable site-content plan/event handoff was rejected.");
  }

  if (options.out) writeFileSync(resolve(options.out), `${JSON.stringify({ summary, plan }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

void main();
