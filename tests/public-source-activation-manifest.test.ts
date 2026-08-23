import { describe, expect, it } from "vitest";

import {
  australianSourcePolicyDigest,
  buildPublicSourceActivationManifest,
  parsePublicSourceActivationManifestV1,
} from "@/lib/public-source-activation-manifest";

const operatorId = "11111111-1111-4111-8111-111111111111";

function manifestInput(overrides: Partial<Parameters<typeof buildPublicSourceActivationManifest>[0]> = {}) {
  const input: Parameters<typeof buildPublicSourceActivationManifest>[0] = {
    catalogueKey: "wa-health",
    decision: "activate",
    operatorId,
    reason: "Approved source definition for bounded exact-version acquisition.",
    evidenceReferences: ["source-review:wa-health:2026-08-20"],
  };
  return { ...input, ...overrides };
}

describe("public source activation manifests", () => {
  it("binds an immutable activation decision to the exact catalogue policy", () => {
    const manifest = buildPublicSourceActivationManifest(manifestInput());

    expect(manifest).toEqual({
      version: 1,
      sourcePolicyVersion: "australian-source-policy-v1",
      sourcePolicyDigest: australianSourcePolicyDigest,
      catalogueKey: "wa-health",
      decision: "activate",
      operatorId,
      reason: "Approved source definition for bounded exact-version acquisition.",
      evidenceReferences: ["source-review:wa-health:2026-08-20"],
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.evidenceReferences)).toBe(true);
    expect(australianSourcePolicyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects unknown, historical, excluded, and link-only activation targets", () => {
    for (const [catalogueKey, message] of [
      ["unknown-source", /not in the active catalogue/i],
      ["healthdirect", /not in the active catalogue/i],
      ["nps-medicinewise", /historical/i],
      ["etg-complete", /link-only/i],
      ["australian-medicines-handbook", /link-only/i],
    ] as const) {
      expect(() => buildPublicSourceActivationManifest(manifestInput({ catalogueKey }))).toThrow(message);
    }
  });

  it("permits bounded quarantine and retirement evidence without making content fetchable", () => {
    expect(buildPublicSourceActivationManifest(manifestInput({ decision: "quarantine" }))).toMatchObject({
      catalogueKey: "wa-health",
      decision: "quarantine",
    });
    expect(buildPublicSourceActivationManifest(manifestInput({ decision: "retire" }))).toMatchObject({
      catalogueKey: "wa-health",
      decision: "retire",
    });
  });

  it("fails closed on policy drift or incomplete operator evidence", () => {
    const valid = buildPublicSourceActivationManifest(manifestInput());
    for (const mutation of [
      { sourcePolicyVersion: "old-policy" },
      { sourcePolicyDigest: `sha256:${"0".repeat(64)}` },
      { operatorId: "not-a-uuid" },
      { reason: " " },
      { evidenceReferences: [] },
    ]) {
      expect(() => parsePublicSourceActivationManifestV1({ ...valid, ...mutation })).toThrow();
    }
  });
});
