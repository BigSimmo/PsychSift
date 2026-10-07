/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EarlierAlertsPage } from "@/components/work-screens/my-day/earlier-alerts-page";
import { ToastProvider } from "@/components/ui/toast";
import { ACCOUNT_TRANSITION_EVENT } from "@/lib/account-scoped-browser-state";
import { areaDataState, resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import {
  EARLIER_ALERTS_STORAGE_KEY,
  EMPTY_SNAPSHOT,
  serializeEarlierAlerts,
} from "@/lib/work-screens/my-day/earlier-alerts";

const auth = vi.hoisted(() => ({
  current: { status: "authenticated", authEpoch: 1, session: { user: { id: "owner-a" } } } as {
    status: string;
    authEpoch: number;
    session: { user: { id: string } } | null;
  },
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth.current }));

vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => ({ status: "ready", shifts: [], teamLoading: false, demoMode: false, sample: false }),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/my-day/alerts/earlier",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type FakeNotification = { data: { t: string }; timestamp?: number; close: ReturnType<typeof vi.fn> };
const worker = vi.hoisted(() => ({
  shown: [] as FakeNotification[],
  fail: false,
  listeners: new Set<(event: MessageEvent) => void>(),
}));

function installServiceWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({
        getNotifications: async () => {
          if (worker.fail) throw new Error("blocked");
          return worker.shown;
        },
      }),
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => worker.listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
        worker.listeners.delete(listener),
    },
  });
}

function notification(t: string, minutesAgo: number): FakeNotification {
  return { data: { t }, timestamp: Date.now() - minutesAgo * 60_000, close: vi.fn() };
}

/** The Undo button on the toast that says `title`. */
function undoFor(title: string | RegExp): HTMLElement {
  const toast = screen.getByText(title).closest(".app-toast") as HTMLElement | null;
  expect(toast).not.toBeNull();
  return within(toast!).getByRole("button", { name: "Undo" });
}

/** Moves the page's clock on, so a second tap is not taken for the first one landing twice. */
function laterTaps() {
  const realNow = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  return () => {
    offset += 1000;
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <EarlierAlertsPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  worker.shown = [];
  worker.fail = false;
  worker.listeners.clear();
  nav.replace.mockReset();
  nav.search = "";
  auth.current = { status: "authenticated", authEpoch: 1, session: { user: { id: "owner-a" } } };
  installServiceWorker();
  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: Object.assign(function Notification() {}, { permission: "granted" }),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  window.localStorage.clear();
});

describe("Earlier alerts page", () => {
  it("lists what is on the lock screen under Today, opening the page each alert was for", async () => {
    const swap = notification("request", 1);
    worker.shown = [swap, notification("brief", 2)];
    const user = userEvent.setup();
    renderPage();

    const today = await screen.findByRole("region", { name: /Today/ });
    const links = within(today).getAllByTestId("earlier-alert-open");
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/roster/swaps?from=my-day");
    expect(links[1]!.getAttribute("href")).toBe("/my-day");
    expect(within(today).getByText("Something in Roster is waiting for you")).toBeTruthy();
    expect(within(links[0]!).getByText("New")).toBeTruthy();

    links[0]!.addEventListener("click", (event) => event.preventDefault());
    await user.click(links[0]!);
    await waitFor(() => expect(within(links[0]!).getByText("Opened")).toBeTruthy());
    // Opened here, so the copy on the lock screen is cleared.
    await waitFor(() => expect(swap.close).toHaveBeenCalled());
    expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toContain("owner-a");
  });

  it("removes one alert with Undo", async () => {
    worker.shown = [notification("changed", 3)];
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Your roster changed from this list" }));
    expect(screen.queryByTestId("earlier-alert-changed")).toBeNull();
    // The lock screen still holds it, but a removed alert is not read back in.
    expect(await screen.findByTestId("earlier-alerts-empty")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByTestId("earlier-alert-changed")).toBeTruthy();
  });

  it("clears the whole list with Undo", async () => {
    worker.shown = [notification("changed", 3), notification("test", 4)];
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("earlier-alerts-clear"));
    expect(await screen.findByTestId("earlier-alerts-empty")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findAllByTestId("earlier-alert-open")).toHaveLength(2);
  });

  it("filters by area through the address, and falls back to All for an area with nothing in it", async () => {
    worker.shown = [notification("changed", 3), notification("brief", 4), notification("reminder", 5)];
    const user = userEvent.setup();
    nav.search = "area=brief";
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getAllByTestId("earlier-alert-open")).toHaveLength(1));
    expect(screen.getByTestId("earlier-alert-brief")).toBeTruthy();
    expect(screen.getByTestId("earlier-alerts-chip-brief").getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByTestId("earlier-alerts-chip-roster"));
    expect(nav.replace).toHaveBeenCalledWith("/my-day/alerts/earlier?area=roster", { scroll: false });
    await user.click(screen.getByTestId("earlier-alerts-chip-all"));
    expect(nav.replace).toHaveBeenLastCalledWith("/my-day/alerts/earlier", { scroll: false });
    unmount();

    nav.search = "area=test";
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("earlier-alert-open")).toHaveLength(3));
  });

  it("shows the kept list with a retry when the lock screen can't be read", async () => {
    window.localStorage.setItem(
      EARLIER_ALERTS_STORAGE_KEY,
      serializeEarlierAlerts(
        {
          alerts: [{ id: "brief:1", code: "brief", at: Date.now() - 60_000, approx: false, openedAt: null }],
          trayApprox: {},
          hidden: [],
        },
        "owner-a",
      ),
    );
    worker.fail = true;
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-error")).toBeTruthy();
    expect(screen.getByTestId("earlier-alert-brief")).toBeTruthy();
    worker.fail = false;
    worker.shown = [notification("request", 1)];
    await user.click(screen.getByTestId("earlier-alerts-retry"));
    await waitFor(() => expect(screen.queryByTestId("earlier-alerts-error")).toBeNull());
    expect(screen.getByTestId("earlier-alert-request")).toBeTruthy();
  });

  it("never shows another account's kept list", async () => {
    window.localStorage.setItem(
      EARLIER_ALERTS_STORAGE_KEY,
      serializeEarlierAlerts(
        {
          alerts: [{ id: "brief:1", code: "brief", at: Date.now() - 60_000, approx: false, openedAt: null }],
          trayApprox: {},
          hidden: [],
        },
        "owner-b",
      ),
    );
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-empty")).toBeTruthy();
  });

  it("forgets the list at an account change", async () => {
    worker.shown = [notification("changed", 3)];
    renderPage();
    expect(await screen.findByTestId("earlier-alert-changed")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));
    });
    await waitFor(() => expect(screen.queryByTestId("earlier-alert-changed")).toBeNull());
    expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toBeNull();
  });

  it("adds an alert that arrives while the page is open", async () => {
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-empty")).toBeTruthy();
    await waitFor(() => expect(worker.listeners.size).toBeGreaterThan(0));
    act(() => {
      for (const listener of worker.listeners)
        listener(new MessageEvent("message", { data: { type: "psychsift-push", t: "offer" } }));
    });
    expect(await screen.findByText("A shift is open in your team")).toBeTruthy();
  });

  it("sends the reader to turn phone alerts on when they are off and nothing is listed", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: Object.assign(function Notification() {}, { permission: "default" }),
    });
    renderPage();
    const empty = await screen.findByTestId("earlier-alerts-empty-off");
    expect(within(empty).getByRole("link", { name: "Turn on phone alerts" }).getAttribute("href")).toBe(
      "/my-day/alerts",
    );
  });

  it("keeps nothing on a shared device", async () => {
    window.localStorage.setItem("psychsift-shared-device", "1");
    window.localStorage.setItem(EARLIER_ALERTS_STORAGE_KEY, "{}");
    worker.shown = [notification("changed", 3)];
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-shared")).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toBeNull());
    expect(screen.queryByTestId("earlier-alert-changed")).toBeNull();
  });

  it("says plainly when offline, and still shows the kept list", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    worker.shown = [notification("changed", 3)];
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-offline")).toBeTruthy();
    expect(await screen.findByTestId("earlier-alert-changed")).toBeTruthy();
  });

  it("shows the signed-out example alerts without reading or keeping anything", async () => {
    auth.current = { status: "signed_out", authEpoch: 1, session: null };
    worker.shown = [notification("changed", 3)];
    renderPage();
    expect(await screen.findByTestId("my-day-earlier-alerts-signed-out-sample")).toBeTruthy();
    expect(await screen.findByTestId("earlier-alerts-example")).toBeTruthy();
    expect(screen.queryByTestId("earlier-alert-remove")).toBeNull();
    expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toBeNull();
  });

  it("signed out with example data off, asks to sign in and shows no made-up alerts", async () => {
    auth.current = { status: "signed_out", authEpoch: 1, session: null };
    act(() => setExampleDataOn(false));
    renderPage();
    expect(await screen.findByTestId("my-day-earlier-alerts-signed-out")).toBeTruthy();
    expect(screen.queryByTestId("earlier-alerts-example")).toBeNull();
  });

  it("signed in with example data on and nothing kept, shows the example alerts read only", async () => {
    act(() => setExampleDataOn(true));
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-example")).toBeTruthy();
    expect(screen.queryByTestId("earlier-alert-remove")).toBeNull();
    expect(screen.queryByTestId("earlier-alerts-clear")).toBeNull();
  });

  it("reports My Day as holding real data once real alerts are kept, so the auto examples step aside", async () => {
    worker.shown = [notification("changed", 3)];
    renderPage();
    expect(await screen.findByTestId("earlier-alert-changed")).toBeTruthy();
    expect(areaDataState("day")).toBe("has-data");
  });

  it("links back to Alerts and to Needs you", async () => {
    renderPage();
    expect((await screen.findByTestId("earlier-alerts-settings-link")).getAttribute("href")).toBe("/my-day/alerts");
    expect(screen.getByTestId("earlier-alerts-needs-you-link").getAttribute("href")).toBe("/my-day?view=all");
  });

  it("takes a double tap on Remove as one tap, so the row that slides up under the finger stays", async () => {
    worker.shown = [notification("changed", 3), notification("request", 4), notification("brief", 5)];
    const user = userEvent.setup();
    renderPage();
    const first = (await screen.findAllByTestId("earlier-alert-remove"))[0]!;
    await user.click(first);
    await user.click(screen.getAllByTestId("earlier-alert-remove")[0]!);
    expect(screen.getAllByTestId("earlier-alert-open")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("undoes one removal without bringing back another, and keeps an alert that arrived since", async () => {
    worker.shown = [notification("changed", 3), notification("request", 4)];
    const user = userEvent.setup();
    const tick = laterTaps();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Your roster changed from this list" }));
    tick();
    await user.click(
      screen.getByRole("button", { name: "Remove Something in Roster is waiting for you from this list" }),
    );
    act(() => {
      for (const listener of worker.listeners)
        listener(new MessageEvent("message", { data: { type: "psychsift-push", t: "test" } }));
    });
    await user.click(undoFor("Your roster changed removed from this list"));
    expect(await screen.findByTestId("earlier-alert-changed")).toBeTruthy();
    expect(screen.queryByTestId("earlier-alert-request")).toBeNull();
    expect(screen.getByTestId("earlier-alert-test")).toBeTruthy();
  });

  it("moves focus to the row that took a removed row's place", async () => {
    worker.shown = [notification("changed", 3), notification("request", 4)];
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Your roster changed from this list" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("href")).toBe("/roster/swaps?from=my-day"));
    await user.click(screen.getByTestId("earlier-alerts-clear"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("earlier-alerts-ready")));
  });

  it("Undo still works after leaving the page, and the list shows it on return", async () => {
    worker.shown = [notification("changed", 3)];
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Your roster changed from this list" }));
    rerender(<ToastProvider>{null}</ToastProvider>);
    await user.click(undoFor("Your roster changed removed from this list"));
    expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toContain("changed:");
    rerender(
      <ToastProvider>
        <EarlierAlertsPage />
      </ToastProvider>,
    );
    expect(await screen.findByTestId("earlier-alert-changed")).toBeTruthy();
  });

  it("Undo after a sign-out or account change writes nothing back and shows nothing", async () => {
    worker.shown = [notification("changed", 3)];
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Your roster changed from this list" }));
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));
    });
    await user.click(undoFor("Your roster changed removed from this list"));
    expect(screen.queryByTestId("earlier-alert-changed")).toBeNull();
    expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toBeNull();
  });

  it("clears PsychSift alerts from the lock screen at a sign-out or account change", async () => {
    const left = notification("manage", 3);
    worker.shown = [left];
    renderPage();
    expect(await screen.findByTestId("earlier-alert-manage")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));
    });
    await waitFor(() => expect(left.close).toHaveBeenCalled());
  });

  it("does not list the last account's lock-screen alerts for the next person on this device", async () => {
    window.localStorage.setItem(EARLIER_ALERTS_STORAGE_KEY, serializeEarlierAlerts(EMPTY_SNAPSHOT, "owner-b"));
    worker.shown = [notification("manage", 3)];
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-empty")).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY)).toContain("owner-a"));
    expect(screen.queryByTestId("earlier-alert-manage")).toBeNull();
    // What arrives from now on is theirs, and is listed.
    await waitFor(() => expect(worker.listeners.size).toBeGreaterThan(0));
    act(() => {
      for (const listener of worker.listeners)
        listener(new MessageEvent("message", { data: { type: "psychsift-push", t: "brief" } }));
    });
    expect(await screen.findByTestId("earlier-alert-brief")).toBeTruthy();
  });

  it("lists an alert heard while open once, when the lock screen is read again", async () => {
    renderPage();
    expect(await screen.findByTestId("earlier-alerts-empty")).toBeTruthy();
    await waitFor(() => expect(worker.listeners.size).toBeGreaterThan(0));
    act(() => {
      for (const listener of worker.listeners)
        listener(new MessageEvent("message", { data: { type: "psychsift-push", t: "request" } }));
    });
    expect(await screen.findByTestId("earlier-alert-request")).toBeTruthy();
    worker.shown = [{ data: { t: "request" }, timestamp: Date.now() - 5, close: vi.fn() }];
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getAllByTestId("earlier-alert-request")).toHaveLength(1);
  });

  it("with an area chosen, clears only the alerts shown", async () => {
    worker.shown = [notification("changed", 3), notification("brief", 4)];
    nav.search = "area=roster";
    const user = userEvent.setup();
    renderPage();
    const clear = await screen.findByTestId("earlier-alerts-clear");
    await waitFor(() => expect(clear.textContent).toBe("Clear these alerts"));
    expect(screen.getByTestId("earlier-alerts-filter-status").textContent).toBe("Showing 1 of 2 alerts, Roster only");
    await user.click(clear);
    expect(screen.queryByTestId("earlier-alert-changed")).toBeNull();
    expect(screen.getByTestId("earlier-alert-brief")).toBeTruthy();
    expect(screen.getByText("1 alert cleared from this list")).toBeTruthy();
  });

  it("says the day in each row's spoken label", async () => {
    worker.shown = [notification("changed", 3)];
    renderPage();
    const link = await screen.findByRole("link", { name: /^Your roster changed\..*, Today\. New\. Opens Roster\.$/ });
    expect(link.getAttribute("href")).toBe("/roster?from=my-day");
  });

  it("says plainly when this browser cannot get phone alerts", async () => {
    Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: undefined });
    renderPage();
    const empty = await screen.findByTestId("earlier-alerts-empty-unsupported");
    expect(within(empty).getByRole("link", { name: "Set up phone alerts" }).getAttribute("href")).toBe(
      "/my-day/alerts",
    );
  });
});
