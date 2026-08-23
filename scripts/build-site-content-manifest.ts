import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildAllSiteContentRecords } from "../src/lib/site-content/adapters";
import {
  buildStaticSiteContentManifest,
  diffStaticSiteContentManifests,
  type StaticSiteContentManifest,
} from "../src/lib/site-content/site-content-manifest";
import { siteContentRegistryVersion } from "../src/lib/site-content/site-content-registry";

export type SiteContentManifestCliOptions = {
  check: boolean;
  out: string | null;
  baselinePath: string | null;
  diffPath: string | null;
};

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

export function parseSiteContentManifestCliArgs(args: readonly string[]): SiteContentManifestCliOptions {
  const parsed = {
    check: args.includes("--check"),
    out: option(args, "--out"),
    baselinePath: option(args, "--baseline"),
    diffPath: option(args, "--diff"),
  };
  if (!parsed.check && !parsed.out && !parsed.baselinePath && !parsed.diffPath) {
    throw new Error("Use --check, --out <path>, or --baseline <path> --out <path> --diff <path>.");
  }
  if ((parsed.baselinePath && !parsed.diffPath) || (parsed.diffPath && !parsed.baselinePath)) {
    throw new Error("--baseline and --diff must be supplied together.");
  }
  return parsed;
}

function gitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function writeJson(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runSiteContentManifestCli(args: readonly string[]) {
  const { check, out, baselinePath, diffPath } = parseSiteContentManifestCliArgs(args);

  const manifest = buildStaticSiteContentManifest(buildAllSiteContentRecords(), {
    gitSha: gitSha(),
    registryVersion: siteContentRegistryVersion,
  });

  if (out) await writeJson(out, manifest);
  if (baselinePath && diffPath) {
    const baseline = JSON.parse(await readFile(resolve(baselinePath), "utf8")) as StaticSiteContentManifest;
    await writeJson(diffPath, diffStaticSiteContentManifests(baseline, manifest));
  }

  const eligible = manifest.records.filter((record) => record.eligible).length;
  process.stdout.write(
    `site-content manifest ${check ? "check " : ""}passed: ${manifest.records.length} static records (${eligible} eligible), digest ${manifest.staticManifestDigest}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSiteContentManifestCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
