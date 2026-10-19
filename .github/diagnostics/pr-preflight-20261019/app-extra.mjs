import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const image = "clinical-kb-app:ci";
const name = "psychsift-pr-app-port";
const run = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 });
try {
  run([
    "run",
    "-d",
    "--name",
    name,
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "-e",
    "PORT=4019",
    "-e",
    "NODE_ENV=production",
    "-e",
    "NEXT_PUBLIC_DEMO_MODE=false",
    "-e",
    "NEXT_PUBLIC_SUPABASE_URL=https://sjrfecxgysukkwxsowpy.supabase.co",
    "-e",
    "SUPABASE_PROJECT_REF=sjrfecxgysukkwxsowpy",
    "-e",
    "SUPABASE_PROJECT_NAME=PsychSift Production",
    "-e",
    "SUPABASE_SERVICE_ROLE_KEY=smoke-test-placeholder",
    "-e",
    "RAG_QUERY_HASH_SECRET=smoke-test-hash-secret",
    "-e",
    "RAG_PROVIDER_MODE=offline",
    "-e",
    "NEXT_TELEMETRY_DISABLED=1",
    image,
  ]);
  let ok = false;
  for (let i = 0; i < 45; i++) {
    try {
      run([
        "exec",
        name,
        "node",
        "-e",
        "fetch('http://127.0.0.1:4019/api/health').then(async r=>{const j=await r.json();if(!r.ok||j.status!=='ok'||j.checks?.openaiConfig!=='skipped'||j.checks?.supabaseConfig!=='ok'||j.demoMode!==false)throw Error(JSON.stringify(j));console.log(JSON.stringify(j))}).catch(e=>{console.error(e);process.exit(1)})",
      ]);
      ok = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  assert.ok(ok, "actual app must serve health on nondefault PORT=4019");
  const info = JSON.parse(run(["inspect", name]))[0];
  assert.equal(info.HostConfig.NetworkMode, "none");
  const command = info.Config.Healthcheck.Test;
  assert.equal(command[0], "CMD");
  run(["exec", name, ...command.slice(1)]);
  const ssr = run([
    "exec",
    name,
    "node",
    "-e",
    "fetch('http://127.0.0.1:4019/',{redirect:'manual'}).then(async r=>{const h=await r.text();if(!r.ok||!r.headers.get('content-type')?.includes('text/html')||!h.includes('<html')||!h.includes('__next'))throw Error('SSR failed '+r.status);console.log(JSON.stringify({status:r.status,bytes:h.length,html:true,next:true}))}).catch(e=>{console.error(e);process.exit(1)})",
  ]);
  writeFileSync("/tmp/psychsift-pr-proof/ssr.json", ssr);
  run(["stop", "-t", "30", name]);
  const state = JSON.parse(run(["inspect", name]))[0].State;
  writeFileSync("/tmp/psychsift-pr-proof/stopped-state.json", JSON.stringify(state, null, 2));
  assert.equal(state.Running, false);
  assert.equal(state.OOMKilled, false);
  assert.notEqual(state.ExitCode, 137);
} finally {
  try {
    run(["rm", "-f", name]);
  } catch {}
}
