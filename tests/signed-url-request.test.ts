import { afterEach, describe, expect, it, vi } from "vitest";

import { requestSignedUrlPayload } from "@/components/document-viewer/signed-url-request";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

function request(onUnauthorized = vi.fn()) {
  return requestSignedUrlPayload("/api/documents/doc-1/signed-url", {
    signal: new AbortController().signal,
    headers: undefined,
    onUnauthorized,
    errorMessage: "Source preview could not be loaded.",
  });
}

describe("requestSignedUrlPayload", () => {
  it("returns the payload of a successful JSON response", async () => {
    stubFetch(Response.json({ url: "https://example.test/signed" }));
    await expect(request()).resolves.toEqual({ url: "https://example.test/signed" });
  });

  it("uses the server's error message from a JSON error response", async () => {
    stubFetch(Response.json({ error: "Document not found." }, { status: 404 }));
    await expect(request()).rejects.toThrow("Document not found.");
  });

  it("still runs the sign-in handling when a 401 has no JSON body", async () => {
    stubFetch(new Response("<html>Unauthorized</html>", { status: 401, headers: { "content-type": "text/html" } }));
    const onUnauthorized = vi.fn();
    await expect(request(onUnauthorized)).rejects.toThrow("Source preview could not be loaded.");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("shows the friendly message, not a parser error, for an HTML gateway error", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    await expect(request()).rejects.toThrow("Source preview could not be loaded.");
  });

  it("shows the friendly message for an empty successful body", async () => {
    stubFetch(new Response("", { status: 200 }));
    await expect(request()).rejects.toThrow("Source preview could not be loaded.");
  });
});
