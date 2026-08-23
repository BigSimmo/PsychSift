import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildPublicSourceStagingCandidate,
  checkPublicSourceChange,
  observePublicSourceChangeSignal,
  type PublicSourceAcquisitionPlan,
} from "@/lib/public-source-acquisition";
import {
  createLivePublicSourceApplyDependencies,
  type PublicSourceApplyDependencies,
} from "./fetch-approved-public-source-versions";
import {
  parsePublicSourceAcquisitionManifest,
  publicSourceAcquisitionManifestDigest,
  readPublicSourceJsonFile,
} from "./plan-public-source-acquisition";

type CurrentSourceVersion = Readonly<{
  catalogueKey: string;
  versionId: string;
  exactUrl: string;
  exactVersion: string;
  contentHash: string;
  lifecycle: "active";
}>;
type ChangeDependencies = Readonly<{
  acquisition: PublicSourceApplyDependencies;
  recordCheck: (event: Readonly<Record<string, string>>) => Promise<void>;
  tombstoneAndQueueReview: (event: Readonly<Record<string, string>>) => Promise<unknown>;
}>;

function option(argv: readonly string[], name: string) {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function parseCurrentVersions(input: unknown): CurrentSourceVersion[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Current public source versions must be non-empty.");
  return input.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Current public source version must be an object.");
    const value = entry as Partial<CurrentSourceVersion>;
    if (
      !value.catalogueKey ||
      !value.versionId ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.versionId) ||
      !value.exactUrl ||
      !value.exactVersion ||
      !/^sha256:[a-f0-9]{64}$/.test(value.contentHash ?? "") ||
      value.lifecycle !== "active"
    ) {
      throw new Error("Current public source version evidence is invalid.");
    }
    return value as CurrentSourceVersion;
  });
}

async function createLiveChangeDependencies(
  plan: PublicSourceAcquisitionPlan,
  current: CurrentSourceVersion,
): Promise<ChangeDependencies> {
  const [{ createAdminClient }, acquisition] = await Promise.all([
    import("@/lib/supabase/admin"),
    createLivePublicSourceApplyDependencies(plan),
  ]);
  const supabase = createAdminClient();
  const audit = async (action: string, event: Readonly<Record<string, string>>) => {
    const { error } = await supabase.from("audit_logs").insert({
      action,
      owner_id: plan.stagingOwnerId,
      resource_type: "public_source_version",
      resource_id: event.versionId ?? current.versionId,
      metadata: event,
    });
    if (error) throw new Error("Public source audit write failed.");
  };
  return {
    acquisition,
    recordCheck: (event) => audit("public_source_change_checked", event),
    tombstoneAndQueueReview: async (event) => {
      const { data, error } = await supabase.rpc("tombstone_public_source_version_for_review", {
        p_version_id: current.versionId,
        p_expected_catalogue_key: event.catalogueKey,
        p_expected_exact_version_url: event.exactUrl,
        p_expected_exact_version: event.exactVersion,
        p_expected_content_hash: event.contentHash,
        p_reason_code: event.reasonCode,
      });
      if (error) throw new Error("Public source tombstone transition failed.");
      return data;
    },
  };
}

export async function runCheckPublicSourceChangesCli(
  argv: readonly string[],
  options: {
    dependenciesForPlan?: (
      plan: PublicSourceAcquisitionPlan,
      current: CurrentSourceVersion,
    ) => Promise<ChangeDependencies>;
    stdout?: (message: string) => void;
  } = {},
) {
  const manifestPath = option(argv, "--manifest");
  const currentPath = option(argv, "--current");
  const stdout = options.stdout ?? console.log;
  if (!manifestPath || !currentPath) {
    stdout(JSON.stringify({ mode: "dry-run", reason: "manifest and current-version paths are required", plans: [] }));
    return { applied: false, count: 0 } as const;
  }
  const { raw, value: manifestValue } = readPublicSourceJsonFile(manifestPath, "manifest");
  const manifest = parsePublicSourceAcquisitionManifest(manifestValue);
  const { raw: rawCurrent, value: currentValue } = readPublicSourceJsonFile(currentPath, "current");
  const current = parseCurrentVersions(currentValue);
  const currentByKey = new Map(current.map((version) => [version.catalogueKey, version]));
  if (currentByKey.size !== current.length) throw new Error("Current public source keys must be unique.");
  for (const plan of manifest.plans) {
    const version = currentByKey.get(plan.catalogueKey);
    if (!version || version.exactUrl !== plan.exactUrl || version.exactVersion !== plan.exactVersion) {
      throw new Error(`Current version identity does not match the plan for ${plan.catalogueKey}.`);
    }
  }
  const digest = publicSourceAcquisitionManifestDigest(raw);
  const expectedCount = Number(option(argv, "--expected-count"));
  const confirmed =
    argv.includes("--apply") &&
    Number.isSafeInteger(expectedCount) &&
    expectedCount === manifest.plans.length &&
    option(argv, "--manifest-sha256") === digest &&
    option(argv, "--current-sha256") === publicSourceAcquisitionManifestDigest(rawCurrent);
  if (!confirmed) {
    stdout(
      JSON.stringify({
        mode: "dry-run",
        count: manifest.plans.length,
        manifestSha256: digest,
        plans: manifest.plans.map(({ catalogueKey, exactUrl, exactVersion }) => ({
          catalogueKey,
          exactUrl,
          exactVersion,
          currentVersionId: currentByKey.get(catalogueKey)?.versionId,
        })),
        currentSha256: publicSourceAcquisitionManifestDigest(rawCurrent),
        required: ["--manifest", "--current", "--expected-count", "--manifest-sha256", "--current-sha256", "--apply"],
      }),
    );
    return { applied: false, count: manifest.plans.length } as const;
  }

  const results = [];
  for (const plan of manifest.plans) {
    const currentVersion = currentByKey.get(plan.catalogueKey)!;
    const dependencies = await (options.dependenciesForPlan ?? createLiveChangeDependencies)(plan, currentVersion);
    await dependencies.acquisition.authorizePlan(plan);
    const observed = await observePublicSourceChangeSignal(plan, dependencies.acquisition);
    results.push(
      await checkPublicSourceChange({
        plan,
        currentVersion,
        observed,
        recordCheck: dependencies.recordCheck,
        stageChangedVersion: async () => {
          if (observed.kind !== "content") throw new Error("Withdrawal signals cannot stage replacement content.");
          const candidate = buildPublicSourceStagingCandidate(plan, {
            bytes: observed.bytes,
            contentType: observed.contentType,
            contentHash: observed.stagedContentHash,
            sourceContentType: observed.sourceContentType,
            sourceContentHash: observed.contentHash,
            sourceByteLength: observed.sourceByteLength,
          });
          const staged = await dependencies.acquisition.stageOwnedDocument(candidate);
          if (!staged.versionId) throw new Error("Changed public source staging did not return a version ID.");
          if (!staged.ownerId || staged.ownerId !== plan.stagingOwnerId) {
            throw new Error("Changed public source staging did not preserve the exact owner.");
          }
          await dependencies.acquisition.enqueue({
            documentId: staged.documentId,
            ownerId: staged.ownerId,
            catalogueKey: plan.catalogueKey,
            contentMode: "indexed_content",
            exactDocumentLicence: "public_index_permitted",
            sourcePolicyVersion: plan.sourcePolicyVersion,
            sourcePolicyDigest: plan.sourcePolicyDigest,
            metadata: candidate.metadata,
          });
          return { versionId: staged.versionId, ownerId: staged.ownerId };
        },
        tombstoneAndQueueReview: dependencies.tombstoneAndQueueReview,
      }),
    );
  }
  stdout(JSON.stringify({ mode: "apply", count: results.length, results }));
  return { applied: true, count: results.length, results } as const;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCheckPublicSourceChangesCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public source change check failed.");
    process.exitCode = 1;
  });
}
