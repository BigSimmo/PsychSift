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
    expect(verifySiteContentRecoveryValidationBinding(activation, secret)).toBe(true);
    const rollback = createSiteContentRecoveryValidationBinding(
      { action: "rollback", ...fixture, expected },
      { expectedProjectRef: siteReleaseProjectRef, now: siteReleaseNow, secret },
    );
    expect(verifySiteContentRecoveryValidationBinding(rollback, secret)).toBe(true);
    expect(rollback.payloadDigest).not.toBe(activation.payloadDigest);
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
