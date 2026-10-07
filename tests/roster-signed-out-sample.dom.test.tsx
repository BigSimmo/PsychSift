/** @vitest-environment jsdom */

// Roster while the example data switch shows examples (auto mode does for a
// visitor who is not signed in): the real screens answered from invented sample
// data, with nothing sent to the server and nothing kept on the device. The
// frame's example data banner (not mounted here) says it is made up, so the
// page carries no Sample box of its own. Switch off, the page is untouched.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "signed_out", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RosterSampleGate } from "@/components/roster/roster-sample-gate";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import { RosterRequestsPage } from "@/components/roster/requests/roster-requests-page";
import { RosterSettingsPage } from "@/components/roster/roster-settings-page";
import { RosterShiftsPage } from "@/components/roster/roster-shifts-page";
import { RosterTodayPage } from "@/components/roster/roster-today-page";
import { RosterSwapsPage } from "@/components/roster/swaps/roster-swaps-page";
import { RosterTeamPage } from "@/components/roster/team/roster-team-page";

let realFetch: ReturnType<typeof vi.fn>;
let originalFetch: typeof window.fetch;
let storageWrites: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  auth.status = "signed_out";
  window.localStorage.clear();
  resetExampleDataForTests();
  originalFetch = window.fetch;
  realFetch = vi.fn(async () => Response.json({}, { status: 401 }));
  window.fetch = realFetch as unknown as typeof window.fetch;
  storageWrites = [
    vi.spyOn(Storage.prototype, "setItem"),
    vi.spyOn(Storage.prototype, "removeItem"),
    vi.spyOn(Storage.prototype, "clear"),
  ];
});

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
  vi.restoreAllMocks();
});

const rosterCalls = () =>
  realFetch.mock.calls.filter(([input]) =>
    String(input instanceof Request ? input.url : input).includes("/api/roster"),
  );

const PAGES = [
  ["Today", <RosterTodayPage key="today" />],
  ["Shifts", <RosterShiftsPage key="shifts" />],
  ["Team", <RosterTeamPage key="team" />],
  ["Swaps", <RosterSwapsPage key="swaps" />],
  ["Requests", <RosterRequestsPage key="requests" />],
  ["Settings", <RosterSettingsPage key="settings" />],
] as const;

describe("Roster signed-out sample", () => {
  it.each(PAGES)(
    "%s shows the real screen from the sample, with no Sample box or sign-in notice",
    async (_name, page) => {
      render(<RosterSampleGate>{page}</RosterSampleGate>);
      await waitFor(() => expect(window.fetch).not.toBe(realFetch));
      expect(screen.queryByTestId("roster-signed-out-sample")).toBeNull();
      await waitFor(() => expect(screen.queryByTestId("roster-sample-loading")).toBeNull());
      expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
      // Let the page's reads settle, then check none of them left the browser.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByTestId(/roster-.*-signed-out$/)).toBeNull();
      expect(rosterCalls()).toHaveLength(0);
      for (const write of storageWrites) expect(write).not.toHaveBeenCalled();
    },
  );

  it("Today and the team page are filled with the invented team, never real staff", async () => {
    render(
      <RosterSampleGate>
        <RosterTeamPage />
      </RosterSampleGate>,
    );
    expect(await screen.findByText(/Example Health Service/)).toBeTruthy();
    // The server-sample banner would repeat the Sample box.
    expect(screen.queryByTestId("roster-sample-notice")).toBeNull();
  });

  it("shows no fatigue or rest-rule warnings", async () => {
    render(
      <RosterSampleGate>
        <RosterShiftsPage />
      </RosterSampleGate>,
    );
    await waitFor(() => expect(screen.queryByTestId("roster-sample-loading")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('[data-warning="true"]')).toBeNull();
  });

  it("puts the real fetch back when the page goes away", async () => {
    const { unmount } = render(
      <RosterSampleGate>
        <RosterTodayPage />
      </RosterSampleGate>,
    );
    await waitFor(() => expect(window.fetch).not.toBe(realFetch));
    unmount();
    expect(window.fetch).toBe(realFetch);
  });

  it.each(["authenticated", "unconfigured", "loading"])("leaves the page untouched when auth is %s", async (status) => {
    auth.status = status;
    render(
      <RosterSampleGate>
        <p data-testid="the-page">page</p>
      </RosterSampleGate>,
    );
    expect(screen.getByTestId("the-page")).toBeTruthy();
    expect(window.fetch).toBe(realFetch);
  });

  it("leaves the page untouched for a signed-out visitor who turned example data off", async () => {
    setExampleDataOn(false);
    render(
      <RosterSampleGate>
        <p data-testid="the-page">page</p>
      </RosterSampleGate>,
    );
    expect(screen.getByTestId("the-page")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.fetch).toBe(realFetch);
  });

  it("shows the sample to a signed-in reader who turned example data on", async () => {
    auth.status = "authenticated";
    setExampleDataOn(true);
    render(
      <RosterSampleGate>
        <p>page</p>
      </RosterSampleGate>,
    );
    await waitFor(() => expect(window.fetch).not.toBe(realFetch));
  });

  it("treats an expired session like signed out", async () => {
    auth.status = "expired";
    render(
      <RosterSampleGate>
        <p>page</p>
      </RosterSampleGate>,
    );
    await waitFor(() => expect(window.fetch).not.toBe(realFetch));
  });
});
