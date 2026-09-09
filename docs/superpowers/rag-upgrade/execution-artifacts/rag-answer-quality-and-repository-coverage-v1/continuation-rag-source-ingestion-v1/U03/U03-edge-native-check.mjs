import { spawn, execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = "C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database";
const out = "C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation";
const attempt = process.argv[2];
if (!/^[1-9][0-9]*$/.test(attempt ?? "")) throw new Error("Explicit positive attempt number required.");
const resultPath = resolve(out, `U03-edge-native-result-${attempt}.json`);
if (existsSync(resultPath)) throw new Error("Preserve prior result; choose a new attempt number.");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const key = path => resolve(path).replaceAll("\\", "/").toLowerCase();
const inRoot = path => key(path).startsWith(key(realpathSync(root)) + "/");
// Complete local executable closure of the two imported helpers; all other imports are Node builtins.
const helperPins = {
  "scripts/test-run-lock.mjs": "a0ff442d91baa98742b78601b39892e5c19cfbdf46b30e8b19662e83e20b9caf",
  "scripts/test-environment.mjs": "c3ca8fa0a471c2c67020852acbc3e673aa82b67ccc4d7a60d5bfa216af481b1a",
  "scripts/retryable-fs.mjs": "48ad1f5de8b41d49501c6713c883022bd1e4dcc6971be8a5a56efefb33f828cc",
  "scripts/sensitive-text.mjs": "4ac54d7b38bff823ba5eb5d18bbb6642fcb6dfa583f6e5983e628bae35c294f6",
};
const verifyHelpers = () => {
  for (const [name, digest] of Object.entries(helperPins)) {
    const path = resolve(root, name);
    const actual = realpathSync(path);
    const canonicalExpected = resolve(realpathSync(root), name);
    if (key(actual) !== key(canonicalExpected) || !inRoot(actual)) throw new Error(`Helper canonical path changed: ${name}`);
    if (hash(readFileSync(actual)) !== digest) throw new Error(`Reviewed helper changed before execution: ${name}`);
  }
};
if (process.env.DENO_NO_PACKAGE_JSON !== "1" || process.env.GATE_RECEIPTS !== "off" || process.env.GATE_ARBITER !== "off") throw new Error("Reviewed process-local settings missing.");
const manifestPath = resolve(out, `U03-edge-reviewed-inputs-${attempt}.json`);
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
if (manifest.version !== "u03-edge-inputs-v1" || !Array.isArray(manifest.files) || !manifest.files.length || typeof manifest.reviewReference !== "string" || !manifest.reviewReference) throw new Error("Complete controller-reviewed closure manifest required.");
if (git(["rev-parse", "HEAD"]).trim() !== manifest.sourceBase || git(["branch", "--show-current"]).trim() !== "codex/rag-local-build-20260822") throw new Error("Frozen source base/branch changed.");
const required = ["supabase/functions/indexing-v3-agent/index.ts", "supabase/functions/site-content-sync/index.ts", "supabase/functions/_shared/ingestion-attempt.ts", "package.json"];
const names = new Set();
const expected = new Map();
for (const input of manifest.files) {
  const p = input.path;
  if (typeof p !== "string" || isAbsolute(p) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Invalid frozen input.");
  const relativePath = relative(root, resolve(root, p)).replaceAll("\\", "/");
  if (!relativePath || relativePath.startsWith("../") || isAbsolute(relativePath) || /^(?:1|protected1)(?:\/|$)/i.test(relativePath)) throw new Error("Input outside allowed repository scope.");
  if (names.has(relativePath)) throw new Error("Duplicate input.");
  names.add(relativePath);
  const actual = realpathSync(resolve(root, p));
  if (!inRoot(actual) || /(?:^|\/)(?:1|protected1)(?:\/|$)/i.test(relative(realpathSync(root), actual).replaceAll("\\", "/"))) throw new Error("Input resolved outside approved scope.");
  expected.set(resolve(root, p), input.sha256);
}
for (const path of required) if (!names.has(path)) throw new Error(`Required closure input missing: ${path}`);
const map = resolve(out, "U02-edge-native.importmap.json");
const lockPath = resolve(out, "U02-edge-native-composite-v2.deno.lock");
expected.set(resolve(root, "deno.lock"), "b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9");
expected.set(resolve(root, "package-lock.json"), "f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063");
expected.set(lockPath, "6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6");
expected.set(map, "be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93");
for (const [name, digest] of Object.entries(helperPins)) expected.set(resolve(root, name), digest);
const identity = () => Object.fromEntries([...expected.keys()].map(path => [path, hash(readFileSync(path))]));
const args = ["check", "--frozen", "--node-modules-dir=false", `--lock=${lockPath}`, `--import-map=${map}`, ...required.slice(0, 2)];
verifyHelpers(); // No repository code is imported until every executable helper dependency is pinned.
const { acquireHeavyRunLock } = await import(pathToFileURL(resolve(root, "scripts/test-run-lock.mjs")).href);
const { offlineTestEnvironment } = await import(pathToFileURL(resolve(root, "scripts/test-environment.mjs")).href);
verifyHelpers();
const lease = acquireHeavyRunLock({ projectRoot: root, command: `deno ${args.join(" ")}`, mode: "exclusive" });
let before;
let exitCode = 1;
let denoVersion;
try {
  before = identity();
  for (const [path, digest] of expected) if (before[path] !== digest) throw new Error(`Frozen input changed: ${path}`);
  const environment = offlineTestEnvironment(lease.environment, { DENO_NO_PACKAGE_JSON: "1" });
  denoVersion = execFileSync("deno", ["--version"], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!/^deno 2\.9\.4(?:\s|$)/.test(denoVersion)) throw new Error("Reviewed Deno version changed.");
  exitCode = await new Promise((accept, reject) => {
    const child = spawn("deno", args, { cwd: root, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => accept(signal ? 1 : code ?? 1));
  });
} finally {
  try {
    verifyHelpers();
    const after = identity();
    const unchanged = before !== undefined && JSON.stringify(before) === JSON.stringify(after) && hash(readFileSync(manifestPath)) === hash(manifestBytes);
    writeFileSync(resultPath, JSON.stringify({ kind: "two-root native Edge compilation equivalent", command: ["deno", ...args], denoVersion, manifestSha256: hash(manifestBytes), sourceBase: manifest.sourceBase, helperPins, before, after, unchanged, exitCode }, null, 2) + "\n", { flag: "wx" });
    if (!unchanged) throw new Error("Frozen inputs changed during compilation.");
    process.exitCode = exitCode;
  } finally { lease.release(); }
}
