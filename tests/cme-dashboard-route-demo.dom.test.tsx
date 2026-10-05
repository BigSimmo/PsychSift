import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CmeDashboardRoute } from "@/components/cme/cme-dashboard-route";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminders/settings-model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { reminders: DEFAULT_REMINDER_SETTINGS }, setPreference: vi.fn() }),
}));
vi.mock("@/components/cme/cme-quick-log", () => ({
  CmeQuickLog: () => null,
  CME_LOG_TRIGGER_ATTRIBUTE: "data-cme-log-trigger",
  openCmeQuickLog: () => false,
}));
vi.mock("@/components/cme/cme-teaching-prompt", () => ({
  useCmeTeachingUnloggedCount: () => null,
}));

const nowIso = "2026-09-19T02:00:00Z";

describe("CmeDashboardRoute demo wording", () => {
  it("labels sample data as demo records rather than saved records", () => {
    render(<CmeDashboardRoute set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} nowIso={nowIso} routines={[]} demoMode />);
    expect(screen.getByText("Demo records")).toBeTruthy();
    expect(screen.queryByText(/Saved records loaded at/)).toBeNull();
  });

  it("keeps the saved-records line for a signed-in record", () => {
    render(<CmeDashboardRoute set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} nowIso={nowIso} routines={[]} />);
    expect(screen.getByText(/Saved records loaded at/)).toBeTruthy();
    expect(screen.queryByText("Demo records")).toBeNull();
  });
});
