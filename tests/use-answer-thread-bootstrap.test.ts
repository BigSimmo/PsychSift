import { describe, expect, it } from "vitest";

import {
  collapsedTurnIdsFromPersisted,
  nextAnswerTurnSeqFromPriorTurns,
  snapshotMetadataFromPersisted,
} from "@/components/clinical-dashboard/use-answer-thread-bootstrap";
import type { PersistedAnswerThread } from "@/lib/answer-thread-storage";
import type { RagAnswer } from "@/lib/types";

const sampleAnswer = {
  answer: "sample",
  confidence: "medium",
  citations: [],
  warnings: [],
} as unknown as RagAnswer;

function sampleThread(overrides: Partial<PersistedAnswerThread> = {}): PersistedAnswerThread {
  return {
    version: 3,
    priorTurns: [
      { id: "answer-turn-3", query: "earlier", answer: sampleAnswer, sources: [] },
      { id: "answer-turn-7", query: "later", answer: sampleAnswer, sources: [] },
    ],
    latestTurn: { query: "latest", answer: sampleAnswer, sources: [] },
    collapsedTurnIds: ["answer-turn-3"],
    showEarlierTurns: true,
    latestSubmissionSignature: "answer:latest:",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("use-answer-thread-bootstrap helpers", () => {
  it("copies only snapshot metadata from a persisted thread", () => {
    const persisted = sampleThread();
    expect(snapshotMetadataFromPersisted(persisted)).toEqual({
      latestSubmissionSignature: persisted.latestSubmissionSignature,
      expiresAt: persisted.expiresAt,
    });
  });

  it("derives the next turn sequence from prior turn ids", () => {
    expect(nextAnswerTurnSeqFromPriorTurns(sampleThread().priorTurns)).toBe(7);
    expect(nextAnswerTurnSeqFromPriorTurns([{ id: "other", query: "q", answer: sampleAnswer, sources: [] }])).toBe(0);
  });

  it("falls back to collapsing every prior turn when none were stored", () => {
    const persisted = sampleThread({ collapsedTurnIds: [] });
    expect([...collapsedTurnIdsFromPersisted(persisted)]).toEqual(["answer-turn-3", "answer-turn-7"]);
  });
});
