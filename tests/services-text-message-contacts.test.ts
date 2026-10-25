import { describe, expect, it } from "vitest";

import { extractTextOnlyPhones } from "@/lib/service-catalog";
import { getServiceRecord } from "@/lib/services";

describe("text-message-only service numbers", () => {
  it("keeps a text-message-only crisis number out of the phone (tel:) contacts", () => {
    // Lifeline's contact reads "13 11 14; text 0477 13 11 14". The mobile only takes
    // texts, so it must not become a numbered phone a person in crisis might call.
    const lifeline = getServiceRecord("lifeline");
    expect(lifeline?.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Contact", value: "13 11 14", kind: "phone" }),
        expect.objectContaining({ label: "Text message", value: "0477 13 11 14", kind: "text" }),
      ]),
    );
    expect(lifeline?.contacts?.some((contact) => contact.kind === "phone" && /0477/.test(contact.value ?? ""))).toBe(
      false,
    );
    expect(lifeline?.referralInfo).toEqual(expect.arrayContaining([{ label: "Text message", value: "0477 13 11 14" }]));
    expect(lifeline?.referralInfo?.some((row) => /phone/i.test(row.label) && /0477/.test(row.value ?? ""))).toBe(false);
  });

  it("reads the words before each number, so a number for calls stays a phone number", () => {
    expect([...extractTextOnlyPhones("Call 13 11 14 or text 0477 13 11 14")]).toEqual(["0477 13 11 14"]);
    expect([...extractTextOnlyPhones("13 11 14; SMS 0477 13 11 14")]).toEqual(["0477 13 11 14"]);
    // A number offered for both is still a phone number, and the voice relay is not SMS.
    expect([...extractTextOnlyPhones("Call or text 0477 13 11 14")]).toEqual([]);
    expect([...extractTextOnlyPhones("text relay 1800 555 677")]).toEqual([]);
  });
});
