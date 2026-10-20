#!/usr/bin/env node
/**
 * app-container-smoke — run the built app image provider-free and verify:
 *   - /api/health returns HTTP 200 with status: ok, openaiConfig: skipped,
 *     supabaseConfig: ok
 *   - PID 1 is the Next production server (`next start` argv, or Next 16's
 *     rewritten `next-server (v…)` process title after boot)
 *   - container stops cleanly within a bounded timeout
 * Pass --read-only to exercise the same startup and checks with a read-only root.
 */
import { spawnSync } from "node:child_process";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const READ_ONLY = process.argv.includes("--read-only");
const IMAGE_REF = process.argv.slice(2).find((arg) => arg !== "--read-only") ?? "clinical-kb-app:ci";
const CONTAINER_NAME = READ_ONLY ? "clinical-kb-app-smoke-readonly" : "clinical-kb-app-smoke";
const STOP_TIMEOUT_SECONDS = 30;

function run(args, opts = {}) {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", stdio: "pipe", ...opts });
  return result;
}

function cleanContainer() {
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { encoding: "utf8" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function appHealthProbe(healthUrl) {
  return `fetch(${JSON.stringify(healthUrl)}, {signal: AbortSignal.timeout(5000)}).then(async (r)=>{if(r.status!==200)throw new Error('Expected HTTP 200, got '+r.status);const j=await r.json();if(!j||typeof j!=='object'||Array.isArray(j))throw new Error('Invalid health JSON');console.log(JSON.stringify(j));}).catch((e)=>{console.error(e.message);process.exit(1);})`;
}

async function waitForHealth(port = 3000, attempts = 30) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  let lastError = "No successful health response";
  for (let i = 0; i < attempts; i += 1) {
    const result = run(["docker", "exec", CONTAINER_NAME, "node", "-e", appHealthProbe(healthUrl)]);
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        lastError = "Health probe returned invalid JSON";
      }
    } else {
      lastError = result.stderr?.trim() || result.error?.message || `docker exec exited ${result.status}`;
    }
    await sleep(1000);
  }
  console.error("Health readiness probe failed:", lastError);
  return null;
}

async function main() {
  cleanContainer();

  const runResult = run([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "--network=none",
    ...(READ_ONLY ? ["--read-only"] : []),
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "-e",
    "NODE_ENV=production",
    "-e",
    "NEXT_PUBLIC_DEMO_MODE=false",
    "-e",
    "NEXT_PUBLIC_SUPABASE_URL=https://sjrfecxgysukkwxsowpy.supabase.co",
    "-e",
    "SUPABASE_SERVICE_ROLE_KEY=smoke-test-placeholder",
    "-e",
    "SUPABASE_PROJECT_REF=sjrfecxgysukkwxsowpy",
    "-e",
    "SUPABASE_PROJECT_NAME=PsychSift Production",
    // Production instrumentation refuses to boot without a keyed query-hash
    // secret (min 16 chars). Placeholder is provider-free and CI-only.
    "-e",
    "RAG_QUERY_HASH_SECRET=smoke-test-hash-secret",
    "-e",
    "RAG_PROVIDER_MODE=offline",
    "-e",
    "NEXT_TELEMETRY_DISABLED=1",
    IMAGE_REF,
  ]);

  if (runResult.status !== 0) {
    console.error("docker run failed", runResult.stderr);
    process.exit(1);
  }

  const health = await waitForHealth();
  if (!health) {
    console.error("App health endpoint did not become ready in time");
    const logs = run(["docker", "logs", "--tail", "80", CONTAINER_NAME]);
    if (logs.stdout) console.error(logs.stdout);
    if (logs.stderr) console.error(logs.stderr);
    cleanContainer();
    process.exit(1);
  }

  if (health.status !== "ok") {
    console.error("App health status not ok:", JSON.stringify(health, null, 2));
    cleanContainer();
    process.exit(1);
  }
  if (health.checks?.openaiConfig !== "skipped") {
    console.error("Expected openaiConfig=skipped, got:", health.checks?.openaiConfig);
    cleanContainer();
    process.exit(1);
  }
  if (health.checks?.supabaseConfig !== "ok") {
    console.error("Expected supabaseConfig=ok, got:", health.checks?.supabaseConfig);
    cleanContainer();
    process.exit(1);
  }
  if (health.demoMode !== false) {
    console.error("Expected demoMode=false in production, got:", health.demoMode);
    cleanContainer();
    process.exit(1);
  }

  const psResult = run([
    "docker",
    "exec",
    CONTAINER_NAME,
    "node",
    "-e",
    "console.log(require('fs').readFileSync('/proc/1/cmdline','utf8').replace(/\\u0000/g,' ').trim())",
  ]);
  const pid1 = psResult.stdout?.trim() ?? "";
  // Next 16 rewrites the process title to `next-server (vX.Y.Z)` after
  // `next start` boots; accept either form so smoke tracks the live server.
  const pid1LooksLikeNextServer = pid1.includes("next start") || /\bnext-server\b/.test(pid1);
  if (!pid1LooksLikeNextServer) {
    console.error("PID 1 is not the expected Next production server:", pid1);
    const logs = run(["docker", "logs", "--tail", "80", CONTAINER_NAME]);
    if (logs.stdout) console.error(logs.stdout);
    if (logs.stderr) console.error(logs.stderr);
    cleanContainer();
    process.exit(1);
  }

  const stopResult = run(["docker", "stop", "-t", String(STOP_TIMEOUT_SECONDS), CONTAINER_NAME]);
  if (stopResult.status !== 0) {
    console.error("docker stop failed:", stopResult.stderr || stopResult.stdout);
    cleanContainer();
    process.exit(1);
  }

  const inspectResult = run([
    "docker",
    "inspect",
    "--format",
    "{{.State.Running}} {{.State.OOMKilled}} {{.State.ExitCode}}",
    CONTAINER_NAME,
  ]);
  const state = /^(true|false) (true|false) (0|[1-9]\d{0,2})$/.exec(inspectResult.stdout?.trim() ?? "");
  if (inspectResult.status !== 0 || inspectResult.signal || inspectResult.error || !state || Number(state[3]) > 255) {
    console.error(
      "Container stop state could not be verified:",
      inspectResult.stderr ||
        inspectResult.error?.message ||
        inspectResult.stdout ||
        `docker inspect exited ${inspectResult.status}, signal ${inspectResult.signal}`,
    );
    cleanContainer();
    process.exit(1);
  }
  const [, running, oom, exitCode] = state;

  if (running === "true") {
    console.error("Container still running after docker stop");
    cleanContainer();
    process.exit(1);
  }
  if (oom === "true") {
    console.error("Container was OOMKilled");
    cleanContainer();
    process.exit(1);
  }
  // 137 = SIGKILL (128+9). Graceful STOPSIGNAL SIGTERM must not escalate.
  if (exitCode === "137") {
    console.error("Container exited 137 (SIGKILL) — graceful stop timed out");
    cleanContainer();
    process.exit(1);
  }
  // A clean exit or ordinary SIGTERM termination is expected after docker stop.
  // An application crash during shutdown must not become a successful smoke.
  if (exitCode !== "0" && exitCode !== "143") {
    console.error("Container shutdown failed with unexpected exit code:", exitCode);
    cleanContainer();
    process.exit(1);
  }

  console.log(`App smoke passed. PID 1: ${pid1}. Exit code: ${exitCode}. Health:`, JSON.stringify(health, null, 2));
  cleanContainer();
  process.exit(0);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    cleanContainer();
    process.exit(1);
  });
}
