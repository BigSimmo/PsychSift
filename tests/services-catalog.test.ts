import { describe, expect, it } from "vitest";

import { compactBestUseTitle, compactCatalogField, parseLabeledReferralDetails } from "@/lib/compact-best-use-title";
import { catalogToServiceRecord, mapCatalogToServiceRecords } from "@/lib/service-catalog-mapper";
import { extractPhones, loadServicesSnapshot, normalizeCatalogServices } from "@/lib/service-catalog";
import {
  readServiceCoreGroup,
  readServiceCoreGroupSelection,
  serviceCoreGroupIds,
  serviceMatchesCoreGroup,
  serviceMatchesCoreGroupSelection,
  writeServiceCoreGroupSelectionToParams,
} from "@/lib/service-core-groups";
import {
  getServiceRecord,
  loadServiceRecords,
  rankServiceRecords,
  searchServiceRecords,
  serviceRecords,
} from "@/lib/services";

describe("services catalogue", () => {
  it("loads the governed 252-service catalogue from snapshot", () => {
    const snapshot = loadServicesSnapshot();
    expect(snapshot.service_count).toBe(252);
    expect(snapshot.services).toHaveLength(252);
    expect(serviceRecords).toHaveLength(252);
    expect(loadServiceRecords()).toHaveLength(252);
  });

  it("maps 13yarn with phone and the confidence its evidence now supports", () => {
    const snapshot = loadServicesSnapshot();
    const yarn = snapshot.services.find((service) => service.canonical_name_key === "13yarn");
    expect(yarn).toBeTruthy();

    const record = catalogToServiceRecord(yarn!);
    expect(record.slug).toBe("13yarn");
    expect(record.title).toBe("13YARN");
    expect(record.primaryContact?.value).toContain("13 92 76");
    // Was Medium while the record was carried over from research with no hours and no
    // page check. A canonical record now supersedes it with 24/7 hours taken from the
    // Mental Health Commission page of 11 August 2026, so the confidence follows the
    // evidence. If this drops back to Medium the canonical record has stopped merging.
    expect(record.verification?.confidence).toBe("High");
  });

  it("compacts pipe-joined best-use blobs on summary cards", () => {
    const snapshot = loadServicesSnapshot();
    const adultHomeTreatment = snapshot.services.find(
      (service) => service.canonical_name_key === "adult-home-treatment-team",
    );
    expect(adultHomeTreatment?.best_use_indication?.includes("|")).toBe(true);
    expect(adultHomeTreatment!.best_use_indication.length).toBeGreaterThan(140);

    const record = catalogToServiceRecord(adultHomeTreatment!);
    const bestUseCard = record.summaryCards?.find((card) => card.id === "best-use");
    expect(bestUseCard?.title).toBe(
      "Intensive daily home treatment as alternative to admission or as step between hospital and community",
    );
    expect(bestUseCard?.title?.length).toBeLessThanOrEqual(120);
    expect(bestUseCard?.title?.includes("|")).toBe(false);
    expect(record.criteria?.some((criterion) => criterion.label.includes("|"))).toBe(false);
    expect(
      record.criteria?.some(
        (criterion) =>
          criterion.label ===
          "Intensive daily home treatment as alternative to admission or as step between hospital and community",
      ),
    ).toBe(true);
  });

  it("compacts route, eligibility, cost, and referral rows without pipe joins", () => {
    const snapshot = loadServicesSnapshot();
    const cads = snapshot.services.find(
      (service) => service.canonical_name_key === "community-alcohol-and-drug-services-cads-network",
    );
    expect(cads?.referral_details.includes("|")).toBe(true);
    expect(cads?.best_use_indication.includes("|")).toBe(false);

    const record = catalogToServiceRecord(cads!);
    expect(record.route).toBe("Nearest CADS; self-referral accepted");
    expect(record.route).not.toContain("|");
    expect(record.eligibility).not.toContain("|");
    expect(record.cost).toBe("Free/confidential");
    expect(record.bestUse).not.toContain("|");
    expect(record.subtitle).not.toContain("|");

    const primaryRoute = record.referralInfo?.find((row) => row.label === "Primary route");
    expect(primaryRoute?.value).toBe("Nearest CADS; self-referral accepted");
    expect(primaryRoute?.value).not.toEqual(cads!.referral_details);
    expect(primaryRoute?.value).not.toContain("|");
    expect(record.referralInfo?.every((row) => !row.value?.includes("|"))).toBe(true);
  });

  it("parses labeled referral_details into discrete pathway/hours/cost parts", () => {
    const parsed = parseLabeledReferralDetails(
      "Contact: 13 92 76 | Referral pathway: Self phone referral | Hours: 24/7 | Cost/funding: Free",
    );
    expect(parsed.pathway).toBe("Self phone referral");
    expect(parsed.hours).toBe("24/7");
    expect(parsed.cost).toBe("Free");
    expect(parsed.contact).toBe("13 92 76");
  });

  it("prefers informative pathway clauses over short tokens like Phone", () => {
    expect(compactCatalogField("Phone | Self, clinician, carer by phone | Self or clinician by phone")).toBe(
      "Self, clinician, carer by phone",
    );
  });

  it("ranks actionable clauses above qualified placeholders for S018 and S081", () => {
    const snapshot = loadServicesSnapshot();
    const cci = snapshot.services.find((service) => service.id === "S018");
    const karaMaar = snapshot.services.find((service) => service.id === "S081");
    expect(cci).toBeTruthy();
    expect(karaMaar).toBeTruthy();

    const cciRecord = catalogToServiceRecord(cci!);
    expect(cciRecord.route).toBe("Contact service; external referral forms and inclusion/exclusion criteria");
    expect(cciRecord.route?.toLowerCase()).not.toContain("not publicly stated");
    expect(cciRecord.criteria?.some((criterion) => /not publicly stated/i.test(criterion.label))).toBe(false);
    expect(
      cciRecord.criteria?.some(
        (criterion) =>
          criterion.tone === "meet" &&
          criterion.label.includes("Contact service; external referral forms and inclusion/exclusion criteria"),
      ),
    ).toBe(true);

    const karaRecord = catalogToServiceRecord(karaMaar!);
    expect(karaRecord.criteria?.some((criterion) => criterion.label === "Not publicly stated in public summary")).toBe(
      false,
    );
    expect(
      karaRecord.criteria?.some(
        (criterion) =>
          criterion.tone === "reject" && /Must fit specialist community ED service model/i.test(criterion.label),
      ),
    ).toBe(true);
  });

  it("prefers concrete referral routes over vague intake placeholders for ICLS (S079)", () => {
    const snapshot = loadServicesSnapshot();
    const icls = snapshot.services.find((service) => service.id === "S079");
    expect(icls).toBeTruthy();

    const record = catalogToServiceRecord(icls!);
    expect(record.route).toBe("Referral must come from public or private mental health service");
    expect(record.route?.toLowerCase()).not.toContain("does not specify");
    expect(record.route?.toLowerCase()).not.toContain("through program pathways");
  });

  it("preserves multi-clause eligibility and exclusion criteria for Mother Baby Unit (S115)", () => {
    const snapshot = loadServicesSnapshot();
    const mbu = snapshot.services.find((service) => service.id === "S115");
    expect(mbu).toBeTruthy();

    const record = catalogToServiceRecord(mbu!);
    const meetLabels =
      record.criteria?.filter((criterion) => criterion.tone === "meet").map((criterion) => criterion.label) ?? [];
    expect(meetLabels.some((label) => /28 weeks/i.test(label))).toBe(true);
    expect(meetLabels.some((label) => /non-toddling/i.test(label))).toBe(true);

    const rejectLabels =
      record.criteria?.filter((criterion) => criterion.tone === "reject").map((criterion) => criterion.label) ?? [];
    expect(rejectLabels.some((label) => /withdrawal\/detox/i.test(label))).toBe(true);
    expect(rejectLabels.some((label) => /not publicly stated/i.test(label))).toBe(false);

    const exclusionsRow = record.referralInfo?.find((row) => row.label === "Exclusions");
    expect(exclusionsRow?.value).toContain("Not emergency/crisis service");
    expect(exclusionsRow?.value).toContain("withdrawal/detox");
    expect(exclusionsRow?.value).toMatch(/highly secure\/intensive nursing/i);
  });

  it("compacts raw best-use fallbacks for stale seeded summary cards", () => {
    const snapshot = loadServicesSnapshot();
    const adultHomeTreatment = snapshot.services.find(
      (service) => service.canonical_name_key === "adult-home-treatment-team",
    );
    expect(adultHomeTreatment).toBeTruthy();

    const compacted = compactBestUseTitle(adultHomeTreatment!.best_use_indication);
    expect(compacted).toBe(
      "Intensive daily home treatment as alternative to admission or as step between hospital and community",
    );
    expect(compacted.includes("|")).toBe(false);
    expect(compacted.length).toBeLessThanOrEqual(120);
  });

  it("compacts pipe-joined patient-group blobs in best-use card detail", () => {
    const snapshot = loadServicesSnapshot();
    const communitySru = snapshot.services.find(
      (service) => service.canonical_name_key === "community-supported-residential-units",
    );
    expect(communitySru?.patient_group?.includes("|")).toBe(true);
    expect(communitySru!.patient_group.length).toBeGreaterThan(140);

    const record = catalogToServiceRecord(communitySru!);
    const bestUseCard = record.summaryCards?.find((card) => card.id === "best-use");
    expect(bestUseCard?.detail).toBeTruthy();
    expect(bestUseCard!.detail!.length).toBeLessThanOrEqual(120);
    expect(bestUseCard!.detail).not.toContain("|");
  });

  it("omits filler cost cards when funding is unknown", () => {
    const snapshot = loadServicesSnapshot();
    const unknownCost = snapshot.services.find((service) => {
      const value = service.cost_funding.trim();
      return !value || /^(?:not publicly stated|not applicable|none|n\/a|unknown)$/i.test(value);
    });
    expect(unknownCost).toBeTruthy();
    const record = catalogToServiceRecord(unknownCost!);
    expect(record.cost).toBeUndefined();
    expect(record.summaryCards?.some((card) => card.id === "cost")).toBe(false);
  });

  it("produces unique slugs and non-empty titles", () => {
    const records = mapCatalogToServiceRecords(loadServicesSnapshot().services);
    const slugs = records.map((record) => record.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(records.every((record) => record.title.trim().length > 0)).toBe(true);
  });

  it("ranks 13YARN for crisis query", () => {
    const records = loadServiceRecords();
    const matches = rankServiceRecords(records, "13YARN crisis support", 10);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.service.slug).toBe("13yarn");
    expect(searchServiceRecords("13YARN")[0]?.service.slug).toBe("13yarn");
  });

  it("interprets natural-language youth follow-up searches inside the services catalogue", () => {
    const matches = rankServiceRecords(
      serviceRecords,
      "Where can a young person get support after discharge?",
      serviceRecords.length,
      [],
      true,
    );
    expect(matches.some(({ service }) => service.slug.includes("youth-community"))).toBe(true);
  });

  it("maps representative services into the four browse groups", () => {
    const records = loadServiceRecords();
    const yarn = records.find((service) => service.slug === "13yarn");
    const cityEast = records.find((service) => service.slug === "city-east-community-mental-health-service");
    const cads = records.find((service) => service.slug === "community-alcohol-and-drug-services-cads-network");
    const residential = records.find((service) => service.slug === "community-supported-residential-units");

    expect(yarn).toBeDefined();
    expect(cityEast).toBeDefined();
    expect(cads).toBeDefined();
    expect(residential).toBeDefined();

    expect(serviceCoreGroupIds(yarn!)).toContain("urgent");
    expect(serviceCoreGroupIds(cityEast!)).toContain("public");
    expect(serviceCoreGroupIds(cads!)).toContain("aod");
    expect(serviceCoreGroupIds(residential!)).toContain("community");
    expect(readServiceCoreGroup("unknown")).toBeNull();

    expect(serviceMatchesCoreGroup(yarn!, null)).toBe(true);

    // Minimal fixture: adjacent tags must not fabricate "public community" across fields.
    const crossFieldOnly = serviceMatchesCoreGroup(
      {
        slug: "cross-field-only",
        title: "Cross field program",
        tags: ["public", "community"],
      },
      "public",
    );
    expect(crossFieldOnly).toBe(false);
  });

  it("round-trips overlapping browse groups as a multi-select filter", () => {
    const selection = readServiceCoreGroupSelection("urgent,public,unknown,urgent");
    expect([...selection]).toEqual(["urgent", "public"]);

    const yarn = loadServiceRecords().find((service) => service.slug === "13yarn");
    expect(yarn).toBeDefined();
    expect(serviceMatchesCoreGroupSelection(yarn!, selection)).toBe(true);
    expect(serviceMatchesCoreGroupSelection(yarn!, new Set())).toBe(true);

    const params = new URLSearchParams("q=13YARN&run=1");
    writeServiceCoreGroupSelectionToParams(params, readServiceCoreGroupSelection("aod,urgent"));
    expect(params.get("group")).toBe("urgent,aod");
    expect(params.get("q")).toBe("13YARN");

    writeServiceCoreGroupSelectionToParams(params, new Set());
    expect(params.has("group")).toBe(false);
    expect(params.get("q")).toBe("13YARN");
  });

  it("normalizes service lookup", () => {
    expect(getServiceRecord(" 13YARN ")?.title).toBe("13YARN");
    expect(getServiceRecord("missing-service")).toBeNull();
  });

  it("normalizes raw catalog services consistently", () => {
    const snapshot = loadServicesSnapshot();
    const normalized = normalizeCatalogServices(snapshot);
    expect(normalized).toHaveLength(252);
    expect(normalized[0]?.id).toMatch(/^S\d{3}$/);
  });
});

describe("services catalogue — audit 2026-10-20 corrections", () => {
  it("keeps a bracketed area code whole and never reads a fax as a phone", () => {
    expect(extractPhones("Contact: (08) 9442 5000 | Hours: 24/7")).toEqual(["(08) 9442 5000"]);
    expect(extractPhones("Tel 6372 1500, fax 6372 1599")).toEqual(["6372 1500"]);
    expect(extractPhones("Phone (08) 6458 1521, fax (08) 6458 1111")).toEqual(["(08) 6458 1521"]);
    const unbalanced = serviceRecords.flatMap((service) =>
      [service.primaryContact, ...(service.contacts ?? [])]
        .map((contact) => contact?.value ?? "")
        .filter((value) => (value.match(/\(/g) ?? []).length !== (value.match(/\)/g) ?? []).length),
    );
    expect(unbalanced).toEqual([]);
  });

  it("marks legacy duplicates of canonical crisis records as superseded, so they are never pinned", () => {
    const services = loadServicesSnapshot().services;
    for (const [legacyId, canonicalId] of [
      ["S045", "SVC-URG-001"],
      ["S034", "SVC-CHP-001"],
      ["S037", "SVC-URG-005"],
      ["S089", "SVC-URG-005"],
    ] as const) {
      const legacy = services.find((service) => service.id === legacyId);
      expect(legacy?.availability_status, legacyId).toBe("superseded");
      expect(legacy?.superseded_by, legacyId).toContain(canonicalId);
      expect(
        services.some((service) => service.stable_id === canonicalId && service.availability_status === "active"),
      ).toBe(true);
      const record = catalogToServiceRecord(legacy!);
      expect(record.statusChips?.map((chip) => chip.label)).toContain("Superseded");
    }
    expect(titles("crisis")).not.toContain("Emergency services / 000 / nearest ED");
  });

  it("shows no confidence chip on an unverified legacy record", () => {
    const records = loadServicesSnapshot().services.map((service) => ({
      legacy: service.verification_status === "legacy_unverified",
      record: catalogToServiceRecord(service),
    }));
    const legacy = records.filter((entry) => entry.legacy);
    expect(legacy.length).toBeGreaterThan(0);
    for (const { record } of legacy) {
      expect(record.statusChips?.some((chip) => / confidence$/.test(chip.label ?? ""))).toBe(false);
      expect(record.verification?.confidence).toBe("Unknown");
    }
    const yarn = records.find((entry) => entry.record.slug === "13yarn");
    expect(yarn?.record.statusChips?.map((chip) => chip.label)).toContain("High confidence");
  });

  it("states 24/7 hours for Kids Helpline and MensLine", () => {
    for (const slug of ["kids-helpline", "mensline-australia"]) {
      const service = loadServicesSnapshot().services.find((entry) => entry.canonical_name_key === slug);
      expect(service?.hours, slug).toMatch(/^24\/7/);
    }
  });
});

function titles(query: string) {
  return rankServiceRecords(serviceRecords, query, 12, [], true).map(({ service }) => service.title);
}
