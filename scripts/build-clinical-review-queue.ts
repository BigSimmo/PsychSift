import { readFile, writeFile } from "node:fs/promises";

import { buildClinicalReviewQueue, buildTopLocalReviewEvidenceManifest } from "@/lib/clinical-review-queue";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

type Args = { input?: string; output?: string; sourceArtifact?: string; topLocalManifest: boolean; help: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, topLocalManifest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--top-local-manifest") {
      args.topLocalManifest = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (token === "--input") args.input = value;
    else if (token === "--output") args.output = value;
    else if (token === "--source-artifact") args.sourceArtifact = value;
    else throw new Error(`Unknown option: ${token}`);
    index += 1;
  }
  return args;
}

function usage() {
  return [
    "Usage: node scripts/run-tsx.mjs scripts/build-clinical-review-queue.ts --input <eval.json> [--output <queue.json>] [--top-local-manifest] [--source-artifact <label>]",
    "",
    "Builds a deterministic, deduplicated review queue without changing source governance statuses.",
    "--top-local-manifest emits the ten most visible local WA sources as pending evidence only.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.input) throw new Error("--input is required.");
  const input = JSON.parse(await readFile(args.input, "utf8")) as unknown;
  const report = args.topLocalManifest
    ? buildTopLocalReviewEvidenceManifest(input, { limit: 10, sourceArtifact: args.sourceArtifact })
    : buildClinicalReviewQueue(input);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    await writeFile(args.output, output, "utf8");
    console.log(`Wrote clinical review queue to ${args.output}`);
  } else {
    process.stdout.write(output);
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
