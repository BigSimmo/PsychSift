import { readFileSync } from "node:fs";

/**
 * The ingestion pipeline that used to live entirely in worker/main.ts. Its stages were moved
 * into these modules without changing behaviour, so a source-text contract that pinned a
 * string in worker/main.ts must now look across all of them. main.ts comes first, then the
 * stages in pipeline order, so "A appears before B" checks within one stage keep working.
 */
export const workerIngestionSourceFiles = [
  "worker/main.ts",
  "worker/job-attempt-setup.ts",
  "worker/managed-generation-job.ts",
  "worker/image-classification.ts",
  "worker/image-captioning.ts",
  "worker/chunk-indexing.ts",
  "worker/index-quality-payload.ts",
  "worker/inline-enrichment.ts",
  "worker/ingestion-errors.ts",
  "worker/ingestion-sanitize.ts",
  "worker/ingestion-stage-context.ts",
] as const;

export function readWorkerSource(file: (typeof workerIngestionSourceFiles)[number]) {
  return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
}

/** worker/main.ts and every extracted ingestion stage, joined in pipeline order. */
export function readWorkerIngestionSource() {
  return workerIngestionSourceFiles.map((file) => readWorkerSource(file)).join("\n");
}
