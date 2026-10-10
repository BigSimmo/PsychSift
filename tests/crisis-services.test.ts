import { describe, expect, it } from "vitest";

import { CRISIS_SERVICES, WA_CRISIS_CONTACTS } from "@/lib/crisis-services";
import { publicCrisisContacts } from "@/components/care-plan/mockups/fixtures";

describe("crisis-services (#RAAB0J)", () => {
  it("re-exports WA_CRISIS_CONTACTS as CRISIS_SERVICES preserving identity", () => {
    expect(CRISIS_SERVICES).toBe(WA_CRISIS_CONTACTS);
    expect(publicCrisisContacts).toBe(CRISIS_SERVICES);
  });

  it("contains exactly the seven verified WA and national crisis contacts", () => {
    expect(CRISIS_SERVICES).toHaveLength(7);
    expect(CRISIS_SERVICES.map((s) => s.telephoneDisplay)).toEqual([
      "000",
      "1300 555 788",
      "1800 676 822",
      "1800 552 002",
      "13 11 14",
      "1300 659 467",
      "13 92 76",
    ]);
  });

  it("ensures every crisis service has a verified HTTPS government or official portal URL", () => {
    for (const service of CRISIS_SERVICES) {
      expect(service.sourceUrl).toMatch(/^https:\/\//);
      expect(service.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(service.telephoneUri).toBe(service.telephoneDisplay.replace(/\s+/g, ""));
      expect(service.availability).toBeTruthy();
    }
  });

  it("verifies emergency vs crisis helpline designations and caveats", () => {
    const emergency = CRISIS_SERVICES.find((s) => s.isEmergencyService);
    expect(emergency?.name).toBe("Emergency services");
    expect(emergency?.telephoneDisplay).toBe("000");

    const nonEmergency = CRISIS_SERVICES.filter((s) => !s.isEmergencyService);
    expect(nonEmergency).toHaveLength(6);
    for (const helpline of nonEmergency) {
      if (helpline.name.includes("MHERL") || helpline.name.includes("Rurallink")) {
        expect(helpline.caveat).toMatch(/not an emergency service/i);
      }
    }
  });
});
