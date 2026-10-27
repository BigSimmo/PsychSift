/**
 * Phone and browser error reports (performance audit M4). Without them a fault that only happens
 * in the browser, such as the offline reload fixed in #3856, is never seen by anyone.
 *
 * The report is built here, in the browser, from code locations only: the runtime error type, how
 * it was caught, the first segment of the page path, and stack frames that point at the app's own
 * `/_next/` files. The error message, the query string, typed text, page content and account data
 * are never read into it. The server route (`src/app/api/client-error/route.ts`) validates the
 * shape again and forwards it through the same Sentry scrubber as server errors, so no browser SDK
 * and no new data recipient is involved. Dependency-free on purpose: it is in the root layout.
 */

export const CLIENT_ERROR_ENDPOINT = "/api/client-error";
export const CLIENT_ERROR_MAX_FRAMES = 30;
/** At most this many reports leave one page load, so a looping fault cannot flood the server. */
export const CLIENT_ERROR_MAX_REPORTS_PER_PAGE = 5;

export type ClientErrorMechanism = "onerror" | "onunhandledrejection";

export type ClientErrorFrame = {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
};

export type ClientErrorReport = {
  type: string;
  mechanism: ClientErrorMechanism;
  section: string;
  frames: ClientErrorFrame[];
};

const SECTION_SEGMENT = /^[a-z0-9-]{1,40}$/;
const ERROR_TYPE = /^[A-Za-z]{1,40}$/;
const FUNCTION_NAME = /^[\w$.<>[\] ]{1,200}$/;
// Chrome / Edge: "    at fn (https://host/_next/static/chunks/a.js:1:2)" or "    at https://host/...:1:2".
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// Safari / Firefox: "fn@https://host/_next/static/chunks/a.js:1:2" or "@https://host/...:1:2".
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/**
 * The first path segment only, so `/documents/<id>` becomes `/documents` and no record id, search
 * word or other request value travels with the report.
 */
export function clientErrorSection(pathname: string): string {
  const first = pathname.split("/").find((segment) => segment.length > 0);
  if (!first) return "/";
  return SECTION_SEGMENT.test(first) ? `/${first}` : "/other";
}

/** Frames that point at the app's own built files, oldest first as Sentry expects. */
export function parseClientStackFrames(stack: string | undefined, origin: string): ClientErrorFrame[] {
  if (!stack) return [];
  const frames: ClientErrorFrame[] = [];
  for (const line of stack.split("\n")) {
    const matched = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!matched) continue;
    const [, rawFunction, rawUrl, rawLine, rawColumn] = matched;
    let url: URL;
    try {
      url = new URL(rawUrl ?? "");
    } catch {
      continue;
    }
    // Extensions, other sites and inline scripts are not this app's code.
    if (url.origin !== origin || !url.pathname.startsWith("/_next/")) continue;
    const name = rawFunction?.trim();
    frames.push({
      filename: url.pathname,
      ...(name && FUNCTION_NAME.test(name) ? { function: name } : {}),
      lineno: Number(rawLine),
      colno: Number(rawColumn),
    });
    if (frames.length >= CLIENT_ERROR_MAX_FRAMES) break;
  }
  return frames.reverse();
}

/** A report for an error thrown by the app's own code, or null when there is nothing safe to send. */
export function buildClientErrorReport(args: {
  error: unknown;
  mechanism: ClientErrorMechanism;
  pathname: string;
  origin: string;
}): ClientErrorReport | null {
  if (!(args.error instanceof Error)) return null;
  const frames = parseClientStackFrames(args.error.stack, args.origin);
  if (frames.length === 0) return null;
  return {
    type: ERROR_TYPE.test(args.error.name) ? args.error.name : "Error",
    mechanism: args.mechanism,
    section: clientErrorSection(args.pathname),
    frames,
  };
}

/**
 * Listens for uncaught errors and rejections and sends each new one once. Offline it sends nothing:
 * the report could not arrive, and the failures are usually the connection itself.
 * Returns the cleanup.
 */
export function installClientErrorReporter(
  target: Window = window,
  send: (report: ClientErrorReport) => void = sendClientErrorReport,
): () => void {
  const seen = new Set<string>();
  const report = (error: unknown, mechanism: ClientErrorMechanism) => {
    if (seen.size >= CLIENT_ERROR_MAX_REPORTS_PER_PAGE || target.navigator.onLine === false) return;
    const built = buildClientErrorReport({
      error,
      mechanism,
      pathname: target.location.pathname,
      origin: target.location.origin,
    });
    if (!built) return;
    const top = built.frames.at(-1);
    const key = `${built.type}|${top?.filename}|${top?.lineno}|${top?.colno}`;
    if (seen.has(key)) return;
    seen.add(key);
    send(built);
  };
  const onError = (event: ErrorEvent) => report(event.error, "onerror");
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason, "onunhandledrejection");
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

function sendClientErrorReport(report: ClientErrorReport) {
  try {
    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      // No cookies: the report is not tied to an account.
      credentials: "omit",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never become a second error.
  }
}
