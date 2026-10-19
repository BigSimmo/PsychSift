#!/usr/bin/env bash
set -euo pipefail
proof=/tmp/psychsift-runtime-proof
mkdir -p "$proof/cache" "$proof/input"
probe=.github/diagnostics/app-runtime-20261019
image=psychsift-app-distroless-native:20261019
scanner=aquasec/trivy:0.59.1@sha256:029e990b328d149bf0a9ffe355919041e1f86192db2df47e217f8a36dd42ceac
cleanup() { docker rm -f psychsift-app-distroless-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
case "${1:?build, runtime or scan phase required}" in
  build)
# No image is published; no cache/artifact is uploaded.
timeout --kill-after=10s 180s docker build --progress=plain -f "$probe/Dockerfile" -t "$image" "$probe"
docker image inspect "$image" > "$proof/image-inspect.json"
node --input-type=module -e 'import assert from "node:assert/strict";import fs from "node:fs";import {isExpectedAppCommand} from "./scripts/check-image-content-contract.mjs";const i=JSON.parse(fs.readFileSync("/tmp/psychsift-runtime-proof/image-inspect.json","utf8"))[0];assert.equal(i.Config.User,"node");assert.equal(i.Config.WorkingDir,"/app");assert.equal(i.Config.StopSignal,"SIGTERM");assert.ok(isExpectedAppCommand(i.Config.Cmd));assert.equal(i.Config.Healthcheck.Test[0],"CMD");assert.ok(i.Config.Healthcheck.Test[3].includes("process.env.PORT||3000"));console.log("Actual thin image command/health/user/signal contract passed")'
timeout 30s docker run --rm --network=none --entrypoint=node node:24-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315 -e 'const f=require("node:fs"),c=require("node:crypto"),p=require("node:child_process");const hash=v=>c.createHash("sha256").update(v).digest("hex");console.log(JSON.stringify({node:process.version,arch:process.arch,dash:hash(f.readFileSync("/usr/bin/dash")),status:hash(p.execFileSync("dpkg-query",["--status","dash"])),copyright:hash(f.readFileSync("/usr/share/doc/dash/copyright"))}))' > "$proof/donor-inventory.json"
;;
  runtime)
timeout 30s docker run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges:true --entrypoint=node -v "$PWD/$probe/runtime-proof.mjs:/proof.mjs:ro" -v "$proof/donor-inventory.json:/donor-inventory.json:ro" "$image" /proof.mjs
# Rebuild the unchanged, synthetic Next fixture once with this repository's exact lock.
mkdir -p "$probe/fixture/node_modules"
NEXT_TELEMETRY_DISABLED=1 timeout --kill-after=5s 120s docker run --rm --network=none --env=NEXT_TELEMETRY_DISABLED=1 -v "$PWD/$probe/fixture:/fixture" -v "$PWD/node_modules:/fixture/node_modules:ro" --entrypoint=node node:24-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315 /fixture/node_modules/next/dist/bin/next build /fixture --webpack
mounts=(-v "$PWD/$probe/fixture:/app:ro" -v "$PWD/node_modules:/app/node_modules:ro" -v "$PWD/$probe/compatibility.mjs:/compatibility.mjs:ro" -v "$PWD/scripts/deploy:/app/scripts/deploy:ro")
# Create mountpoint directories before readonly parent mounts; no root source changes.
mkdir -p "$probe/fixture/scripts/deploy"
timeout 45s docker run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges:true "${mounts[@]}" --entrypoint=node "$image" /compatibility.mjs
timeout 30s docker run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges:true "${mounts[@]}" --entrypoint=/bin/sh "$image" -c 'node /app/scripts/deploy/await-migrations.mjs --self-test'
docker run -d --name psychsift-app-distroless-proof --network=none --cap-drop=ALL --security-opt=no-new-privileges:true -e PORT=4019 "${mounts[@]}" "$image"
timeout 40s bash -c 'until docker exec psychsift-app-distroless-proof node -e '\''fetch("http://127.0.0.1:4019/api/health").then(async r=>{if(!r.ok)throw Error(r.status);let j=await r.json();if(j.uid!==1000||j.node!=="v24.22.0")throw Error(JSON.stringify(j));console.log(JSON.stringify(j))}).catch(e=>{console.error(e);process.exit(1)})'\''; do sleep 1; done'
docker exec psychsift-app-distroless-proof node -e 'fetch("http://127.0.0.1:4019/",{headers:{"x-runtime-probe":"distroless-20261019"}}).then(async r=>{const t=await r.text();if(!r.ok||!t.includes("runtime-proof-distroless-20261019"))throw Error("SSR failed");console.log("Dynamic Next SSR passed")}).catch(e=>{console.error(e);process.exit(1)})'
docker exec psychsift-app-distroless-proof node -e 'const fs=require("node:fs");const args=fs.readFileSync("/proc/1/cmdline","utf8");if(!args.includes("next-server"))throw Error(args);console.log(JSON.stringify({pid1:args}))'
docker inspect --format '{{json .Config.Healthcheck}} {{json .Config.Cmd}} {{.Config.User}} {{.Config.StopSignal}}' psychsift-app-distroless-proof
node --input-type=module -e 'import {execFileSync} from "node:child_process";import assert from "node:assert/strict";const test=JSON.parse(execFileSync("docker",["inspect","--format","{{json .Config.Healthcheck.Test}}","psychsift-app-distroless-proof"],{encoding:"utf8"}));assert.equal(test[0],"CMD");execFileSync("docker",["exec","psychsift-app-distroless-proof",...test.slice(1)],{stdio:"inherit",timeout:10000});console.log("Actual configured Docker healthcheck argv passed")'
timeout 20s docker stop --time 10 psychsift-app-distroless-proof
docker inspect --format '{{json .State}}' psychsift-app-distroless-proof > "$proof/stopped-state.json"
node -e 'const s=JSON.parse(require("fs").readFileSync("/tmp/psychsift-runtime-proof/stopped-state.json","utf8"));if(s.Running||s.OOMKilled||![0,143].includes(s.ExitCode))throw Error(JSON.stringify(s));console.log("Bounded SIGTERM stop passed",s.ExitCode)'
;;
  scan)
# One DB refresh and immutable scanner; all raw severities and complete OS package inventory retained.
timeout --kill-after=10s 180s docker run --rm -v "$proof/cache:/cache" "$scanner" image --download-db-only --cache-dir /cache
docker save -o "$proof/input/image.tar" "$image"
timeout --kill-after=10s 120s docker run --rm --network=none -v "$proof/input:/work:ro" -v "$proof/cache:/cache" "$scanner" image --cache-dir /cache --skip-db-update --skip-java-db-update --scanners vuln --list-all-pkgs --format json --input /work/image.tar > "$proof/trivy-all.json"
timeout --kill-after=10s 90s docker run --rm --network=none -v "$proof/input:/work:ro" -v "$proof/cache:/cache" "$scanner" image --cache-dir /cache --skip-db-update --skip-java-db-update --list-all-pkgs --format cyclonedx --input /work/image.tar > "$proof/sbom.cdx.json"
node "$probe/scan-proof.mjs"
;;
  *) exit 2 ;;
esac
