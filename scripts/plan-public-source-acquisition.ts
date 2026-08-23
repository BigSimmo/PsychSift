import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertPublicSourceAcquisitionPlan,
  planAcquisition,
  type PublicSourceAcquisitionPlan,
} from "@/lib/public-source-acquisition";

export type PublicSourceAcquisitionManifestV1 = Readonly<{
  schemaVersion: "public-source-acquisition-manifest-v1";
  plans: readonly PublicSourceAcquisitionPlan[];
}>;

function option(argv: readonly string[], name: string) {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

export function publicSourceAcquisitionManifestDigest(raw: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

export function parsePublicSourceAcquisitionManifest(input: unknown): PublicSourceAcquisitionManifestV1 {
  if (!input || typeof input !== "object") throw new Error("Acquisition manifest must be an object.");
  const value = input as { schemaVersion?: unknown; plans?: unknown };
  if (value.schemaVersion !== "public-source-acquisition-manifest-v1" || !Array.isArray(value.plans)) {
    throw new Error("Unsupported public source acquisition manifest.");
  }
  const plans = value.plans.map((plan) => {
    if (!plan || typeof plan !== "object") throw new Error("Public source acquisition plan must be an object.");
    const candidate = plan as PublicSourceAcquisitionPlan;
    assertPublicSourceAcquisitionPlan(candidate);
    return candidate;
  });
  return Object.freeze({ schemaVersion: value.schemaVersion, plans: Object.freeze(plans) });
}

export async function runPlanPublicSourceAcquisitionCli(
  argv: readonly string[],
  io: { stdout?: (message: string) => void } = {},
) {
  const inputPath = option(argv, "--input");
  const outputPath = option(argv, "--output");
  if (!inputPath) throw new Error("Acquisition planning requires --input with an exact URL/version list.");
  const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as unknown;
  const entries = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { entries?: unknown }).entries)
      ? (input as { entries: unknown[] }).entries
      : null;
  if (!entries?.length) throw new Error("Acquisition planning requires a non-empty exact URL/version list.");
  const plans = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Acquisition plan entry must be an object.");
    plans.push(await planAcquisition(entry as Parameters<typeof planAcquisition>[0]));
  }
  const manifest: PublicSourceAcquisitionManifestV1 = Object.freeze({
    schemaVersion: "public-source-acquisition-manifest-v1",
    plans: Object.freeze(plans),
  });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (outputPath) {
    const absolute = resolve(outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, serialized, { encoding: "utf8", flag: "wx" });
  }
  (io.stdout ?? console.log)(
    JSON.stringify({
      mode: "dry-run",
      count: plans.length,
      manifestSha256: publicSourceAcquisitionManifestDigest(serialized),
      plans: plans.map(({ catalogueKey, exactUrl, exactVersion, targetLifecycle }) => ({
        catalogueKey,
        exactUrl,
        exactVersion,
        targetLifecycle,
      })),
    }),
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runPlanPublicSourceAcquisitionCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public source acquisition planning failed.");
    process.exitCode = 1;
  });
}
