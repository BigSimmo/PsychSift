import { afterEach, describe, expect, it, vi } from "vitest";

import { removeThisDevicePushSubscription } from "@/lib/alerts/device-push";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-phone";

function installWorker(subscription: { endpoint: string; unsubscribe: () => Promise<boolean> } | null) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("removing this device's phone alerts (sign-out and Off)", () => {
  it("unsubscribes the browser first, then tells the account which endpoint to drop", async () => {
    const order: string[] = [];
    const unsubscribe = vi.fn(async () => {
      order.push("browser");
      return true;
    });
    installWorker({ endpoint: ENDPOINT, unsubscribe });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      order.push(`server:${init?.method}`);
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(removeThisDevicePushSubscription()).resolves.toBe(true);
    expect(order).toEqual(["browser", "server:DELETE"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ endpoint: ENDPOINT });
  });

  it("does nothing when this device has no subscription", async () => {
    installWorker(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await removeThisDevicePushSubscription();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a browser that refused to unsubscribe, so the page never shows Off by mistake", async () => {
    installWorker({ endpoint: ENDPOINT, unsubscribe: async () => false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(removeThisDevicePushSubscription()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, and gives up waiting on a hung network so sign-out still finishes", async () => {
    installWorker({ endpoint: ENDPOINT, unsubscribe: async () => true });
    vi.stubGlobal("fetch", () => new Promise(() => undefined));
    // The browser half finished, so this device is off even though the server never answered.
    await expect(removeThisDevicePushSubscription(20)).resolves.toBe(true);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await expect(removeThisDevicePushSubscription(20)).resolves.toBe(true);
  });
});
