/** @vitest-environment jsdom */

// On Call and Admin signed out: the real screens are filled from the invented
// sample held in memory. It fetches nothing for itself, writes nothing to the
// device, offers no way to write, and never links a sample number to a dialler.

import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { clearOnCallEntryCache, onCallEntryCacheStorageKey, useOnCallEntries } from "@/lib/on-call/entry-store";
import { sampleServiceDetail } from "@/lib/on-call/service-demo";
import { isOnCallPlaceholderNumber, onCallTelHref, resolveHandbookPhone } from "@/lib/on-call/number-resolver";

const auth = vi.hoisted(() => ({ status: "signed_out", authEpoch: 1 }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-sign-in-dialog" /> : null),
}));

import { OnCallSampleNotice } from "@/components/on-call/on-call-sample-notice";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("On Call signed-out sample", () => {
  beforeEach(() => {
    clearOnCallEntryCache();
    auth.status = "signed_out";
  });
  afterEach(() => {
    cleanup();
    clearOnCallEntryCache();
    vi.restoreAllMocks();
  });

  it("fills the entries from the invented sample, read-only, with no storage write and no extra fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [], signedOut: true }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.sample).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries.length).toBe(DEMO_ON_CALL_ENTRIES.length);
    expect(result.current.demoMode).toBe(true);
    expect(result.current.signedOut).toBe(false);
    expect(result.current.cachedAt).toBeNull();
    // The one request is the ordinary entries read that finds out the visitor is signed out.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe("/api/on-call/entries");
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(onCallEntryCacheStorageKey)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("leaves a signed-in reader's entries unchanged", async () => {
    const entry = { ...DEMO_ON_CALL_ENTRIES[0], isOwn: true };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [entry], signedOut: false }));
    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sample).toBe(false);
    expect(result.current.demoMode).toBe(false);
    expect(result.current.entries).toHaveLength(1);
  });

  it("never links an invented sample number to a dialler, but keeps real numbers dialable", () => {
    for (const entry of DEMO_ON_CALL_ENTRIES) {
      const phone = (entry.details as { phone?: string }).phone;
      if (!phone) continue;
      expect(isOnCallPlaceholderNumber(phone)).toBe(true);
      expect(onCallTelHref(phone)).toBeUndefined();
      expect(resolveHandbookPhone(phone).tel).toBeNull();
    }
    // The sample hospital swaps its reserved 5550 numbers for placeholders that are text only.
    for (const entry of sampleServiceDetail.entries) {
      const phone = entry.content.phone;
      if (phone) expect(resolveHandbookPhone(phone).tel, entry.content.title).toBeNull();
    }
    expect(onCallTelHref("000")).toBe("tel:000");
    expect(onCallTelHref("13 11 14")).toBe("tel:131114");
    expect(resolveHandbookPhone("9000 0003").tel).toBe("tel:0890000003");
  });

  it("shows the shared Sample notice only when signed out or expired", async () => {
    const view = render(<OnCallSampleNotice mode="on-call" />);
    expect(await screen.findByTestId("on-call-signed-out-sample")).toBeTruthy();
    expect(screen.getByText("Sign in to see your On Call")).toBeTruthy();
    view.unmount();

    auth.status = "expired";
    const expired = render(<OnCallSampleNotice mode="admin" />);
    expect(await screen.findByTestId("admin-signed-out-sample")).toBeTruthy();
    expired.unmount();

    for (const status of ["authenticated", "loading", "unconfigured"]) {
      auth.status = status;
      const other = render(<OnCallSampleNotice mode="on-call" />);
      await act(async () => {});
      expect(screen.queryByTestId("on-call-signed-out-sample")).toBeNull();
      other.unmount();
    }
  });
});
