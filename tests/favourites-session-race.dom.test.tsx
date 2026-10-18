/** @vitest-environment jsdom */
// Mounted immutable identities; every fetch is intercepted. No backend authorization claim.
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDataProvider, useAccountData } from "@/components/account-data-provider";

const state = vi.hoisted(() => ({
  auth: {
    status: "authenticated" as string,
    authEpoch: 1,
    authorizationHeader: { Authorization: "Bearer synthetic-A" } as Record<string, string>,
    session: { user: { id: "synthetic-A" } },
    markSessionExpired: vi.fn(),
  },
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => state.auth }));
function Probe() {
  const state = useAccountData();
  return (
    <div>
      <span data-testid="ready">{state.ready ? "ready" : "loading"}</span>
      <span data-testid="saved">{state.isSaved("therapy", "cbt") ? "saved" : "empty"}</span>
      <button type="button" onClick={() => void state.setFavourite("therapy", "cbt", true)}>
        Save
      </button>
    </div>
  );
}
const snapshot = { version: 1, favourites: [], sets: [] };
function tree() {
  return (
    <AccountDataProvider>
      <Probe />
    </AccountDataProvider>
  );
}
describe("audit: favourites do not cross account boundaries", () => {
  beforeEach(() => {
    state.auth = {
      ...state.auth,
      status: "authenticated",
      authEpoch: state.auth.authEpoch + 1,
      authorizationHeader: { Authorization: "Bearer synthetic-A" },
      session: { user: { id: "synthetic-A" } },
    };
    state.auth.markSessionExpired.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  for (const transition of ["signed_out", "account-B"] as const) {
    it(`ignores account A save completion after ${transition}`, async () => {
      let resolvePut!: (response: Response) => void;
      const put = new Promise<Response>((resolve) => {
        resolvePut = resolve;
      });
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") return put;
        if (!init?.method || init.method === "GET") return Promise.resolve(Response.json(snapshot));
        throw new Error("Audit probe refused unexpected fetch method");
      });
      vi.stubGlobal("fetch", fetchMock);
      const view = render(tree());
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("ready"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
      state.auth = {
        ...state.auth,
        authEpoch: state.auth.authEpoch + 1,
        status: transition === "signed_out" ? "signed_out" : "authenticated",
        authorizationHeader: transition === "signed_out" ? {} : { Authorization: "Bearer synthetic-B" },
        session: { user: { id: transition === "signed_out" ? "" : "synthetic-B" } },
      };
      view.rerender(tree());
      await waitFor(() => expect(screen.getByTestId("saved").textContent).toBe("empty"));
      await act(async () => {
        resolvePut(Response.json({ version: 1, saved: true }));
      });
      expect(screen.getByTestId("saved").textContent).toBe("empty");
    });
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function switchAccount() {
  state.auth = {
    ...state.auth,
    authEpoch: state.auth.authEpoch + 1,
    authorizationHeader: { Authorization: "Bearer synthetic-B" },
    session: { user: { id: "synthetic-B" } },
  };
}
const itemA = {
  contentType: "therapy",
  contentKey: "cbt",
  createdAt: "2026-08-23T00:00:00.000Z",
  setId: null,
  sortOrder: 10,
  pinnedAt: null,
  lastOpenedAt: null,
};
const setA = {
  id: "4f8a3d2e-c1b0-4a9e-8d7c-6b5a4f3e2d1c",
  name: "Ward round",
  sortOrder: 0,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};
const wrapper = ({ children }: { children: React.ReactNode }) => <AccountDataProvider>{children}</AccountDataProvider>;

describe("favourites identity fencing for reads, failures and queues", () => {
  beforeEach(() => {
    state.auth = {
      ...state.auth,
      status: "authenticated",
      authEpoch: state.auth.authEpoch + 1,
      authorizationHeader: { Authorization: "Bearer synthetic-A" },
      session: { user: { id: "synthetic-A" } },
    };
    state.auth.markSessionExpired.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("drops an old GET body even when fetch already resolved before the switch", async () => {
    const body = deferred<unknown>();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(++reads === 1 ? { ok: true, status: 200, json: () => body.promise } : Response.json(snapshot)),
      ),
    );
    const view = renderHook(useAccountData, { wrapper });
    await waitFor(() => expect(reads).toBe(1));
    act(() => {
      switchAccount();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => body.resolve({ ...snapshot, favourites: [itemA], sets: [setA] }));
    expect(view.result.current.favouriteItems).toEqual([]);
    expect(view.result.current.favouriteSets).toEqual([]);
  });

  it("clears accepted A state on transition and ignores an old GET 401", async () => {
    const pending = deferred<Response>();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        reads += 1;
        if (reads === 1) return Promise.resolve(Response.json({ ...snapshot, favourites: [itemA], sets: [setA] }));
        if (reads === 2) return pending.promise;
        return Promise.resolve(Response.json(snapshot));
      }),
    );
    const view = renderHook(useAccountData, { wrapper });
    await waitFor(() => expect(view.result.current.isSaved("therapy", "cbt")).toBe(true));
    act(() => view.result.current.reload());
    await waitFor(() => expect(reads).toBe(2));
    act(() => {
      switchAccount();
      view.rerender();
    });
    expect(view.result.current.favouriteItems).toEqual([]);
    expect(view.result.current.favouriteSets).toEqual([]);
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => pending.resolve(Response.json({ error: "Synthetic A expired" }, { status: 401 })));
    expect(state.auth.markSessionExpired).not.toHaveBeenCalled();
    expect(view.result.current.loadError).toBeNull();
  });

  it("does not clear B favourites when A clear-all succeeds late", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) =>
        init?.method === "DELETE"
          ? pending.promise
          : Promise.resolve(Response.json({ ...snapshot, favourites: [itemA] })),
      ),
    );
    const view = renderHook(useAccountData, { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    let operation!: Promise<unknown>;
    act(() => {
      operation = view.result.current.clearFavourites();
    });
    await act(async () => {});
    act(() => {
      switchAccount();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => {
      pending.resolve(Response.json({ version: 1, cleared: true }));
      await operation;
    });
    expect(view.result.current.isSaved("therapy", "cbt")).toBe(true);
  });

  for (const kind of ["membership", "structured", "clear"] as const) {
    it(`ignores stale ${kind} 401 and rollback after B has loaded`, async () => {
      const pending = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: unknown, init?: RequestInit) =>
          init?.method
            ? pending.promise
            : Promise.resolve(Response.json({ ...snapshot, favourites: [itemA], sets: [setA] })),
        ),
      );
      const view = renderHook(useAccountData, { wrapper });
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      let operation!: Promise<unknown>;
      act(() => {
        operation =
          kind === "membership"
            ? view.result.current.setFavourite("therapy", "cbt", false)
            : kind === "structured"
              ? view.result.current.deleteFavouriteSet(setA.id)
              : view.result.current.clearFavourites();
      });
      await act(async () => {});
      act(() => {
        switchAccount();
        view.rerender();
      });
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      const before = view.result.current.favouriteItems;
      await act(async () => {
        pending.resolve(Response.json({ error: "Synthetic expired A" }, { status: 401 }));
        await operation;
      });
      expect(state.auth.markSessionExpired).not.toHaveBeenCalled();
      expect(view.result.current.error).toBeNull();
      expect(view.result.current.favouriteItems).toEqual(before);
      expect(view.result.current.favouriteSets).toEqual([setA]);
    });
  }

  it("does not dispatch old queued membership, structured or clear writes, and B does not wait on A", async () => {
    const pending = deferred<Response>();
    const writes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        if (!init?.method) return Promise.resolve(Response.json(snapshot));
        writes.push(`${state.auth.session.user.id}:${init.method}`);
        return writes.length === 1 ? pending.promise : Promise.resolve(Response.json({ version: 1, saved: true }));
      }),
    );
    const view = renderHook(useAccountData, { wrapper });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    let operations!: Promise<unknown>[];
    act(() => {
      const old = view.result.current;
      operations = [
        old.setFavourite("therapy", "cbt", true),
        old.setFavourite("therapy", "cbt", false),
        old.clearFavourites(),
        old.createFavouriteSet("Ward round"),
      ];
    });
    await waitFor(() => expect(writes).toHaveLength(1));
    act(() => {
      switchAccount();
      view.rerender();
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => {
      await view.result.current.setFavourite("therapy", "cbt", true);
    });
    expect(writes).toEqual(["synthetic-A:PUT", "synthetic-B:PUT"]);
    await act(async () => {
      pending.resolve(Response.json({ version: 1, saved: true }));
      await Promise.all(operations);
    });
    expect(writes).toEqual(["synthetic-A:PUT", "synthetic-B:PUT"]);
    expect(view.result.current.isSaved("therapy", "cbt")).toBe(true);
    expect(view.result.current.favouriteSets).toEqual([]);
  });

  for (const status of [200, 500]) {
    it(`does not apply a stale create-set response or rollback (${status})`, async () => {
      const pending = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: unknown, init?: RequestInit) =>
          init?.method ? pending.promise : Promise.resolve(Response.json(snapshot)),
        ),
      );
      const view = renderHook(useAccountData, { wrapper });
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      let operation!: Promise<unknown>;
      act(() => {
        operation = view.result.current.createFavouriteSet("Ward round");
      });
      await act(async () => {});
      act(() => {
        switchAccount();
        view.rerender();
      });
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      await act(async () => {
        pending.resolve(Response.json({ version: 1, set: setA }, { status }));
        await operation;
      });
      expect(view.result.current.favouriteSets).toEqual([]);
      expect(view.result.current.error).toBeNull();
    });
  }
});
