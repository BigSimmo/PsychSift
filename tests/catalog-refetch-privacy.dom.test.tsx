import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMedicationCatalog } from "@/components/clinical-dashboard/use-medication-catalog";
import { useRegistryRecord, useRegistryRecords } from "@/lib/use-registry-records";

const authSession = vi.hoisted(() => ({
  authorizationHeader: { Authorization: "Bearer user-a-token" },
  markSessionExpired: vi.fn(),
  session: { user: { id: "user-a" } },
  status: "authenticated" as const,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  authSession.authorizationHeader = { Authorization: "Bearer user-a-token" };
  authSession.markSessionExpired.mockReset();
  authSession.session = { user: { id: "user-a" } };
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth-backed catalogue background refresh", () => {
  it("requests the selected lightweight projection", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 54, verifiedCount: 42 }));

    const { result } = renderHook(() => useRegistryRecords("form", { view: "summary" }));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/registry/records?kind=form&view=summary",
      expect.objectContaining({ headers: authSession.authorizationHeader }),
    );
    expect(result.current).toMatchObject({ status: "ready", records: [], total: 54, verifiedCount: 42 });
  });

  it("preserves registry rows for a same-user refresh and clears them immediately on identity change", async () => {
    const record = { slug: "cmht", title: "Community Mental Health Team" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [record], total: 1, verifiedCount: 0, governance: {} }));

    const { result, rerender } = renderHook(() => useRegistryRecords("service"));
    await flushMicrotasks();
    expect(result.current).toMatchObject({ status: "ready", records: [record], total: 1 });

    let resolveRefresh!: (response: Response) => void;
    let resolveNextIdentity!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveRefresh = resolve)));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveNextIdentity = resolve)));
    authSession.authorizationHeader = { Authorization: "Bearer user-a-refreshed" };
    rerender();
    expect(result.current).toMatchObject({ status: "refetching", records: [record], total: 1 });

    authSession.authorizationHeader = { Authorization: "Bearer user-b-token" };
    authSession.session = { user: { id: "user-b" } };
    rerender();
    expect(result.current).toMatchObject({ status: "loading", records: [], total: 0 });

    await act(async () =>
      resolveRefresh(jsonResponse({ records: [record], total: 1, verifiedCount: 0, governance: {} })),
    );
    await flushMicrotasks();
    expect(result.current).toMatchObject({ status: "loading", records: [], total: 0 });

    await act(async () =>
      resolveNextIdentity(jsonResponse({ records: [], total: 0, verifiedCount: 0, governance: {} })),
    );
    await flushMicrotasks();
    expect(result.current).toMatchObject({ status: "ready", records: [], total: 0 });
  });

  it("fails closed when a registry list returns malformed success data", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: "not-an-array", total: 1, verifiedCount: 0 }));

    const { result } = renderHook(() => useRegistryRecords("service"));
    await flushMicrotasks();

    expect(result.current).toMatchObject({ status: "error", records: [], total: 0 });
  });

  it("fails closed when a registry detail omits its governance contract", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ record: { slug: "cmht", title: "Community Mental Health Team" }, linkedDocuments: [] }),
    );

    const { result } = renderHook(() => useRegistryRecord("service", "cmht"));
    await flushMicrotasks();

    expect(result.current).toMatchObject({ status: "error", record: null, linkedDocuments: [] });
  });

  it("aborts a registry detail request and never paints its late body after an identity change", async () => {
    const record = { slug: "cmht", title: "Community Mental Health Team" };
    let resolveBody!: (body: unknown) => void;
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_input, init) => {
      firstSignal = init?.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((resolve) => (resolveBody = resolve)),
      } as unknown as Response);
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not_found" }, 404));

    const { result, rerender } = renderHook(() => useRegistryRecord("service", "cmht"));
    await flushMicrotasks();
    expect(result.current).toMatchObject({ status: "loading", record: null });

    authSession.authorizationHeader = { Authorization: "Bearer user-b-token" };
    authSession.session = { user: { id: "user-b" } };
    rerender();
    await flushMicrotasks();
    expect(firstSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ status: "not_found", record: null });

    await act(async () =>
      resolveBody({
        record,
        linkedDocuments: [],
        governance: { sourceStatus: "current", validationStatus: "unverified" },
      }),
    );
    await flushMicrotasks();
    expect(result.current).toMatchObject({ status: "not_found", record: null });
  });

  it("preserves medication data only while query and identity are unchanged", async () => {
    vi.useFakeTimers();
    const payload = { records: [{ slug: "clozapine", name: "Clozapine" }], total: 1 };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));

    const { result, rerender } = renderHook(() => useMedicationCatalog("clozapine", { debounceMs: 0 }));
    await act(async () => vi.runOnlyPendingTimersAsync());
    await flushMicrotasks();
    expect(result.current).toMatchObject({ data: payload, loading: false, error: null });

    let resolveRefresh!: (response: Response) => void;
    let resolveNextIdentity!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveRefresh = resolve)));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveNextIdentity = resolve)));
    authSession.authorizationHeader = { Authorization: "Bearer user-a-refreshed" };
    rerender();
    expect(result.current).toMatchObject({ data: payload, loading: true, error: null });
    await act(async () => vi.runOnlyPendingTimersAsync());

    authSession.authorizationHeader = { Authorization: "Bearer user-b-token" };
    authSession.session = { user: { id: "user-b" } };
    rerender();
    expect(result.current).toMatchObject({ data: null, loading: true, error: null });
    await act(async () => vi.runOnlyPendingTimersAsync());

    await act(async () => resolveRefresh(jsonResponse(payload)));
    await flushMicrotasks();
    expect(result.current).toMatchObject({ data: null, loading: true, error: null });

    await act(async () => resolveNextIdentity(jsonResponse({ records: [], total: 0 })));
    await flushMicrotasks();
    expect(result.current).toMatchObject({ data: { records: [], total: 0 }, loading: false, error: null });
  });
});
