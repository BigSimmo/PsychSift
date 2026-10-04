/** @vitest-environment jsdom */

// Admin signed out: the real Help and Renewals screens fill from the invented
// sample (real entry store, mocked network), offer no way to write, never link a
// sample number to a dialler, and keep nothing on the device.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminHelpPage } from "@/components/admin/admin-help-page";
import { AdminRenewalsPage } from "@/components/admin/admin-renewals-page";
import { clearOnCallEntryCache, onCallEntryCacheStorageKey } from "@/lib/on-call/entry-store";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/help",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: false, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed_out", authEpoch: 1 }) }));

function signedOutFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify({ entries: [], signedOut: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("Admin signed-out sample", () => {
  beforeEach(() => clearOnCallEntryCache());
  afterEach(() => {
    cleanup();
    clearOnCallEntryCache();
    vi.restoreAllMocks();
  });

  it("Help shows sample numbers as text only, with no sign-in wall, no write call and no storage write", async () => {
    const fetchSpy = signedOutFetch();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<AdminHelpPage />);

    await waitFor(() => expect(screen.queryByText(/sign in to see/i)).toBeNull());
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid^="admin-help-item-"]').length).toBeGreaterThan(0),
    );
    expect(container.querySelector('a[href^="tel:0000"]')).toBeNull();
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toBe("/api/on-call/entries");
      expect((call[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(onCallEntryCacheStorageKey)).toBeNull();
  });

  it("Renewals fills from the sample and says the records are read-only", async () => {
    signedOutFetch();
    render(<AdminRenewalsPage now={new Date("2026-09-26T04:00:00.000Z")} />);
    await waitFor(() => expect(screen.queryByText(/sign in to see your renewals/i)).toBeNull());
    expect(await screen.findByText(/example records are read-only/i)).toBeTruthy();
  });
});
