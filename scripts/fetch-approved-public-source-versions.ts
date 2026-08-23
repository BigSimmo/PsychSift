import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  acquirePublicSourceVersion,
  localPublicSourceContentIdentityVerdict,
  type AcquisitionFetch,
  type PublicSourceContentIdentityScan,
  type PublicSourceAcquisitionPlan,
  type PublicSourceStagingCandidate,
} from "@/lib/public-source-acquisition";
import {
  parsePublicSourceAcquisitionManifest,
  publicSourceAcquisitionManifestDigest,
  readPublicSourceJsonFile,
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
  scan: PublicSourceContentIdentityScan;
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

type PublicSourceStageRpcResult =
  | Readonly<{ outcome: "missing" }>
  | Readonly<{
      outcome: "created" | "resumed";
      versionId: string;
      documentId: string;
      ownerId: string;
    }>;

function parseStageRpcResult(input: unknown): PublicSourceStageRpcResult {
  if (!input || typeof input !== "object") throw new Error("Public source staging response was invalid.");
  const value = input as Partial<{
    outcome: PublicSourceStageRpcResult["outcome"];
    versionId: string;
    documentId: string;
    ownerId: string;
  }>;
  if (value.outcome === "missing") return Object.freeze({ outcome: "missing" });
  if (
    !["created", "resumed"].includes(value.outcome ?? "") ||
    !value.versionId ||
    !value.documentId ||
    !value.ownerId
  ) {
    throw new Error("Public source staging response was invalid.");
  }
  return Object.freeze({
    outcome: value.outcome as "created" | "resumed",
    versionId: value.versionId,
    documentId: value.documentId,
    ownerId: value.ownerId,
  });
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
  const activationEventId = plan.sourceActivationEventId;
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
    // Transparent retained text can be inspected locally; opaque containers require a trusted injected verdict.
    scan: async (input) => localPublicSourceContentIdentityVerdict(input),
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
      const versionIdentity = {
        activationEventId,
        catalogueKey: plan.catalogueKey,
        exactCanonicalUrl: definition.canonicalUrl,
        exactUrl: candidate.exactUrl,
        exactVersion: candidate.exactVersion,
        contentHash: candidate.sourceContentHash,
        stagedContentHash: candidate.contentHash,
        stagedContentType: candidate.contentType,
        stagedByteLength: candidate.bytes.byteLength,
        sourceContentType: candidate.sourceContentType,
        sourceByteLength: candidate.sourceByteLength,
        licenceEvidenceDigest: plan.licenceEvidenceDigest,
        stagingOwnerId: candidate.ownerId,
        lifecycle: "shadow",
      };
      const { data: resumableData, error: resumableError } = await supabase.rpc("stage_public_source_version", {
        p_version: versionIdentity,
      });
      if (resumableError) throw new Error("Public source resumable staging validation failed.");
      const resumable = parseStageRpcResult(resumableData);
      if (resumable.outcome === "resumed") {
        return {
          documentId: resumable.documentId,
          ownerId: resumable.ownerId,
          versionId: resumable.versionId,
        };
      }

      const documentId = randomUUID();
      const fileName = fileNameFor(candidate.exactUrl, candidate.contentType);
      const storagePath = `public-sources/${candidate.ownerId}/${documentId}/canonical/${fileName}`;
      const upload = await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).upload(storagePath, candidate.bytes, {
        contentType: candidate.contentType,
        upsert: false,
      });
      if (upload.error) throw new Error("Public source canonical Storage upload failed.");
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
          canonical_storage_path: storagePath,
        },
      });
      if (documentError) {
        await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).remove([storagePath]);
        throw new Error("Public source staging document insert failed.");
      }
      const { data: stagedData, error: versionError } = await supabase.rpc("stage_public_source_version", {
        p_version: {
          ...versionIdentity,
          retrievedAt: new Date().toISOString(),
          stagingDocumentId: documentId,
        },
      });
      if (versionError) {
        await supabase.from("documents").delete().eq("id", documentId).eq("owner_id", candidate.ownerId);
        await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).remove([storagePath]);
        throw new Error("Public source version staging failed.");
      }
      const staged = parseStageRpcResult(stagedData);
      if (staged.outcome === "missing") {
        await supabase.from("documents").delete().eq("id", documentId).eq("owner_id", candidate.ownerId);
        await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).remove([storagePath]);
        throw new Error("Public source version staging did not persist a shadow.");
      }
      if (staged.documentId !== documentId) {
        await supabase.from("documents").delete().eq("id", documentId).eq("owner_id", candidate.ownerId);
        await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).remove([storagePath]);
      }
      return { documentId: staged.documentId, ownerId: staged.ownerId, versionId: staged.versionId };
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
  const { raw, value } = readPublicSourceJsonFile(manifestPath, "manifest");
  const manifest = parsePublicSourceAcquisitionManifest(value);
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
