/** @vitest-environment jsdom */

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  mayRecordRecentSearches,
  useAppPreferences,
} from "@/components/clinical-dashboard/use-app-preferences";

const authSession = vi.hoisted(() => ({
  status: "authenticated" as string,
  authEpoch: 1,
  authorizationHeader: { Authorization: "Bearer preferences-test" } as Record<string, string>,
  markSessionExpired: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

const PREFERENCES_KEY = "clinical-kb-preferences";

function PreferencesProbe() {
  const { preferences, setPreference, syncState, retrySync, canRecordRecentSearches } = useAppPreferences();
  return (
    <div>
      <span data-testid="sync">{syncState}</span>
      <span data-testid="density">{preferences.density}</span>
      <span data-testid="save-recent">{preferences.saveRecentSearches ? "on" : "off"}</span>
      <span data-testid="may-record">{canRecordRecentSearches ? "yes" : "no"}</span>
      <button type="button" onClick={() => setPreference("density", "compact")}>
        Compact
      </button>
      <button type="button" onClick={() => setPreference("density", "spacious")}>
        Spacious
      </button>
      <button type="button" onClick={() => setPreference("motion", "reduced")}>
        Reduced motion
      </button>
      <button type="button" onClick={retrySync}>
        Retry sync
      </button>
    </div>
  );
}

describe("account preference bootstrap and write serialisation", () => {
  beforeEach(() => {
    authSession.status = "authenticated";
    authSession.authEpoch = 1;
    authSession.markSessionExpired.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("does not allow recent-search recording until the deferred account GET settles", async () => {
    let resolveGet: ((response: Response) => void) | null = null;
    const getPromise = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(input).includes("/api/account/preferences")) {
        return getPromise;
      }
      throw new Error(`Unexpected fetch: ${method} ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Empty local storage → default saveRecentSearches is true. Recording must
    // still wait: the account may have opted out on another device.
    expect(DEFAULT_PREFERENCES.saveRecentSearches).toBe(true);

    const { getByTestId } = render(<PreferencesProbe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);

    await act(async () => {
      resolveGet?.(
        Response.json({
          preferences: { ...DEFAULT_PREFERENCES, saveRecentSearches: false },
          updatedAt: "2026-08-25T00:00:00.000Z",
        }),
      );
    });

    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(getByTestId("save-recent")).toHaveTextContent("off");
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);
  });

  it("omits the fresh-client privacy default when bootstrapping a missing account row", async () => {
    const putBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(input).includes("/api/account/preferences")) {
        return Promise.resolve(Response.json({ preferences: null, updatedAt: null }));
      }
      if (method === "PUT" && String(input).includes("/api/account/preferences")) {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        putBodies.push(patch);
        return Promise.resolve(
          Response.json({
            // Simulate another device creating the row with an opt-out between
            // this client's GET and its bootstrap PUT.
            preferences: { ...DEFAULT_PREFERENCES, ...patch, saveRecentSearches: false },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByTestId } = render(<PreferencesProbe />);

    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]).not.toHaveProperty("saveRecentSearches");
    expect(getByTestId("save-recent")).toHaveTextContent("off");
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);
  });

  it("never copies a shared device's work stage into a new account", async () => {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, workStage: "registrar", ranzcpStage: 2 }),
    );
    const putBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") return Promise.resolve(Response.json({ preferences: null, updatedAt: null }));
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        putBodies.push(patch);
        return Promise.resolve(Response.json({ preferences: { ...DEFAULT_PREFERENCES, ...patch } }));
      }),
    );

    const { getByTestId } = render(<PreferencesProbe />);

    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]).not.toHaveProperty("workStage");
    expect(putBodies[0]).not.toHaveProperty("ranzcpStage");
  });

  it("preserves an account opt-out when an unrelated setting changes after bootstrap fails", async () => {
    const putBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(input).includes("/api/account/preferences")) {
        return Promise.resolve(new Response("upstream unavailable", { status: 503 }));
      }
      if (method === "PUT" && String(input).includes("/api/account/preferences")) {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        putBodies.push(patch);
        return Promise.resolve(
          Response.json({
            preferences: {
              ...DEFAULT_PREFERENCES,
              ...patch,
              saveRecentSearches: false,
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, getByTestId } = render(<PreferencesProbe />);
    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("error"));
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);

    await act(async () => {
      getByRole("button", { name: "Reduced motion" }).click();
    });

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ motion: "reduced" });
    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(getByTestId("save-recent")).toHaveTextContent("off");
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);
  });

  it("preserves an account opt-out when an unrelated setting changes while bootstrap is in flight", async () => {
    let resolveGet: ((response: Response) => void) | null = null;
    const getPromise = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
    const putBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(input).includes("/api/account/preferences")) return getPromise;
      if (method === "PUT" && String(input).includes("/api/account/preferences")) {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        putBodies.push(patch);
        return Promise.resolve(
          Response.json({
            preferences: {
              ...DEFAULT_PREFERENCES,
              ...patch,
              saveRecentSearches: false,
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, getByTestId } = render(<PreferencesProbe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      getByRole("button", { name: "Compact" }).click();
    });

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ density: "compact" });
    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(getByTestId("save-recent")).toHaveTextContent("off");
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);

    await act(async () => {
      resolveGet?.(
        Response.json({
          preferences: { ...DEFAULT_PREFERENCES, density: "compact", saveRecentSearches: false },
        }),
      );
    });
  });

  it("retries a failed bootstrap with a read and never uploads the fresh-client default", async () => {
    let getCount = 0;
    const putBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(input).includes("/api/account/preferences")) {
        getCount += 1;
        if (getCount === 1) return Promise.resolve(new Response("upstream unavailable", { status: 503 }));
        return Promise.resolve(
          Response.json({
            preferences: { ...DEFAULT_PREFERENCES, saveRecentSearches: false },
            updatedAt: "2026-08-25T00:00:00.000Z",
          }),
        );
      }
      if (method === "PUT" && String(input).includes("/api/account/preferences")) {
        putBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Promise.resolve(Response.json({ preferences: DEFAULT_PREFERENCES }));
      }
      throw new Error(`Unexpected fetch: ${method} ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, getByTestId } = render(<PreferencesProbe />);
    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("error"));

    await act(async () => {
      getByRole("button", { name: "Retry sync" }).click();
    });

    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(getCount).toBe(2);
    expect(putBodies).toEqual([]);
    expect(getByTestId("save-recent")).toHaveTextContent("off");
    expect(getByTestId("may-record")).toHaveTextContent("no");
    expect(mayRecordRecentSearches()).toBe(false);
  });

  it("serializes preference PUTs so a delayed older patch cannot overwrite a newer one", async () => {
    type PutResponse = { ok: boolean; status: number; json: () => Promise<{ preferences: unknown }> };
    const pendingPuts: Array<{
      body: Partial<typeof DEFAULT_PREFERENCES>;
      resolve: (response: PutResponse) => void;
    }> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && String(input).includes("/api/account/preferences")) {
        return Promise.resolve(
          Response.json({
            preferences: DEFAULT_PREFERENCES,
            updatedAt: "2026-08-25T00:00:00.000Z",
          }),
        );
      }
      if (method === "PUT" && String(input).includes("/api/account/preferences")) {
        return new Promise<PutResponse>((resolve) => {
          pendingPuts.push({
            body: JSON.parse(String(init?.body)) as Partial<typeof DEFAULT_PREFERENCES>,
            resolve,
          });
        });
      }
      throw new Error(`Unexpected fetch: ${method} ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByTestId, getByRole } = render(<PreferencesProbe />);
    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));

    // Hold the first patch PUT, then queue a newer patch while it
    // is still deferred — the older request must not race ahead or finish last.
    await act(async () => {
      getByRole("button", { name: "Compact" }).click();
    });
    await waitFor(() => expect(pendingPuts).toHaveLength(1));
    expect(pendingPuts[0]?.body.density).toBe("compact");

    await act(async () => {
      getByRole("button", { name: "Spacious" }).click();
      getByRole("button", { name: "Reduced motion" }).click();
    });
    expect(pendingPuts).toHaveLength(1);

    await act(async () => {
      pendingPuts[0]?.resolve({
        ok: true,
        status: 200,
        json: async () => ({ preferences: { ...DEFAULT_PREFERENCES, ...pendingPuts[0]?.body } }),
      });
    });

    await waitFor(() => expect(pendingPuts).toHaveLength(2));
    expect(pendingPuts[1]?.body).toMatchObject({ density: "spacious", motion: "reduced" });

    await act(async () => {
      pendingPuts[1]?.resolve({
        ok: true,
        status: 200,
        json: async () => ({ preferences: { ...DEFAULT_PREFERENCES, ...pendingPuts[1]?.body } }),
      });
    });

    await waitFor(() => expect(getByTestId("sync")).toHaveTextContent("synced"));
    expect(getByTestId("density")).toHaveTextContent("spacious");
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}")).toMatchObject({
      density: "spacious",
      motion: "reduced",
    });
    expect(pendingPuts).toHaveLength(2);
  });
});
