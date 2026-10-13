import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { planAcquisition } from "@/lib/public-source-acquisition";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

type InputDocument = {
  catalogueKey: string;
  exactUrl: string;
  exactVersion: string;
  exactDocumentLicence: "public_index_permitted";
  licenceEvidenceDigest: string;
  stewardId: string;
  activationEventId: string;
  activationSequence: number;
  activationManifest: unknown;
};

function parseArgs(argv: string[]) {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") inputPath = argv[++index];
    else if (token === "--output") outputPath = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!inputPath) throw new Error("--input <path> is required.");
  return { inputPath, outputPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input: unknown = JSON.parse(await readFile(args.inputPath, "utf8"));
  if (!input || typeof input !== "object" || !Array.isArray((input as { documents?: unknown }).documents)) {
    throw new Error("Acquisition input must contain an exact documents array.");
  }
  const documents = (input as { documents: InputDocument[] }).documents;
  if (documents.length < 1 || documents.length > 500)
    throw new Error("Acquisition input count must be between 1 and 500.");
  const plans = await Promise.all(documents.map((document) => planAcquisition(document)));
  plans.sort((left, right) =>
    left.catalogueKey === right.catalogueKey
      ? left.exactUrl < right.exactUrl
        ? -1
        : left.exactUrl > right.exactUrl
          ? 1
          : 0
      : left.catalogueKey < right.catalogueKey
        ? -1
        : 1,
  );
  const duplicateKeys = plans.map((plan) => `${plan.catalogueKey}\u0000${plan.exactUrl}`);
  if (new Set(duplicateKeys).size !== duplicateKeys.length)
    throw new Error("Acquisition input contains duplicate exact URLs.");
  const manifest = `${JSON.stringify({ version: 1, plans }, null, 2)}\n`;
  const digest = createHash("sha256").update(manifest, "utf8").digest("hex");
  if (args.outputPath) {
    await writeFile(args.outputPath, manifest, { encoding: "utf8", flag: "wx" });
    console.log(`[public-sources:plan] wrote ${plans.length} exact acquisition plan(s); SHA-256 ${digest}`);
    return;
  }
  process.stdout.write(manifest);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public source planning failed.");
    process.exit(1);
  });
}
