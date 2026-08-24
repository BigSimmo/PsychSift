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
    if (error.code === "42883" || /does not exist/i.test(error.message)) return null;
    throw new Error("Canonical public site-content read failed.");
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { records?: unknown }).records)) return null;
  const partition = data as PublicSiteContentPartition<T>;
  if (
    !Number.isSafeInteger(partition.changeEpoch) ||
    !["current", "updating", "unavailable"].includes(partition.state)
  ) {
    throw new Error("Canonical public site-content response is invalid.");
  }
  return partition;
}
