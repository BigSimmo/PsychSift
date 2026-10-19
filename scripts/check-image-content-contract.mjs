#!/usr/bin/env node
/**
 * check-image-content-contract — assert the final images meet hardening
 * requirements: non-root user, SIGTERM stop signal, expected OCI labels,
 * expected Cmd, and absence of development/secrets files.
 */
import { spawnSync } from "node:child_process";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const APP_IMAGE = process.argv[2] ?? "clinical-kb-app:ci";
const WORKER_IMAGE = process.argv[3] ?? "clinical-kb-worker:ci";

function run(args) {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", stdio: "pipe" });
  return result;
}

function inspect(image, format) {
  const r = run(["docker", "inspect", "--format", format, image]);
  if (r.status !== 0) throw new Error(`docker inspect failed for ${image}: ${r.stderr}`);
  return r.stdout.trim();
}

export function isExpectedAppCommand(command) {
  const expected = ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"];
  return Array.isArray(command) && command.length === expected.length && command.every((arg, i) => arg === expected[i]);
}

export function imagePathAbsenceProbe(path) {
  return `const fs = require('node:fs'); try { fs.lstatSync(${JSON.stringify(path)}); process.exit(1); } catch (error) { if (error.code !== 'ENOENT') throw error; }`;
}

export function imageListingProbe(directory, pattern) {
  return `const fs = require('node:fs'); const names = fs.readdirSync(${JSON.stringify(directory)}).filter(name => new RegExp(${JSON.stringify(pattern)}).test(name)); if (names.length) console.log(names.join('\\n'));`;
}

function assertImage(image, kind) {
  const user = inspect(image, "{{.Config.User}}");
  if (user !== "node") throw new Error(`${image}: expected User=node, got ${user}`);

  const stopSignal = inspect(image, "{{.Config.StopSignal}}");
  if (stopSignal !== "SIGTERM") throw new Error(`${image}: expected StopSignal=SIGTERM, got ${stopSignal}`);

  const cmd = inspect(image, "{{json .Config.Cmd}}");
  // `docker inspect --format '{{json .Config.Cmd}}'` prints the literal
  // string `null` when Cmd is unset — treat that as missing.
  if (!cmd || cmd === "null") throw new Error(`${image}: missing Cmd`);
  if (kind === "app" && !isExpectedAppCommand(JSON.parse(cmd))) {
    throw new Error(`${image}: expected the direct Next production command, got ${cmd}`);
  }
  if (kind === "worker" && !cmd.includes("dist/worker/index.mjs")) {
    throw new Error(`${image}: expected worker Cmd to contain 'dist/worker/index.mjs', got ${cmd}`);
  }

  const sourceLabel = inspect(image, '{{index .Config.Labels "org.opencontainers.image.source"}}');
  if (!sourceLabel) throw new Error(`${image}: missing org.opencontainers.image.source label`);
}

function assertPathAbsent(image, path) {
  const r = run([
    "docker",
    "run",
    "--rm",
    "--network=none",
    "--entrypoint",
    "node",
    image,
    "-e",
    imagePathAbsenceProbe(path),
  ]);
  if (r.status !== 0)
    throw new Error(`${image}: path is present or its absence could not be verified: ${path}: ${r.stderr || r.stdout}`);
}

function assertListingClean(image, directory, pattern, failureMessage) {
  const r = run([
    "docker",
    "run",
    "--rm",
    "--network=none",
    "--entrypoint",
    "node",
    image,
    "-e",
    imageListingProbe(directory, pattern),
  ]);
  if (r.status !== 0) {
    throw new Error(
      `${image}: docker run failed while checking content (${failureMessage}): ${r.stderr || r.stdout || `exit ${r.status}`}`,
    );
  }
  if (r.stdout?.trim()) throw new Error(`${image}: ${failureMessage}`);
}

function assertWorkerPythonClean(image) {
  // Absolute path so a wrong WORKDIR cannot silently skip the listing.
  assertListingClean(image, "/app/worker/python", "^test_.*\\.py$", "worker/python test_*.py files were not removed");
}

function main() {
  assertImage(APP_IMAGE, "app");
  assertImage(WORKER_IMAGE, "worker");

  for (const image of [APP_IMAGE, WORKER_IMAGE]) {
    assertPathAbsent(image, "/app/.env");
    assertPathAbsent(image, "/app/.env.example");
    assertPathAbsent(image, "/app/.env.local");
    assertPathAbsent(image, "/app/tests");
  }

  for (const image of [APP_IMAGE, WORKER_IMAGE]) {
    assertListingClean(image, "/app", "\\.pem$", "unexpected .pem files in /app");
  }

  // The app needs Node, GNU libraries and a pre-deploy shell, not these tools.
  for (const path of [
    "/usr/bin/apt",
    "/usr/bin/dpkg",
    "/usr/bin/perl",
    "/usr/bin/mount",
    "/usr/bin/umount",
    "/usr/bin/nsenter",
    "/usr/lib/systemd/systemd-homed",
    "/usr/local/lib/node_modules/npm",
  ]) {
    assertPathAbsent(APP_IMAGE, path);
  }

  assertWorkerPythonClean(WORKER_IMAGE);

  console.log(`Image content contract passed for ${APP_IMAGE} and ${WORKER_IMAGE}`);
}

if (isDirectEntrypoint(import.meta.url)) main();
