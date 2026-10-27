import { z } from "zod";
import { CLIENT_ERROR_MAX_FRAMES } from "@/lib/observability/client-error-report";

/**
 * Server side of the browser error report (`@/lib/observability/client-error-report`). A report
 * carries code locations only, so every field is pattern-checked and nothing free-form can ride
 * along. The server Sentry scrubber in `src/sentry.server.config.ts` runs over the event again.
 */
const frameSchema = z
  .object({
    filename: z.string().regex(/^\/_next\/[\w\-./~%@[\]]{1,300}$/),
    function: z
      .string()
      .regex(/^[\w$.<>[\] ]{1,200}$/)
      .optional(),
    lineno: z.number().int().min(0).max(10_000_000).optional(),
    colno: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();

export const clientErrorReportSchema = z
  .object({
    type: z.string().regex(/^[A-Za-z]{1,40}$/),
    mechanism: z.enum(["onerror", "onunhandledrejection"]),
    section: z.string().regex(/^\/(?:[a-z0-9-]{1,40})?$/),
    frames: z.array(frameSchema).min(1).max(CLIENT_ERROR_MAX_FRAMES),
  })
  .strict();

export type ValidClientErrorReport = z.infer<typeof clientErrorReportSchema>;

export const CLIENT_ERROR_BODY_LIMIT_BYTES = 16 * 1024;
const WINDOW_MS = 60_000;
const PER_CLIENT_LIMIT = 10;
const GLOBAL_LIMIT = 120;

// In memory and per instance on purpose: a lost count only means a few more or fewer reports,
// and a database bucket would add a write to every report.
const windows = new Map<string, { startedAt: number; count: number }>();

/** At most 10 reports a minute from one address and 120 a minute in all. */
export function allowClientErrorReport(clientKey: string, now = Date.now()): boolean {
  if (windows.size > 5_000) windows.clear();
  const take = (key: string, limit: number) => {
    const current = windows.get(key);
    if (!current || now - current.startedAt >= WINDOW_MS) {
      windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
  return take("global", GLOBAL_LIMIT) && take(`client:${clientKey}`, PER_CLIENT_LIMIT);
}

export function resetClientErrorRateLimitForTests() {
  windows.clear();
}

/** The Sentry event for a validated report, tagged so the scrubber labels it a browser error. */
export function clientErrorSentryEvent(report: ValidClientErrorReport) {
  return {
    level: "error" as const,
    platform: "javascript",
    exception: {
      values: [
        {
          type: report.type,
          mechanism: { type: report.mechanism, handled: false },
          stacktrace: { frames: report.frames.map((frame) => ({ ...frame, in_app: true })) },
        },
      ],
    },
    tags: { service: "browser", route_path: report.section },
  };
}
