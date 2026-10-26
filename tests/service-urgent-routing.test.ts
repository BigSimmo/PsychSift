import { describe, expect, it } from "vitest";

import { detectServiceUrgentIntents, hasUnder18Wording } from "@/lib/service-urgent-routing";
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
    // Owner decisions 2026-10-26 (D4, D6, D9): CAMHS Crisis Connect, then 000, then the adult
    // lines, then Kids Helpline.
    it("pins CAMHS Crisis Connect, 000, MHERL, Lifeline WA and Kids Helpline for youth queries", () => {
      for (const query of [
        "youth crisis",
        "youth self harm",
        "youths suicidal",
        "young person suicidal",
        "suicidal young people",
        "15M suicidal",
        "16F self harm",
        "my daughter (14) is self harming",
      ]) {
        expect(detectServiceUrgentIntents(query), query).toEqual([
          "camhs_crisis",
          "emergency",
          "adult_metro_crisis",
          "youth_crisis_lines",
        ]);
        expect(titles(query, 8).slice(0, 5), query).toEqual([
          "CAMHS Crisis Connect",
          "Emergency services",
          "Mental Health Emergency Response Line (MHERL)",
          "Lifeline WA",
          "Kids Helpline",
        ]);
      }
    });

    // Owner decisions 2026-10-26 (D4, D5, D9): no adult MHERL line for explicit under-18 wording.
    it("pins CAMHS Crisis Connect, 000, Kids Helpline and Lifeline WA for explicit under-18 crisis queries", () => {
      for (const query of [
        "child crisis",
        "teen suicidal",
        "16 year old self harm",
        "16 yr old self harm",
        "16yo self harm",
        "16-yo self harm",
        "16 yo suicidal",
        "16 y/o suicidal",
        "15 y.o. suicidal",
        "kids suicidal",
        "under 18 crisis",
        "<18 crisis",
        "minor crisis",
        "aged 15, suicidal",
        "age 12 self harm",
        "15 yo boy suicidal",
        "14 girl self harm",
        "year 10 student suicidal",
        "high school student wants to die",
        "high schooler self harming",
      ]) {
        expect(detectServiceUrgentIntents(query), query).toEqual(["camhs_crisis", "emergency", "youth_crisis_lines"]);
        expect(titles(query, 8).slice(0, 4), query).toEqual([
          "CAMHS Crisis Connect",
          "Emergency services",
          "Kids Helpline",
          "Lifeline WA",
        ]);
      }
    });

    it("pins 000 first and CAMHS Crisis Connect second when an under-18 person has swallowed an amount", () => {
      expect(detectServiceUrgentIntents("my 15 year old took 20 panadol")).toEqual([
        "emergency",
        "camhs_crisis",
        "youth_crisis_lines",
      ]);
      expect(titles("my 15 year old took 20 panadol", 8).slice(0, 2)).toEqual([
        "Emergency services",
        "CAMHS Crisis Connect",
      ]);
    });

    it("keeps adult routing for adult ages and wording that only looks like an age", () => {
      for (const query of ["aged care crisis", "aged 75 suicidal", "age 18 suicidal", "jumped from 15 m suicidal"]) {
        expect(detectServiceUrgentIntents(query), query).toEqual(["emergency", "adult_metro_crisis"]);
      }
      for (const query of ["olanzapine 15mg", "aged 15 mg", "year 10 of the program", "school counsellor"]) {
        expect(hasUnder18Wording(query), query).toBe(false);
      }
      for (const query of ["16yo", "aged 15", "my 14 year old", "year 9 student"]) {
        expect(hasUnder18Wording(query), query).toBe(true);
      }
    });

    it("does not read adult or non-age shorthand as under-18 wording", () => {
      for (const query of ["18yo suicidal", "25 y/o suicidal", "16 you suicidal"]) {
        expect(detectServiceUrgentIntents(query), query).toEqual(["emergency", "adult_metro_crisis"]);
      }
    });

    it("pins only the owner-approved national youth lines", () => {
      // Owner decision 2026-10-26 (D9, #8CKX6F) approved the list held since 18 Oct: Kids Helpline
      // and Lifeline WA only. The Suicide Call Back Service is not pinned for youth searches, and
      // 13YARN is pinned only for Aboriginal or Torres Strait Islander wording.
      for (const query of ["youth self harm", "16yo self harm"]) {
        const topTitles = titles(query, 8);
        for (const line of ["Suicide Call Back Service", "13YARN"]) {
          expect(topTitles.slice(0, 5), `${query}: ${line}`).not.toContain(line);
        }
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

describe("service urgent routing — medical emergencies pin 000 first", () => {
  it.each([
    "patient having a seizure",
    "seizures",
    "convulsing",
    "unconscious",
    "unconsciousness",
    "loss of consciousness",
    "not breathing",
    "collapsed",
    "patient collapse",
    // Owner decision 2026-10-26 (D8).
    "status epilepticus",
    "patient fitting",
    "patient is fitting",
    "having a fit",
    "having seizures",
    "having a stroke",
    "stroke symptoms",
    "signs of a stroke",
    "chest pain",
    "crushing chest pain",
    "severe allergic reaction",
    "bleeding heavily after cutting",
    "can't wake him up",
    "blue lips",
  ])("pins Emergency services first for %j", (query) => {
    expect(detectServiceUrgentIntents(query)).toEqual(["emergency"]);
    expect(titles(query, 8)[0]).toBe("Emergency services");
  });

  it("pins 000 first and the Alcohol and Drug Support Line after it for an alcohol withdrawal seizure", () => {
    expect(detectServiceUrgentIntents("alcohol withdrawal seizure")).toEqual(["emergency", "aod_urgent"]);
    expect(titles("alcohol withdrawal seizure", 8).slice(0, 2)).toEqual([
      "Emergency services",
      "Alcohol and Drug Support Line",
    ]);
  });

  it("pins 000 ahead of regional crisis routes when a medical emergency is named", () => {
    const intents = detectServiceUrgentIntents("patient in crisis having a seizure in Bunbury");
    expect(intents[0]).toBe("emergency");
    expect(intents).toContain("regional_daytime");
    expect(titles("patient in crisis having a seizure in Bunbury", 8)[0]).toBe("Emergency services");
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

describe("service urgent routing — owner decisions of 26 Oct 2026", () => {
  it.each([
    "fitting the criteria",
    "fitting criteria for BPD",
    "risperidone stroke risk in dementia",
    "stroke rehab services",
    "post stroke depression",
    "fitness to drive",
    "fit for discharge",
    "epilepsy clinic referral",
    "bleeding risk with SSRIs",
    "took 2 tablets",
    "take 10 x 5 mg",
    "swallowed the whole tablet",
  ])("pins nothing for routine wording %j", (query) => {
    expect(detectServiceUrgentIntents(query)).toEqual([]);
  });

  it.each([
    "took a handful of pills",
    "swallowed a whole packet of paracetamol",
    "took my whole blister pack",
    "swallowed a bottle of pills",
    "pt ingested 20 x 25mg quetiapine",
    "took 30 tablets",
  ])("pins 000 first for swallowed-amount wording %j (D7)", (query) => {
    expect(detectServiceUrgentIntents(query)).toEqual(["emergency", "adult_metro_crisis"]);
    expect(titles(query, 8)[0]).toBe("Emergency services");
  });

  it("routes wanting to die as crisis wording", () => {
    for (const query of ["I want to die", "she wants to die", "wanna die", "wants to be dead"]) {
      expect(detectServiceUrgentIntents(query), query).toEqual(["emergency", "adult_metro_crisis"]);
    }
  });

  it("keeps regional routing first for an under-18 crisis", () => {
    expect(detectServiceUrgentIntents("teen suicidal tonight in Broome")).toEqual([
      "regional_after_hours",
      "camhs_crisis",
      "emergency",
      "youth_crisis_lines",
    ]);
  });
});
