import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import {
  assertDocumentGenerationCleanupPlan,
  type DocumentGenerationCleanupPlanV1,
} from "@/lib/reindex-pipeline";
import { safeErrorLogDetails } from "@/lib/privacy";
import { assertSupabaseHealthy, probeSupabaseHealth } from "@/lib/supabase/health";
import { confirm } from "./cli-utils";
import { encodeShadowNodeJsonCanonicalPayload } from "./lib/reindex-eval-session";

type CleanupRpc = (
  name: "cleanup_document_index_generations",
  args: { p_manifest: DocumentGenerationCleanupPlanV1; p_apply: boolean },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type DocumentGenerationCleanupDependencies = Readonly<{
  rpc: CleanupRpc;
  confirmApply?: (question: string) => Promise<boolean>;
  log?: (message: string) => void;
}>;

type CleanupClient = Readonly<{
  rpc: CleanupRpc;
  from(table: string): {
    select(columns: string, options?: Record<string, unknown>): {
      limit(count: number): PromiseLike<{ error: { message?: string; code?: string; details?: string; hint?: string } | null }>;
    };
  };
}>;

export type DocumentGenerationCleanupCliDependencies = Readonly<{
  readManifest: (path: string) => Promise<unknown>;
  loadDestinationIdentity: () => Promise<Readonly<{ projectRef: string; projectName: string | null }>>;
  createClient: () => Promise<CleanupClient>;
  assertHealthy: (client: CleanupClient) => Promise<void>;
  log: (message: string) => void;
}>;

type ValidatedCleanupResult = Readonly<{
  ok: true;
  applied: boolean;
  operationId: string | null;
  manifestDigest: string;
  expectedCount: number;
  eligibleCount: number;
  deletedArtifactCount: number;
  targets: readonly unknown[];
  privateObjectReferenceInventory: readonly unknown[];
  physicalDeletionAuthorized: false;
  version?: 1;
  kind?: "document-generation-cleanup-v1";
  cleanedAt?: string;
  receiptDigest?: string;
}>;

export function parseDocumentGenerationCleanupArgs(argv: readonly string[]) {
  const manifestFlags = argv.flatMap((value, index) => {
    if (value === "--manifest") {
      const next = argv[index + 1];
      return next && !next.startsWith("--") ? [next] : [];
    }
    if (value.startsWith("--manifest=")) {
      const inline = value.slice("--manifest=".length);
      return inline && !inline.startsWith("--") ? [inline] : [];
    }
    return [];
  });
  const allowed = new Set(["--apply", "--yes"]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--manifest") {
      index += 1;
      continue;
    }
    if (value.startsWith("--manifest=") || allowed.has(value)) continue;
    throw new Error(`Unknown cleanup argument: ${value}`);
  }
  if (manifestFlags.length !== 1 || manifestFlags[0]!.trim() === "") {
    throw new Error("Cleanup requires exactly one --manifest path.");
  }
  return Object.freeze({ manifestPath: manifestFlags[0]!, apply: argv.includes("--apply"), yes: argv.includes("--yes") });
}

function cleanupResult(
  input: unknown,
  expectedApply: boolean,
  manifest: DocumentGenerationCleanupPlanV1,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Cleanup RPC returned an invalid result.");
  }
  const result = input as Record<string, unknown>;
  const expectedKeys = expectedApply
    ? [
        "version",
        "kind",
        "ok",
        "applied",
        "operationId",
        "manifestDigest",
        "expectedCount",
        "eligibleCount",
        "deletedArtifactCount",
        "targets",
        "privateObjectReferenceInventory",
        "physicalDeletionAuthorized",
        "cleanedAt",
        "receiptDigest",
      ]
    : [
        "ok",
        "applied",
        "operationId",
        "manifestDigest",
        "expectedCount",
        "eligibleCount",
        "deletedArtifactCount",
        "targets",
        "privateObjectReferenceInventory",
        "physicalDeletionAuthorized",
      ];
  if (
    Object.keys(result).sort().join("|") !== expectedKeys.sort().join("|") ||
    result.ok !== true ||
    result.applied !== expectedApply ||
    result.manifestDigest !== manifest.digest ||
    result.expectedCount !== manifest.expectedCount ||
    result.eligibleCount !== manifest.expectedCount ||
    !Array.isArray(result.targets) ||
    encodeShadowNodeJsonCanonicalPayload(result.targets) !== encodeShadowNodeJsonCanonicalPayload(manifest.targets) ||
    !Array.isArray(result.privateObjectReferenceInventory) ||
    result.physicalDeletionAuthorized !== false ||
    typeof result.deletedArtifactCount !== "number" ||
    !Number.isSafeInteger(result.deletedArtifactCount) ||
    result.deletedArtifactCount < 0
  ) {
    throw new Error("Cleanup RPC result did not match the exact manifest and mode.");
  }
  if (
    (!expectedApply &&
      (result.operationId !== null || result.deletedArtifactCount !== 0)) ||
    (expectedApply &&
      (result.version !== 1 ||
        result.kind !== "document-generation-cleanup-v1" ||
        typeof result.operationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.operationId) ||
        typeof result.cleanedAt !== "string" ||
        !Number.isFinite(Date.parse(result.cleanedAt)) ||
        typeof result.receiptDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(result.receiptDigest)))
  ) {
    throw new Error("Cleanup RPC result did not provide the required mode-specific receipt fields.");
  }
  if (expectedApply) {
    const { receiptDigest, ...payload } = result;
    const actualDigest = `sha256:${createHash("sha256")
      .update(encodeShadowNodeJsonCanonicalPayload(payload), "utf8")
      .digest("hex")}`;
    if (receiptDigest !== actualDigest) throw new Error("Cleanup receipt digest mismatch.");
  }
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const nested of Object.values(value)) freeze(nested);
      Object.freeze(value);
    }
  };
  freeze(result);
  return result as unknown as ValidatedCleanupResult;
}

/** Executes only an exact, precomputed manifest through an injected RPC. */
export async function runDocumentGenerationCleanup(
  manifestInput: unknown,
  options: Readonly<{ apply: boolean; yes?: boolean }>,
  dependencies: DocumentGenerationCleanupDependencies,
) {
  const manifest = assertDocumentGenerationCleanupPlan(manifestInput);
  const log = dependencies.log ?? (() => undefined);
  const invoke = async (apply: boolean) => {
    const result = await dependencies.rpc("cleanup_document_index_generations", { p_manifest: manifest, p_apply: apply });
    if (result.error) throw new Error(result.error.message);
    return cleanupResult(result.data, apply, manifest);
  };
  const dryRun = await invoke(false);
  if (dryRun.expectedCount !== manifest.expectedCount || dryRun.targets.length !== manifest.expectedCount) {
    throw new Error("Cleanup dry run did not preserve the exact manifest population.");
  }
  log(`Cleanup manifest ${manifest.digest}: ${manifest.expectedCount} exact generation target(s).`);
  if (!options.apply) return Object.freeze({ kind: "document-generation-cleanup-dry-run" as const, manifest, dryRun });
  if (!options.yes) {
    const accepted = await (dependencies.confirmApply ?? confirm)(
      `Delete the ${manifest.expectedCount} exact document generation target(s) in manifest ${manifest.digest}?`,
    );
    if (!accepted) return Object.freeze({ kind: "document-generation-cleanup-declined" as const, manifest, dryRun });
  }
  const applied = await invoke(true);
  if (applied.expectedCount !== manifest.expectedCount || applied.targets.length !== manifest.expectedCount) {
    throw new Error("Cleanup apply did not preserve the exact manifest population.");
  }
  return Object.freeze({ kind: "document-generation-cleanup-applied" as const, manifest, dryRun, applied });
}

async function defaultCleanupCliDependencies(): Promise<DocumentGenerationCleanupCliDependencies> {
  loadEnvConfig(process.cwd());
  const [{ env, requireServerEnv }, { createAdminClient }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
  ]);
  requireServerEnv();
  return {
    readManifest: async (path) => JSON.parse(await readFile(resolve(path), "utf8")) as unknown,
    loadDestinationIdentity: async () => ({
      projectRef: env.SUPABASE_PROJECT_REF ?? "",
      projectName: env.SUPABASE_PROJECT_NAME ?? null,
    }),
    createClient: async () => createAdminClient() as unknown as CleanupClient,
    assertHealthy: async (client) => {
      assertSupabaseHealthy(await probeSupabaseHealth(client), "Document generation cleanup");
    },
    log: console.log,
  };
}

export async function runDocumentGenerationCleanupCli(
  argv: readonly string[] = process.argv.slice(2),
  injectedDependencies?: DocumentGenerationCleanupCliDependencies,
) {
  const args = parseDocumentGenerationCleanupArgs(argv);
  const dependencies = injectedDependencies ?? (await defaultCleanupCliDependencies());
  const manifest = assertDocumentGenerationCleanupPlan(await dependencies.readManifest(args.manifestPath));
  const destination = await dependencies.loadDestinationIdentity();
  if (destination.projectRef !== manifest.projectRef) {
    throw new Error("Cleanup manifest project does not match the destination project.");
  }
  const supabase = await dependencies.createClient();
  await dependencies.assertHealthy(supabase);
  dependencies.log(`Supabase project: ${destination.projectName ?? "unknown"} (${destination.projectRef})`);
  const result = await runDocumentGenerationCleanup(manifest, args, {
    rpc: (name, input) => supabase.rpc(name, input),
    log: dependencies.log,
  });
  dependencies.log(result.kind);
  return result;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryPath === import.meta.url) {
  void runDocumentGenerationCleanupCli().catch((error) => {
    console.error("Document generation cleanup failed", safeErrorLogDetails(error));
    process.exitCode = 1;
  });
}
