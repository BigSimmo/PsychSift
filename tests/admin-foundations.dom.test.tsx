/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ADMIN_LIST_PREVIEW_ROWS, AdminShowAll } from "@/components/admin/admin-show-all";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { adminPlacementForEntry, isAdminWorkforceExplainer } from "@/lib/admin/placement";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import {
  formatDateEcho,
  formatRecordedDate,
  formatRelativeDate,
  formatUpdatedMonth,
  renewalStartOn,
} from "@/lib/admin/renewal-dates";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

function demo(title: string) {
  const found = DEMO_ON_CALL_ENTRIES.find((entry) => entry.title === title);
  if (!found) throw new Error(`demo corpus no longer has "${title}"`);
  return found;
}

describe("Admin splits the reader's own rows from other doctors' shared rows (spec review 1)", () => {
  it("keeps own rows editable and shared rows read-only, and drops nothing", () => {
    const mine = onCallEntryFixture({ section: "logistics", details: { category: "Pay" } });
    // Another doctor's row reaches the reader only when it is shared (not personal):
    // the shared read never returns another owner's personal rows.
    const theirs = onCallEntryFixture({
      section: "logistics",
      details: { category: "Pay" },
      isOwn: false,
      isPersonal: false,
    });
    expect(selectAdminOwnEntries({ entries: [mine, theirs], demoMode: false })).toEqual([mine]);
    expect(selectAdminSharedEntries({ entries: [mine, theirs], demoMode: false })).toEqual([theirs]);
  });

  it("keeps the whole demo corpus in demo mode, where no row belongs to anyone", () => {
    expect(selectAdminOwnEntries({ entries: [...DEMO_ON_CALL_ENTRIES], demoMode: true })).toHaveLength(
      DEMO_ON_CALL_ENTRIES.length,
    );
    expect(selectAdminSharedEntries({ entries: [...DEMO_ON_CALL_ENTRIES], demoMode: true })).toEqual([]);
  });
});

describe("adminLoadState", () => {
  it("treats a cached copy as a failed load, because the device cache holds no personal or renewal rows", () => {
    expect(adminLoadState({ loading: false, isOffline: true, loadError: "offline", signedOut: false })).toBe("failed");
    expect(adminLoadState({ loading: false, isOffline: true, loadError: "failed", signedOut: false })).toBe("failed");
  });

  it("is loading, signed out or ready otherwise", () => {
    expect(adminLoadState({ loading: true, isOffline: false, loadError: null, signedOut: false })).toBe("loading");
    expect(adminLoadState({ loading: false, isOffline: false, loadError: null, signedOut: true })).toBe("signed-out");
    expect(adminLoadState({ loading: false, isOffline: false, loadError: null, signedOut: false })).toBe("ready");
  });
});

describe("the old page files stay as redirect backstops (spec review 8)", () => {
  it.each([
    ["@/app/(search-app)/my-work/page", "/admin/renewals"],
    ["@/app/(search-app)/on-call/compliance/page", "/admin/renewals"],
    ["@/app/(search-app)/on-call/logistics/page", "/admin/help"],
    ["@/app/(search-app)/on-call/education/page", "/teaching/week"],
  ])("%s redirects to %s", async (modulePath, target) => {
    const { default: Page } = (await import(modulePath)) as { default: () => unknown };
    let digest = "";
    try {
      Page();
    } catch (error) {
      digest = String((error as { digest?: unknown }).digest ?? "");
    }
    // next/navigation's redirect() throws with digest "NEXT_REDIRECT;<type>;<url>;<status>;".
    expect(digest.split(";")[2]).toBe(target);
  });
});

describe("every On Call link to the moved rows lands on Help (spec review 19)", () => {
  it("points the shared constant, or the links it would replace, at /admin/help", async () => {
    const identity = await import("@/components/on-call/on-call-section-identity");
    expect(identity.ON_CALL_SECTION_HREFS.logistics).toBe("/admin/help");
    const constant = (identity as Record<string, unknown>).ON_CALL_ADMIN_ROWS_HREF;
    if (constant !== undefined) expect(constant).toBe("/admin/help");
  });

  it("sends On Call's search results and Recent rows for a moved row to the Admin page that renders it", async () => {
    const identity = await import("@/components/on-call/on-call-section-identity");
    expect(identity.ON_CALL_VIEW_HREFS.logistics).toBe("/admin/help");
    expect(identity.ON_CALL_VIEW_HREFS.compliance).toBe("/admin/renewals");

    const guide = demo("Demo payslips and pay queries");
    const building = demo("Demo after-hours entry");
    const logins = demo("Demo logins, paging and remote access");
    const workforce = demo("What medical workforce does");
    const renewal = complianceFixture("Registration", { category: "Registration" });
    const anchor = (entry: { id: string }) => `#${onCallEntryAnchorId(entry.id)}`;

    expect(onCallEntryHref(guide)).toBe(`/admin/help${anchor(guide)}`);
    expect(onCallEntryHref(building)).toBe(`/admin/help${anchor(building)}`);
    expect(onCallEntryHref(workforce)).toBe(`/admin/help${anchor(workforce)}`);
    expect(onCallEntryHref(logins)).toBe(`/admin/new-job${anchor(logins)}`);
    expect(onCallEntryHref(renewal)).toBe(`/admin/renewals${anchor(renewal)}`);
    // A row On Call keeps still goes to its On Call page.
    const contact = onCallEntryFixture({ section: "contacts", details: { role: "Ward 4B" } });
    expect(onCallEntryHref(contact)).toBe(`/on-call/contacts${anchor(contact)}`);
  });
});

describe("renewal dates", () => {
  it("starts a renewal thirty days before the recorded date unless the row says otherwise", () => {
    expect(
      renewalStartOn(complianceFixture("Registration", { category: "Registration", expiresOn: "2026-10-20" })),
    ).toBe("2026-09-20");
    expect(
      renewalStartOn(
        complianceFixture("Police check", { category: "Clearances", expiresOn: "2027-03-01", leadTimeDays: 90 }),
      ),
    ).toBe("2026-12-01");
    expect(renewalStartOn(complianceFixture("Training", { category: "Training" }))).toBeUndefined();
  });

  it("prints dates the way the Renewals page does", () => {
    expect(formatRecordedDate("2027-03-12")).toBe("12 Mar 2027");
    expect(formatUpdatedMonth("2026-08-20")).toBe("Aug 2026");
    expect(formatUpdatedMonth("2026-08-31T17:00:00Z")).toBe("Sep 2026"); // 01:00 on 1 Sep in Perth
    expect(formatUpdatedMonth("not a date")).toBe("");
    expect(formatDateEcho("2027-09-30")).toBe("Thu 30 Sep 2027");
    expect(formatDateEcho("30/09/2027")).toBe("");
  });

  it("words the distance on one ladder, never a countdown (Josh, 16:31Z; spec review)", () => {
    expect(formatRelativeDate("2026-09-26", "2026-09-26")).toBe("today");
    expect(formatRelativeDate("2026-09-27", "2026-09-26")).toBe("tomorrow");
    expect(formatRelativeDate("2026-10-02", "2026-09-26")).toBe("in 6 days");
    expect(formatRelativeDate("2026-10-10", "2026-09-26")).toBe("in 2 weeks");
    expect(formatRelativeDate("2026-11-30", "2026-09-26")).toBe("in 9 weeks");
    expect(formatRelativeDate("2027-02-26", "2026-09-26")).toBe("in 5 months");
    expect(formatRelativeDate("2028-10-01", "2026-09-26")).toBe("in 2 years");
    expect(formatRelativeDate("2026-09-25", "2026-09-26")).toBe("yesterday");
    expect(formatRelativeDate("2026-09-23", "2026-09-26")).toBe("3 days ago");
    expect(formatRelativeDate("2026-06-01", "2026-09-26")).toBe("3 months ago");
    expect(formatRelativeDate("not a date", "2026-09-26")).toBe("");
  });
});

describe("phone numbers as Admin prints them (spec rule 11)", () => {
  it("keeps the hospital's own list short and gives outside lines their area code", () => {
    expect(displayPhoneNumber("(08) 9000 0012", "own-list")).toBe("9000 0012");
    expect(displayPhoneNumber("0890000012", "outside")).toBe("(08) 9000 0012");
    expect(displayPhoneNumber("90000012", "outside")).toBe("(08) 9000 0012");
  });

  it("groups mobiles and national numbers the same way everywhere", () => {
    expect(displayPhoneNumber("0400000012", "own-list")).toBe("0400 000 012");
    expect(displayPhoneNumber("1800 000012", "outside")).toBe("1800 000 012");
    expect(displayPhoneNumber("131114", "outside")).toBe("13 11 14");
  });

  it("leaves anything it does not recognise exactly as it was written", () => {
    expect(displayPhoneNumber("ext 4410", "own-list")).toBe("ext 4410");
    expect(displayPhoneNumber("via switchboard", "own-list")).toBe("via switchboard");
    expect(displayPhoneNumber("000", "outside")).toBe("000");
  });
});

describe("where an old On Call admin row lives in Admin", () => {
  it("sends logins and system access to New job, and building access to Help > On site", () => {
    expect(adminPlacementForEntry(demo("Demo logins, paging and remote access"))).toBe("new-job");
    expect(adminPlacementForEntry(demo("Demo after-hours entry"))).toBe("on-site");
    expect(adminPlacementForEntry(demo("Demo locked wards"))).toBe("on-site");
  });

  it("sends the on-call room, food, taxi and security escort to On site, and leave, pay and forms to Guides", () => {
    expect(adminPlacementForEntry(demo("Demo on-call room"))).toBe("on-site");
    expect(adminPlacementForEntry(demo("Demo food after hours"))).toBe("on-site");
    expect(adminPlacementForEntry(demo("A taxi home after a night shift"))).toBe("on-site");
    expect(adminPlacementForEntry(demo("Demo security escort"))).toBe("on-site");
    expect(adminPlacementForEntry(demo("Demo payslips and pay queries"))).toBe("guides");
    expect(adminPlacementForEntry(demo("Demo leave application form"))).toBe("guides");
  });

  it("places no compliance row and no row from another section", () => {
    expect(adminPlacementForEntry(complianceFixture("Registration", { category: "Registration" }))).toBeNull();
    expect(
      adminPlacementForEntry(onCallEntryFixture({ section: "contacts", details: { role: "Ward 4B" } })),
    ).toBeNull();
  });

  it("moves only the medical-workforce role explainer to Help > Contacts", () => {
    expect(isAdminWorkforceExplainer(demo("What medical workforce does"))).toBe(true);
    expect(isAdminWorkforceExplainer(demo("Demo medical workforce unit"))).toBe(false);
  });
});

describe("AdminShowAll", () => {
  const rows = Array.from({ length: 11 }, (_, index) => `row-${index}`);
  const renderRow = (row: string) => (
    <li key={row} id={row}>
      {row}
    </li>
  );

  it("shows the first batch, then the rest on 'Show all'", () => {
    render(<AdminShowAll items={rows} renderItem={renderRow} label="Rows" testId="rows" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(ADMIN_LIST_PREVIEW_ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(11);
  });

  it("opens in full when the address points at a row past the first batch", () => {
    window.history.replaceState(null, "", "#row-10");
    render(<AdminShowAll items={rows} renderItem={renderRow} anchorIdOf={(row) => row} label="Rows" testId="rows" />);
    expect(document.getElementById("row-10")).toBeTruthy();
    window.history.replaceState(null, "", "#");
  });

  it("scrolls to a folded row once a hash change reveals it, since the browser's own jump came too early", () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      render(<AdminShowAll items={rows} renderItem={renderRow} anchorIdOf={(row) => row} label="Rows" testId="rows" />);
      expect(document.getElementById("row-9")).toBeNull();
      act(() => {
        window.history.replaceState(null, "", "#row-9");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(document.getElementById("row-9")).toBeTruthy();
      expect(scrolled).toEqual(["row-9"]);
    } finally {
      Element.prototype.scrollIntoView = original;
      window.history.replaceState(null, "", "#");
    }
  });

  it("still opens once the anchored row arrives after the first render (M5)", () => {
    window.history.replaceState(null, "", "#row-10");
    const props = { renderItem: renderRow, anchorIdOf: (row: string) => row, label: "Rows", testId: "rows" };
    const { rerender } = render(<AdminShowAll items={[] as string[]} {...props} />);
    expect(document.getElementById("row-10")).toBeNull();
    rerender(<AdminShowAll items={rows} {...props} />);
    expect(document.getElementById("row-10")).toBeTruthy();
    window.history.replaceState(null, "", "#");
  });
});
