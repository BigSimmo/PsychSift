"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  answerHandoffParam,
  privateAnswerHref,
  readStashedAnswerQuestion,
  resolveAnswerHandoffParams,
} from "@/lib/answer-question-handoff";

function subscribeNoop() {
  return () => undefined;
}

/**
 * `useSearchParams()` with a submitted Answer URL's `ask` id resolved back to `q`
 * (FE-01). The server render has no tab storage, so it sees the bare id and the
 * question appears on the first client render after hydration.
 */
export function useAnswerSearchParams() {
  const searchParams = useSearchParams();
  const ref = searchParams.get(answerHandoffParam);
  const question = useSyncExternalStore(
    subscribeNoop,
    () => readStashedAnswerQuestion(ref),
    () => null,
  );
  return useMemo(
    () => resolveAnswerHandoffParams(searchParams, question) as typeof searchParams,
    [searchParams, question],
  );
}

/** `useRouter()` whose push and replace keep a submitted Answer question out of the address. */
export function usePrivateAnswerRouter() {
  const router = useRouter();
  return useMemo<typeof router>(
    () => ({
      ...router,
      push: (href, options) => router.push(privateAnswerHref(href), options),
      replace: (href, options) => router.replace(privateAnswerHref(href), options),
    }),
    [router],
  );
}

/**
 * A submitted Answer link that still carries the question (a bookmark, an older
 * link, a server redirect) has it moved out of the address as soon as it opens.
 */
export function useMoveAnswerQuestionOutOfAddress(searchParamString: string) {
  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = privateAnswerHref(current);
    if (next !== current) window.history.replaceState(window.history.state, "", next);
  }, [searchParamString]);
}
