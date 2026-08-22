import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCanaryTokens, findCanaryLeaks } from "../scripts/rag-adversarial-contract.mjs";
import { summarizeGenerationQualityAnswerShape } from "../src/lib/rag/rag-generation-quality-diagnostics";

type TelemetryModule = typeof import("../src/lib/rag/rag-answer-telemetry-metadata");
type TimingsArg = Parameters<TelemetryModule["extendedAnswerTelemetryFields"]>[0];

// Packet B1 (docs/rag-improvement/README.md §B1, data-flow register "known gaps"): the
// canary-absence proof that telemetry emitted to rag_queries.metadata can never carry the
// PHI-like canary tokens registered by the adversarial fixture dataset — even when the
// input object is deliberately contaminated with them.
const dataset = JSON.parse(readFileSync("scripts/fixtures/rag-adversarial-cases.v1.json", "utf8"));
const canaryTokens: string[] = collectCanaryTokens(dataset);
const interactionId = "33333333-3333-4333-8333-333333333333";

function contaminatedTimings(): TimingsArg {
  const timings: Record<string, unknown> = {
    total_latency_ms: 1234,
    // A canary string sitting under an allow-listed key must be dropped, not emitted.
    verification_latency_ms: canaryTokens[0],
  };
  for (const [index, token] of canaryTokens.entries()) {
    // Canary values under non-allow-listed keys, and canary tokens as keys themselves.
    timings[`contaminated_note_${index}`] = token;
    timings[token] = index;
  }
  return timings as TimingsArg;
}

async function loadTelemetryModule(flag: "true" | "false"): Promise<TelemetryModule> {
  // src/lib/env.ts freezes process.env at module load; re-parse after stubbing.
  vi.resetModules();
  vi.stubEnv("RAG_TELEMETRY_EXTENDED", flag);
  return await import("../src/lib/rag/rag-answer-telemetry-metadata");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("B1 telemetry canary absence", () => {
  it("loads a non-empty canary registry from the adversarial dataset", () => {
    expect(canaryTokens.length).toBeGreaterThanOrEqual(4);
  });

  it("flag off (default): emits exactly the legacy three fields even from contaminated input", async () => {
    const { answerLatencyMetadata, answerProgrammeTelemetryMetadata, extendedAnswerTelemetryFields } =
      await loadTelemetryModule("false");
    expect(extendedAnswerTelemetryFields(contaminatedTimings())).toEqual({});
    const emitted = answerLatencyMetadata(120, 340, contaminatedTimings(), Date.now());
    expect(Object.keys(emitted)).toEqual(["search_latency_ms", "generation_latency_ms", "total_latency_ms"]);
    expect(findCanaryLeaks(JSON.stringify(emitted), canaryTokens)).toEqual([]);
    expect(
      answerProgrammeTelemetryMetadata(
        { interactionId, rolloutMode: "legacy" },
        {
          grounded: false,
          confidence: "unsupported",
          sources: [],
          routingReason: canaryTokens[0],
          fallbackReason: canaryTokens[1],
        },
      ),
    ).toEqual({ interaction_id: interactionId });
  });

  it("rejects a non-UUID interaction join before either flag state can persist it", async () => {
    const { answerProgrammeTelemetryMetadata } = await loadTelemetryModule("false");
    expect(() =>
      answerProgrammeTelemetryMetadata(
        { interactionId: "patient-name-canary", rolloutMode: "legacy" },
        { grounded: true, confidence: "high", sources: [] },
      ),
    ).toThrow("opaque UUID interaction ID");
  });

  it("flag on: admits only finite numbers under allow-listed keys, so canaries cannot pass", async () => {
    const { answerLatencyMetadata, extendedAnswerTelemetryFields, EXTENDED_ANSWER_TELEMETRY_ALLOWLIST } =
      await loadTelemetryModule("true");

    // Contaminated input: the canary under an allow-listed key is a string, so it is dropped.
    expect(extendedAnswerTelemetryFields(contaminatedTimings())).toEqual({});
    // Non-finite numbers are dropped too.
    expect(extendedAnswerTelemetryFields({ verification_latency_ms: Number.NaN } as TimingsArg)).toEqual({});
    // A genuine measurement passes.
    expect(extendedAnswerTelemetryFields({ verification_latency_ms: 42 } as TimingsArg)).toEqual({
      verification_latency_ms: 42,
    });

    const emitted = answerLatencyMetadata(120, 340, contaminatedTimings(), Date.now());
    expect(findCanaryLeaks(JSON.stringify(emitted), canaryTokens)).toEqual([]);
    const allowedKeys = new Set([
      "search_latency_ms",
      "generation_latency_ms",
      "total_latency_ms",
      ...EXTENDED_ANSWER_TELEMETRY_ALLOWLIST,
    ]);
    for (const key of Object.keys(emitted)) expect(allowedKeys.has(key)).toBe(true);
  });

  it("flag on: a clean timings object emits the extended field alongside the legacy three", async () => {
    const { answerLatencyMetadata, answerProgrammeTelemetryMetadata } = await loadTelemetryModule("true");
    const emitted = answerLatencyMetadata(
      120,
      340,
      { total_latency_ms: 500, verification_latency_ms: 17 } as TimingsArg,
      Date.now(),
    );
    expect(emitted).toEqual({
      search_latency_ms: 120,
      generation_latency_ms: 340,
      total_latency_ms: 500,
      verification_latency_ms: 17,
    });

    const programmeMetadata = answerProgrammeTelemetryMetadata(
      { interactionId, rolloutMode: "shadow" },
      {
        grounded: false,
        confidence: "unsupported",
        sources: [],
        routingReason: canaryTokens[0],
        fallbackReason: canaryTokens[1],
      },
    );
    expect(programmeMetadata).toMatchObject({
      version: "rag-programme-telemetry-v1",
      interaction_id: interactionId,
      rollout_mode: "shadow",
      insufficiency_reason: "retrieval_miss",
    });
    expect(findCanaryLeaks(JSON.stringify(programmeMetadata), canaryTokens)).toEqual([]);
  });

  it("generation-quality answer shape (PR #1899) never carries canary text", () => {
    const shape = summarizeGenerationQualityAnswerShape({
      answer: `Contact ${canaryTokens.join(" or ")} for the record.`,
      grounded: false,
      confidence: "low",
      answerSections: [{ body: canaryTokens[0] ?? "" }],
      citations: [],
      quoteCards: [],
      conflictsOrGaps: [canaryTokens[1] ?? canaryTokens[0] ?? ""],
      unverifiedNumericTokens: [],
    });
    expect(findCanaryLeaks(JSON.stringify(shape), canaryTokens)).toEqual([]);
  });
});
