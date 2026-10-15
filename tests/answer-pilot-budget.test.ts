import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTicket: vi.fn(),
  createGuard: vi.fn(),
  reserve: vi.fn(),
  responsesCreate: vi.fn(),
  withOptions: vi.fn(),
}));

vi.mock("@/lib/answer-pilot-ticket", () => ({ loadServerAnswerPilotTicket: mocks.loadTicket }));
vi.mock("@/lib/answer-wire-budget-guard", () => ({ createWireBudgetGuard: mocks.createGuard }));
vi.mock("@/lib/answer-pilot-diagnostic", () => ({
  answerPilotDiagnosticSources: vi.fn(),
  answerPilotResponseMatches: vi.fn(),
  prepareAnswerPilotGeneration: vi.fn(),
  prepareAnswerPilotGenerationSeed: vi.fn(),
  createAnswerPilotDiagnostic: () => null,
}));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: mocks.responsesCreate };
    withOptions(options: unknown) {
      mocks.withOptions(options);
      return this;
    }
  },
}));

import { currentAnswerPilotBudget, runAnswerWithPilotBudget } from "../src/lib/answer-pilot-budget";

const query = "Synthetic pilot question";
const ticket = {
  ownerId: "pilot-owner",
  documentId: "pilot-document",
  querySha256: createHash("sha256").update(query).digest("hex"),
  onReserve: mocks.reserve,
  remainingUsd: "6.000000",
  verifiedPriceTableRef: "synthetic-price-card",
  prices: {},
  maxSerializedJsonBytes: 262144,
};
const exactRequest = {
  ownerId: ticket.ownerId,
  documentId: ticket.documentId,
  query,
  summaryMode: false,
  activeFilterCount: 0,
  queryMode: "auto",
  resolvedDocumentIds: [ticket.documentId],
};
const unrelatedRequest = {
  ...exactRequest,
  ownerId: "other-owner",
  documentId: "other-document",
  query: "Different synthetic question",
  resolvedDocumentIds: ["other-document"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadTicket.mockResolvedValue(ticket);
  mocks.reserve.mockResolvedValue(undefined);
  mocks.createGuard.mockImplementation(({ onReserve }) => ({
    fetch: vi.fn(async () => {
      await onReserve({ endpoint: "embeddings" });
      return new Response("{}");
    }),
    snapshot: () => ({ denied: false }),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("controlled Answer pilot request scope", () => {
  it.each([
    { documentId: undefined, activeFilterCount: 1, resolvedDocumentIds: [ticket.documentId] },
    { documentId: "other-document", resolvedDocumentIds: ["other-document", ticket.documentId] },
  ])("refuses a resolved pilot source before answer work: %j", async (scope) => {
    const answerWork = vi.fn();
    await expect(runAnswerWithPilotBudget({ ...unrelatedRequest, ...scope }, answerWork)).rejects.toMatchObject({
      details: { code: "answer_pilot_identity_mismatch" },
    });
    expect(answerWork).not.toHaveBeenCalled();
    expect(mocks.createGuard).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("runs the exact request inside the reserved transport scope and clears it afterwards", async () => {
    const answerWork = vi.fn(async () => {
      const budget = currentAnswerPilotBudget();
      expect(budget).not.toBeNull();
      await budget!.fetch("https://example.invalid/mock");
      return "guarded answer";
    });
    await expect(runAnswerWithPilotBudget(exactRequest, answerWork)).resolves.toBe("guarded answer");
    expect(answerWork).toHaveBeenCalledOnce();
    expect(mocks.createGuard).toHaveBeenCalledOnce();
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith({ endpoint: "embeddings" });
    expect(currentAnswerPilotBudget()).toBeNull();
  });

  it("runs an unrelated request through ordinary answer work", async () => {
    const answerWork = vi.fn(() => {
      expect(currentAnswerPilotBudget()).toBeNull();
      return "ordinary answer";
    });
    await expect(runAnswerWithPilotBudget(unrelatedRequest, answerWork)).resolves.toBe("ordinary answer");
    expect(answerWork).toHaveBeenCalledOnce();
    expect(mocks.createGuard).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each([
    { ...unrelatedRequest, ownerId: ticket.ownerId, summaryMode: true },
    { ...unrelatedRequest, documentId: ticket.documentId },
    { ...unrelatedRequest, query },
    { ...exactRequest, activeFilterCount: 1 },
    { ...exactRequest, queryMode: "other" },
    { ...exactRequest, resolvedDocumentIds: undefined },
  ])("preserves near-match refusal: %j", async (request) => {
    const answerWork = vi.fn();
    await expect(runAnswerWithPilotBudget(request, answerWork)).rejects.toMatchObject({
      details: { code: "answer_pilot_identity_mismatch" },
    });
    expect(answerWork).not.toHaveBeenCalled();
  });

  it.each([exactRequest, unrelatedRequest])("still refuses loader failure for %j", async (request) => {
    mocks.loadTicket.mockRejectedValueOnce(new Error("answer_pilot_ticket_invalid"));
    const answerWork = vi.fn();
    await expect(runAnswerWithPilotBudget(request, answerWork)).rejects.toMatchObject({
      details: { code: "answer_pilot_ticket_load_failed" },
    });
    expect(answerWork).not.toHaveBeenCalled();
    expect(mocks.createGuard).not.toHaveBeenCalled();
  });

  it("keeps the absent-ticket ordinary path", async () => {
    mocks.loadTicket.mockResolvedValueOnce(null);
    const answerWork = vi.fn(() => "ordinary answer");
    await expect(runAnswerWithPilotBudget(exactRequest, answerWork)).resolves.toBe("ordinary answer");
    expect(mocks.createGuard).not.toHaveBeenCalled();
  });
});

describe("controlled Answer pilot SDK request storage", () => {
  it("forces store false only inside the pilot, preserving ordinary env and explicit options", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    vi.stubEnv("OPENAI_STORE_RESPONSES", "true");
    mocks.responsesCreate.mockImplementation(() => ({
      withResponse: async () => ({
        data: { status: "completed", output_text: '{"answer":"synthetic"}' },
        request_id: "synthetic-request",
      }),
    }));
    const { generateStructuredTextResult } = await import("../src/lib/openai");
    const generate = (store?: boolean) =>
      generateStructuredTextResult(
        "Synthetic question",
        { type: "object", properties: {}, required: [] },
        {
          model: "gpt-5.6-terra",
          operation: "answer",
          store,
        },
      );

    await generate();
    await runAnswerWithPilotBudget(exactRequest, () => generate());
    await runAnswerWithPilotBudget(exactRequest, () => generate(true));
    await generate(true);
    await generate(false);
    await generate();

    const bodies = mocks.responsesCreate.mock.calls.map(([body]) => body);
    expect(bodies.map((body) => body.store)).toEqual([true, false, false, true, false, true]);
    expect(bodies[1]).toMatchObject({ service_tier: "default" });
    expect(bodies[2]).toMatchObject({ service_tier: "default" });
    expect(bodies[0]).not.toHaveProperty("service_tier");
    expect(bodies[5]).not.toHaveProperty("service_tier");
    expect(mocks.withOptions).toHaveBeenCalledTimes(2);
    expect(mocks.withOptions).toHaveBeenCalledWith({ fetch: expect.any(Function) });
    expect(currentAnswerPilotBudget()).toBeNull();
  });
});
