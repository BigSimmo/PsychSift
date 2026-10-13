import { describe, expect, it } from "vitest";

import { POISONS_INFORMATION_CONTACT, WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { publicCrisisContacts } from "@/components/care-plan/mockups/fixtures";

describe("crisis-contacts", () => {
  it("is the one source of truth every surface re-exports, not a copy", () => {
    // Identity, not deep-equality: fixtures.ts must re-export this exact array
    // so a later correction here reaches every surface automatically.
    expect(publicCrisisContacts).toBe(WA_CRISIS_CONTACTS);
  });

  it("carries the seven WA/national public crisis lines in id order", () => {
    expect(WA_CRISIS_CONTACTS.map((contact) => contact.id)).toEqual([
      "SYN-CRISIS-CONTACT-001",
      "SYN-CRISIS-CONTACT-002",
      "SYN-CRISIS-CONTACT-003",
      "SYN-CRISIS-CONTACT-004",
      "SYN-CRISIS-CONTACT-005",
      "SYN-CRISIS-CONTACT-006",
      "SYN-CRISIS-CONTACT-007",
    ]);
  });

  it("keeps the four original WA numbers unchanged with their recorded verification dates", () => {
    const original = WA_CRISIS_CONTACTS.slice(0, 4);
    expect(original.map((contact) => ({ name: contact.name, telephoneDisplay: contact.telephoneDisplay }))).toEqual([
      { name: "Emergency services", telephoneDisplay: "000" },
      { name: "Mental Health Emergency Response Line (MHERL) — Perth metropolitan", telephoneDisplay: "1300 555 788" },
      { name: "Mental Health Emergency Response Line (MHERL) — Peel", telephoneDisplay: "1800 676 822" },
      { name: "Rurallink", telephoneDisplay: "1800 552 002" },
    ]);
    for (const contact of original) {
      expect(contact.verifiedOn).toBe(contact.id === "SYN-CRISIS-CONTACT-001" ? "2026-08-20" : "2026-09-27");
      expect(contact.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("keeps Lifeline, Suicide Call Back Service and 13YARN with official sources and recorded checks", () => {
    const added = WA_CRISIS_CONTACTS.slice(4);
    expect(added.map((contact) => ({ name: contact.name, telephoneDisplay: contact.telephoneDisplay }))).toEqual([
      { name: "Lifeline", telephoneDisplay: "13 11 14" },
      { name: "Suicide Call Back Service", telephoneDisplay: "1300 659 467" },
      { name: "13YARN (for Aboriginal and Torres Strait Islander people)", telephoneDisplay: "13 92 76" },
    ]);
    for (const contact of added) {
      expect(contact.verifiedOn).toBe(contact.id === "SYN-CRISIS-CONTACT-007" ? "2026-09-27" : "2026-09-25");
      expect(contact.sourceUrl).toMatch(/^https:\/\//);
      expect(contact.isEmergencyService).toBe(false);
    }
  });

  it("uses the owner-authorised wording for Lifeline and 13YARN (Ruling [144])", () => {
    // The exact patient-visible sentence the owner authorised (Ruling [144], first
    // written for the since-retired Caring Contacts prototype's message rules) is
    // "If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76." —
    // these two numbers must match that sentence exactly.
    const lifeline = WA_CRISIS_CONTACTS.find((contact) => contact.name === "Lifeline");
    // Looked up by name prefix: since 2026-09-25 the label also says who 13YARN is for.
    const thirteenYarn = WA_CRISIS_CONTACTS.find((contact) => contact.name.startsWith("13YARN"));
    expect(lifeline?.telephoneDisplay).toBe("13 11 14");
    expect(thirteenYarn?.telephoneDisplay).toBe("13 92 76");
  });

  it("gives every contact a telephoneUri that is its telephoneDisplay with spaces stripped", () => {
    for (const contact of WA_CRISIS_CONTACTS) {
      expect(contact.telephoneUri).toBe(contact.telephoneDisplay.replace(/\s+/g, ""));
    }
  });

  it("has no duplicate ids or telephone numbers", () => {
    const ids = WA_CRISIS_CONTACTS.map((contact) => contact.id);
    const numbers = WA_CRISIS_CONTACTS.map((contact) => contact.telephoneDisplay);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("keeps the Poisons Information Centre separate from the safety-plan list, with its source and check date", () => {
    expect(WA_CRISIS_CONTACTS.some((contact) => contact.telephoneDisplay === "13 11 26")).toBe(false);
    expect(POISONS_INFORMATION_CONTACT.telephoneDisplay).toBe("13 11 26");
    expect(POISONS_INFORMATION_CONTACT.telephoneUri).toBe("131126");
    expect(POISONS_INFORMATION_CONTACT.sourceUrl).toMatch(/^https:\/\/scgh\.health\.wa\.gov\.au\//);
    expect(POISONS_INFORMATION_CONTACT.verifiedOn).toBe("2026-10-13");
    expect(POISONS_INFORMATION_CONTACT.isEmergencyService).toBe(false);
  });
});
