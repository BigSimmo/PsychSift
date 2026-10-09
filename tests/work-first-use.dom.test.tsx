/** @vitest-environment jsdom */

// First use with no data: each area's title as a heading, its two next steps
// with the right addresses, and the quiet example data offer.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  status: "authenticated",
  authEpoch: 1,
  session: { user: { created_at: "2020-01-01T00:00:00Z" } },
}));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => auth,
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

import { WorkFirstUse } from "@/components/work-first-use/work-first-use";
import { FIRST_USE } from "@/lib/example-data/first-use-copy";
import { readExampleData, resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import type { WorkAreaId } from "@/lib/work-frame/areas";

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "psychsift_example_data=; Path=/; Max-Age=0";
  resetExampleDataForTests();
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("WorkFirstUse", () => {
  it("shows the area's title as a heading, both steps with their addresses, and the example offer", () => {
    render(<WorkFirstUse area="rost" />);
    expect(screen.getByRole("heading", { level: 2, name: "No roster yet" })).toBeTruthy();
    expect(screen.getByText("Join your team's roster or add your own shifts.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join a team" }).getAttribute("href")).toBe("/roster/join");
    expect(screen.getByRole("link", { name: "Add shifts" }).getAttribute("href")).toBe("/roster/shifts");
    expect(screen.getByRole("button", { name: "Look around with example data" })).toBeTruthy();
  });

  it("turns example data on from the offer, then hides the offer", () => {
    render(<WorkFirstUse area="cpd" />);
    fireEvent.click(screen.getByRole("button", { name: "Look around with example data" }));
    expect(readExampleData().choice).toBe("on");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Look around with example data" })).toBeNull();
  });

  it("hides the offer while example data is already on", () => {
    act(() => setExampleDataOn(true));
    render(<WorkFirstUse area="teach" />);
    expect(screen.queryByRole("button", { name: "Look around with example data" })).toBeNull();
  });

  it("takes other addresses or on-page actions in place of the defaults", () => {
    const onSecondary = vi.fn();
    render(<WorkFirstUse area="admin" primaryHref="/admin?setup=1" onSecondary={onSecondary} />);
    expect(screen.getByRole("link", { name: "Add registration" }).getAttribute("href")).toBe("/admin?setup=1");
    fireEvent.click(screen.getByRole("button", { name: "Add a renewal" }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });
});

describe("first-use copy", () => {
  const routes = path.join(process.cwd(), "src/app/(search-app)");

  it.each(Object.entries(FIRST_USE))("%s leads only to routes that exist", (_area, copy) => {
    for (const href of [copy.primary.href, copy.secondary.href]) {
      const route = href.split("?")[0]!;
      expect(existsSync(path.join(routes, route, "page.tsx")), href).toBe(true);
    }
  });

  it("says Assessments is an example of CLA, with real records kept in CLA", () => {
    const assess = FIRST_USE.assess;
    expect(`${assess.title} ${assess.body}`).toContain("CLA");
    expect(assess.body).toContain("Your real records stay in CLA.");
    expect(JSON.stringify(assess)).not.toMatch(/start/i);
    expect(assess.secondary.href).toBe("/teaching/assessments?view=words");
  });

  it("covers every work area", () => {
    const areas: WorkAreaId[] = ["day", "notify", "rost", "open", "manage", "teach", "assess", "cpd", "admin", "call"];
    expect(Object.keys(FIRST_USE).sort()).toEqual([...areas].sort());
  });
});
