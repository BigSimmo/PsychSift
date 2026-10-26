import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRosterRead, postRosterAction } from "@/components/roster/use-roster-team";
import { forgetSharedGets, resetSharedGets, sharedGet } from "@/lib/shared-get";

const SERVICE = "5e000000-0000-4000-8000-000000000001";
const OTHER = "5e000000-0000-4000-8000-000000000002";

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("fetchRosterRead shares identical in-flight reads", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetSharedGets();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends one no-store request for identical reads that overlap", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const a = fetchRosterRead(SERVICE, "overview");
    const b = fetchRosterRead(SERVICE, "overview");
    pending.resolve(new Response(JSON.stringify({ ok: 1 })));
    expect(await a).toMatchObject({ ok: true, data: { ok: 1 } });
    expect(await b).toMatchObject({ ok: true, data: { ok: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/roster/team/${SERVICE}?what=overview`, { cache: "no-store" });
  });

  it("keeps different reads apart and keeps nothing once a read settles", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("{}")));
    await Promise.all([fetchRosterRead(SERVICE, "overview"), fetchRosterRead(SERVICE, "requests")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await fetchRosterRead(SERVICE, "overview");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never lets a read after a write join one that started before it", async () => {
    const before = deferred();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ result: { status: "open" } })));
      return fetchMock.mock.calls.length === 1
        ? before.promise
        : Promise.resolve(new Response(JSON.stringify({ v: 2 })));
    });
    const stale = fetchRosterRead(SERVICE, "requests");
    expect(await postRosterAction(SERVICE, { action: "open.cancel", openShiftId: OTHER })).toMatchObject({ ok: true });
    const fresh = fetchRosterRead(SERVICE, "requests");
    before.resolve(new Response(JSON.stringify({ v: 1 })));
    expect(await stale).toMatchObject({ ok: true, data: { v: 1 } });
    expect(await fresh).toMatchObject({ ok: true, data: { v: 2 } });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(2);
  });
});

describe("forgetSharedGets", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetSharedGets();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forgets only the address and the addresses under it", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const base = `/api/roster/team/${SERVICE}`;
    void sharedGet(`${base}?what=overview`);
    void sharedGet(`${base}0?what=overview`);
    void sharedGet("/api/roster/team");
    forgetSharedGets(base);
    void sharedGet(`${base}?what=overview`);
    void sharedGet(`${base}0?what=overview`);
    void sharedGet("/api/roster/team");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    pending.resolve(new Response("{}"));
  });
});
