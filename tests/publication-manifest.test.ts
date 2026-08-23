import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertPublicationApplyConfirmation,
  approvedPublicationManifestV2Documents,
  parsePublicationCommandArgs,
  parsePublicationManifest,
  parsePublicationManifestV2,
  publicationManifestDigest,
  publicationManifestV2StateDigest,
} from "@/lib/publication-manifest";
import { runPublicationPromotion } from "../scripts/promote-public-documents-batch";

const promotionScriptSource = readFileSync(
  new URL("../scripts/promote-public-documents-batch.ts", import.meta.url),
  "utf8",
);

const manifest = {
  version: 1,
  approvingOperatorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reason: "Reviewed for public corpus publication.",
  evidenceReferences: ["ticket:CLIN-42"],
  documents: [
    {
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedOwnerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expectedStateDigest: "d".repeat(64),
      decision: "approved",
    },
  ],
};

const manifestV2 = {
  version: 2,
  sourcePolicyVersion: "australian-source-policy-v1",
  approvingOperatorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reason: "Reviewed for governed Australian public corpus activation.",
  evidenceReferences: ["ticket:CLIN-84"],
  documents: [
    {
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedOwnerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expectedStateDigest: "d".repeat(64),
      expectedIndexGenerationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sourceCatalogueKey: "wa-health",
      decision: "approved",
    },
  ],
};

type PromotionClient = Parameters<typeof runPublicationPromotion>[0]["supabase"];

function promotionClientFixture({
  documents,
  stateDigests = {},
}: {
  documents: Array<{
    id: string;
    owner_id: string;
    status: string;
    title: string;
    metadata: Record<string, string>;
    index_generation_id: string | null;
  }>;
  stateDigests?: Record<string, string>;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const approvalInserts: unknown[][] = [];
  const client = {
    from(table: string) {
      if (table === "documents") {
        return {
          select() {
            return {
              async in() {
                return { data: documents, error: null };
              },
            };
          },
        };
      }
      if (table === "document_publication_approvals") {
        return {
          select() {
            return {
              eq() {
                return {
                  async in() {
                    return { data: [], error: null };
                  },
                };
              },
            };
          },
          async insert(rows: unknown[]) {
            approvalInserts.push(rows);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "document_publication_state_digest") {
        const document = manifestV2.documents.find((entry) => entry.documentId === args.p_document_id);
        const v1Document = manifest.documents.find((entry) => entry.documentId === args.p_document_id);
        return {
          data:
            stateDigests[String(args.p_document_id)] ??
            document?.expectedStateDigest ??
            v1Document?.expectedStateDigest,
          error: null,
        };
      }
      return { data: { activated: true }, error: null };
    },
  };
  return {
    client: client as unknown as PromotionClient,
    rpcCalls,
    approvalInserts,
  };
}

function promotionDocument(entry: (typeof manifestV2.documents)[number], metadata: Record<string, string> = {}) {
  return {
    id: entry.documentId,
    owner_id: entry.expectedOwnerId,
    status: "indexed",
    title: "Reviewed source",
    metadata,
    index_generation_id: entry.expectedIndexGenerationId,
  };
}

describe("publication manifests", () => {
  it("requires an explicit manifest and defaults to dry-run", () => {
    expect(parsePublicationCommandArgs(["--manifest", "publication.json"])).toEqual({
      manifestPath: "publication.json",
      apply: false,
      expectedCount: undefined,
      confirmSha256: undefined,
    });
    expect(() => parsePublicationCommandArgs([])).toThrow(/--manifest/);
  });

  it("requires count and SHA confirmation before apply", () => {
    expect(() => parsePublicationCommandArgs(["--manifest", "publication.json", "--apply"])).toThrow(
      /--expected-count/,
    );
    const raw = JSON.stringify(manifest);
    const digest = publicationManifestDigest(raw);
    const parsed = parsePublicationManifest(raw);
    expect(() =>
      assertPublicationApplyConfirmation({
        manifest: parsed,
        digest,
        expectedCount: 2,
        confirmSha256: digest,
      }),
    ).toThrow(/count/);
    expect(() =>
      assertPublicationApplyConfirmation({
        manifest: parsed,
        digest,
        expectedCount: 1,
        confirmSha256: "0".repeat(64),
      }),
    ).toThrow(/SHA-256/);
  });

  it("rejects missing evidence, duplicate documents, and accepts each explicit decision", () => {
    expect(() => parsePublicationManifest(JSON.stringify({ ...manifest, evidenceReferences: [] }))).toThrow();
    expect(() =>
      parsePublicationManifest(
        JSON.stringify({ ...manifest, documents: [manifest.documents[0], manifest.documents[0]] }),
      ),
    ).toThrow(/unique/);
    for (const decision of ["approved", "keep_private", "quarantine"] as const) {
      expect(
        parsePublicationManifest(JSON.stringify({ ...manifest, documents: [{ ...manifest.documents[0], decision }] }))
          .documents[0].decision,
      ).toBe(decision);
    }
  });

  it("requires a canonical reviewed-state digest for every decision", () => {
    const withoutDigest = {
      documentId: manifest.documents[0].documentId,
      expectedOwnerId: manifest.documents[0].expectedOwnerId,
      decision: manifest.documents[0].decision,
    };
    expect(() => parsePublicationManifest(JSON.stringify({ ...manifest, documents: [withoutDigest] }))).toThrow(
      /expectedStateDigest/,
    );
    expect(() =>
      parsePublicationManifest(
        JSON.stringify({ ...manifest, documents: [{ ...manifest.documents[0], expectedStateDigest: "ABC" }] }),
      ),
    ).toThrow(/expectedStateDigest/);
  });

  it("parses a version-2 Australian activation manifest without changing version-1 parsing", () => {
    expect(parsePublicationManifestV2(manifestV2)).toEqual(manifestV2);
    expect(parsePublicationManifest(JSON.stringify(manifestV2))).toEqual(manifestV2);
    expect(parsePublicationManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it.each([
    ["unknown-source", "unknown"],
    ["nps-medicinewise", "historical"],
    ["etg-complete", "link-only"],
    ["australian-medicines-handbook", "link-only"],
  ])("rejects non-indexable Australian catalogue key %s", (sourceCatalogueKey, expectedMessage) => {
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [{ ...manifestV2.documents[0], sourceCatalogueKey }],
      }),
    ).toThrow(new RegExp(expectedMessage, "i"));
  });

  it("rejects a policy-version mismatch and incomplete governed state", () => {
    expect(() =>
      parsePublicationManifestV2({ ...manifestV2, sourcePolicyVersion: "australian-source-policy-v0" }),
    ).toThrow(/sourcePolicyVersion/);
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [{ ...manifestV2.documents[0], expectedIndexGenerationId: undefined }],
      }),
    ).toThrow(/expectedIndexGenerationId/);
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [{ ...manifestV2.documents[0], expectedStateDigest: "ABC" }],
      }),
    ).toThrow(/expectedStateDigest/);
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [manifestV2.documents[0], manifestV2.documents[0]],
      }),
    ).toThrow(/unique/);
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [
          manifestV2.documents[0],
          {
            ...manifestV2.documents[0],
            documentId: "11111111-1111-4111-8111-111111111111",
          },
        ],
      }),
    ).toThrow(/generation.*unique/i);
  });

  it.each(["etg-complete", "australian-medicines-handbook", "nps-medicinewise"])(
    "never accepts an approved decision for %s",
    (sourceCatalogueKey) => {
      expect(() =>
        parsePublicationManifestV2({
          ...manifestV2,
          documents: [{ ...manifestV2.documents[0], sourceCatalogueKey, decision: "approved" }],
        }),
      ).toThrow();
    },
  );

  it("binds approved state and generations in canonical document-id order", () => {
    const secondDocument = {
      ...manifestV2.documents[0],
      documentId: "11111111-1111-4111-8111-111111111111",
      expectedStateDigest: "a".repeat(64),
      expectedIndexGenerationId: "22222222-2222-4222-8222-222222222222",
    };
    const descending = parsePublicationManifestV2({
      ...manifestV2,
      documents: [manifestV2.documents[0], secondDocument],
    });
    const ascending = parsePublicationManifestV2({
      ...manifestV2,
      documents: [secondDocument, manifestV2.documents[0]],
    });

    expect(publicationManifestV2StateDigest(descending)).toBe(publicationManifestV2StateDigest(ascending));
    expect(approvedPublicationManifestV2Documents(descending).map((document) => document.documentId)).toEqual([
      secondDocument.documentId,
      manifestV2.documents[0].documentId,
    ]);
    expect(
      approvedPublicationManifestV2Documents(descending).map((document) => document.expectedIndexGenerationId),
    ).toEqual([secondDocument.expectedIndexGenerationId, manifestV2.documents[0].expectedIndexGenerationId]);

    const uppercase = parsePublicationManifestV2({
      ...manifestV2,
      documents: [
        {
          ...manifestV2.documents[0],
          documentId: manifestV2.documents[0].documentId.toUpperCase(),
          expectedOwnerId: manifestV2.documents[0].expectedOwnerId.toUpperCase(),
          expectedIndexGenerationId: manifestV2.documents[0].expectedIndexGenerationId.toUpperCase(),
        },
      ],
    });
    expect(uppercase.documents[0].documentId).toBe(manifestV2.documents[0].documentId);
    expect(publicationManifestV2StateDigest(uppercase)).toBe(
      publicationManifestV2StateDigest(parsePublicationManifestV2(manifestV2)),
    );
  });

  it("rejects mixed-case duplicate document and generation UUIDs", () => {
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [
          manifestV2.documents[0],
          {
            ...manifestV2.documents[0],
            documentId: manifestV2.documents[0].documentId.toUpperCase(),
            expectedIndexGenerationId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      }),
    ).toThrow(/documentId.*unique/i);
    expect(() =>
      parsePublicationManifestV2({
        ...manifestV2,
        documents: [
          manifestV2.documents[0],
          {
            ...manifestV2.documents[0],
            documentId: "11111111-1111-4111-8111-111111111111",
            expectedIndexGenerationId: manifestV2.documents[0].expectedIndexGenerationId.toUpperCase(),
          },
        ],
      }),
    ).toThrow(/generation.*unique/i);
  });

  it("exposes a safely importable promotion dispatcher seam", () => {
    expect(promotionScriptSource).toContain("export async function runPublicationPromotion(");
    expect(promotionScriptSource).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });

  it("keeps a validated dry run read-only", async () => {
    const fixture = promotionClientFixture({
      documents: [
        promotionDocument(manifestV2.documents[0], {
          corpus_scope: "australian_public",
          source_catalogue_key: manifestV2.documents[0].sourceCatalogueKey,
          source_policy_version: manifestV2.sourcePolicyVersion,
          content_mode: "indexed_content",
          licence_policy: "public_index_permitted",
          document_status: "current",
          change_state: "active",
        }),
      ],
    });
    const logs: string[] = [];

    await runPublicationPromotion({
      raw: JSON.stringify(manifestV2),
      args: { manifestPath: "publication.json", apply: false },
      supabase: fixture.client,
      log: (message) => logs.push(message),
    });

    expect(fixture.approvalInserts).toEqual([]);
    expect(fixture.rpcCalls.map((call) => call.name)).toEqual(["document_publication_state_digest"]);
    expect(logs).toContain("[public-documents:promote] dry run only; no approvals or document ownership were changed.");
  });

  it("dispatches a version-1 apply only to the legacy non-Australian RPC", async () => {
    const raw = JSON.stringify(manifest);
    const fixture = promotionClientFixture({
      documents: [
        {
          ...promotionDocument({ ...manifestV2.documents[0], ...manifest.documents[0] }),
          metadata: { corpus_scope: "general_public" },
        },
      ],
    });

    await runPublicationPromotion({
      raw,
      args: {
        manifestPath: "publication.json",
        apply: true,
        expectedCount: 1,
        confirmSha256: publicationManifestDigest(raw),
      },
      supabase: fixture.client,
      log: () => undefined,
    });

    expect(fixture.approvalInserts).toEqual([
      [
        {
          document_id: manifest.documents[0].documentId,
          expected_prior_owner_id: manifest.documents[0].expectedOwnerId,
          approving_operator_id: manifest.approvingOperatorId,
          decision: "approved",
          reason: manifest.reason,
          evidence_references: manifest.evidenceReferences,
          manifest_digest: publicationManifestDigest(raw),
          reviewed_state_digest: manifest.documents[0].expectedStateDigest,
        },
      ],
    ]);
    expect(fixture.rpcCalls.filter((call) => call.name !== "document_publication_state_digest")).toEqual([
      {
        name: "publish_approved_documents",
        args: {
          p_documents: [
            {
              document_id: manifest.documents[0].documentId,
              expected_owner_id: manifest.documents[0].expectedOwnerId,
              expected_state_digest: manifest.documents[0].expectedStateDigest,
            },
          ],
          p_manifest_digest: publicationManifestDigest(raw),
          p_expected_count: 1,
        },
      },
    ]);
  });

  it("dispatches canonical version-2 evidence to the atomic activation RPC", async () => {
    const secondDocument = {
      ...manifestV2.documents[0],
      documentId: "11111111-1111-4111-8111-111111111111",
      expectedStateDigest: "a".repeat(64),
      expectedIndexGenerationId: "22222222-2222-4222-8222-222222222222",
    };
    const rawManifest = {
      ...manifestV2,
      documents: [
        { ...manifestV2.documents[0], documentId: manifestV2.documents[0].documentId.toUpperCase() },
        secondDocument,
      ],
    };
    const raw = JSON.stringify(rawManifest);
    const parsed = parsePublicationManifestV2(rawManifest);
    const fixture = promotionClientFixture({
      documents: parsed.documents.map((entry) =>
        promotionDocument(entry, {
          corpus_scope: "australian_public",
          source_catalogue_key: entry.sourceCatalogueKey,
          source_policy_version: parsed.sourcePolicyVersion,
          content_mode: "indexed_content",
          licence_policy: "public_index_permitted",
          document_status: "current",
          change_state: "active",
        }),
      ),
      stateDigests: Object.fromEntries(parsed.documents.map((entry) => [entry.documentId, entry.expectedStateDigest])),
    });

    await runPublicationPromotion({
      raw,
      args: {
        manifestPath: "publication.json",
        apply: true,
        expectedCount: 2,
        confirmSha256: publicationManifestDigest(raw),
      },
      supabase: fixture.client,
      log: () => undefined,
    });

    expect(fixture.approvalInserts[0]).toEqual(
      parsed.documents.map((entry) => ({
        document_id: entry.documentId,
        expected_prior_owner_id: entry.expectedOwnerId,
        approving_operator_id: parsed.approvingOperatorId,
        decision: entry.decision,
        reason: parsed.reason,
        evidence_references: parsed.evidenceReferences,
        manifest_digest: publicationManifestDigest(raw),
        reviewed_state_digest: entry.expectedStateDigest,
        source_catalogue_key: entry.sourceCatalogueKey,
        source_policy_version: parsed.sourcePolicyVersion,
        reviewed_index_generation_id: entry.expectedIndexGenerationId,
      })),
    );
    expect(fixture.rpcCalls.filter((call) => call.name !== "document_publication_state_digest")).toEqual([
      {
        name: "activate_approved_public_documents",
        args: {
          p_manifest: parsed,
          p_expected_state_digest: publicationManifestV2StateDigest(parsed),
          p_expected_generation_ids: approvedPublicationManifestV2Documents(parsed).map(
            (entry) => entry.expectedIndexGenerationId,
          ),
        },
      },
    ]);
  });

  it("refuses version-1 Australian activation before recording approval or calling a writer RPC", async () => {
    const raw = JSON.stringify(manifest);
    const fixture = promotionClientFixture({
      documents: [
        {
          ...promotionDocument({ ...manifestV2.documents[0], ...manifest.documents[0] }),
          metadata: { corpus_scope: "australian_public" },
        },
      ],
    });

    await expect(
      runPublicationPromotion({
        raw,
        args: {
          manifestPath: "publication.json",
          apply: true,
          expectedCount: 1,
          confirmSha256: publicationManifestDigest(raw),
        },
        supabase: fixture.client,
        log: () => undefined,
      }),
    ).rejects.toThrow(/version 2.*Australian/i);
    expect(fixture.approvalInserts).toEqual([]);
    expect(fixture.rpcCalls.map((call) => call.name)).toEqual(["document_publication_state_digest"]);
  });
});
