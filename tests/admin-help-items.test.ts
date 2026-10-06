import { describe, expect, it } from "vitest";

import { adminHelpForwardHref } from "@/components/admin/admin-hash-forward";
import { buildAdminHelpItems, selectNewJobRows } from "@/lib/admin/help-items";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const demo = (title: string) => DEMO_ON_CALL_ENTRIES.find((entry) => entry.title === title)!;
const mine = onCallEntryFixture({ title: "My locker", section: "logistics", details: { category: "Facilities" } });
const sharedPay = onCallEntryFixture({
  title: "Pay queries",
  section: "logistics",
  details: { category: "Pay" },
  isOwn: false,
  lastVerifiedAt: "2026-08-12T00:00:00Z",
});

describe("Help's items (spec review 1 and 6)", () => {
  it("keeps shared guides, read-only, beside the reader's own rows", () => {
    const items = buildAdminHelpItems({ own: [mine], shared: [sharedPay], statewide: [] });
    expect(items.find((item) => item.title === "Pay queries")).toMatchObject({ tab: "guides", source: "shared" });
    expect(items.find((item) => item.title === "My locker")).toMatchObject({ tab: "on-site", source: "you" });
  });

  it("dates each item 'Updated <month>' and never drops one for age (spec review 7)", () => {
    const old = { ...sharedPay, lastVerifiedAt: "2019-01-01T00:00:00Z" };
    const [item] = buildAdminHelpItems({ own: [], shared: [old], statewide: [] });
    expect(item.updatedOn).toBe("2019-01-01T00:00:00Z");
  });

  it("leaves login rows to New job, and gives New job both own and shared login rows", () => {
    const login = demo("Logins, paging and remote access");
    expect(buildAdminHelpItems({ own: [], shared: [login], statewide: [] })).toEqual([]);
    expect(selectNewJobRows({ own: [], shared: [login] }).logins).toEqual([{ entry: login, source: "shared" }]);
  });
});

describe("old #anchors land (spec review 8)", () => {
  it("sends a login row's old Help anchor on to New job, and leaves every other anchor alone", () => {
    const login = demo("Logins, paging and remote access");
    const room = demo("On-call room");
    expect(adminHelpForwardHref(`#on-call-entry-${login.id}`, [login, room])).toBe(
      `/admin/new-job#on-call-entry-${login.id}`,
    );
    expect(adminHelpForwardHref(`#on-call-entry-${room.id}`, [login, room])).toBeNull();
    expect(adminHelpForwardHref("#admin-help-guides", [login, room])).toBeNull();
    expect(adminHelpForwardHref("", [login, room])).toBeNull();
  });
});
