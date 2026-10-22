import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerPilotBudgetError, runAnswerWithPilotBudget } from "@/lib/answer-pilot-budget";
import {
  answerPilotDiagnosticState,
  answerPilotResponseMatches,
  createAnswerPilotDiagnostic,
  prepareAnswerPilotGenerationSeed,
} from "@/lib/answer-pilot-diagnostic";
import { couldBelongToAnswerPilot } from "@/lib/answer-pilot-ticket";
import { createWireBudgetGuard } from "@/lib/answer-wire-budget-guard";

const PILOT_OWNER_ID = "3ea89594-b3a1-46b7-b570-33c198ce5524";
const PILOT_DOCUMENT_ID = "d69a6b9c-3e80-556a-b887-53d209238293";
const PILOT_QUERY_DIGEST = createHash("sha256").update("pilot question", "utf8").digest("hex");

const request = (overrides: Record<string, unknown> = {}) => ({
  ownerId: "00000000-0000-4000-8000-000000000001",
  documentId: null,
  query: "lithium monitoring interval",
  summaryMode: false,
  activeFilterCount: 0,
  queryMode: "auto",
  resolvedDocumentIds: [],
  ...overrides,
});

const expiredTicket = JSON.stringify({
  version: 1,
  ownerId: PILOT_OWNER_ID,
  documentId: PILOT_DOCUMENT_ID,
  querySha256: PILOT_QUERY_DIGEST,
  nonce: "11111111-1111-4111-8111-111111111111",
  issuedAtUtc: "2026-10-01T00:00:00Z",
  expiresAtUtc: "2026-10-01T00:30:00Z",
  ledgerReservationRef: "ledger:expired-test",
  ledgerReservedUsd: "6.000000",
  priceCardSha256: "A1BE62919DA8A18A5CF33177AF8C06F67CDC1ED607F7C6091D22ED47605CB77F",
  maxSerializedJsonBytes: 1024,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("answer pilot ticket fallback", () => {
  it("runs ordinary answers when no ticket is configured", async () => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", undefined as unknown as string);
    await expect(runAnswerWithPilotBudget(request(), async () => "answered")).resolves.toBe("answered");
  });

  it("keeps unrelated answers working when an expired ticket is left configured", async () => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", expiredTicket);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const work = vi.fn(async () => "answered");
    await expect(
      runAnswerWithPilotBudget(request({ resolvedDocumentIds: ["22222222-2222-4222-8222-222222222222"] }), work),
    ).resolves.toBe("answered");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("answers an unrelated All-documents (undefined scope) request when the ticket has expired, as a valid ticket would", async () => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", expiredTicket);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const work = vi.fn(async () => "answered");
    await expect(runAnswerWithPilotBudget(request({ resolvedDocumentIds: undefined }), work)).resolves.toBe("answered");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("allows an unrelated All-documents or non-pilot document request from the pilot owner when the ticket has expired", async () => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", expiredTicket);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const work = vi.fn(async () => "answered");
    await expect(
      runAnswerWithPilotBudget(request({ resolvedDocumentIds: undefined, ownerId: PILOT_OWNER_ID }), work),
    ).resolves.toBe("answered");
    await expect(
      runAnswerWithPilotBudget(
        request({
          ownerId: PILOT_OWNER_ID,
          documentId: "22222222-2222-4222-8222-222222222222",
          resolvedDocumentIds: ["22222222-2222-4222-8222-222222222222"],
        }),
        work,
      ),
    ).resolves.toBe("answered");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("refuses every request while an unreadable ticket is configured", async () => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", "{not json");
    const work = vi.fn(async () => "answered");
    await expect(runAnswerWithPilotBudget(request(), work)).rejects.toBeInstanceOf(AnswerPilotBudgetError);
    expect(work).not.toHaveBeenCalled();
  });

  it.each([
    ["the pilot document", { documentId: PILOT_DOCUMENT_ID }],
    ["a scope that resolves to the pilot document", { resolvedDocumentIds: ["x", PILOT_DOCUMENT_ID] }],
    ["the pilot query", { query: "pilot question" }],
    ["the pilot owner with the pilot query", { ownerId: PILOT_OWNER_ID, query: "pilot question" }],
  ])("still refuses requests from %s when the ticket has expired", async (_label, overrides) => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", expiredTicket);
    const work = vi.fn(async () => "answered");
    await expect(runAnswerWithPilotBudget(request(overrides), work)).rejects.toBeInstanceOf(AnswerPilotBudgetError);
    expect(work).not.toHaveBeenCalled();
  });

  it("treats only positively unrelated requests as unrelated", () => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", expiredTicket);
    expect(couldBelongToAnswerPilot({ ownerId: PILOT_OWNER_ID }, "b".repeat(64))).toBe(false);
    expect(couldBelongToAnswerPilot({ ownerId: PILOT_OWNER_ID }, PILOT_QUERY_DIGEST)).toBe(true);
    expect(couldBelongToAnswerPilot({ documentId: PILOT_DOCUMENT_ID }, "b".repeat(64))).toBe(true);
    expect(couldBelongToAnswerPilot({ resolvedDocumentIds: [PILOT_DOCUMENT_ID] }, "b".repeat(64))).toBe(true);
    expect(couldBelongToAnswerPilot(request(), PILOT_QUERY_DIGEST)).toBe(true);
    expect(couldBelongToAnswerPilot(request({ resolvedDocumentIds: undefined }), "b".repeat(64))).toBe(false);
    expect(couldBelongToAnswerPilot(request({ resolvedDocumentIds: ["x"] }), "b".repeat(64))).toBe(false);
    expect(couldBelongToAnswerPilot(null, "b".repeat(64))).toBe(true);
  });
});

describe("answer pilot offline wire budget", () => {
  const url = "https://api.openai.com/v1/responses";
  const wireRequest = () => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "synthetic-response",
      input: "synthetic question",
      instructions: "synthetic instructions",
      max_output_tokens: 10,
      store: false,
      service_tier: "default",
    }),
  });
  const guardOptions = () => ({
    remainingUsd: "0.000462",
    prices: {
      "synthetic-response": {
        endpoint: "responses",
        maxContextTokens: 100,
        maxOutputTokens: 10,
        worstInputUsdPerMillion: 2,
        worstOutputUsdPerMillion: 3,
      },
    },
    verifiedPriceTableRef: "synthetic-offline-price-table",
    expectedOrigin: "https://api.openai.com/",
    maxSerializedJsonBytes: 1024,
  });

  it("persists the full worst-case reservation before forwarding an admitted response", async () => {
    const order: string[] = [];
    const response = new Response("synthetic result");
    const onReserve = vi.fn(async () => {
      order.push("reserved");
    });
    const dispatch = vi.fn(async () => {
      order.push("dispatched");
      return response;
    });
    const guard = createWireBudgetGuard({ ...guardOptions(), onReserve, dispatch });
    const init = wireRequest();

    await expect(guard.fetch(url, init)).resolves.toBe(response);

    expect(order).toEqual(["reserved", "dispatched"]);
    // 100 input tokens at 2 + 10 output tokens at 3 + 1 rounding micro-USD.
    expect(onReserve).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        endpoint: "responses",
        model: "synthetic-response",
        inputTokenAllowance: 100,
        outputTokenAllowance: 10,
        reservedMicroUsd: "231",
        cumulativeMicroUsd: "231",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST", body: init.body }));
    expect(guard.snapshot()).toMatchObject({
      attempts: 1,
      reservedMicroUsd: "231",
      remainingMicroUsd: "231",
      denied: null,
      reservationAttempts: { responses: 1, embeddings: 0 },
      dispatchAttempts: { responses: 1, embeddings: 0 },
    });
  });

  it("counts concurrent requests cumulatively and serializes ledger writes before dispatch", async () => {
    let releaseLedger!: () => void;
    let ledgerStarted!: () => void;
    const pendingLedger = new Promise<void>((resolve) => {
      releaseLedger = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ledgerStarted = resolve;
    });
    const onReserve = vi.fn(async () => {
      ledgerStarted();
      await pendingLedger;
    });
    const dispatch = vi.fn(async () => new Response("synthetic result"));
    const guard = createWireBudgetGuard({ ...guardOptions(), onReserve, dispatch });
    const first = guard.fetch(url, wireRequest());
    const second = guard.fetch(url, wireRequest());
    await started;

    try {
      expect(onReserve).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalled();
      expect(guard.snapshot()).toMatchObject({ attempts: 2, reservedMicroUsd: "462", remainingMicroUsd: "0" });
    } finally {
      releaseLedger();
    }
    await Promise.all([first, second]);

    expect(onReserve).toHaveBeenNthCalledWith(2, expect.objectContaining({ attempt: 2, cumulativeMicroUsd: "462" }));
    await expect(guard.fetch(url, wireRequest())).rejects.toMatchObject({ code: "cumulative_budget_exceeded" });
    expect(onReserve).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(guard.snapshot().firstRefusal).toEqual({ stage: "cost", reason: "cumulative_budget_exceeded" });
  });

  it("keeps failed transport reservations charged so SDK retries cannot exceed the budget", async () => {
    const transportError = new Error("synthetic transport failure");
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValue(new Response("synthetic retry result"));
    const onReserve = vi.fn(async () => {});
    const guard = createWireBudgetGuard({ ...guardOptions(), onReserve, dispatch });

    await expect(guard.fetch(url, wireRequest())).rejects.toBe(transportError);
    expect(guard.snapshot()).toMatchObject({ reservedMicroUsd: "231", remainingMicroUsd: "231", denied: null });
    await expect(guard.fetch(url, wireRequest())).resolves.toBeInstanceOf(Response);
    await expect(guard.fetch(url, wireRequest())).rejects.toMatchObject({ code: "cumulative_budget_exceeded" });

    expect(onReserve).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(guard.snapshot()).toMatchObject({ attempts: 2, reservedMicroUsd: "462", remainingMicroUsd: "0" });
  });

  it("latches a failed ledger reservation and never dispatches or retries the write", async () => {
    const onReserve = vi.fn(async () => {
      throw new Error("synthetic ledger unavailable");
    });
    const dispatch = vi.fn(async () => new Response("must not dispatch"));
    const guard = createWireBudgetGuard({ ...guardOptions(), onReserve, dispatch });

    await expect(guard.fetch(url, wireRequest())).rejects.toMatchObject({ code: "reservation_commit_failed" });
    await expect(guard.fetch(url, wireRequest())).rejects.toMatchObject({ code: "reservation_commit_failed" });

    expect(onReserve).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(guard.snapshot()).toMatchObject({
      attempts: 1,
      reservedMicroUsd: "231",
      firstRefusal: { stage: "reservation", reason: "reservation_commit_failed" },
      dispatchAttempts: { responses: 0, embeddings: 0 },
    });
  });

  it.each(["mismatched", "throwing"])(
    "refuses a %s generation admission before reserving or dispatching",
    async (kind) => {
      const admitResponse = vi.fn(() => {
        if (kind === "throwing") throw new Error("synthetic proof failure");
        return false;
      });
      const onReserve = vi.fn(async () => {});
      const dispatch = vi.fn(async () => new Response("must not dispatch"));
      const guard = createWireBudgetGuard({ ...guardOptions(), admitResponse, onReserve, dispatch });

      await expect(guard.fetch(url, wireRequest())).rejects.toMatchObject({ code: "generation_proof_refused" });

      expect(admitResponse).toHaveBeenCalledWith(wireRequest().body);
      expect(onReserve).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(guard.snapshot()).toMatchObject({
        attempts: 0,
        reservedMicroUsd: "0",
        firstRefusal: { stage: "serialized_wire", reason: "generation_proof_refused" },
      });
    },
  );
});

describe("answer pilot offline proof and diagnostic boundaries", () => {
  const diagnosticTicket = (diagnosticCurrent: () => boolean) => ({
    ownerId: PILOT_OWNER_ID,
    documentId: PILOT_DOCUMENT_ID,
    querySha256: "83ac78d0637271b2162b3bc45d884fb08f6b5471833e96f47bd844e36ba55591",
    diagnosticCurrent,
  });

  it("does not accept a caller-created generation proof even when every wire field matches", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    const forgedProof = {
      model: "gpt-5.6-luna",
      input: "synthetic question",
      instructions: "synthetic instructions",
      schema,
      schemaJson: JSON.stringify(schema),
      attemptOrdinal: 1,
      sourceBinding: [],
    };
    const body = JSON.stringify({
      model: "gpt-5.6-luna",
      input: "synthetic question",
      instructions: "synthetic instructions",
      metadata: { operation: "answer" },
      text: { format: { type: "json_schema", name: "clinical_rag_answer", strict: true, schema } },
    });

    expect(answerPilotResponseMatches(forgedProof, body)).toBe(false);
  });

  it("rejects unapproved source identities before evaluating the generation schema", () => {
    const schemaFor = vi.fn(() => ({ type: "object" }));
    const sources = [{ id: "synthetic-chunk", document_id: PILOT_DOCUMENT_ID, content: "synthetic source" }];

    expect(() => prepareAnswerPilotGenerationSeed(sources, "gpt-5.6-luna", 1, schemaFor)).toThrow("source_refused");
    expect(schemaFor).not.toHaveBeenCalled();
  });

  it("snapshots only selected diagnostic fields without evaluating unrelated getters", () => {
    const unrelated = vi.fn(() => "must remain unread");
    const answer = {
      answer: "synthetic answer",
      grounded: false,
      citations: [{ chunk_id: "synthetic-chunk", provenance: "synthetic", privateField: "must be omitted" }],
      supportedClaims: [
        { claimId: "synthetic-claim", text: "synthetic statement", supportingChunkIds: ["synthetic-chunk"] },
      ],
    };
    Object.defineProperty(answer, "privateMetadata", { enumerable: true, get: unrelated });
    const snapshot = answerPilotDiagnosticState(answer);
    answer.citations[0].chunk_id = "changed";
    answer.supportedClaims[0].supportingChunkIds.push("changed");

    expect(snapshot).toEqual({
      answer: "synthetic answer",
      grounded: false,
      citations: [{ chunk_id: "synthetic-chunk", provenance: "synthetic" }],
      supportedClaims: [
        { claimId: "synthetic-claim", text: "synthetic statement", supportingChunkIds: ["synthetic-chunk"] },
      ],
    });
    expect(unrelated).not.toHaveBeenCalled();
  });

  it("refuses oversized diagnostic collections rather than silently truncating them", () => {
    const answer = { citations: Array.from({ length: 129 }, () => ({ chunk_id: "synthetic-chunk" })) };

    expect(() => answerPilotDiagnosticState(answer)).toThrow("array_refused");
  });

  it("stops diagnostic capture after the current claim is revoked, before reading source or answer data", () => {
    let current = true;
    const diagnosticCurrent = vi.fn(() => current);
    const diagnostic = createAnswerPilotDiagnostic(diagnosticTicket(diagnosticCurrent), {
      snapshot: () => ({ denied: null }),
    });
    const sources = vi.fn(() => []);
    const details = vi.fn(() => ({ raw: "must remain unread", schema: {} }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(diagnostic).not.toBeNull();
    current = false;

    diagnostic!.capture("parse.before", sources, details);

    expect(diagnosticCurrent).toHaveBeenCalled();
    expect(sources).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("suppresses diagnostic data after the wire guard is denied even while the claim remains current", () => {
    const diagnostic = createAnswerPilotDiagnostic(
      diagnosticTicket(() => true),
      {
        snapshot: () => ({ denied: "reservation_commit_failed" }),
      },
    );
    const sources = vi.fn(() => []);
    const details = vi.fn(() => ({ raw: "must remain unread", schema: {} }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(diagnostic).not.toBeNull();

    diagnostic!.capture("parse.before", sources, details);

    expect(sources).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
