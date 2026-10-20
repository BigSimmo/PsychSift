#!/usr/bin/env node
/**
 * app-container-smoke — run the built app image read-only/provider-free and verify:
 *   - /api/health returns HTTP 200 with status: ok, openaiConfig: skipped,
 *     supabaseConfig: ok
 *   - PID 1 is the Next production server (`next start` argv, or Next 16's
 *     rewritten `next-server (v…)` process title after boot)
 *   - container stops cleanly within a bounded timeout
 */
import { spawnSync } from "node:child_process";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const IMAGE_REF = process.argv[2] ?? "clinical-kb-app:ci";
const CONTAINER_NAME = "clinical-kb-app-smoke";
const STOP_TIMEOUT_SECONDS = 30;

export function isCleanContainerExit(result) {
  if (result.status !== 0 || result.error || result.signal || typeof result.stdout !== "string") return false;
  const fields = result.stdout.trim().split(/\s+/);
  // Docker stop sends SIGTERM; Node/Next can report 128 + SIGTERM (143).
  // A SIGKILL (137), crash, or incomplete inspection is not clean shutdown.
  return fields.length === 3 && fields[0] === "false" && fields[1] === "false" && ["0", "143"].includes(fields[2]);
}

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

async function waitForHealth(port = 3000, attempts = 30) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  for (let i = 0; i < attempts; i += 1) {
    const result = run([
      "docker",
      "exec",
      CONTAINER_NAME,
      "node",
      "-e",
      `fetch("${healthUrl}").then((r)=>r.json()).then((j)=>{console.log(JSON.stringify(j));process.exit(0);}).catch((e)=>{console.error(e.message);process.exit(1);})`,
    ]);
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        /* not ready yet */
      }
    }
    await sleep(1000);
  }
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
    "--read-only",
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
  if (!isCleanContainerExit(inspectResult)) {
    console.error(
      "Container shutdown inspection failed or reported an abnormal exit:",
      inspectResult.stderr || inspectResult.stdout,
    );
    cleanContainer();
    process.exit(1);
  }
  const exitCode = inspectResult.stdout.trim().split(/\s+/)[2];

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
