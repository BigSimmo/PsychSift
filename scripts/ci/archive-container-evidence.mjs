#!/usr/bin/env node
// All available container evidence is admitted together, or no upload input is produced.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ceiling = 64 * 1024 * 1024;
const inputs = [
  "sbom-app.cdx.json",
  "sbom-worker.cdx.json",
  "container-builds.dockerbuild",
  "trivy-app.report.json",
  "trivy-worker.report.json",
  "trivy-scan-summary.txt",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith("--"))
    throw new Error(`Expected ${name} value`);
  return process.argv[index + 1];
}
function inspect(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function tar(args, binary = false) {
  const result = spawnSync("tar", args, { encoding: binary ? undefined : "utf8", maxBuffer: ceiling + 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("tar failed; refusing complete upload");
  return result.stdout;
}
function main() {
  const maxBytes = Number(argument("--max-bytes"));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling)
    throw new Error("Invalid archive byte cap (maximum 64 MiB)");
  const requestedInput = path.resolve(argument("--input"));
  if (!inspect(requestedInput)?.isDirectory()) throw new Error("Evidence input must be a real directory");
  const input = realpathSync(requestedInput);
  const output = path.resolve(argument("--output"));
  if (inspect(output)) throw new Error("Archive output already exists");
  const outputParent = realpathSync(path.dirname(output));
  const files = [];
  const missing = [];
  let total = 0;
  for (const name of inputs) {
    const file = path.join(input, name);
    const info = inspect(file);
    if (!info) {
      if (name.endsWith(".dockerbuild")) throw new Error("Complete build records are missing");
      missing.push(name);
      continue;
    }
    if (!info.isFile()) throw new Error(`Unsupported evidence input: ${name}`);
    if (name.endsWith(".dockerbuild") && info.size === 0) throw new Error("Complete build records are empty");
    total += info.size;
    if (total > maxBytes) throw new Error(`Complete evidence exceeds ${maxBytes} bytes`);
    files.push({ name, bytes: info.size, sha256: digest(readFileSync(file)) });
  }
  const temporary = mkdtempSync(path.join(outputParent, "container-evidence-"));
  const archive = path.join(temporary, "complete.tar");
  const staging = path.join(temporary, "inputs");
  try {
    // The staging snapshot avoids changing the export or SBOM inputs.
    // Reject links/special files above and recheck copied bytes before archiving.
    mkdirSync(staging);
    for (const file of files) {
      copyFileSync(path.join(input, file.name), path.join(staging, file.name));
      const bytes = readFileSync(path.join(staging, file.name));
      if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
        throw new Error("Evidence changed during archive creation");
    }
    writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, files, missing }, null, 2) + "\n",
    );
    const names = [...files.map((file) => file.name), "manifest.json"];
    tar(["-cf", archive, "-C", staging, "--", ...names]);
    const actualBytes = statSync(archive).size;
    if (actualBytes > maxBytes) throw new Error(`Complete evidence archive exceeds ${maxBytes} bytes`);
    const listed = tar(["-tf", archive]).replaceAll("\r\n", "\n").trimEnd().split("\n").sort();
    if (JSON.stringify(listed) !== JSON.stringify([...names].sort()))
      throw new Error("Archive entry list differs from complete evidence");
    for (const name of names) {
      if (!tar(["-xOf", archive, name], true).equals(readFileSync(path.join(staging, name))))
        throw new Error("Archive bytes differ from complete evidence");
    }
    renameSync(archive, output);
    console.log(
      `Complete container evidence admitted: ${actualBytes} bytes; ${files.length} files; missing optional inputs: ${missing.join(", ") || "none"}`,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
try {
  main();
} catch (error) {
  console.error(`Container evidence archive refused: ${error.message}`);
  process.exitCode = 1;
}
