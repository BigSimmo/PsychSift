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
});
