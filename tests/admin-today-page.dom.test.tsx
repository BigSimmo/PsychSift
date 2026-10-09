/** @vitest-environment jsdom */

// Admin's Today (mode id `my-work`): the owner-approved order — a quiet
// greeting, the "Renew next" answer card, "Needs you", "Requirements" and,
// only once a start date is set, "New job progress". Nothing else renders
// here: no timeline, no Pay, no Help block, no ask box.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { adminPinsStorageKey } from "@/lib/admin/pins";
import { renewalsShowCounts } from "@/lib/admin/renewals-filters";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const state = {
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  retry: vi.fn(),
  cachedAt: null,
  signedOut: false,
  demoMode: false,
};

const saved = vi.hoisted(() => ({ entries: null as OnCallEntry[] | null, writes: [] as OnCallEntry[][] }));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => state,
  cacheOnCallEntries: (entries: OnCallEntry[]) => {
    saved.entries = entries;
    saved.writes.push(entries);
  },
  readCachedOnCallEntries: () => (saved.entries ? { entries: saved.entries, savedAt: "2026-09-26T00:00:00Z" } : null),
}));

let isAuthenticated = true;
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated }),
}));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));

import { AdminTodayPage } from "@/components/admin/admin-today-page";

// 09:00 on Sat 26 Sep 2026 in Perth, the same fixed instant the selector tests use.
const NOW = new Date("2026-09-26T01:00:00Z");

const registration = complianceFixture("Medical registration", {
  category: "Registration",
  requirementId: "medical-registration-renewal",
  expiresOn: "2026-10-15", // opens 15 Sep (30-day default): inside its lead time, 19 days out
});
const wwc = complianceFixture("Working with Children card", {
  category: "Clearances",
  consequence: "stops-work",
  expiresOn: "2026-09-03", // passed, 23 days ago — further from today than registration's 19
});
const police = complianceFixture("Police check", { category: "Clearances" }); // no date
const indemnity = complianceFixture("Indemnity", { category: "Indemnity", expiresOn: "2027-06-30" });

beforeEach(() => {
  saved.entries = null;
  saved.writes = [];
  state.entries = [];
  state.loading = false;
  state.isOffline = false;
  state.loadError = null;
  state.signedOut = false;
  state.demoMode = false;
  isAuthenticated = true;
});
afterEach(cleanup);

describe("AdminTodayPage", () => {
  it("says when the dates on screen are the example corpus", () => {
    state.demoMode = true;
    render(<AdminTodayPage now={NOW} />);
    expect(screen.getByTestId("admin-today-demo-notice")).toHaveTextContent(
      "Example records. These dates are made up, and nothing here is your own.",
    );
  });

  it("leads to Contract end, the Leave wallet and the starter pack from a Work and leave group", () => {
    render(<AdminTodayPage now={NOW} />);
    const group = screen.getByTestId("admin-work-and-leave");
    expect(within(group).getByRole("heading", { name: "Work and leave" })).toBeInTheDocument();
    expect(
      within(group)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/admin/contract", "/admin/leave", "/admin/new-job/starter"]);
  });

  it("does not call the reader's own dates an example", () => {
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-today-demo-notice")).toBeNull();
  });

  it("refreshes the displayed date when left open overnight", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-26T15:59:00Z"));
      state.entries = [registration];
      render(<AdminTodayPage />);
      const before = screen.getByTestId("admin-today-greeting").querySelector("p")?.textContent;
      act(() => vi.advanceTimersByTime(9 * 60 * 60 * 1000));
      expect(screen.getByTestId("admin-today-greeting").querySelector("p")?.textContent).not.toBe(before);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("opens with a greeting and the date, no summary number, and no tabs", () => {
    state.entries = [registration, indemnity];
    render(<AdminTodayPage now={NOW} />);
    const greeting = screen.getByTestId("admin-today-greeting");
    expect(greeting.textContent).toContain("Good morning");
    expect(greeting.textContent).toContain("Saturday 26 September");
    expect(greeting.textContent).not.toMatch(/\d+ (items|renewals|due)/);
    expect(screen.queryByRole("navigation", { name: "Sections of this page" })).toBeNull();
  });

  it("shows static skeletons while loading, nothing ready-shaped", () => {
    state.loading = true;
    render(<AdminTodayPage now={NOW} />);
    expect(screen.getByTestId("admin-today-loading")).toBeTruthy();
    expect(screen.queryByTestId("admin-today-renew-next")).toBeNull();
  });

  it("never shows an empty page when the load failed, even with a cached copy", () => {
    state.entries = [registration];
    state.isOffline = true;
    state.loadError = "offline";
    render(<AdminTodayPage now={NOW} />);
    expect(screen.getByTestId("today-state-failed")).toBeTruthy();
    expect(screen.queryByTestId("admin-today-renew-next")).toBeNull();
    expect(screen.queryByTestId("admin-today-needs-you")).toBeNull();
  });

  // Amended for the work-mode redesign, owner request 6 Oct 2026: the window
  // now sits on the slate hero card (the frame owns the mode tint), and still
  // never reads the accent token.
  it("keeps the lead-time drawing off the accent token, on the Renew next hero (M1)", () => {
    state.entries = [registration];
    render(<AdminTodayPage now={NOW} />);
    const window = screen.getByTestId("admin-today-renew-next-window");
    expect(window.closest(".work-hero")).not.toBeNull();
    expect(window.innerHTML).not.toContain("--clinical-accent");
  });

  it("words a failed load in the shared Today words for Admin, not as 'On Call entries' (M3)", () => {
    state.isOffline = true;
    state.loadError = "offline";
    const { unmount } = render(<AdminTodayPage now={NOW} />);
    const offline = screen.getByTestId("today-state-failed");
    expect(offline.textContent).toContain("You're offline");
    expect(offline.textContent).toContain("Admin needs a connection");
    expect(offline.textContent).not.toMatch(/On Call/);
    unmount();
    state.isOffline = false;
    state.loadError = "failed";
    render(<AdminTodayPage now={NOW} />);
    const failed = screen.getByTestId("today-state-failed");
    expect(failed.textContent).toContain("Couldn't load Admin");
    expect(failed.textContent).not.toMatch(/On Call/);
    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  it("offers sign-in and a way to Help when the reader is signed out, nothing else", () => {
    state.signedOut = true;
    render(<AdminTodayPage now={NOW} />);
    const signedOut = screen.getByTestId("today-state-signed-out");
    expect(signedOut.textContent).toContain("Sign in to see your day");
    const help = screen.getByRole("link", { name: /Help/ });
    expect(help.getAttribute("href")).toBe("/admin/help");
    expect(screen.queryByTestId("admin-today-renew-next")).toBeNull();
  });

  it("shows the soonest date of any kind on the Renew next card, with the lead-time drawing and both actions", () => {
    state.entries = [registration, wwc];
    render(<AdminTodayPage now={NOW} />);
    const card = screen.getByTestId("admin-today-renew-next");
    expect(within(card).getByText("Medical registration")).toBeTruthy();
    // Amended for the work-mode redesign, owner request 6 Oct 2026: the hero says "Renew by" with the weekday.
    expect(within(card).getByText("Renew by Thu 15 Oct · in 2 weeks")).toBeTruthy();
    expect(screen.getByTestId("admin-today-renew-next-window")).toBeTruthy();
    const renewed = within(card).getByTestId("admin-today-renew-next-renewed");
    expect(renewed.getAttribute("href")).toBe(`/admin/renewals#on-call-entry-${registration.id}`);
    const how = within(card).getByTestId("admin-today-renew-next-how");
    expect(how.getAttribute("href")).toBe("https://www.medicalboard.gov.au/registration/registration-renewal.aspx");
  });

  it("features the passed date on Needs you, excluding the entry already shown on Renew next, grouping undated rows", () => {
    state.entries = [registration, wwc, police];
    render(<AdminTodayPage now={NOW} />);
    // Renew next wins on registration (nearer today than wwc's passed date), so
    // Needs you's featured row is the next most urgent thing: the passed wwc row.
    const needsYou = screen.getByTestId("admin-today-needs-you");
    const featured = within(needsYou).getByTestId("admin-today-needs-you-featured");
    expect(featured.textContent).toContain("Working with Children card");
    expect(featured.textContent).toContain("Date passed");
    const rows = screen.queryByTestId("admin-today-needs-you-rows");
    // Everything Renewals calls "Not recorded yet": the personal undated row
    // first, then catalogue items with no row (registration is recorded, so it
    // is not among them).
    expect(rows?.textContent).toMatch(/\d+ dates not recorded/);
    expect(rows?.textContent).toContain("Police check");
    expect(rows?.textContent).toMatch(/and \d+ more/);
    expect(rows?.textContent).not.toContain("Medical registration renewal");
    // A confirmed or personal passed row never carries the unconfirmed-rule marker.
    expect(featured.textContent).not.toContain("Check with your service");
  });

  it("always shows Requirements in words, with no score bars", () => {
    state.entries = [registration];
    render(<AdminTodayPage now={NOW} />);
    const requirements = screen.getByTestId("admin-today-requirements");
    expect(requirements.textContent).toMatch(/\d+ of \d+ recorded/);
    expect(requirements.textContent).toContain("Dates you entered, not a check");
    expect(requirements.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("shows New job progress only once a start date is set", () => {
    state.entries = [registration];
    const { unmount } = render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-today-new-job")).toBeNull();
    unmount();

    const step = onCallEntryFixture({
      section: "logistics",
      title: "Sign and return your contract",
      details: { category: "Logins", jobStartsOn: "2026-11-02" },
    });
    state.entries = [registration, step];
    render(<AdminTodayPage now={NOW} />);
    const newJob = screen.getByTestId("admin-today-new-job");
    // Amended for the work-mode redesign, owner request 6 Oct 2026: the start date carries its weekday.
    expect(newJob.textContent).toContain("Starts Mon 2 Nov");
    expect(newJob.textContent).toContain("Sign and return your contract");
  });

  it("opens the setup sheet only while neither registration nor indemnity is recorded, and has no Add button", () => {
    state.entries = [];
    const { unmount } = render(<AdminTodayPage now={NOW} />);
    expect(screen.getByRole("dialog", { name: "Set up Admin" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
    unmount();

    state.entries = [indemnity];
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByRole("dialog", { name: "Set up Admin" })).toBeNull();
  });

  it("keeps both new setup rows in the immediate cache after consecutive saves", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: registration })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: indemnity })));
    render(<AdminTodayPage now={NOW} />);
    fireEvent.change(screen.getByLabelText("Registration expiry"), { target: { value: "2027-09-30" } });
    fireEvent.change(screen.getByLabelText("Indemnity expiry"), { target: { value: "2027-12-31" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Set up Admin" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved.writes).toHaveLength(2));
    expect(saved.writes[1]?.map((entry) => entry.id)).toEqual([registration.id, indemnity.id]);
  });

  it("renders nothing from the rest of Admin: no Pay, no Help block, no ask box", () => {
    state.entries = [registration, indemnity];
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByText("Pay")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByTestId("admin-today-help")).toBeNull();
  });
});

/**
 * Amended for the work-mode redesign, owner request 6 Oct 2026: the window is
 * an SVG whose today line sits at `at`, clamped to the track, and "Today" is
 * one of the three labels in a row under it, so it can never spill past the
 * card's edge.
 */
function expectLabelAt(at: string) {
  const window = screen.getByTestId("admin-today-renew-next-window");
  expect(window.querySelector("svg svg")?.getAttribute("x")).toBe(at);
  expect(within(window).getByText("Today")).toBeTruthy();
}

describe("AdminTodayPage redesign (Admin proposal)", () => {
  it("keeps the window bar's 'Today' label inside the bar when today is past the end", () => {
    // wwc's date passed, so the marker sits at 100%: the label must end at the
    // bar's right edge, not centre on it and spill past the card.
    state.entries = [wwc];
    render(<AdminTodayPage now={NOW} />);
    expectLabelAt("100%");
  });

  it("anchors the label to the left edge when today is at the start of the window", () => {
    // Opens 26 Sep (30 days before 26 Oct): today is the first day of the window.
    const opensToday = complianceFixture("Opens today", { category: "Training", expiresOn: "2026-10-26" });
    state.entries = [opensToday];
    render(<AdminTodayPage now={NOW} />);
    expectLabelAt("0%");
  });

  it("makes Needs you actionable: rows open the item or the filtered list, and 'Record dates' opens the record sheet", () => {
    state.entries = [registration, wwc, police];
    render(<AdminTodayPage now={NOW} />);
    const needsYou = screen.getByTestId("admin-today-needs-you");
    expect(within(needsYou).getByTestId("admin-today-needs-you-featured").getAttribute("href")).toBe(
      `/admin/renewals?item=${wwc.id}`,
    );
    const grouped = within(screen.getByTestId("admin-today-needs-you-rows")).getByRole("link");
    expect(grouped.getAttribute("href")).toBe("/admin/renewals?show=not-recorded");
    const record = within(needsYou).getByRole("link", { name: "Record dates" });
    expect(record.getAttribute("href")).toBe("/admin/renewals?record=missing");
  });

  it("offers 'Record dates' only while something is unrecorded", () => {
    state.entries = ADMIN_REQUIREMENTS_CATALOGUE.map((item) =>
      complianceFixture(item.title, { category: "Registration", requirementId: item.id, expiresOn: "2026-09-01" }),
    );
    render(<AdminTodayPage now={NOW} />);
    expect(screen.getByTestId("admin-today-needs-you")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Record dates" })).toBeNull();
  });

  it("makes the whole Requirements card the link to Renewals, keeping its honest wording", () => {
    state.entries = [registration];
    render(<AdminTodayPage now={NOW} />);
    const requirements = screen.getByTestId("admin-today-requirements");
    const link = within(requirements).getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/renewals");
    expect(link.textContent).toMatch(/\d+ of \d+ recorded/);
    expect(link.textContent).toContain("Dates you entered, not a check");
    expect(within(requirements).getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByTestId("admin-today-requirements-open")).toBeNull();
  });

  it("shows three At a glance counts that open Renewals filtered, zero tiles included", () => {
    state.entries = [registration, wwc, police];
    render(<AdminTodayPage now={NOW} />);
    const glance = screen.getByTestId("admin-today-at-a-glance");
    const counts = renewalsShowCounts(selectAdminOwnEntries(state as never), NOW);
    const passed = within(glance).getByRole("link", { name: `Date passed: ${counts["date-passed"]}` });
    expect(passed.getAttribute("href")).toBe("/admin/renewals?show=date-passed");
    const due = within(glance).getByRole("link", { name: `Due in 90 days: ${counts["due-90"]}` });
    expect(due.getAttribute("href")).toBe("/admin/renewals?show=due-90");
    const missing = within(glance).getByRole("link", { name: `Not recorded: ${counts["not-recorded"]}` });
    expect(missing.getAttribute("href")).toBe("/admin/renewals?show=not-recorded");
    expect(counts["due-90"]).toBe(1);
    // No status colour on a numeral: every number is neutral heading or muted text.
    expect(glance.innerHTML).not.toMatch(/--(danger|warning|success|clinical-accent)/);
  });

  it("still shows a zero count, quietly", () => {
    state.entries = [indemnity];
    render(<AdminTodayPage now={NOW} />);
    const zero = screen.getByRole("link", { name: "Date passed: 0" });
    expect(zero.hasAttribute("data-zero")).toBe(true);
  });

  it("shows At a glance and Coming up only in the ready state", () => {
    state.loading = true;
    const { unmount } = render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-today-at-a-glance")).toBeNull();
    expect(screen.queryByTestId("admin-today-coming-up")).toBeNull();
    unmount();
    state.loading = false;
    state.signedOut = true;
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-today-at-a-glance")).toBeNull();
    expect(screen.queryByTestId("admin-today-coming-up")).toBeNull();
  });

  it("lists Coming up by month with passed dates first under a word and an icon, each row opening its item", () => {
    state.entries = [indemnity, registration, wwc, police];
    render(<AdminTodayPage now={NOW} />);
    const comingUp = screen.getByTestId("admin-today-coming-up");
    const headings = within(comingUp)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Date passed", "Oct 2026", "Jun 2027"]);
    expect(within(comingUp).getByTestId("admin-today-coming-up-group-passed").querySelector("svg")).not.toBeNull();
    const rows = within(comingUp).getAllByTestId("admin-today-coming-up-row");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      `/admin/renewals?item=${wwc.id}`,
      `/admin/renewals?item=${registration.id}`,
      `/admin/renewals?item=${indemnity.id}`,
    ]);
    expect(rows[1].textContent).toContain("15 Oct 2026 · in 2 weeks");
    expect(within(comingUp).queryByTestId("admin-today-coming-up-see-all")).toBeNull();
  });

  it("caps Coming up and offers 'See all in Renewals'", () => {
    state.entries = Array.from({ length: 8 }, (_, index) =>
      complianceFixture(`Item ${index}`, { category: "Training", expiresOn: `2026-11-0${index + 1}` }),
    );
    render(<AdminTodayPage now={NOW} />);
    const comingUp = screen.getByTestId("admin-today-coming-up");
    expect(within(comingUp).getAllByTestId("admin-today-coming-up-row")).toHaveLength(6);
    expect(within(comingUp).getByRole("link", { name: "See all in Renewals" }).getAttribute("href")).toBe(
      "/admin/renewals",
    );
  });

  it("says plainly when nothing is dated in the next 12 months, with a way to Renewals", () => {
    state.entries = [police];
    render(<AdminTodayPage now={NOW} />);
    const empty = screen.getByTestId("admin-today-coming-up-empty");
    expect(empty.textContent).toContain("No recorded dates in the next 12 months");
    expect(within(empty).getByRole("link").getAttribute("href")).toBe("/admin/renewals");
  });

  // Amended for the work-mode redesign, owner request 6 Oct 2026: Josh's locked
  // mockup puts the three counts straight after Needs you, then Coming up, New
  // job, Pinned and Requirements.
  it("orders the page Renew next, Needs you, At a glance, Coming up, New job, Requirements", () => {
    const step = onCallEntryFixture({
      section: "logistics",
      title: "Sign and return your contract",
      details: { category: "Logins", jobStartsOn: "2026-11-02" },
    });
    state.entries = [registration, wwc, police, step];
    render(<AdminTodayPage now={NOW} />);
    const ready = screen.getByTestId("admin-today-ready");
    const order = Array.from(ready.querySelectorAll("[data-testid]"))
      .map((node) => node.getAttribute("data-testid"))
      .filter((id) =>
        [
          "admin-today-renew-next",
          "admin-today-at-a-glance",
          "admin-today-needs-you",
          "admin-today-coming-up",
          "admin-today-requirements",
          "admin-today-new-job",
        ].includes(id ?? ""),
      );
    expect(order).toEqual([
      "admin-today-renew-next",
      "admin-today-needs-you",
      "admin-today-at-a-glance",
      "admin-today-coming-up",
      "admin-today-new-job",
      "admin-today-requirements",
    ]);
    // Two columns from lg: act-on (Renew next, Needs you, the counts) on the left, what is ahead on the right.
    const act = ready.querySelector('[data-today-column="act"]') as HTMLElement;
    const ahead = ready.querySelector('[data-today-column="ahead"]') as HTMLElement;
    expect(act.parentElement?.className).toContain("lg:grid-cols-2");
    expect(within(act).getByTestId("admin-today-needs-you")).toBeTruthy();
    expect(within(act).getByTestId("admin-today-at-a-glance")).toBeTruthy();
    expect(within(ahead).getByTestId("admin-today-coming-up")).toBeTruthy();
    expect(within(ahead).queryByTestId("admin-today-at-a-glance")).toBeNull();
    // The greeting stays the page's only h1.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shapes the loading skeleton like the page: the renew card, the count row, and two modules", () => {
    state.loading = true;
    render(<AdminTodayPage now={NOW} />);
    expect(screen.getByTestId("admin-today-loading-renew-next")).toBeTruthy();
    expect(screen.getByTestId("admin-today-loading-at-a-glance").children).toHaveLength(3);
    expect(screen.getByTestId("admin-today-loading-needs-you")).toBeTruthy();
    expect(screen.getByTestId("admin-today-loading-coming-up")).toBeTruthy();
  });
});

// Work-mode redesign, owner request 6 Oct 2026: the additions to Today.
describe("AdminTodayPage work-mode additions", () => {
  it("no longer carries the credentials wallet, which moved to New job", () => {
    state.entries = [registration, indemnity];
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-credentials-wallet")).toBeNull();
  });

  it("lists numbers pinned on Help under Pinned, each opening the dial sheet", () => {
    const security = onCallEntryFixture({
      section: "logistics",
      title: "Demo security escort",
      details: { category: "Facilities", phone: "08 9000 0000" },
      isOwn: true,
    });
    state.entries = [registration, security];
    window.localStorage.setItem(adminPinsStorageKey, JSON.stringify([security.id]));
    try {
      render(<AdminTodayPage now={NOW} />);
      const pinned = screen.getByTestId("admin-today-pinned");
      expect(within(pinned).getByRole("heading", { name: /Pinned/ })).toBeTruthy();
      expect(pinned).toHaveTextContent("Also on My Day");
      fireEvent.click(within(pinned).getByRole("button", { name: "Call Demo security escort" }));
      expect(screen.getByTestId("admin-today-pinned-dial")).toBeTruthy();
    } finally {
      window.localStorage.removeItem(adminPinsStorageKey);
    }
  });

  it("links the Overtime row to Roster's extra time view", () => {
    state.entries = [registration];
    render(<AdminTodayPage now={NOW} />);
    const link = screen.getByTestId("admin-today-overtime-link");
    expect(link.getAttribute("href")).toBe("/roster?view=hours");
  });

  it("offers Add a renewal in the dock only when the reader can write", () => {
    state.entries = [registration, indemnity];
    const { unmount } = render(<AdminTodayPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-today-add"));
    expect(screen.getByTestId("admin-quick-add-sheet")).toBeTruthy();
    unmount();
    state.demoMode = true;
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-today-add")).toBeNull();
  });

  it("puts Renewed beside the featured passed date, opening that item on Renewals", () => {
    state.entries = [registration, wwc];
    render(<AdminTodayPage now={NOW} />);
    const renewed = screen.getByTestId("admin-today-needs-you-renewed");
    expect(renewed.getAttribute("href")).toBe(`/admin/renewals#on-call-entry-${wwc.id}`);
    expect(renewed).toHaveAccessibleName("Renewed: Working with Children card");
  });

  it("shows no Overtime, counts or lists while signed out, only sign-in and Help", () => {
    state.signedOut = true;
    render(<AdminTodayPage now={NOW} />);
    expect(screen.queryByTestId("admin-today-overtime")).toBeNull();
    expect(screen.queryByTestId("admin-today-add")).toBeNull();
    expect(screen.getByTestId("admin-today-help-row").getAttribute("href")).toBe("/admin/help");
  });
});
