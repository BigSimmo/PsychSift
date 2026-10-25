import { describe, expect, it, vi } from "vitest";

import { withAuthRequestTimeout } from "@/lib/supabase/browser-client";

const AUTH_URL = "https://example.supabase.co/auth/v1/logout?scope=global";
const STORAGE_URL = "https://example.supabase.co/storage/v1/object/documents/file.pdf";

// A connection that stalls without failing: the request settles only if its signal aborts.
function stalledFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      }),
  );
}

describe("withAuthRequestTimeout", () => {
  it("fails a stalled auth-server request at the deadline so sign-out can finish", async () => {
    const baseFetch = stalledFetch();
    const timedFetch = withAuthRequestTimeout(baseFetch as unknown as typeof fetch, 20);

    await expect(timedFetch(AUTH_URL, { method: "POST" })).rejects.toBeDefined();
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls[0][1]?.method).toBe("POST");
  });

  it("still honours the caller's own abort signal on an auth request", async () => {
    const baseFetch = stalledFetch();
    const timedFetch = withAuthRequestTimeout(baseFetch as unknown as typeof fetch, 60_000);
    const controller = new AbortController();

    const pending = timedFetch(AUTH_URL, { signal: controller.signal });
    controller.abort(new Error("caller cancelled"));

    await expect(pending).rejects.toThrow("caller cancelled");
  });

  it("leaves non-auth requests such as document uploads untouched", async () => {
    const response = new Response("ok");
    const baseFetch = vi.fn(async () => response);
    const timedFetch = withAuthRequestTimeout(baseFetch as unknown as typeof fetch, 20);
    const init = { method: "PUT" };

    await expect(timedFetch(STORAGE_URL, init)).resolves.toBe(response);
    expect(baseFetch).toHaveBeenCalledWith(STORAGE_URL, init);
  });
});
