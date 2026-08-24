import { describe, expect, it } from "vitest";

import {
  createSiteContentRecoveryValidationBinding,
  verifySiteContentRecoveryValidationBinding,
} from "../src/lib/site-content/site-content-recovery-authority";
import { activationReceiptDigest } from "../src/lib/recovery-readiness-evidence";
import {
  fixtureSha,
  siteReleaseNow,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

describe("site-content P05 server validation authority", () => {
  it("accepts the same valid P05 activation/rollback fixture and produces a purpose-bound server binding", () => {
    const fixture = validSiteReleaseRecoveryFixture();
    const secret = "synthetic-validation-secret-with-32-bytes";
    const expected = {
      resource: fixture.activation.resource,
      previousResource: fixture.activation.previousResource,
      stateDigest: fixture.activation.stateDigest,
    };
    const activation = createSiteContentRecoveryValidationBinding(
      { action: "activate", ...fixture, rollback: undefined, expected },
      { expectedProjectRef: siteReleaseProjectRef, now: siteReleaseNow, secret },
    );
    const verification = {
      secret,
      expectedPurpose: "activate" as const,
      expectedProjectRef: siteReleaseProjectRef,
      expectedRecoveryEvidenceDigest: fixture.evidence.digest,
      payload: { action: "activate", evidence: fixture.evidence, activation: fixture.activation },
      now: siteReleaseNow,
    };
    expect(verifySiteContentRecoveryValidationBinding(activation, verification)).toBe(true);
    const rollback = createSiteContentRecoveryValidationBinding(
      { action: "rollback", ...fixture, expected },
      { expectedProjectRef: siteReleaseProjectRef, now: siteReleaseNow, secret },
    );
    expect(
      verifySiteContentRecoveryValidationBinding(rollback, {
        ...verification,
        expectedPurpose: "rollback",
        payload: {
          action: "rollback",
          evidence: fixture.evidence,
          activation: fixture.activation,
          rollback: fixture.rollback,
        },
      }),
    ).toBe(true);
    expect(rollback.payloadDigest).not.toBe(activation.payloadDigest);
  });

  it("fails closed across the SQL-compatible secret, purpose, project, payload, time, and MAC boundary", () => {
    const fixture = validSiteReleaseRecoveryFixture();
    const secret = "synthetic-validation-secret-with-32-bytes";
    const payload = { action: "activate", evidence: fixture.evidence, activation: fixture.activation };
    const binding = createSiteContentRecoveryValidationBinding(
      {
        action: "activate",
        ...fixture,
        rollback: undefined,
        expected: {
          resource: fixture.activation.resource,
          previousResource: fixture.activation.previousResource,
          stateDigest: fixture.activation.stateDigest,
        },
      },
      { expectedProjectRef: siteReleaseProjectRef, now: siteReleaseNow, secret },
    );
    const valid = {
      secret,
      expectedPurpose: "activate" as const,
      expectedProjectRef: siteReleaseProjectRef,
      expectedRecoveryEvidenceDigest: fixture.evidence.digest,
      payload,
      now: siteReleaseNow,
    };
    for (const mutation of [
      { ...valid, secret: "wrong-synthetic-validation-secret-32-bytes" },
      { ...valid, secret: "" },
      { ...valid, expectedPurpose: "rollback" as const },
      { ...valid, expectedProjectRef: "foreignproject000000" },
      { ...valid, payload: { ...payload, action: "rollback" } },
      { ...valid, now: new Date("2026-08-24T12:06:00.000Z") },
    ]) {
      expect(() => verifySiteContentRecoveryValidationBinding(binding, mutation)).not.toThrow();
      expect(verifySiteContentRecoveryValidationBinding(binding, mutation)).toBe(false);
    }
    expect(verifySiteContentRecoveryValidationBinding({ ...binding, mac: "0".repeat(64) }, valid)).toBe(false);
  });

  it.each([
    ["foreign project", { projectRef: "foreignproject000000" }],
    ["future receipt", { recordedAt: "2026-08-25T08:00:00.000Z" }],
    ["after validity", { recordedAt: "2026-08-25T07:00:00.000Z" }],
    [
      "wrong predecessor",
      { previousResource: { kind: "site-release", releaseId: crypto.randomUUID(), releaseDigest: fixtureSha("9") } },
    ],
  ])("rejects %s exactly as P05", (_label, mutation) => {
    const fixture = validSiteReleaseRecoveryFixture();
    const activationPayload = { ...fixture.activation, ...mutation };
    const activation = { ...activationPayload, digest: activationReceiptDigest(activationPayload) };
    const expected = {
      resource: fixture.activation.resource,
      previousResource: fixture.activation.previousResource,
      stateDigest: fixture.activation.stateDigest,
    };
    expect(() =>
      createSiteContentRecoveryValidationBinding(
        { action: "activate", evidence: fixture.evidence, activation, expected },
        { expectedProjectRef: siteReleaseProjectRef, now: siteReleaseNow, secret: "synthetic-secret" },
      ),
    ).toThrow();
  });
});
