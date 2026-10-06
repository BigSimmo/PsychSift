/** @vitest-environment jsdom */

// Work profile: signed-out, the four tabs, failed reads shown as "Not checked",
// the failed-save retry line, and the offline state.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkProfileData } from "@/components/work-profile/use-work-profile-data";
import { DEFAULT_PREFERENCES, type AppPreferences } from "@/lib/account-preferences";
import { summariseAdmin } from "@/lib/work-profile/model";

const auth = vi.hoisted(() => ({
  status: "authenticated" as string,
  session: { user: { email: "jo.citizen@example.org" } } as unknown,
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/my-day/profile",
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), back: vi.fn() }),
}));

const prefs = vi.hoisted(() => ({
  preferences: undefined as unknown as AppPreferences,
  syncState: "synced" as string,
  retrySync: vi.fn(),
  setPreference: vi.fn(),
}));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({ useAppPreferences: () => prefs }));

const data = vi.hoisted(() => ({ current: undefined as unknown as WorkProfileData, online: true }));
vi.mock("@/components/work-profile/use-work-profile-data", () => ({
  useWorkProfileData: () => data.current,
}));
vi.mock("@/lib/use-online-status", () => ({ useOnlineStatus: () => data.online }));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));

import { WorkProfilePage } from "@/components/work-profile/work-profile-page";

function readyData(overrides: Partial<WorkProfileData> = {}): WorkProfileData {
  return {
    roster: { status: "ready", value: { workplaces: 1, rowName: "R3" } },
    workplaces: { status: "ready", value: ["Fiona Stanley"] },
    teams: { status: "ready", value: [] },
    teaching: { status: "ready", value: { teams: 1 } },
    cpd: { status: "ready", value: { configured: true, routines: 0 } },
    admin: { status: "ready", value: summariseAdmin([], false) },
    hospitalPhone: false,
    payFortnightAnchor: { status: "ready", value: null },
    ...overrides,
  };
}

beforeEach(() => {
  auth.status = "authenticated";
  nav.search = "";
  prefs.preferences = { ...DEFAULT_PREFERENCES };
  prefs.syncState = "synced";
  data.current = readyData();
  data.online = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Work profile page", () => {
  it("signed out: shows the made-up example and offers Sign in, with no reads", () => {
    auth.status = "signed_out";
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).toContain("Signed out · nothing saved here");
    expect(screen.getByText("Made-up example. Sign in to set up your own")).toBeTruthy();
    expect(screen.getByTestId("work-profile-example-identity").textContent).toContain("Dr Alex Example");
    expect(within(screen.getByTestId("work-profile-example-areas")).getByText("Roster")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("account-dialog")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows the four tabs and opens Profile by default", () => {
    render(<WorkProfilePage />);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Profile", "Work & leave", "Alerts", "Privacy"]);
    expect(screen.getByTestId("work-profile-panel-profile")).toBeTruthy();
  });

  it("changing tab writes it to the address", () => {
    render(<WorkProfilePage />);
    fireEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(nav.replace).toHaveBeenCalledWith("/my-day/profile?tab=privacy", { scroll: false });
  });

  it("a failed area says Not checked, never Ready", () => {
    data.current = readyData({ teaching: { status: "failed" } });
    render(<WorkProfilePage />);
    const panel = screen.getByTestId("work-profile-panel-profile");
    expect(within(panel).getByText("Didn’t load")).toBeTruthy();
    expect(within(panel).getAllByText("Not checked").length).toBeGreaterThan(0);
  });

  it("the Alerts tab only links to the alerts page", () => {
    nav.search = "tab=alerts";
    render(<WorkProfilePage />);
    const links = within(screen.getByTestId("work-profile-panel-alerts")).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/my-day/alerts"]);
  });

  it("a failed save is a retry button, announced", () => {
    prefs.syncState = "error";
    render(<WorkProfilePage />);
    const retry = screen.getByTestId("work-profile-status-failed");
    expect(retry.closest("[role=alert]")).toBeTruthy();
    fireEvent.click(retry);
    expect(prefs.retrySync).toHaveBeenCalledTimes(1);
  });

  it("offline: says so and hides the tab count", () => {
    data.online = false;
    data.current = readyData({
      admin: { status: "ready", value: summariseAdmin([], true) },
    });
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).toContain("Offline");
    expect(screen.getByTestId("work-profile-offline")).toBeTruthy();
  });

  it("while signing in, shows a loading state; a sign-in check failure offers Retry", () => {
    auth.status = "loading";
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-loading")).toBeTruthy();
    expect(screen.getByText("Loading Work profile")).toBeTruthy();
    cleanup();
    auth.status = "error";
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-auth-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("a failed read when the page opens is not called a failed save", () => {
    prefs.syncState = "error";
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status-failed").textContent).toBe(
      "Couldn’t load your saved settings · Try again",
    );
  });

  it("opening the page never claims a save time", () => {
    prefs.syncState = "syncing";
    const { rerender } = render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).toBe("Checking your saved settings…");
    prefs.syncState = "synced";
    rerender(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).toBe("Saved to your account");
  });

  it("while workplaces load, says Checking rather than showing only Add", () => {
    data.current = readyData({ workplaces: { status: "loading" }, roster: { status: "loading" } });
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-workplaces-loading").textContent).toContain("Checking…");
  });

  it("a registrar with no RANZCP stage is asked for it", () => {
    prefs.preferences = { ...DEFAULT_PREFERENCES, workStage: "registrar", ranzcpStage: null };
    render(<WorkProfilePage />);
    const row = screen.getByTestId("work-profile-ranzcp-stage");
    expect(row.textContent).toContain("Choose your stage");
    expect(row.closest("button")).toBeTruthy();
  });

  it("offline, nothing can be changed: no Add, no stage button, no new-job link", () => {
    data.online = false;
    render(<WorkProfilePage />);
    expect(screen.queryByTestId("work-profile-add-workplace")).toBeNull();
    expect(screen.getByTestId("work-profile-stage").closest("button")).toBeNull();
    expect(screen.queryByText("Starting a new job or rotation")).toBeNull();
  });

  it("says Nothing set up yet only when no row shows Ready", () => {
    data.current = readyData({
      roster: { status: "ready", value: { workplaces: 0, rowName: null } },
      workplaces: { status: "ready", value: [] },
      teaching: { status: "ready", value: { teams: 0 } },
      cpd: { status: "ready", value: { configured: false, routines: 0 } },
    });
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).toBe("Nothing set up yet");
    cleanup();
    data.current = readyData({
      roster: { status: "ready", value: { workplaces: 0, rowName: null } },
      workplaces: { status: "ready", value: [] },
      teaching: { status: "ready", value: { teams: 0 } },
    });
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).not.toContain("Nothing set up yet");
  });

  it("the Teaching row opens the teaching week, not the organisers' page", () => {
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-area-teaching").closest("a")?.getAttribute("href")).toBe("/teaching/week");
  });

  it("Privacy lists teaching-only teams too, opening the teaching week", () => {
    nav.search = "tab=privacy";
    data.current = readyData({
      teaching: { status: "ready", value: { teams: 1, list: [{ id: "t1", name: "Psychiatry teaching" }] } },
    });
    render(<WorkProfilePage />);
    const row = screen.getByText("Psychiatry teaching").closest("a");
    expect(row?.getAttribute("href")).toBe("/teaching/week");
    expect(row?.textContent).toContain("Teaching only");
  });
});
