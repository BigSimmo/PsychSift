// Namespace import + runtime pick (same pattern as scripts/classify-documents.ts):
// @next/env is CJS whose named exports Node's ESM lexer can't detect, so a
// named import crashes the esbuild-bundled worker at container boot.
import * as nextEnv from "@next/env";

const loadEnvConfig =
  nextEnv.loadEnvConfig ??
  (nextEnv as unknown as { default?: { loadEnvConfig?: typeof nextEnv.loadEnvConfig } }).default?.loadEnvConfig;

if (!loadEnvConfig) throw new Error("Unable to load @next/env loadEnvConfig.");
loadEnvConfig(process.cwd());

import { safeErrorLogDetails } from "../src/lib/privacy";
import { captureWorkerException, flushWorkerErrorTracking, initWorkerErrorTracking } from "./observability";

// Initialize before ./main is imported so module-level failures there are
// reported too. Inert without SENTRY_DSN (docs/error-tracking.md).
initWorkerErrorTracking();

async function startWorker() {
  const { runWorkerMain } = await import("./main");
  await runWorkerMain();
}

startWorker().catch(async (error) => {
  console.error("Worker bootstrap failed", safeErrorLogDetails(error));
  captureWorkerException(error, "fatal");
  await flushWorkerErrorTracking();
  process.exit(1);
});
