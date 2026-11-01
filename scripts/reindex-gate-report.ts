// Offline, advisory comparison only. This command has no provider or mutation adapter.
import { open } from "node:fs/promises";
import { z } from "zod";
import { decideReindexGate } from "../src/lib/reindex-eval-gate";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const retrieval = z.object({
  case_count: z.number(),
  case_fingerprint: z.string().min(1).optional(),
  failed_case_count: z.number(),
  document_recall_at_5: z.number(),
  content_recall_at_5: z.number(),
  top_k_hit_rate: z.number(),
  content_mrr_at_10: z.number(),
  content_mrr_case_count: z.number(),
  mrr_at_10: z.number().optional(),
  p90_latency_ms: z.number().optional(),
});
const quality = z.object({
  case_count: z.number(),
  case_fingerprint: z.string().min(1).optional(),
  grounded_supported_rate: z.number(),
  unsupported_count: z.number(),
  unsupported_correct_rate: z.number(),
  expected_hit_rate: z.number().optional(),
  citation_failure_rate: z.number(),
  numeric_grounding_failure_rate: z.number(),
  source_governance_danger_failure_rate: z.number(),
  expected_danger_warning_missing_count: z.number(),
  stale_review_unknown_rate: z.number(),
  review_required_rate: z.number(),
  p95_latency_ms: z.number(),
});
const input = z
  .object({
    baselineRetrieval: retrieval,
    candidateRetrieval: retrieval,
    baselineQuality: quality,
    candidateQuality: quality,
    chunkingExperiment: z.boolean().optional(),
  })
  .strict();

export function buildReindexGateReport(value: unknown) {
  const parsed = input.safeParse(value);
  if (!parsed.success) throw new Error("Invalid comparison input: four complete evaluation summaries are required.");
  return {
    ...decideReindexGate(parsed.data),
    mode: "offline_advisory" as const,
    activationAuthorized: false as const,
  };
}

export async function runReindexGateReport(argv: string[], stdout = console.log) {
  if (argv.length !== 2 || argv[0] !== "--input" || !argv[1] || argv[1].startsWith("--")) {
    throw new Error("Usage: npm run reindex:gate:offline -- --input <local-summary-bundle.json>");
  }
  const handle = await open(argv[1], "r");
  let value: unknown;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > 65_536)
      throw new Error("Comparison input must be a regular file of at most 64 KiB.");
    // Read at most the bound plus one byte, even if the file grows after stat.
    const buffer = Buffer.alloc(65_537);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65_536) throw new Error("Comparison input exceeds 64 KiB.");
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    } catch {
      throw new Error("Comparison input must be valid UTF-8 JSON.");
    }
  } finally {
    await handle.close();
  }
  const report = buildReindexGateReport(value);
  stdout(JSON.stringify(report, null, 2));
  return report.decision === "GO" ? 0 : 1;
}

if (isDirectEntrypoint(import.meta.url)) {
  runReindexGateReport(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error(
        "Offline comparison failed; check the command and local summary bundle. No activation was attempted.",
      );
      process.exitCode = 1;
    },
  );
}
