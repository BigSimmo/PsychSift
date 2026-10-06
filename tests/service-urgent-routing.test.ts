import { describe, expect, it } from "vitest";

import { detectServiceUrgentIntents } from "@/lib/service-urgent-routing";
import { rankServiceRecords } from "@/lib/service-ranker";
import { serviceRecords } from "@/lib/services";

function titles(query: string, limit = 8) {
  return rankServiceRecords(serviceRecords, query, limit, [], true).map(({ service }) => service.title);
}

describe("service urgent routing — Requirement R2", () => {
  describe("general crisis queries pin 000, MHERL, and Lifeline without demographic or location constraints", () => {
    it.each([
      "crisis",
      "suicide",
      "suicidal",
      "mental health emergency",
      "self harm",
      "kill myself",
      "end my life",
      "take my own life",
      "hang myself",
      "bottle of pills",
    ])("pins Emergency services, MHERL, and Lifeline for %j", (query) => {
      const intents = detectServiceUrgentIntents(query);
      expect(intents).toEqual(["emergency", "adult_metro_crisis"]);

      const resultTitles = titles(query, 8);
      expect(resultTitles.slice(0, 3)).toEqual([
        "Emergency services",
        "Mental Health Emergency Response Line (MHERL)",
        "Lifeline WA",
      ]);
    });
  });

  describe("preserves youth crisis priorities", () => {
    it("pins CAMHS Crisis Connect first and MHERL second for youth queries", () => {
      for (const query of [
        "youth crisis",
        "youth self harm",
        "youths suicidal",
        "young person suicidal",
        "suicidal young people",
      ]) {
        expect(detectServiceUrgentIntents(query)).toEqual(["camhs_crisis", "adult_metro_crisis"]);
        expect(titles(query, 8).slice(0, 2)).toEqual([
          "CAMHS Crisis Connect",
          "Mental Health Emergency Response Line (MHERL)",
        ]);
      }
    });

    it("pins CAMHS Crisis Connect alone for explicit under-18 crisis queries", () => {
      for (const query of [
        "child crisis",
        "teen suicidal",
        "16 year old self harm",
        "kids suicidal",
        "under 18 crisis",
        "<18 crisis",
        "minor crisis",
      ]) {
        expect(detectServiceUrgentIntents(query)).toEqual(["camhs_crisis"]);
        expect(titles(query, 8)[0]).toBe("CAMHS Crisis Connect");
      }
    });
  });

  describe("distinguishes non-acute suicidal intent", () => {
    it("routes suicide aftercare without pinning acute emergency lines", () => {
      const intents = detectServiceUrgentIntents("discharged after a suicide attempt and needs follow-up");
      expect(intents).toContain("suicide_aftercare");
      expect(intents).not.toContain("emergency");
      expect(intents).not.toContain("adult_metro_crisis");
    });

    it("routes suicide postvention without pinning acute emergency lines", () => {
      const intents = detectServiceUrgentIntents("bereaved after my brother died by suicide");
      expect(intents).toContain("suicide_postvention");
      expect(intents).not.toContain("emergency");
      expect(intents).not.toContain("adult_metro_crisis");
    });
  });

  describe("preserves regional crisis priorities", () => {
    it("pins regional daytime clinic first for daytime regional queries", () => {
      const intents = detectServiceUrgentIntents("Kununurra crisis 10am Tuesday");
      expect(intents).toContain("regional_daytime");
      expect(intents).not.toContain("emergency");
      expect(titles("Kununurra crisis 10am Tuesday", 8)[0]).toBe("WACHS Kimberley Adult Mental Health Service");
    });

    it("pins Rurallink first for after-hours regional queries", () => {
      const intents = detectServiceUrgentIntents("Busselton crisis 11pm");
      expect(intents).toContain("regional_after_hours");
      expect(intents).not.toContain("regional_daytime");
      expect(titles("Busselton crisis 11pm", 8)[0]).toBe("Rurallink");
    });

    it("pins Rurallink and retains emergency 000 for generic regional crisis queries", () => {
      const intents = detectServiceUrgentIntents("regional WA crisis");
      expect(intents).toContain("emergency");
      expect(intents).toContain("regional_after_hours");
      expect(intents).toContain("adult_metro_crisis");
    });
  });

  describe("immediate danger phrases pin adult metro crisis alongside emergency", () => {
    it.each(["overdose", "life-threatening severe injury", "actively suicidal"])(
      "pins emergency and adult_metro_crisis for %j",
      (query) => {
        const intents = detectServiceUrgentIntents(query);
        expect(intents).toContain("emergency");
        expect(intents).toContain("adult_metro_crisis");
      },
    );
  });
});

describe("service urgent routing — explicitly named services", () => {
  it("keeps a named service first while still pinning the crisis routes after it", () => {
    const resultTitles = titles("13YARN crisis support", 8);
    expect(resultTitles[0]).toMatch(/^13\s*YARN$/i);
    expect(resultTitles.slice(1, 4)).toEqual(
      expect.arrayContaining([
        "Emergency services",
        expect.stringMatching(/MHERL|Mental Health Emergency Response Line/),
      ]),
    );
  });

  it("does not let a bare crisis word claim a named-service lead", () => {
    expect(titles("crisis", 1)[0]).toBe("Emergency services");
  });
});
