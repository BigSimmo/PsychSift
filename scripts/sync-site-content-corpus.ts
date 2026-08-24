import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ManifestRecord = {
  logicalId: string;
  contentHash: `sha256:${string}`;
  lineageDigest: `sha256:${string}`;
  eligible: boolean;
};

type Manifest = {
  version: string;
  registryVersion: string;
  staticManifestDigest: `sha256:${string}`;
  records: ManifestRecord[];
};

function option(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

export async function runSiteContentSyncCli(args: readonly string[]) {
  const manifestPath = option(args, "--manifest");
  const write = args.includes("--write");
  if (!manifestPath) throw new Error("--manifest <path> is required.");
  if (write) {
    throw new Error(
      "Live site-content synchronization is unavailable in the source-only CLI; use the reviewed worker with target confirmation and recovery evidence.",
    );
  }
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as Manifest;
  if (
    manifest.version !== "clinical-kb-site-static-manifest-v1" ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.staticManifestDigest) ||
    !Array.isArray(manifest.records)
  ) {
    throw new Error("Invalid site-content manifest.");
  }
  const eligible = manifest.records.filter((record) => record.eligible);
  if (
    new Set(eligible.map((record) => record.logicalId)).size !== eligible.length ||
    eligible.some(
      (record) =>
        !/^sha256:[a-f0-9]{64}$/.test(record.contentHash) || !/^sha256:[a-f0-9]{64}$/.test(record.lineageDigest),
    )
  ) {
    throw new Error("Manifest eligible-record identities are invalid.");
  }
  process.stdout.write(
    `${JSON.stringify({ mode: "dry-run", registryVersion: manifest.registryVersion, staticManifestDigest: manifest.staticManifestDigest, desired: eligible.length, changed: 0, unchanged: eligible.length, tombstoned: 0 })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSiteContentSyncCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
