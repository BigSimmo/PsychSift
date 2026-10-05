// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => ({ status: "ready", data: { teams: [] } }),
  useRosterRead: () => ({ status: "loading", data: null }),
}));
vi.mock("@/components/roster/use-roster-settings", () => ({
  useRosterSettings: () => ({
    status: "ready",
    settings: { alerts: { changes: true, requests: true } },
    update: vi.fn(async () => null),
  }),
}));

import { RosterAlertsSection, RosterAlertsSwitch } from "@/components/roster/alerts/roster-alerts-section";

const endpoint = "https://fcm.googleapis.com/fcm/send/example";
const subscription = {
  endpoint,
  toJSON: () => ({ keys: { p256dh: "abcdefghij", auth: "abcdefghij" } }),
  unsubscribe: vi.fn(async () => true),
};
const getSubscription = vi.fn(async () => null as typeof subscription | null);
const subscribe = vi.fn(async () => subscription);
const requestPermission = vi.fn(async () => "granted");
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
  String(input).endsWith("/check")
    ? Response.json({ owned: false })
    : init?.method === "POST"
      ? Response.json({ configured: true })
      : Response.json({ configured: true, publicKey: "YWJjZA" }),
);
const originalAgent = navigator.userAgent;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (input, init) =>
    String(input).endsWith("/check")
      ? Response.json({ owned: false })
      : init?.method === "POST"
        ? Response.json({ configured: true })
        : Response.json({ configured: true, publicKey: "YWJjZA" }),
  );
  getSubscription.mockResolvedValue(null);
  requestPermission.mockResolvedValue("granted");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Notification", { requestPermission });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalAgent });
});

it("asks permission, subscribes with the public key, then saves the endpoint without storage", async () => {
  const user = userEvent.setup();
  const storage = vi.spyOn(Storage.prototype, "setItem");
  render(<RosterAlertsSwitch />);
  await user.click(await screen.findByRole("switch", { name: "Alerts on this phone" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/roster/alerts", expect.objectContaining({ method: "POST" })),
  );
  expect(requestPermission).toHaveBeenCalledOnce();
  expect(subscribe).toHaveBeenCalledWith(
    expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
  );
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1]!;
  expect(JSON.parse(String(post.body))).toEqual({ endpoint, keys: { p256dh: "abcdefghij", auth: "abcdefghij" } });
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});

it("does not claim another account's existing browser subscription or transfer it on load", async () => {
  getSubscription.mockResolvedValue(subscription);
  render(<RosterAlertsSwitch />);
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/roster/alerts/check", expect.objectContaining({ method: "POST" })),
  );
  expect(screen.getByRole("switch", { name: "Alerts on this phone" }).getAttribute("aria-checked")).toBe("false");
  expect(fetchMock.mock.calls.some(([input, init]) => input === "/api/roster/alerts" && init?.method === "POST")).toBe(
    false,
  );
  expect(subscribe).not.toHaveBeenCalled();
});

it("shows an existing subscription as enabled only after the server confirms ownership", async () => {
  getSubscription.mockResolvedValue(subscription);
  fetchMock.mockImplementation(async (input, init) =>
    String(input).endsWith("/check")
      ? Response.json({ owned: true })
      : init?.method === "POST"
        ? Response.json({ configured: true })
        : Response.json({ configured: true, publicKey: "YWJjZA" }),
  );
  render(<RosterAlertsSwitch />);
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Alerts on this phone" }).getAttribute("aria-checked")).toBe("true"),
  );
});

it("explains denied permission and never sends a subscription", async () => {
  const user = userEvent.setup();
  requestPermission.mockResolvedValueOnce("denied");
  render(<RosterAlertsSwitch />);
  await user.click(await screen.findByRole("switch", { name: "Alerts on this phone" }));
  expect(
    await screen.findByText("Alerts are blocked on this phone. Turn them on in the phone's settings."),
  ).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("shows the iPhone home-screen step and offers no lock-screen place control", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone)" });
  render(<RosterAlertsSection />);
  await user.click(await screen.findByRole("switch", { name: "Alerts on this phone" }));
  expect(await screen.findByText("On iPhone, add Roster to your home screen first.")).toBeTruthy();
  expect(screen.queryByText(/Show the place on the lock screen/i)).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
});
