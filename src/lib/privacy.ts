export function safeIngestionJobLog(jobId: string) {
  return `Processing ingestion job ${jobId}`;
}

/** Redact paths, URLs, secrets, and emails from support/diagnostic strings. */
export function redactLogValue(value: unknown): unknown {
  if (typeof value !== "string") {
    // Audit L12: non-string code/details/hint fields (objects/arrays from
    // non-standard error shapes) used to pass through verbatim, skipping the
    // path/url/secret/email redaction below. Serialize them (guarded) and
    // redact the serialized form; primitives stay as-is.
    if (value === null || value === undefined) return value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    try {
      return redactLogValue(JSON.stringify(value) ?? "[unserializable]");
    } catch {
      return "[unserializable]";
    }
  }
  const htmlTitle = value.match(/<title>\s*([^<]+?)\s*<\/title>/i)?.[1]?.trim();
  const normalizedValue = htmlTitle ? `HTML response: ${htmlTitle}` : value;
  return (
    normalizedValue
      // URLs before path shapes so https://host/path?q=… becomes [url], not https:[path]
      // with a residual query string. The class excludes whitespace and the DOUBLE
      // quote only. Two things depend on that exact set:
      //   - parentheses and apostrophes stay consumed. encodeURIComponent escapes
      //     neither, so `?q=patient's suicidal thoughts` is a realistic clinical
      //     query; excluding `'` left `[url]'s%20suicidal%20thoughts` in the
      //     clipboard, which is the leak this redaction exists to prevent.
      //   - stopping at `"` keeps a serialized object readable. Non-string fields
      //     are JSON-stringified above and compact JSON has no spaces, so a
      //     `\S+` class would swallow every field after the first URL.
      // Over-consuming a trailing `'` in JS-style single-quoted log output is the
      // safe direction: it redacts slightly more, never less.
      .replace(/https?:\/\/[^\s"]+/g, "[url]")
      .replace(/\b[A-Za-z]:\\[^\s'\")]+/g, "[path]")
      .replace(/\/(?:[^\s'\")]+\/)+[^\s'\")]+/g, "[path]")
      // Redact common secret/token formats, including modern Supabase keys like sb_secret_ and sb_publishable_
      .replace(/\b(?:sk|pk|sbp|sb_secret_|sb_publishable_|eyJ)[A-Za-z0-9._-]{8,}\b/g, "[secret]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
      .slice(0, 500)
  );
}

export function safeErrorLogDetails(error: unknown) {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : record.message;
  const stack = error instanceof Error ? error.stack : typeof record.stack === "string" ? record.stack : null;
  const errorName = error instanceof Error ? error.name : typeof error;
  const firstStackLine = stack
    ?.split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !line.startsWith("Error:") &&
        !line.startsWith(`${errorName}:`) &&
        !/^<(!doctype|html|head|body|!--)/i.test(line),
    );

  return {
    name: errorName,
    ...(message ? { message: redactLogValue(message) } : {}),
    ...(record.code ? { code: redactLogValue(record.code) } : {}),
    ...(record.details ? { details: redactLogValue(record.details) } : {}),
    ...(record.hint ? { hint: redactLogValue(record.hint) } : {}),
    ...(firstStackLine ? { stack: redactLogValue(firstStackLine) } : {}),
  };
}

/**
 * Message-free diagnostics for a fatal worker crash. Reports only the error name, a string
 * `code`, the constructor name, and the file:line of the first stack frame under /app/dist or
 * /app/worker. The message text and full stack are never included. The message is also stripped
 * from the stack before frames are scanned, so a multi-line message cannot masquerade as a frame.
 */
export function startupCrashLogDetails(error: unknown): {
  name?: string;
  code?: string;
  constructorName?: string;
  frame?: string;
} {
  try {
    const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
    const bounded = (value: string) => String(redactLogValue(value.slice(0, 100)));
    const name = typeof record.name === "string" ? bounded(record.name) : undefined;
    const code = typeof record.code === "string" ? bounded(record.code) : undefined;
    const ctor = record.constructor;
    const constructorName =
      typeof ctor === "function" && typeof ctor.name === "string" ? bounded(ctor.name) : undefined;

    let stack = typeof record.stack === "string" ? record.stack : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (message) {
      const index = stack.indexOf(message);
      if (index >= 0) stack = stack.slice(index + message.length);
    }
    let frame: string | undefined;
    for (const line of stack.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("at ")) continue;
      const match = trimmed.match(/(\/app\/(?:dist|worker)[^\s()]*?):(\d+)(?::\d+)?\)?$/);
      if (match) {
        frame = `${match[1]}:${match[2]}`;
        break;
      }
    }
    return {
      ...(name ? { name } : {}),
      ...(code ? { code } : {}),
      ...(constructorName ? { constructorName } : {}),
      ...(frame ? { frame } : {}),
    };
  } catch {
    // Error-like objects can have throwing getters. Reporting must not prevent cleanup.
    return {};
  }
}

/**
 * Diagnostics for upload failures and fatal alerts must not contain free text.
 * A filename, person's name or provider response need not match a redaction
 * pattern to be sensitive. Preserve only fixed error classes and known codes.
 */
export function contentFreeErrorDetails(error: unknown): {
  errorType: string;
  errorCode?: string;
  status?: number;
} {
  const errorTypes = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "URIError",
    "EvalError",
    "AbortError",
    "TimeoutError",
    "WorkerAbortError",
  ]);
  const errorCodes = new Set([
    "23502",
    "23503",
    "23505",
    "42501",
    "42703",
    "42P01",
    "57014",
    "P0001",
    "PGRST116",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
  ]);
  try {
    const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
    const errorType = typeof record.name === "string" && errorTypes.has(record.name) ? record.name : "UnknownError";
    const errorCode = typeof record.code === "string" && errorCodes.has(record.code) ? record.code : undefined;
    const status =
      typeof record.status === "number" &&
      Number.isInteger(record.status) &&
      record.status >= 100 &&
      record.status <= 599
        ? record.status
        : undefined;
    return { errorType, ...(errorCode ? { errorCode } : {}), ...(status ? { status } : {}) };
  } catch {
    // Error-like objects can have throwing getters. Reporting must not prevent cleanup.
    return { errorType: "UnknownError" };
  }
}

export function redactCaptionIdentifiers(value: string): string {
  const clinicalRangePattern = /^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:\s*[A-Za-zµ/%][\w/%.-]*)?$/i;
  return value
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b(?:mrn|nhs)\s*[:#-]?\s*([0-9]+(?:[ \-][0-9]+)+|[A-Za-z0-9-]{4,})\b/gi, (match, idPart: string) => {
      const trimmed = idPart.replace(/\s+/g, " ").trim();
      // Count digits only; require at least 4 digits to consider it an identifier (avoids short numeric ranges).
      const digitCount = trimmed.replace(/\D/g, "").length;
      if (digitCount > 0 && digitCount < 4) return match;
      return "[id]";
    })
    .replace(/\b(?:\+?\d[\d\s().-]{6,}\d)\b/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 8 && !clinicalRangePattern.test(match.trim()) ? "[phone]" : match;
    });
}
