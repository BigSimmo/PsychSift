import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeDashboardRoute } from "@/components/cme/cme-dashboard-route";
import { canOneTapLogRoutine } from "@/components/cme/cme-one-tap-routine-log";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeRoutine } from "@/lib/cme/routines";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminders/settings-model";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
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

afterEach(() => {
  vi.restoreAllMocks();
  navigation.push.mockReset();
  navigation.refresh.mockReset();
});

const dueRoutine: CmeRoutine = {
  id: "routine-due",
  title: "Peer review group",
  cadence: "monthly",
  usualHours: 1,
  usualAllocations: [{ category: "reviewing", hours: 1 }],
  nextDue: "2026-09-01",
  archivedAt: null,
};

describe("canOneTapLogRoutine", () => {
  it("needs a usual category split — empty allocations open the form instead", () => {
    expect(
      canOneTapLogRoutine({
        routineId: "r1",
        date: "2026-09-19",
        title: "Supervision",
        hours: 1,
        allocations: [{ category: "reviewing", hours: 1 }],
      }),
    ).toBe(true);
    expect(
      canOneTapLogRoutine({
        routineId: "r1",
        date: "2026-09-19",
        title: "Supervision",
        hours: 1,
        allocations: [],
      }),
    ).toBe(false);
  });
});

describe("CmeDashboardRoute one-tap due log", () => {
  it("saves the due routine on Log N h and undoes with DELETE", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/cme/entries" && init?.method === "POST") {
        return new Response(JSON.stringify({ entry: { id: "dash-entry" } }), { status: 201 });
      }
      if (url === "/api/cme/entries/dash-entry" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response("unexpected", { status: 500 });
    });
    render(
      <CmeDashboardRoute
        set={DEMO_CME_YEAR}
        entries={DEMO_CME_ENTRIES}
        nowIso="2026-09-19T02:00:00Z"
        routines={[dueRoutine]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /log 1(\.0)? h/i }));
    await screen.findByTestId("cme-quick-log-saved");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      title: "Peer review group",
      routineId: "routine-due",
      allocations: [{ category: "reviewing", hours: 1 }],
    });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cme/entries/dash-entry", { method: "DELETE" }));
  });

  it("shows a demo read-only notice instead of navigating", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(
      <CmeDashboardRoute
        set={DEMO_CME_YEAR}
        entries={DEMO_CME_ENTRIES}
        nowIso="2026-09-19T02:00:00Z"
        routines={[dueRoutine]}
        demoMode
      />,
    );
    await user.click(screen.getByRole("button", { name: /log 1(\.0)? h/i }));
    expect(await screen.findByTestId("cme-one-tap-log-error")).toHaveTextContent(/Demo mode is read-only/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
