import { createHash } from "node:crypto";
import { z } from "zod";

import {
  assertIndexableCatalogueEntry,
  australianSourceByKey,
  australianSourcePolicyVersion,
} from "@/lib/australian-source-catalogue";
import type { TrustedDocumentAdmission } from "@/lib/trusted-document-admission";

const publicationDecisionSchema = z.enum(["approved", "keep_private", "quarantine"]);
const canonicalUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const strictCanonicalUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const publicationManifestV1Schema = z
  .object({
    version: z.literal(1),
    approvingOperatorId: z.string().uuid(),
    reason: z.string().trim().min(3).max(2000),
    evidenceReferences: z.array(z.string().trim().min(1)).min(1),
    documents: z
      .array(
        z.object({
          documentId: z.string().uuid(),
          expectedOwnerId: z.string().uuid(),
          expectedStateDigest: z.string().regex(/^[0-9a-f]{64}$/),
          decision: publicationDecisionSchema,
        }),
      )
      .min(1),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const [index, document] of manifest.documents.entries()) {
      if (seen.has(document.documentId)) {
        context.addIssue({
          code: "custom",
          message: "documentId values must be unique",
          path: ["documents", index, "documentId"],
        });
      }
      seen.add(document.documentId);
    }
  });

const publicationManifestV2Schema = z
  .object({
    version: z.literal(2),
    sourcePolicyVersion: z.literal(australianSourcePolicyVersion),
    approvingOperatorId: canonicalUuidSchema,
    reason: z.string().trim().min(3).max(2000),
    evidenceReferences: z.array(z.string().trim().min(1)).min(1),
    documents: z
      .array(
        z
          .object({
            documentId: canonicalUuidSchema,
            expectedOwnerId: canonicalUuidSchema,
            expectedStateDigest: z.string().regex(/^[0-9a-f]{64}$/),
            expectedIndexGenerationId: canonicalUuidSchema,
            sourceCatalogueKey: z.string().trim().min(1),
            decision: publicationDecisionSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    const seenGenerations = new Set<string>();
    for (const [index, document] of manifest.documents.entries()) {
      if (seen.has(document.documentId)) {
        context.addIssue({
          code: "custom",
          message: "documentId values must be unique",
          path: ["documents", index, "documentId"],
        });
      }
      seen.add(document.documentId);
      if (seenGenerations.has(document.expectedIndexGenerationId)) {
        context.addIssue({
          code: "custom",
          message: "expectedIndexGenerationId values must be unique",
          path: ["documents", index, "expectedIndexGenerationId"],
        });
      }
      seenGenerations.add(document.expectedIndexGenerationId);

      try {
        assertIndexableCatalogueEntry(australianSourceByKey(document.sourceCatalogueKey));
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Australian source is not indexable.",
          path: ["documents", index, "sourceCatalogueKey"],
        });
      }
    }
  });

export type PublicationManifestV1 = z.infer<typeof publicationManifestV1Schema>;
export type PublicationManifestV2 = z.infer<typeof publicationManifestV2Schema>;
export type PublicationManifest = PublicationManifestV1 | PublicationManifestV2;

/**
 * Admission-derived evidence is deliberately not part of the V1/V2 apply union.
 * U10 must replace this pending intent with generation-bound technical evidence
 * before any public activation path can consume it.
 */
export type TrustedAdmissionPublicationManifestV1 = Readonly<{
  version: "trusted-admission-publication-v1";
  publicationStatus: "pending";
  technicalEligibilityRequired: true;
  admissionEventId: string;
  admissionPolicyVersion: "trusted-document-admission-v1";
  sourceChannel: "admin_api" | "backend_import";
  documentId: string;
  expectedOwnerId: string;
  originalContentSha256: `sha256:${string}`;
  reason: string;
  evidenceReferences: readonly [string, string];
  grantsPublicApproval: false;
  grantsClinicalApproval: false;
}>;

export type PublicationCommandArgs = {
  manifestPath: string;
  apply: boolean;
  expectedCount?: number;
  confirmSha256?: string;
};

export function parsePublicationManifest(raw: string): PublicationManifest {
  const input: unknown = JSON.parse(raw);
  if (input && typeof input === "object" && "version" in input && input.version === 2) {
    return parsePublicationManifestV2(input);
  }
  return publicationManifestV1Schema.parse(input);
}

export function parsePublicationManifestV2(input: unknown): PublicationManifestV2 {
  return publicationManifestV2Schema.parse(input);
}

export function buildTrustedAdmissionPublicationManifest(
  input: Readonly<{
    admissionEventId: string;
    admission: TrustedDocumentAdmission;
  }>,
): TrustedAdmissionPublicationManifestV1 {
  const admissionEventId = strictCanonicalUuidSchema.parse(input.admissionEventId);
  const documentId = strictCanonicalUuidSchema.parse(input.admission.documentId);
  const expectedOwnerId = strictCanonicalUuidSchema.parse(input.admission.stagingOwnerId);
  const originalContentSha256 = sha256Schema.parse(input.admission.contentSha256) as `sha256:${string}`;
  if (input.admission.admissionPolicyVersion !== "trusted-document-admission-v1") {
    throw new Error("Admission-derived publication evidence requires trusted-document-admission-v1.");
  }
  if (input.admission.sourceChannel !== "admin_api" && input.admission.sourceChannel !== "backend_import") {
    throw new Error("Admission-derived publication evidence has an invalid source channel.");
  }

  return Object.freeze({
    version: "trusted-admission-publication-v1",
    publicationStatus: "pending",
    technicalEligibilityRequired: true,
    admissionEventId,
    admissionPolicyVersion: "trusted-document-admission-v1",
    sourceChannel: input.admission.sourceChannel,
    documentId,
    expectedOwnerId,
    originalContentSha256,
    reason: `Trusted admission ${admissionEventId} is pending generation-bound technical eligibility.`,
    evidenceReferences: Object.freeze([
      `admission-event:${admissionEventId}`,
      `original-content:${originalContentSha256}`,
    ]) as readonly [string, string],
    grantsPublicApproval: false,
    grantsClinicalApproval: false,
  });
}

export function publicationManifestDigest(raw: string | Buffer) {
  return createHash("sha256").update(raw).digest("hex");
}

export function publicationManifestV2StateDigest(manifest: PublicationManifestV2) {
  const reviewedStates = approvedPublicationManifestV2Documents(manifest)
    .map((document) => `${document.documentId}:${document.expectedStateDigest}`)
    .join("\n");
  return createHash("sha256").update(reviewedStates).digest("hex");
}

export function approvedPublicationManifestV2Documents(manifest: PublicationManifestV2) {
  return manifest.documents
    .filter((document) => document.decision === "approved")
    .toSorted((left, right) => (left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0));
}

export function parsePublicationCommandArgs(argv: string[]): PublicationCommandArgs {
  let manifestPath: string | undefined;
  let expectedCount: number | undefined;
  let confirmSha256: string | undefined;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--manifest") {
      manifestPath = argv[++index];
    } else if (token === "--expected-count") {
      expectedCount = Number(argv[++index]);
    } else if (token === "--confirm-sha256") {
      confirmSha256 = argv[++index]?.toLowerCase();
    } else if (token === "--apply") {
      apply = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!manifestPath) throw new Error("--manifest <path> is required");
  if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 1)) {
    throw new Error("--expected-count must be a positive integer");
  }
  if (confirmSha256 !== undefined && !/^[0-9a-f]{64}$/.test(confirmSha256)) {
    throw new Error("--confirm-sha256 must be a SHA-256 digest");
  }
  if (apply && expectedCount === undefined) throw new Error("--expected-count is required with --apply");
  if (apply && confirmSha256 === undefined) throw new Error("--confirm-sha256 is required with --apply");

  return { manifestPath, apply, expectedCount, confirmSha256 };
}

export function assertPublicationApplyConfirmation(args: {
  manifest: PublicationManifest;
  digest: string;
  expectedCount?: number;
  confirmSha256?: string;
}) {
  if (args.expectedCount !== args.manifest.documents.length) {
    throw new Error(
      `Expected count ${String(args.expectedCount)} does not match manifest count ${args.manifest.documents.length}`,
    );
  }
  if (args.confirmSha256 !== args.digest) {
    throw new Error(`Confirmed SHA-256 does not match manifest digest ${args.digest}`);
  }
}
