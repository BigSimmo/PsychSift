import { createHash } from "node:crypto";

export const ingestionRepairReasonCodes = [
  "missing_committed_generation",
  "generation_mismatch",
  "summary_missing",
  "summary_invalid",
  "summary_fallback_growth",
  "lease_abandoned",
] as const;
export type IngestionRepairReasonCode = (typeof ingestionRepairReasonCodes)[number];
export type IngestionRepairDocument = Readonly<{
  documentId: string;
  reasonCodes: readonly IngestionRepairReasonCode[];
  expectedStateDigest: `sha256:${string}`;
}>;
export type IngestionRepairPlan = Readonly<{
  version: "ingestion-repair-plan-v1";
  dryRun: true;
  documents: readonly IngestionRepairDocument[];
  planDigest: `sha256:${string}`;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERSION = "ingestion-repair-plan-v1" as const;
function invalid(): never {
  throw new Error("invalid_ingestion_repair_plan");
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return invalid();
  return row;
}
function canonicalDocuments(value: unknown): IngestionRepairDocument[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return invalid();
  const seen = new Set<string>();
  return value
    .map((entry) => {
      const row = object(entry, ["documentId", "reasonCodes", "expectedStateDigest"]);
      if (typeof row.documentId !== "string" || !UUID.test(row.documentId) || seen.has(row.documentId))
        return invalid();
      seen.add(row.documentId);
      if (
        !Array.isArray(row.reasonCodes) ||
        row.reasonCodes.length < 1 ||
        row.reasonCodes.length > ingestionRepairReasonCodes.length ||
        row.reasonCodes.some((code) => !ingestionRepairReasonCodes.includes(code)) ||
        new Set(row.reasonCodes).size !== row.reasonCodes.length ||
        typeof row.expectedStateDigest !== "string" ||
        !DIGEST.test(row.expectedStateDigest)
      )
        return invalid();
      return Object.freeze({
        documentId: row.documentId,
        reasonCodes: Object.freeze([...row.reasonCodes].sort()) as readonly IngestionRepairReasonCode[],
        expectedStateDigest: row.expectedStateDigest as `sha256:${string}`,
      });
    })
    .sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));
}
/** Fixed UTF-8 encoding shared with record_ingestion_repair_plan; no JSON text equivalence assumption. */
export function ingestionRepairPlanDigestBytes(documents: readonly IngestionRepairDocument[]): string {
  return (
    VERSION +
    "\n" +
    canonicalDocuments(documents)
      .map((row) => `${row.documentId}\t${row.reasonCodes.join(",")}\t${row.expectedStateDigest}\n`)
      .join("")
  );
}
export function createIngestionRepairPlan(documents: unknown): IngestionRepairPlan {
  const canonical = canonicalDocuments(documents);
  const planDigest =
    `sha256:${createHash("sha256").update(ingestionRepairPlanDigestBytes(canonical), "utf8").digest("hex")}` as const;
  return Object.freeze({ version: VERSION, dryRun: true, documents: Object.freeze(canonical), planDigest });
}
export function parseIngestionRepairPlan(value: unknown): IngestionRepairPlan {
  const row = object(value, ["version", "dryRun", "documents", "planDigest"]);
  if (row.version !== VERSION || row.dryRun !== true) return invalid();
  const plan = createIngestionRepairPlan(row.documents);
  if (row.planDigest !== plan.planDigest) return invalid();
  return plan;
}
