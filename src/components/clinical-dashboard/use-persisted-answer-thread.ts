"use client";

import { useEffect, type RefObject } from "react";

import {
  clearPersistedAnswerThread,
  resolveAnswerThreadOwnerId,
  savePersistedAnswerThread,
  type PersistedAnswerThread,
  type StoredAnswerTurn,
} from "@/lib/answer-thread-storage";
import { demoRecentQueryOwnerId } from "@/lib/recent-query-storage";
import type { ClientRagAnswerPayload } from "@/lib/answer-client-payload";

export type AnswerThreadSnapshotMetadata = Pick<PersistedAnswerThread, "latestSubmissionSignature" | "expiresAt">;

export function resolveDashboardAnswerThreadOwnerId(
  userId: string | undefined,
  demoMode: boolean,
  authStatus: Parameters<typeof resolveAnswerThreadOwnerId>[0]["authStatus"],
) {
  return resolveAnswerThreadOwnerId({ userId, demoMode, demoOwnerId: demoRecentQueryOwnerId, authStatus });
}

export function usePersistedAnswerThread({
  ownerId,
  enabled,
  answer,
  priorTurns,
  latestTurnRef,
  collapsedTurnIds,
  showEarlierTurns,
  metadataRef,
}: {
  ownerId: string | null;
  enabled: boolean;
  answer: ClientRagAnswerPayload | null;
  priorTurns: StoredAnswerTurn[];
  latestTurnRef: RefObject<Omit<StoredAnswerTurn, "id"> | null>;
  collapsedTurnIds: Set<string>;
  showEarlierTurns: boolean;
  metadataRef: RefObject<AnswerThreadSnapshotMetadata | null>;
}) {
  // The latest turn and snapshot metadata live in refs that are written next to
  // the answer state updates, so they are read here, after the commit, rather
  // than during render. Every write is followed by an answer or thread state
  // change, which re-runs this effect with the current values.
  useEffect(() => {
    const latestTurn = latestTurnRef.current;
    const metadata = metadataRef.current;
    if (!enabled) return;
    if (!answer && priorTurns.length === 0) {
      if (ownerId) clearPersistedAnswerThread(ownerId);
      return;
    }
    if (!ownerId || !metadata) return;
    savePersistedAnswerThread(ownerId, {
      version: 3,
      priorTurns,
      latestTurn,
      collapsedTurnIds: [...collapsedTurnIds],
      showEarlierTurns,
      latestSubmissionSignature: metadata.latestSubmissionSignature,
      expiresAt: metadata.expiresAt,
    });
  }, [answer, collapsedTurnIds, enabled, latestTurnRef, metadataRef, ownerId, priorTurns, showEarlierTurns]);
}
