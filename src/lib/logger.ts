// Lightweight structured logger with redaction (plan item 1.2). API routes log
// operational context (status, error name, request id) but must never emit secrets
// or patient-identifying text (clinical query/answer content, emails). Values under
// sensitive keys are redacted and long strings truncated before serialization.

type LogLevel = "debug" | "info" | "warn" | "error";

const REDACTED = "[redacted]";
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 5;

// Keys whose values may carry secrets or PII. Matched case-insensitively as substrings.
// `query`, `question` and `answer` are deliberately unanchored: `_` and letters are
// word characters, so a `\b`-bounded `query` matched the bare key only and let
// `queryText`, `query_text`, `rawQuery`, `normalizedQuery`, `answerText` and
// `answer_text` through. Over-redacting a `queryMode`-style label is the accepted
// cost of a redaction layer that does not depend on call-site discipline.
const SENSITIVE_KEY =
  /authorization|cookie|token|secret|api[-_]?key|password|service[-_]?role|email|query|question|prompt|\bcontent\b|answer|patient|\bmrn\b/i;

const SENSITIVE_VALUE_PATTERN = /\b(?:mrn|ur|unit\s*no\.?)\s*[:#]?\s*\d{6,10}\b|\b\d{3}\s\d{3}\s\d{4}\b/i;

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_PATTERN.test(value)) return REDACTED;
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[depth-limited]";
  if (value instanceof Error) return { name: value.name, message: redactValue(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function redactLogContext(context: Record<string, unknown>): Record<string, unknown> {
  return redactValue(context, 0) as Record<string, unknown>;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// This module is server-oriented, but bundlers that reach it from a shared module
// (or a standalone bundle such as the design-system export) inline it into browser
// code, where a bare `process.env` read throws ReferenceError and unmounts the
// React tree. Read the environment defensively instead of assuming Node.
function env(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function activeLevel(): LogLevel {
  const configured = env().LOG_LEVEL?.toLowerCase();
  if (configured && configured in LEVEL_RANK) return configured as LogLevel;
  return env().NODE_ENV === "production" ? "info" : "debug";
}

type SentryLogForwarder = (level: "warn" | "error", message: string, context?: Record<string, unknown>) => void;

/**
 * WHY A GLOBAL AND NOT A MODULE-LOCAL `let`.
 *
 * Next bundles `instrumentation.ts` — which loads `sentry.server.config.ts` and is the only thing
 * that registers this bridge — separately from route handlers. The two can therefore hold
 * different instances of this module: the registration lands on one copy, and every `logger.warn`
 * and `logger.error` in a route reads the other, where the forwarder is still `null`. Nothing
 * throws, nothing warns, and the logs simply never leave the process.
 *
 * MEASURED 2026-09-18 against the live project. Thirty days of Sentry Logs contained exactly two
 * distinct messages — "API rate limit durable check unavailable" (165) and "API rate limited" (3)
 * — both emitted by direct `sentryLog.*` calls from `api-rate-limit.ts`, which do not use this
 * bridge. There were zero "Application error", zero "Application warn" and zero "API request
 * failed": the three messages only this bridge can produce. So it had never delivered a single log
 * in production. Every deliberate `logger.error` in the application was invisible, including
 * `jsonError`'s "API request failed" and the catalogue fallback's alarm — the one whose own header
 * insists that "falling back MUST be loud" because a silent degradation cost seven days in
 * September.
 *
 * A `Symbol.for` key on `globalThis` is shared by every copy of this module in the process, so
 * registration survives however the bundler splits it. Keep it: a module-local binding here is
 * correct-looking and does not work.
 */
const SENTRY_LOG_FORWARDER_KEY = Symbol.for("psychsift.logger.sentryLogForwarder");

type ForwarderHost = { [SENTRY_LOG_FORWARDER_KEY]?: SentryLogForwarder | null };

function currentSentryLogForwarder(): SentryLogForwarder | null {
  return (globalThis as ForwarderHost)[SENTRY_LOG_FORWARDER_KEY] ?? null;
}

/**
 * Register a Sentry Logs bridge from server instrumentation after `Sentry.init`.
 * Kept as a callback so this module never imports `@sentry/nextjs` (bundler-safe).
 */
export function registerSentryLogForwarder(forwarder: SentryLogForwarder | null) {
  (globalThis as ForwarderHost)[SENTRY_LOG_FORWARDER_KEY] = forwarder;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  // Keep tests quiet; they assert on responses, not log output.
  if (env().NODE_ENV === "test") return;
  if (LEVEL_RANK[level] < LEVEL_RANK[activeLevel()]) return;
  const safeMessage = typeof message === "string" ? (redactValue(message, 0) as string) : String(message);
  const redacted = context ? redactLogContext(context) : undefined;
  const line = JSON.stringify({
    level,
    message: safeMessage,
    timestamp: new Date().toISOString(),
    ...(redacted ?? {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // Forward warn/error to privacy-scrubbed Sentry Logs when instrumentation registered a bridge.
  const forwarder = currentSentryLogForwarder();
  if ((level === "warn" || level === "error") && forwarder) {
    try {
      forwarder(level, safeMessage, redacted);
    } catch {
      // Optional observability must never interfere with request handling.
    }
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
