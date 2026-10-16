/** Durable ingestion authority. This module is import-pure in Node and Deno. */
export type IngestionFence = Readonly<{
  job_kind: "node" | "indexing_v3";
  job_id: string;
  document_id: string;
  worker_id: string;
  lease_token: string;
  expected_generation_id: string | null;
  authority_digest: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
export class IngestionAttemptError extends Error {
  constructor(
    readonly code:
      | "lease_lost"
      | "completion_gate_blocked"
      | "ingestion_rpc_invalid"
      | "ingestion_attempt_required"
      | "technical_supplier_not_implemented",
  ) {
    super(code);
    this.name = "IngestionAttemptError";
  }
}
/** An RPC failure is fatal persistence uncertainty, not an optional model failure. */
export class IngestionPersistenceError extends IngestionAttemptError {
  constructor(cause: unknown) {
    super("ingestion_rpc_invalid");
    this.name = "IngestionPersistenceError";
    this.message = cause instanceof Error ? cause.message : String(cause);
    this.cause = cause;
  }
}
export async function runIngestionPersistence(
  request: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) {
  try {
    const { data, error } = await request();
    if (error) throw new Error(error.message);
    return parseIngestionMutationResult(data);
  } catch (error) {
    if (error instanceof IngestionAttemptError) throw error;
    throw new IngestionPersistenceError(error);
  }
}
export function parseIngestionFence(value: unknown): IngestionFence {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new IngestionAttemptError("ingestion_attempt_required");
  const row = value as Record<string, unknown>;
  if (
    (row.job_kind !== "node" && row.job_kind !== "indexing_v3") ||
    ![row.job_id, row.document_id, row.lease_token].every((id) => typeof id === "string" && UUID.test(id)) ||
    typeof row.worker_id !== "string" ||
    !row.worker_id.trim() ||
    typeof row.authority_digest !== "string" ||
    !DIGEST.test(row.authority_digest) ||
    !(
      row.expected_generation_id === null ||
      (typeof row.expected_generation_id === "string" && UUID.test(row.expected_generation_id))
    ) ||
    (row.job_kind === "indexing_v3" && row.expected_generation_id === null)
  ) {
    throw new IngestionAttemptError("ingestion_attempt_required");
  }
  return Object.freeze({
    job_kind: row.job_kind,
    job_id: row.job_id as string,
    document_id: row.document_id as string,
    worker_id: row.worker_id,
    lease_token: row.lease_token as string,
    expected_generation_id: row.expected_generation_id,
    authority_digest: row.authority_digest,
  });
}
export function parseIngestionMutationResult(value: unknown): Record<string, unknown> & { ok: true } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  const row = value as Record<string, unknown>;
  if (row.ok === false && row.reason === "lease_lost" && Object.keys(row).length === 2)
    throw new IngestionAttemptError("lease_lost");
  if (row.ok === false && row.reason === "completion_gate_blocked")
    throw new IngestionAttemptError("completion_gate_blocked");
  if (row.ok === false && row.reason === "technical_supplier_not_implemented" && Object.keys(row).length === 2)
    throw new IngestionAttemptError("technical_supplier_not_implemented");
  if (row.ok !== true || Object.hasOwn(row, "reason")) throw new IngestionAttemptError("ingestion_rpc_invalid");
  return { ...row, ok: true };
}
/** One monotonic state per claim, shared by every stage and provider boundary. */
export class IngestionAttempt {
  private readonly controller = new AbortController();
  private current: IngestionFence;
  private dispatchTail: Promise<void> = Promise.resolve();
  constructor(fence: IngestionFence) {
    this.current = parseIngestionFence(fence);
  }
  /** Drain in-flight requests through the handoff response; capture authority only inside work. */
  serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.dispatchTail.then(() => {
      this.check();
      return work();
    });
    this.dispatchTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  get fence() {
    this.check();
    return this.current;
  }
  get signal() {
    return this.controller.signal;
  }
  cancel() {
    this.controller.abort(new IngestionAttemptError("lease_lost"));
  }
  check() {
    if (this.signal.aborted) throw new IngestionAttemptError("lease_lost");
  }
  accept(value: unknown) {
    this.check();
    try {
      return parseIngestionMutationResult(value);
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  handoff(value: unknown, reservedGeneration: unknown) {
    const result = this.accept(value);
    let next: IngestionFence;
    try {
      next = parseIngestionFence(result.fence);
    } catch {
      this.cancel();
      throw new IngestionAttemptError("ingestion_rpc_invalid");
    }
    const old = this.current;
    if (
      next.job_kind !== old.job_kind ||
      next.job_id !== old.job_id ||
      next.document_id !== old.document_id ||
      next.worker_id !== old.worker_id ||
      next.lease_token !== old.lease_token ||
      next.authority_digest !== old.authority_digest ||
      next.expected_generation_id === null ||
      next.expected_generation_id !== reservedGeneration
    ) {
      this.cancel();
      throw new IngestionAttemptError("ingestion_rpc_invalid");
    }
    this.current = next;
    return result;
  }
}
