// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePhoneAlerts } from "@/components/alerts/use-phone-alerts";

// A service worker whose registration failed (private window, blocked fetch,
// workers disabled) leaves `navigator.serviceWorker.ready` pending for ever.
// The switch used to await it bare, so one tap left it busy until a reload.

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

beforeEach(() => {
  const requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal(
    "Notification",
    Object.assign(function Notification() {}, { permission: "default", requestPermission }),
  );
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: new Promise<never>(() => undefined),
      getRegistration: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ configured: true, publicKey: "AQAB" }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("usePhoneAlerts", () => {
  it("turning alerts on with no service worker registered says so and frees the switch", async () => {
    const { result } = renderHook(() => usePhoneAlerts());
    await waitFor(() => expect(result.current.configured).toBe(true));
    await waitFor(() => expect(result.current.state).not.toBe("checking"));

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.message).toBe(
      "Phone alerts aren't ready on this browser yet. Reload the page and try again.",
    );
  });

  it("a test alert with no service worker registered says so and frees the button", async () => {
    const { result } = renderHook(() => usePhoneAlerts());
    await waitFor(() => expect(result.current.configured).toBe(true));

    await act(async () => {
      await result.current.sendTest();
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.message).toBe(
      "Phone alerts aren't ready on this browser yet. Reload the page and try again.",
    );
  });
});
