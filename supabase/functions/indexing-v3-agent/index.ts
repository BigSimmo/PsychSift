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
  phraseLabelCandidates,
  sha256Hex,
  sleep,
  normalizeLabelCandidate,
  canonicalUnitType,
  canonicalFieldType,
} from "./utils.ts";

import {
  completionGateFromRow,
  agentFailureDecision,
  deferralDecision,
  isAllowedAgentMethod,
  missingArtifactPlan,
  parseAgentClaimLimit,
  parseJobStatusRpcResult,
  runClaimedJobBatch,
  shouldRunVisualArtifacts,
  type CompletionGate,
  type CompletionGateRow,
  type JobStatusRpcResult,
  type MissingArtifactPlan,
} from "./behavior.ts";

import { authorizeIndexingAgentRequest } from "./auth.ts";

type ClaimedJob = {
  id: string;
  document_id: string;
  batch_id: string | null;
  attempt_count: number;
  max_attempts: number;
  documents: {
    id: string;
    owner_id: string | null;
    title: string | null;
    metadata: Record<string, unknown> | null;
  };
};

type ImageRow = {
  id: string;
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

type GeneratedLabelCandidate = {
  label: string;
  label_type:
    | "site"
    | "topic"
    | "document_type"
    | "medication"
    | "risk"
    | "setting"
    | "workflow"
    | "population"
    | "service"
    | "custom";
  confidence: number;
  metadata: Record<string, unknown>;
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

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
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

// Dual-gated authentication: requires BOTH a valid JWT and the internal service secret (Task #P6BSQ3).
async function authorizeRequest(req: Request): Promise<Response | null> {
  return authorizeIndexingAgentRequest(req, AGENT_SECRET);
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

async function fetchEmbeddingBatch(texts: string[]): Promise<number[][]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        signal: controller.signal,
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
        return rows
          .slice()
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((row, index) => {
            assertEmbeddingDim(row.embedding, `OpenAI response ${index}`);
            return row.embedding;
          });
      }
    } catch (e) {
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

async function embeddingBatch(texts: string[]): Promise<number[][]> {
  const normalized = texts.map((text) => normalizeText(text).slice(0, 12_000) || " ");
  const out: number[][] = [];
  for (let start = 0; start < normalized.length; start += OPENAI_EMBEDDING_BATCH_SIZE) {
    out.push(...(await fetchEmbeddingBatch(normalized.slice(start, start + OPENAI_EMBEDDING_BATCH_SIZE))));
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

async function stageStart(job: ClaimedJob, stageName: string, metadata: Record<string, unknown> = {}): Promise<string> {
  const row = await sql<{ id: string }[]>`
    insert into public.ingestion_job_stages (
      job_id, document_id, stage_name, stage_status, metadata
    ) values (
      ${job.id}::uuid,
      ${job.document_id}::uuid,
      ${stageName}::text,
      'started',
      ${jsonb(metadata)}
    )
    returning id
  `;
  return row[0].id;
}

async function stageFinish(
  stageId: string,
  ok: boolean,
  artifactCounts: Record<string, unknown> = {},
  errorMessage?: string,
): Promise<void> {
  await sql`
    update public.ingestion_job_stages
    set
      stage_status = ${ok ? "completed" : "failed"}::text,
      finished_at = now(),
      artifact_counts = ${jsonb(artifactCounts)},
      error_message = ${errorMessage ?? null}::text
    where id = ${stageId}::uuid
  `;
}

async function ensureSummary(job: ClaimedJob): Promise<string> {
  const existing = await sql<{ summary: string }[]>`
    select summary
    from public.document_summaries
    where document_id = ${job.document_id}::uuid
    limit 1
  `;
  if (existing.length > 0) return normalizeText(existing[0].summary);

  const chunks = await sql<{ id: string; content: string; chunk_index: number }[]>`
    select id, content, chunk_index
    from public.document_chunks
    where document_id = ${job.document_id}::uuid
    order by chunk_index asc
    limit 24
  `;

  const merged = normalizeText(chunks.map((c) => c.content ?? "").join(" "));
  const summary = merged.length > 1800 ? `${merged.slice(0, 1800)}...` : merged;

  await sql`
    insert into public.document_summaries (
      document_id, owner_id, summary, source_chunk_ids, model, metadata, generated_at
    ) values (
      ${job.document_id}::uuid,
      ${job.documents.owner_id}::uuid,
      ${summary.length > 0 ? summary : "Summary unavailable"}::text,
      ${chunks.map((c) => c.id)}::uuid[],
      'v3-summary-heuristic',
      ${jsonb({ generated_by: GENERATED_BY })},
      now()
    )
    on conflict (document_id)
    do update set
      summary = excluded.summary,
      source_chunk_ids = excluded.source_chunk_ids,
      model = excluded.model,
      metadata = excluded.metadata,
      generated_at = now(),
      updated_at = now()
  `;

  return summary.length > 0 ? summary : "Summary unavailable";
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

function inferLabelType(text: string): GeneratedLabelCandidate["label_type"] {
  const hay = normalizeText(text).toLowerCase();
  if (
    /(clozapine|lithium|antipsychotic|antidepressant|insulin|antibiotic|opioid|benzodiazepine|medicat|doses?|tablet|drug|prescription)/.test(
      hay,
    )
  )
    return "medication";
  if (/(risk|safety|seclusion|restraint|suicide|self.?harm|violence|agitation|escalat)/.test(hay)) return "risk";
  if (/(home|community|inpatient|outpatient|ward|clinic|hospital|emergency|ambulance|unit|setting)/.test(hay))
    return "setting";
  if (/(workflow|pathway|process|algorithm|protocol|care.?plan|admission|discharge|handoff)/.test(hay))
    return "workflow";
  if (/(document|guideline|policy|manual|procedure|form|checklist|assessment|screening|brief)/.test(hay))
    return "document_type";
  if (
    /(child|children|adult|adolescent|elderly|geriatric|neonat|pediatric|prenatal|pregnant|population|service user)/.test(
      hay,
    )
  )
    return "population";
  if (/(service|team|multidisciplinary|support)/.test(hay)) return "service";
  return "topic";
}

function pushLabelCandidate(
  candidates: Map<string, GeneratedLabelCandidate>,
  rawLabel: string,
  labelType: GeneratedLabelCandidate["label_type"],
  confidence: number,
  metadata: Record<string, unknown>,
) {
  const label = normalizeLabelCandidate(rawLabel);
  if (!label) return;
  const key = `${labelType}::${label}`;
  const existing = candidates.get(key);
  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.metadata = { ...existing.metadata, ...metadata };
    return;
  }

  candidates.set(key, {
    label,
    label_type: labelType,
    confidence,
    metadata,
  });
}

function mapMemoryCardTypeToLabelType(cardType: string): GeneratedLabelCandidate["label_type"] {
  if (cardType === "medication") return "medication";
  if (cardType === "risk") return "risk";
  if (cardType === "workflow") return "workflow";
  if (
    cardType === "table_row" ||
    cardType === "askable_question" ||
    cardType === "section_summary" ||
    cardType === "definition" ||
    cardType === "citation_anchor"
  )
    return "topic";
  return "custom";
}

function candidateConfidence(base: number, source: string): number {
  if (source === "document_title") return Math.min(0.82, base + 0.08);
  if (source === "section_heading") return Math.min(0.9, base + 0.12);
  if (source === "memory_card_title") return Math.min(0.86, base + 0.1);
  if (source === "section_tag") return Math.min(0.74, base + 0.08);
  if (source === "memory_card_content") return Math.min(0.76, base + 0.06);
  return base;
}

async function upsertGeneratedLabelsFromParsedArtifacts(job: ClaimedJob): Promise<number> {
  const summaryRows = await sql<{ summary: string }[]>`
    select summary
    from public.document_summaries
    where document_id = ${job.document_id}::uuid
    limit 1
  `;
  const chunksForLabels = await sql<{ content: string }[]>`
    select content
    from public.document_chunks
    where document_id = ${job.document_id}::uuid
    order by chunk_index asc
    limit 8
  `;

  const sections = await sql<SectionLabelSource[]>`
    select
      s.id as section_id,
      s.heading,
      s.heading_path,
      coalesce(s.summary, '') as summary,
      s.tags,
      c.id as source_chunk_id,
      c.anchor_id,
      c.chunk_index
    from public.document_sections s
    left join lateral (
      select id, anchor_id, chunk_index
      from public.document_chunks c
      where c.document_id = s.document_id
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
    order by s.section_index asc
  `;

  const cards = await sql<MemoryCardLabelSource[]>`
    select
      id as card_id,
      card_type,
      title,
      content
    from public.document_memory_cards
    where document_id = ${job.document_id}::uuid
    order by created_at desc
  `;

  const candidates = new Map<string, GeneratedLabelCandidate>();
  const sectionCount = sections.length;
  const cardCount = cards.length;

  if (job.documents.title) {
    pushLabelCandidate(
      candidates,
      job.documents.title,
      inferLabelType(job.documents.title),
      candidateConfidence(0.68, "document_title"),
      { source: "document_title", source_text: job.documents.title },
    );
  }
  if (summaryRows.length > 0 && summaryRows[0].summary) {
    for (const keyword of phraseLabelCandidates(summaryRows[0].summary, 4)) {
      pushLabelCandidate(
        candidates,
        keyword,
        inferLabelType(summaryRows[0].summary),
        candidateConfidence(0.55, "section_heading"),
        { source: "document_summary_token" },
      );
    }
  }

  for (const chunk of chunksForLabels) {
    for (const keyword of phraseLabelCandidates(chunk.content, 3)) {
      pushLabelCandidate(
        candidates,
        keyword,
        inferLabelType(chunk.content),
        candidateConfidence(0.52, "section_heading"),
        { source: "document_chunk_token" },
      );
    }
  }

  for (const section of sections) {
    if (section.heading) {
      pushLabelCandidate(
        candidates,
        section.heading,
        inferLabelType(section.heading),
        candidateConfidence(0.78, "section_heading"),
        {
          source: "document_section",
          section_id: section.section_id,
          source_chunk_id: section.source_chunk_id ?? null,
          chunk_index: section.chunk_index ?? null,
          anchor_id: section.anchor_id ?? null,
        },
      );
    }

    if ((section.heading_path ?? []).length > 0) {
      const pathLabel = section.heading_path!.join(" > ");
      if (pathLabel.length > 4) {
        pushLabelCandidate(
          candidates,
          pathLabel,
          inferLabelType(section.heading),
          candidateConfidence(0.56, "section_tag"),
          {
            source: "document_section_path",
            section_id: section.section_id,
            source_chunk_id: section.source_chunk_id ?? null,
            chunk_index: section.chunk_index ?? null,
            anchor_id: section.anchor_id ?? null,
          },
        );
      }
    }

    if (section.summary) {
      for (const keyword of phraseLabelCandidates(section.summary, 4)) {
        pushLabelCandidate(
          candidates,
          keyword,
          inferLabelType(section.summary),
          candidateConfidence(0.6, "section_heading"),
          {
            source: "document_section_summary_token",
            section_id: section.section_id,
            source_chunk_id: section.source_chunk_id ?? null,
            chunk_index: section.chunk_index ?? null,
            anchor_id: section.anchor_id ?? null,
          },
        );
      }
    }

    for (const tag of section.tags ?? []) {
      pushLabelCandidate(candidates, tag, inferLabelType(tag), candidateConfidence(0.62, "section_tag"), {
        source: "document_section_tag",
        section_id: section.section_id,
        source_chunk_id: section.source_chunk_id,
        chunk_index: section.chunk_index,
        anchor_id: section.anchor_id,
      });
    }
  }

  for (const card of cards) {
    const labelType = mapMemoryCardTypeToLabelType(card.card_type);
    pushLabelCandidate(candidates, card.title, labelType, candidateConfidence(0.72, "memory_card_title"), {
      source: "document_memory_card",
      card_id: card.card_id,
      card_type: card.card_type,
    });
    for (const term of phraseLabelCandidates(card.content, 4)) {
      pushLabelCandidate(candidates, term, labelType, candidateConfidence(0.55, "memory_card_content"), {
        source: "document_memory_card_content",
        card_id: card.card_id,
        card_type: card.card_type,
      });
    }
  }

  const prepared = Array.from(candidates.values()).slice(0, 80);
  if (prepared.length === 0) return 0;

  const inserted = await sql.begin(async (tx) => {
    let count = 0;
    for (const candidate of prepared) {
      await tx`
        insert into public.document_labels (
          document_id,
          owner_id,
          label,
          label_type,
          source,
          confidence,
          metadata
        ) values (
          ${job.document_id}::uuid,
          ${job.documents.owner_id}::uuid,
          ${candidate.label},
          ${candidate.label_type},
          'generated',
          ${Math.min(0.98, Math.max(0.2, candidate.confidence))},
          ${jsonb({
            ...candidate.metadata,
            generated_by: GENERATED_BY,
            generation_source: "indexing_v3_agent_parsed_artifacts",
            section_candidates: sectionCount,
            memory_card_candidates: cardCount,
            fallback_generated_count: prepared.length,
          })}
        )
        on conflict (document_id, label_type, label, source)
        do update set
          confidence = greatest(document_labels.confidence, excluded.confidence),
          metadata = CASE
            WHEN jsonb_typeof(document_labels.metadata) = 'object' THEN
              coalesce(document_labels.metadata, '{}'::jsonb) || excluded.metadata
            ELSE excluded.metadata
          END,
          updated_at = now()
      `;
      count += 1;
    }
    return count;
  });

  return inserted;
}

function memoryCardText(title: string, cardType: string, content: string, terms: string[]): string {
  return `${title}\n${cardType}\n${content}\nTerms: ${terms.join(", ")}`;
}

async function ensureSectionsFromChunks(job: ClaimedJob): Promise<number> {
  const existing = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.document_sections
    where document_id = ${job.document_id}::uuid
  `;
  if ((existing[0]?.count ?? 0) > 0) return 0;

  const chunks = await sql<ChunkSectionSource[]>`
    select id, page_number, chunk_index, section_heading, section_path, content
    from public.document_chunks
    where document_id = ${job.document_id}::uuid
    order by chunk_index asc
    limit 24
  `;
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

    const rows = await sql<{ id: string }[]>`
      insert into public.document_sections (
        document_id,
        owner_id,
        section_index,
        heading,
        heading_path,
        page_start,
        page_end,
        chunk_ids,
        summary,
        tags,
        extraction_quality,
        metadata
      ) values (
        ${job.document_id}::uuid,
        ${job.documents.owner_id}::uuid,
        ${index}::integer,
        ${heading}::text,
        ${path.length > 0 ? path : [heading]}::text[],
        ${chunk.page_number}::integer,
        ${chunk.page_number}::integer,
        ${[chunk.id]}::uuid[],
        ${summary}::text,
        ${tags}::text[],
        'partial',
        ${jsonb({
          generated_by: GENERATED_BY,
          source: "document_chunks",
          source_chunk_id: chunk.id,
          repaired_missing_sections: true,
        })}
      )
      on conflict (document_id, section_index) do nothing
      returning id
    `;
    inserted += rows.length;
  }

  return inserted;
}

async function upsertMemoryCardsFromSections(job: ClaimedJob): Promise<number> {
  const sections = await sql<MemoryCardSectionSource[]>`
    select
      id as section_id,
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
      and btrim(coalesce(summary, '')) <> ''
    order by section_index asc
    limit 16
  `;

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

  const embeddings = await embeddingBatch(prepared.map((card) => card.embeddingText));
  embeddings.forEach((embedding, index) =>
    assertEmbeddingDim(embedding, `memory card ${prepared[index].section.section_id}`),
  );
  let inserted = 0;
  await sql.begin(async (tx) => {
    await tx`
      delete from public.document_memory_cards
      where document_id = ${job.document_id}::uuid
        and metadata->>'generated_by' = ${GENERATED_BY}
        and metadata->>'source' = 'document_sections'
    `;
    for (let index = 0; index < prepared.length; index += 1) {
      const card = prepared[index];
      const section = card.section;
      const chunkIds = section.chunk_ids ?? [];
      const emb = embeddings[index];

      await tx`
      insert into public.document_memory_cards (
        document_id,
        owner_id,
        section_id,
        card_type,
        title,
        content,
        normalized_terms,
        page_number,
        source_chunk_ids,
        source_image_ids,
        confidence,
        metadata,
        embedding
      ) values (
        ${job.document_id}::uuid,
        ${job.documents.owner_id}::uuid,
        ${section.section_id}::uuid,
        'section_summary',
        ${card.title}::text,
        ${card.content}::text,
        ${card.terms}::text[],
        ${section.page_start}::integer,
        ${chunkIds}::uuid[],
        '{}'::uuid[],
        ${section.extraction_quality === "good" ? 0.72 : section.extraction_quality === "partial" ? 0.62 : 0.54},
        ${jsonb({
          generated_by: GENERATED_BY,
          source: "document_sections",
          section_id: section.section_id,
          heading_path: section.heading_path ?? [],
          page_start: section.page_start,
          page_end: section.page_end,
        })},
        ${JSON.stringify(emb)}::vector
      )
      `;
      inserted += 1;
    }
  });

  return inserted;
}

async function upsertSectionIndexUnits(job: ClaimedJob): Promise<number> {
  const sections = await sql<SectionIndexSource[]>`
    select
      s.id as section_id,
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
      and btrim(coalesce(s.summary, '')) <> ''
    order by s.section_index asc
  `;

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
        section: SectionIndexSource;
        title: string;
        content: string;
        embeddingText: string;
      } => Boolean(row),
    );

  const embeddings = await embeddingBatch(preparedSections.map((section) => section.embeddingText));
  embeddings.forEach((embedding, index) =>
    assertEmbeddingDim(embedding, `section index unit ${preparedSections[index].section.section_id}`),
  );
  let inserted = 0;
  await sql.begin(async (tx) => {
    await tx`
      delete from public.document_index_units
      where document_id = ${job.document_id}::uuid
        and unit_type = 'section_summary'
        and metadata->>'generated_by' = ${GENERATED_BY}
        and metadata->>'source' = 'document_sections'
    `;
    for (let index = 0; index < preparedSections.length; index += 1) {
      const { section, title, content } = preparedSections[index];
      const emb = embeddings[index];

      await tx`
      insert into public.document_index_units (
        owner_id,
        document_id,
        unit_type,
        source_chunk_id,
        source_image_id,
        page_start,
        page_end,
        heading_path,
        title,
        content,
        normalized_terms,
        source_span,
        quality_score,
        extraction_mode,
        embedding,
        metadata
      ) values (
        ${job.documents.owner_id}::uuid,
        ${job.document_id}::uuid,
        'section_summary',
        ${section.source_chunk_id}::uuid,
        null,
        ${section.page_start},
        ${section.page_end},
        ${section.heading_path ?? []}::text[],
        ${title},
        ${content},
        ${tokenize(`${title} ${content} ${(section.tags ?? []).join(" ")}`)}::text[],
        ${jsonb({ anchor_id: section.anchor_id, chunk_index: section.chunk_index })},
        ${section.extraction_quality === "good" ? 0.78 : section.extraction_quality === "partial" ? 0.58 : 0.42},
        'hybrid',
        ${JSON.stringify(emb)}::vector,
        ${jsonb({
          generated_by: GENERATED_BY,
          source: "document_sections",
          section_id: section.section_id,
          chunk_ids: section.chunk_ids ?? [],
          anchor_id: section.anchor_id,
        })}
      )
      `;
      inserted += 1;
    }
  });

  return inserted;
}

async function upsertVisualArtifacts(
  job: ClaimedJob,
): Promise<{ selected_images: number; created_units: number; created_fields: number }> {
  const images = await sql<ImageRow[]>`
    select
      id, page_number, image_type, searchable, caption, metadata,
      width, height, source_kind, clinical_relevance_score, skip_reason
    from public.document_images
    where document_id = ${job.document_id}::uuid
      and coalesce(searchable, false) = true
      and coalesce(image_type, 'unclear') <> 'logo_decorative'
    order by page_number asc nulls last, created_at asc
  `;

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

    await sql`
      update public.document_images
      set
        metadata = (
          case
            when jsonb_typeof(coalesce(metadata, '{}'::jsonb)) = 'object'
              then coalesce(metadata, '{}'::jsonb)
            else jsonb_build_object('legacy_metadata', metadata)
          end
        ) || ${jsonb({
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
        })}
      where id = ${img.id}::uuid
    `;

    for (const unit of units) {
      const content = normalizeText(unit.content);
      if (content.length < 4) continue;

      const unitType = canonicalUnitType(unit.unitType);
      const fieldType = canonicalFieldType(unit.unitType);
      const contentHash = await sha256Hex(content);
      preparedUnits.push({ unit, content, unitType, fieldType, contentHash });
    }
  }

  const embeddings = await embeddingBatch(preparedUnits.map((prepared) => prepared.content));
  embeddings.forEach((embedding, index) =>
    assertEmbeddingDim(embedding, `visual index unit ${preparedUnits[index].unit.sourceImageId}`),
  );
  await sql.begin(async (tx) => {
    await tx`
      delete from public.document_embedding_fields
      where document_id = ${job.document_id}::uuid
        and field_type = any(${VISUAL_FIELD_TYPES}::text[])
        and metadata->>'generated_by' = ${GENERATED_BY}
    `;
    await tx`
      delete from public.document_index_units
      where document_id = ${job.document_id}::uuid
        and unit_type = any(${VISUAL_UNIT_TYPES}::text[])
        and metadata->>'generated_by' = ${GENERATED_BY}
    `;
    for (let index = 0; index < preparedUnits.length; index += 1) {
      const { unit, content, unitType, fieldType, contentHash } = preparedUnits[index];
      const emb = embeddings[index];

      await tx`
      insert into public.document_index_units (
        owner_id,
        document_id,
        unit_type,
        source_chunk_id,
        source_image_id,
        page_start,
        page_end,
        heading_path,
        title,
        content,
        normalized_terms,
        source_span,
        quality_score,
        extraction_mode,
        embedding,
        metadata
      ) values (
        ${job.documents.owner_id}::uuid,
        ${job.document_id}::uuid,
        ${unitType},
        null,
        ${unit.sourceImageId}::uuid,
        ${unit.page},
        ${unit.page},
        '{}'::text[],
        ${unit.title},
        ${content},
        ${unit.normalizedTerms}::text[],
        ${jsonb({ source_image_id: unit.sourceImageId, source_regions: unit.metadata.source_regions ?? [] })},
        ${unit.qualityScore},
        'hybrid',
        ${JSON.stringify(emb)}::vector,
        ${jsonb({ ...unit.metadata, visual_unit_type: unit.unitType, generated_by: GENERATED_BY })}
      )
      `;
      createdUnits += 1;

      await tx`
        insert into public.document_embedding_fields (
          owner_id,
          document_id,
          source_chunk_id,
          field_type,
          content,
          embedding,
          metadata,
          content_hash
        ) values (
          ${job.documents.owner_id}::uuid,
          ${job.document_id}::uuid,
          null,
          ${fieldType},
          ${content},
          ${JSON.stringify(emb)}::vector,
          ${jsonb({ source_image_id: unit.sourceImageId, visual_field_type: unit.unitType, generated_by: GENERATED_BY })},
          ${contentHash}
        )
        `;
      createdFields += 1;
    }
  });

  return { selected_images: selected.length, created_units: createdUnits, created_fields: createdFields };
}

async function upsertCoreEmbeddingFields(job: ClaimedJob, summary: string): Promise<number> {
  const title = normalizeText(job.documents.title ?? "") || "Untitled document";
  const base = [
    { field_type: "document_title", content: title },
    { field_type: "document_summary", content: normalizeText(summary) || "Summary unavailable" },
  ];

  const embeddings = await embeddingBatch(base.map((row) => row.content));
  embeddings.forEach((embedding, index) => assertEmbeddingDim(embedding, `${base[index].field_type} embedding field`));
  let inserted = 0;
  const preparedRows = await Promise.all(
    base.map(async (row, index) => ({ row, emb: embeddings[index], contentHash: await sha256Hex(row.content) })),
  );
  await sql.begin(async (tx) => {
    await tx`
      delete from public.document_embedding_fields
      where document_id = ${job.document_id}::uuid
        and field_type = any(${base.map((b) => b.field_type)}::text[])
        and metadata->>'generated_by' = ${GENERATED_BY}
    `;
    for (const { row, emb, contentHash } of preparedRows) {
      await tx`
      insert into public.document_embedding_fields (
        owner_id, document_id, source_chunk_id, field_type, content, embedding, metadata, content_hash
      ) values (
        ${job.documents.owner_id}::uuid,
        ${job.document_id}::uuid,
        null,
        ${row.field_type},
        ${row.content},
        ${JSON.stringify(emb)}::vector,
        ${jsonb({ generated_by: GENERATED_BY })},
        ${contentHash}
      )
      `;
      inserted += 1;
    }
  });

  return inserted;
}

async function updateQuality(job: ClaimedJob): Promise<void> {
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
    ),
    image_counts as (
      select count(*)::int as visual_images
      from public.document_images
      where document_id = ${job.document_id}::uuid
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

  await sql`
    insert into public.document_index_quality (
      document_id,
      owner_id,
      quality_score,
      extraction_quality,
      metrics,
      issues,
      updated_at
    ) values (
      ${job.document_id}::uuid,
      ${job.documents.owner_id}::uuid,
      ${Math.max(0, Math.min(1, 0.55 + typedCoverage * 0.25 + anchorCoverage * 0.2))},
      'partial',
      ${jsonb({
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
      })},
      ${issues}::text[],
      now()
    )
    on conflict (document_id)
    do update set
      quality_score = greatest(public.document_index_quality.quality_score, excluded.quality_score),
      extraction_quality = case
        when public.document_index_quality.extraction_quality in ('good', 'partial') then public.document_index_quality.extraction_quality
        else excluded.extraction_quality
      end,
      metrics = coalesce(public.document_index_quality.metrics, '{}'::jsonb) || excluded.metrics,
      issues = coalesce((
        select array_agg(distinct issue order by issue)
        from unnest(coalesce(public.document_index_quality.issues, '{}'::text[]) || excluded.issues) as issue
      ), '{}'::text[]),
      updated_at = now()
  `;
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

async function needsVisualArtifacts(job: ClaimedJob): Promise<boolean> {
  const rows = await sql<Array<{ eligible_images: number; generated_visual_units: number }>>`
    select
      (
        select count(*)::int
        from public.document_images
        where document_id = ${job.document_id}::uuid
          and coalesce(searchable, false) = true
          and coalesce(image_type, 'unclear') <> 'logo_decorative'
      ) as eligible_images,
      (
        select count(*)::int
        from public.document_index_units
        where document_id = ${job.document_id}::uuid
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
): Promise<void> {
  const rows = await sql<JobStatusRpcResult[]>`
    select *
    from public.update_indexing_v3_agent_job_status(
      ${job.document_id}::uuid,
      ${status}::text,
      ${error}::text,
      ${nextRunAt}::timestamptz
    )
  `;
  const result = parseJobStatusRpcResult(rows[0], "update_indexing_v3_agent_job_status");
  if (!result?.ok) {
    throw new Error(`Failed to update indexing_v3_agent_jobs status to ${status} for document ${job.document_id}`);
  }
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

  await sql`
    update public.documents
    set
      metadata = jsonb_strip_nulls(
        (coalesce(metadata, '{}'::jsonb)
          - 'indexing_v3_agent_locked_by'
          - 'indexing_v3_agent_locked_at'
          - 'indexing_v3_agent_last_error'
          - 'indexing_v3_agent_next_run_at')
        || jsonb_build_object(
          'indexing_v3_agent_status', ${decision.status}::text,
          'indexing_v3_agent_version', 'visual-core-v3',
          'indexing_v3_agent_updated_at', now(),
          'indexing_v3_agent_deferral_count', ${decision.deferral_count}::integer,
          'indexing_v3_agent_next_run_at', ${decision.next_run_at}::timestamptz,
          'completion_gate', ${jsonb(decision.details)},
          'completion_gate_missing', ${jsonb(gate.missing)},
          'enrichment_status', ${decision.enrichment_status}::text
        )
      ),
      updated_at = now()
    where id = ${job.document_id}::uuid
  `;
  await updateAgentJobStatus(
    job,
    decision.status === "needs_enrichment_artifacts" ? "needs_enrichment_artifacts" : "pending",
    null,
    decision.status === "needs_enrichment_artifacts" ? null : decision.next_run_at,
  );
}

async function completeJob(job: ClaimedJob): Promise<void> {
  const rows = await sql<JobStatusRpcResult[]>`
    select *
    from public.complete_strict_enrichment_job(
      ${job.document_id}::uuid,
      ${job.id}::uuid,
      'indexed; enrichment completed',
      'visual-core-v3',
      'visual-v3'
    )
  `;
  const result = parseJobStatusRpcResult(rows[0], "complete_strict_enrichment_job");
  if (!result?.ok || !result.gate_passed) {
    throw new Error(
      `Strict enrichment completion blocked: ${JSON.stringify({
        status: result?.status ?? "missing_result",
        missing: result?.missing ?? ["completion_rpc_failed"],
      })}`,
    );
  }
  await updateAgentJobStatus(job, "completed");
}

async function markJobFailure(job: ClaimedJob, message: string): Promise<boolean> {
  const decision = agentFailureDecision({
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    nowMs: Date.now(),
    retryDelayMs: INDEXING_V3_RETRY_DELAY_MS,
  });
  await sql`
    update public.documents
    set
      metadata = jsonb_strip_nulls(
        (coalesce(metadata, '{}'::jsonb)
          - 'indexing_v3_agent_locked_by'
          - 'indexing_v3_agent_locked_at'
          - 'indexing_v3_agent_next_run_at')
        || jsonb_build_object(
          'indexing_v3_agent_status', ${decision.status}::text,
          'indexing_v3_agent_version', 'visual-core-v3',
          'indexing_v3_agent_updated_at', now(),
          'indexing_v3_agent_attempt_count', ${job.attempt_count}::integer,
          'indexing_v3_agent_max_attempts', ${job.max_attempts}::integer,
          'indexing_v3_agent_next_run_at', ${decision.nextRunAt}::timestamptz,
          'indexing_v3_agent_last_error', ${message}::text,
          'enrichment_status', ${decision.enrichmentStatus}::text,
          'enrichment_error', ${message}::text
        )
      ),
      updated_at = now()
    where id = ${job.document_id}::uuid
  `;
  await updateAgentJobStatus(job, decision.jobStatus, message, decision.nextRunAt);
  return decision.shouldRetry;
}

async function processJob(job: ClaimedJob): Promise<{ status: "completed" | "deferred"; missing: string[] }> {
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
      const summary = await ensureSummary(job);
      const coreFields = await upsertCoreEmbeddingFields(job, summary);
      await stageFinish(s1, true, { core_embedding_fields: coreFields });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(s1, false, {}, msg);
      throw e;
    }
  }

  if (plan.needs_sections || plan.needs_index_units) {
    const s2 = await stageStart(job, "sections_and_index_units");
    try {
      const repairedSections = plan.needs_sections ? await ensureSectionsFromChunks(job) : 0;
      if (repairedSections > 0) {
        gate = await completionGate(job);
        plan = missingArtifactPlan(gate);
      }
      const sectionUnits = plan.needs_index_units || repairedSections > 0 ? await upsertSectionIndexUnits(job) : 0;
      touchedQualityInputs = touchedQualityInputs || repairedSections > 0 || sectionUnits > 0;
      await stageFinish(s2, true, { repaired_sections: repairedSections, section_index_units: sectionUnits });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(s2, false, {}, msg);
      throw e;
    }
  }

  if (await needsVisualArtifacts(job)) {
    const s3 = await stageStart(job, "visual_priority_and_structured_extraction");
    try {
      const out = await upsertVisualArtifacts(job);
      touchedQualityInputs = touchedQualityInputs || out.created_units > 0 || out.created_fields > 0;
      await stageFinish(s3, true, out);
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(s3, false, {}, msg);
      throw e;
    }
  }

  if (touchedQualityInputs) {
    const s4 = await stageStart(job, "quality_refresh");
    try {
      await updateQuality(job);
      await stageFinish(s4, true, { refreshed: true });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(s4, false, {}, msg);
      throw e;
    }
  }

  if (plan.needs_memory) {
    const s4 = await stageStart(job, "memory_cards_from_sections");
    try {
      const memoryCards = await upsertMemoryCardsFromSections(job);
      await stageFinish(s4, true, { memory_cards: memoryCards });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(s4, false, {}, msg);
      throw e;
    }
  }
  if (plan.needs_labels) {
    const s5 = await stageStart(job, "generated_labels_from_parsed_artifacts");
    try {
      const labels = await upsertGeneratedLabelsFromParsedArtifacts(job);
      await stageFinish(s5, true, { generated_labels: labels });
      gate = await completionGate(job);
      plan = missingArtifactPlan(gate);
      logArtifactPlan(job, gate, plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      await stageFinish(s5, false, {}, msg);
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
    // Claiming jobs mutates the queue, so a GET must not reach it (audit L13).
    if (!isAllowedAgentMethod(req.method)) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    const unauthorized = await authorizeRequest(req);
    if (unauthorized) return unauthorized;

    const url = new URL(req.url);
    const limit = parseAgentClaimLimit(url.searchParams.get("limit"));
    const workerId = `indexing-v3-agent-${crypto.randomUUID()}`;

    const claimSource = "documents";
    const claimed = await sql<ClaimedJob[]>`
      select * from public.claim_indexing_v3_agent_jobs(${workerId}::text, ${limit}::integer, 45::integer)
    `;

    if (claimed.length === 0) {
      return Response.json({ ok: true, claimed: 0, processed: 0, failed: 0 });
    }

    // Both the per-job work and the per-job failure recording are isolated in
    // here: markJobFailure throws on an ok:false status RPC or a DB error, and
    // when that throw escaped the loop it returned 500 and left every
    // not-yet-processed sibling `processing` under its lock until the
    // 45-minute stale reclaim (audit L13).
    const batch = await runClaimedJobBatch(claimed, {
      processJob,
      markJobFailure: (job, message) => markJobFailure(job, message),
    });

    return Response.json({
      ok: true,
      worker: workerId,
      claim_source: claimSource,
      claimed: claimed.length,
      processed: batch.processed,
      deferred: batch.deferred,
      failed: batch.failed,
      deferrals: batch.deferrals.map((entry) => ({
        job_id: entry.job.id,
        document_id: entry.job.document_id,
        missing: entry.missing,
      })),
      failures: batch.failures.map((entry) => ({
        job_id: entry.job.id,
        document_id: entry.job.document_id,
        error: entry.error,
        failure_record_error: entry.failure_record_error,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : JSON.stringify(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
