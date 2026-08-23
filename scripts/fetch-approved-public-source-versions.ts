import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  acquirePublicSourceVersion,
  type AcquisitionFetch,
  type PublicSourceAcquisitionPlan,
  type PublicSourceScanReasonCode,
  type PublicSourceStagingCandidate,
} from "@/lib/public-source-acquisition";
import {
  parsePublicSourceAcquisitionManifest,
  publicSourceAcquisitionManifestDigest,
} from "./plan-public-source-acquisition";

function option(argv: readonly string[], name: string) {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

export type PublicSourceApplyDependencies = Readonly<{
  authorizePlan: (plan: PublicSourceAcquisitionPlan) => Promise<void>;
  fetch: AcquisitionFetch;
  resolve: (hostname: string) => Promise<readonly { address: string; family: 4 | 6 }[]>;
  scan: (input: { bytes: Uint8Array; contentType: string; catalogueKey: string }) => Promise<{
    accepted: boolean;
    reasonCode?: PublicSourceScanReasonCode;
  }>;
  findDuplicateVersion: (input: {
    catalogueKey: string;
    exactUrl: string;
    exactVersion: string;
    contentHash: string;
  }) => Promise<string | null>;
  stageOwnedDocument: (
    candidate: PublicSourceStagingCandidate,
  ) => Promise<{ documentId: string; ownerId: string | null; versionId?: string | null }>;
  enqueue: (input: {
    documentId: string;
    ownerId: string;
    catalogueKey: string;
    contentMode: "indexed_content";
    exactDocumentLicence: "public_index_permitted";
    sourcePolicyVersion: string;
    sourcePolicyDigest: string;
    metadata: Readonly<Record<string, string | boolean>>;
  }) => Promise<void>;
}>;

function fileNameFor(url: string, contentType: string) {
  const base = (basename(new URL(url).pathname) || "public-source").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 160);
  if (base.includes(".")) return base;
  return `${base}${contentType === "application/pdf" ? ".pdf" : contentType === "text/plain" ? ".txt" : ".bin"}`;
}

function fetchFromValidatedAddress(url: URL, addresses: readonly { address: string; family: 4 | 6 }[]) {
  return new Promise<Awaited<ReturnType<AcquisitionFetch>>>((resolveRequest, rejectRequest) => {
    const selected = addresses[0];
    if (!selected) {
      rejectRequest(new Error("Public source transport has no validated address."));
      return;
    }
    const outbound = request(
      {
        protocol: "https:",
        hostname: selected.address,
        family: selected.family,
        port: 443,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        servername: url.hostname,
        rejectUnauthorized: true,
        headers: { host: url.host },
        agent: false,
      },
      (incoming) => {
        const remoteAddress = incoming.socket.remoteAddress?.replace(/^::ffff:/i, "");
        if (!remoteAddress) {
          incoming.destroy();
          rejectRequest(new Error("Public source transport did not report its remote address."));
          return;
        }
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index];
          const value = incoming.rawHeaders[index + 1];
          if (name && value) headers.append(name, value);
        }
        resolveRequest({
          response: new Response(Readable.toWeb(incoming) as unknown as BodyInit, {
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
            headers,
          }),
          remoteAddress,
        });
      },
    );
    outbound.setTimeout(30_000, () => outbound.destroy(new Error("Public source transport timed out.")));
    outbound.once("error", rejectRequest);
    outbound.end();
  });
}

export async function createLivePublicSourceApplyDependencies(
  plan: PublicSourceAcquisitionPlan,
): Promise<PublicSourceApplyDependencies> {
  if (!plan.sourceActivationEventId) {
    throw new Error("Apply requires a persisted source activation event; planning cannot activate a source.");
  }
  const [{ createAdminClient }, { env }, { enqueueDocumentReindexJob }] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("@/lib/env"),
    import("@/lib/ingestion-enqueue"),
  ]);
  const supabase = createAdminClient();
  const definition = australianSourceByKey(plan.catalogueKey);
  if (!definition) throw new Error("Apply source definition is no longer in the reviewed catalogue.");

  const authorizePlan = async (candidate: PublicSourceAcquisitionPlan) => {
    if (!candidate.sourceActivationEventId) throw new Error("Apply source activation event is missing.");
    const { error } = await supabase.rpc("create_public_source_fetch_manifest", {
      p_source_catalogue_key: candidate.catalogueKey,
      p_source_policy_version: candidate.sourcePolicyVersion,
      p_source_policy_digest: candidate.sourcePolicyDigest,
      p_activation_event_id: candidate.sourceActivationEventId,
      p_exact_url: candidate.exactUrl,
      p_exact_version: candidate.exactVersion,
      p_licence_evidence_digest: candidate.licenceEvidenceDigest,
      p_staging_owner_id: candidate.stagingOwnerId,
    });
    if (error) throw new Error("Public source fetch authorization failed.");
  };

  return {
    authorizePlan,
    fetch: fetchFromValidatedAddress,
    resolve: async (hostname) =>
      (await lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
        address,
        family: family as 4 | 6,
      })),
    // MIME, signature, and structural validation already ran in the core boundary.
    scan: async () => ({ accepted: true }),
    findDuplicateVersion: async ({ catalogueKey, exactUrl, contentHash }) => {
      const { data, error } = await supabase
        .from("public_source_versions")
        .select("id")
        .eq("source_catalogue_key", catalogueKey)
        .eq("exact_version_url", exactUrl)
        .eq("content_hash", contentHash)
        .maybeSingle();
      if (error) throw new Error("Public source duplicate-version check failed.");
      return data?.id ?? null;
    },
    stageOwnedDocument: async (candidate) => {
      await authorizePlan(plan);
      const documentId = randomUUID();
      const fileName = fileNameFor(candidate.exactUrl, candidate.contentType);
      const sourceFileName = fileNameFor(candidate.exactUrl, candidate.sourceContentType);
      const sourceStoragePath = `public-sources/${candidate.ownerId}/${documentId}/source/${sourceFileName}`;
      const derived =
        candidate.sourceContentHash !== candidate.contentHash || candidate.sourceContentType !== candidate.contentType;
      const storagePath = derived
        ? `public-sources/${candidate.ownerId}/${documentId}/staged/${fileName}`
        : sourceStoragePath;
      const sourceUpload = await supabase.storage
        .from(env.SUPABASE_DOCUMENT_BUCKET)
        .upload(sourceStoragePath, candidate.sourceBytes, {
          contentType: candidate.sourceContentType,
          upsert: false,
        });
      if (sourceUpload.error) throw new Error("Public source Storage upload failed.");
      const upload = derived
        ? await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).upload(storagePath, candidate.bytes, {
            contentType: candidate.contentType,
            upsert: false,
          })
        : { error: null };
      if (upload.error) {
        await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).remove([sourceStoragePath]);
        throw new Error("Public source staged-derivative upload failed.");
      }
      const { error: documentError } = await supabase.from("documents").insert({
        id: documentId,
        owner_id: candidate.ownerId,
        title: `${definition.publisher} — ${candidate.exactVersion}`,
        description: "Owned staging candidate for governed public-source review.",
        file_name: fileName,
        file_type: candidate.contentType,
        file_size: candidate.bytes.byteLength,
        storage_path: storagePath,
        source_path: candidate.exactUrl,
        content_hash: candidate.contentHash,
        status: "uploaded",
        metadata: {
          ...candidate.metadata,
          source_storage_path: sourceStoragePath,
          staged_storage_path: storagePath,
        },
      });
      if (documentError) {
        await supabase.storage
          .from(env.SUPABASE_DOCUMENT_BUCKET)
          .remove([...new Set([storagePath, sourceStoragePath])]);
        throw new Error("Public source staging document insert failed.");
      }
      const { data: versionId, error: versionError } = await supabase.rpc("stage_public_source_version", {
        p_version: {
          activationEventId: plan.sourceActivationEventId,
          catalogueKey: plan.catalogueKey,
          exactCanonicalUrl: definition.canonicalUrl,
          exactUrl: candidate.exactUrl,
          exactVersion: candidate.exactVersion,
          contentHash: candidate.sourceContentHash,
          stagedContentHash: candidate.contentHash,
          retrievedAt: new Date().toISOString(),
          licenceEvidenceDigest: plan.licenceEvidenceDigest,
          stagingDocumentId: documentId,
          stagingOwnerId: candidate.ownerId,
          lifecycle: "shadow",
        },
      });
      if (versionError) {
        await supabase.from("documents").delete().eq("id", documentId).eq("owner_id", candidate.ownerId);
        await supabase.storage
          .from(env.SUPABASE_DOCUMENT_BUCKET)
          .remove([...new Set([storagePath, sourceStoragePath])]);
        throw new Error("Public source version staging failed.");
      }
      return { documentId, ownerId: candidate.ownerId, versionId };
    },
    enqueue: async ({ documentId, ownerId, metadata }) => {
      await authorizePlan(plan);
      let result;
      try {
        result = await enqueueDocumentReindexJob({
          supabase,
          document: { id: documentId, owner_id: ownerId, status: "uploaded", metadata },
        });
      } catch {
        throw new Error("Public source enqueue failed.");
      }
      if (result.outcome === "document_deleted") throw new Error("Public source staging disappeared before enqueue.");
    },
  };
}

export async function runFetchApprovedPublicSourceVersionsCli(
  argv: readonly string[],
  options: {
    dependenciesForPlan?: (plan: PublicSourceAcquisitionPlan) => Promise<PublicSourceApplyDependencies>;
    stdout?: (message: string) => void;
  } = {},
) {
  const manifestPath = option(argv, "--manifest");
  const stdout = options.stdout ?? console.log;
  if (!manifestPath) {
    stdout(JSON.stringify({ mode: "dry-run", reason: "manifest path is required", plans: [] }));
    return { applied: false, count: 0 } as const;
  }
  const raw = readFileSync(resolve(manifestPath), "utf8");
  const manifest = parsePublicSourceAcquisitionManifest(JSON.parse(raw) as unknown);
  const digest = publicSourceAcquisitionManifestDigest(raw);
  const expectedCount = Number(option(argv, "--expected-count"));
  const confirmed =
    argv.includes("--apply") &&
    Number.isSafeInteger(expectedCount) &&
    expectedCount === manifest.plans.length &&
    option(argv, "--manifest-sha256") === digest;
  if (!confirmed) {
    stdout(
      JSON.stringify({
        mode: "dry-run",
        count: manifest.plans.length,
        manifestSha256: digest,
        plans: manifest.plans.map(({ catalogueKey, exactUrl, exactVersion, targetLifecycle }) => ({
          catalogueKey,
          exactUrl,
          exactVersion,
          targetLifecycle,
        })),
        required: ["--manifest", "--expected-count", "--manifest-sha256", "--apply"],
      }),
    );
    return { applied: false, count: manifest.plans.length } as const;
  }

  const results = [];
  for (const plan of manifest.plans) {
    const dependencies = await (options.dependenciesForPlan ?? createLivePublicSourceApplyDependencies)(plan);
    await dependencies.authorizePlan(plan);
    results.push(await acquirePublicSourceVersion(plan, dependencies));
  }
  stdout(JSON.stringify({ mode: "apply", count: results.length, results }));
  return { applied: true, count: results.length, results } as const;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runFetchApprovedPublicSourceVersionsCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public source fetch failed.");
    process.exitCode = 1;
  });
}
