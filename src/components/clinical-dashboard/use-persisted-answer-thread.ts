"use client";

import { useEffect } from "react";

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
  latestTurn,
  collapsedTurnIds,
  showEarlierTurns,
  metadata,
}: {
  ownerId: string | null;
  enabled: boolean;
  answer: ClientRagAnswerPayload | null;
  priorTurns: StoredAnswerTurn[];
  latestTurn: Omit<StoredAnswerTurn, "id"> | null;
  collapsedTurnIds: Set<string>;
  showEarlierTurns: boolean;
  metadata: AnswerThreadSnapshotMetadata | null;
}) {
  useEffect(() => {
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
  }, [answer, collapsedTurnIds, enabled, latestTurn, metadata, ownerId, priorTurns, showEarlierTurns]);
}
