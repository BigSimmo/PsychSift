import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { acquireHeavyRunLock } from "file:///C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database/scripts/test-run-lock.mjs";

const projectRoot = "C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database";
const evidenceRoot = "C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation";
const mapPath = `${evidenceRoot}/U02-edge-native.importmap.json`;
const compositePath = `${evidenceRoot}/U02-edge-native-composite-v2.deno.lock`;
const args = ["check", "--frozen", "--node-modules-dir=false", `--lock=${compositePath}`, `--import-map=${mapPath}`, "supabase/functions/indexing-v3-agent/index.ts", "supabase/functions/site-content-sync/index.ts"];
const expected = {
  [`${projectRoot}/deno.lock`]: "b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9",
  [`${projectRoot}/package-lock.json`]: "f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063",
  [compositePath]: "6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6",
  [mapPath]: "be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93",
  [`${projectRoot}/supabase/functions/_shared/source-anchored-summary.ts`]: "a2fdb6b4f4dd6e7f3a692c822a2a9c99439d1db2c4a58a664f42cd8f253e97f2",
  [`${projectRoot}/tests/document-enrichment.test.ts`]: "56aa59c3906d9aada65a7cc93f0088738feaf24af8c567248f26a2ee811e8fad",
};
const identity = () => Object.fromEntries(Object.keys(expected).map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
function run(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn("deno", args, { cwd: projectRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}
if (process.env.DENO_NO_PACKAGE_JSON !== "1") throw new Error("Required process-local package-discovery override missing");
console.log(`COMMAND=deno ${args.join(" ")}`);
console.log("DENO_NO_PACKAGE_JSON=1 (process-local)");
const lock = acquireHeavyRunLock({ projectRoot, command: `deno ${args.join(" ")}`, mode: "exclusive" });
console.log("COORDINATOR=exclusive lease acquired");
let before;
try {
  before = identity();
  console.log(`HASHES_BEFORE=${JSON.stringify(before)}`);
  for (const [file, digest] of Object.entries(expected)) if (before[file] !== digest) throw new Error(`Reviewed identity mismatch: ${file}`);
  await run(["--version"], lock.environment);
  const code = await run(args, lock.environment);
  console.log(`DENO_EXIT_CODE=${code}`);
  process.exitCode = code;
} finally {
  const after = identity();
  console.log(`HASHES_AFTER=${JSON.stringify(after)}`);
  lock.release();
  console.log("COORDINATOR=exclusive lease released");
  if (before && JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Product/lock/map identity changed");
  console.log("IDENTITIES_UNCHANGED=true");
}

