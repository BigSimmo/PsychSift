import { stringMatchesSomePattern } from "@sentry/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Sentry applies `ignoreErrors` BEFORE `beforeSend`: a string entry is a
// substring match and a RegExp entry is `.test()`, each tried against the
// exception value, `${type}: ${value}` and the event message (2026-09-02 audit,
// L8). A bare `/404/` or "NotFound" therefore also drops a Supabase Storage 404
// during upload cleanup or a provider 404 for a retired resource — failures an
// operator must see. This file reads the live list from the config's own
// `Sentry.init` call and pins both halves: the intended Next.js / framework
// shapes stay ignored, and genuine server errors that merely contain the words
// are not.

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  supabaseIntegration: vi.fn(() => ({ name: "Supabase" })),
  getClient: vi.fn(() => undefined),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

vi.mock("@sentry/nextjs", () => sentry);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

type IgnorePattern = string | RegExp;

async function loadServerIgnoreErrors(): Promise<IgnorePattern[]> {
  vi.stubEnv("SENTRY_ENABLE_LOGS", "false");
  vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
  await import("@/sentry.server.config");
  const options = sentry.init.mock.calls[0]?.[0] as { ignoreErrors?: IgnorePattern[] } | undefined;
  expect(options, "Sentry.init was not called by the server config").toBeDefined();
  expect(Array.isArray(options?.ignoreErrors)).toBe(true);
  return options?.ignoreErrors ?? [];
}

/** Mirrors `@sentry/core`'s inbound filter: the messages it tries, with its own matcher. */
function isIgnored(patterns: IgnorePattern[], exception: { type: string; value: string }): boolean {
  const possibleMessages = [exception.value, `${exception.type}: ${exception.value}`];
  return possibleMessages.some((message) => stringMatchesSomePattern(message, patterns));
}

describe("Sentry server ignoreErrors", () => {
  it("keeps ignoring the intended Next.js and framework not-found shapes", async () => {
    const patterns = await loadServerIgnoreErrors();
    const intended = [
      // Next.js `notFound()`: the error's message is its digest.
      { type: "Error", value: "NEXT_HTTP_ERROR_FALLBACK;404" },
      { type: "Error", value: "NEXT_NOT_FOUND" },
      { type: "AxiosError", value: "Request failed with status code 404" },
      { type: "NotFoundError", value: "Not Found" },
      { type: "Error", value: "Cannot find module './missing-chunk.js'" },
      { type: "SyntaxError", value: "Unexpected token < in JSON at position 0" },
      { type: "BotAccessDenied", value: "blocked crawler user agent" },
      { type: "RateLimitedError", value: "too many requests" },
    ];
    for (const exception of intended) {
      expect(isIgnored(patterns, exception), `${exception.type}: ${exception.value}`).toBe(true);
    }
  });

  it("does not drop genuine server errors that merely contain 404 or not-found wording", async () => {
    const patterns = await loadServerIgnoreErrors();
    const genuine = [
      // Supabase Storage during upload cleanup — the object is gone, the pipeline is not fine.
      { type: "StorageApiError", value: "Object not found" },
      { type: "Error", value: "Supabase Storage returned 404 while deleting orphaned page image" },
      // A provider rejecting a retired resource.
      { type: "Error", value: "OpenAI request failed with status 404: resource not found" },
      // Our own future error types must not be swallowed on a name fragment.
      { type: "DocumentChunkNotFound", value: "chunk 12 is missing for document abc" },
      { type: "Error", value: "Failed to load pathway version: 404" },
    ];
    for (const exception of genuine) {
      expect(isIgnored(patterns, exception), `${exception.type}: ${exception.value}`).toBe(false);
    }
  });

  it("uses only start-anchored regular expressions, never substring strings", async () => {
    const patterns = await loadServerIgnoreErrors();
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern, String(pattern)).toBeInstanceOf(RegExp);
      expect((pattern as RegExp).source.startsWith("^"), String(pattern)).toBe(true);
    }
  });
});

describe("Sentry server beforeSend bot filter", () => {
  type BeforeSend = (event: Record<string, unknown>) => unknown;

  async function loadServerBeforeSend(): Promise<BeforeSend> {
    vi.stubEnv("SENTRY_ENABLE_LOGS", "false");
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    await import("@/sentry.server.config");
    const options = sentry.init.mock.calls[0]?.[0] as { beforeSend?: BeforeSend } | undefined;
    expect(typeof options?.beforeSend).toBe("function");
    return options!.beforeSend!;
  }

  const headlessChrome =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36";

  it("keeps a 500-class server error from an automated user agent", async () => {
    const beforeSend = await loadServerBeforeSend();
    const kept = beforeSend({
      level: "error",
      request: { headers: { "user-agent": headlessChrome } },
      contexts: { response: { status_code: 500 } },
      exception: { values: [{ type: "TypeError", value: "boom", mechanism: { type: "generic", handled: true } }] },
    });
    expect(kept).not.toBeNull();
    // An unhandled exception with no response status is kept too.
    expect(
      beforeSend({
        level: "error",
        request: { headers: { "user-agent": "curl/8.5.0" } },
        exception: {
          values: [
            {
              type: "Error",
              value: "boom",
              mechanism: { type: "auto.function.nextjs.on_request_error", handled: false },
            },
          ],
        },
      }),
    ).not.toBeNull();
  });

  it("still drops bot noise that is not a server error", async () => {
    const beforeSend = await loadServerBeforeSend();
    expect(
      beforeSend({
        level: "error",
        request: { headers: { "user-agent": headlessChrome } },
        contexts: { response: { status_code: 404 } },
        exception: {
          values: [{ type: "Error", value: "missing page", mechanism: { type: "generic", handled: true } }],
        },
      }),
    ).toBeNull();
    expect(
      beforeSend({
        level: "warning",
        request: { headers: { "user-agent": "Googlebot/2.1" } },
        message: "probe for a missing path",
      }),
    ).toBeNull();
  });

  it("keeps a 4xx-type event from a human browser", async () => {
    const beforeSend = await loadServerBeforeSend();
    expect(
      beforeSend({
        level: "error",
        request: { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } },
        contexts: { response: { status_code: 404 } },
        exception: {
          values: [{ type: "Error", value: "missing page", mechanism: { type: "generic", handled: true } }],
        },
      }),
    ).not.toBeNull();
  });
});
