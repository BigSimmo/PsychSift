import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  fetchApprovedPublicSource,
  parseFetchApprovedSourceArgs,
  parsePublicSourceAcquisitionPlan,
  type PublicSourceAcquisitionPlan,
} from "@/lib/public-source-acquisition";
import type { Json } from "@/lib/supabase/database.types";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export function parseAcquisitionBatch(raw: string) {
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 1) {
    throw new Error("Acquisition manifest version is invalid.");
  }
  const rawPlans = (input as { plans?: unknown }).plans;
  if (!Array.isArray(rawPlans) || rawPlans.length < 1 || rawPlans.length > 500) {
    throw new Error("Acquisition manifest plan count must be between 1 and 500.");
  }
  const plans = rawPlans.map(parsePublicSourceAcquisitionPlan);
  const identities = plans.map((plan) => `${plan.catalogueKey}\u0000${plan.exactUrl}`);
  if (new Set(identities).size !== identities.length)
    throw new Error("Acquisition manifest contains duplicate exact URLs.");
  return plans;
}

type FetchedPublicSource = Omit<
  Awaited<ReturnType<typeof fetchApprovedPublicSource>>,
  "rawResponseHash" | "rawResponseByteCount"
> & {
  rawResponseHash?: string;
  rawResponseByteCount?: number;
};
type PublicSourceVersionState = {
  id: string;
  lifecycle: string;
  staging_document_id: string | null;
  reservation_key?: string;
  source_catalogue_key?: string;
  source_policy_version?: string;
  source_policy_digest?: string;
  activation_event_id?: string;
  activation_sequence?: number;
  exact_canonical_url?: string;
  exact_version_url?: string;
  exact_version?: string;
  content_hash?: string;
  raw_response_hash?: string;
  raw_response_byte_count?: number;
  licence_evidence_digest?: string;
  steward_id?: string;
  intended_disposition?: string;
  reserved_document_id?: string;
  reserved_storage_path?: string;
  storage_bucket?: string;
  upload_lease_token?: string;
  upload_lease_expires_at?: string;
  upload_state?: string;
  upload_attempt_id?: string;
  current_upload_attempt_id?: string | null;
  finalized_upload_attempt_id?: string | null;
};
type PublicSourceReservation = {
  id: string;
  reservedDocumentId: string;
  storagePath: string;
  stagingDocumentId: string | null;
  lifecycle: string;
  storageBucket: string;
  uploadLeaseToken: string;
  uploadLeaseExpiresAt: string;
  uploadState: string;
  uploadAttemptId?: string;
};

export type SignedPublicSourceUploadAuthority = {
  signedUrl: string;
  storagePath: string;
  digest: string;
  expiresAt: string;
};

export type PublicSourceStagingDependencies = {
  storageBucket: string;
  preflight?(input: { manifest: Json }): Promise<unknown>;
  reserve(input: { manifest: Json }): Promise<PublicSourceReservation>;
  authorizeUpload(input: { manifest: Json }): Promise<PublicSourceVersionState>;
  createSignedUploadAuthority?(input: {
    storageBucket: string;
    storagePath: string;
  }): Promise<SignedPublicSourceUploadAuthority>;
  bindUploadAuthority?(input: { manifest: Json }): Promise<PublicSourceVersionState>;
  lookupAttempt?(uploadAttemptId: string): Promise<Record<string, unknown> | null>;
  upload(input: {
    storagePath: string;
    signedAuthority?: SignedPublicSourceUploadAuthority;
    content: Uint8Array;
    mime: string;
    signal: AbortSignal;
  }): Promise<void>;
  finalize(input: { manifest: Json; maxAttempts: number }): Promise<PublicSourceVersionState>;
  lookup(reservationId: string): Promise<PublicSourceVersionState | null>;
  abandon?(input: { manifest: Json }): Promise<{ status: string; storagePath: string; storageOwned: boolean }>;
};

const SIGNED_UPLOAD_MAX_LIFETIME_SECONDS = 2 * 60 * 60 + 60;

export function parseSignedPublicSourceUploadAuthority(
  input: { signedUrl: string; token: string; path: string },
  expected: {
    supabaseUrl: string;
    storageBucket: string;
    storagePath: string;
    nowEpochSeconds?: number;
  },
): SignedPublicSourceUploadAuthority {
  const fail = () => {
    throw new Error("Public source signed upload authority is invalid.");
  };
  if (input.path !== expected.storagePath || !input.token || input.token.length > 8192) fail();
  let url: URL;
  let base: URL;
  try {
    url = new URL(input.signedUrl);
    base = new URL(expected.supabaseUrl);
  } catch {
    return fail();
  }
  const encodedPath = expected.storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const expectedPath = `/storage/v1/object/upload/sign/${encodeURIComponent(expected.storageBucket)}/${encodedPath}`;
  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.pathname !== expectedPath ||
    url.searchParams.get("token") !== input.token ||
    [...url.searchParams.keys()].some((key) => key !== "token") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    fail();
  }
  let payload: unknown;
  try {
    const parts = input.token.split(".");
    if (parts.length !== 3 || !parts[1]) fail();
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return fail();
  }
  const exp = (payload as { exp?: unknown })?.exp;
  const now = expected.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(exp) ||
    (exp as number) <= now ||
    (exp as number) - now > SIGNED_UPLOAD_MAX_LIFETIME_SECONDS
  ) {
    fail();
  }
  return {
    signedUrl: url.toString(),
    storagePath: expected.storagePath,
    digest: createHash("sha256").update(input.token, "utf8").digest("hex"),
    expiresAt: new Date((exp as number) * 1000).toISOString(),
  };
}

export async function uploadPublicSourceWithSignedAuthority(
  authority: SignedPublicSourceUploadAuthority,
  content: Uint8Array,
  mime: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const bytes = Uint8Array.from(content);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  try {
    const response = await request(authority.signedUrl, {
      method: "PUT",
      headers: { "content-type": mime, "x-upsert": "false" },
      body,
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Public source storage write failed.");
    }
    await response.body?.cancel();
  } catch {
    throw new Error(
      signal.aborted ? "Public source storage write was cancelled." : "Public source storage write failed.",
    );
  }
}

export function parsePublicSourceStorageBucket(value: string) {
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(value)) {
    throw new Error("Public source storage bucket is invalid.");
  }
  return value;
}

export function publicSourceAuthorityManifest(planInput: PublicSourceAcquisitionPlan, storageBucket: string): Json {
  const plan = parsePublicSourceAcquisitionPlan(planInput);
  const definition = australianSourceByKey(plan.catalogueKey)!;
  return {
    catalogueKey: plan.catalogueKey,
    activationEventId: plan.activationEventId,
    activationSequence: plan.activationSequence,
    sourcePolicyVersion: plan.sourcePolicyVersion,
    sourcePolicyDigest: plan.sourcePolicyDigest,
    exactCanonicalUrl: definition.canonicalUrl,
    exactVersionUrl: plan.exactUrl,
    exactHostname: new URL(plan.exactUrl).hostname.toLowerCase(),
    stewardId: plan.stewardId,
    storageBucket: parsePublicSourceStorageBucket(storageBucket),
  };
}

function acquisitionFileExtension(fetched: FetchedPublicSource) {
  if (fetched.mime === "text/plain") return ".txt";
  if (fetched.mime === "application/pdf") return ".pdf";
  if (fetched.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  return extname(new URL(fetched.finalUrl).pathname).toLowerCase() || ".bin";
}

function reservationKey(plan: PublicSourceAcquisitionPlan, fetched: FetchedPublicSource, storageBucket: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        catalogueKey: plan.catalogueKey,
        activationEventId: plan.activationEventId,
        activationSequence: plan.activationSequence,
        exactUrl: fetched.finalUrl,
        exactVersion: plan.exactVersion,
        contentHash: fetched.contentHash,
        disposition: fetched.disposition,
        storageBucket,
      }),
      "utf8",
    )
    .digest("hex");
}

async function defaultStagingDependencies(): Promise<{
  dependencies: PublicSourceStagingDependencies;
  maxAttempts: number;
}> {
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ env, requireServerEnv }, { createAdminClient }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
  ]);
  const { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl } = requireServerEnv();
  const supabase = createAdminClient();
  return {
    maxAttempts: env.WORKER_MAX_ATTEMPTS,
    dependencies: {
      storageBucket: parsePublicSourceStorageBucket(env.SUPABASE_DOCUMENT_BUCKET),
      preflight: async ({ manifest }) => {
        const { data, error } = await supabase.rpc("preflight_public_source_acquisition", { p_manifest: manifest });
        if (error || !data) throw new Error("Current public source authority preflight failed.");
        return data;
      },
      reserve: async ({ manifest }) => {
        const { data, error } = await supabase.rpc("reserve_public_source_version", { p_manifest: manifest });
        if (error || !data) throw new Error("Public source authority reservation failed.");
        return {
          id: data.id,
          reservedDocumentId: data.reserved_document_id,
          storagePath: data.reserved_storage_path,
          stagingDocumentId: data.staging_document_id,
          lifecycle: data.lifecycle,
          storageBucket: data.storage_bucket,
          uploadLeaseToken: data.upload_lease_token,
          uploadLeaseExpiresAt: data.upload_lease_expires_at,
          uploadState: data.upload_state,
          uploadAttemptId: data.current_upload_attempt_id ?? undefined,
        };
      },
      authorizeUpload: async ({ manifest }) => {
        const { data, error } = await supabase.rpc("authorize_public_source_upload", { p_manifest: manifest });
        if (error || !data) throw new Error("Public source upload authority failed.");
        return data as PublicSourceVersionState;
      },
      createSignedUploadAuthority: async ({ storageBucket, storagePath }) => {
        const { data, error } = await supabase.storage
          .from(storageBucket)
          .createSignedUploadUrl(storagePath, { upsert: false });
        if (error || !data) throw new Error("Public source signed upload authority creation failed.");
        return parseSignedPublicSourceUploadAuthority(data, {
          supabaseUrl,
          storageBucket,
          storagePath,
        });
      },
      bindUploadAuthority: async ({ manifest }) => {
        const { data, error } = await supabase.rpc("bind_public_source_upload_authority", {
          p_manifest: manifest,
        });
        if (error || !data) throw new Error("Public source signed upload authority binding failed.");
        return data as PublicSourceVersionState;
      },
      lookupAttempt: async (attemptId) => {
        const { data, error } = await supabase
          .from("public_source_upload_attempts")
          .select(
            "id,version_id,claim_token,claim_expires_at,storage_bucket,storage_path,state,signed_authority_digest,signed_authority_expires_at,cleanup_not_before",
          )
          .eq("id", attemptId)
          .maybeSingle();
        if (error) throw new Error("Public source upload attempt recovery failed.");
        return data;
      },
      upload: async ({ content, mime, signal, signedAuthority }) => {
        if (!signedAuthority) throw new Error("Public source signed upload authority is required.");
        await uploadPublicSourceWithSignedAuthority(signedAuthority, content, mime, signal);
      },
      finalize: async ({ manifest, maxAttempts }) => {
        const { data, error } = await supabase.rpc("finalize_public_source_version", {
          p_manifest: manifest,
          p_max_attempts: maxAttempts,
        });
        if (error || !data) throw new Error("Public source version finalization failed.");
        return data;
      },
      lookup: async (reservationId) => {
        const { data, error } = await supabase
          .from("public_source_versions")
          .select(
            "id,lifecycle,staging_document_id,reservation_key,source_catalogue_key,source_policy_version,source_policy_digest,activation_event_id,activation_sequence,exact_canonical_url,exact_version_url,exact_version,content_hash,raw_response_hash,raw_response_byte_count,licence_evidence_digest,steward_id,intended_disposition,reserved_document_id,reserved_storage_path,storage_bucket,upload_lease_token,upload_lease_expires_at,upload_state,current_upload_attempt_id,finalized_upload_attempt_id",
          )
          .eq("id", reservationId)
          .maybeSingle();
        if (error) throw new Error("Public source reservation recovery failed.");
        return data;
      },
      abandon: async ({ manifest }) => {
        const { data, error } = await supabase.rpc("abandon_public_source_reservation", { p_manifest: manifest });
        if (error || !data || typeof data !== "object") {
          throw new Error("Public source reservation abandonment failed.");
        }
        const result = data as { status?: unknown; storagePath?: unknown; storageOwned?: unknown };
        if (
          typeof result.status !== "string" ||
          typeof result.storagePath !== "string" ||
          typeof result.storageOwned !== "boolean"
        ) {
          throw new Error("Public source reservation abandonment returned an invalid result.");
        }
        return { status: result.status, storagePath: result.storagePath, storageOwned: result.storageOwned };
      },
    },
  };
}

function recoveryIdentityMatches(
  recovered: PublicSourceVersionState,
  reservation: PublicSourceReservation,
  manifest: Record<string, Json | undefined>,
) {
  return (
    recovered.id === reservation.id &&
    recovered.reservation_key === manifest.reservationKey &&
    recovered.source_catalogue_key === manifest.catalogueKey &&
    recovered.source_policy_version === manifest.sourcePolicyVersion &&
    recovered.source_policy_digest === manifest.sourcePolicyDigest &&
    recovered.activation_event_id === manifest.activationEventId &&
    recovered.activation_sequence === manifest.activationSequence &&
    recovered.exact_canonical_url === manifest.exactCanonicalUrl &&
    recovered.exact_version_url === manifest.exactVersionUrl &&
    recovered.exact_version === manifest.exactVersion &&
    recovered.content_hash === manifest.contentHash &&
    recovered.raw_response_hash === manifest.rawResponseHash &&
    recovered.raw_response_byte_count === manifest.rawResponseByteCount &&
    recovered.licence_evidence_digest === manifest.licenceEvidenceDigest &&
    recovered.steward_id === manifest.stewardId &&
    recovered.intended_disposition === manifest.disposition &&
    recovered.reserved_document_id === reservation.reservedDocumentId &&
    recovered.reserved_storage_path === reservation.storagePath &&
    recovered.storage_bucket === reservation.storageBucket &&
    recovered.upload_lease_token === reservation.uploadLeaseToken &&
    recovered.upload_lease_expires_at === reservation.uploadLeaseExpiresAt
  );
}

function recoveryGovernanceMatches(
  recovered: PublicSourceVersionState,
  reservation: PublicSourceReservation,
  manifest: Record<string, Json | undefined>,
) {
  return (
    recovered.id === reservation.id &&
    recovered.reservation_key === manifest.reservationKey &&
    recovered.source_catalogue_key === manifest.catalogueKey &&
    recovered.source_policy_version === manifest.sourcePolicyVersion &&
    recovered.source_policy_digest === manifest.sourcePolicyDigest &&
    recovered.activation_event_id === manifest.activationEventId &&
    recovered.activation_sequence === manifest.activationSequence &&
    recovered.exact_canonical_url === manifest.exactCanonicalUrl &&
    recovered.exact_version_url === manifest.exactVersionUrl &&
    recovered.exact_version === manifest.exactVersion &&
    recovered.content_hash === manifest.contentHash &&
    recovered.raw_response_hash === manifest.rawResponseHash &&
    recovered.raw_response_byte_count === manifest.rawResponseByteCount &&
    recovered.licence_evidence_digest === manifest.licenceEvidenceDigest &&
    recovered.steward_id === manifest.stewardId &&
    recovered.intended_disposition === manifest.disposition &&
    recovered.reserved_document_id === reservation.reservedDocumentId &&
    recovered.storage_bucket === reservation.storageBucket
  );
}

function isCommittedRecovery(recovered: PublicSourceVersionState, reservation: PublicSourceReservation) {
  return (
    recovered.staging_document_id === reservation.reservedDocumentId &&
    ["shadow", "quarantined", "approved", "active", "tombstoned"].includes(recovered.lifecycle)
  );
}

function uploadAuthorityMatches(
  authorized: PublicSourceVersionState,
  reservation: PublicSourceReservation,
  stewardId: string,
) {
  return (
    authorized.id === reservation.id &&
    authorized.lifecycle === "discovered" &&
    authorized.staging_document_id === null &&
    authorized.reserved_document_id === reservation.reservedDocumentId &&
    typeof authorized.reserved_storage_path === "string" &&
    authorized.reserved_storage_path.length > 0 &&
    authorized.storage_bucket === reservation.storageBucket &&
    typeof authorized.upload_lease_token === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authorized.upload_lease_token) &&
    typeof authorized.upload_lease_expires_at === "string" &&
    Number.isFinite(Date.parse(authorized.upload_lease_expires_at)) &&
    authorized.upload_state === "uploading" &&
    authorized.steward_id === stewardId
  );
}

export async function stageFetchedPublicSource(
  plan: PublicSourceAcquisitionPlan,
  fetched: FetchedPublicSource,
  injectedDependencies?: PublicSourceStagingDependencies,
  options: { signal?: AbortSignal; uploadTimeoutMs?: number } = {},
) {
  plan = parsePublicSourceAcquisitionPlan(plan);
  const definition = australianSourceByKey(plan.catalogueKey)!;
  const safeExtension = acquisitionFileExtension(fetched);
  const defaults = injectedDependencies ? null : await defaultStagingDependencies();
  const dependencies = injectedDependencies ?? defaults!.dependencies;
  const storageBucket = parsePublicSourceStorageBucket(dependencies.storageBucket);
  const rawResponseHash = fetched.rawResponseHash ?? fetched.contentHash;
  const rawResponseByteCount = fetched.rawResponseByteCount ?? fetched.byteCount;
  if (
    !/^[0-9a-f]{64}$/.test(rawResponseHash) ||
    !Number.isSafeInteger(rawResponseByteCount) ||
    rawResponseByteCount < 0
  ) {
    throw new Error("Public source raw response provenance was invalid.");
  }
  const maxAttempts = defaults?.maxAttempts ?? 3;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 60_000;
  if (!Number.isInteger(uploadTimeoutMs) || uploadTimeoutMs < 1 || uploadTimeoutMs > 60_000) {
    throw new Error("Public source upload timeout must be between 1 and 60000 milliseconds.");
  }
  const reserveManifest = {
    reservationKey: reservationKey(plan, fetched, storageBucket),
    catalogueKey: plan.catalogueKey,
    sourcePolicyVersion: plan.sourcePolicyVersion,
    sourcePolicyDigest: plan.sourcePolicyDigest,
    activationEventId: plan.activationEventId,
    activationSequence: plan.activationSequence,
    exactCanonicalUrl: definition.canonicalUrl,
    exactVersionUrl: fetched.finalUrl,
    exactVersion: plan.exactVersion,
    contentHash: fetched.contentHash,
    rawResponseHash,
    rawResponseByteCount,
    retrievedAt: new Date().toISOString(),
    licenceEvidenceDigest: plan.licenceEvidenceDigest,
    stewardId: plan.stewardId,
    disposition: fetched.disposition,
    fileExtension: safeExtension,
    storageBucket,
  } satisfies Json;
  const reservation = await dependencies.reserve({
    manifest: reserveManifest,
  });
  if (
    reservation.storageBucket !== storageBucket ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservation.uploadLeaseToken) ||
    !Number.isFinite(Date.parse(reservation.uploadLeaseExpiresAt))
  ) {
    throw new Error("Public source reservation storage identity was invalid.");
  }
  if (reservation.stagingDocumentId) {
    return { disposition: "duplicate" as const, version: reservation };
  }
  let storageWriteAttempted = false;
  let attemptClaimed = false;
  let signedAuthority: SignedPublicSourceUploadAuthority | undefined;
  let activeReservation = reservation;
  try {
    const authorized = await dependencies.authorizeUpload({
      manifest: {
        ...reserveManifest,
        reservationId: reservation.id,
        reservedDocumentId: reservation.reservedDocumentId,
        reservedStoragePath: reservation.storagePath,
        uploadLeaseToken: reservation.uploadLeaseToken,
        uploadLeaseExpiresAt: reservation.uploadLeaseExpiresAt,
      },
    });
    if (!uploadAuthorityMatches(authorized, reservation, plan.stewardId)) {
      throw new Error("Public source upload authority did not match the immutable reservation.");
    }
    if (dependencies.createSignedUploadAuthority && !authorized.upload_attempt_id) {
      throw new Error("Public source upload authority omitted its unique attempt identity.");
    }
    activeReservation = {
      ...reservation,
      storagePath: authorized.reserved_storage_path!,
      uploadAttemptId: authorized.upload_attempt_id,
      uploadLeaseToken: authorized.upload_lease_token!,
      uploadLeaseExpiresAt: authorized.upload_lease_expires_at!,
      uploadState: authorized.upload_state!,
    };
    attemptClaimed = true;

    if (dependencies.createSignedUploadAuthority) {
      if (!dependencies.bindUploadAuthority || !activeReservation.uploadAttemptId) {
        throw new Error("Public source signed upload binding is unavailable.");
      }
      signedAuthority = await dependencies.createSignedUploadAuthority({
        storageBucket,
        storagePath: activeReservation.storagePath,
      });
      const bindManifest = {
        ...reserveManifest,
        reservationId: reservation.id,
        uploadAttemptId: activeReservation.uploadAttemptId,
        reservedDocumentId: reservation.reservedDocumentId,
        reservedStoragePath: activeReservation.storagePath,
        uploadLeaseToken: activeReservation.uploadLeaseToken,
        uploadLeaseExpiresAt: activeReservation.uploadLeaseExpiresAt,
        signedAuthorityDigest: signedAuthority.digest,
        signedAuthorityExpiresAt: signedAuthority.expiresAt,
      } satisfies Json;
      try {
        await dependencies.bindUploadAuthority({ manifest: bindManifest });
      } catch {
        let bound: Record<string, unknown> | null = null;
        try {
          bound = (await dependencies.lookupAttempt?.(activeReservation.uploadAttemptId)) ?? null;
        } catch {
          // A lost bind response is safe only when exact durable evidence is readable.
        }
        if (
          !bound ||
          bound.id !== activeReservation.uploadAttemptId ||
          bound.version_id !== reservation.id ||
          bound.claim_token !== activeReservation.uploadLeaseToken ||
          bound.storage_bucket !== storageBucket ||
          bound.storage_path !== activeReservation.storagePath ||
          bound.signed_authority_digest !== signedAuthority.digest ||
          bound.signed_authority_expires_at !== signedAuthority.expiresAt ||
          bound.state !== "bound"
        ) {
          throw new Error("Public source signed upload binding outcome was ambiguous.");
        }
      }
    }

    storageWriteAttempted = true;
    const uploadController = new AbortController();
    const forwardAbort = () =>
      uploadController.abort(options.signal?.reason ?? new Error("Public source upload was cancelled."));
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const uploadTimer = setTimeout(
      () => uploadController.abort(new Error("Public source storage write timed out.")),
      uploadTimeoutMs,
    );
    try {
      await dependencies.upload({
        storagePath: activeReservation.storagePath,
        signedAuthority,
        content: fetched.content,
        mime: fetched.mime,
        signal: uploadController.signal,
      });
    } finally {
      clearTimeout(uploadTimer);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
    const metadata = {
      corpus_scope: "australian_public",
      source_kind: "document",
      source_catalogue_key: plan.catalogueKey,
      source_policy_version: plan.sourcePolicyVersion,
      source_policy_digest: plan.sourcePolicyDigest,
      public_source_activation_event_id: plan.activationEventId,
      public_source_activation_sequence: String(plan.activationSequence),
      public_source_version_id: reservation.id,
      public_source_steward_id: plan.stewardId,
      content_mode: "indexed_content",
      licence_policy: "public_index_permitted",
      acquisition_disposition: fetched.disposition,
      public_source_storage_bucket: storageBucket,
      publisher: definition.publisher,
      publisher_code: definition.publisherCode,
      jurisdiction: definition.jurisdiction,
      source_role: definition.roles[0] ?? "clinical_guideline",
      source_title: plan.exactVersion,
      canonical_url: definition.canonicalUrl,
      exact_version_url: fetched.finalUrl,
      version: plan.exactVersion,
      document_status: "current",
      change_state: "changed",
      clinical_validation_status: "unverified",
      content_hash: fetched.contentHash,
      raw_response_hash: rawResponseHash,
      raw_response_byte_count: rawResponseByteCount,
    };
    const version = await dependencies.finalize({
      manifest: {
        reservationId: reservation.id,
        catalogueKey: plan.catalogueKey,
        activationEventId: plan.activationEventId,
        activationSequence: plan.activationSequence,
        sourcePolicyVersion: plan.sourcePolicyVersion,
        sourcePolicyDigest: plan.sourcePolicyDigest,
        reservationKey: reserveManifest.reservationKey,
        exactCanonicalUrl: definition.canonicalUrl,
        exactVersionUrl: fetched.finalUrl,
        exactVersion: plan.exactVersion,
        contentHash: fetched.contentHash,
        rawResponseHash,
        rawResponseByteCount,
        licenceEvidenceDigest: plan.licenceEvidenceDigest,
        stewardId: plan.stewardId,
        disposition: fetched.disposition,
        storageBucket,
        reservedStoragePath: activeReservation.storagePath,
        uploadAttemptId: activeReservation.uploadAttemptId,
        uploadLeaseToken: activeReservation.uploadLeaseToken,
        uploadLeaseExpiresAt: activeReservation.uploadLeaseExpiresAt,
        signedAuthorityDigest: signedAuthority?.digest,
        signedAuthorityExpiresAt: signedAuthority?.expiresAt,
        document: {
          id: reservation.reservedDocumentId,
          owner_id: plan.stewardId,
          title: `${definition.publisher} — ${plan.exactVersion}`,
          description: "Controlled public-source staging document.",
          file_name: `source${safeExtension}`,
          file_type: fetched.mime,
          file_size: fetched.byteCount,
          storage_path: activeReservation.storagePath,
          content_hash: fetched.contentHash,
          metadata,
        },
      } satisfies Json,
      maxAttempts,
    });
    return { disposition: fetched.disposition, version };
  } catch {
    let recovered: PublicSourceVersionState | null;
    try {
      recovered = await dependencies.lookup(reservation.id);
    } catch {
      throw new Error("Public source finalization recovery lookup was ambiguous; storage remains untouched.");
    }
    if (!attemptClaimed) {
      if (recovered && recoveryGovernanceMatches(recovered, reservation, reserveManifest)) {
        if (isCommittedRecovery(recovered, reservation)) {
          return { disposition: fetched.disposition, version: recovered };
        }
        if (recovered.lifecycle === "discovered" && recovered.staging_document_id === null) {
          return { disposition: "in_progress" as const, version: recovered };
        }
      }
      throw new Error("Public source upload authority outcome was ambiguous; no attempt ownership was assumed.");
    }
    if (recovered && !recoveryIdentityMatches(recovered, activeReservation, reserveManifest)) {
      throw new Error("Public source recovery identity did not match the immutable reservation.");
    }
    if (recovered && isCommittedRecovery(recovered, activeReservation)) {
      return { disposition: fetched.disposition, version: recovered };
    }
    if (
      recovered &&
      ["discovered", "abandoned"].includes(recovered.lifecycle) &&
      recovered.staging_document_id === null &&
      dependencies.abandon
    ) {
      const abandonmentManifest = {
        ...reserveManifest,
        reservationId: reservation.id,
        reservedDocumentId: reservation.reservedDocumentId,
        reservedStoragePath: activeReservation.storagePath,
        storageBucket,
        uploadAttemptId: activeReservation.uploadAttemptId,
        uploadLeaseToken: activeReservation.uploadLeaseToken,
        uploadLeaseExpiresAt: activeReservation.uploadLeaseExpiresAt,
        signedAuthorityDigest: signedAuthority?.digest,
        signedAuthorityExpiresAt: signedAuthority?.expiresAt,
      };
      let abandoned: Awaited<ReturnType<NonNullable<PublicSourceStagingDependencies["abandon"]>>>;
      try {
        abandoned = await dependencies.abandon({ manifest: abandonmentManifest });
      } catch {
        const afterAmbiguousAbandon = await dependencies.lookup(reservation.id);
        if (
          !afterAmbiguousAbandon ||
          !recoveryIdentityMatches(afterAmbiguousAbandon, activeReservation, reserveManifest)
        ) {
          throw new Error("Public source abandonment outcome was ambiguous; storage remains untouched.");
        }
        if (isCommittedRecovery(afterAmbiguousAbandon, activeReservation)) {
          return { disposition: fetched.disposition, version: afterAmbiguousAbandon };
        }
        if (afterAmbiguousAbandon.lifecycle !== "abandoned" || afterAmbiguousAbandon.staging_document_id !== null) {
          throw new Error("Public source abandonment outcome was not definitively unowned.");
        }
        abandoned = await dependencies.abandon({ manifest: abandonmentManifest });
      }
      if (
        abandoned.status === "abandoned" &&
        abandoned.storageOwned === false &&
        abandoned.storagePath === activeReservation.storagePath
      ) {
        throw new Error("Public source reservation was abandoned with durable storage cleanup pending.");
      }
      if (abandoned.status === "committed" && abandoned.storageOwned === true) {
        const committed = await dependencies.lookup(reservation.id);
        if (
          committed &&
          recoveryIdentityMatches(committed, activeReservation, reserveManifest) &&
          isCommittedRecovery(committed, activeReservation)
        ) {
          return { disposition: fetched.disposition, version: committed };
        }
        throw new Error("Public source committed abandonment result could not be verified.");
      }
    }
    throw new Error(
      storageWriteAttempted
        ? "Public source finalization failed without definitive committed or abandoned state."
        : "Public source upload authority failed before storage.",
    );
  }
}

export async function fetchAndStageApprovedPublicSource(
  planInput: PublicSourceAcquisitionPlan,
  injectedDependencies?: PublicSourceStagingDependencies,
  acquisitionDependencies: Parameters<typeof fetchApprovedPublicSource>[1] = {},
) {
  const plan = parsePublicSourceAcquisitionPlan(planInput);
  const defaults = injectedDependencies ? null : await defaultStagingDependencies();
  const dependencies = injectedDependencies ?? defaults!.dependencies;
  if (!dependencies.preflight) throw new Error("Current public source authority preflight is required.");
  await dependencies.preflight({ manifest: publicSourceAuthorityManifest(plan, dependencies.storageBucket) });
  const fetched = await fetchApprovedPublicSource(plan, acquisitionDependencies);
  return { fetched, result: await stageFetchedPublicSource(plan, fetched, dependencies) };
}

async function main() {
  const args = parseFetchApprovedSourceArgs(process.argv.slice(2));
  const raw = await readFile(args.manifestPath, "utf8");
  const plans = parseAcquisitionBatch(raw);
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  console.log(`[public-sources:fetch] manifest SHA-256 ${digest}; exact count ${plans.length}`);
  if (!args.apply) {
    console.log("[public-sources:fetch] dry run only; no network, storage, database, enqueue, or activation occurred.");
    console.log(
      `[public-sources:fetch] apply with --expected-count ${plans.length} --confirm-sha256 ${digest} --apply`,
    );
    return;
  }
  if (args.expectedCount !== plans.length) throw new Error("Confirmed count does not match the acquisition manifest.");
  if (args.confirmSha256 !== digest) throw new Error("Confirmed SHA-256 does not match the acquisition manifest.");

  for (const plan of plans) {
    const { fetched, result } = await fetchAndStageApprovedPublicSource(plan);
    console.log(
      `[public-sources:fetch] ${plan.catalogueKey} ${new URL(plan.exactUrl).hostname} ${fetched.contentHash} ${result.disposition}`,
    );
  }
  console.log(
    "[public-sources:fetch] persisted owned shadow/quarantined versions only; no content was activated or published.",
  );
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public source fetch failed.");
    process.exit(1);
  });
}
