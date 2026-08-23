import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildIngestionAuditReport, parseIngestionAuditInventory } from "../src/lib/ingestion-audit";
import { parseExpectedSourceCoverageRegistry } from "../src/lib/source-coverage-registry";

type AuditIngestionCorpusCliOptions = {
  inputPath: string;
  expectedPath: string;
  outputPath: string;
  liveRead: boolean;
  confirmedTarget: string | null;
};

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

export function parseAuditIngestionCorpusCliArgs(args: readonly string[]): AuditIngestionCorpusCliOptions {
  const known = new Set(["--input", "--expected", "--output", "--live-read", "--confirm-target"]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!known.has(token)) throw new Error(`Unknown argument: ${token}`);
    if (token !== "--live-read") index += 1;
  }

  const inputPath = option(args, "--input");
  const expectedPath = option(args, "--expected");
  const outputPath = option(args, "--output");
  const liveRead = args.includes("--live-read");
  const confirmedTarget = option(args, "--confirm-target");
  if (!inputPath) throw new Error("--input <path> is required");
  if (!expectedPath) throw new Error("--expected <path> is required");
  if (!outputPath) throw new Error("--output <path> is required");
  if (confirmedTarget && !liveRead) throw new Error("--confirm-target is valid only with --live-read");
  if (liveRead && !confirmedTarget) {
    throw new Error("--live-read requires --confirm-target <project>; provider authorization is also required");
  }
  return { inputPath, expectedPath, outputPath, liveRead, confirmedTarget };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runAuditIngestionCorpusCli(args: readonly string[]) {
  const options = parseAuditIngestionCorpusCliArgs(args);
  if (options.liveRead) {
    throw new Error(
      "Live corpus reads are not implemented by this provider-free command. Use a separately reviewed adapter only after explicit provider authorization.",
    );
  }

  const [inventoryInput, coverageInput] = await Promise.all([
    readJson(options.inputPath),
    readJson(options.expectedPath),
  ]);
  const inventory = parseIngestionAuditInventory(inventoryInput);
  const coverageRegistry = parseExpectedSourceCoverageRegistry(coverageInput);
  const report = buildIngestionAuditReport({ inventory, expectedCoverage: coverageRegistry });
  await writeJson(options.outputPath, report);

  process.stdout.write(
    `ingestion audit passed: ${report.summary.documents} documents; ` +
      `${report.summary.targetedReprocess} targeted reprocess; ${report.summary.shadowReindex} shadow reindex; ` +
      `${report.summary.blocked} blocked; fingerprint ${report.populationFingerprint}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runAuditIngestionCorpusCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
