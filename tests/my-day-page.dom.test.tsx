/** @vitest-environment jsdom */

// My Day: the page (loading, signed-out, ready sections, notices, empty) and the
// home card (renders nothing unless there is something to show).

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import type { MyDayItem, MyDaySourceResult, MyDayState } from "@/lib/my-day/model";

const hookState: { current: MyDayState } = vi.hoisted(() => ({ current: undefined as unknown as MyDayState }));
vi.mock("@/components/my-day/use-my-day-items", () => ({
  useMyDayItems: () => hookState.current,
}));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

// The dashboard's own reads (Roster shifts, today's Teaching, CPD hours) answer
// "nothing" here, so only the My Day items drive what these tests see. The
// dashboard cards themselves are covered in `my-day-dashboard.dom.test.tsx`.
vi.mock("@/components/my-day/use-my-day-dashboard-sources", () => ({
  useMyDayDashboardSources: () => ({
    roster: { status: "unavailable", shifts: [], sample: false },
    teaching: { status: "unavailable", sessions: [], sample: false },
    cpd: { status: "unavailable", year: null, loggedHours: 0, targetHours: 0, sample: false },
  }),
}));

// The full list ("All N") has its own address, `/my-day?view=all`. The page
// reads it through `useSearchParams`; here that reads jsdom's own address, and
// a test re-renders after the page pushes it (Next's router does that live).
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const currentTab = vi.hoisted(() => vi.fn());
vi.mock("@/components/mode-band/mode-band", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/mode-band/mode-band")>()),
  useModeBandCurrentTab: currentTab,
}));
// The Favourites shelf (after Needs you on Today) has its own tests and reads the account store.
vi.mock("@/components/favourites/my-day-favourites-shelf", () => ({ MyDayFavouritesShelf: () => null }));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));

import { MyDayHomeCard, resetMyDayHomeCardCache } from "@/components/my-day/my-day-home-card";
import { MyDayPage } from "@/components/my-day/my-day-page";

// 09:00 on Sat 26 Sep 2026 in Perth.
const NOW = new Date("2026-09-26T01:00:00Z");

function item(id: string, severity: MyDayItem["severity"], overrides: Partial<MyDayItem> = {}): MyDayItem {
  return {
    id,
    mode: "my-work",
    title: `Title ${id}`,
    due: severity === "info" ? "2026-12-01" : "2026-09-27",
    severity,
    href: `/admin/${id}`,
    ...overrides,
  };
}

const retry = vi.fn();
const readySources: MyDaySourceResult[] = [
  { mode: "on-call", status: "ready", items: [] },
  { mode: "roster", status: "ready", items: [] },
  { mode: "cme", status: "ready", items: [] },
  { mode: "teaching", status: "ready", items: [] },
  { mode: "my-work", status: "ready", items: [] },
];

function setState(overrides: Partial<MyDayState>) {
  hookState.current = {
    status: "ready",
    items: [],
    sources: readySources,
    demoMode: false,
    retry,
    ...overrides,
  };
}

/** Choose "All N", then re-render as the router would once the address changed. */
function openAll(name: string, rerender: (ui: ReactElement) => void) {
  fireEvent.click(screen.getByRole("button", { name }));
  expect(window.location.pathname + window.location.search).toBe("/my-day?view=all");
  rerender(<MyDayPage now={NOW} />);
}

beforeEach(() => {
  // The example data switch is per device: start each test in auto mode with nothing known.
  window.localStorage.clear();
  resetExampleDataForTests();
  window.history.replaceState(null, "", "/my-day");
  auth.status = "authenticated";
  auth.authEpoch = 1;
  resetMyDayHomeCardCache();
  retry.mockClear();
  setState({});
});
afterEach(cleanup);

describe("MyDayPage", () => {
  it("shows a static skeleton while loading", () => {
    setState({ status: "loading" });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByRole("heading", { name: "My Day" })).toBeTruthy();
    expect(screen.getByTestId("my-day-loading")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading My Day");
    expect(screen.queryByTestId("my-day-ready")).toBeNull();
  });

  it("shows the skeleton, not the sign-in prompt, while the sign-in is still being checked", () => {
    auth.status = "loading";
    setState({ status: "signed-out" });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-loading")).toBeTruthy();
    expect(screen.queryByTestId("my-day-signed-out")).toBeNull();
  });

  it("runs the sources in a local demo build with no sign-in configured", () => {
    auth.status = "unconfigured";
    setState({ items: [item("a", "soon")] });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    expect(screen.queryByTestId("my-day-signed-out")).toBeNull();
  });

  it("says it could not check the sign-in, with a retry, rather than asking to sign in", () => {
    auth.status = "error";
    setState({ status: "signed-out" });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-auth-error").textContent).toContain("Couldn't check your sign-in. Try again.");
    expect(screen.queryByTestId("my-day-signed-out")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("asks a signed-out reader who turned example data off to sign in", async () => {
    auth.status = "signed_out";
    setState({ status: "signed-out" });
    setExampleDataOn(false);
    render(<MyDayPage now={NOW} />);
    expect(screen.queryByTestId("my-day-sample")).toBeNull();
    const panel = screen.getByTestId("my-day-signed-out");
    expect(within(panel).getByText("Sign in to see your day")).toBeTruthy();
    expect(screen.queryByTestId("account-dialog")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("account-dialog")).toBeTruthy();
  });

  it("shows a signed-out visitor a sample day by default, with no per-page notice (the frame's banner says it)", async () => {
    auth.status = "signed_out";
    setState({ status: "signed-out" });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-sample")).toBeTruthy();
    expect(screen.queryByTestId("my-day-sample-notice")).toBeNull();
    expect(screen.queryByTestId("my-day-sample-line")).toBeNull();
    expect(screen.queryByTestId("my-day-signed-out")).toBeNull();
    const dashboard = await screen.findByTestId("my-day-dashboard", undefined, { timeout: 5000 });
    expect(within(dashboard).getAllByText("Journal club").length).toBeGreaterThan(0);
    // "Later" on a sample row lasts only while the page is open, and stores nothing.
    const before = window.localStorage.length;
    fireEvent.click(within(dashboard).getAllByRole("button", { name: /Later/ })[0]!);
    expect(window.localStorage.length).toBe(before);
    // Signed in, nothing of the sample shows.
    cleanup();
    auth.status = "authenticated";
    setState({});
    render(<MyDayPage now={NOW} />);
    expect(screen.queryByTestId("my-day-sample")).toBeNull();
    expect(screen.queryByText("Journal club")).toBeNull();
  });

  it("leaves the device-only quick note out of the signed-out sample", async () => {
    auth.status = "signed_out";
    setState({ status: "signed-out" });
    window.history.replaceState(null, "", "/my-day?page=me");
    render(<MyDayPage now={NOW} />);
    const dashboard = await screen.findByTestId("my-day-dashboard", undefined, { timeout: 5000 });
    expect(dashboard.getAttribute("data-page")).toBe("me");
    expect(screen.queryByTestId("my-day-card-quick-note")).toBeNull();
  });

  it("treats an expired session as signed out", () => {
    auth.status = "expired";
    setState({ status: "signed-out" });
    setExampleDataOn(false);
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-signed-out")).toBeTruthy();
  });

  // The grouped list is now the dashboard's "All N" view (the default view is
  // the card dashboard), so these two open it first.
  // work-mode redesign, owner request 6 Oct 2026: the groups are by due date, Overdue, Today, This week and Later, each
  // with its count at the right; the row's link is its verb pill.
  it("groups items as Overdue, Today, This week, Later in that order and omits empty groups", () => {
    setState({
      items: [item("a", "overdue"), item("b", "soon"), item("c", "info", { mode: "cme", detail: "Extra line" })],
    });
    const first = render(<MyDayPage now={NOW} />);
    openAll("See all 3", first.rerender);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Overdue", "This week", "Later"]);
    const later = screen.getByTestId("my-day-item-c");
    expect(later.textContent).toContain("CPD");
    expect(later.textContent).toContain("Extra line");
    // Every link out of My Day carries the "from My Day" marker for the "‹ My Day" link.
    expect(screen.getByTestId("my-day-open-a").getAttribute("href")).toBe("/admin/a?from=my-day");

    setState({ items: [item("b", "soon")] });
    cleanup();
    window.history.replaceState(null, "", "/my-day");
    const second = render(<MyDayPage now={NOW} />);
    openAll("See all 1", second.rerender);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["This week"]);
  });

  it("puts the state word in the link text, Date passed for Admin and Overdue elsewhere", () => {
    setState({
      items: [item("a", "overdue"), item("o", "overdue", { mode: "cme" }), item("b", "soon"), item("c", "info")],
    });
    const { rerender } = render(<MyDayPage now={NOW} />);
    openAll("See all 4", rerender);
    // work-mode redesign, owner request 6 Oct 2026: the row's small line leads with the late part in words ("Date passed",
    // "Overdue"), then the date and the area; colour is never the only cue.
    expect(screen.getByTestId("my-day-item-a").textContent).toContain("Date passed");
    expect(screen.getByTestId("my-day-item-a").textContent).toContain("Admin");
    expect(screen.getByTestId("my-day-item-o").textContent).toContain("Overdue");
    expect(screen.getByTestId("my-day-item-o").textContent).toContain("CPD");
    expect(screen.getByTestId("my-day-item-b").textContent).toContain("Due 27 Sep");
    expect(screen.getByTestId("my-day-item-c").textContent).not.toMatch(/Overdue|Due soon|Date passed/);
  });

  it("names failed sources, keeps the rest, and retries on click", () => {
    setState({
      items: [item("a", "soon")],
      sources: readySources.map((source) =>
        source.mode === "roster" || source.mode === "cme" ? { ...source, status: "failed" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-failed-notice").textContent).toContain("Couldn't load: Roster, CPD.");
    expect(screen.getByTestId("my-day-failed-notice").textContent).toContain("Showing the rest.");
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    // Amber, and read out as soon as it appears.
    expect(screen.getByTestId("my-day-failed-notice").getAttribute("data-warn")).toBe("");
    expect(screen.getByTestId("my-day-failed-notice").getAttribute("role")).toBe("alert");
    fireEvent.click(within(screen.getByTestId("my-day-failed-notice")).getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("explains an unavailable Roster source in the one line of small print", () => {
    setState({
      sources: readySources.map((source) =>
        source.mode === "roster" ? { ...source, status: "unavailable" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-unavailable-notice").textContent).toBe("Roster swaps aren't available yet.");
    expect(screen.getByTestId("my-day-small-print").textContent).toBe("Roster swaps aren't available yet.");
  });

  // Demo data is shown only in a local demo build with no sign-in ("unconfigured").
  it("says when the data is demo data, in a local demo build", () => {
    auth.status = "unconfigured";
    setState({ demoMode: true, items: [item("a", "soon")] });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-demo-notice").textContent).toBe("Demo data: invented examples.");
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
  });

  it("folds the demo note and every 'not available yet' into one line", () => {
    auth.status = "unconfigured";
    setState({
      demoMode: true,
      items: [item("a", "soon")],
      sources: readySources.map((source) =>
        source.mode === "roster" || source.mode === "teaching" ? { ...source, status: "unavailable" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-small-print").textContent).toBe(
      "Demo data: invented examples. Roster swaps and Teaching aren't available yet.",
    );
    expect(screen.queryByTestId("my-day-unavailable-other-notice")).toBeNull();
  });

  it("never shows a signed-in reader items from a source that answered with sample data", () => {
    setState({
      demoMode: true,
      items: [item("a", "soon", { mode: "cme" }), item("b", "soon")],
      sources: readySources.map((source) => (source.mode === "cme" ? { ...source, sample: true } : source)),
    });
    const { rerender } = render(<MyDayPage now={NOW} />);
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
    expect(screen.getByTestId("my-day-item-b")).toBeTruthy();
    expect(screen.queryByTestId("my-day-demo-notice")).toBeNull();
    openAll("See all 1", rerender);
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
  });

  // Design review 2026-10-03, item 1: the full list has its own address, so the
  // phone's Back returns to the dashboard instead of leaving My Day.
  it("opens the full list at its own address and steps back to the dashboard", () => {
    setState({ items: [item("a", "overdue"), item("b", "soon"), item("c", "soon"), item("d", "info")] });
    const { rerender } = render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("my-day-item-d")).toBeNull();
    const before = window.history.length;
    openAll("See all 4", rerender);
    expect(window.history.length).toBe(before + 1);
    expect(screen.getByTestId("my-day-full-list")).toBeTruthy();
    expect(screen.getByTestId("my-day-item-d")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    // Opened from the dashboard, so focus lands at the top of the list.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to dashboard" }));
    // "Back to dashboard" is the same step back as the phone's Back.
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState(null, "", "/my-day");
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
    rerender(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-dashboard")).toBeTruthy();
  });

  it("opens the full list straight from its address, and Back to dashboard replaces it", () => {
    setState({ items: [item("a", "overdue")] });
    window.history.replaceState(null, "", "/my-day?view=all");
    const { rerender } = render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-full-list")).toBeTruthy();
    const back = vi.spyOn(window.history, "back");
    fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    // Nothing of ours is behind a direct load, so it replaces rather than leaving the site.
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
    expect(window.location.pathname + window.location.search).toBe("/my-day");
    rerender(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-dashboard")).toBeTruthy();
  });

  // Design review v13: Today, Work and Me pages at `?page=`. The header's tabs
  // switch them; the page names the current one, since ?page= is not in the path.
  it("opens the page named in the address and names it as the header's current tab", () => {
    window.history.replaceState(null, "", "/my-day?page=work");
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-dashboard").getAttribute("data-page")).toBe("work");
    expect(currentTab).toHaveBeenLastCalledWith("my-day-work");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  // work-mode redesign, owner request 6 Oct 2026: a sideways swipe moves between the frame's tabs (Today, Week, Hours),
  // which the shared work frame owns, so the page has no swipe panel of its own.
  it("leaves the sideways swipe to the work frame, with no in-page swipe panel", () => {
    render(<MyDayPage now={NOW} />);
    expect(document.getElementById("my-day-panel")).toBeNull();
    const body = screen.getByTestId("my-day-dashboard");
    fireEvent.touchStart(body, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(body, { changedTouches: [{ clientX: 100, clientY: 110 }] });
    expect(window.location.search).toBe("");
  });

  it("falls back to Today for an unknown page", () => {
    window.history.replaceState(null, "", "/my-day?page=nonsense");
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-dashboard").getAttribute("data-page")).toBe("today");
  });

  it("does not claim 'nothing needs you' when no source could be checked", () => {
    setState({ sources: readySources.map((source) => ({ ...source, status: "failed" as const })) });
    render(<MyDayPage now={NOW} />);
    const empty = screen.getByTestId("my-day-empty");
    expect(empty.textContent).toContain("Couldn't check your day");
    expect(empty.textContent).not.toContain("Nothing needs you right now");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says nothing needs you, and when it checked, only when every source answered", () => {
    render(<MyDayPage now={NOW} />);
    const empty = screen.getByTestId("my-day-empty");
    expect(empty.textContent).toContain("Nothing needs you right now");
    expect(empty.textContent).toMatch(/Checked .* at \d{2}:\d{2}\./);
  });

  it("names only the modes that were checked, and never says nothing needs you while one failed", () => {
    setState({
      sources: readySources.map((source) =>
        source.mode === "roster" ? { ...source, status: "failed" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    const empty = screen.getByTestId("my-day-empty");
    expect(empty.textContent).toContain("Nothing found in the sources that loaded");
    expect(empty.textContent).not.toContain("Nothing needs you right now");
    expect(empty.textContent).toContain("On Call");
    expect(empty.textContent).toContain("Teaching");
    expect(empty.textContent).not.toContain("Roster");
    // Design review item 10: the "Read-only…" footer line is gone; with nothing
    // unavailable and no demo data there is no small print at all.
    expect(screen.queryByTestId("my-day-footer")).toBeNull();
    expect(screen.queryByTestId("my-day-small-print")).toBeNull();
  });
});

describe("MyDayHomeCard", () => {
  it("renders nothing when signed out", () => {
    auth.status = "signed_out";
    setState({ status: "signed-out", items: [] });
    const { container } = render(<MyDayHomeCard now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while loading with nothing remembered", () => {
    setState({ status: "loading", items: [item("a", "overdue")] });
    const { container } = render(<MyDayHomeCard now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the remembered items at once on return, for the same sign-in and under two minutes", () => {
    setState({ items: [item("a", "overdue")] });
    render(<MyDayHomeCard now={NOW} />);
    cleanup();

    setState({ status: "loading", items: [] });
    render(<MyDayHomeCard now={NOW} />);
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    cleanup();

    auth.authEpoch = 2;
    render(<MyDayHomeCard now={NOW} />);
    expect(screen.queryByTestId("my-day-home-card")).toBeNull();
    cleanup();

    auth.authEpoch = 1;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 60_000);
    render(<MyDayHomeCard now={NOW} />);
    expect(screen.queryByTestId("my-day-home-card")).toBeNull();
    vi.useRealTimers();
  });

  it("never shows one account's remembered items to another when the epoch changes while mounted", () => {
    setState({ items: [item("a", "overdue")] });
    render(<MyDayHomeCard now={NOW} />);
    cleanup();

    setState({ status: "loading", items: [] });
    const { rerender } = render(<MyDayHomeCard now={NOW} />);
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();

    auth.authEpoch = 2;
    rerender(<MyDayHomeCard now={NOW} />);
    expect(screen.queryByTestId("my-day-home-card")).toBeNull();
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
  });

  it("says which modes could not load instead of the counts", () => {
    setState({
      items: [item("a", "overdue"), item("b", "soon")],
      sources: readySources.map((source) =>
        source.mode === "roster" || source.mode === "cme" ? { ...source, status: "failed" as const } : source,
      ),
    });
    render(<MyDayHomeCard now={NOW} />);
    const seeAll = screen.getByTestId("my-day-home-card-see-all");
    expect(seeAll.textContent).toContain("See all 2 in My Day");
    expect(seeAll.textContent).toContain("Roster and CPD couldn't load");
    expect(seeAll.textContent).not.toContain("overdue");
  });

  it("renders nothing in demo mode", () => {
    setState({ demoMode: true, items: [item("a", "overdue")] });
    const { container } = render(<MyDayHomeCard now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing with zero items", () => {
    setState({ items: [] });
    const { container } = render(<MyDayHomeCard now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the top three items and a See all link to /my-day", () => {
    setState({
      items: [item("a", "overdue"), item("b", "overdue"), item("c", "soon"), item("d", "info"), item("e", "info")],
    });
    render(<MyDayHomeCard now={NOW} />);
    const card = screen.getByTestId("my-day-home-card");
    expect(within(card).getByRole("heading", { name: "My Day" })).toBeTruthy();
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    expect(screen.getByTestId("my-day-item-c")).toBeTruthy();
    expect(screen.queryByTestId("my-day-item-d")).toBeNull();
    const seeAll = screen.getByTestId("my-day-home-card-see-all");
    expect(seeAll.getAttribute("href")).toBe("/my-day");
    expect(seeAll.textContent).toContain("See all 5 in My Day");
    expect(seeAll.textContent).toContain("2 overdue · 1 due soon");
  });
});
