// src/lib/caring-contacts/message-policy.ts
//
// Mechanism only. The content this module checks against — prohibited terms, the required
// programme/hours/emergency/crisis-support fragments, the closing statement, and the maximum
// segment count — all live in message-rules.ts and change there, wholesale, without editing
// this file. See message-rules.ts for why.
import type { MessageType } from "./model";
import { PROVISIONAL_MESSAGE_RULES } from "./message-rules";

// The GSM-7 default alphabet (basic set) and its extension table, per the SMS standard. These
// character sets and the 160/153 septet thresholds are a fixed telecom specification, not
// provisional clinical content, so they live here rather than in message-rules.ts.
const GSM_7_BASIC_CHARACTERS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_7_EXTENSION_CHARACTERS = new Set("\f^{}\\[~]|€");
const GSM_7_SINGLE_SEGMENT_LIMIT = 160;
const GSM_7_MULTI_SEGMENT_UNIT = 153;

export type Gsm7Evidence = {
  valid: boolean;
  segments: number;
  septets: number;
  invalidCharacters: string[];
};

/**
 * Counts GSM-7 septets for `text` and derives the SMS segment count. Basic-set characters cost
 * 1 septet, extension-set characters cost 2, and anything else makes the message invalid (the
 * device would substitute or drop it) — reported with `valid: false` and `segments: 0`.
 */
export function calculateGsm7(text: string): Gsm7Evidence {
  let septets = 0;
  const invalidCharacters: string[] = [];

  for (const character of text) {
    if (GSM_7_BASIC_CHARACTERS.has(character)) septets += 1;
    else if (GSM_7_EXTENSION_CHARACTERS.has(character)) septets += 2;
    else if (!invalidCharacters.includes(character)) invalidCharacters.push(character);
  }

  if (invalidCharacters.length > 0) {
    return { valid: false, septets, segments: 0, invalidCharacters };
  }
  const segments =
    septets === 0 ? 0 : septets <= GSM_7_SINGLE_SEGMENT_LIMIT ? 1 : Math.ceil(septets / GSM_7_MULTI_SEGMENT_UNIT);
  return { valid: true, septets, segments, invalidCharacters };
}

export type GovernedMessageInput = {
  text: string;
  messageType: MessageType;
  /** The recipient's own mobile number, if known, so it can be checked for leakage into the text. */
  patientMobileNumber?: string;
};

export type MessageValidationIssue =
  | { code: "exceeds-two-segments"; septets: number; segments: number }
  | { code: "prohibited-term"; term: string }
  | { code: "first-message-missing-support-information" }
  | { code: "closing-message-missing-ending-statement" }
  | { code: "closing-message-missing-support-information" }
  | { code: "contains-patient-mobile" }
  | { code: "solicits-reply" };

export type ValidationResult = { valid: true } | { valid: false; issues: MessageValidationIssue[] };

/**
 * Checks a fully substituted outgoing message against the current PROVISIONAL_MESSAGE_RULES.
 * Pure and synchronous: no network, model, or provider call, and no mutation of `input`.
 */
export function validateGovernedMessage(input: GovernedMessageInput): ValidationResult {
  const rules = PROVISIONAL_MESSAGE_RULES;
  const issues: MessageValidationIssue[] = [];
  const text = input.text;

  const gsm7 = calculateGsm7(text);
  if (gsm7.valid && gsm7.segments > rules.maxSegments) {
    issues.push({ code: "exceeds-two-segments", septets: gsm7.septets, segments: gsm7.segments });
  }

  const lowerText = text.toLowerCase();
  for (const term of rules.prohibitedTerms) {
    if (lowerText.includes(term.toLowerCase())) {
      issues.push({ code: "prohibited-term", term });
    }
  }

  if (input.messageType === "first") {
    const hasFullSupportInformation =
      text.includes(rules.programmeLine) &&
      text.includes(rules.operatingHours) &&
      text.includes(rules.emergencyDirection) &&
      text.includes(rules.crisisSupportContact);
    if (!hasFullSupportInformation) {
      issues.push({ code: "first-message-missing-support-information" });
    }
  }

  if (input.messageType === "closing") {
    if (!text.includes(rules.closingStatement)) {
      issues.push({ code: "closing-message-missing-ending-statement" });
    }
    const hasSupportInformation = text.includes(rules.programmeLine) && text.includes(rules.crisisSupportContact);
    if (!hasSupportInformation) {
      issues.push({ code: "closing-message-missing-support-information" });
    }
  }

  if (input.patientMobileNumber && text.includes(input.patientMobileNumber)) {
    issues.push({ code: "contains-patient-mobile" });
  }

  if (text.includes("?")) {
    issues.push({ code: "solicits-reply" });
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}
