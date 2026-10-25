import { describe, expect, it } from "vitest";

import {
  canonicalServiceRecords,
  canonicalServiceValidationErrors,
  mergeCanonicalCatalogServices,
} from "@/lib/service-governance";
import { sourceAuthorityIdentityForPublisher } from "@/lib/source-authority-registry";
import { loadServicesSnapshot, normalizeCatalogServices } from "@/lib/service-catalog";
import servicesSnapshot from "../data/services-snapshot.json";
import part09 from "@/lib/services-canonical-data/part-09";

const PART_09_IDS = [
  "SVC-LEG-002",
  "SVC-CHP-001",
  "SVC-FDV-004",
  "SVC-HOU-003",
  "SVC-LEG-003",
  "SVC-YTH-017",
  "SVC-YTH-018",
  "SVC-YTH-019",
  "SVC-YTH-020",
  "SVC-YTH-021",
  "SVC-URG-006",
  "SVC-YTH-022",
  "SVC-YTH-023",
  "SVC-YTH-024",
  "SVC-YTH-025",
  // Added 2026-10-24 (#6X06YS).
  "SVC-LEG-004",
] as const;

describe("part-09 WA service records written 2026-09-26", () => {
  it("contains exactly the records written in this batch", () => {
    expect(part09.map((record) => record.id).sort()).toEqual([...PART_09_IDS].sort());
  });

  it("passes the shared governance validation and keeps IDs unique across every part", () => {
    expect(canonicalServiceValidationErrors(canonicalServiceRecords())).toEqual([]);
    const allIds = canonicalServiceRecords().map((record) => record.id);
    for (const id of PART_09_IDS) expect(allIds.filter((candidate) => candidate === id)).toHaveLength(1);
  });

  it("cites a dated page from a publisher the authority register already knows", () => {
    // Every issuer resolves in the authority register. Ruah, St Vincent de Paul Society (WA)
    // and Youth Focus were registered for this batch on the owner's 2026-09-26 decision.
    for (const record of part09) {
      expect(record.sources.length).toBeGreaterThan(0);
      for (const source of record.sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.date.trim()).not.toBe("");
        expect(sourceAuthorityIdentityForPublisher(source.issuer), source.issuer).not.toBeNull();
      }
    }
  });

  it("does not invent hours the source page does not state", () => {
    const links = part09.find((record) => record.id === "SVC-LEG-002");
    expect(links?.hours.verification_status).toBe("unable_to_verify");
    expect(links?.contacts.map((contact) => contact.value)).toContain("(08) 9218 4819");
  });

  it("keeps each health service's youth team on its own legacy entry", () => {
    // Both Youth Hospital in the Home names once reduced to the same identity key, so the
    // NMHS record overwrote the SMHS legacy entry (S211) and left S212 unverified.
    const stableIdFor = (legacyId: string) =>
      loadServicesSnapshot().services.find((service) => service.id === legacyId)?.stable_id;
    expect(stableIdFor("S211")).toBe("SVC-YTH-022");
    expect(stableIdFor("S212")).toBe("SVC-YTH-021");
    expect(stableIdFor("S041")).toBe("SVC-YTH-024");
    expect(stableIdFor("S123")).toBe("SVC-YTH-025");
  });

  it("replaces the legacy Mental Health Advocacy Service entry rather than adding a second copy", () => {
    const services = loadServicesSnapshot().services;
    expect(services.find((service) => service.id === "S100")?.stable_id).toBe("SVC-LEG-004");
    expect(services.filter((service) => service.stable_id === "SVC-LEG-004")).toHaveLength(1);
  });

  it("matches the two Youth Hospital in the Home entries the same way whatever the snapshot order", () => {
    const legacy = normalizeCatalogServices(servicesSnapshot);
    for (const ordered of [legacy, [...legacy].reverse()]) {
      const merged = mergeCanonicalCatalogServices(ordered);
      const stableIdFor = (legacyId: string) => merged.find((service) => service.id === legacyId)?.stable_id;
      expect(stableIdFor("S211")).toBe("SVC-YTH-022");
      expect(stableIdFor("S212")).toBe("SVC-YTH-021");
    }
  });
});
