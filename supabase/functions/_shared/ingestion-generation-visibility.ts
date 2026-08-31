export type GenerationVisibleRow = Readonly<{
  document_id: string;
  generation_id: string | null;
}>;

export type GenerationVisibility = Readonly<{
  activeGenerationByDocument: ReadonlyMap<string, string>;
  committedGenerationIds: ReadonlySet<string>;
  knownLegacyDocumentIds: ReadonlySet<string>;
}>;

export type DocumentGenerationAuthorityRow = Readonly<{
  id: string;
  index_generation_id: string | null;
  metadata: Record<string, unknown> | null;
}>;

const GENERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVisibleCommittedGenerationRow(row: GenerationVisibleRow, visibility: GenerationVisibility): boolean {
  if (row.generation_id === null)
    return (
      visibility.knownLegacyDocumentIds.has(row.document_id) &&
      !visibility.activeGenerationByDocument.has(row.document_id)
    );
  return (
    visibility.activeGenerationByDocument.get(row.document_id) === row.generation_id &&
    visibility.committedGenerationIds.has(row.generation_id)
  );
}

function validatedGenerationId(value: unknown, source: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim() !== value || !GENERATION_ID_PATTERN.test(value)) {
    throw new Error(`Generation authority is malformed at ${source}`);
  }
  return value;
}

export function buildGenerationVisibility(
  rows: ReadonlyArray<DocumentGenerationAuthorityRow>,
  expectedDocumentIds: ReadonlyArray<string>,
): GenerationVisibility {
  const expected = new Set(expectedDocumentIds);
  if (expected.size !== expectedDocumentIds.length || expected.size === 0) {
    throw new Error("Generation authority input is incomplete");
  }

  const activeGenerationByDocument = new Map<string, string>();
  const knownLegacyDocumentIds = new Set<string>();
  const observed = new Set<string>();

  for (const row of rows) {
    if (!expected.has(row.id)) throw new Error("Generation authority returned an unexpected document");

    const metadata = row.metadata;
    if (metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
      throw new Error(`Generation authority is malformed for document ${row.id}`);
    }
    const hasRawGeneration = metadata !== null && Object.prototype.hasOwnProperty.call(metadata, "index_generation_id");
    const typedGeneration = validatedGenerationId(row.index_generation_id, `${row.id}.index_generation_id`);
    const rawGeneration = validatedGenerationId(
      metadata?.index_generation_id,
      `${row.id}.metadata.index_generation_id`,
    );

    if (observed.has(row.id)) {
      const overlaps =
        (typedGeneration !== null && knownLegacyDocumentIds.has(row.id)) ||
        (typedGeneration === null && activeGenerationByDocument.has(row.id));
      throw new Error(
        overlaps
          ? `Generation authority overlaps legacy and active state for document ${row.id}`
          : `Generation authority is incomplete because document ${row.id} was returned more than once`,
      );
    }
    observed.add(row.id);

    if (typedGeneration === null) {
      if (hasRawGeneration) {
        throw new Error(`Generation authority typed/raw mismatch for document ${row.id}`);
      }
      knownLegacyDocumentIds.add(row.id);
      continue;
    }

    if (!hasRawGeneration || rawGeneration === null) {
      throw new Error(`Generation authority is incomplete for active document ${row.id}`);
    }
    if (rawGeneration !== typedGeneration) {
      throw new Error(`Generation authority typed/raw mismatch for document ${row.id}`);
    }
    activeGenerationByDocument.set(row.id, typedGeneration);
  }

  if (observed.size !== expected.size || Array.from(expected).some((documentId) => !observed.has(documentId))) {
    throw new Error("Generation authority scan is incomplete");
  }
  for (const documentId of knownLegacyDocumentIds) {
    if (activeGenerationByDocument.has(documentId)) {
      throw new Error(`Generation authority overlaps legacy and active state for document ${documentId}`);
    }
  }

  const committedGenerationIds = new Set(activeGenerationByDocument.values());
  if (
    Array.from(activeGenerationByDocument.values()).some((generationId) => !committedGenerationIds.has(generationId))
  ) {
    throw new Error("Generation authority cannot prove the exact active generation set");
  }

  return { activeGenerationByDocument, committedGenerationIds, knownLegacyDocumentIds };
}
