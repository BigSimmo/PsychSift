import "server-only";

import { withOwnerReadScope } from "@/lib/public-api-access";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import type { ClinicalSourceReferenceInput } from "@/lib/sources/catalogue-types";
import { strictSourceDate } from "@/lib/sources/source-date-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DOCUMENT_SOURCE_COLUMNS = "id,owner_id,title,file_name,status,metadata,updated_at";

function createDocumentSourceQuery() {
  return createAdminClient().from("documents").select(DOCUMENT_SOURCE_COLUMNS);
}

type DocumentSourceQuery = ReturnType<typeof createDocumentSourceQuery>;

type DocumentSourceRow = {
  id?: unknown;
  title?: unknown;
  file_name?: unknown;
  status?: unknown;
  metadata?: unknown;
};

export type DocumentSourceLoadResult = {
  references: ClinicalSourceReferenceInput[];
  availability: "available" | "unavailable";
};

export type DocumentSourceLoaderDependencies = {
  viewerId(): Promise<string | undefined>;
  query(): DocumentSourceQuery;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function documentRowsToSourceReferences(rows: readonly unknown[]): ClinicalSourceReferenceInput[] {
  const references: ClinicalSourceReferenceInput[] = [];
  for (const input of rows) {
    if (!input || typeof input !== "object") continue;
    const row = input as DocumentSourceRow;
    if (row.status !== "indexed") continue;
    const documentId = cleanString(row.id);
    if (!documentId) continue;
    const metadata = normalizeSourceMetadata(row.metadata);
    if (metadata.source_kind === "registry_record") continue;
    const title =
      metadata.source_title ?? cleanString(row.title) ?? cleanString(row.file_name) ?? "Untitled document source";
    references.push({
      sourceId: null,
      documentId,
      title,
      aliases: [],
      publisher: metadata.publisher,
      publisherCode: metadata.publisher_code ?? null,
      canonicalUrl: null,
      datasetLocation: null,
      version: metadata.version,
      publicationDate: metadata.publication_date,
      reviewDate: metadata.review_date,
      // Date part only: the metadata allows a full ISO timestamp, the catalogue a calendar date.
      expiryDate: strictSourceDate(metadata.expiry_date?.slice(0, 10) ?? null),
      jurisdiction: metadata.jurisdiction,
      evidenceType: "unknown",
      documentStatus: metadata.document_status,
      validationStatus:
        row.metadata &&
        typeof row.metadata === "object" &&
        cleanString((row.metadata as Record<string, unknown>).clinical_validation_status)
          ? metadata.clinical_validation_status
          : "unknown",
      contentMode: "indexed_content",
      lifecycleStatus: "active",
      supersedes: [],
      supersededBy: [],
      topics: [],
      usage: { modeId: "documents", recordId: documentId, recordLabel: title, field: "source metadata" },
      referenceText: null,
    });
  }
  return references;
}

const defaultDocumentSourceLoaderDependencies: DocumentSourceLoaderDependencies = {
  async viewerId() {
    const client = await createSupabaseServerClient();
    if (!client) return undefined;
    const { data, error } = await client.auth.getUser();
    if (error) throw new Error("Document source authentication is unavailable");
    return data.user?.id;
  },
  query: createDocumentSourceQuery,
};

export async function loadVisibleDocumentSourceReferences(
  dependencies: DocumentSourceLoaderDependencies = defaultDocumentSourceLoaderDependencies,
): Promise<DocumentSourceLoadResult> {
  try {
    const viewerId = await dependencies.viewerId();
    const query = withOwnerReadScope(dependencies.query(), viewerId);
    const { data, error } = await query.eq("status", "indexed").order("updated_at", { ascending: false });
    if (error) return { references: [], availability: "unavailable" };
    return { references: documentRowsToSourceReferences(data ?? []), availability: "available" };
  } catch {
    return { references: [], availability: "unavailable" };
  }
}
