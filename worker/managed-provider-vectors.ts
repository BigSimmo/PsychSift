import {
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseIssuedAttemptControl,
  type GenerationArtifactInput,
  type GenerationEvidenceUnitId,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import { prepareManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import { PREPARED_SUPPLIER_READBACK_MAX_BYTES } from "./whole-original-supplier";

export type ManagedProviderVectorRow = {
  family: "chunks" | "embedding_fields" | "index_units";
  groupKey: "worker_core";
  preparedUnitId: GenerationEvidenceUnitId;
  preparedArtifact: GenerationArtifactInput;
  body: Record<string, unknown> & { id: string; embedding: number[] };
};
/** Ordered source batch from the validated plan before provider deduplication and batching. */
export type ManagedProviderEmbeddingBatchContext = Readonly<{
  planDigest: string;
  units: readonly Readonly<{ unitId: GenerationEvidenceUnitId; providerInputText: string }>[];
}>;
/** Provenance for one serialized SDK request, after its deduplication and batching. */
export type ManagedProviderEmbeddingRequestContext = Readonly<{
  planDigest: string;
  inputs: readonly Readonly<{ providerInputText: string; sourceUnitIds: readonly GenerationEvidenceUnitId[] }>[];
}>;
function refuse(reason: string): never {
  throw new Error(`managed_provider_vectors_${reason}`);
}
function snapshot<T>(value: T): T {
  return JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;
}
function vector(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 1536 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  )
    refuse("invalid_vector");
  return value as number[];
}

export function assertManagedProviderEmbeddingBatch(
  context: ManagedProviderEmbeddingBatchContext,
  expectedPlanDigest: string,
  texts: readonly string[],
): void {
  if (context.planDigest !== expectedPlanDigest) refuse("embedding_plan_digest_mismatch");
  if (
    !Array.isArray(texts) ||
    context.units.length !== texts.length ||
    context.units.some((unit, index) => unit.providerInputText !== texts[index])
  )
    refuse("embedding_batch_mismatch");
}

export function deriveManagedProviderEmbeddingRequestContext(args: {
  producer: ManagedProviderEmbeddingBatchContext;
  expectedPlanDigest: string;
  request: { purpose: string; payload: string | Uint8Array };
  batchSize: number;
  expectedModel: string;
  expectedDimensions: number;
}): ManagedProviderEmbeddingRequestContext {
  const { producer, expectedPlanDigest, request, batchSize } = args;
  if (producer.planDigest !== expectedPlanDigest) refuse("embedding_plan_digest_mismatch");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) refuse("embedding_batch_size_invalid");
  if (request.purpose !== "embedding") refuse("embedding_request_purpose_mismatch");
  const payloadBytes = typeof request.payload === "string" ? Buffer.from(request.payload, "utf8") : Buffer.from(request.payload);
  const payloadText = payloadBytes.toString("utf8");
  if (Buffer.from(payloadText, "utf8").compare(payloadBytes) !== 0) refuse("embedding_request_format_mismatch");
  let body: unknown;
  try {
    body = JSON.parse(payloadText);
  } catch {
    refuse("embedding_request_format_mismatch");
  }
  if (
    JSON.stringify(body) !== payloadText ||
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { input?: unknown }).input) ||
    !(body as { input: unknown[] }).input.every((input) => typeof input === "string")
  )
    refuse("embedding_request_format_mismatch");
  const actual = (body as { input: string[] }).input;
  if (
    (body as { model?: unknown }).model !== args.expectedModel ||
    (body as { dimensions?: unknown }).dimensions !== args.expectedDimensions
  )
    refuse("embedding_request_model_mismatch");
  const byText = new Map<string, GenerationEvidenceUnitId[]>();
  for (const unit of producer.units) {
    const ids = byText.get(unit.providerInputText) ?? [];
    ids.push(unit.unitId);
    byText.set(unit.providerInputText, ids);
  }
  const unique = [...byText.keys()];
  const matching = Array.from({ length: Math.ceil(unique.length / batchSize) }, (_, index) =>
    unique.slice(index * batchSize, (index + 1) * batchSize),
  ).some((expected) => expected.length === actual.length && expected.every((text, index) => text === actual[index]));
  if (!matching) refuse("embedding_request_batch_mismatch");
  return Object.freeze({
    planDigest: producer.planDigest,
    inputs: Object.freeze(
      actual.map((providerInputText) =>
        Object.freeze({
          providerInputText,
          sourceUnitIds: Object.freeze(byText.get(providerInputText)!.map((id) => Object.freeze(snapshot(id)))),
        }),
      ),
    ),
  });
}

/** Produces owned, unpersisted candidate rows only. The parent supplies the actual fenced provider call. */
export async function produceManagedProviderVectors(args: {
  input: ManagedPreparedSupplierInput;
  expectedPlanDigest: string;
  issued: IssuedAttemptControl;
  batchSize: number;
  embed: (texts: string[], context: ManagedProviderEmbeddingBatchContext) => Promise<number[][]>;
  assertEmbedding: (embedding: number[], context: string) => number[];
  check: () => void;
}) {
  const { check, embed, assertEmbedding } = args;
  if (!Number.isSafeInteger(args.batchSize) || args.batchSize < 1) refuse("invalid_batch_size");
  const batchSize = Math.min(args.batchSize, 500);
  const issued = snapshot(parseIssuedAttemptControl(args.issued));
  const expectedPlanDigest = args.expectedPlanDigest;
  check();
  // Reuse the actual producer's complete input/body validation rather than accepting a caller-built plan.
  const plan = prepareManagedPrivateSupplier(args.input);
  const assertCurrent = () => {
    check();
    if (
      generationEvidenceDigest(parseIssuedAttemptControl(args.issued)) !== generationEvidenceDigest(issued) ||
      args.expectedPlanDigest !== expectedPlanDigest ||
      generationEvidenceDigest(plan.issued) !== generationEvidenceDigest(issued)
    )
      refuse("issued_identity_mismatch");
    if (plan.digest !== expectedPlanDigest || prepareManagedPrivateSupplier(args.input).digest !== expectedPlanDigest)
      refuse("prepared_input_changed");
  };
  assertCurrent();
  const selected = plan.producerManifests
    .flatMap((manifest) => manifest.units)
    .filter(
      (unit) =>
        unit.declaration.groupKey === "worker_core" &&
        ["chunks", "embedding_fields", "index_units"].includes(unit.declaration.id.family) &&
        unit.providerInputText !== null,
    );
  if (selected.reduce((bytes, unit) => bytes + Buffer.byteLength(unit.providerInputText!, "utf8"), 0) > 2 * 1024 * 1024)
    refuse("input_budget_exceeded");
  const rows: ManagedProviderVectorRow[] = [];
  let outputBytes = generationEvidenceBytes({ planDigest: plan.digest, issued, rows: [] }).length;
  for (let start = 0; start < selected.length; start += batchSize) {
    const batch = selected.slice(start, start + batchSize);
    const texts = batch.map((unit) => unit.providerInputText!);
    const textDigest = generationEvidenceDigest(texts);
    const batchContext: ManagedProviderEmbeddingBatchContext = Object.freeze({
      planDigest: plan.digest,
      units: Object.freeze(
        batch.map((unit) =>
          Object.freeze({
            unitId: Object.freeze(snapshot(unit.declaration.id)),
            providerInputText: unit.providerInputText!,
          }),
        ),
      ),
    });
    assertCurrent();
    assertManagedProviderEmbeddingBatch(batchContext, expectedPlanDigest, texts);
    const supplied = await embed(texts, batchContext);
    assertCurrent();
    assertManagedProviderEmbeddingBatch(batchContext, expectedPlanDigest, texts);
    if (generationEvidenceDigest(texts) !== textDigest) refuse("provider_inputs_changed");
    const embeddings = snapshot(supplied);
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length) refuse("vector_count_mismatch");
    for (const [index, unit] of batch.entries()) {
      const owned = vector(embeddings[index]).slice();
      const embeddingDigest = generationEvidenceDigest(owned);
      const checked = snapshot(assertEmbedding(owned, `${unit.declaration.id.family}.${unit.declaration.id.key}`));
      if (generationEvidenceDigest(vector(checked)) !== embeddingDigest) refuse("embedding_checker_changed_vector");
      const body = snapshot(unit.body) as Record<string, unknown>;
      const row: ManagedProviderVectorRow = {
        family: unit.declaration.id.family as ManagedProviderVectorRow["family"],
        groupKey: "worker_core",
        preparedUnitId: snapshot(unit.declaration.id),
        preparedArtifact: snapshot(unit.artifact),
        body: { ...body, id: unit.declaration.id.key, embedding: vector(checked).slice() },
      };
      outputBytes += generationEvidenceBytes(row).length + 1;
      if (outputBytes > PREPARED_SUPPLIER_READBACK_MAX_BYTES) refuse("output_budget_exceeded");
      rows.push(row);
    }
    assertCurrent();
  }
  assertCurrent();
  // No rows escape on failed batches, cancellation, changed inputs or failed dimension validation.
  return freezeGenerationEvidence({ planDigest: plan.digest, issued, rows });
}
