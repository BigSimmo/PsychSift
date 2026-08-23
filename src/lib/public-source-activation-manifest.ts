import { createHash } from "node:crypto";
import { z } from "zod";

import {
  australianSourceByKey,
  australianSourceCatalogue,
  australianSourcePolicyVersion,
} from "@/lib/australian-source-catalogue";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const evidenceReferenceSchema = z.string().trim().min(1).max(500);

const activationManifestSchema = z
  .object({
    version: z.literal(1),
    sourcePolicyVersion: z.literal(australianSourcePolicyVersion),
    sourcePolicyDigest: sha256Schema,
    catalogueKey: z.string().trim().min(1),
    decision: z.enum(["activate", "quarantine", "retire"]),
    operatorId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1_000),
    evidenceReferences: z.array(evidenceReferenceSchema).min(1).max(50),
  })
  .strict();

export type PublicSourceActivationManifestV1 = Readonly<{
  version: 1;
  sourcePolicyVersion: typeof australianSourcePolicyVersion;
  sourcePolicyDigest: string;
  catalogueKey: string;
  decision: "activate" | "quarantine" | "retire";
  operatorId: string;
  reason: string;
  evidenceReferences: readonly string[];
}>;

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** Digest of the exact reviewed catalogue projection used by activation and acquisition. */
export const australianSourcePolicyDigest = sha256({
  policyVersion: australianSourcePolicyVersion,
  sources: australianSourceCatalogue.map((source) => ({
    key: source.key,
    publisherCode: source.publisherCode,
    canonicalUrl: source.canonicalUrl,
    jurisdiction: source.jurisdiction,
    corpusScope: source.corpusScope,
    roles: source.roles,
    contentMode: source.contentMode,
    licencePolicy: source.licencePolicy,
    lifecycle: source.lifecycle,
    fallbackRank: source.fallbackRank,
  })),
});

function assertDecisionEligible(manifest: z.infer<typeof activationManifestSchema>) {
  const source = australianSourceByKey(manifest.catalogueKey);
  if (!source) {
    throw new Error(`Public source ${manifest.catalogueKey} is not in the active catalogue.`);
  }
  if (manifest.decision !== "activate") return;
  if (source.lifecycle !== "active") {
    throw new Error(`Public source ${source.key} is ${source.lifecycle} and cannot be activated.`);
  }
  if (source.contentMode === "link_only") {
    throw new Error(`Public source ${source.key} is link-only and cannot be activated for acquisition.`);
  }
  if (source.licencePolicy === "index_forbidden" || source.licencePolicy === "metadata_link_only") {
    throw new Error(`Public source ${source.key} has a non-indexable catalogue licence policy.`);
  }
}

export function parsePublicSourceActivationManifestV1(input: unknown): PublicSourceActivationManifestV1 {
  const parsed = activationManifestSchema.parse(input);
  if (parsed.sourcePolicyDigest !== australianSourcePolicyDigest) {
    throw new Error("Public source activation policy digest does not match the reviewed catalogue.");
  }
  if (new Set(parsed.evidenceReferences).size !== parsed.evidenceReferences.length) {
    throw new Error("Public source activation evidence references must be unique.");
  }
  assertDecisionEligible(parsed);
  return Object.freeze({
    ...parsed,
    evidenceReferences: Object.freeze([...parsed.evidenceReferences]),
  });
}

export function buildPublicSourceActivationManifest(input: {
  catalogueKey: string;
  decision: PublicSourceActivationManifestV1["decision"];
  operatorId: string;
  reason: string;
  evidenceReferences: readonly string[];
}): PublicSourceActivationManifestV1 {
  return parsePublicSourceActivationManifestV1({
    version: 1,
    sourcePolicyVersion: australianSourcePolicyVersion,
    sourcePolicyDigest: australianSourcePolicyDigest,
    ...input,
    evidenceReferences: [...input.evidenceReferences],
  });
}

export function assertActivationAllowsAcquisition(
  input: unknown,
  expectedCatalogueKey: string,
): PublicSourceActivationManifestV1 {
  const manifest = parsePublicSourceActivationManifestV1(input);
  if (manifest.catalogueKey !== expectedCatalogueKey || manifest.decision !== "activate") {
    throw new Error(`Acquisition requires an active source definition for ${expectedCatalogueKey}.`);
  }
  return manifest;
}
