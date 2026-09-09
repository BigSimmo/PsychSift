import { IngestionAttempt, IngestionAttemptError, parseIngestionFence } from "../_shared/ingestion-attempt.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import {
  normalizeText,
  tokenize,
  safeRecord,
  compactString,
  uniqueStrings,
  structuredProfileFromMetadata,
  stringArrayFrom,
  textItemsFrom,
  sourceRegionsFromMetadata,
  sha256Hex,
  sleep,
  canonicalUnitType,
  canonicalFieldType,
  generationMetadata,
  sourceAnchoredSummaryMetadata,
} from "./utils.ts";

import {
  runEdgeIngestionMutation,
  completionGateFromRow,
  agentFailureDecision,
  deferralDecision,
  missingArtifactPlan,
  publicSourceWorkerPolicyViolation,
  runEdgeJobBatch,
  scanProtectedPublicSourceChunkPages,
  shouldRunVisualArtifacts,
  ensureSourceAnchoredSummary,
  type CompletionGate,
  type CompletionGateRow,
  type MissingArtifactPlan,
} from "./behavior.ts";
// prettier-ignore
// @ts-ignore -- Deno requires the extension that the Node TypeScript gate rejects.
import { buildGenerationVisibility, isVisibleCommittedGenerationRow, type DocumentGenerationAuthorityRow, type GenerationVisibility } from "../_shared/ingestion-generation-visibility.ts";
// prettier-ignore
// @ts-ignore -- Deno requires the extension that the Node TypeScript gate rejects.
import { buildIndexingCoverageProfile, selectCoverageAwarePromptChunks } from "../_shared/indexing-coverage.ts";
// prettier-ignore
// @ts-ignore -- Deno requires the extension that the Node TypeScript gate rejects.
import { SOURCE_ANCHORED_MAX_CHUNKS, SOURCE_ANCHORED_MAX_IMAGES, SOURCE_ANCHORED_MAX_PROMPT_IMAGES, SOURCE_ANCHORED_SOURCE_PAGE_SIZE, SOURCE_ANCHORED_STRUCTURED_MODEL_VERSION, projectSourceAnchoredLabels, requireSourceAnchoredSummaryGeneration, type SourceAnchoredSummaryAuthority, type SourceAnchoredSummaryPayload } from "../_shared/source-anchored-summary.ts";

type ClaimedJob = {
  locked_by: string;
  lease_token: string;
  lease_expected_generation_id: string;
  lease_write_generation_id: string;
  lease_authority_digest: string;
  lease_expires_at: string;
  lease_duration_seconds: number;
  id: string;
  document_id: string;
  batch_id: string | null;
  attempt_count: number;
  max_attempts: number;
  documents: {
    id: string;
    owner_id: string | null;
    title: string | null;
    index_generation_id: string | null;
    metadata: Record<string, unknown> | null;
  };
};

type ImageRow = {
  id: string;
  index_generation_id?: string;
  page_number: number | null;
  image_type: string | null;
  searchable: boolean | null;
  caption: string | null;
  metadata: Record<string, unknown> | null;
  width: number | null;
  height: number | null;
  source_kind: string | null;
  clinical_relevance_score: number | null;
  skip_reason: string | null;
};

type VisualUnit = {
  unitType: string;
  title: string;
  content: string;
  qualityScore: number;
  normalizedTerms: string[];
  page: number | null;
  sourceImageId: string;
  metadata: Record<string, unknown>;
};

type SectionIndexSource = {
  section_id: string;
  heading: string;
  heading_path: string[] | null;
  page_start: number | null;
  page_end: number | null;
  chunk_ids: string[] | null;
  summary: string;
  tags: string[] | null;
  extraction_quality: string | null;
  source_chunk_id: string;
  anchor_id: string;
  chunk_index: number;
  chunk_metadata: Record<string, unknown> | null;
};

type SectionLabelSource = {
  section_id: string;
  heading: string;
  heading_path: string[] | null;
  summary: string;
  tags: string[] | null;
  source_chunk_id: string | null;
  anchor_id: string | null;
  chunk_index: number | null;
};

type MemoryCardLabelSource = {
  card_id: string;
  card_type: string;
  title: string;
  content: string;
};

type MemoryCardSectionSource = {
  section_id: string;
  heading: string;
  heading_path: string[] | null;
  page_start: number | null;
  page_end: number | null;
  chunk_ids: string[] | null;
  summary: string;
  tags: string[] | null;
  extraction_quality: string | null;
};

type ChunkSectionSource = {
  id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path: string[] | null;
  content: string;
};

type AgentJobStatus = "pending" | "completed" | "failed" | "needs_enrichment_artifacts";

const GENERATED_BY = "indexing-v3-agent";
const AGENT_SECRET = Deno.env.get("INDEXING_V3_AGENT_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
const EXPECTED_EMBED_DIM = 1536;

const SUPABASE_DB_URL = Deno.env.get("SUPABASE_DB_URL");
if (!SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required");

const sql = postgres(SUPABASE_DB_URL, {
  max: 4,
  idle_timeout: 20,
  connect_timeout: 10,
});
type SqlJsonValue = Parameters<typeof sql.json>[0];
function jsonb(value: unknown) {
  return sql.json(value as SqlJsonValue);
}

type JobGenerationPredicate = Readonly<{
  indexGenerationId: string | null;
  isLegacy: boolean;
}>;

function generationPredicateForJob(job: ClaimedJob, visibility: GenerationVisibility): JobGenerationPredicate {
  const indexGenerationId = visibility.activeGenerationByDocument.get(job.document_id) ?? null;
  const isLegacy = visibility.knownLegacyDocumentIds.has(job.document_id);
  if ((indexGenerationId === null) === !isLegacy) {
    throw new Error(`Generation authority is unknown or overlapping for document ${job.document_id}`);
  }
  return { indexGenerationId, isLegacy };
}

function visibleGenerationRows<Row extends { document_id: string; generation_id: string | null }>(
  rows: ReadonlyArray<Row>,
  visibility: GenerationVisibility,
): Row[] {
  return rows.filter((row) => isVisibleCommittedGenerationRow(row, visibility));
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
const OPENAI_INDEXING_MODEL =
  Deno.env.get("OPENAI_INDEXING_MODEL") ?? Deno.env.get("OPENAI_STRONG_ANSWER_MODEL") ?? "gpt-5.6-sol";
const EMBEDDING_DIMENSIONS = Number(Deno.env.get("EMBEDDING_DIMENSIONS") ?? String(EXPECTED_EMBED_DIM));
if (EMBEDDING_DIMENSIONS !== EXPECTED_EMBED_DIM) {
  throw new Error(`EMBEDDING_DIMENSIONS must be ${EXPECTED_EMBED_DIM}`);
}
const OPENAI_REQUEST_TIMEOUT_MS = Math.max(5_000, Number(Deno.env.get("OPENAI_REQUEST_TIMEOUT_MS") ?? "45000"));
const OPENAI_MAX_RETRIES = Math.max(0, Math.min(5, Number(Deno.env.get("OPENAI_MAX_RETRIES") ?? "2")));
const OPENAI_EMBEDDING_BATCH_SIZE = Math.max(
  1,
  Math.min(64, Number(Deno.env.get("OPENAI_EMBEDDING_BATCH_SIZE") ?? "32")),
);
const INDEXING_V3_MAX_DEFERRALS = Math.max(1, Number(Deno.env.get("INDEXING_V3_MAX_DEFERRALS") ?? "6"));
const INDEXING_V3_RETRY_DELAY_MS = Math.max(30_000, Number(Deno.env.get("INDEXING_V3_RETRY_DELAY_MS") ?? "120000"));

const VISUAL_FIELD_TYPES = ["image_caption", "clinical_action", "threshold_fact"];

const VISUAL_UNIT_TYPES = ["clinical_fact", "workflow_step", "threshold", "medication_monitoring", "askable_question"];

const TYPE_BUDGET: Record<string, number> = {
  clinical_table: 10,
  flowchart_algorithm: 8,
  risk_matrix: 8,
  medication_chart: 8,
  form_checklist: 6,
  graph: 6,
  screenshot_ui: 3,
  photo: 2,
  unclear: 4,
};

// Audit L20: constant-time secret comparison. This function runs with
// verify_jwt=false, so the shared secret is the ONLY auth gate; a plain !==
// short-circuits on the first mismatching character and leaks match length
// via response timing. Hashing both sides to fixed-length digests and
// XOR-comparing removes the content-dependent timing signal.
async function timingSafeSecretEqual(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [candidateDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const candidateBytes = new Uint8Array(candidateDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < candidateBytes.length; index += 1) {
    difference |= candidateBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function authorizeRequest(req: Request): Promise<Response | null> {
  if (!AGENT_SECRET) {
    return Response.json(
      { ok: false, error: "INDEXING_V3_AGENT_SECRET is required when JWT verification is disabled" },
      { status: 500 },
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerSecret = req.headers.get("x-indexing-agent-secret") ?? req.headers.get("x-cron-secret") ?? bearer ?? "";

  if (!(await timingSafeSecretEqual(headerSecret, AGENT_SECRET))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function assertEmbeddingDim(vec: unknown, context: string): asserts vec is number[] {
  if (!Array.isArray(vec)) {
    throw new Error(`${context} embedding must be an array`);
  }
  if (vec.length !== EXPECTED_EMBED_DIM) {
    throw new Error(`${context} embedding has ${vec.length} dimensions; expected ${EXPECTED_EMBED_DIM}`);
  }
  const badIndex = vec.findIndex((value) => typeof value !== "number" || !Number.isFinite(value));
  if (badIndex >= 0) {
    throw new Error(`${context} embedding has a non-finite number at index ${badIndex}`);
  }
}

async function fetchEmbeddingBatch(job: ClaimedJob, texts: string[]): Promise<number[][]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt += 1) {
    edgeAttempt(job).check();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        signal: AbortSignal.any([controller.signal, edgeAttempt(job).signal]),
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`OpenAI embedding request failed (${response.status}): ${body.slice(0, 500)}`);
        if (response.status !== 429 && response.status < 500) {
          // Audit L7: a 4xx client error (bad model name, revoked key) can
          // never succeed on retry — tag it so the catch below fails fast
          // instead of re-sending the identical doomed request.
          (error as Error & { nonRetryable?: boolean }).nonRetryable = true;
          throw error;
        }
        lastError = error;
      } else {
        const payload = (await response.json()) as { data?: Array<{ embedding?: unknown; index?: number }> };
        const rows = payload.data ?? [];
        if (rows.length !== texts.length) {
          throw new Error(`OpenAI embedding response returned ${rows.length} rows for ${texts.length} inputs`);
        }
        edgeAttempt(job).check();
        return rows
          .slice()
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((row, index) => {
            assertEmbeddingDim(row.embedding, `OpenAI response ${index}`);
            return row.embedding;
          });
      }
    } catch (e) {
      edgeAttempt(job).check();
      lastError = e;
      const nonRetryable = e instanceof Error && (e as Error & { nonRetryable?: boolean }).nonRetryable === true;
      if (e instanceof Error && e.name !== "AbortError" && (nonRetryable || attempt >= OPENAI_MAX_RETRIES)) throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < OPENAI_MAX_RETRIES) {
      await sleep(Math.min(5_000, 350 * 2 ** attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI embedding request failed");
}

async function embeddingBatch(job: ClaimedJob, texts: string[]): Promise<number[][]> {
  const normalized = texts.map((text) => normalizeText(text).slice(0, 12_000) || " ");
  const out: number[][] = [];
  for (let start = 0; start < normalized.length; start += OPENAI_EMBEDDING_BATCH_SIZE) {
    out.push(...(await fetchEmbeddingBatch(job, normalized.slice(start, start + OPENAI_EMBEDDING_BATCH_SIZE))));
  }
  return out;
}

function parseStructuredVisual(image: ImageRow): {
  visual_type: string;
  clinical_purpose: string;
  key_terms: string[];
  actions: string[];
  thresholds: string[];
  medications: string[];
  monitoring_items: string[];
  flowchart_nodes: string[];
  flowchart_edges: string[];
  risk_matrix_axes: string[];
  chart_axes: string[];
  table_column_roles: string[];
  source_regions: Array<Record<string, unknown>>;
  confidence: number;
} {
  const metadata = image.metadata ?? {};
  const profile = structuredProfileFromMetadata(metadata);
  const caption = normalizeText(image.caption ?? "");
  const textBlob = normalizeText(`${caption} ${JSON.stringify(image.metadata ?? {})}`);
  const lower = textBlob.toLowerCase();

  const actions = Array.from(
    lower.matchAll(/\b(start|stop|escalat[e]?|administer|monitor|review|refer|cease|repeat)\b/g),
  ).map((m) => m[1]);
  const thresholds = Array.from(lower.matchAll(/\b(\d+(?:\.\d+)?\s?(?:mg|mmol|ml|%|bpm|mmhg|days?|hours?))\b/g)).map(
    (m) => m[1],
  );
  const medications = Array.from(
    lower.matchAll(/\b(olanzapine|clozapine|haloperidol|diazepam|lithium|insulin|heparin|warfarin|digoxin)\b/g),
  ).map((m) => m[1]);

  let visualType = image.image_type ?? "unclear";
  if (lower.includes("flowchart") || lower.includes("decision")) visualType = "flowchart_algorithm";
  if (lower.includes("risk matrix") || lower.includes("likelihood") || lower.includes("consequence"))
    visualType = "risk_matrix";
  if (lower.includes("dose") || lower.includes("route") || lower.includes("frequency")) visualType = "medication_chart";

  const flowchartNodes =
    visualType === "flowchart_algorithm"
      ? Array.from(
          new Set(
            Array.from(textBlob.matchAll(/\b(if|then|else|review|escalate|observe|admit|discharge)\b/gi)).map((m) =>
              m[0].toLowerCase(),
            ),
          ),
        )
      : [];

  const riskAxes =
    visualType === "risk_matrix"
      ? Array.from(
          new Set(
            Array.from(textBlob.matchAll(/\b(likelihood|consequence|severity|impact|probability)\b/gi)).map((m) =>
              m[0].toLowerCase(),
            ),
          ),
        )
      : [];

  const chartAxes =
    visualType === "graph"
      ? Array.from(
          new Set(
            Array.from(textBlob.matchAll(/\b(x-axis|y-axis|time|rate|dose|response)\b/gi)).map((m) =>
              m[0].toLowerCase(),
            ),
          ),
        )
      : [];

  const columnRoles = Array.from(
    new Set(
      Array.from(
        textBlob.matchAll(/\b(parameter|threshold|action|dose|route|frequency|monitoring|risk|notes?)\b/gi),
      ).map((m) => m[0].toLowerCase()),
    ),
  );
  const profileThresholds = textItemsFrom(profile.thresholds);
  const profileRiskCells = textItemsFrom(profile.risk_matrix_cells);
  const profileChartFindings = textItemsFrom(profile.chart_findings);
  const profileNodes = Array.isArray(profile.flowchart_nodes)
    ? profile.flowchart_nodes
        .map((node) => compactString(safeRecord(node).label ?? safeRecord(node).text ?? node, 140))
        .filter(Boolean)
    : [];
  const profileEdges = Array.isArray(profile.flowchart_edges)
    ? profile.flowchart_edges
        .map((edge) => {
          if (typeof edge === "string") return edge;
          const row = safeRecord(edge);
          return [row.from, row.to]
            .map((part) => compactString(part, 80))
            .filter(Boolean)
            .join(" -> ");
        })
        .filter(Boolean)
    : [];
  const profileColumnRoles = Object.entries(safeRecord(profile.table_column_roles))
    .flatMap(([column, role]) => [column, String(role)])
    .map((part) => compactString(part, 80))
    .filter(Boolean);

  const structuredConfidence = Number(profile.confidence ?? metadata.structured_extraction_confidence);
  const confidence = Number.isFinite(structuredConfidence)
    ? Math.max(0.2, Math.min(0.98, structuredConfidence))
    : Math.min(
        0.95,
        0.45 +
          (caption.length > 50 ? 0.15 : 0) +
          (actions.length > 0 ? 0.1 : 0) +
          (thresholds.length > 0 ? 0.1 : 0) +
          (medications.length > 0 ? 0.1 : 0),
      );
  const purpose = compactString(profile.clinical_purpose ?? profile.purpose ?? caption, 220);

  return {
    visual_type: visualType,
    clinical_purpose: purpose || "Visual clinical evidence",
    key_terms: uniqueStrings([...stringArrayFrom(profile.key_terms), ...tokenize(textBlob)], 24),
    actions: uniqueStrings(
      [
        ...stringArrayFrom(profile.actions),
        ...actions,
        ...profileThresholds.filter((item) => /withhold|cease|stop|monitor|review|escalat|continue/i.test(item)),
      ],
      20,
    ),
    thresholds: uniqueStrings([...profileThresholds, ...thresholds], 20),
    medications: uniqueStrings([...stringArrayFrom(profile.medications), ...medications], 20),
    monitoring_items: uniqueStrings(
      [
        ...stringArrayFrom(profile.monitoring_items),
        ...Array.from(textBlob.matchAll(/\b(monitor|observation|vitals?|follow-up|repeat)\b/gi)).map((m) =>
          m[0].toLowerCase(),
        ),
      ],
      20,
    ),
    flowchart_nodes: uniqueStrings([...profileNodes, ...flowchartNodes], 20),
    flowchart_edges: uniqueStrings(
      [
        ...profileEdges,
        ...(flowchartNodes.length > 1 ? flowchartNodes.slice(1).map((n, i) => `${flowchartNodes[i]} -> ${n}`) : []),
      ],
      20,
    ),
    risk_matrix_axes: uniqueStrings(
      [...stringArrayFrom(profile.risk_matrix_axes), ...riskAxes, ...profileRiskCells],
      12,
    ),
    chart_axes: uniqueStrings([...stringArrayFrom(profile.chart_axes), ...chartAxes, ...profileChartFindings], 12),
    table_column_roles: uniqueStrings([...profileColumnRoles, ...columnRoles], 16),
    source_regions: sourceRegionsFromMetadata(metadata),
    confidence,
  };
}

function scoreImage(image: ImageRow): number {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const areaScore = Math.min(1, (width * height) / 1_000_000);
  const searchableScore = image.searchable ? 0.2 : -0.4;
  const baseClinical = image.clinical_relevance_score ?? 0;
  const typeBoost =
    (
      {
        clinical_table: 0.35,
        flowchart_algorithm: 0.4,
        risk_matrix: 0.35,
        medication_chart: 0.4,
        form_checklist: 0.25,
        graph: 0.25,
        screenshot_ui: 0.05,
        photo: 0.02,
        logo_decorative: -0.8,
        unclear: 0.0,
      } as Record<string, number>
    )[image.image_type ?? "unclear"] ?? 0;

  const caption = normalizeText(image.caption ?? "");
  const termBoost = /dose|route|threshold|algorithm|flowchart|risk|monitor|escalat|red zone|action/i.test(caption)
    ? 0.2
    : 0;

  return baseClinical + typeBoost + areaScore * 0.15 + searchableScore + termBoost;
}

function chooseByBudget(images: Array<ImageRow & { priority: number }>): Array<ImageRow & { priority: number }> {
  const byType = new Map<string, Array<ImageRow & { priority: number }>>();
  for (const i of images) {
    const t = i.image_type ?? "unclear";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(i);
  }
  for (const arr of byType.values()) arr.sort((a, b) => b.priority - a.priority);

  const picked: Array<ImageRow & { priority: number }> = [];
  for (const [t, arr] of byType.entries()) {
    const budget = TYPE_BUDGET[t] ?? 3;
    picked.push(...arr.slice(0, budget));
  }

  const unique = new Map<string, ImageRow & { priority: number }>();
  for (const p of picked) unique.set(p.id, p);

  return Array.from(unique.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 40);
}

const jobAttempts = new WeakMap<ClaimedJob, IngestionAttempt>();
function edgeAttempt(job: ClaimedJob) {
  const attempt = jobAttempts.get(job);
  if (!attempt) throw new IngestionAttemptError("ingestion_attempt_required");
  attempt.check();
  return attempt;
}
async function edgeMutation(job: ClaimedJob, name: string, args: Record<string, unknown> = {}) {
  const attempt = edgeAttempt(job);
  return runEdgeIngestionMutation(attempt, async (currentFence) => {
    const fence = jsonb(currentFence);
    let rows: Array<{ result: unknown }>;
    switch (name) {
      case "heartbeat_indexing_v3_agent_job":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.heartbeat_indexing_v3_agent_job(${fence}::jsonb) as result`;
        break;
      case "start_ingestion_job_stage":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.start_ingestion_job_stage(${fence}::jsonb, ${args.p_stage as string | null}::text, ${jsonb(args.p_metadata)}::jsonb) as result`;
        break;
      case "finish_ingestion_job_stage":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.finish_ingestion_job_stage(${fence}::jsonb, ${args.p_stage_id as string | null}::uuid, ${args.p_ok as boolean}::boolean, ${jsonb(args.p_counts)}::jsonb, ${args.p_error as string | null}::text) as result`;
        break;
      case "persist_ingestion_summary_projection":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.persist_ingestion_summary_projection(${fence}::jsonb, ${jsonb(args.p_summary)}::jsonb, ${jsonb(args.p_labels)}::jsonb, ${jsonb(args.p_metadata)}::jsonb) as result`;
        break;
      case "replace_indexing_v3_sections":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.replace_indexing_v3_sections(${fence}::jsonb, ${jsonb(args.p_sections)}::jsonb, ${jsonb(args.p_units)}::jsonb) as result`;
        break;
      case "replace_indexing_v3_memory_cards":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.replace_indexing_v3_memory_cards(${fence}::jsonb, ${jsonb(args.p_cards)}::jsonb) as result`;
        break;
      case "replace_indexing_v3_visual_artifacts":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.replace_indexing_v3_visual_artifacts(${fence}::jsonb, ${jsonb(args.p_images)}::jsonb, ${jsonb(args.p_units)}::jsonb, ${jsonb(args.p_fields)}::jsonb) as result`;
        break;
      case "replace_indexing_v3_core_embeddings":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.replace_indexing_v3_core_embeddings(${fence}::jsonb, ${jsonb(args.p_fields)}::jsonb) as result`;
        break;
      case "persist_ingestion_index_quality":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.persist_ingestion_index_quality(${fence}::jsonb, ${jsonb(args.p_quality)}::jsonb) as result`;
        break;
      case "update_indexing_v3_agent_job_status":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.update_indexing_v3_agent_job_status(${fence}::jsonb, ${args.p_status as string | null}::text, ${args.p_error as string | null}::text, ${args.p_next_run_at as string | null}::timestamptz, ${jsonb(args.p_metadata)}::jsonb) as result`;
        break;
      case "complete_strict_enrichment_job":
        rows = await sql<
          Array<{ result: unknown }>
        >`select public.complete_strict_enrichment_job(${fence}::jsonb, ${args.p_stage as string | null}::text, ${args.p_agent_version as string | null}::text, ${args.p_visual_indexing_version as string | null}::text) as result`;
        break;
      default:
        throw new IngestionAttemptError("ingestion_rpc_invalid");
    }
    return rows[0]?.result;
  });
}
async function stageStart(job: ClaimedJob, stageName: string, metadata: Record<string, unknown> = {}): Promise<string> {
  const result = await edgeMutation(job, "start_ingestion_job_stage", { p_stage: stageName, p_metadata: metadata });
  if (typeof result.stage_id !== "string") throw new IngestionAttemptError("ingestion_rpc_invalid");
  return result.stage_id;
}
async function stageFinish(
  job: ClaimedJob,
  stageId: string,
  ok: boolean,
  artifactCounts: Record<string, unknown> = {},
  errorMessage?: string,
): Promise<void> {
  await edgeMutation(job, "finish_ingestion_job_stage", {
    p_stage_id: stageId,
    p_ok: ok,
    p_counts: artifactCounts,
    p_error: errorMessage ?? null,
  });
}

type SummarySourceChunk = {
  id: string;
  document_id: string;
  index_generation_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  content: string;
};

type SummarySourceImage = {
  id: string;
  document_id: string;
  index_generation_id: string;
  page_number: number | null;
  caption: string | null;
  clinical_relevance_score: number | null;
};

type SourceAnchoredSummarySources = {
  chunks: SummarySourceChunk[];
  images: SummarySourceImage[];
  authority: SourceAnchoredSummaryAuthority;
  coverage: ReturnType<typeof buildIndexingCoverageProfile>;
};

function requireSourceAnchoredSummaryGenerationForJob(job: ClaimedJob) {
  const generation = requireSourceAnchoredSummaryGeneration(job.documents.index_generation_id);
  if (safeRecord(job.documents.metadata).index_generation_id !== generation) {
    throw new Error("source_anchored_summary_requires_active_generation");
  }
  return generation;
}

async function loadSourceAnchoredSummarySources(
  job: ClaimedJob,
  indexGenerationId: string,
): Promise<SourceAnchoredSummarySources> {
  const chunks: SummarySourceChunk[] = [];
  const images: SummarySourceImage[] = [];
  for (let offset = 0; ; offset += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    const page = await sql<SummarySourceChunk[]>`
      select chunk.id, chunk.document_id, chunk.index_generation_id::text as index_generation_id,
        chunk.page_number, chunk.chunk_index, chunk.section_heading, chunk.content
      from public.document_chunks chunk
      where chunk.document_id = ${job.document_id}::uuid
        and chunk.index_generation_id = ${indexGenerationId}::uuid
      order by chunk.chunk_index asc, chunk.id asc
      limit ${SOURCE_ANCHORED_SOURCE_PAGE_SIZE}
      offset ${offset}
    `;
    chunks.push(...page);
    if (chunks.length > SOURCE_ANCHORED_MAX_CHUNKS) {
      throw new Error("source_anchored_summary_source_limit_exceeded");
    }
    if (page.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }
  for (let offset = 0; ; offset += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    const page = await sql<SummarySourceImage[]>`
      select image.id, image.document_id, image.index_generation_id::text as index_generation_id,
        image.page_number, image.caption, image.clinical_relevance_score
      from public.document_images image
      where image.document_id = ${job.document_id}::uuid
        and image.index_generation_id = ${indexGenerationId}::uuid
        and image.searchable is true
      order by image.clinical_relevance_score desc nulls last, image.page_number asc nulls last, image.id asc
      limit ${SOURCE_ANCHORED_SOURCE_PAGE_SIZE}
      offset ${offset}
    `;
    images.push(...page);
    if (images.length > SOURCE_ANCHORED_MAX_IMAGES) {
      throw new Error("source_anchored_summary_source_limit_exceeded");
    }
    if (page.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }
  if (chunks.length + images.length === 0) throw new Error("source_anchored_summary_source_missing");
  if ([...chunks, ...images].some((row) => row.index_generation_id !== indexGenerationId)) {
    throw new Error("source_anchored_summary_source_generation_mismatch");
  }
  const selected = selectCoverageAwarePromptChunks(chunks);
  const promptImages = images.slice(0, SOURCE_ANCHORED_MAX_PROMPT_IMAGES);
  return {
    chunks,
    images,
    authority: {
      documentId: job.document_id,
      indexGenerationId,
      expectedStructuredModel: OPENAI_INDEXING_MODEL,
      expectedStructuredModelVersion: SOURCE_ANCHORED_STRUCTURED_MODEL_VERSION,
      selectedChunks: selected.chunks,
      selectedImages: promptImages,
    },
    coverage: buildIndexingCoverageProfile({ chunks, images }),
  };
}

async function persistSourceAnchoredSummary(
  job: ClaimedJob,
  payload: SourceAnchoredSummaryPayload,
  _writePayload: boolean,
) {
  return edgeMutation(job, "persist_ingestion_summary_projection", {
    p_summary: {
      document_id: job.document_id,
      summary: payload.summary,
      clinical_specifics: payload.clinical_specifics,
      source_chunk_ids: payload.source_chunk_ids,
      source_image_ids: payload.source_image_ids,
      model: payload.model,
      generated_at: payload.generated_at,
      metadata: {
        generated_by: GENERATED_BY,
        ...sourceAnchoredSummaryMetadata(payload, payload.summary_kind === "structured"),
      },
    },
    p_labels: projectSourceAnchoredLabels(payload).map((label) => ({
      document_id: job.document_id,
      source: "generated",
      label: label.label,
      label_type: label.label_type,
      confidence: label.confidence,
      metadata: {
        generated_by: GENERATED_BY,
        index_generation_id: payload.index_generation_id,
        summary_version: payload.summary_version,
        source_chunk_ids: label.source_chunk_ids,
        source_image_ids: label.source_image_ids,
        pages: label.pages,
      },
    })),
    p_metadata: {},
  });
}

async function ensureSummary(
  job: ClaimedJob,
  sources: SourceAnchoredSummarySources,
): Promise<SourceAnchoredSummaryPayload> {
  const existing = await sql<
    Array<{
      summary: string | null;
      clinical_specifics: Record<string, unknown> | null;
      source_chunk_ids: string[] | null;
      source_image_ids: string[] | null;
      metadata: Record<string, unknown> | null;
      model: string | null;
      generated_at: string | null;
    }>
  >`
    select summary, clinical_specifics, source_chunk_ids, source_image_ids, model, metadata, generated_at
    from public.document_summaries
    where document_id = ${job.document_id}::uuid
    limit 1
  `;
  const labels = await sql<
    Array<{ label: string; label_type: string; confidence: number; metadata: Record<string, unknown> | null }>
  >`
    select label, label_type, confidence, metadata
    from public.document_labels
    where document_id = ${job.document_id}::uuid and source = 'generated'
    order by label_type asc, label asc
  `;
  const attempt = edgeAttempt(job);
  try {
    return await ensureSourceAnchoredSummary({
      existing: existing[0],
      labels,
      authority: sources.authority,
      persist: (payload) => persistSourceAnchoredSummary(job, payload, true),
    });
  } catch (error) {
    attempt.cancel();
    throw error;
  }
}

function unitsFromStructured(image: ImageRow, structured: ReturnType<typeof parseStructuredVisual>): VisualUnit[] {
  const units: VisualUnit[] = [];
  const page = image.page_number ?? null;
  const imageId = image.id;

  const summaryText = normalizeText(
    `${structured.clinical_purpose}. Key terms: ${structured.key_terms.slice(0, 12).join(", ")}`,
  );
  if (summaryText.length > 12) {
    units.push({
      unitType: "visual_summary",
      title: `Visual summary p${page ?? "?"} (${structured.visual_type})`,
      content: summaryText,
      qualityScore: structured.confidence,
      normalizedTerms: structured.key_terms,
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  for (const a of structured.actions.slice(0, 8)) {
    units.push({
      unitType: structured.visual_type === "flowchart_algorithm" ? "flowchart_step" : "chart_finding",
      title: `Action from visual p${page ?? "?"}`,
      content: `Action: ${a}`,
      qualityScore: Math.max(0.5, structured.confidence - 0.05),
      normalizedTerms: tokenize(a),
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  for (const t of structured.thresholds.slice(0, 8)) {
    units.push({
      unitType: "table_threshold",
      title: `Threshold from visual p${page ?? "?"}`,
      content: `Threshold: ${t}`,
      qualityScore: Math.max(0.5, structured.confidence - 0.05),
      normalizedTerms: tokenize(t),
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  for (const m of structured.medications.slice(0, 8)) {
    units.push({
      unitType: "medication_chart_row",
      title: `Medication from visual p${page ?? "?"}`,
      content: `Medication reference: ${m}`,
      qualityScore: Math.max(0.5, structured.confidence - 0.03),
      normalizedTerms: tokenize(m),
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  for (const n of structured.flowchart_nodes.slice(0, 8)) {
    units.push({
      unitType: "diagram_decision",
      title: `Flowchart node p${page ?? "?"}`,
      content: `Node: ${n}`,
      qualityScore: Math.max(0.5, structured.confidence - 0.06),
      normalizedTerms: tokenize(n),
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  for (const ax of structured.risk_matrix_axes.slice(0, 8)) {
    units.push({
      unitType: "risk_matrix_cell",
      title: `Risk matrix axis p${page ?? "?"}`,
      content: `Risk axis dimension: ${ax}`,
      qualityScore: Math.max(0.5, structured.confidence - 0.08),
      normalizedTerms: tokenize(ax),
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  if (structured.key_terms.length > 0) {
    units.push({
      unitType: "visual_askable_question",
      title: `Askable visual question p${page ?? "?"}`,
      content: `What actions, thresholds, or medication details are shown in this ${structured.visual_type} visual?`,
      qualityScore: Math.max(0.45, structured.confidence - 0.1),
      normalizedTerms: structured.key_terms,
      page,
      sourceImageId: imageId,
      metadata: { visual_type: structured.visual_type, source_regions: structured.source_regions },
    });
  }

  return units;
}

function memoryCardText(title: string, cardType: string, content: string, terms: string[]): string {
  return `${title}\n${cardType}\n${content}\nTerms: ${terms.join(", ")}`;
}

async function ensureSectionsFromChunks(job: ClaimedJob, visibility: GenerationVisibility): Promise<number> {
  const artifactRows: Record<string, Array<Record<string, unknown>>> = { document_sections: [] };
  const generationPredicate = generationPredicateForJob(job, visibility);
  const existing = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.document_sections
    where document_id = ${job.document_id}::uuid
      and (
        index_generation_id = ${generationPredicate.indexGenerationId}::uuid
        or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
      )
  `;
  if ((existing[0]?.count ?? 0) > 0) return 0;

  const chunkRows = await sql<Array<ChunkSectionSource & { document_id: string; generation_id: string | null }>>`
    select id, document_id, index_generation_id::text as generation_id,
      page_number, chunk_index, section_heading, section_path, content
    from public.document_chunks
    where document_id = ${job.document_id}::uuid
      and (
        index_generation_id = ${generationPredicate.indexGenerationId}::uuid
        or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
      )
    order by chunk_index asc
    limit 24
  `;
  const chunks = visibleGenerationRows(chunkRows, visibility);
  if (chunks.length === 0) return 0;

  let inserted = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const path = (chunk.section_path ?? []).filter(Boolean);
    const heading =
      normalizeText(
        chunk.section_heading ?? path[path.length - 1] ?? job.documents.title ?? `Section ${index + 1}`,
      ).slice(0, 220) || `Section ${index + 1}`;
    const summary = normalizeText(chunk.content).slice(0, 1400) || heading;
    const tags = uniqueStrings(tokenize(`${heading} ${summary}`).slice(0, 8), 8);

    const rows = [
      {
        id: crypto.randomUUID(),
        document_id: job.document_id,
        owner_id: job.documents.owner_id,
        section_index: index,
        heading: heading,
        heading_path: path.length > 0 ? path : [heading],
        page_start: chunk.page_number,
        page_end: chunk.page_number,
        chunk_ids: [chunk.id],
        summary: summary,
        tags: tags,
        extraction_quality: "partial",
        index_generation_id: generationPredicate.indexGenerationId,
        metadata: {
          generated_by: GENERATED_BY,
          ...generationMetadata(generationPredicate.indexGenerationId),
          source: "document_chunks",
          source_chunk_id: chunk.id,
          repaired_missing_sections: true,
        },
      },
    ];
    artifactRows.document_sections.push(...rows);
    inserted += rows.length;
  }

  await edgeMutation(job, "replace_indexing_v3_sections", {
    p_sections: artifactRows.document_sections,
    p_units: null,
  });

  return inserted;
}

async function upsertMemoryCardsFromSections(job: ClaimedJob, visibility: GenerationVisibility): Promise<number> {
  const artifactRows: Record<string, Array<Record<string, unknown>>> = { document_memory_cards: [] };
  const generationPredicate = generationPredicateForJob(job, visibility);
  const sectionRows = await sql<Array<MemoryCardSectionSource & { document_id: string; generation_id: string | null }>>`
    select
      id as section_id,
      document_id,
      index_generation_id::text as generation_id,
      heading,
      heading_path,
      page_start,
      page_end,
      chunk_ids,
      summary,
      tags,
      extraction_quality
    from public.document_sections
    where document_id = ${job.document_id}::uuid
      and (
        index_generation_id = ${generationPredicate.indexGenerationId}::uuid
        or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
      )
      and btrim(coalesce(summary, '')) <> ''
    order by section_index asc
    limit 16
  `;
  const sections = visibleGenerationRows(sectionRows, visibility);

  if (sections.length === 0) return 0;

  const prepared = sections
    .map((section) => {
      const heading = normalizeText(section.heading) || "Document section";
      const path = (section.heading_path ?? []).filter(Boolean).join(" > ");
      const title = path ? `${path} > ${heading}` : heading;
      const summary = normalizeText(section.summary);
      const content = `${heading}: ${summary}`;
      const terms = uniqueStrings(
        [...tokenize(`${title} ${summary}`), ...(section.tags ?? []).map((tag) => normalizeText(tag.toLowerCase()))],
        24,
      );
      return {
        section,
        title: title.slice(0, 240),
        content,
        terms,
        embeddingText: memoryCardText(title, "section_summary", content, terms),
      };
    })
    .filter((card) => card.content.length >= 12);

  if (prepared.length === 0) return 0;

  const embeddings = await embeddingBatch(
    job,
    prepared.map((card) => card.embeddingText),
  );
  embeddings.forEach((embedding, index) =>
    assertEmbeddingDim(embedding, `memory card ${prepared[index].section.section_id}`),
  );
  let inserted = 0;
  {
    for (let index = 0; index < prepared.length; index += 1) {
      const card = prepared[index];
      const section = card.section;
      const chunkIds = section.chunk_ids ?? [];
      const emb = embeddings[index];

      artifactRows.document_memory_cards.push({
        document_id: job.document_id,
        owner_id: job.documents.owner_id,
        section_id: section.section_id,
        card_type: "section_summary",
        title: card.title,
        content: card.content,
        normalized_terms: card.terms,
        page_number: section.page_start,
        source_chunk_ids: chunkIds,
        source_image_ids: [],
        confidence:
          section.extraction_quality === "good" ? 0.72 : section.extraction_quality === "partial" ? 0.62 : 0.54,
        index_generation_id: generationPredicate.indexGenerationId,
        metadata: {
          generated_by: GENERATED_BY,
          ...generationMetadata(generationPredicate.indexGenerationId),
          source: "document_sections",
          section_id: section.section_id,
          heading_path: section.heading_path ?? [],
          page_start: section.page_start,
          page_end: section.page_end,
        },
        embedding: emb,
      });
      inserted += 1;
    }
  }

  await edgeMutation(job, "replace_indexing_v3_memory_cards", { p_cards: artifactRows.document_memory_cards });

  return inserted;
}

async function upsertSectionIndexUnits(job: ClaimedJob, visibility: GenerationVisibility): Promise<number> {
  const artifactRows: Record<string, Array<Record<string, unknown>>> = { document_index_units: [] };
  const generationPredicate = generationPredicateForJob(job, visibility);
  const sectionRows = await sql<Array<SectionIndexSource & { document_id: string; generation_id: string | null }>>`
    select
      s.id as section_id,
      s.document_id,
      s.index_generation_id::text as generation_id,
      s.heading,
      s.heading_path,
      s.page_start,
      s.page_end,
      s.chunk_ids,
      s.summary,
      s.tags,
      s.extraction_quality,
      c.id as source_chunk_id,
      c.anchor_id,
      c.chunk_index,
      c.metadata as chunk_metadata
    from public.document_sections s
    join lateral (
      select id, anchor_id, chunk_index, metadata
      from public.document_chunks c
      where c.document_id = s.document_id
        and (
          c.index_generation_id = ${generationPredicate.indexGenerationId}::uuid
          or (${generationPredicate.isLegacy}::boolean and c.index_generation_id is null)
        )
        and c.anchor_id is not null
        and (
          c.id = any(s.chunk_ids)
          or c.section_heading = s.heading
        )
      order by
        case when c.id = any(s.chunk_ids) then 0 else 1 end,
        c.chunk_index asc
      limit 1
    ) c on true
    where s.document_id = ${job.document_id}::uuid
      and (
        s.index_generation_id = ${generationPredicate.indexGenerationId}::uuid
        or (${generationPredicate.isLegacy}::boolean and s.index_generation_id is null)
      )
      and btrim(coalesce(s.summary, '')) <> ''
    order by s.section_index asc
  `;
  const sections = visibleGenerationRows(sectionRows, visibility);

  const preparedSections = sections
    .map((section) => {
      const content = normalizeText(section.summary);
      const title = normalizeText(section.heading);
      if (!content || !title) return null;
      return {
        section,
        title,
        content,
        embeddingText: `Type: section_summary\nTitle: ${title}\nPath: ${(section.heading_path ?? []).join(" > ")}\nContent: ${content}`,
      };
    })
    .filter(
      (
        row,
      ): row is {
        section: SectionIndexSource & { document_id: string; generation_id: string | null };
        title: string;
        content: string;
        embeddingText: string;
      } => Boolean(row),
    );

  const embeddings = await embeddingBatch(
    job,
    preparedSections.map((section) => section.embeddingText),
  );
  embeddings.forEach((embedding, index) =>
    assertEmbeddingDim(embedding, `section index unit ${preparedSections[index].section.section_id}`),
  );
  let inserted = 0;
  {
    for (let index = 0; index < preparedSections.length; index += 1) {
      const { section, title, content } = preparedSections[index];
      const emb = embeddings[index];

      artifactRows.document_index_units.push({
        owner_id: job.documents.owner_id,
        document_id: job.document_id,
        unit_type: "section_summary",
        source_chunk_id: section.source_chunk_id,
        source_image_id: null,
        page_start: section.page_start,
        page_end: section.page_end,
        heading_path: section.heading_path ?? [],
        title: title,
        content: content,
        normalized_terms: tokenize(`${title} ${content} ${(section.tags ?? []).join(" ")}`),
        source_span: { anchor_id: section.anchor_id, chunk_index: section.chunk_index },
        quality_score:
          section.extraction_quality === "good" ? 0.78 : section.extraction_quality === "partial" ? 0.58 : 0.42,
        extraction_mode: "hybrid",
        index_generation_id: generationPredicate.indexGenerationId,
        embedding: emb,
        metadata: {
          generated_by: GENERATED_BY,
          ...generationMetadata(generationPredicate.indexGenerationId),
          source: "document_sections",
          section_id: section.section_id,
          chunk_ids: section.chunk_ids ?? [],
          anchor_id: section.anchor_id,
        },
      });
      inserted += 1;
    }
  }

  await edgeMutation(job, "replace_indexing_v3_sections", {
    p_sections: null,
    p_units: artifactRows.document_index_units,
  });

  return inserted;
}

async function upsertVisualArtifacts(
  job: ClaimedJob,
  visibility: GenerationVisibility,
): Promise<{ selected_images: number; created_units: number; created_fields: number }> {
  const artifactRows: Record<string, Array<Record<string, unknown>>> = {
    document_images: [],
    document_index_units: [],
    document_embedding_fields: [],
  };
  const generationPredicate = generationPredicateForJob(job, visibility);
  const imageRows = await sql<Array<ImageRow & { document_id: string; generation_id: string | null }>>`
    select
      document_id, index_generation_id::text as generation_id,
      id, page_number, image_type, searchable, caption, metadata,
      width, height, source_kind, clinical_relevance_score, skip_reason
    from public.document_images
    where document_id = ${job.document_id}::uuid
      and (
        index_generation_id = ${generationPredicate.indexGenerationId}::uuid
        or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
      )
      and coalesce(searchable, false) = true
      and coalesce(image_type, 'unclear') <> 'logo_decorative'
    order by page_number asc nulls last, created_at asc
  `;
  const images = visibleGenerationRows(imageRows, visibility);

  const scored = images.map((img) => ({ ...img, priority: scoreImage(img) })).filter((img) => img.priority > -0.2);

  const selected = chooseByBudget(scored);

  let createdUnits = 0;
  let createdFields = 0;
  const preparedUnits: Array<{
    unit: VisualUnit;
    content: string;
    unitType: string;
    fieldType: string;
    contentHash: string;
  }> = [];

  for (const img of selected) {
    const structured = parseStructuredVisual(img);
    const units = unitsFromStructured(img, structured);

    artifactRows.document_images.push({
      id: img.id,
      metadata: {
        v3_structured_visual: structured,
        v3_visual_metrics: {
          clinical_priority_score: img.priority,
          caption_confidence: Math.max(0.35, Math.min(0.98, structured.confidence - 0.05)),
          structured_extraction_confidence: structured.confidence,
          ocr_text_density: Math.max(0, Math.min(1, structured.key_terms.length / 40)),
          image_quality_score: Math.max(0, Math.min(1, 0.35 + img.priority * 0.3)),
          crop_completeness: Math.max(
            0.3,
            Math.min(1, img.width && img.height && img.width * img.height > 150000 ? 0.9 : 0.55),
          ),
        },
      },
    });

    for (const unit of units) {
      const content = normalizeText(unit.content);
      if (content.length < 4) continue;

      const unitType = canonicalUnitType(unit.unitType);
      const fieldType = canonicalFieldType(unit.unitType);
      const contentHash = await sha256Hex(content);
      preparedUnits.push({ unit, content, unitType, fieldType, contentHash });
    }
  }

  const embeddings = await embeddingBatch(
    job,
    preparedUnits.map((prepared) => prepared.content),
  );
  embeddings.forEach((embedding, index) =>
    assertEmbeddingDim(embedding, `visual index unit ${preparedUnits[index].unit.sourceImageId}`),
  );
  {
    for (let index = 0; index < preparedUnits.length; index += 1) {
      const { unit, content, unitType, fieldType, contentHash } = preparedUnits[index];
      const emb = embeddings[index];

      artifactRows.document_index_units.push({
        owner_id: job.documents.owner_id,
        document_id: job.document_id,
        unit_type: unitType,
        source_chunk_id: null,
        source_image_id: unit.sourceImageId,
        page_start: unit.page,
        page_end: unit.page,
        heading_path: [],
        title: unit.title,
        content: content,
        normalized_terms: unit.normalizedTerms,
        source_span: { source_image_id: unit.sourceImageId, source_regions: unit.metadata.source_regions ?? [] },
        quality_score: unit.qualityScore,
        extraction_mode: "hybrid",
        index_generation_id: generationPredicate.indexGenerationId,
        embedding: emb,
        metadata: {
          ...unit.metadata,
          visual_unit_type: unit.unitType,
          generated_by: GENERATED_BY,
          ...generationMetadata(generationPredicate.indexGenerationId),
        },
      });
      createdUnits += 1;

      artifactRows.document_embedding_fields.push({
        owner_id: job.documents.owner_id,
        document_id: job.document_id,
        source_chunk_id: null,
        field_type: fieldType,
        content: content,
        index_generation_id: generationPredicate.indexGenerationId,
        embedding: emb,
        metadata: {
          source_image_id: unit.sourceImageId,
          visual_field_type: unit.unitType,
          generated_by: GENERATED_BY,
          ...generationMetadata(generationPredicate.indexGenerationId),
        },
        content_hash: contentHash,
      });
      createdFields += 1;
    }
  }

  await edgeMutation(job, "replace_indexing_v3_visual_artifacts", {
    p_images: artifactRows.document_images,
    p_units: artifactRows.document_index_units,
    p_fields: artifactRows.document_embedding_fields,
  });

  return { selected_images: selected.length, created_units: createdUnits, created_fields: createdFields };
}

async function upsertCoreEmbeddingFields(
  job: ClaimedJob,
  summary: string,
  visibility: GenerationVisibility,
): Promise<number> {
  const artifactRows: Record<string, Array<Record<string, unknown>>> = { document_embedding_fields: [] };
  const generationPredicate = generationPredicateForJob(job, visibility);
  const title = normalizeText(job.documents.title ?? "") || "Untitled document";
  const base = [
    { field_type: "document_title", content: title },
    { field_type: "document_summary", content: normalizeText(summary) || "Summary unavailable" },
  ];

  const embeddings = await embeddingBatch(
    job,
    base.map((row) => row.content),
  );
  embeddings.forEach((embedding, index) => assertEmbeddingDim(embedding, `${base[index].field_type} embedding field`));
  let inserted = 0;
  const preparedRows = await Promise.all(
    base.map(async (row, index) => ({ row, emb: embeddings[index], contentHash: await sha256Hex(row.content) })),
  );
  {
    for (const { row, emb, contentHash } of preparedRows) {
      artifactRows.document_embedding_fields.push({
        owner_id: job.documents.owner_id,
        document_id: job.document_id,
        source_chunk_id: null,
        field_type: row.field_type,
        content: row.content,
        index_generation_id: generationPredicate.indexGenerationId,
        embedding: emb,
        metadata: { generated_by: GENERATED_BY, ...generationMetadata(generationPredicate.indexGenerationId) },
        content_hash: contentHash,
      });
      inserted += 1;
    }
  }

  await edgeMutation(job, "replace_indexing_v3_core_embeddings", { p_fields: artifactRows.document_embedding_fields });

  return inserted;
}

async function updateQuality(job: ClaimedJob, visibility: GenerationVisibility): Promise<void> {
  const artifactRows: Record<string, Array<Record<string, unknown>>> = { document_index_quality: [] };
  const generationPredicate = generationPredicateForJob(job, visibility);
  const counts = await sql<
    {
      visual_units: number;
      anchors_with_image: number;
      total_units: number;
      visual_images: number;
    }[]
  >`
    with unit_counts as (
      select
        count(*) filter (where metadata->>'generated_by' = ${GENERATED_BY})::int as visual_units,
        count(*) filter (where source_image_id is not null)::int as anchors_with_image,
        count(*)::int as total_units
      from public.document_index_units
      where document_id = ${job.document_id}::uuid
        and (
          index_generation_id = ${generationPredicate.indexGenerationId}::uuid
          or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
        )
    ),
    image_counts as (
      select count(*)::int as visual_images
      from public.document_images
      where document_id = ${job.document_id}::uuid
        and (
          index_generation_id = ${generationPredicate.indexGenerationId}::uuid
          or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
        )
        and coalesce(searchable,false)=true
        and coalesce(image_type,'unclear') <> 'logo_decorative'
    )
    select
      u.visual_units,
      u.anchors_with_image,
      u.total_units,
      i.visual_images
    from unit_counts u, image_counts i
  `;

  const c = counts[0] ?? { visual_units: 0, anchors_with_image: 0, total_units: 0, visual_images: 0 };
  const typedCoverage = c.total_units > 0 ? c.visual_units / c.total_units : 0;
  const anchorCoverage = c.total_units > 0 ? c.anchors_with_image / c.total_units : 0;
  const retrievableVisualHit = c.visual_units > 0 && c.visual_images > 0;
  const issues = c.visual_images > 0 && !retrievableVisualHit ? ["no retrievable visual evidence"] : [];

  artifactRows.document_index_quality.push({
    document_id: job.document_id,
    owner_id: job.documents.owner_id,
    quality_score: Math.max(0, Math.min(1, 0.55 + typedCoverage * 0.25 + anchorCoverage * 0.2)),
    extraction_quality: "partial",
    metrics: {
      indexing_v3_agent: {
        visual_units: c.visual_units,
        total_units: c.total_units,
        visual_images: c.visual_images,
        retrievable_visual_hit: retrievableVisualHit,
        typed_unit_coverage: typedCoverage,
        anchor_coverage: anchorCoverage,
        source_span_coverage: anchorCoverage,
        model_fallback_rate: 0,
        noisy_unit_rate: Math.max(0, 1 - typedCoverage),
      },
    },
    issues: issues,
    updated_at: new Date().toISOString(),
  });
  await edgeMutation(job, "persist_ingestion_index_quality", { p_quality: artifactRows.document_index_quality[0] });
}

async function completionGate(job: ClaimedJob): Promise<CompletionGate> {
  const rows = await sql<CompletionGateRow[]>`
    select
      sections,
      memory_cards,
      generated_labels,
      index_units,
      title_embedding,
      summary_embedding,
      quality_extraction_quality,
      quality_score,
      missing,
      gate_passed
    from public.document_strict_gate_status
    where document_id = ${job.document_id}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error(`Strict gate status not found for document ${job.document_id}`);

  return completionGateFromRow(row);
}

function logArtifactPlan(job: ClaimedJob, gate: CompletionGate, plan: MissingArtifactPlan): void {
  console.log(
    JSON.stringify({
      event: "artifact_plan",
      worker: GENERATED_BY,
      job_id: job.id,
      document_id: job.document_id,
      missing: gate.missing,
      counts: gate.counts,
      presence: gate.presence,
      quality: gate.quality,
      plan,
    }),
  );
}

async function needsVisualArtifacts(job: ClaimedJob, visibility: GenerationVisibility): Promise<boolean> {
  const generationPredicate = generationPredicateForJob(job, visibility);
  const rows = await sql<Array<{ eligible_images: number; generated_visual_units: number }>>`
    select
      (
        select count(*)::int
        from public.document_images
        where document_id = ${job.document_id}::uuid
          and (
            index_generation_id = ${generationPredicate.indexGenerationId}::uuid
            or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
          )
          and coalesce(searchable, false) = true
          and coalesce(image_type, 'unclear') <> 'logo_decorative'
      ) as eligible_images,
      (
        select count(*)::int
        from public.document_index_units
        where document_id = ${job.document_id}::uuid
          and (
            index_generation_id = ${generationPredicate.indexGenerationId}::uuid
            or (${generationPredicate.isLegacy}::boolean and index_generation_id is null)
          )
          and source_image_id is not null
          and (
            metadata->>'generated_by' = ${GENERATED_BY}
            or metadata->>'generated_by' = 'local-worker'
            or metadata->>'source' = 'visual_intelligence'
          )
      ) as generated_visual_units
  `;
  const row = rows[0] ?? { eligible_images: 0, generated_visual_units: 0 };
  return shouldRunVisualArtifacts(row);
}

async function updateAgentJobStatus(
  job: ClaimedJob,
  status: AgentJobStatus,
  error: string | null = null,
  nextRunAt: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await edgeMutation(job, "update_indexing_v3_agent_job_status", {
    p_status: status === "pending" ? "deferred" : status,
    p_error: error,
    p_next_run_at: nextRunAt,
    p_metadata: metadata,
  });
}

function logCompletionGate(job: ClaimedJob, gate: CompletionGate): void {
  console.log(
    JSON.stringify({
      event: "completion_gate",
      worker: GENERATED_BY,
      job_id: job.id,
      document_id: job.document_id,
      counts: gate.counts,
      presence: gate.presence,
      quality: gate.quality,
      result: gate.result,
      missing: gate.missing,
    }),
  );
}

async function deferJob(job: ClaimedJob, gate: CompletionGate): Promise<void> {
  const decision = deferralDecision({
    metadata: job.documents.metadata,
    gate,
    maxDeferrals: INDEXING_V3_MAX_DEFERRALS,
    nowMs: Date.now(),
  });

  await updateAgentJobStatus(
    job,
    decision.status === "needs_enrichment_artifacts" ? "needs_enrichment_artifacts" : "pending",
    null,
    decision.next_run_at,
    {
      indexing_v3_agent_deferral_count: decision.deferral_count,
      completion_gate: decision.details,
      completion_gate_missing: gate.missing,
    },
  );
}

async function completeJob(job: ClaimedJob): Promise<void> {
  await edgeMutation(job, "complete_strict_enrichment_job", {
    p_stage: "indexed; enrichment completed",
    p_agent_version: "visual-core-v3",
    p_visual_indexing_version: "visual-v3",
  });
}

async function markJobFailure(job: ClaimedJob, message: string): Promise<boolean> {
  const decision = agentFailureDecision({
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    nowMs: Date.now(),
    retryDelayMs: INDEXING_V3_RETRY_DELAY_MS,
  });
  await updateAgentJobStatus(job, decision.jobStatus, message, decision.nextRunAt);
  return decision.shouldRetry;
}

async function assertPublicSourceWorkerPolicy(job: ClaimedJob, visibility: GenerationVisibility): Promise<void> {
  const initialViolation = publicSourceWorkerPolicyViolation(job.documents.metadata, false);
  if (initialViolation) throw new Error(initialViolation);
  if (job.documents.metadata?.corpus_scope !== "australian_public") return;

  const generationPredicate = generationPredicateForJob(job, visibility);
  const containsProtectedSourceContent = await scanProtectedPublicSourceChunkPages(async (offset, limit) => {
    const rows = await sql<Array<{ content: string; document_id: string; generation_id: string | null }>>`
        select chunk.content, chunk.document_id, chunk.index_generation_id::text as generation_id
        from public.document_chunks chunk
        where chunk.document_id = ${job.document_id}::uuid
          and (
            chunk.index_generation_id = ${generationPredicate.indexGenerationId}::uuid
            or (${generationPredicate.isLegacy}::boolean and chunk.index_generation_id is null)
          )
        order by chunk.chunk_index, chunk.id
        limit ${limit}
        offset ${offset}
      `;
    return visibleGenerationRows(rows, visibility);
  });
  const violation = publicSourceWorkerPolicyViolation(job.documents.metadata, containsProtectedSourceContent);
  if (violation) throw new Error(violation);
}

async function processJob(
  job: ClaimedJob,
  visibility: GenerationVisibility,
): Promise<{ status: "completed" | "deferred"; missing: string[] }> {
  await assertPublicSourceWorkerPolicy(job, visibility);
  const indexGenerationId = requireSourceAnchoredSummaryGenerationForJob(job);
  const summarySources = await loadSourceAnchoredSummarySources(job, indexGenerationId);
  const summaryPayload = await ensureSummary(job, summarySources);
  let gate = await completionGate(job);
  let plan = missingArtifactPlan(gate);
  logArtifactPlan(job, gate, plan);

  if (gate.result === "complete") {
    logCompletionGate(job, gate);
    await completeJob(job);
    return { status: "completed", missing: [] };
  }

  let touchedQualityInputs = false;

  if (plan.needs_core_embeddings) {
    const s1 = await stageStart(job, "summary_and_core_embeddings");
    try {
      const coreFields = await upsertCoreEmbeddingFields(job, summaryPayload.summary, visibility);
      await stageFinish(job, s1, true, { core_embedding_fields: coreFields });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(job, s1, false, {}, msg);
      throw e;
    }
  }

  if (plan.needs_sections || plan.needs_index_units) {
    const s2 = await stageStart(job, "sections_and_index_units");
    try {
      const repairedSections = plan.needs_sections ? await ensureSectionsFromChunks(job, visibility) : 0;
      if (repairedSections > 0) {
        gate = await completionGate(job);
        plan = missingArtifactPlan(gate);
      }
      const sectionUnits =
        plan.needs_index_units || repairedSections > 0 ? await upsertSectionIndexUnits(job, visibility) : 0;
      touchedQualityInputs = touchedQualityInputs || repairedSections > 0 || sectionUnits > 0;
      await stageFinish(job, s2, true, { repaired_sections: repairedSections, section_index_units: sectionUnits });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(job, s2, false, {}, msg);
      throw e;
    }
  }

  if (await needsVisualArtifacts(job, visibility)) {
    const s3 = await stageStart(job, "visual_priority_and_structured_extraction");
    try {
      const out = await upsertVisualArtifacts(job, visibility);
      touchedQualityInputs = touchedQualityInputs || out.created_units > 0 || out.created_fields > 0;
      await stageFinish(job, s3, true, out);
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(job, s3, false, {}, msg);
      throw e;
    }
  }

  if (touchedQualityInputs) {
    const s4 = await stageStart(job, "quality_refresh");
    try {
      await updateQuality(job, visibility);
      await stageFinish(job, s4, true, { refreshed: true });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(job, s4, false, {}, msg);
      throw e;
    }
  }

  if (plan.needs_memory) {
    const s4 = await stageStart(job, "memory_cards_from_sections");
    try {
      const memoryCards = await upsertMemoryCardsFromSections(job, visibility);
      await stageFinish(job, s4, true, { memory_cards: memoryCards });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(job, s4, false, {}, msg);
      throw e;
    }
  }
  logCompletionGate(job, gate);
  if (gate.result === "deferred") {
    await deferJob(job, gate);
    return { status: "deferred", missing: gate.missing };
  }

  await completeJob(job);
  return { status: "completed", missing: [] };
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, async (req: Request) => {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const unauthorized = await authorizeRequest(req);
    if (unauthorized) return unauthorized;

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? "8")));
    const workerId = `indexing-v3-agent-${crypto.randomUUID()}`;

    const claimSource = "documents";
    const claimRows = await sql<Array<{ claim: ClaimedJob }>>`
      select public.claim_indexing_v3_agent_jobs(${workerId}::text, ${limit}::integer, 45::integer) as claim
    `;
    const claimed = claimRows.map((row) => row.claim);
    for (const job of claimed) {
      const fence = parseIngestionFence({
        job_kind: "indexing_v3",
        job_id: job.id,
        document_id: job.document_id,
        worker_id: job.locked_by,
        lease_token: job.lease_token,
        expected_generation_id: job.lease_expected_generation_id,
        authority_digest: job.lease_authority_digest,
      });
      if (
        job.lease_write_generation_id !== fence.expected_generation_id ||
        !Number.isInteger(job.lease_duration_seconds) ||
        job.lease_duration_seconds < 60 ||
        job.lease_duration_seconds > 86400 ||
        !Number.isFinite(Date.parse(job.lease_expires_at))
      ) {
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      }
      jobAttempts.set(job, new IngestionAttempt(fence));
    }

    if (claimed.length === 0) {
      return Response.json({ ok: true, claimed: 0, processed: 0, failed: 0 });
    }

    const claimedDocumentIds = Array.from(new Set(claimed.map((job) => job.document_id)));
    const authorityRows = await sql<DocumentGenerationAuthorityRow[]>`
      select id, index_generation_id, metadata
      from public.documents
      where id = any(${claimedDocumentIds}::uuid[])
    `;
    const generationVisibility = buildGenerationVisibility(authorityRows, claimedDocumentIds);

    let processed = 0;
    let deferred = 0;
    let failed = 0;
    const failures: Array<{
      job_id: string;
      document_id: string;
      error: string;
      failure_recording_error?: string;
    }> = [];
    const deferrals: Array<{ job_id: string; document_id: string; missing: string[] }> = [];

    const outcomes = await runEdgeJobBatch(
      claimed,
      async (job) => {
        const heartbeat = setInterval(
          () => {
            edgeMutation(job, "heartbeat_indexing_v3_agent_job").catch(() => {
              jobAttempts.get(job)?.cancel();
            });
          },
          Math.max(1000, Math.floor((job.lease_duration_seconds * 1000) / 3)),
        );
        try {
          return await processJob(job, generationVisibility);
        } finally {
          clearInterval(heartbeat);
        }
      },
      (job, message) => markJobFailure(job, message),
    );
    for (const outcome of outcomes) {
      const job = outcome.job;
      if ("result" in outcome) {
        const result = outcome.result;
        if (result.status === "completed") {
          processed += 1;
        } else {
          deferred += 1;
          deferrals.push({ job_id: job.id, document_id: job.document_id, missing: result.missing });
        }
      } else {
        failed += 1;
        failures.push({
          job_id: job.id,
          document_id: job.document_id,
          error: outcome.error,
          ...(outcome.failureRecordingError ? { failure_recording_error: outcome.failureRecordingError } : {}),
        });
      }
    }

    return Response.json({
      ok: true,
      worker: workerId,
      claim_source: claimSource,
      claimed: claimed.length,
      processed,
      deferred,
      failed,
      deferrals,
      failures,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : JSON.stringify(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
