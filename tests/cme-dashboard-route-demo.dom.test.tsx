import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CmeDashboardRoute } from "@/components/cme/cme-dashboard-route";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminders/settings-model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { reminders: DEFAULT_REMINDER_SETTINGS }, setPreference: vi.fn() }),
  readAppPreferences: () => ({ timeZone: "Australia/Perth" }),
  subscribeAppPreferences: () => () => undefined,
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
  it("never calls sample data saved records (the example data banner says it is made up)", () => {
    render(<CmeDashboardRoute set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} nowIso={nowIso} routines={[]} demoMode />);
    expect(screen.queryByText(/In your account/)).toBeNull();
  });

  it("keeps the saved-records line for a signed-in record", () => {
    render(<CmeDashboardRoute set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} nowIso={nowIso} routines={[]} />);
    expect(screen.getByText(/In your account · loaded \d{2}:\d{2}/)).toBeTruthy();
    expect(screen.queryByText(/Made-up example records/)).toBeNull();
  });
});
