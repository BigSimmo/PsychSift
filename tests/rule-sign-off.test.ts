import { describe, expect, it } from "vitest";

import {
  APPROVED_RULE_SIGNERS,
  isApprovedSigner,
  isNamedPerson,
  ruleContentSha256,
  ruleGate,
  UNSIGNED,
  type ApprovedRuleSigner,
  type RuleSignOff,
} from "@/lib/admin/rule-sign-off";

const SIGNER_ID = "11111111-1111-4111-8111-111111111111";
const approved: readonly ApprovedRuleSigner[] = [{ userId: SIGNER_ID, name: "Dr Jane Example" }];
const content = { rules: { a: { hours: 10, quote: "at least a 10 hour break" } } };

function signed(overrides: Partial<RuleSignOff> = {}): RuleSignOff {
  return {
    enabled: true,
    signedBy: "Dr Jane Example",
    signedByUserId: SIGNER_ID,
    signedAt: "2026-10-02T01:30:00.000Z",
    signedContentSha256: ruleContentSha256(content),
    ...overrides,
  };
}

describe("isNamedPerson", () => {
  it("accepts a given and family name, with or without a title", () => {
    expect(isNamedPerson("Jane Example")).toBe(true);
    expect(isNamedPerson("Dr Jane Example")).toBe(true);
    expect(isNamedPerson("  A/Prof   Jane   Example ")).toBe(true);
  });

  it("rejects system names, roles, single names and blanks", () => {
    for (const name of [
      "PsychSift",
      "psychsift",
      "System",
      "Locally reviewed",
      "Dr Jane",
      "Jane",
      "Dr",
      "",
      "  ",
      null,
    ]) {
      expect(isNamedPerson(name)).toBe(false);
    }
    expect(isNamedPerson("PsychSift Team")).toBe(false);
    expect(isNamedPerson("Consultant Psychiatrist")).toBe(false);
    for (const role of ["Ward Lead", "Medical Director", "On Call", "Clinical Governance", "Not Signed"]) {
      expect(isNamedPerson(role)).toBe(false);
    }
    expect(isNamedPerson("Dr Jane Ward")).toBe(true);
  });
});

describe("ruleGate", () => {
  it("ships off: the empty sign-off is unsigned", () => {
    expect(ruleGate(UNSIGNED, content, approved)).toEqual({ on: false, reason: "unsigned" });
  });

  it("is on only with a named signer, a UTC time, a matching pin and the switch on", () => {
    expect(ruleGate(signed(), content, approved)).toEqual({ on: true });
  });

  it("rejects a sign-off dated after the evaluation time", () => {
    const future = signed({ signedAt: "9999-01-01T00:00:00.000Z" });
    expect(ruleGate(future, content, approved)).toEqual({ on: false, reason: "signed-in-future" });
    const at = Date.parse("2026-10-02T01:30:00.000Z");
    expect(ruleGate(signed(), content, approved, at)).toEqual({ on: true });
    expect(ruleGate(signed(), content, approved, at - 1)).toEqual({ on: false, reason: "signed-in-future" });
  });

  it("names the first reason it is off", () => {
    expect(ruleGate(signed({ signedBy: "PsychSift" }), content, approved)).toEqual({
      on: false,
      reason: "signer-not-approved",
    });
    expect(ruleGate(signed({ signedAt: "2026-10-04" }), content, approved)).toEqual({
      on: false,
      reason: "bad-sign-off-time",
    });
    expect(ruleGate(signed({ signedAt: "2026-10-04T09:30:00+08:00" }), content, approved)).toEqual({
      on: false,
      reason: "bad-sign-off-time",
    });
    expect(ruleGate(signed({ enabled: false }), content, approved)).toEqual({ on: false, reason: "switched-off" });
  });

  it("by default trusts only the committed signer list, which the owner writes with rules:sign", () => {
    expect(APPROVED_RULE_SIGNERS.some((signer) => signer.userId === SIGNER_ID)).toBe(false);
    expect(ruleGate(signed(), content)).toEqual({ on: false, reason: "signer-not-approved" });
  });

  it("fails closed unless the signer id is an approved UUID whose recorded name matches", () => {
    const off = { on: false, reason: "signer-not-approved" };
    expect(ruleGate(signed({ signedByUserId: null }), content, approved)).toEqual(off);
    expect(ruleGate(signed({ signedByUserId: "not-a-uuid" }), content, approved)).toEqual(off);
    expect(ruleGate(signed({ signedByUserId: "22222222-2222-4222-8222-222222222222" }), content, approved)).toEqual(
      off,
    );
    expect(ruleGate(signed({ signedBy: "Medical Director" }), content, approved)).toEqual(off);
    expect(ruleGate(signed({ signedBy: "Dr Someone Else" }), content, approved)).toEqual(off);
    expect(ruleGate(signed(), content, [])).toEqual(off);
    expect(isApprovedSigner(SIGNER_ID.toUpperCase(), "Dr Jane Example", approved)).toBe(true);
  });

  it("turns off when any figure changes after signing", () => {
    const edited = { rules: { a: { hours: 8, quote: "at least a 10 hour break" } } };
    expect(ruleGate(signed(), edited, approved)).toEqual({ on: false, reason: "content-changed-since-sign-off" });
  });

  it("pins content, not key order", () => {
    expect(ruleContentSha256({ b: 1, a: { d: 2, c: 3 } })).toBe(ruleContentSha256({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("ungated engines stay out of screens", () => {
  it("no page or component imports an *Ungated function", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(item.name) && /\b\w+Ungated\b/.test(readFileSync(path, "utf8")))
          offenders.push(path);
      }
    };
    walk("src/app");
    walk("src/components");
    expect(offenders).toEqual([]);
  });
});
