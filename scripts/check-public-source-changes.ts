import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  checkPublicSourceChange,
  observePublicSourceChangeSignal,
  type PublicSourceAcquisitionPlan,
  type PublicSourceStagingCandidate,
} from "@/lib/public-source-acquisition";
import {
  createLivePublicSourceApplyDependencies,
  type PublicSourceApplyDependencies,
} from "./fetch-approved-public-source-versions";
import {
  parsePublicSourceAcquisitionManifest,
  publicSourceAcquisitionManifestDigest,
} from "./plan-public-source-acquisition";

type CurrentSourceVersion = Readonly<{
  catalogueKey: string;
  versionId: string;
  exactUrl: string;
  exactVersion: string;
  contentHash: string;
  lifecycle: "shadow" | "approved" | "active" | "quarantined";
}>;
type ChangeDependencies = Readonly<{
  acquisition: PublicSourceApplyDependencies;
  recordCheck: (event: Readonly<Record<string, string>>) => Promise<void>;
  stageChangedVersion: (
    candidate: PublicSourceStagingCandidate,
  ) => Promise<{ versionId: string; ownerId: string | null }>;
  tombstoneCurrentVersion: (event: Readonly<Record<string, string>>) => Promise<void>;
  queueHumanReview: (event: Readonly<Record<string, string>>) => Promise<void>;
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
      !["shadow", "approved", "active", "quarantined"].includes(value.lifecycle ?? "")
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
    stageChangedVersion: async (candidate) => {
      const staged = await acquisition.stageOwnedDocument(candidate);
      if (!staged.versionId) throw new Error("Changed public source staging did not return a version ID.");
      return { versionId: staged.versionId, ownerId: staged.ownerId };
    },
    tombstoneCurrentVersion: async (event) => {
      const { error } = await supabase.rpc("transition_public_source_version", {
        p_version_id: current.versionId,
        p_expected_catalogue_key: event.catalogueKey,
        p_expected_exact_version_url: event.exactUrl,
        p_expected_content_hash: event.contentHash,
        p_expected_lifecycle: current.lifecycle,
        p_new_lifecycle: "tombstoned",
        p_activation_event_id: null,
      });
      if (error) throw new Error("Public source tombstone transition failed.");
    },
    queueHumanReview: (event) => audit("public_source_withdrawal_review_required", event),
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
  const raw = readFileSync(resolve(manifestPath), "utf8");
  const manifest = parsePublicSourceAcquisitionManifest(JSON.parse(raw) as unknown);
  const rawCurrent = readFileSync(resolve(currentPath), "utf8");
  const current = parseCurrentVersions(JSON.parse(rawCurrent) as unknown);
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
    const definition = australianSourceByKey(plan.catalogueKey);
    if (!definition) throw new Error("Change-check source is no longer in the reviewed catalogue.");
    results.push(
      await checkPublicSourceChange({
        plan,
        currentVersion,
        observed,
        recordCheck: dependencies.recordCheck,
        stageChangedVersion: async () => {
          if (observed.kind !== "content") throw new Error("Withdrawal signals cannot stage replacement content.");
          return dependencies.stageChangedVersion(
            Object.freeze({
              ownerId: plan.stagingOwnerId,
              exactUrl: plan.exactUrl,
              exactVersion: plan.exactVersion,
              contentType: observed.contentType,
              bytes: observed.bytes,
              contentHash: observed.stagedContentHash,
              sourceBytes: observed.sourceBytes,
              sourceContentType: observed.sourceContentType,
              sourceContentHash: observed.contentHash,
              lifecycle: "shadow" as const,
              metadata: Object.freeze({
                corpus_scope: definition.corpusScope,
                source_catalogue_key: plan.catalogueKey,
                source_policy_version: plan.sourcePolicyVersion,
                source_policy_digest: plan.sourcePolicyDigest,
                content_mode: definition.contentMode,
                licence_policy: plan.exactDocumentLicence,
                licence_evidence_digest: plan.licenceEvidenceDigest,
                source_canonical_url: definition.canonicalUrl,
                source_exact_url: plan.exactUrl,
                source_exact_version: plan.exactVersion,
                content_hash: observed.stagedContentHash,
                source_content_hash: observed.contentHash,
                source_content_type: observed.sourceContentType,
                source_policy_checked: true,
                public_source_lifecycle: "shadow",
              }),
            }),
          );
        },
        tombstoneCurrentVersion: dependencies.tombstoneCurrentVersion,
        queueHumanReview: dependencies.queueHumanReview,
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
