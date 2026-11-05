import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSignedImageUrl } from "@/components/clinical-dashboard/use-signed-image-url";
import { searchRequestTimeoutMs } from "@/components/clinical-dashboard/search-utils";
import { clearSignedUrlCache, getCachedSignedUrl } from "@/lib/signed-url-cache";

const auth = vi.hoisted(() => ({
  authorizationHeader: { Authorization: "Bearer synthetic-image-a" },
  session: { user: { id: "synthetic-image-a" } },
  markSessionExpired: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const response = (url: string) =>
  new Response(JSON.stringify({ url }), { headers: { "Content-Type": "application/json" } });
async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearSignedUrlCache();
  auth.authorizationHeader = { Authorization: "Bearer synthetic-image-a" };
  auth.session = { user: { id: "synthetic-image-a" } };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearSignedUrlCache();
});

describe("shared signed-image issuance deadlines", () => {
  it.each(["headers", "JSON"] as const)("bounds stalled %s, evicts it and allows a fresh retry", async (stage) => {
    const endpoint = `/api/images/synthetic-deadline-${stage}/signed-url`;
    const headers = deferred<Response>();
    const json = deferred<{ url: string }>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(
        stage === "headers"
          ? headers.promise
          : Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers(),
              json: () => json.promise,
            } as Response),
      )
      .mockResolvedValueOnce(response("/synthetic-recovered.png"));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useSignedImageUrl(endpoint, true));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchRequestTimeoutMs);
    });
    expect(hook.result.current).toMatchObject({ url: null, failed: true, failure: { retryable: true } });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => {
      hook.result.current.retry();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.result.current.url).toBe("/synthetic-recovered.png");
    headers.resolve(response("/synthetic-late.png"));
    json.resolve({ url: "/synthetic-late.png" });
    await flush();
    expect(hook.result.current.url).toBe("/synthetic-recovered.png");
    expect(getCachedSignedUrl(endpoint)?.url).toBe("/synthetic-recovered.png");
  });

  it("coalesces reopening and leaves a sibling's issuance alive on individual unmount", async () => {
    const endpoint = "/api/images/synthetic-siblings/signed-url";
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const first = renderHook(() => useSignedImageUrl(endpoint, true));
    const sibling = renderHook(() => useSignedImageUrl(endpoint, true));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.unmount();
    const reopened = renderHook(() => useSignedImageUrl(endpoint, true));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    pending.resolve(response("/synthetic-shared.png"));
    await flush();
    expect(sibling.result.current.url).toBe("/synthetic-shared.png");
    expect(reopened.result.current.url).toBe("/synthetic-shared.png");
  });

  it("shares a pending retry until its deadline and keeps late settlement from deleting its replacement", async () => {
    const endpoint = "/api/images/synthetic-retry-replacement/signed-url";
    const old = deferred<Response>();
    const replacement = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(old.promise).mockReturnValue(replacement.promise);
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useSignedImageUrl(endpoint, true));
    const sibling = renderHook(() => useSignedImageUrl(endpoint, true));
    await flush();
    await act(async () => {
      hook.result.current.retry();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchRequestTimeoutMs);
    });
    expect(hook.result.current.failed).toBe(true);
    expect(sibling.result.current.failed).toBe(true);
    await act(async () => {
      hook.result.current.retry();
      sibling.result.current.retry();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    old.resolve(response("/synthetic-obsolete.png"));
    await flush();
    expect(hook.result.current.url).toBeNull();
    expect(sibling.result.current.url).toBeNull();
    expect(getCachedSignedUrl(endpoint)).toBeNull();
    const third = renderHook(() => useSignedImageUrl(endpoint, true));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    replacement.resolve(response("/synthetic-current.png"));
    await flush();
    expect(hook.result.current.url).toBe("/synthetic-current.png");
    expect(sibling.result.current.url).toBe("/synthetic-current.png");
    expect(third.result.current.url).toBe("/synthetic-current.png");
  });

  it("does not let a timed-out old identity expire or populate the new identity's cache", async () => {
    const endpoint = "/api/images/synthetic-deadline-identity/signed-url";
    const old = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response("/synthetic-b.png"));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useSignedImageUrl(endpoint, true));
    await flush();
    clearSignedUrlCache();
    auth.authorizationHeader = { Authorization: "Bearer synthetic-image-b" };
    auth.session = { user: { id: "synthetic-image-b" } };
    hook.rerender();
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(searchRequestTimeoutMs);
    });
    old.resolve(new Response("{}", { status: 401 }));
    await flush();
    expect(hook.result.current.url).toBe("/synthetic-b.png");
    expect(getCachedSignedUrl(endpoint)?.url).toBe("/synthetic-b.png");
    expect(auth.markSessionExpired).not.toHaveBeenCalled();
  });
});
