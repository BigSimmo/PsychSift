import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import {
  classifyPublicSourceChange,
  fetchApprovedPublicSource,
  parseFetchApprovedSourceArgs,
  parsePublicSourceAcquisitionPlan,
  PublicSourceAcquisitionError,
  type PublicSourceAcquisitionPlan,
} from "@/lib/public-source-acquisition";
import { publicSourceAuthorityManifest, stageFetchedPublicSource } from "./fetch-approved-public-source-versions";
import type { Json } from "@/lib/supabase/database.types";

type ChangeManifest = { version: 1; plans: PublicSourceAcquisitionPlan[] };

function parseChangeManifest(raw: string): ChangeManifest {
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 1) {
    throw new Error("Change-detection manifest version is invalid.");
  }
  const plans = (input as { plans?: unknown }).plans;
  if (!Array.isArray(plans) || plans.length < 1 || plans.length > 500) {
    throw new Error("Change-detection manifest count must be between 1 and 500.");
  }
  return { version: 1, plans: plans.map(parsePublicSourceAcquisitionPlan) };
}

export async function fetchPublicSourceChangeCandidate(
  planInput: PublicSourceAcquisitionPlan,
  currentHash: string,
  dependencies: Parameters<typeof fetchApprovedPublicSource>[1] & {
    storageBucket: string;
    preflight(input: { manifest: Json }): Promise<unknown>;
    upload?: unknown;
  },
) {
  const plan = parsePublicSourceAcquisitionPlan(planInput);
  await dependencies.preflight({ manifest: publicSourceAuthorityManifest(plan, dependencies.storageBucket) });
  const fetched = await fetchApprovedPublicSource(plan, dependencies);
  await dependencies.preflight({ manifest: publicSourceAuthorityManifest(plan, dependencies.storageBucket) });
  return {
    fetched,
    change: classifyPublicSourceChange({ plan, currentHash, fetchedHash: fetched.contentHash }),
  };
}

async function main() {
  const args = parseFetchApprovedSourceArgs(process.argv.slice(2));
  const raw = await readFile(args.manifestPath, "utf8");
  const manifest = parseChangeManifest(raw);
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  console.log(`[public-sources:changes] manifest SHA-256 ${digest}; exact count ${manifest.plans.length}`);
  if (!args.apply) {
    console.log(
      "[public-sources:changes] dry run only; no network, database, storage, enqueue, or activation occurred.",
    );
    return;
  }
  if (args.expectedCount !== manifest.plans.length || args.confirmSha256 !== digest) {
    throw new Error("Change-detection confirmation does not match the manifest.");
  }

  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const [{ env }, { createAdminClient }] = await Promise.all([import("@/lib/env"), import("@/lib/supabase/admin")]);
  const supabase = createAdminClient();
  for (const plan of manifest.plans) {
    const { data: current, error: currentError } = await supabase
      .from("public_source_versions")
      .select("id,content_hash,lifecycle,activation_event_id,exact_version_url,steward_id")
      .eq("source_catalogue_key", plan.catalogueKey)
      .eq("lifecycle", "active")
      .order("retrieved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentError) throw new Error("Public source current-version lookup failed.");
    if (
      !current ||
      current.activation_event_id !== plan.activationEventId ||
      current.exact_version_url !== plan.exactUrl
    ) {
      throw new Error(`Public source ${plan.catalogueKey} has no matching active exact URL.`);
    }

    try {
      const { fetched, change } = await fetchPublicSourceChangeCandidate(plan, current.content_hash, {
        storageBucket: env.SUPABASE_DOCUMENT_BUCKET,
        preflight: async ({ manifest: authorityManifest }) => {
          const { data, error } = await supabase.rpc("preflight_public_source_acquisition", {
            p_manifest: authorityManifest,
          });
          if (error || !data) throw new Error("Current public source authority preflight failed.");
          return data;
        },
      });
      if (change.disposition === "unchanged") {
        const { error: auditError } = await supabase.from("audit_logs").insert({
          owner_id: current.steward_id,
          action: "public_source_change_check",
          resource_type: "public_source_version",
          resource_id: current.id,
          metadata: {
            catalogue_key: plan.catalogueKey,
            hostname: new URL(plan.exactUrl).hostname,
            digest: fetched.contentHash,
            disposition: "unchanged",
            byte_count: fetched.byteCount,
          },
        });
        if (auditError) throw new Error("Public source unchanged-check event failed.");
        console.log(`[public-sources:changes] ${plan.catalogueKey} unchanged ${fetched.contentHash}`);
        continue;
      }
      const result = await stageFetchedPublicSource(plan, fetched);
      console.log(`[public-sources:changes] ${plan.catalogueKey} changed ${fetched.contentHash} ${result.disposition}`);
    } catch (error) {
      if (!(error instanceof PublicSourceAcquisitionError) || error.facts.disposition !== "withdrawal") throw error;
      const { error: withdrawalError } = await supabase.rpc("withdraw_public_source_version", {
        p_version_id: current.id,
        p_operator_id: current.steward_id,
        p_reason: "Exact approved URL returned a withdrawal signal during controlled change detection.",
      });
      if (withdrawalError) throw new Error("Public source withdrawal transition failed.");
      console.log(`[public-sources:changes] ${plan.catalogueKey} withdrawal queued for human review`);
    }
  }
  console.log("[public-sources:changes] no source version was activated, published, or automatically superseded.");
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public source change detection failed.");
    process.exit(1);
  });
}
