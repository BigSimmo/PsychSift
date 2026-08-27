type SupabaseProbeClient = {
  from(table: string): {
    select(
      columns: string,
      options?: Record<string, unknown>,
    ): {
      limit(
        count: number,
      ): PromiseLike<{ error: { message?: string; code?: string; details?: string; hint?: string } | null }>;
    };
  };
};

export type SiteContentRuntimeAuthoritySnapshot = Readonly<{
  version: "site-content-runtime-authority-v1";
  observedAt: string;
  changeEpoch: string;
  activeRelease: null | Readonly<{
    releaseId: string;
    state: string;
    registryVersion: string;
    staticManifestDigest: string;
    dynamicStateDigest: string;
    releaseDigest: string;
    deploymentSha: string;
    activatedAt: string;
    expectedRecordCount: number;
    projectedRecordCount: number;
    integrityVerified: boolean;
    publicVisibilityVerified: boolean;
    governanceVerified: boolean;
    mustPassVerified: boolean;
  }>;
  pendingLogicalIds: string[];
  pendingLogicalIdCount: number;
  directSuccessorCandidateCount: number;
  orphanedNonterminalOutboxCount: number;
  outbox: Readonly<{
    pendingCount: number;
    leasedCount: number;
    quarantinedCount: number;
    oldestPendingAgeSeconds: number | null;
  }>;
  integrity: Readonly<{
    gateArtifactCount: number;
    gateArtifactSubjectMismatchCount: number;
    projectionOperationMismatchCount: number;
  }>;
  rollbackAvailable: boolean;
  synchronizer: Readonly<{
    lastInvocationId: string | null;
    lastWorkerId: string | null;
    lastInvokedAt: string | null;
    lastHeartbeatAt: string | null;
    lastCompletedAt: string | null;
    lastOutcome: "running" | "succeeded" | "failed" | null;
  }>;
}>;

type RuntimeAuthorityClient = {
  rpc(name: "read_site_content_runtime_authority", args?: never): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function readSiteContentRuntimeAuthority(
  supabase: RuntimeAuthorityClient,
): Promise<SiteContentRuntimeAuthoritySnapshot> {
  const { data, error } = await supabase.rpc("read_site_content_runtime_authority");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Canonical site-content runtime authority is unavailable.");
  }
  return data as SiteContentRuntimeAuthoritySnapshot;
}

export type SupabaseHealthResult =
  | { ok: true; checkedAt: string }
  | {
      ok: false;
      checkedAt: string;
      failureKind: "unavailable" | "query";
      message: string;
      rawMessage: string;
    };

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error ?? "");
}

export function isSupabaseUnavailableError(error: unknown) {
  const message = errorMessage(error);
  return /<!doctype html|<html[\s>]|522|544|504|520|connection terminated|connection timeout|statement timeout|fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(
    message,
  );
}

export function formatSupabaseUnavailableError(error: unknown) {
  const message = errorMessage(error);
  const title = message
    .match(/<title>\s*([^<]+?)\s*<\/title>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  if (title) return `Supabase is temporarily unavailable (${title}).`;
  if (/connection terminated/i.test(message)) return "Supabase SQL connection was terminated due to a timeout.";
  if (/statement timeout/i.test(message)) return "Supabase cancelled the query due to statement timeout.";
  if (/544/.test(message)) return "Supabase Storage is timing out with a 544 response.";
  if (/522/.test(message)) return "Supabase API is timing out with a 522 response.";
  if (/504/.test(message)) return "Supabase API is timing out with a 504 response.";
  return message
    ? `Supabase is temporarily unavailable: ${message.slice(0, 240)}`
    : "Supabase is temporarily unavailable.";
}

export async function probeSupabaseHealth(supabase: SupabaseProbeClient): Promise<SupabaseHealthResult> {
  const checkedAt = new Date().toISOString();
  try {
    const { error } = await supabase.from("import_batches").select("id").limit(1);
    if (!error) return { ok: true, checkedAt };
    return {
      ok: false,
      checkedAt,
      failureKind: isSupabaseUnavailableError(error) ? "unavailable" : "query",
      message: isSupabaseUnavailableError(error)
        ? formatSupabaseUnavailableError(error)
        : "Supabase health check failed.",
      rawMessage: errorMessage(error),
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      failureKind: isSupabaseUnavailableError(error) ? "unavailable" : "query",
      message: isSupabaseUnavailableError(error)
        ? formatSupabaseUnavailableError(error)
        : "Supabase health check failed.",
      rawMessage: errorMessage(error),
    };
  }
}

export function assertSupabaseHealthy(result: SupabaseHealthResult, action: string) {
  if (result.ok) return;
  throw new Error(`${action} is paused because ${result.message}`);
}
