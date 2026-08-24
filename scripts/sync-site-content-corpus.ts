import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertSiteContentSyncPlan,
  planSiteContentSync,
  type SiteContentActiveProjection,
  type SiteContentSyncInput,
} from "../src/lib/site-content/site-content-sync";
import type { StaticSiteContentManifest } from "../src/lib/site-content/site-content-manifest";

type BuildInputs = Omit<SiteContentSyncInput, "registryVersion" | "staticManifestDigest" | "desiredRecords"> & {
  manifest: StaticSiteContentManifest;
};

type OfflineState = Omit<BuildInputs, "manifest"> & { publications?: Record<string, unknown> };
const executableDomains = new Set(["services", "forms", "medications", "differentials"]);

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
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
    async execute(planInput: unknown, options: { allowWrite: boolean; expectedProjectRef: string }) {
      if (!options.allowWrite) throw new Error("Site-content write execution is not enabled.");
      const plan = assertSiteContentSyncPlan(planInput);
      if (plan.mode !== "write") throw new Error("A canonical write plan with recovery evidence is required.");
      if (plan.projectRef !== options.expectedProjectRef) throw new Error("Write target project mismatch.");
      await dependencies.send({ path: "/api/admin/site-content/publish", body: { action: "begin", plan } });
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
  if (!manifestPath || !statePath) throw new Error("--manifest <path> and --state <path> are required.");
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as StaticSiteContentManifest;
  const state = JSON.parse(await readFile(resolve(statePath), "utf8")) as OfflineState;
  const plan = buildSiteContentSyncPlanFromInputs({ ...state, manifest, write });
  if (write) {
    const confirmedProject = option(args, "--confirm-project");
    if (!dependencies.send || confirmedProject !== state.expectedProjectRef) {
      throw new Error("Guarded write requires an injected server transport and exact --confirm-project target.");
    }
    await createSiteContentSyncWriteDriver({
      send: dependencies.send,
      resolvePublication: (logicalId) => state.publications?.[logicalId],
    }).execute(plan, { allowWrite: true, expectedProjectRef: state.expectedProjectRef });
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
