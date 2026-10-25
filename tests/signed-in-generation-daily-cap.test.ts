import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRateLimitUnavailableError,
  SIGNED_IN_GENERATION_DAILY_BUCKET,
  SIGNED_IN_GENERATION_DAILY_CAP,
  SIGNED_IN_GENERATION_DAILY_CODE,
  consumeSubjectApiRateLimit,
  consumeSummaryRateLimits,
  rateLimitJsonResponse,
  signedInGenerationDailySubjectKey,
} from "@/lib/api-rate-limit";

type RpcArgs = {
  p_owner_id?: string;
  p_subject_key?: string;
  p_bucket?: string;
  p_limit?: number;
  p_window_seconds?: number;
};

const owner = { kind: "owner", ownerId: "owner-daily" } as const;
const dailyKey = signedInGenerationDailySubjectKey(owner.ownerId);

/** Answers every rate-limit RPC, `limited` only for the keys named, and records the calls. */
function limiterStub(limited: { perMinute?: boolean; daily?: boolean } = {}) {
  const calls: Array<{ name: string; args: RpcArgs }> = [];
  const rpc = vi.fn(async (name: string, args: RpcArgs) => {
    calls.push({ name, args });
    const isDaily = name === "consume_api_subject_rate_limit" && args.p_subject_key === dailyKey;
    const isLimited = isDaily ? Boolean(limited.daily) : Boolean(limited.perMinute);
    return {
      data: {
        limited: isLimited,
        limit_value: args.p_limit ?? 0,
        remaining: isLimited ? 0 : (args.p_limit ?? 0) - 1,
        retry_after_seconds: args.p_window_seconds ?? 60,
        reset_at: new Date(Date.now() + (args.p_window_seconds ?? 60) * 1000).toISOString(),
        ...(name === "consume_summary_rate_limits_atomic" ? { bucket: "document_summarize" } : {}),
      },
      error: null,
    };
  });
  return { supabase: { rpc } as never, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signed-in daily generation cap (SEC-N2)", () => {
  it.each(["answer", "clinical_ask", "speech_transcription"] as const)(
    "%s consumes the per-minute bucket and the shared per-account daily row",
    async (bucket) => {
      const { supabase, calls } = limiterStub();
      const result = await consumeSubjectApiRateLimit({ supabase, subject: owner, bucket });

      expect(result.limited).toBe(false);
      expect(calls.map((call) => call.name).sort()).toEqual([
        "consume_api_rate_limit",
        "consume_api_subject_rate_limit",
      ]);
      const daily = calls.find((call) => call.name === "consume_api_subject_rate_limit")?.args;
      expect(daily).toMatchObject({
        p_subject_key: dailyKey,
        p_bucket: SIGNED_IN_GENERATION_DAILY_BUCKET,
        p_limit: SIGNED_IN_GENERATION_DAILY_CAP.limit,
        p_window_seconds: SIGNED_IN_GENERATION_DAILY_CAP.windowSeconds,
      });
    },
  );

  it("counts streamed document summaries against the same daily row", async () => {
    const { supabase, calls } = limiterStub({ daily: true });
    const decision = await consumeSummaryRateLimits({ supabase, subject: owner });

    expect(calls.map((call) => call.name)).toEqual([
      "consume_summary_rate_limits_atomic",
      "consume_api_subject_rate_limit",
    ]);
    expect(calls[1]?.args).toMatchObject({ p_subject_key: dailyKey, p_bucket: SIGNED_IN_GENERATION_DAILY_BUCKET });
    expect(decision.rateLimit.limited).toBe(true);
    expect(decision.rateLimit.scope).toBe("signed_in_generation_daily");
  });

  it("does not spend the daily allowance on a summary the per-minute buckets refuse", async () => {
    const { supabase, calls } = limiterStub({ perMinute: true });
    const decision = await consumeSummaryRateLimits({ supabase, subject: owner });

    expect(decision.rateLimit.limited).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["consume_summary_rate_limits_atomic"]);
  });

  it("leaves non-generation buckets on the per-minute bucket alone", async () => {
    const { supabase, calls } = limiterStub();
    await consumeSubjectApiRateLimit({ supabase, subject: owner, bucket: "search" });
    expect(calls.map((call) => call.name)).toEqual(["consume_api_rate_limit"]);
  });

  it("refuses over the daily cap with its own code and message", async () => {
    const { supabase } = limiterStub({ daily: true });
    const result = await consumeSubjectApiRateLimit({ supabase, subject: owner, bucket: "answer" });

    expect(result.limited).toBe(true);
    expect(result.scope).toBe("signed_in_generation_daily");
    const response = rateLimitJsonResponse("Too many answer requests. Retry shortly.", result, { bucket: "answer" });
    expect(response.status).toBe(429);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe(SIGNED_IN_GENERATION_DAILY_CODE);
    expect(body.message).toMatch(/daily limit/i);
  });

  it("reports the per-minute refusal first when both refuse", async () => {
    const { supabase } = limiterStub({ perMinute: true, daily: true });
    const result = await consumeSubjectApiRateLimit({ supabase, subject: owner, bucket: "answer" });
    expect(result.limited).toBe(true);
    expect(result.scope).toBeUndefined();
  });

  it("fails closed in production when the daily row cannot be read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const rpc = vi.fn(async (name: string) =>
      name === "consume_api_subject_rate_limit"
        ? { data: null, error: { code: "unavailable" } }
        : {
            data: { limited: false, limit_value: 30, remaining: 29, retry_after_seconds: 60, reset_at: "2099-01-01" },
            error: null,
          },
    );
    await expect(
      consumeSubjectApiRateLimit({
        supabase: { rpc } as never,
        subject: owner,
        bucket: "answer",
        allowInMemoryFallbackOnUnavailable: true,
      }),
    ).rejects.toBeInstanceOf(ApiRateLimitUnavailableError);
  });
});
