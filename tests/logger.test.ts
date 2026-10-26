import { afterEach, describe, expect, it, vi } from "vitest";
import { redactLogContext } from "../src/lib/logger";

describe("redactLogContext", () => {
  it("redacts values under sensitive keys", () => {
    const out = redactLogContext({
      status: 500,
      authorization: "Bearer secret-token",
      serviceRoleKey: "sb_secret_abc",
      email: "patient@example.com",
      query: "56yo male with psychosis on 12mg haloperidol",
      answer: "clinical answer text",
      name: "Error",
    });

    expect(out.status).toBe(500);
    expect(out.name).toBe("Error");
    expect(out.authorization).toBe("[redacted]");
    expect(out.serviceRoleKey).toBe("[redacted]");
    expect(out.email).toBe("[redacted]");
    expect(out.query).toBe("[redacted]");
    expect(out.answer).toBe("[redacted]");
  });

  it("redacts camelCase and snake_case query / answer / question keys, not just the bare words (L1)", () => {
    // `_` and letters are word characters, so a `\b`-anchored `query` matched the
    // bare key only; the most natural spellings of a clinical query or answer
    // field passed straight through the redaction layer that promises
    // call-site-independent protection.
    const clinical = "56yo male with psychosis on 12mg haloperidol";
    const out = redactLogContext({
      queryText: clinical,
      query_text: clinical,
      rawQuery: clinical,
      normalizedQuery: clinical,
      question: clinical,
      answerText: "clinical answer text",
      answer_text: "clinical answer text",
      queryMode: "clinical",
      status: 200,
      requestId: "req-1",
    });

    for (const key of [
      "queryText",
      "query_text",
      "rawQuery",
      "normalizedQuery",
      "question",
      "answerText",
      "answer_text",
    ]) {
      expect(out[key], key).toBe("[redacted]");
    }
    // Over-redaction of a mode/class label is the accepted cost; operational
    // keys that do not carry the words stay readable.
    expect(out.queryMode).toBe("[redacted]");
    expect(out.status).toBe(200);
    expect(out.requestId).toBe("req-1");
  });

  it("redacts nested sensitive keys", () => {
    const out = redactLogContext({ details: { apiKey: "k", code: "P0001" } }) as {
      details: Record<string, unknown>;
    };
    expect(out.details.apiKey).toBe("[redacted]");
    expect(out.details.code).toBe("P0001");
  });

  it("truncates very long strings", () => {
    const out = redactLogContext({ stack: "x".repeat(2000) });
    expect(String(out.stack)).toContain("[truncated]");
    expect(String(out.stack).length).toBeLessThan(600);
  });

  it("serializes Error values to name and message", () => {
    const out = redactLogContext({ cause: new Error("boom") }) as { cause: Record<string, unknown> };
    expect(out.cause).toMatchObject({ name: "Error", message: "boom" });
  });

  it("redacts sensitive value patterns under arbitrary key names", () => {
    const out = redactLogContext({
      extra: "Patient record: MRN 12345678",
      notes: "NHS: 987 654 3210",
      normal: "Standard operational log line",
    });
    expect(out.extra).toBe("[redacted]");
    expect(out.notes).toBe("[redacted]");
    expect(out.normal).toBe("Standard operational log line");
  });
});

describe("logger stdout lines", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("keeps the event name and level when the context carries the same keys", async () => {
    // The logger is silent under NODE_ENV=test, so stub it the way the Sentry bridge test does.
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../src/lib/logger");
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => lines.push(line));

    logger.error("API request failed", { message: "relation does not exist", level: "info", status: 500 });

    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed.message).toBe("API request failed");
    expect(parsed.level).toBe("error");
    expect(parsed.contextMessage).toBe("relation does not exist");
    expect(parsed.contextLevel).toBe("info");
    expect(parsed.status).toBe(500);
  });
});
