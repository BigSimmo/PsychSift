import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetSharedGets, sharedGet } from "@/lib/shared-get";

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("sharedGet", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetSharedGets();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one request between callers that overlap", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const a = sharedGet("/api/roster/team");
    const b = sharedGet("/api/roster/team");
    pending.resolve(new Response(JSON.stringify({ ok: 1 })));
    expect(await (await a).json()).toEqual({ ok: 1 });
    expect(await (await b).json()).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/roster/team", { cache: "no-store" });
  });

  it("keeps nothing after the request settles", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("{}")));
    await sharedGet("/api/cme/year");
    await sharedGet("/api/cme/year");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborting one caller leaves the others", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const aborted = sharedGet("/api/roster/shifts", { signal: controller.signal });
    const kept = sharedGet("/api/roster/shifts");
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve(new Response("[]"));
    expect(await (await kept).json()).toEqual([]);
  });

  it("rejects at once when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sharedGet("/x", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never shares across a reset (sign-out or account switch)", async () => {
    const first = deferred();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Response('"new"'));
    const before = sharedGet("/api/roster/team");
    resetSharedGets();
    const after = sharedGet("/api/roster/team");
    first.resolve(new Response('"old"'));
    expect(await (await before).json()).toBe("old");
    expect(await (await after).json()).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares failures too, then retries fresh", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response("{}"));
    await expect(Promise.all([sharedGet("/y"), sharedGet("/y")])).rejects.toThrow("offline");
    await sharedGet("/y");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
