import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type UnleasedOperatorRequest =
  | { command: "index:backfill"; write: boolean }
  | { command: "enrich:documents" }
  | { command: "enrich:backfill"; dryRun: boolean };

function attemptRequired(): Error & { code: "ingestion_attempt_required" } {
  return Object.assign(
    new Error(
      "ingestion_attempt_required: this operation requires a current durable ingestion attempt; the U13 adapter is not available",
    ),
    { code: "ingestion_attempt_required" as const },
  );
}

export function assertUnleasedOperatorModeAllowed(request: UnleasedOperatorRequest): void {
  if (request.command === "index:backfill" && request.write === false) return;
  if (request.command === "enrich:backfill" && request.dryRun === true) return;
  throw attemptRequired();
}

/** Keeps retired unleased call sites explicitly unavailable without fabricating a Fence. */
export async function unavailableUnleasedIngestionOperation<T>(): Promise<T> {
  throw attemptRequired();
}

export function isDirectScriptInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return resolve(fileURLToPath(moduleUrl)) === resolve(argvPath);
  } catch {
    return false;
  }
}
