// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Week board chips (mockup `rost_board`, work-mode redesign, owner request
 * 6 Oct 2026): counts that add up to All, a filter on the grid, and the
 * "Unfilled, next 48 h" list. Every shift here is invented.
 */

const state = vi.hoisted(() => ({ shifts: [] as unknown[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/open-shifts/board", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/open-shifts/use-posted-shifts", () => ({
  usePostedShifts: () => ({
    status: "ready",
    shifts: state.shifts,
    teams: [],
    failedTeams: [],
    readAt: null,
    refreshFailed: false,
    message: null,
    reload: vi.fn(),
  }),
}));
vi.mock("@/components/roster/roster-format", async (original) => ({
  ...(await original<typeof import("@/components/roster/roster-format")>()),
  // Wed 7 Oct 2026, 09:00 in Perth.
  useRosterNow: () => new Date("2026-10-07T01:00:00Z"),
}));

import { OpenShiftsBoardPage } from "@/components/open-shifts/open-shifts-board-page";

function posted(id: string, status: string, date: string, siteName = "Example Hospital") {
  return {
    id,
    status,
    serviceId: "team",
    teamName: "Example team",
    siteName,
    startsAt: `${date}T08:00:00+08:00`,
    endsAt: `${date}T16:30:00+08:00`,
    claimantName: status === "claimed" ? "Dr Sam Example" : null,
  };
}

afterEach(cleanup);

describe("Week board chips", () => {
  it("counts each kind so they add up to All, and filters the grid", () => {
    state.shifts = [
      posted("u", "open", "2026-10-08"),
      posted("o", "open", "2026-10-10"),
      posted("r", "claimed", "2026-10-09", "Other Hospital"),
      posted("f", "approved", "2026-10-11"),
    ];
    render(<OpenShiftsBoardPage />);
    const chip = (id: string) => screen.getByTestId(`open-shifts-board-chip-${id}`);
    expect(chip("all").textContent).toBe("All4");
    expect(chip("open").textContent).toBe("Open1");
    expect(chip("unfilled").textContent).toBe("Unfilled1");
    expect(chip("requested").textContent).toBe("Requested1");
    expect(chip("filled").textContent).toBe("Filled1");
    expect(screen.queryByTestId("open-shifts-board-chip-reported")).toBeNull();
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("requested"));
    expect(chip("requested").getAttribute("aria-pressed")).toBe("true");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("link")).toHaveLength(1);
    expect(within(table).getByText("Other Hospital")).toBeTruthy();
    expect(within(table).queryByText("Example Hospital")).toBeNull();
  });

  it("lists shifts unfilled in the next 48 h with a link to decide", () => {
    state.shifts = [posted("u", "open", "2026-10-08"), posted("o", "open", "2026-10-11")];
    render(<OpenShiftsBoardPage />);
    const list = screen.getByTestId("open-shifts-board-unfilled");
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toContain("08:00 to 16:30");
  });

  it("says when nothing matches a chip and offers Show all", () => {
    state.shifts = [posted("o", "open", "2026-10-11")];
    render(<OpenShiftsBoardPage />);
    fireEvent.click(screen.getByTestId("open-shifts-board-chip-filled"));
    expect(screen.getByTestId("open-shifts-board-none").textContent).toContain("None filled this week.");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByTestId("open-shifts-board-unfilled")).toBeNull();
  });
});
