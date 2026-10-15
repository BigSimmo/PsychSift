import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerPilotBudgetError, runAnswerWithPilotBudget } from "@/lib/answer-pilot-budget";
import { couldBelongToAnswerPilot } from "@/lib/answer-pilot-ticket";

const PILOT_OWNER_ID = "3ea89594-b3a1-46b7-b570-33c198ce5524";
const PILOT_DOCUMENT_ID = "d69a6b9c-3e80-556a-b887-53d209238293";

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
  querySha256: "a".repeat(64),
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

  it.each([
    ["expired", expiredTicket],
    ["malformed", "{not json"],
  ])("keeps unrelated answers working when a %s ticket is left configured", async (_label, raw) => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", raw);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const work = vi.fn(async () => "answered");
    await expect(runAnswerWithPilotBudget(request(), work)).resolves.toBe("answered");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the pilot owner", { ownerId: PILOT_OWNER_ID }],
    ["the pilot document", { documentId: PILOT_DOCUMENT_ID }],
  ])("still refuses requests from %s when the ticket is unusable", async (_label, overrides) => {
    vi.stubEnv("CONTROLLED_ANSWER_PILOT_TICKET_JSON", expiredTicket);
    const work = vi.fn(async () => "answered");
    await expect(runAnswerWithPilotBudget(request(overrides), work)).rejects.toBeInstanceOf(AnswerPilotBudgetError);
    expect(work).not.toHaveBeenCalled();
  });

  it("recognises only the pinned pilot owner and document", () => {
    expect(couldBelongToAnswerPilot({ ownerId: PILOT_OWNER_ID })).toBe(true);
    expect(couldBelongToAnswerPilot({ documentId: PILOT_DOCUMENT_ID })).toBe(true);
    expect(couldBelongToAnswerPilot(request())).toBe(false);
    expect(couldBelongToAnswerPilot(null)).toBe(false);
  });
});
