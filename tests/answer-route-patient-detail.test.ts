import { describe, expect, it, vi } from "vitest";

/**
 * The answer routes refuse a question that looks like it holds a patient detail, before any
 * retrieval, rate limiting or generation runs (audit S2, 2026-10-13). Demo mode is the
 * cheapest route body to reach: the check runs ahead of it, so a refused question never
 * reaches even the synthetic answer.
 */

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => true,
}));

const { POST: answerPost } = await import("@/app/api/answer/route");
const { POST: streamPost } = await import("@/app/api/answer/stream/route");

function answerRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.each([
  ["/api/answer", answerPost],
  ["/api/answer/stream", streamPost],
] as const)("%s patient-detail check", (path, post) => {
  it("refuses a question holding a patient detail with a 400 and a plain message", async () => {
    const response = await post(answerRequest(`http://localhost${path}`, { query: "Mr Smith lithium level 1.4" }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; code?: string };
    expect(payload.code).toBe("patient_detail_in_question");
    expect(payload.error).toMatch(/^This question looks like it holds a patient detail/);
    expect(payload.error).not.toContain("Smith");
  });

  it("lets an ordinary clinical question through", async () => {
    const response = await post(
      answerRequest(`http://localhost${path}`, { query: "lithium dose for 70 year old with CKD" }),
    );
    expect(response.status).toBe(200);
  });
});
