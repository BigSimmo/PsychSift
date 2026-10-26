import { describe, expect, it } from "vitest";

import { serviceCallTarget } from "@/lib/service-call";
import { getServiceRecord } from "@/lib/services";

/**
 * MC-F-05 (26 Oct 2026 clinical content re-audit): these records packed a phone number and
 * an email into one contact, which was read as an email. They had no call button, and the
 * detail page built a mailto: link from the phone number. Daytime regional crisis routing
 * pins several of them first.
 */
const regionalRecords: Array<[slug: string, tel: string]> = [
  ["goldfields-adult-mental-health-service", "tel:0890886200"],
  ["great-southern-adult-mental-health-service", "tel:0898922440"],
  ["kimberley-adult-mental-health-service", "tel:0891942640"],
  ["midwest-adult-mental-health-service", "tel:1800051999"],
  ["pilbara-adult-mental-health-service", "tel:0891741240"],
  ["wheatbelt-adult-mental-health-service", "tel:0896210999"],
  ["wungen-kartup-specialist-aboriginal-mental-health-service", "tel:0892248935"],
  ["wungening-ngalla-wirrin-wungening", "tel:0892211411"],
];

describe("regional and Aboriginal mental health service call links", () => {
  it.each(regionalRecords)("%s offers a call link", (slug, tel) => {
    const record = getServiceRecord(slug);
    expect(record).toBeTruthy();
    expect(serviceCallTarget(record!)?.href).toBe(tel);
  });

  it.each(regionalRecords)("%s keeps phone numbers out of its email contacts", (slug) => {
    const record = getServiceRecord(slug)!;
    for (const contact of record.contacts.filter((entry) => entry.kind === "email")) {
      expect(contact.value).toMatch(/^[^\s;]+@[^\s;]+$/);
    }
  });
});
