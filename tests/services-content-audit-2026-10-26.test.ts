import { describe, expect, it } from "vitest";

import { loadServicesSnapshot } from "@/lib/service-catalog";
import { catalogToServiceRecord } from "@/lib/service-catalog-mapper";
import { serviceCallTarget } from "@/lib/service-call";
import { canonicalServiceRecords } from "@/lib/service-governance";

/**
 * Service record corrections from the 26 Oct 2026 clinical content re-audit (MC-F-07,
 * MC-F-08, MC-F-09 and MC-F-13). Drafts for the owner's clinical sign-off.
 */
const services = loadServicesSnapshot().services;

function service(id: string) {
  const match = services.find((entry) => entry.id === id || entry.stable_id === id);
  expect(match, id).toBeTruthy();
  return match!;
}

function chipLabels(id: string) {
  return catalogToServiceRecord(service(id)).statusChips?.map((chip) => chip.label) ?? [];
}

describe("26 Oct 2026 service record corrections", () => {
  it("MC-F-07: the Fiona Stanley Mother and Baby Unit no longer dials the KEMH unit", () => {
    const fsh = service("S115");
    expect(JSON.stringify(fsh)).not.toMatch(/6458 1799|MBU@health\.wa\.gov\.au/);
    expect(fsh.tags.acuity_flags).not.toContain("crisis_high");
    // The published referral line on the SMHS Mother and Baby Unit referrals page.
    expect(serviceCallTarget(catalogToServiceRecord(fsh))?.href).toBe("tel:0861521583");
  });

  it("MC-F-08: only a tier A canonical record reads as Crisis / urgent", () => {
    const tierById = new Map(canonicalServiceRecords().map((record) => [record.id, record.tier]));
    for (const entry of services) {
      const tier = tierById.get(entry.stable_id ?? "");
      if (!tier || tier === "A_immediate") continue;
      expect(entry.tags.acuity_flags, `${entry.id} ${entry.name}`).not.toContain("crisis_high");
    }
    for (const id of ["SVC-LEG-004", "SVC-YTH-016"]) expect(chipLabels(id)).not.toContain("Crisis / urgent");
    // A tier A record keeps the chip.
    expect(chipLabels("SVC-URG-001")).toContain("Crisis / urgent");
  });

  it("MC-F-09: the duplicate RAPID record points at the other and reads as superseded", () => {
    const duplicate = service("S159");
    expect(duplicate.availability_status).toBe("superseded");
    expect(duplicate.superseded_by).toContain("S160");
    expect(chipLabels("S159")).toContain("Superseded");
  });

  it("MC-F-13: PANDA hours come from PANDA's own page", () => {
    const panda = canonicalServiceRecords().find((record) => record.id === "SVC-PER-003")!;
    expect(panda.hours.display).toMatch(/Monday to Friday 9am to 7\.30pm, and Saturday and Sunday 9am to 4pm/);
    expect(panda.hours.display).not.toMatch(/Closed Sundays/);
    expect(panda.hours.display).not.toMatch(/Contested/);
    expect(panda.sources.some((source) => source.url === "https://www.panda.org.au/contact")).toBe(true);
  });

  it("MC-F-13: Great Southern adult mental health lists the Katanning line", () => {
    const record = canonicalServiceRecords().find((entry) => entry.id === "SVC-REG-002")!;
    expect(record.contacts.map((contact) => contact.value)).toContain("(08) 9821 6341");
  });

  it("MC-F-13: small legacy record corrections", () => {
    expect(service("S065").contact_details).toContain("albany@palmerston.org.au");
    expect(JSON.stringify(service("S065"))).not.toContain("albanyadmin@");
    expect(serviceCallTarget(catalogToServiceRecord(service("S081")))?.href).toBe("tel:0863921700");
    const wandas = service("S195");
    expect(serviceCallTarget(catalogToServiceRecord(wandas))?.href).toBe("tel:0864581582");
    expect(wandas.contact_details).toMatch(
      /After 36 weeks WANDAS does not accept referrals\. Refer urgently to the KEMH Antenatal Clinic after discussion with the On Call Obstetrics Registrar/,
    );
    expect(wandas.public_source_urls).toEqual([
      "https://www.wnhs.health.wa.gov.au/For-Health-Professionals/Obstetrics/WANDAS",
    ]);
  });
});
