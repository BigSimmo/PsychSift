import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const actionlintRelease = Object.freeze(
  JSON.parse(readFileSync(new URL("./actionlint-release.json", import.meta.url), "utf8")),
);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
// This gate owns workflow schema/expression semantics. Shell and Python lint
// remain separate gates; their optional ambient integrations must not change its verdict.
export const semanticArguments = Object.freeze(["-no-color", "-oneline", "-shellcheck=", "-pyflakes="]);

export function verifyActionlintChecksum(bytes, expected, label) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, received ${actual}`);
}

export async function ensureActionlint({ install = false, root = projectRoot } = {}) {
  if (process.platform !== actionlintRelease.platform || process.arch !== actionlintRelease.architecture) {
    throw new Error("The reviewed actionlint pin targets Linux x64, matching the required Ubuntu CI gate");
  }
  const directory = path.join(root, "output/tooling/actionlint", actionlintRelease.version, "linux-x64");
  const executable = path.join(directory, "actionlint");
  if (existsSync(executable)) {
    verifyActionlintChecksum(
      readFileSync(executable),
      actionlintRelease.executableSha256,
      "Cached actionlint executable",
    );
    return executable;
  }
  if (!install)
    throw new Error("Pinned actionlint is missing; rerun with --install to download its verified official release");
  const parent = path.dirname(directory);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, ".install-"));
  try {
    const url = `https://github.com/rhysd/actionlint/releases/download/v${actionlintRelease.version}/${actionlintRelease.asset}`;
    const archivePath = path.join(staging, actionlintRelease.asset);
    // curl preserves the host's supplied proxy and CA configuration. Direct Node
    // fetch need not honor that configuration in managed execution environments.
    const download = spawnSync(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "45",
        "--max-filesize",
        "16777216",
        "--output",
        archivePath,
        url,
      ],
      { encoding: "utf8", timeout: 50_000 },
    );
    if (download.error || download.status !== 0)
      throw new Error(`Cannot download official actionlint: ${download.error?.message ?? download.stderr}`);
    const archive = readFileSync(archivePath);
    if (archive.byteLength > 16 * 1024 * 1024)
      throw new Error("Official actionlint archive exceeds the bounded download size");
    verifyActionlintChecksum(archive, actionlintRelease.archiveSha256, "Official actionlint archive");
    // Extract only the reviewed executable after archive verification.
    const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", staging, "actionlint"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (extraction.error || extraction.status !== 0)
      throw new Error(`Cannot extract actionlint: ${extraction.error?.message ?? extraction.stderr}`);
    const stagedExecutable = path.join(staging, "actionlint");
    verifyActionlintChecksum(
      readFileSync(stagedExecutable),
      actionlintRelease.executableSha256,
      "Extracted actionlint executable",
    );
    chmodSync(stagedExecutable, 0o755);
    mkdirSync(directory, { recursive: true });
    renameSync(stagedExecutable, executable);
    console.log(`Installed checksum-verified actionlint ${actionlintRelease.version} from its official release.`);
    return executable;
  } finally {
    rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const fixture = (step) =>
  `name: semantic probe\non: push\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps:\n      ${step}\n`;
export const semanticFixtures = Object.freeze([
  { name: "valid workflow", source: fixture("- run: echo ok"), diagnostic: null },
  {
    name: "unknown expression context",
    source: fixture("- run: echo '${{ unknown_context.value }}'"),
    diagnostic: /undefined variable/,
  },
  {
    name: "missing step implementation",
    source: fixture("- name: missing implementation"),
    diagnostic: /run.*uses|uses.*run/,
  },
]);

export function assertSemanticFixtures(execute) {
  for (const probe of semanticFixtures) {
    const result = execute(probe.source);
    if (result.error || result.signal || result.status === null) {
      throw new Error(
        `actionlint self-test could not run ${probe.name}: ${result.error?.message ?? result.signal ?? "no status"}`,
      );
    }
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (probe.diagnostic ? result.status !== 1 || !probe.diagnostic.test(output) : result.status !== 0) {
      throw new Error(`actionlint self-test failed for ${probe.name}: exit ${result.status}\n${output}`);
    }
  }
}

export function runActionlint(executable, { input, root = projectRoot } = {}) {
  return spawnSync(executable, [...semanticArguments, ...(input === undefined ? [] : ["-"])], {
    cwd: root,
    encoding: "utf8",
    input,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function actionlintResultStatus(result) {
  if (result.error) throw result.error;
  if (result.signal || !Number.isInteger(result.status) || result.status < 0)
    throw new Error(`actionlint did not complete: ${result.signal ?? "missing exit status"}`);
  return result.status;
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { install: { type: "boolean" }, "self-test": { type: "boolean" } },
      allowPositionals: false,
    });
    const executable = await ensureActionlint({ install: values.install });
    assertSemanticFixtures((input) => runActionlint(executable, { input }));
    console.log(`actionlint ${actionlintRelease.version} semantic probes passed.`);
    if (!values["self-test"]) {
      const result = runActionlint(executable);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = actionlintResultStatus(result);
      if (process.exitCode === 0)
        console.log(`GitHub Actions workflow semantics passed (actionlint ${actionlintRelease.version}).`);
    }
  } catch (error) {
    console.error(`GitHub Actions semantic check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
