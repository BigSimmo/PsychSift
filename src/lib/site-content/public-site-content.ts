import type { SiteContentDomain, SiteContentPartitionState } from "@/lib/types";

type RpcClient = Pick<ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>, "rpc">;

export type PublicSiteContentRecord<T> = Readonly<{
  logical_id: string;
  payload: T;
  governance: Record<string, unknown>;
  publication_version: string;
  content_hash: string;
  source_lineage_digest: string;
}>;

export type PublicSiteContentPartition<T> = Readonly<{
  activeReleaseId: string | null;
  changeEpoch: number;
  state: SiteContentPartitionState;
  records: PublicSiteContentRecord<T>[];
}>;

export async function readPublicSiteContentPartition<T>(
  client: RpcClient,
  input: { domain: SiteContentDomain; recordKind?: string; slug?: string },
): Promise<PublicSiteContentPartition<T> | null> {
  const { data, error } = await client.rpc("read_public_site_content_records", {
    p_domain: input.domain,
    p_record_kind: input.recordKind ?? null,
    p_slug: input.slug ?? null,
  });
  if (error) {
    // The migration is forward-only; bundled public fixtures remain the explicit
    // fallback until the release authority is applied by an operator.
    if (error.code === "42883") return null;
    throw new Error("Canonical public site-content read failed.");
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { records?: unknown }).records)) {
    throw new Error("Canonical public site-content response is invalid.");
  }
  const partition = data as PublicSiteContentPartition<T>;
  const activeReleaseValid =
    partition.activeReleaseId === null ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(partition.activeReleaseId);
  const recordsValid = partition.records.every(
    (record) =>
      record &&
      typeof record.logical_id === "string" &&
      record.logical_id.length > 0 &&
      record.payload !== null &&
      typeof record.payload === "object" &&
      record.governance !== null &&
      typeof record.governance === "object" &&
      /^sha256:[a-f0-9]{64}$/.test(record.content_hash) &&
      /^sha256:[a-f0-9]{64}$/.test(record.source_lineage_digest),
  );
  if (
    !Number.isSafeInteger(partition.changeEpoch) ||
    partition.changeEpoch < 0 ||
    !["current", "updating", "unavailable"].includes(partition.state) ||
    !activeReleaseValid ||
    !recordsValid ||
    (partition.state === "unavailable" && (partition.activeReleaseId !== null || partition.records.length > 0)) ||
    (partition.state !== "unavailable" && partition.activeReleaseId === null)
  ) {
    throw new Error("Canonical public site-content response is invalid.");
  }
  return partition;
}
