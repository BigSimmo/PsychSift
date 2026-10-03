import { describe, expect, it } from "vitest";

import {
  buildCredentialPack,
  CREDENTIAL_PACK_NOTE,
  credentialPackText,
  includedCredentialPack,
} from "@/lib/admin/credential-pack";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const NOW = new Date("2026-09-25T16:30:00Z"); // 26 Sep in Perth

describe("buildCredentialPack numbers", () => {
  it("leaves out blank and whitespace-only numbers", () => {
    const sections = buildCredentialPack({
      numbers: {
        ahpraNumber: "   ",
        prescriberNumber: "",
        wwccNumber: undefined,
        providerNumbers: [{ id: "p1", site: "RPH", number: "  " }],
      },
      ownEntries: [],
    });
    expect(sections).toEqual([]);
  });

  it("titles each number and trims its value", () => {
    const [section] = buildCredentialPack({
      numbers: {
        ahpraNumber: " MED0001234567 ",
        prescriberNumber: "P123",
        wwccNumber: "WW99",
        providerNumbers: [
          { id: "a", site: "Royal Perth Hospital", number: "111111AB" },
          { id: "b", site: "", number: "222222CD" },
        ],
      },
      ownEntries: [],
    });
    expect(section.label).toBe("Registration numbers");
    expect(section.rows.map((row) => [row.key, row.title, row.value])).toEqual([
      ["number-ahpra", "AHPRA registration", "MED0001234567"],
      ["number-prescriber", "Prescriber number", "P123"],
      ["number-wwcc", "Working with Children Check", "WW99"],
      ["number-provider-a", "Medicare provider number · Royal Perth Hospital", "111111AB"],
      ["number-provider-b", "Medicare provider number", "222222CD"],
    ]);
  });

  it("never includes a radiation licence, even if the input object carries one", () => {
    const numbers = { ahpraNumber: "MED1", radiationLicense: "RAD-SECRET-77" } as unknown as Parameters<
      typeof buildCredentialPack
    >[0]["numbers"];
    const sections = buildCredentialPack({ numbers, ownEntries: [] });
    const json = JSON.stringify(sections);
    expect(json).not.toContain("RAD-SECRET-77");
    expect(json.toLowerCase()).not.toContain("radiation");
    expect(credentialPackText(sections, NOW)).not.toContain("RAD-SECRET-77");
  });
});

describe("buildCredentialPack renewals", () => {
  it("lists own compliance entries sorted, with expiry and issuer lines", () => {
    const later = complianceFixture("Later renewal", { expiresOn: "2028-01-15", issuingBody: " WA Health " });
    const sooner = complianceFixture("Sooner renewal", { expiresOn: "2027-03-01" });
    const undated = complianceFixture("Undated renewal", {});
    const [section] = buildCredentialPack({ numbers: {}, ownEntries: [undated, later, sooner] });
    expect(section.label).toBe("Renewals");
    expect(section.rows.map((row) => row.title)).toEqual(["Sooner renewal", "Later renewal", "Undated renewal"]);
    expect(section.rows[0]).toMatchObject({ value: "Expires 1 Mar 2027", lines: [] });
    expect(section.rows[1]).toMatchObject({ value: "Expires 15 Jan 2028", lines: ["Issued by WA Health"] });
    expect(section.rows[2]).toMatchObject({ value: "No end date recorded", lines: [] });
  });

  it("excludes entries marked not for this job and non-compliance rows", () => {
    const kept = complianceFixture("Kept", { expiresOn: "2027-03-01" });
    const flagged = complianceFixture("Flagged", { expiresOn: "2027-03-01", notForThisJob: true });
    const login = onCallEntryFixture({ section: "logistics", title: "Pager login", details: { category: "Logins" } });
    const contact = onCallEntryFixture({ section: "contacts", title: "Ward" });
    const [section] = buildCredentialPack({ numbers: {}, ownEntries: [kept, flagged, login, contact] });
    expect(section.rows.map((row) => row.title)).toEqual(["Kept"]);
  });

  it("never leaks the proof note or earlier expiry dates", () => {
    const entry = complianceFixture("Registration", {
      expiresOn: "2027-03-01",
      issuingBody: "AHPRA",
      proofNote: "Scan is in the blue folder PROOF-XYZ",
      expiryHistory: ["2024-03-01", "2021-03-01"],
    });
    const sections = buildCredentialPack({ numbers: {}, ownEntries: [entry] });
    const all = JSON.stringify(sections) + credentialPackText(sections, NOW);
    expect(all).not.toContain("PROOF-XYZ");
    expect(all).not.toContain("blue folder");
    expect(all).not.toContain("2024");
    expect(all).not.toContain("2021");
    expect(all).not.toContain("Mar 2024");
  });
});

describe("buildCredentialPack shape", () => {
  it("drops empty sections and returns [] for no input", () => {
    expect(buildCredentialPack({ numbers: {}, ownEntries: [] })).toEqual([]);
    const onlyNumbers = buildCredentialPack({ numbers: { ahpraNumber: "MED1" }, ownEntries: [] });
    expect(onlyNumbers.map((section) => section.label)).toEqual(["Registration numbers"]);
    const onlyRenewals = buildCredentialPack({
      numbers: {},
      ownEntries: [complianceFixture("Reg", { expiresOn: "2027-03-01" })],
    });
    expect(onlyRenewals.map((section) => section.label)).toEqual(["Renewals"]);
  });
});

describe("includedCredentialPack", () => {
  const sections = buildCredentialPack({
    numbers: { ahpraNumber: "MED1", prescriberNumber: "P1" },
    ownEntries: [complianceFixture("Reg", { expiresOn: "2027-03-01" })],
  });

  it("removes excluded keys", () => {
    const result = includedCredentialPack(sections, new Set(["number-ahpra"]));
    expect(result[0].rows.map((row) => row.key)).toEqual(["number-prescriber"]);
    expect(result).toHaveLength(2);
  });

  it("drops sections that become empty", () => {
    const result = includedCredentialPack(sections, new Set(["number-ahpra", "number-prescriber"]));
    expect(result.map((section) => section.label)).toEqual(["Renewals"]);
    expect(includedCredentialPack(sections, new Set(sections.flatMap((s) => s.rows.map((r) => r.key))))).toEqual([]);
  });

  it("keeps everything when nothing is excluded", () => {
    expect(includedCredentialPack(sections, new Set())).toEqual(sections);
  });
});

describe("credentialPackText", () => {
  it("is empty when nothing is included", () => {
    expect(credentialPackText([], NOW)).toBe("");
  });

  it("starts with the Perth-dated heading, lists sections and rows, and ends with the note", () => {
    const sections = buildCredentialPack({
      numbers: { ahpraNumber: "MED1" },
      ownEntries: [complianceFixture("Reg", { expiresOn: "2027-03-01", issuingBody: "AHPRA" })],
    });
    const text = credentialPackText(sections, NOW);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Credential pack · Sat 26 Sep 2026");
    expect(lines[0].startsWith("Credential pack · ")).toBe(true);
    expect(text).toContain("Registration numbers");
    expect(text).toContain("Renewals");
    expect(text).toContain("AHPRA registration: MED1");
    expect(text).toContain("Reg: Expires 1 Mar 2027");
    expect(text).toContain("  Issued by AHPRA");
    expect(text.endsWith(CREDENTIAL_PACK_NOTE)).toBe(true);
  });
});
