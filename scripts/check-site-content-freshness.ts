import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { classifySiteContentHealth } from "../src/lib/health-response";

export type SiteContentFreshnessCliOptions = Readonly<{
  evidencePath: string;
}>;

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

export function parseSiteContentFreshnessCliArgs(args: readonly string[]): SiteContentFreshnessCliOptions {
  if (args.includes("--live")) {
    throw new Error("Live site-content freshness reads are separately approval-gated and unavailable in this checker.");
  }
  const evidence = option(args, "--evidence");
  const offline = option(args, "--offline");
  if (evidence && offline) throw new Error("Use only one offline evidence path.");
  const evidencePath = evidence ?? offline;
  if (!evidencePath) throw new Error("Provide an offline artifact with --evidence <path>.");
  return { evidencePath };
}

export async function runSiteContentFreshnessCli(args: readonly string[]) {
  const { evidencePath } = parseSiteContentFreshnessCliArgs(args);
  const evidence = JSON.parse(await readFile(resolve(evidencePath), "utf8")) as unknown;
  const classification = classifySiteContentHealth(evidence);
  process.stdout.write(`${JSON.stringify(classification.health)}\n`);
  if (classification.health.state === "failure") {
    process.stderr.write(`Site-content freshness failed: ${classification.stopReasons.join(",")}\n`);
    process.exitCode = 1;
  }
  return classification;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSiteContentFreshnessCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
