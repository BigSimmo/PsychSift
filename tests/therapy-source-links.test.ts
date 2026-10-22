import { describe, expect, it } from "vitest";

import { therapyRecords } from "@/lib/therapies";
import { therapyCitedSourceIds, therapySourceLinkIds } from "@/lib/therapy-source-link-ids";
import { therapySourceLinks } from "@/lib/therapy-source-links";
import {
  acquisitionAttestedContentSha256,
  sourceAcquisitionRecords,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";

const JURISDICTION_RANK = (jurisdiction: string) =>
  /WA|Western Australia/.test(jurisdiction) ? 0 : jurisdiction.startsWith("Australia") ? 1 : 2;

describe("therapy source links", () => {
  const byId = new Map(sourceAcquisitionRecords.map((record) => [record.id, record]));

  it("maps only real therapy slugs to real, unrejected register records, WA and Australian first", () => {
    const slugs = new Set(therapyRecords.map((record) => record.slug));
    for (const [slug, ids] of Object.entries(therapySourceLinkIds)) {
      expect(slugs.has(slug), `unknown therapy slug ${slug}`).toBe(true);
      expect(ids.length, `empty source links for ${slug}`).toBeGreaterThan(0);
      expect(new Set(ids).size, `duplicate source for ${slug}`).toBe(ids.length);
      const ranks = ids.map((id) => {
        const record = byId.get(id);
        expect(record, `unknown register record ${id}`).toBeDefined();
        expect(record?.disposition, `${id} is rejected`).not.toBe("rejected");
        return JURISDICTION_RANK(record?.jurisdiction ?? "");
      });
      expect(ranks, `${slug} does not list local sources first`).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("proposes the RANZCP statements for ECT and rTMS", () => {
    expect(therapyCitedSourceIds("ect")).toContain("dictionary-ranzcp-ect-ps74");
    expect(therapyCitedSourceIds("rtms")).toContain("dictionary-ranzcp-rtms-ppg16");
    expect(therapyCitedSourceIds("not-a-therapy")).toEqual([]);
  });

  it("shows no link while no proposed record is adopted with the owner's sign-off", () => {
    for (const slug of Object.keys(therapySourceLinkIds)) expect(therapySourceLinks(slug)).toEqual([]);
  });

  it("shows a record once it is adopted and signed off as it now stands", () => {
    const base = byId.get("dictionary-ranzcp-ect-ps74") as SourceAcquisitionRecord;
    const reviewed: SourceAcquisitionRecord = {
      ...base,
      disposition: "adopted",
      dispositionReason: null,
      documentStatus: "current",
      expiryDate: null,
      validationStatus: "locally_reviewed",
    };
    const signed: SourceAcquisitionRecord = {
      ...reviewed,
      attestedBy: "Dr Alex Morgan",
      attestedAt: "2026-10-21T00:00:00.000Z",
      attestedAgainstSha256: acquisitionAttestedContentSha256(reviewed),
    };
    const links = therapySourceLinks("ect", { records: [signed] });
    expect(links.map((link) => link.id)).toEqual(["dictionary-ranzcp-ect-ps74"]);
    // Edited after sign-off: the pin no longer matches and the link drops out.
    expect(therapySourceLinks("ect", { records: [{ ...signed, title: `${signed.title} (edited)` }] })).toEqual([]);
  });
});
