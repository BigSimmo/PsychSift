/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShiftNowProbe } from "@/components/last-place/shift-now-probe";
import { DEVELOPER_ACCESS_COOKIE_PATH } from "@/lib/developer-area/link-access";

function clearCookies() {
  for (const raw of document.cookie.split(";")) {
    const eq = raw.indexOf("=");
    const name = (eq >= 0 ? raw.slice(0, eq) : raw).trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

describe("Developer access cookie path & ShiftNowProbe guest guard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearCookies();
  });

  afterEach(() => {
    cleanup();
    clearCookies();
    vi.restoreAllMocks();
  });

  it("sets DEVELOPER_ACCESS_COOKIE_PATH to root '/' so unlock applies across all developer-gated routes", () => {
    expect(DEVELOPER_ACCESS_COOKIE_PATH).toBe("/");
  });

  it("skips /api/roster/shifts network requests for unauthenticated guests and immediately reports false", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shifts: [] }), { status: 200 }));
    const onResult = vi.fn();

    render(React.createElement(ShiftNowProbe, { onResult }));
    await act(async () => {});

    expect(onResult).toHaveBeenCalledWith(false);
    const rosterShiftCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes("/api/roster/shifts"));
    expect(rosterShiftCalls).toHaveLength(0);
  });

  it("fetches /api/roster/shifts when a Supabase auth token is present in cookies or localStorage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ shifts: [], sample: false, demoMode: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    document.cookie = "sb-psychsift-auth-token=synthetic-session-token; path=/";
    const onResult = vi.fn();

    render(React.createElement(ShiftNowProbe, { onResult }));
    await act(async () => {});

    const rosterShiftCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes("/api/roster/shifts"));
    expect(rosterShiftCalls.length).toBeGreaterThan(0);
  });
});
