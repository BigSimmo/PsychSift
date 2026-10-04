/** @vitest-environment jsdom */

import { existsSync, readdirSync, readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: nav.redirect,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/on-call",
  useSearchParams: () => new URLSearchParams(),
}));
const store = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null,
  retry: () => {},
  cachedAt: null,
  signedOut: false,
  demoMode: false,
}));
vi.mock("@/lib/on-call/entry-store", () => ({ useOnCallEntries: () => store, cacheOnCallEntries: vi.fn() }));

import OnCallEducationRoute from "@/app/(search-app)/on-call/education/page";
import { OnCallCalendarPage } from "@/components/on-call/on-call-calendar-page";
import { OnCallSearchBox } from "@/components/on-call/on-call-search-box";
import { selectCardEntries } from "@/lib/on-call/card-selection";
import { proxy } from "@/proxy";

function entry(overrides: Partial<OnCallEntry> & Pick<OnCallEntry, "id" | "section">): OnCallEntry {
  return {
    slug: overrides.id,
    title: `Entry ${overrides.id}`,
    subtitle: null,
    body: null,
    details: {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 0,
    lastVerifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

const TEACHING = entry({
  id: "ward-teaching",
  section: "education",
  title: "Ward teaching",
  details: { nextOccurrence: "12:30", nextOccurrenceDate: "2026-09-02", recurrenceRule: { frequency: "weekly" } },
});
const LICENCE = entry({
  id: "licence",
  section: "logistics",
  title: "Driver's licence",
  includeOnCard: false,
  details: { kind: "compliance", expiresOn: "2026-09-30" },
});
const WARD = entry({
  id: "ward",
  section: "contacts",
  title: "Ward teaching room",
  details: { role: "Ward clerk", phone: "08 9000 0003" },
});

afterEach(() => {
  cleanup();
  store.entries = [];
  nav.redirect.mockReset();
});

describe("Teaching owns the programme; On Call education hard-redirects", () => {
  it("hard-redirects /on-call/education to Teaching Week (proxy + page backstop)", async () => {
    const response = await proxy(new NextRequest(new URL("http://localhost/on-call/education?from=bookmark")));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/teaching/week");
    expect(location.searchParams.get("from")).toBe("bookmark");

    OnCallEducationRoute();
    expect(nav.redirect).toHaveBeenCalledWith("/teaching/week");
  });

  it("retains teaching selected for the pocket card", () => {
    expect(selectCardEntries([TEACHING, WARD], new Date()).map((e) => e.id)).toEqual(
      expect.arrayContaining(["ward", "ward-teaching"]),
    );
  });

  it("keeps legacy teaching discoverable in On Call search", () => {
    render(<OnCallSearchBox entries={[TEACHING, WARD]} />);
    fireEvent.change(screen.getByRole("searchbox", { name: /search on call/i }), { target: { value: "teaching" } });
    expect(screen.queryByTestId("on-call-search-group-education")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-search-row-ward")).toBeInTheDocument();
  });

  it("keeps legacy teaching alongside recorded expiry dates", () => {
    store.entries = [TEACHING, LICENCE];
    render(<OnCallCalendarPage now={new Date(2026, 8, 30, 9, 0)} />);
    const day = screen.getByTestId("on-call-calendar-view-day");
    expect(day).toHaveTextContent("Driver's licence expires");
    expect(day).toHaveTextContent("Ward teaching");
  });

  it("removes the home strip's usage, and My Work's tile no longer mentions teaching", () => {
    const home = readFileSync("src/components/on-call/on-call-home.tsx", "utf8");
    expect(home).not.toMatch(/on-call-home-upcoming|OnCallTeachingStrip|selectUpcomingTeachingSessions/);
    // R13: the component and its test are never deleted without Josh's typed
    // sentence, so `OnCallTeachingStrip` stays on disk — just unused by the home
    // above, which is the actual behaviour change (spec §8).
    expect(existsSync("src/components/on-call/on-call-teaching-strip.tsx")).toBe(true);
    // My Work's home (and its Calendar tile) became Admin in Admin update 1 and was deleted, so the
    // old "Teaching and recorded expiry dates" tile text must not survive anywhere it moved to.
    expect(existsSync("src/components/my-work/my-work-home.tsx")).toBe(false);
    for (const name of readdirSync("src/components/admin")) {
      if (!name.endsWith(".tsx")) continue;
      expect(readFileSync(`src/components/admin/${name}`, "utf8"), name).not.toMatch(/Teaching and recorded expiry/);
    }
  });
});
