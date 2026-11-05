import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/supabase/database.types";

export type MaintenanceDocument = {
  id: string;
  owner_id: string | null;
  updated_at: string;
  metadata: unknown;
};

export class IngestionMaintenanceConflict extends Error {
  constructor() {
    super("Document changed during maintenance; reload and recompute before retrying.");
    this.name = "IngestionMaintenanceConflict";
  }
}

export function maintenanceMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The original snapshot is authority for derived work, including failure/status writes.
 * Never refresh its version after a conflict: doing so would stamp stale work onto a new generation.
 */
export async function patchMaintenanceDocument(args: {
  supabase: SupabaseClient;
  document: MaintenanceDocument;
  patch: Record<string, unknown>;
  imageCount?: number;
}) {
  const { document } = args;
  if (!document.updated_at) throw new IngestionMaintenanceConflict();
  if (Object.prototype.hasOwnProperty.call(args.patch, "index_generation_id")) {
    throw new Error("Maintenance cannot change the committed generation.");
  }
  const metadata = { ...maintenanceMetadata(document.metadata), ...args.patch };
  let query = args.supabase
    .from("documents")
    .update({ metadata: metadata as Json, ...(args.imageCount === undefined ? {} : { image_count: args.imageCount }) })
    .eq("id", document.id)
    .eq("updated_at", document.updated_at);
  query = document.owner_id === null ? query.is("owner_id", null) : query.eq("owner_id", document.owner_id);
  const generation = maintenanceMetadata(document.metadata).index_generation_id;
  query =
    typeof generation === "string"
      ? query.eq("index_generation_id", generation)
      : query.is("index_generation_id", null);
  const { data, error } = await query.select("updated_at,metadata").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.updated_at) throw new IngestionMaintenanceConflict();
  document.updated_at = data.updated_at;
  document.metadata = data.metadata;
  return data;
}

export function assertLegacyMaintenanceSnapshot(document: MaintenanceDocument) {
  if (!document.updated_at) throw new IngestionMaintenanceConflict();
  const metadata = maintenanceMetadata(document.metadata);
  if (
    [
      "admission_event_id",
      "public_source_version_id",
      "source_catalogue_key",
      "public_source_activation_event_id",
    ].some((key) => Object.hasOwn(metadata, key)) ||
    metadata.corpus_scope === "australian_public"
  ) {
    throw new Error(
      "Managed evidence requires its fenced worker reindex; legacy maintenance cannot replace retained provenance.",
    );
  }
}

/** Replacement happens only after all provider/preparation work has succeeded.
 * A single database transaction validates the original snapshot and replaces its public projection.
 */
export async function replaceMaintenanceArtifacts(args: {
  supabase: SupabaseClient;
  document: MaintenanceDocument;
  operation: "labels" | "enrichment" | "visual" | "images" | "stamp" | "embedding-fields" | "registry";
  payload: Record<string, unknown>;
}) {
  assertLegacyMaintenanceSnapshot(args.document);
  const generation = maintenanceMetadata(args.document.metadata).index_generation_id;
  const { data, error } = await args.supabase.rpc("replace_document_maintenance_artifacts", {
    p_document_id: args.document.id,
    p_owner_id: args.document.owner_id,
    p_expected_updated_at: args.document.updated_at,
    p_expected_generation_id: typeof generation === "string" ? generation : null,
    p_operation: args.operation,
    p_payload: args.payload,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || typeof data.updated_at !== "string")
    throw new IngestionMaintenanceConflict();
  args.document.updated_at = data.updated_at;
  args.document.metadata = data.metadata;
  return data as { updated_at: string; metadata: unknown; summary?: unknown };
}

export async function commitMaintenanceDeepMemory(args: {
  supabase: SupabaseClient;
  document: MaintenanceDocument;
  payload: Record<string, unknown>;
}) {
  assertLegacyMaintenanceSnapshot(args.document);
  const generation = maintenanceMetadata(args.document.metadata).index_generation_id;
  const { data, error } = await args.supabase.rpc("commit_document_maintenance_deep_memory", {
    ...args.payload,
    p_document_id: args.document.id,
    p_owner_id: args.document.owner_id,
    p_expected_updated_at: args.document.updated_at,
    p_expected_generation_id: typeof generation === "string" ? generation : null,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || typeof data.updated_at !== "string")
    throw new IngestionMaintenanceConflict();
  args.document.updated_at = data.updated_at;
  args.document.metadata = data.metadata;
  return data;
}
