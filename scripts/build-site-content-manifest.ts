import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildAllSiteContentRecords } from "../src/lib/site-content/adapters";
import {
  buildStaticSiteContentManifest,
  diffStaticSiteContentManifests,
  type StaticSiteContentManifest,
} from "../src/lib/site-content/site-content-manifest";
import { siteContentRegistryVersion } from "../src/lib/site-content/site-content-registry";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function gitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function writeJson(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const check = process.argv.includes("--check");
  const out = option("--out");
  const baselinePath = option("--baseline");
  const diffPath = option("--diff");
  if (!check && !out && !baselinePath && !diffPath) {
    throw new Error("Use --check, --out <path>, or --baseline <path> --out <path> --diff <path>.");
  }
  if ((baselinePath && !diffPath) || (diffPath && !baselinePath)) {
    throw new Error("--baseline and --diff must be supplied together.");
  }

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

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
