import { describe, expect, it } from "vitest";
import {
  adminReferencePreparationReceiptSchema,
  decodeAdminReferencePreparationEvidence,
  encodeAdminReferencePreparationEvidence,
} from "../src/lib/admin-reference-preparation-receipt";

const id = "00000000-0000-4000-8000-000000000001";
const sha = `sha256:${"a".repeat(64)}`;
function fixture() {
  const absent = (afterValue: string) => ({ beforePresent: false, beforeValue: null, afterValue });
  return {
    version: "admin-text-reference-preparation-v1",
    documentId: id,
    generationId: id,
    provenanceOwnerId: id,
    admission: { eventId: id, digest: sha },
    candidate: { authorityDigest: sha, registrationDigest: sha, sourceSnapshotDigest: sha },
    sealDigest: sha,
    source: { sha256: sha, byteLength: 12, expectationDigest: sha, witnessDigest: sha },
    populations: { chunksDigest: sha, sectionsDigest: sha },
    completedDocumentDigest: sha,
    preparedDocumentDigest: sha,
    preparedReviewedStateDigest: "b".repeat(64),
    delta: {
      corpus_scope: { beforePresent: true, beforeValue: "uploaded_local", afterValue: "australian_public" },
      source_catalogue_key: absent("nhmrc"),
      source_policy_version: absent("australian-source-policy-v1"),
      publisher_code: absent("NHMRC"),
      change_state: absent("unchanged"),
    },
    comparison: {
      scope: "retained-current-vs-admitted-original",
      sourceSha256: sha,
      expectationDigest: sha,
      sourceByteLength: 12,
      evidenceReference: "synthetic independently pinned original",
      changeState: "unchanged",
    },
  };
}

describe("preparation evidence codec (synthetic bytes; SQL canonicalization is separately proved)", () => {
  it("retains exact bytes in bounded existing evidence strings, with unrelated refs permitted", () => {
    const bytes = Buffer.from(JSON.stringify(fixture(), null, 1));
    const refs = encodeAdminReferencePreparationEvidence(bytes);
    expect(refs.length).toBeLessThanOrEqual(45);
    expect(refs.every((ref) => ref.length <= 500)).toBe(true);
    const decoded = decodeAdminReferencePreparationEvidence(["synthetic rights evidence", ...refs]);
    expect(decoded.bytes).toEqual(bytes);
    expect(decoded.receipt).toEqual(fixture());
    expect(decoded.receipt).not.toHaveProperty("preparingOperatorId");
    expect(decoded.receipt).not.toHaveProperty("preparedAt");
  });
  it("refuses missing, duplicate, reordered, mixed-digest and malformed-prefix parts", () => {
    const refs = [...encodeAdminReferencePreparationEvidence(Buffer.from(JSON.stringify(fixture())))];
    for (const invalid of [
      [],
      refs.slice(1),
      [refs[0], ...refs],
      [...refs].reverse(),
      [refs[0].replace(/:[0-9a-f]{64}:/, `:${"c".repeat(64)}:`), ...refs.slice(1)],
      [...refs, "admin-txt-prep-v1:broken"],
      [...refs, ...refs],
    ])
      expect(() => decodeAdminReferencePreparationEvidence(invalid)).toThrow();
  });
  it("refuses incorrect totals, oversized arrays, byte tamper and extra receipt fields", () => {
    const refs = [...encodeAdminReferencePreparationEvidence(Buffer.from(JSON.stringify(fixture())))];
    expect(() => decodeAdminReferencePreparationEvidence(refs.map((ref) => ref.replace(/\/\d{2}:/, "/45:")))).toThrow();
    expect(() => decodeAdminReferencePreparationEvidence([...refs, ...Array(51).fill("extra")])).toThrow();
    expect(() =>
      decodeAdminReferencePreparationEvidence([
        refs[0].slice(0, -1) + (refs[0].endsWith("A") ? "B" : "A"),
        ...refs.slice(1),
      ]),
    ).toThrow();
    expect(() =>
      encodeAdminReferencePreparationEvidence(Buffer.from(JSON.stringify({ ...fixture(), preparedAt: "invented" }))),
    ).toThrow();
    expect(() => encodeAdminReferencePreparationEvidence(Buffer.alloc(13501))).toThrow();
  });
  it("distinguishes null and absent before-values and refuses an unsupported comparison or delta", () => {
    const value = fixture();
    value.delta.publisher_code.beforePresent = true;
    expect(adminReferencePreparationReceiptSchema.parse(value).delta.publisher_code.beforePresent).toBe(true);
    expect(() =>
      adminReferencePreparationReceiptSchema.parse({
        ...value,
        comparison: { ...value.comparison, sourceByteLength: 13 },
      }),
    ).toThrow();
    expect(() =>
      adminReferencePreparationReceiptSchema.parse({
        ...value,
        delta: { ...value.delta, change_state: { ...value.delta.change_state, afterValue: "changed" } },
      }),
    ).toThrow();
  });
});
