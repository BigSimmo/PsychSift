import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertSiteContentSyncPlan,
  planSiteContentSync,
  siteContentSyncCanonicalJson,
  type SiteContentActiveProjection,
  type SiteContentSyncInput,
} from "../src/lib/site-content/site-content-sync";
import type { StaticSiteContentManifest } from "../src/lib/site-content/site-content-manifest";

type BuildInputs = Omit<
  SiteContentSyncInput,
  "registryVersion" | "deploymentSha" | "staticManifestDigest" | "desiredRecords"
> & {
  manifest: StaticSiteContentManifest;
};

type OfflineState = Omit<BuildInputs, "manifest"> & {
  publications?: Record<string, unknown>;
  governanceReceipt?: unknown;
  mustPassReceipt?: unknown;
  activation?: unknown;
  evidence?: unknown;
  records?: unknown[];
};
type OperatorAction =
  | "adopt"
  | "begin"
  | "resume"
  | "publish"
  | "verify"
  | "activate"
  | "provision-secret"
  | "provision-recovery-secret"
  | "provision-governance-secret"
  | "provision-must-pass-secret";
const executableDomains = new Set(["services", "forms", "medications", "differentials"]);

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

function deterministicUuid(value: string, discriminator: string) {
  const hex = createHash("sha256").update(`${value}:${discriminator}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function defaultOfflineState(manifest: StaticSiteContentManifest): OfflineState {
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || "offline-site-content";
  return {
    projectRef,
    expectedProjectRef: projectRef,
    candidateReleaseId: deterministicUuid(manifest.staticManifestDigest, "candidate"),
    previousReleaseId: deterministicUuid(manifest.staticManifestDigest, "empty-authority"),
    generationId: deterministicUuid(manifest.staticManifestDigest, "generation"),
    expectedEmbedding: {
      model: process.env.RAG_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
      dimensions: Number(process.env.RAG_EMBEDDING_DIMENSIONS || 1536),
    },
    activeProjections: [],
    legacyRows: [],
    legacyDispositions: [],
    batchSize: 25,
  };
}

export function createSiteContentSyncHttpTransport(options: {
  endpoint: string;
  accessToken: string;
  fetch?: typeof globalThis.fetch;
}) {
  if (!/^https?:\/\//.test(options.endpoint) || !options.accessToken.trim()) {
    throw new Error("Site-content operator endpoint and administrator access token are required.");
  }
  const request = options.fetch ?? globalThis.fetch;
  return async ({ body }: { path: string; body: unknown }) => {
    const response = await request(options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${options.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Site-content operator request failed with status ${response.status}.`);
    return response.json();
  };
}

export function buildSiteContentSyncPlanFromInputs(input: BuildInputs) {
  if (input.manifest.version !== "clinical-kb-site-static-manifest-v1") {
    throw new Error("P03 StaticSiteContentManifest version is required.");
  }
  const eligible = input.manifest.records.filter((record) => record.eligible && executableDomains.has(record.domain));
  if (new Set(eligible.map((record) => record.logicalId)).size !== eligible.length) {
    throw new Error("P03 manifest eligible logical identities must be unique.");
  }
  return planSiteContentSync({
    ...input,
    registryVersion: input.manifest.registryVersion,
    deploymentSha: input.manifest.gitSha,
    staticManifestDigest: input.manifest.staticManifestDigest as `sha256:${string}`,
    desiredRecords: eligible.map((record) => ({
      logicalId: record.logicalId,
      domain: record.domain,
      publicationVersion: input.manifest.generatedAt,
      contentHash: record.contentHash as `sha256:${string}`,
      sourceLineageDigest: record.lineageDigest as `sha256:${string}`,
    })),
  });
}

export function createSiteContentSyncWriteDriver(dependencies: {
  send: (request: { path: string; body: unknown }) => Promise<unknown>;
  resolvePublication?: (logicalId: string) => unknown;
}) {
  return Object.freeze({
    async execute(
      planInput: unknown,
      options: {
        allowWrite: boolean;
        expectedProjectRef: string;
        action?: OperatorAction;
        records?: unknown[];
        governanceReceipt?: unknown;
        mustPassReceipt?: unknown;
        activation?: unknown;
        evidence?: unknown;
        expectedCurrentDigest?: string;
        rotationReason?: string;
      },
    ) {
      if (!options.allowWrite) throw new Error("Site-content write execution is not enabled.");
      const plan = assertSiteContentSyncPlan(planInput);
      if (plan.projectRef !== options.expectedProjectRef) throw new Error("Write target project mismatch.");
      const action = options.action ?? "begin";
      if (action.startsWith("provision-")) {
        await dependencies.send({
          path: "/api/admin/site-content/publish",
          body: {
            action,
            expectedCurrentDigest: options.expectedCurrentDigest ?? null,
            rotationReason: options.rotationReason ?? null,
          },
        });
        return plan;
      }
      if (plan.mode !== "write") throw new Error("A canonical write plan with recovery evidence is required.");
      if (action === "adopt") {
        await dependencies.send({
          path: "/api/admin/site-content/publish",
          body: {
            action,
            plan,
            records: options.records ?? [],
            governanceReceipt: options.governanceReceipt,
            mustPassReceipt: options.mustPassReceipt,
          },
        });
        return plan;
      }
      if (action === "verify") {
        await dependencies.send({
          path: "/api/admin/site-content/publish",
          body: {
            action,
            plan,
            governanceReceipt: options.governanceReceipt,
            mustPassReceipt: options.mustPassReceipt,
          },
        });
        return plan;
      }
      if (action === "activate") {
        await dependencies.send({
          path: "/api/admin/site-content/publish",
          body: {
            action,
            releaseId: plan.candidateReleaseId,
            evidence: options.evidence,
            activation: options.activation,
          },
        });
        return plan;
      }
      if (action === "begin" || action === "resume") {
        await dependencies.send({ path: "/api/admin/site-content/publish", body: { action: "begin", plan } });
      }
      if (action !== "publish" && action !== "begin" && action !== "resume") return plan;
      for (const operation of plan.operations.filter((entry) => entry.operation === "changed")) {
        const record = dependencies.resolvePublication?.(operation.logicalId);
        if (!record) throw new Error(`Canonical changed publication ${operation.logicalId} is unavailable.`);
        await dependencies.send({
          path: "/api/admin/site-content/publish",
          body: {
            action: "publish",
            record: {
              ...(record as Record<string, unknown>),
              candidateReleaseId: plan.candidateReleaseId,
              projectRef: plan.projectRef,
              generationId: plan.generationId,
              planDigest: plan.planDigest,
              releaseDigest: plan.releaseDigest,
              staticManifestDigest: plan.staticManifestDigest,
              dynamicStateDigest: plan.dynamicStateDigest,
              recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
            },
          },
        });
      }
      return plan;
    },
  });
}

export async function runSiteContentSyncCli(
  args: readonly string[],
  dependencies: { send?: (request: { path: string; body: unknown }) => Promise<unknown> } = {},
) {
  const manifestPath = option(args, "--manifest");
  const statePath = option(args, "--state");
  const write = args.includes("--write");
  const planWrite = args.includes("--plan-write");
  if (write && planWrite) throw new Error("--plan-write is non-mutating and cannot be combined with --write.");
  if (!manifestPath) throw new Error("--manifest <path> is required.");
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as StaticSiteContentManifest;
  const state = statePath
    ? (JSON.parse(await readFile(resolve(statePath), "utf8")) as OfflineState)
    : defaultOfflineState(manifest);
  const action = (option(args, "--action") ?? "begin") as OperatorAction;
  const provisioningAction = action.startsWith("provision-");
  const recomputedPlan = buildSiteContentSyncPlanFromInputs({
    ...state,
    manifest,
    write: (write || planWrite) && !provisioningAction,
  });
  const canonicalPlanPath = option(args, "--canonical-plan");
  const plan = canonicalPlanPath
    ? assertSiteContentSyncPlan(JSON.parse(await readFile(resolve(canonicalPlanPath), "utf8")))
    : recomputedPlan;
  if (canonicalPlanPath && siteContentSyncCanonicalJson(plan) !== siteContentSyncCanonicalJson(recomputedPlan)) {
    throw new Error("Supplied canonical write plan does not match the deterministic manifest/state plan.");
  }
  if (write) {
    const confirmedProject = option(args, "--confirm-project");
    if (confirmedProject !== state.expectedProjectRef) {
      throw new Error("Guarded write requires exact --confirm-project target confirmation.");
    }
    const send =
      dependencies.send ??
      createSiteContentSyncHttpTransport({
        endpoint: process.env.SITE_CONTENT_SYNC_ADMIN_URL ?? "",
        accessToken: process.env.SITE_CONTENT_SYNC_ADMIN_ACCESS_TOKEN ?? "",
      });
    if (
      ![
        "adopt",
        "begin",
        "resume",
        "publish",
        "verify",
        "activate",
        "provision-secret",
        "provision-recovery-secret",
        "provision-governance-secret",
        "provision-must-pass-secret",
      ].includes(action)
    ) {
      throw new Error("Unsupported site-content operator action.");
    }
    const governanceReceiptPath = option(args, "--governance-receipt");
    const mustPassReceiptPath = option(args, "--must-pass-receipt");
    const governanceReceipt = governanceReceiptPath
      ? JSON.parse(await readFile(resolve(governanceReceiptPath), "utf8"))
      : state.governanceReceipt;
    const mustPassReceipt = mustPassReceiptPath
      ? JSON.parse(await readFile(resolve(mustPassReceiptPath), "utf8"))
      : state.mustPassReceipt;
    await createSiteContentSyncWriteDriver({
      send,
      resolvePublication: (logicalId) => state.publications?.[logicalId],
    }).execute(plan, {
      allowWrite: true,
      expectedProjectRef: state.expectedProjectRef,
      action,
      records: state.records ?? Object.values(state.publications ?? {}),
      governanceReceipt,
      mustPassReceipt,
      activation: state.activation,
      evidence: state.evidence,
      expectedCurrentDigest: option(args, "--expected-current-secret-digest") ?? undefined,
      rotationReason: option(args, "--rotation-reason") ?? undefined,
    });
  }
  process.stdout.write(`${JSON.stringify(plan)}\n`);
  return plan;
}

export type { SiteContentActiveProjection };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSiteContentSyncCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
