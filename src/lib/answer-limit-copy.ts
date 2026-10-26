/**
 * Plain words for an answer that cannot run right now because of a limit, shared by the dashboard
 * answer and Clinical Ask. Before this the screen offered Retry at the daily cap and counted the wait
 * in seconds ("Try again in 86400 seconds"), design audit D26-09 and D26-10.
 */

/** The 429 code a signed-in account's daily generation cap answers with (`api-rate-limit.ts`). */
export const ANSWER_DAILY_LIMIT_CODE = "generation_daily_cap";

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function clockTime(date: Date) {
  return date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

/** "from 7:40 pm", "from 7:40 am tomorrow", or null when the wait is unknown. */
export function answerLimitResumeTime(retryAfterMs: number | null | undefined, now = Date.now()): string | null {
  if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return null;
  const resume = new Date(now + retryAfterMs);
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (sameLocalDay(resume, today)) return `from ${clockTime(resume)}`;
  if (sameLocalDay(resume, tomorrow)) return `from ${clockTime(resume)} tomorrow`;
  return null;
}

export function answerDailyLimitMessage(retryAfterMs: number | null | undefined, now = Date.now()): string {
  const resume = answerLimitResumeTime(retryAfterMs, now);
  return `You've used today's answers. ${
    resume ? `You can ask again ${resume}.` : "You can ask again later."
  } Search, the library and every tool still work.`;
}

/** A short burst limit, not the daily cap: the wait is seconds to minutes, never a raw count. */
export function answerBurstLimitMessage(retryAfterMs: number | null | undefined): string {
  const minutes =
    typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.ceil(retryAfterMs / 60_000)
      : null;
  const wait = minutes && minutes > 1 ? `about ${minutes} minutes` : "a minute";
  return `Too many questions in a short time. Wait ${wait}, then try again.`;
}
