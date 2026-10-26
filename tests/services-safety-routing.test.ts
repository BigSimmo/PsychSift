import { describe, expect, it } from "vitest";

import { catalogToServiceRecord } from "@/lib/service-catalog-mapper";
import { loadServicesSnapshot } from "@/lib/service-catalog";
import {
  detectClockTimeUrgency,
  detectServiceUrgentIntents,
  rankServiceUrgentRoutes,
} from "@/lib/service-urgent-routing";
import { rankServiceRecords } from "@/lib/service-ranker";
import { serviceRecords } from "@/lib/services";
import { serviceCatalogTags } from "@/lib/service-facets";
import { canonicalServiceRecords } from "@/lib/service-governance";

function titles(query: string, limit = 8) {
  return rankServiceRecords(serviceRecords, query, limit, [], true).map(({ service }) => service.title);
}

describe("services safety routing", () => {
  it("recognises high-consequence intent without conflating aftercare and postvention", () => {
    expect(detectServiceUrgentIntents("15-year-old actively suicidal in Bunbury tonight")).toEqual(
      expect.arrayContaining(["emergency", "camhs_crisis", "regional_after_hours"]),
    );
    expect(detectServiceUrgentIntents("discharged after a suicide attempt and needs follow-up")).toContain(
      "suicide_aftercare",
    );
    expect(detectServiceUrgentIntents("bereaved after my brother died by suicide")).toContain("suicide_postvention");
    expect(detectServiceUrgentIntents("bereaved after my brother died by suicide")).not.toContain("suicide_aftercare");
  });

  it("routes plain youth crisis wording to CAMHS Crisis Connect, 000 and MHERL (owner decision 15, 26 Oct D4)", () => {
    // "Youth", "young person" and "young people" do not say whether the person is under or over
    // 18, so both the CAMHS and the adult crisis line are pinned, CAMHS first and 000 straight after.
    for (const query of [
      "youth crisis",
      "youth self harm",
      "youths suicidal",
      "young person suicidal",
      "suicidal young people",
    ]) {
      expect(detectServiceUrgentIntents(query), query).toEqual([
        "camhs_crisis",
        "emergency",
        "adult_metro_crisis",
        "youth_crisis_lines",
      ]);
      expect(titles(query, 12).slice(0, 3), query).toEqual([
        "CAMHS Crisis Connect",
        "Emergency services",
        "Mental Health Emergency Response Line (MHERL)",
      ]);
    }
  });

  it("routes explicit under-18 wording to CAMHS Crisis Connect and 000 without the adult line, even when youth is also named", () => {
    // Owner decisions 2026-10-26 (D4, D9): CAMHS Crisis Connect, then 000, then Kids Helpline and Lifeline WA.
    for (const query of [
      "kid self harm",
      "kids suicidal",
      "child crisis",
      "children self harm",
      "teen suicidal",
      "teens in crisis",
      "suicidal teenager",
      "teenagers suicidal",
      "adolescent crisis",
      "adolescents suicidal",
      "16 year old self harm",
      "youth and child crisis",
      "suicidal teen youth",
      "young person aged 15-year-old suicidal",
    ]) {
      expect(detectServiceUrgentIntents(query), query).toEqual(["camhs_crisis", "emergency", "youth_crisis_lines"]);
      const pinned = rankServiceRecords(serviceRecords, query, 12, [], true)
        .filter(({ reasons }) => reasons.includes("urgent route"))
        .map(({ service }) => service.title);
      expect(pinned, query).toEqual(["CAMHS Crisis Connect", "Emergency services", "Kids Helpline", "Lifeline WA"]);
      expect(titles(query, 12)[0], query).toBe("CAMHS Crisis Connect");
    }
  });

  it("treats every self-harm word form as crisis wording", () => {
    for (const form of ["self harm", "self-harm", "selfharm", "self harming", "self-harmed", "selfharming"]) {
      expect(detectServiceUrgentIntents(`young person ${form}`), form).toEqual([
        "camhs_crisis",
        "emergency",
        "adult_metro_crisis",
        "youth_crisis_lines",
      ]);
      expect(detectServiceUrgentIntents(`child ${form}`), form).toEqual([
        "camhs_crisis",
        "emergency",
        "youth_crisis_lines",
      ]);
      expect(detectServiceUrgentIntents(`aboriginal man ${form}`), form).toContain("aboriginal_crisis");
    }
    // Only the self-harm words themselves: "harm" alone, or harm to others, is not crisis wording.
    expect(detectServiceUrgentIntents("child harm reduction")).toEqual([]);
  });

  it("keeps main's other urgent routes pinned alongside a youth crisis", () => {
    expect(detectServiceUrgentIntents("aboriginal youth suicide")).toEqual([
      "camhs_crisis",
      "emergency",
      "aboriginal_crisis",
      "adult_metro_crisis",
      "youth_crisis_lines",
    ]);
    expect(detectServiceUrgentIntents("youth overdose crisis")).toEqual(
      expect.arrayContaining(["emergency", "camhs_crisis", "adult_metro_crisis", "aod_urgent"]),
    );
    expect(detectServiceUrgentIntents("youth overdose crisis")[0]).toBe("emergency");
  });

  it("pins the immediate emergency, CAMHS crisis and regional after-hours routes for a clear youth crisis", () => {
    const resultTitles = titles("15-year-old actively suicidal in Bunbury tonight", 8);
    expect(resultTitles.slice(0, 4)).toEqual(
      expect.arrayContaining(["Emergency services", "CAMHS Crisis Connect", "Rurallink"]),
    );
  });

  it("never pins planned, closed, superseded or temporarily-unavailable services as an immediate route", () => {
    const matches = rankServiceRecords(
      serviceRecords,
      "15-year-old actively suicidal in Bunbury tonight",
      12,
      [],
      true,
    );
    const pinned = matches.filter(({ reasons }) => reasons.includes("urgent route"));
    expect(pinned.length).toBeGreaterThan(0);
    for (const { service, reasons } of pinned) {
      const status = service.verification?.availabilityStatus ?? "active";
      // A camhs_crisis match is allowed to stay pinned when it is only "unknown" (not yet
      // re-verified) rather than a confirmed non-active status — see service-urgent-routing.ts.
      // Every other urgent intent still requires a fully active, confirmed status.
      const isCamhsCrisis = reasons.includes("camhs crisis");
      if (isCamhsCrisis) {
        expect(["active", "unknown"]).toContain(status);
      } else {
        expect(status).toBe("active");
      }
    }
  });
});

describe("Aboriginal, AOD, family violence and sexual assault urgent routing", () => {
  it("pins 13YARN for an Aboriginal crisis query", () => {
    expect(detectServiceUrgentIntents("aboriginal man suicidal")).toContain("aboriginal_crisis");
    expect(titles("aboriginal man suicidal", 8).slice(0, 3)).toContain("13YARN");
  });

  it("pins the Alcohol and Drug Support Line for an urgent AOD query", () => {
    expect(detectServiceUrgentIntents("drunk and wants detox advice")).toContain("aod_urgent");
    expect(titles("drunk and wants detox advice", 8).slice(0, 3)).toContain("Alcohol and Drug Support Line");
  });

  it("pins the Women's Domestic Violence Helpline first and 1800RESPECT second for a family violence query", () => {
    // Owner decision (Josh, 2026-09-26): WA's own 24-hour helpline leads, 1800RESPECT straight after.
    expect(detectServiceUrgentIntents("partner hitting her")).toContain("family_violence");
    const resultTitles = titles("partner hitting her", 8);
    expect(resultTitles[0]).toBe("Women's Domestic Violence Helpline");
    expect(resultTitles[1]).toBe("1800RESPECT");
    expect(resultTitles.slice(0, 3)).toContain("1800RESPECT");

    const urgent = rankServiceUrgentRoutes(serviceRecords, "partner hitting her");
    expect(urgent.map(({ service }) => service.title)).toEqual(["Women's Domestic Violence Helpline", "1800RESPECT"]);
    expect(urgent[0].score).toBeGreaterThan(urgent[1].score);
  });

  it("still pins 1800RESPECT first when the Women's Domestic Violence Helpline is unusable", () => {
    const withoutHelpline = serviceRecords.filter((service) => service.title !== "Women's Domestic Violence Helpline");
    expect(withoutHelpline.length).toBe(serviceRecords.length - 1);
    const resultTitles = rankServiceRecords(withoutHelpline, "partner hitting her", 8, [], true).map(
      ({ service }) => service.title,
    );
    expect(resultTitles[0]).toBe("1800RESPECT");
    expect(resultTitles).not.toContain("Women's Domestic Violence Helpline");
  });

  it("keeps both family violence pins below an earlier emergency pin", () => {
    const urgent = rankServiceUrgentRoutes(serviceRecords, "partner strangling her, can't breathe");
    expect(urgent.map(({ service }) => service.title).slice(0, 3)).toEqual([
      "Emergency services",
      "Women's Domestic Violence Helpline",
      "1800RESPECT",
    ]);
    const scores = urgent.map(({ score }) => score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("pins SARC for a recent sexual assault query", () => {
    expect(detectServiceUrgentIntents("raped last night")).toContain("sexual_assault");
    expect(titles("raped last night", 8).slice(0, 3)).toContain("Sexual Assault Resource Centre (SARC)");
  });
});

describe("regional WA daytime versus after-hours routing", () => {
  it("pins the Kimberley WACHS record, not Rurallink, for a daytime regional crisis query", () => {
    const intents = detectServiceUrgentIntents("Kununurra crisis 10am Tuesday");
    expect(intents).toContain("regional_daytime");

    const resultTitles = titles("Kununurra crisis 10am Tuesday", 8);
    expect(resultTitles[0]).toBe("WACHS Kimberley Adult Mental Health Service");
    expect(resultTitles[0]).not.toBe("Rurallink");
  });

  it("still pins the Kimberley WACHS record first for an explicit mid-afternoon time", () => {
    // Regression for the "bare pm" bug: 2pm is well inside WACHS regional clinic
    // hours (8.30am-4.30pm), so it must resolve to the daytime route, not RuralLink.
    const intents = detectServiceUrgentIntents("Kununurra crisis 2pm");
    expect(intents).toContain("regional_daytime");
    // The Rule (controller ruling): keep RuralLink pinned second since the time is
    // still only a stated clock time, not a live clock — never drop it outright.
    expect(intents).toContain("regional_after_hours");
    expect(intents.indexOf("regional_daytime")).toBeLessThan(intents.indexOf("regional_after_hours"));

    const resultTitles = titles("Kununurra crisis 2pm", 8);
    expect(resultTitles[0]).toBe("WACHS Kimberley Adult Mental Health Service");
  });

  it("pins Rurallink, and only Rurallink, for an after-hours regional crisis query", () => {
    const intents = detectServiceUrgentIntents("Busselton crisis 11pm");
    expect(intents).not.toContain("regional_daytime");
    expect(intents).toContain("regional_after_hours");

    expect(titles("Busselton crisis 11pm", 8)[0]).toBe("Rurallink");
  });

  it("does not pin the wrong region when the named place has no WACHS regional record", () => {
    // Kalgoorlie is Goldfields, which has no SVC-REG-* record — a daytime crisis
    // query naming it must not silently pin a different region's clinic.
    const intents = detectServiceUrgentIntents("Kalgoorlie crisis 10am Tuesday");
    expect(intents).not.toContain("regional_daytime");
    expect(intents.every((intent) => !intent.startsWith("regional"))).toBe(true);
  });
});

describe("detectClockTimeUrgency — clock time vs WACHS regional clinic hours (8.30am-4.30pm)", () => {
  it.each([
    ["2pm", "daytime"],
    ["4:30pm", "after_hours"],
    ["4:29pm", "daytime"],
    ["8am", "after_hours"],
    ["8:30am", "daytime"],
    ["11pm", "after_hours"],
    ["11 pm", "after_hours"],
    ["4:45pm", "after_hours"],
    ["7am", "after_hours"],
    ["midnight", "after_hours"],
    ["noon", "daytime"],
    ["midday", "daytime"],
    ["07:30", "after_hours"],
    ["2230hrs", "after_hours"],
    ["2230 hrs", "after_hours"],
    ["2230h", "after_hours"],
    // A bare four-digit number with no "h"/"hrs"/"hours" marker is not read as a
    // time at all — see the "referral dated 14/03/2026" regression below, where
    // "2026" alone must not be misread as 20:26.
    ["2230", "unknown"],
    ["2026", "unknown"],
    ["no time mentioned at all", "unknown"],
  ] as const)("classifies %j as %s", (phrase, expected) => {
    expect(detectClockTimeUrgency(`crisis at ${phrase} please help`)).toBe(expected);
  });
});

describe("bare four-digit numbers must not be misread as military time (#reviewer-finding-1)", () => {
  it("does not lose the daytime WACHS pin to a year written in a referral date", () => {
    const intents = detectServiceUrgentIntents("Kununurra crisis, referral dated 14/03/2026");
    expect(intents).toContain("regional_daytime");
    expect(intents[0]).toBe("regional_daytime");

    expect(titles("Kununurra crisis, referral dated 14/03/2026", 8)[0]).toBe(
      "WACHS Kimberley Adult Mental Health Service",
    );
  });

  it("still reads an explicitly marked military time as after-hours", () => {
    const intents = detectServiceUrgentIntents("Kununurra crisis 2230hrs");
    expect(intents).not.toContain("regional_daytime");
    expect(intents).toContain("regional_after_hours");

    expect(titles("Kununurra crisis 2230hrs", 8)[0]).toBe("Rurallink");
  });
});

describe("family violence detection is symmetric (#reviewer-finding-2)", () => {
  it.each([["abused by her partner"], ["assaulted by her husband"], ["my ex keeps threatening me"]] as const)(
    "detects family violence in %j regardless of word order",
    (query) => {
      expect(detectServiceUrgentIntents(query)).toContain("family_violence");
    },
  );
});

describe("strangulation/choking is an immediate-danger emergency (#reviewer-finding-3)", () => {
  it("pins emergency first and family_violence second for a strangulation-in-progress query", () => {
    const intents = detectServiceUrgentIntents("partner strangling her, can't breathe");
    expect(intents.slice(0, 2)).toEqual(["emergency", "family_violence"]);

    expect(titles("partner strangling her, can't breathe", 8)[0]).toBe("Emergency services");
  });
});

describe("aod_urgent requires a real urgency signal, not just a generic help word (#reviewer-finding-5)", () => {
  it("does not pin the AOD line for a routine, non-urgent request", () => {
    expect(detectServiceUrgentIntents("alcohol counselling referral")).not.toContain("aod_urgent");
  });

  it("pins the AOD line for a genuine withdrawal in progress", () => {
    expect(detectServiceUrgentIntents("withdrawing from alcohol, shaking")).toContain("aod_urgent");
  });
});

describe("services provenance presentation", () => {
  it("keeps evidence URLs out of contact links unless the URL is the service website", () => {
    const snapshot = loadServicesSnapshot();
    const mherl = snapshot.services.find((service) => service.name.includes("Mental Health Emergency Response Line"));
    expect(mherl).toBeTruthy();

    const record = catalogToServiceRecord(mherl!);
    const websiteContacts = record.contacts?.filter((contact) => contact.kind === "web") ?? [];
    const expected = mherl!.service_website ? [mherl!.service_website] : [];
    expect(websiteContacts.map((contact) => contact.value)).toEqual(expected);
    expect(websiteContacts.every((contact) => contact.detail === "Service website")).toBe(true);
    expect(record.source?.url).toBe(mherl!.public_source_urls[0]);
  });

  it("does not label non-active or overdue records as source checked", () => {
    const snapshot = loadServicesSnapshot();
    const nonActive = snapshot.services.find(
      (service) => service.availability_status && service.availability_status !== "active",
    );
    expect(nonActive).toBeTruthy();
    const record = catalogToServiceRecord(nonActive!);
    expect(record.source?.status).not.toBe("Source checked");
  });

  it("splits a composite Metro/Peel phone contact into separately-dialable numbers", () => {
    const snapshot = loadServicesSnapshot();
    const mherl = snapshot.services.find((service) => service.name.includes("Mental Health Emergency Response Line"));
    expect(mherl).toBeTruthy();

    const record = catalogToServiceRecord(mherl!);
    const phoneContacts = record.contacts?.filter((contact) => contact.kind === "phone") ?? [];
    expect(phoneContacts.length).toBe(2);
    const compact = phoneContacts.map((contact) => contact.value?.replace(/[^\d+]/g, ""));
    expect(compact).toEqual(["1300555788", "1800676822"]);
    // Never a single contact holding both numbers concatenated into one undialable string.
    expect(compact.every((value) => value !== "13005557881800676822")).toBe(true);
  });

  it("splits a composite Metro/Country phone contact into separately-dialable numbers", () => {
    const snapshot = loadServicesSnapshot();
    const aod = snapshot.services.find((service) => service.name === "Alcohol and Drug Support Line");
    expect(aod).toBeTruthy();

    const record = catalogToServiceRecord(aod!);
    const phoneContacts = record.contacts?.filter((contact) => contact.kind === "phone") ?? [];
    expect(phoneContacts.length).toBe(2);
    const compact = phoneContacts.map((contact) => contact.value?.replace(/[^\d+]/g, ""));
    expect(compact).toEqual(["0894425000", "1800198024"]);
  });
});

describe("sexual assault, family violence and postvention records", () => {
  const byId = new Map(canonicalServiceRecords().map((record) => [record.id, record]));

  it("carries the sexual assault and family violence crisis routes the catalogue was missing", () => {
    for (const id of ["SVC-SV-001", "SVC-FDV-003"]) {
      const record = byId.get(id);
      expect(record, `${id} is missing from the canonical catalogue`).toBeDefined();
      expect(record?.tier).toBe("A_immediate");
      expect(record?.status).toBe("active");
      expect(record?.contacts.some((contact) => contact.value.trim())).toBe(true);
      expect(record?.hours.display.trim()).not.toBe("");
    }
  });

  it("keeps postvention and aftercare off the immediate tier and says so in the record", () => {
    for (const id of ["SVC-SUI-003", "SVC-POS-001", "SVC-POS-002", "SVC-POS-003", "SVC-POS-004"]) {
      const record = byId.get(id);
      expect(record, `${id} is missing from the canonical catalogue`).toBeDefined();
      expect(record?.tier).toBe("B_common_referral");
      expect(record?.notFor.some((value) => /not an acute crisis line/i.test(value))).toBe(true);
    }
  });

  it("does not claim hours a source page never stated", () => {
    for (const id of ["SVC-SUI-003", "SVC-SUI-004", "SVC-POS-001", "SVC-POS-002", "SVC-POS-003", "SVC-POS-004"]) {
      expect(byId.get(id)?.hours.verification_status).toBe("unable_to_verify");
    }
  });

  it("gives every new record a dated source from the publisher's own page", () => {
    for (const id of [
      "SVC-SV-001",
      "SVC-FDV-003",
      "SVC-SUI-003",
      "SVC-SUI-004",
      "SVC-POS-001",
      "SVC-POS-002",
      "SVC-POS-003",
      "SVC-POS-004",
    ]) {
      const sources = byId.get(id)?.sources ?? [];
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.accessed).toBe("2026-09-16");
        expect(source.date).toMatch(/\b(19|20)\d{2}\b/);
      }
    }
  });
});

describe("canonical records that must not merge into a legacy entry", () => {
  it("keeps the KEMH Mother Baby Unit separate from the Fiona Stanley record", () => {
    const slugs = new Set(serviceRecords.map((record) => record.slug));
    // The legacy Fiona Stanley entry carries "Mother Baby Unit" as a merged alias, so a
    // generic match key on the KEMH record silently merged the two and union-ed their
    // tags, producing a record that named one hospital and dialled the other.
    expect(slugs.has("kemh-mother-baby-unit")).toBe(true);
    expect(slugs.has("mother-and-baby-mental-health-unit-fiona-stanley-hospital")).toBe(true);
  });

  it("gives every service exactly one substance flag, which a silent merge breaks", () => {
    for (const record of serviceRecords) {
      expect(serviceCatalogTags(record).substance_flags, `${record.slug} substance flags`).toHaveLength(1);
    }
  });
});

describe("general crisis queries pin 000, MHERL, and Lifeline without demographic/location constraints", () => {
  it.each(["crisis", "suicide", "suicidal", "mental health emergency", "self harm"])(
    "pins Emergency services, MHERL, and Lifeline for %j",
    (query) => {
      const intents = detectServiceUrgentIntents(query);
      expect(intents).toEqual(["emergency", "adult_metro_crisis"]);

      const resultTitles = titles(query, 8);
      expect(resultTitles.slice(0, 3)).toEqual([
        "Emergency services",
        "Mental Health Emergency Response Line (MHERL)",
        "Lifeline WA",
      ]);
    },
  );
});
