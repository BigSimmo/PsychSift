/** @vitest-environment jsdom */

// My Day: the page (loading, signed-out, ready sections, notices, empty) and the
// home card (renders nothing unless there is something to show).

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MyDayItem, MyDaySourceResult, MyDayState } from "@/lib/my-day/model";

const hookState: { current: MyDayState } = vi.hoisted(() => ({ current: undefined as unknown as MyDayState }));
vi.mock("@/components/my-day/use-my-day-items", () => ({
  useMyDayItems: () => hookState.current,
}));

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

vi.mock("@/components/my-day/modules/my-day-modules", () => ({
  MyDayModules: ({ children }: { children?: unknown }) => (
    <>
      <div data-testid="my-day-modules" />
      {children as never}
    </>
  ),
}));

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

beforeEach(() => {
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

  it("asks a signed-out reader to sign in", () => {
    auth.status = "signed_out";
    setState({ status: "signed-out" });
    render(<MyDayPage now={NOW} />);
    const panel = screen.getByTestId("my-day-signed-out");
    expect(within(panel).getByText("Sign in to see your day")).toBeTruthy();
    expect(screen.queryByTestId("account-dialog")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("account-dialog")).toBeTruthy();
  });

  it("treats an expired session as signed out", () => {
    auth.status = "expired";
    setState({ status: "signed-out" });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-signed-out")).toBeTruthy();
  });

  it("groups items as Needs you now, Due soon, Later in that order and omits empty groups", () => {
    setState({
      items: [item("a", "overdue"), item("b", "soon"), item("c", "info", { mode: "cme", detail: "Extra line" })],
    });
    render(<MyDayPage now={NOW} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Needs you now", "Due soon", "Later"]);
    const later = screen.getByTestId("my-day-item-c");
    expect(later.textContent).toContain("CPD");
    expect(later.textContent).toContain("Extra line");
    expect(screen.getByTestId("my-day-item-a").getAttribute("href")).toBe("/admin/a");

    setState({ items: [item("b", "soon")] });
    cleanup();
    render(<MyDayPage now={NOW} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Due soon"]);
  });

  it("puts the state word in the link text, Date passed for Admin and Overdue elsewhere", () => {
    setState({
      items: [item("a", "overdue"), item("o", "overdue", { mode: "cme" }), item("b", "soon"), item("c", "info")],
    });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-item-a").textContent).toContain("Admin · Date passed · ");
    expect(screen.getByTestId("my-day-item-o").textContent).toContain("CPD · Overdue · ");
    expect(screen.getByTestId("my-day-item-b").textContent).toContain("Admin · Due soon · ");
    expect(screen.getByTestId("my-day-item-c").textContent).not.toMatch(/Overdue|Due soon|Date passed/);
    // The trailing visual label is hidden from assistive tech: the link text carries the meaning.
    expect(document.querySelectorAll('[aria-hidden="true"] [data-state-dot]').length).toBe(3);
  });

  it("shows the date eyebrow above the title", () => {
    render(<MyDayPage now={NOW} />);
    const header = screen.getByTestId("my-day-header");
    expect(header.firstElementChild?.textContent).toBe("Saturday 26 September");
    expect(header.lastElementChild?.textContent).toBe("My Day");
  });

  it("badges each row by mode and colours only an overdue due line with the warning token", () => {
    setState({
      items: [
        item("a", "overdue"),
        item("o", "overdue", { mode: "cme" }),
        item("t", "soon", { mode: "teaching" }),
        item("r", "info", { mode: "roster" }),
        item("c", "info", { mode: "on-call" }),
      ],
    });
    render(<MyDayPage now={NOW} />);
    const badges = ["a", "o", "t", "r", "c"].map((id) => screen.getByTestId(`my-day-item-badge-${id}`));
    expect(badges.map((badge) => badge.textContent)).toEqual(["ADM", "CPD", "TCH", "ROS", "OC"]);
    for (const badge of badges) expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("my-day-item-a").querySelector('[class*="--warning"]')).toBeTruthy();
    expect(screen.getByTestId("my-day-item-t").querySelector('[class*="--warning"]')).toBeNull();
    expect(screen.getByTestId("my-day-item-a").textContent).not.toMatch(/Expired/);
  });

  it("filters the list by mode with local pills and says so when a mode has nothing", () => {
    setState({
      items: [
        item("a", "overdue"),
        item("o", "overdue", { mode: "cme" }),
        item("t", "soon", { mode: "teaching" }),
        item("r", "info", { mode: "roster" }),
      ],
    });
    render(<MyDayPage now={NOW} />);
    const group = screen.getByRole("group", { name: "Filter by mode" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All", "On Call", "Roster", "CPD", "Teaching", "Admin"]);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All 4" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "CPD" }));
    expect(screen.getByRole("button", { name: "CPD" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("my-day-item-o")).toBeTruthy();
    expect(screen.queryByTestId("my-day-item-a")).toBeNull();
    expect(screen.queryByTestId("my-day-item-t")).toBeNull();
    // A group with nothing left in it disappears.
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Needs you now",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "On Call" }));
    expect(screen.getByTestId("my-day-filter-empty").textContent).toBe("Nothing from On Call needs you.");

    fireEvent.click(screen.getByRole("button", { name: "All 4" }));
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    expect(screen.getByTestId("my-day-item-r")).toBeTruthy();
  });

  it("names failed sources, keeps the rest, and retries on click", () => {
    setState({
      items: [item("a", "soon")],
      sources: readySources.map((source) =>
        source.mode === "roster" || source.mode === "cme" ? { ...source, status: "failed" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-failed-notice").textContent).toContain(
      "Couldn't load: Roster, CPD. Showing the rest.",
    );
    expect(screen.getByTestId("my-day-item-a")).toBeTruthy();
    expect(
      screen.getByTestId("my-day-failed-notice").querySelector('[class*="border-l-[color:var(--warning)]"]'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("explains an unavailable Roster source", () => {
    setState({
      sources: readySources.map((source) =>
        source.mode === "roster" ? { ...source, status: "unavailable" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-unavailable-notice").textContent).toContain(
      "Roster team data isn't available yet, so swaps aren't shown.",
    );
  });

  it("says when the data is demo data", () => {
    setState({ demoMode: true, items: [item("a", "soon")] });
    render(<MyDayPage now={NOW} />);
    expect(screen.getByTestId("my-day-demo-notice").textContent).toContain(
      "Demo data: these items are invented examples.",
    );
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

  it("shows a calm empty state naming only the modes that were checked", () => {
    setState({
      sources: readySources.map((source) =>
        source.mode === "roster" ? { ...source, status: "failed" as const } : source,
      ),
    });
    render(<MyDayPage now={NOW} />);
    const empty = screen.getByTestId("my-day-empty");
    expect(empty.textContent).toContain("Nothing needs you right now");
    expect(empty.textContent).toContain("On Call");
    expect(empty.textContent).toContain("Teaching");
    expect(empty.textContent).not.toContain("Roster");
    expect(screen.getByTestId("my-day-footer").textContent).toContain("Read-only.");
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
