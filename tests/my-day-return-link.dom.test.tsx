/** @vitest-environment jsdom */

// The way back to My Day (design review 2026-10-03, item 2): links out of My
// Day carry `?from=my-day`, and the shared shell shows "‹ My Day" on the page
// they open, for as long as the reader stays inside that mode.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyDayReturnLink } from "@/components/my-day/my-day-return-link";
import { arrivedFromMyDay, MY_DAY_ALL_VIEW_HREF, withMyDayReturn } from "@/lib/my-day/return-link";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function at(pathname: string, search = "") {
  nav.pathname = pathname;
  nav.search = search;
}

beforeEach(() => at("/"));
afterEach(cleanup);

describe("withMyDayReturn", () => {
  it("adds the marker to a same-site path, keeping its query and hash", () => {
    expect(withMyDayReturn("/admin/renewals")).toBe("/admin/renewals?from=my-day");
    expect(withMyDayReturn("/admin/renewals?item=e1")).toBe("/admin/renewals?item=e1&from=my-day");
    expect(withMyDayReturn("/cme/log?year=2026&tab=finish#cme-drafts")).toBe(
      "/cme/log?year=2026&tab=finish&from=my-day#cme-drafts",
    );
  });

  it("leaves My Day's own pages, other sites and an existing marker alone", () => {
    expect(withMyDayReturn("/my-day")).toBe("/my-day");
    expect(withMyDayReturn(MY_DAY_ALL_VIEW_HREF)).toBe(MY_DAY_ALL_VIEW_HREF);
    expect(withMyDayReturn("https://example.org/a")).toBe("https://example.org/a");
    expect(withMyDayReturn("//example.org/a")).toBe("//example.org/a");
    expect(withMyDayReturn("/roster?from=elsewhere")).toBe("/roster?from=elsewhere");
  });

  it("reads the marker back", () => {
    expect(arrivedFromMyDay(new URLSearchParams("from=my-day"))).toBe(true);
    expect(arrivedFromMyDay(new URLSearchParams("from=home"))).toBe(false);
    expect(arrivedFromMyDay(null)).toBe(false);
  });
});

describe("MyDayReturnLink", () => {
  it("shows nothing on a page not opened from My Day", () => {
    at("/cme/new");
    render(<MyDayReturnLink />);
    expect(screen.queryByTestId("my-day-return")).toBeNull();
  });

  it("offers ‹ My Day on a page opened from My Day", () => {
    at("/cme/new", "from=my-day");
    render(<MyDayReturnLink />);
    expect(screen.getByRole("link", { name: "My Day" }).getAttribute("href")).toBe("/my-day");
  });

  it("keeps the way back inside the same mode (after saving) and drops it on leaving", () => {
    at("/cme/new", "from=my-day");
    const { rerender } = render(<MyDayReturnLink />);
    at("/cme/log", "year=2026");
    rerender(<MyDayReturnLink />);
    expect(screen.getByTestId("my-day-return")).toBeTruthy();
    at("/roster");
    rerender(<MyDayReturnLink />);
    expect(screen.queryByTestId("my-day-return")).toBeNull();
    at("/cme/log");
    rerender(<MyDayReturnLink />);
    expect(screen.queryByTestId("my-day-return")).toBeNull();
  });

  it("never shows on My Day itself", () => {
    at("/my-day", "from=my-day");
    render(<MyDayReturnLink />);
    expect(screen.queryByTestId("my-day-return")).toBeNull();
  });
});
