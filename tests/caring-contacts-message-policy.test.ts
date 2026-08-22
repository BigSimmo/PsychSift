// tests/caring-contacts-message-policy.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PROVISIONAL_MESSAGE_RULES } from "@/lib/caring-contacts/message-rules";
import {
  calculateGsm7,
  validateGovernedMessage,
  type GovernedMessageInput,
} from "@/lib/caring-contacts/message-policy";

const rules = PROVISIONAL_MESSAGE_RULES;

const compliantFirstMessage = [
  rules.programmeLine,
  rules.operatingHours,
  rules.emergencyDirection,
  rules.crisisSupportContact,
].join(". ");

const compliantClosingMessage = [rules.closingStatement, rules.programmeLine, rules.crisisSupportContact].join(". ");

// ---------------------------------------------------------------------------
// Rule 1 — calculateGsm7 septet counting and segmentation
// ---------------------------------------------------------------------------

describe("rule 1: calculateGsm7 septet counting and segmentation", () => {
  it("counts a basic-set message of exactly 252 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(252));
    expect(evidence).toEqual({ valid: true, septets: 252, segments: 2, invalidCharacters: [] });
  });

  it("counts a basic-set message of exactly 218 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(218));
    expect(evidence).toEqual({ valid: true, septets: 218, segments: 2, invalidCharacters: [] });
  });

  it("counts a basic-set message of exactly 272 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(272));
    expect(evidence).toEqual({ valid: true, septets: 272, segments: 2, invalidCharacters: [] });
  });

  it("treats exactly 160 septets as a single segment", () => {
    const evidence = calculateGsm7("A".repeat(160));
    expect(evidence).toEqual({ valid: true, septets: 160, segments: 1, invalidCharacters: [] });
  });

  it("treats 161 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(161));
    expect(evidence).toEqual({ valid: true, septets: 161, segments: 2, invalidCharacters: [] });
  });

  it("scores an extension character at 2 septets", () => {
    // A = 1 septet, ^ = 2 septets (extension set), B = 1 septet => 4 septets, 1 segment.
    const evidence = calculateGsm7("A^B");
    expect(evidence).toEqual({ valid: true, septets: 4, segments: 1, invalidCharacters: [] });
  });

  it("flags a character outside both the basic and extension sets as invalid", () => {
    const evidence = calculateGsm7("Hello 🙂");
    expect(evidence.valid).toBe(false);
    expect(evidence.segments).toBe(0);
    expect(evidence.invalidCharacters).toEqual(["🙂"]);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — a fully substituted message over two segments fails validation
// ---------------------------------------------------------------------------

describe("rule 2: exceeds-two-segments", () => {
  it("passes a standard message of exactly 252 septets (2 segments)", () => {
    const input: GovernedMessageInput = { text: "A".repeat(252), messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("fails a standard message of 307 septets, reporting the exact septet and segment count", () => {
    const input: GovernedMessageInput = { text: "A".repeat(307), messageType: "standard" };
    const result = validateGovernedMessage(input);
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "exceeds-two-segments", septets: 307, segments: 3 }],
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — prohibited terms
// ---------------------------------------------------------------------------

describe("rule 3: prohibited-term", () => {
  it("fails and names the exact term when a seeded prohibited term is present", () => {
    const input: GovernedMessageInput = { text: "This is part of a campaign.", messageType: "standard" };
    const result = validateGovernedMessage(input);
    expect(result).toEqual({ valid: false, issues: [{ code: "prohibited-term", term: "campaign" }] });
  });

  it("reports every seeded prohibited term found in the message", () => {
    const input: GovernedMessageInput = {
      text: "Your engagement score improved after this campaign.",
      messageType: "standard",
    };
    const result = validateGovernedMessage(input);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.issues).toContainEqual({ code: "prohibited-term", term: "engagement score" });
    expect(result.issues).toContainEqual({ code: "prohibited-term", term: "campaign" });
  });

  it("passes a message that contains none of the seeded prohibited terms", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("seeds the prohibited term list from the Global Constraints vocabulary", () => {
    expect([...rules.prohibitedTerms].sort()).toEqual(
      [
        "high risk",
        "safe",
        "engagement score",
        "campaign",
        "lead",
        "conversion",
        "best match",
        "inbox",
        "conversation",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — a first message must carry full support information
// ---------------------------------------------------------------------------

describe("rule 4: first-message-missing-support-information", () => {
  it("passes a first message that contains the programme line, hours, emergency direction, and a crisis contact", () => {
    const input: GovernedMessageInput = { text: compliantFirstMessage, messageType: "first" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("fails when the programme line is missing", () => {
    const text = [rules.operatingHours, rules.emergencyDirection, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({ text, messageType: "first" });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("fails when the hours are missing", () => {
    const text = [rules.programmeLine, rules.emergencyDirection, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({ text, messageType: "first" });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("fails when the emergency direction is missing", () => {
    const text = [rules.programmeLine, rules.operatingHours, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({ text, messageType: "first" });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("fails when the crisis-support contact is missing", () => {
    const text = [rules.programmeLine, rules.operatingHours, rules.emergencyDirection].join(". ");
    const result = validateGovernedMessage({ text, messageType: "first" });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("does not apply this rule to standard messages", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — a closing message must state it is final and carry support information
// ---------------------------------------------------------------------------

describe("rule 5: closing-message-missing-ending-statement / closing-message-missing-support-information", () => {
  it("passes a closing message with the ending statement, programme line, and crisis contact", () => {
    const input: GovernedMessageInput = { text: compliantClosingMessage, messageType: "closing" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("fails with closing-message-missing-ending-statement when the final-message statement is absent", () => {
    const text = [rules.programmeLine, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({ text, messageType: "closing" });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "closing-message-missing-ending-statement" }],
    });
  });

  it("fails with closing-message-missing-support-information when the programme line is absent", () => {
    const text = [rules.closingStatement, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({ text, messageType: "closing" });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "closing-message-missing-support-information" }],
    });
  });

  it("fails with closing-message-missing-support-information when the crisis contact is absent", () => {
    const text = [rules.closingStatement, rules.programmeLine].join(". ");
    const result = validateGovernedMessage({ text, messageType: "closing" });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "closing-message-missing-support-information" }],
    });
  });

  it("reports both codes when both the ending statement and the support information are absent", () => {
    const result = validateGovernedMessage({ text: "Nothing relevant here.", messageType: "closing" });
    expect(result).toEqual({
      valid: false,
      issues: [
        { code: "closing-message-missing-ending-statement" },
        { code: "closing-message-missing-support-information" },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — a patient mobile number must never appear in the message
// ---------------------------------------------------------------------------

describe("rule 6: contains-patient-mobile", () => {
  it("fails when the message contains the patient's mobile number", () => {
    const input: GovernedMessageInput = {
      text: "Call us back on +61 491 570 006 any time.",
      messageType: "standard",
      patientMobileNumber: "+61 491 570 006",
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: false, issues: [{ code: "contains-patient-mobile" }] });
  });

  it("passes when the patient's mobile number is known but absent from the text", () => {
    const input: GovernedMessageInput = {
      text: "Thinking of you today.",
      messageType: "standard",
      patientMobileNumber: "+61 491 570 006",
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("passes when no patient mobile number is supplied", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — the service can never receive a reply, so it must never ask a question
// ---------------------------------------------------------------------------

describe("rule 7: solicits-reply", () => {
  it("fails a message containing a question mark", () => {
    const input: GovernedMessageInput = { text: "How are you doing?", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: false, issues: [{ code: "solicits-reply" }] });
  });

  it("passes an equivalent statement with no question mark", () => {
    const input: GovernedMessageInput = { text: "Thinking of how you are doing.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 8 — validateGovernedMessage never calls a network, model, or provider
// ---------------------------------------------------------------------------

describe("rule 8: validateGovernedMessage is a pure, provider-free function", () => {
  it("imports only from its own domain (model.ts, message-rules.ts) or the standard library", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "lib", "caring-contacts", "message-policy.ts"), "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("node:") || specifier === "./model" || specifier === "./message-rules").toBe(true);
    }
  });

  it("returns synchronously, not a Promise", () => {
    const result = validateGovernedMessage({ text: "Thinking of you today.", messageType: "standard" });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("is deterministic and does not mutate its input", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    const snapshotBefore = JSON.stringify(input);
    const first = validateGovernedMessage(input);
    const second = validateGovernedMessage(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshotBefore);
  });
});
