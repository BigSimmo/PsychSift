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
  useOnline: () => data.online,
}));

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
  it("signed out: says nothing is saved and offers Sign in, with no reads", () => {
    auth.status = "signed_out";
    render(<WorkProfilePage />);
    expect(screen.getByTestId("work-profile-status").textContent).toContain("Signed out · nothing saved here");
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
});
