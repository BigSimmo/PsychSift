/** @vitest-environment jsdom */
// Mounted existing-B/examples-off regression. Every request is intercepted; no backend IDOR claim.
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    status: "authenticated",
    authEpoch: 1,
    session: { user: { id: "synthetic-A", created_at: "2020-01-01T00:00:00Z" } },
  },
  browserActor: "synthetic-A",
}));
vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => state.auth,
  hasSupabaseAuthSession: () => state.auth.status === "authenticated",
}));
// Explicit example-data off: supported production setting, keeps RosterSampleGate's real child mounted.
vi.mock("@/lib/example-data/store", () => ({
  useExampleData: () => ({ active: false, mode: "off" }),
  useAuthIfAvailable: () => state.auth,
  areaDataState: () => "has-data",
  reportAreaData: () => undefined,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { RosterSettingsPage } from "@/components/roster/roster-settings-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";
import { resetSharedGets } from "@/lib/shared-get";
import { ACCOUNT_TRANSITION_EVENT } from "@/lib/account-scoped-browser-state";

function changeToB() {
  // Replace the entire published value, as AuthProvider does; never mutate an A closure.
  state.auth = {
    status: "authenticated",
    authEpoch: state.auth.authEpoch + 1,
    session: { user: { id: "synthetic-B", created_at: "2020-01-01T00:00:00Z" } },
  };
  state.browserActor = "synthetic-B";
  resetSharedGets();
  window.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));
}
const syntheticShift = {
  id: "synthetic-shift-A",
  startsAt: "2026-10-20T00:00:00Z",
  endsAt: "2026-10-20T08:00:00Z",
  title: "Synthetic A shift",
  location: null,
  sourceUid: null,
  kind: "day",
  source: "import",
  seriesId: null,
  workplace: "Synthetic A workplace",
};
let calls: { actorAtRequest: string; url: string; method: string }[];
beforeEach(() => {
  state.auth = {
    status: "authenticated",
    authEpoch: 1,
    session: { user: { id: "synthetic-A", created_at: "2020-01-01T00:00:00Z" } },
  };
  state.browserActor = "synthetic-A";
  resetSharedGets();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input),
        method = init?.method ?? "GET";
      // Models browser ambient-cookie selection at REQUEST time, not a backend authorization bypass.
      calls.push({ actorAtRequest: state.browserActor, url, method });
      if (url === "/api/roster/settings")
        return Response.json({
          settings: {
            calendarShifts: false,
            rowName: state.browserActor === "synthetic-A" ? "Synthetic A row" : "Synthetic B row",
            codes: {},
          },
        });
      if (url === "/api/roster/shifts")
        return Response.json({
          shifts: method === "GET" && state.browserActor === "synthetic-A" ? [syntheticShift] : [],
          latestImport: null,
        });
      if (url === "/api/roster/team") return Response.json({ teams: [], actorId: state.browserActor });
      if (url === "/api/roster/links") return Response.json({ links: [] });
      return Response.json({});
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSharedGets();
});
describe("audit: Roster respects a mounted account transition", () => {
  it("discards A settings and reads B settings after transition", async () => {
    const view = renderHook(() => useRosterSettings());
    await waitFor(() => expect(view.result.current.settings.rowName).toBe("Synthetic A row"));
    act(() => {
      changeToB();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.settings.rowName).toBe("Synthetic B row"));
  });
  it("discards A own shifts after transition", async () => {
    const view = renderHook(() => useRosterShifts());
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(view.result.current.shifts[0]?.id).toBe("synthetic-shift-A");
    act(() => {
      changeToB();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.shifts).toHaveLength(0));
  });
  it("cancels A pending delete rather than issuing it under B ambient identity", async () => {
    const tree = () => (
      <RosterSampleGate>
        <RosterSettingsPage />
      </RosterSampleGate>
    );
    const view = render(tree());
    await screen.findByText("Synthetic A workplace");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Delete my roster data/ }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    act(() => {
      changeToB();
      view.rerender(tree());
    });
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(calls.filter((call) => call.url === "/api/roster/shifts" && call.method === "DELETE")).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("Roster identity races and same-account controls", () => {
  it("drops a late settings GET body after B has loaded", async () => {
    const original = globalThis.fetch;
    const body = deferred<unknown>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/roster/settings" && state.browserActor === "synthetic-A")
          return Promise.resolve({ ok: true, status: 200, json: () => body.promise });
        return original(input, init);
      }),
    );
    const view = renderHook(useRosterSettings);
    await act(async () => {});
    act(() => {
      changeToB();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.settings.rowName).toBe("Synthetic B row"));
    await act(async () => body.resolve({ rowName: "Late A row" }));
    expect(view.result.current.settings.rowName).toBe("Synthetic B row");
  });

  for (const status of [200, 500]) {
    it(`drops A save completion/rollback (${status}) and A queued settings write`, async () => {
      const original = globalThis.fetch;
      const pending = deferred<Response>();
      const puts: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === "/api/roster/settings" && init?.method === "PUT") {
            puts.push(state.browserActor);
            return puts.length === 1 ? pending.promise : Promise.resolve(Response.json({ rowName: "B saved" }));
          }
          return original(input, init);
        }),
      );
      const view = renderHook(useRosterSettings);
      await waitFor(() => expect(view.result.current.status).toBe("ready"));
      let old!: Promise<unknown>[];
      act(() => {
        old = [view.result.current.update({ rowName: "A first" }), view.result.current.update({ rowName: "A second" })];
      });
      await waitFor(() => expect(puts).toHaveLength(1));
      act(() => {
        changeToB();
        view.rerender();
      });
      await waitFor(() => expect(view.result.current.settings.rowName).toBe("Synthetic B row"));
      await act(async () => {
        await view.result.current.update({ rowName: "B saved" });
      });
      await act(async () => {
        pending.resolve(Response.json({ rowName: "A first" }, { status }));
        await Promise.all(old);
      });
      expect(puts).toEqual(["synthetic-A", "synthetic-B"]);
      expect(view.result.current.settings.rowName).toBe("B saved");
    });
  }

  it("drops a late own-shifts save and refuses a retained A destructive callback under B", async () => {
    const original = globalThis.fetch;
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/roster/shifts" && init?.method === "POST" ? pending.promise : original(input, init),
      ),
    );
    const view = renderHook(useRosterShifts);
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    const old = view.result.current;
    let save!: Promise<unknown>;
    act(() => {
      save = old.save({} as Parameters<typeof old.save>[0]);
    });
    act(() => {
      changeToB();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    await act(async () => {
      pending.resolve(Response.json({ shifts: [syntheticShift] }));
      await save;
      await old.deleteAll();
    });
    expect(view.result.current.shifts).toEqual([]);
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("keeps same-account Undo effective", async () => {
    render(
      <RosterSampleGate>
        <RosterSettingsPage />
      </RosterSampleGate>,
    );
    await screen.findByText("Synthetic A workplace");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Delete my roster data/ }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });
});
