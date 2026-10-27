import { describe, expect, it, vi } from "vitest";
import {
  buildClientErrorReport,
  CLIENT_ERROR_MAX_REPORTS_PER_PAGE,
  clientErrorSection,
  installClientErrorReporter,
  parseClientStackFrames,
  type ClientErrorReport,
} from "@/lib/observability/client-error-report";

const ORIGIN = "https://psychiatry.tools";

function errorWithStack(name: string, message: string, stack: string) {
  const error = new Error(message);
  error.name = name;
  error.stack = stack;
  return error;
}

const CHROME_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'Jane Doe MRN 123456')",
  `    at renderCard (${ORIGIN}/_next/static/chunks/app/my-day/page-abc.js:12:345)`,
  `    at ${ORIGIN}/_next/static/chunks/main-def.js:1:2`,
  "    at chrome-extension://abc/content.js:3:4",
  "    at https://evil.example/_next/static/chunks/x.js:5:6",
].join("\n");

const SAFARI_STACK = [
  `renderCard@${ORIGIN}/_next/static/chunks/app/my-day/page-abc.js:12:345`,
  `@${ORIGIN}/_next/static/chunks/main-def.js:1:2`,
  "global code@https://evil.example/x.js:1:1",
].join("\n");

describe("browser error report", () => {
  it("keeps only the first path segment", () => {
    expect(clientErrorSection("/")).toBe("/");
    expect(clientErrorSection("/documents/2f1c-uuid/page")).toBe("/documents");
    expect(clientErrorSection("/Jane%20Doe")).toBe("/other");
  });

  it("parses Chrome and Safari stacks to same-origin app frames, oldest first", () => {
    const expected = [
      { filename: "/_next/static/chunks/main-def.js", lineno: 1, colno: 2 },
      { filename: "/_next/static/chunks/app/my-day/page-abc.js", function: "renderCard", lineno: 12, colno: 345 },
    ];
    expect(parseClientStackFrames(CHROME_STACK, ORIGIN)).toEqual(expected);
    expect(parseClientStackFrames(SAFARI_STACK, ORIGIN)).toEqual(expected);
  });

  it("never carries the message, query string or a custom error name", () => {
    const report = buildClientErrorReport({
      error: errorWithStack("JaneDoe 123456", "Jane Doe MRN 123456", CHROME_STACK.replace(".js:12", ".js?q=Jane:12")),
      mechanism: "onerror",
      pathname: "/search",
      origin: ORIGIN,
    });
    const serialised = JSON.stringify(report);
    expect(report?.type).toBe("Error");
    expect(serialised).not.toMatch(/Jane|123456|\?q=/);
  });

  it("sends nothing for non-Error values or stacks without app frames", () => {
    expect(
      buildClientErrorReport({ error: "Jane Doe", mechanism: "onerror", pathname: "/", origin: ORIGIN }),
    ).toBeNull();
    expect(
      buildClientErrorReport({
        error: errorWithStack("TypeError", "x", "    at https://evil.example/a.js:1:1"),
        mechanism: "onerror",
        pathname: "/",
        origin: ORIGIN,
      }),
    ).toBeNull();
  });
});

function fakeWindow(onLine = true) {
  const listeners = new Map<string, (event: unknown) => void>();
  const target = {
    navigator: { onLine },
    location: { pathname: "/my-day", origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  return { target: target as unknown as Window, listeners };
}

describe("installClientErrorReporter", () => {
  it("reports each distinct fault once, caps per page, and cleans up", () => {
    const { target, listeners } = fakeWindow();
    const sent: ClientErrorReport[] = [];
    const cleanup = installClientErrorReporter(target, (report) => sent.push(report));
    const fire = (line: number) =>
      listeners.get("error")?.({
        error: errorWithStack("TypeError", "x", `    at f (${ORIGIN}/_next/static/chunks/a.js:${line}:1)`),
      });
    fire(1);
    fire(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "TypeError", mechanism: "onerror", section: "/my-day" });
    for (let line = 2; line < 20; line += 1) fire(line);
    expect(sent).toHaveLength(CLIENT_ERROR_MAX_REPORTS_PER_PAGE);
    listeners.get("unhandledrejection")?.({
      reason: errorWithStack("Error", "x", `    at ${ORIGIN}/_next/static/chunks/b.js:1:1`),
    });
    expect(sent).toHaveLength(CLIENT_ERROR_MAX_REPORTS_PER_PAGE);
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it("sends nothing offline", () => {
    const { target, listeners } = fakeWindow(false);
    const send = vi.fn();
    installClientErrorReporter(target, send);
    listeners.get("error")?.({ error: errorWithStack("TypeError", "x", `    at ${ORIGIN}/_next/a.js:1:1`) });
    expect(send).not.toHaveBeenCalled();
  });
});
