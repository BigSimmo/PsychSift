import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { RagProgrammeRun } from "../src/lib/rag/rag-programme-eval";
import {
  createSiteContentGovernanceOwnerReceipt,
  createSiteContentMustPassOwnerReceipt,
} from "../src/lib/site-content/site-content-gate-owners";
import type { StaticSiteContentManifest } from "../src/lib/site-content/site-content-manifest";

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

async function readJson(path: string | null, label: string) {
  if (!path) throw new Error(`${label} path is required.`);
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

export async function createSiteContentGateOwnerReceiptCli(args: readonly string[]) {
  const owner = option(args, "--owner");
  const plan = await readJson(option(args, "--plan"), "Canonical plan");
  const now = new Date();
  if (owner === "governance") {
    const secret = process.env.SITE_CONTENT_GOVERNANCE_GATE_OWNER_SECRET ?? "";
    const manifest = (await readJson(option(args, "--manifest"), "P03 manifest")) as StaticSiteContentManifest;
    return createSiteContentGovernanceOwnerReceipt(plan, manifest, { now, secret });
  }
  if (owner === "must-pass") {
    const secret = process.env.RAG_PROGRAMME_GATE_OWNER_SECRET ?? "";
    const fixture = await readJson(option(args, "--fixture"), "Canonical RAG programme fixture");
    const baseline = (await readJson(option(args, "--baseline-run"), "Baseline RAG programme run")) as RagProgrammeRun;
    const candidate = (await readJson(
      option(args, "--candidate-run"),
      "Candidate RAG programme run",
    )) as RagProgrammeRun;
    return createSiteContentMustPassOwnerReceipt(plan, fixture, baseline, candidate, { now, secret });
  }
  throw new Error("--owner must be governance or must-pass.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void createSiteContentGateOwnerReceiptCli(process.argv.slice(2))
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
