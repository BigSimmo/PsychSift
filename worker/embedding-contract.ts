/**
 * Build-baked compatibility with the existing corpus. Equal vector dimensions do not
 * make different embedding models compatible. Changing this contract requires an
 * explicitly governed corpus migration; the offline schema test ratchets the dimension.
 * Importing this constant also makes a missing contract a build/startup failure.
 */
export const WORKER_EMBEDDING_CONTRACT = Object.freeze({
  model: "text-embedding-3-small",
  dimensions: 1536,
});

class WorkerEmbeddingContractError extends Error {
  readonly code = "worker_embedding_contract_mismatch";

  constructor() {
    super("worker_embedding_contract_mismatch");
    this.name = "WorkerEmbeddingContractError";
  }
}

export function assertWorkerEmbeddingCompatibility(configuration: { model: string; dimensions: number }): void {
  if (
    configuration.model !== WORKER_EMBEDDING_CONTRACT.model ||
    configuration.dimensions !== WORKER_EMBEDDING_CONTRACT.dimensions
  ) {
    throw new WorkerEmbeddingContractError();
  }
}
