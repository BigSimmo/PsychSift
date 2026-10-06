/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entriesState, items, personalReferral, ready } from "./helpers/on-call-handbook-fixture";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

const handbook = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof ready> }));
const entries = vi.hoisted(() => ({
  list: [] as OnCallEntry[],
  signedOut: false,
  demoMode: false,
  loading: false,
  loadError: null as "offline" | "failed" | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/refer",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => handbook.state,
}));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () =>
    entriesState(entries.list, {
      signedOut: entries.signedOut,
      demoMode: entries.demoMode,
      loading: entries.loading,
      loadError: entries.loadError,
    }),
}));

import { OnCallReferPage } from "@/components/on-call/refer/refer-page";
import { onCallRouteFreshness } from "@/components/on-call/refer/route-freshness";

beforeEach(() => {
  window.localStorage.clear();
  handbook.state = ready(items([]));
  entries.list = [];
  entries.signedOut = false;
  entries.demoMode = false;
  entries.loading = false;
  entries.loadError = null;
});
afterEach(cleanup);

describe("Refer page", () => {
  it("filters referrals by team, opens detail in a sheet, and keeps the reader's own notes with Add", async () => {
    handbook.state = ready(
      items([
        { id: "r1", title: "Psychiatry: Consult-liaison referral", section: "referrals" },
        { id: "r2", title: "Surgery: Acute surgical referral", section: "referrals" },
      ]),
    );
    entries.list = [personalReferral("p1", "My referral note")];
    render(<OnCallReferPage />);
    expect(screen.getByRole("heading", { level: 2, name: "At Site A" })).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-refer-team")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Filter by team, now All teams" }));
    expect(within(screen.getByTestId("on-call-refer-team")).getByRole("button", { name: "All teams" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(screen.getByTestId("on-call-refer-team")).getByRole("button", { name: "Psychiatry" }));
    expect(screen.getByText("Consult-liaison referral")).toBeInTheDocument();
    expect(screen.queryByText("Acute surgical referral")).toBeNull();
    expect(screen.getByTestId("on-call-refer-team-toggle")).toHaveTextContent("Psychiatry");
    await userEvent.click(screen.getByRole("button", { name: /Consult-liaison referral/ }));
    const detail = screen.getByTestId("on-call-refer-detail");
    expect(within(detail).getByText("Synthetic example only")).toBeInTheDocument();
    expect(within(detail).getByTestId("on-call-updated-date")).toHaveTextContent(/^Updated 20 Sep 2026/);
    await userEvent.keyboard("{Escape}");
    const mine = document.getElementById("on-call-group-mine")!;
    expect(within(mine).getByRole("heading", { level: 2, name: "Your own referral notes" })).toBeInTheDocument();
    expect(within(mine).getByText("My referral note")).toBeInTheDocument();
    expect(within(mine).getByText("Saved to your account. Notes marked private are only yours.")).toBeInTheDocument();
    expect(within(mine).getByRole("link", { name: "Add" })).toHaveAttribute("href", "/on-call/referrals");
    expect(screen.queryByText(/being built/i)).toBeNull();
  });

  it("never shows an empty notes list while the notes are still loading or failed to load", () => {
    entries.loading = true;
    render(<OnCallReferPage />);
    expect(within(screen.getByTestId("on-call-refer-mine")).getByRole("status")).toHaveTextContent(
      "Reading your referral notes…",
    );
    expect(screen.queryByText("No referral notes yet.")).toBeNull();
    cleanup();
    entries.loading = false;
    entries.loadError = "failed";
    render(<OnCallReferPage />);
    expect(screen.getByTestId("on-call-refer-mine-error")).toHaveTextContent("Your referral notes could not be read.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No referral notes yet.")).toBeNull();
  });

  it("draws no team filter with fewer than two teams", () => {
    handbook.state = ready(items([{ id: "r1", title: "Psychiatry: Consult-liaison referral", section: "referrals" }]));
    render(<OnCallReferPage />);
    expect(screen.queryByTestId("on-call-refer-team")).toBeNull();
    expect(screen.queryByTestId("on-call-refer-team-toggle")).toBeNull();
  });

  it("says when each route was updated, and asks for a route unchecked for over 3 months to be confirmed", () => {
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    handbook.state = ready(
      items([
        { id: "fresh", title: "Fresh route", section: "referrals" },
        { id: "stale", title: "Stale route", section: "referrals" },
        { id: "confirmed", title: "Confirmed route", section: "referrals" },
      ]).map((item) =>
        item.id === "fresh"
          ? { ...item, updatedAt: daysAgo(21) }
          : item.id === "stale"
            ? { ...item, updatedAt: daysAgo(130), lastConfirmedAt: null }
            : { ...item, updatedAt: daysAgo(400), lastConfirmedAt: daysAgo(10) },
      ),
    );
    render(<OnCallReferPage />);
    expect(screen.getByTestId("on-call-refer-freshness-fresh")).toHaveTextContent("Updated 3 weeks ago");
    expect(screen.getByTestId("on-call-refer-freshness-fresh")).toHaveAttribute("data-freshness", "fresh");
    const stale = screen.getByTestId("on-call-refer-freshness-stale");
    expect(stale).toHaveTextContent(/^Not checked for 4 months · confirm before use$/);
    expect(stale.className).toMatch(/--warning-text/);
    // A recent editor's confirmation counts as checked, however old the publish date.
    expect(screen.getByTestId("on-call-refer-freshness-confirmed")).toHaveTextContent("Updated 10 days ago");
  });

  it("searches the routes and own notes here, and carries the words to the Services directory", async () => {
    handbook.state = ready(
      items([
        { id: "r1", title: "Psychiatry: Consult-liaison referral", section: "referrals" },
        { id: "r2", title: "Surgery: Acute surgical referral", section: "referrals" },
      ]),
    );
    entries.list = [personalReferral("p1", "Youth service intake")];
    render(<OnCallReferPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Services directory" })).toBeInTheDocument();
    expect(screen.getByTestId("on-call-refer-services-link")).toHaveAttribute("href", "/services/search");
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Search referrals and services");
    await userEvent.type(screen.getByRole("searchbox"), "surgical");
    expect(screen.getByText("Acute surgical referral")).toBeInTheDocument();
    expect(screen.queryByText("Consult-liaison referral")).toBeNull();
    expect(screen.queryByText("Youth service intake")).toBeNull();
    expect(screen.getByTestId("on-call-refer-services-link")).toHaveAttribute("href", "/services/search?q=surgical");
    // The Services mode's own data (shortlist, compare, service cards) is not copied here.
    expect(screen.queryByText(/shortlisted/i)).toBeNull();
  });

  it("dials a referral's number from its detail sheet", async () => {
    handbook.state = ready(
      items([{ id: "r1", title: "Psychiatry: Consult-liaison referral", section: "referrals", phone: "9000 0021" }]),
    );
    render(<OnCallReferPage />);
    await userEvent.click(screen.getByRole("button", { name: /Consult-liaison referral/ }));
    const detail = screen.getByTestId("on-call-refer-detail");
    expect(
      within(detail).getByRole("link", { name: /^call consult-liaison referral, 9 0 0 0, 0 0 2 1$/i }),
    ).toHaveAttribute("href", "tel:0890000021");
  });

  it("does not claim a sample's notes are saved to an account", () => {
    entries.demoMode = true;
    render(<OnCallReferPage />);
    expect(screen.queryByText("Saved to your account. Notes marked private are only yours.")).toBeNull();
  });

  it("shows the crisis lines and the sign-in line, and no hospital referrals, while signed out", () => {
    handbook.state = ready([], { status: "signed-out" });
    entries.signedOut = true;
    render(<OnCallReferPage />);
    expect(screen.getByTestId("on-call-handbook-state-signed-out")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-crisis-lines")).toBeInTheDocument();
    expect(document.getElementById("on-call-group-hospital")).toBeNull();
    expect(screen.getByText("Sign in to keep your own referrals.")).toBeInTheDocument();
    expect(screen.queryByText("Saved to your account. Notes marked private are only yours.")).toBeNull();
    // The editor stays one tap away; it asks for sign-in itself.
    expect(screen.getByTestId("on-call-refer-mine-link")).toHaveAttribute("href", "/on-call/referrals");
  });
});

describe("onCallRouteFreshness", () => {
  const NOW = new Date("2026-10-04T13:40:00.000Z");
  it("counts whole months from the later of the publish and confirm dates", () => {
    expect(onCallRouteFreshness("2026-07-05T00:00:00.000Z", null, NOW)).toEqual({
      kind: "fresh",
      words: "Updated 2 months ago",
    });
    expect(onCallRouteFreshness("2026-07-04T00:00:00.000Z", null, NOW)).toEqual({
      kind: "stale",
      words: "Not checked for 3 months · confirm before use",
    });
    expect(onCallRouteFreshness("2025-01-01T00:00:00.000Z", "2026-09-20T00:00:00.000Z", NOW).kind).toBe("fresh");
  });

  it("never passes an undated route as current", () => {
    expect(onCallRouteFreshness(null, null, NOW)).toEqual({
      kind: "undated",
      words: "No update date recorded · confirm before use",
    });
    expect(onCallRouteFreshness("not a date", undefined, NOW).kind).toBe("undated");
  });
});
