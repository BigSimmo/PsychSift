"use client";

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  clearPersistedAnswerThread,
  guestAnswerThreadOwnerId,
  loadPersistedAnswerThread,
  savePersistedAnswerThread,
  type PersistedAnswerThread,
  type StoredAnswerTurn,
} from "@/lib/answer-thread-storage";
import { demoRecentQueryOwnerId } from "@/lib/recent-query-storage";
import type { ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";

import type { AnswerThreadSnapshotMetadata } from "@/components/clinical-dashboard/use-persisted-answer-thread";

export function snapshotMetadataFromPersisted(persisted: PersistedAnswerThread): AnswerThreadSnapshotMetadata {
  return {
    latestSubmissionSignature: persisted.latestSubmissionSignature,
    expiresAt: persisted.expiresAt,
  };
}

export function nextAnswerTurnSeqFromPriorTurns(priorTurns: StoredAnswerTurn[]): number {
  return priorTurns.reduce((max, turn) => {
    const match = /^answer-turn-(\d+)$/.exec(turn.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

export function collapsedTurnIdsFromPersisted(persisted: PersistedAnswerThread): Set<string> {
  return persisted.collapsedTurnIds.length
    ? new Set(persisted.collapsedTurnIds)
    : new Set(persisted.priorTurns.map((turn) => turn.id));
}

/**
 * Owns answer-thread owner transitions and the one-shot sessionStorage restore
 * that seeds React state before auto-run / persistence effects may fire.
 */
export function useAnswerThreadBootstrap({
  answerThreadOwnerId,
  authStatus,
  searchMode,
  submittedUrlQuery,
  expectedSubmissionSignature,
  activeAnswerThreadOwnerIdRef,
  answerThreadBootstrappedRef,
  restoredThreadFromStorageRef,
  latestAnswerTurnRef,
  latestAnswerSnapshotMetadataRef,
  answerTurnSeqRef,
  autoRunSearchSignatureRef,
  setPriorAnswerTurns,
  setLatestAnswerQuery,
  setCollapsedTurnIds,
  setShowEarlierTurns,
  setAnswer,
  setSources,
  setModeSearchSubmitted,
  setQuery,
  setAnswerThreadBootstrapped,
}: {
  answerThreadOwnerId: string | null;
  authStatus: string;
  searchMode: string;
  submittedUrlQuery: string;
  expectedSubmissionSignature: string | undefined;
  activeAnswerThreadOwnerIdRef: MutableRefObject<string | null>;
  answerThreadBootstrappedRef: MutableRefObject<boolean>;
  restoredThreadFromStorageRef: MutableRefObject<boolean>;
  latestAnswerTurnRef: MutableRefObject<Omit<StoredAnswerTurn, "id"> | null>;
  latestAnswerSnapshotMetadataRef: MutableRefObject<AnswerThreadSnapshotMetadata | null>;
  answerTurnSeqRef: MutableRefObject<number>;
  autoRunSearchSignatureRef: MutableRefObject<string | null>;
  setPriorAnswerTurns: Dispatch<SetStateAction<StoredAnswerTurn[]>>;
  setLatestAnswerQuery: Dispatch<SetStateAction<string | null>>;
  setCollapsedTurnIds: Dispatch<SetStateAction<Set<string>>>;
  setShowEarlierTurns: Dispatch<SetStateAction<boolean>>;
  setAnswer: Dispatch<SetStateAction<ClientRagAnswerPayload | null>>;
  setSources: Dispatch<SetStateAction<ClientSearchResult[]>>;
  /** Also records the submitted query, so a later composer edit cannot pass for a submission. */
  setModeSearchSubmitted: (submitted: boolean, submittedText?: string) => void;
  setQuery: Dispatch<SetStateAction<string>>;
  setAnswerThreadBootstrapped: Dispatch<SetStateAction<boolean>>;
}) {
  const previousAnswerThreadOwnerIdRef = useRef(answerThreadOwnerId);
  useEffect(() => {
    activeAnswerThreadOwnerIdRef.current = answerThreadOwnerId ?? null;
    const previousOwnerId = previousAnswerThreadOwnerIdRef.current;
    previousAnswerThreadOwnerIdRef.current = answerThreadOwnerId;
    const isGuestDemoTransition =
      (previousOwnerId === guestAnswerThreadOwnerId && answerThreadOwnerId === demoRecentQueryOwnerId) ||
      (previousOwnerId === demoRecentQueryOwnerId && answerThreadOwnerId === guestAnswerThreadOwnerId);
    if (!previousOwnerId || previousOwnerId === answerThreadOwnerId || isGuestDemoTransition) {
      if (isGuestDemoTransition && answerThreadOwnerId) {
        const currentThread = loadPersistedAnswerThread(previousOwnerId, { expectedSubmissionSignature });
        if (currentThread) {
          savePersistedAnswerThread(answerThreadOwnerId, currentThread);
        }
      }
      return;
    }
    clearPersistedAnswerThread(previousOwnerId);
    if (answerThreadOwnerId) clearPersistedAnswerThread(answerThreadOwnerId);
    answerThreadBootstrappedRef.current = false;
    queueMicrotask(() => {
      setPriorAnswerTurns([]);
      setLatestAnswerQuery(null);
      setCollapsedTurnIds(new Set());
      setAnswer(null);
      setSources([]);
      latestAnswerTurnRef.current = null;
      latestAnswerSnapshotMetadataRef.current = null;
      setAnswerThreadBootstrapped(false);
    });
  }, [
    activeAnswerThreadOwnerIdRef,
    answerThreadBootstrappedRef,
    answerThreadOwnerId,
    expectedSubmissionSignature,
    latestAnswerSnapshotMetadataRef,
    latestAnswerTurnRef,
    setAnswer,
    setAnswerThreadBootstrapped,
    setCollapsedTurnIds,
    setLatestAnswerQuery,
    setPriorAnswerTurns,
    setSources,
  ]);

  useEffect(() => {
    if (authStatus === "loading" || answerThreadBootstrappedRef.current) return;
    queueMicrotask(() => {
      const persisted =
        answerThreadOwnerId && searchMode === "answer"
          ? loadPersistedAnswerThread(answerThreadOwnerId, { expectedSubmissionSignature })
          : null;
      if (persisted) {
        restoredThreadFromStorageRef.current = true;
        setPriorAnswerTurns(persisted.priorTurns);
        setLatestAnswerQuery(persisted.latestTurn?.query ?? null);
        setShowEarlierTurns(persisted.showEarlierTurns);
        latestAnswerSnapshotMetadataRef.current = snapshotMetadataFromPersisted(persisted);
        if (persisted.latestTurn) {
          latestAnswerTurnRef.current = persisted.latestTurn;
          setAnswer(persisted.latestTurn.answer);
          setSources(persisted.latestTurn.sources);
          // Restoring a persisted thread is a submission of that turn's query, not of
          // whatever happens to be in the composer.
          setModeSearchSubmitted(true, persisted.latestTurn.query);
          setQuery("");
          autoRunSearchSignatureRef.current = persisted.latestSubmissionSignature;
        }
        answerTurnSeqRef.current = nextAnswerTurnSeqFromPriorTurns(persisted.priorTurns);
        setCollapsedTurnIds(collapsedTurnIdsFromPersisted(persisted));
      } else if (!answerThreadOwnerId) {
        clearPersistedAnswerThread();
      }
      answerThreadBootstrappedRef.current = true;
      setAnswerThreadBootstrapped(true);
    });
  }, [
    answerThreadBootstrappedRef,
    answerThreadOwnerId,
    answerTurnSeqRef,
    authStatus,
    autoRunSearchSignatureRef,
    expectedSubmissionSignature,
    latestAnswerSnapshotMetadataRef,
    latestAnswerTurnRef,
    restoredThreadFromStorageRef,
    searchMode,
    setAnswer,
    setAnswerThreadBootstrapped,
    setCollapsedTurnIds,
    setLatestAnswerQuery,
    setModeSearchSubmitted,
    setPriorAnswerTurns,
    setQuery,
    setShowEarlierTurns,
    setSources,
    submittedUrlQuery,
  ]);
}
