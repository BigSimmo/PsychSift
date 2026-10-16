import { packCheckedPublishedOriginalSectionContext } from "@/lib/rag/rag-context-pack";
import { createAnswerRouteDeadline, isAnswerRouteDeadlineExceeded } from "@/lib/rag/rag-route-budget";
import type {
  createPublishedOriginalReceiptCapture,
  RegisteredPublishedOriginalSectionLayoutLookup,
} from "@/lib/rag/rag-source-block";
import type { RagQueryClass, SearchResult } from "@/lib/types";

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
}

function bindingError(message: string) {
  const error = new Error(message);
  error.name = "OriginalSectionLayoutBindingError";
  return error;
}

/**
 * Loads and packs the registered published original layout for the selected results.
 * Every failure other than the caller's own abort surfaces as OriginalSectionLayoutBindingError.
 */
export function createCheckedPublishedOriginalLoader(options: {
  lookup: RegisteredPublishedOriginalSectionLayoutLookup;
  capture: ReturnType<typeof createPublishedOriginalReceiptCapture>;
  queryClass: RagQueryClass;
  signal?: AbortSignal;
  /** Read at call time: the route deadline replaces the caller signal once generation starts. */
  callerSignal: () => AbortSignal | undefined;
  startedAt: number;
}) {
  return async (selectedResults: SearchResult[], tokenBudget: number) => {
    throwIfAborted(options.signal);
    const projected = options.capture.projectSelectedResults(selectedResults);
    if (!projected) return null;
    const deadline = createAnswerRouteDeadline({
      routeMode: "strong",
      callerSignal: options.callerSignal(),
      startedAt: options.startedAt,
    });
    try {
      throwIfAborted(deadline.signal);
      const layout = await deadline.race(options.lookup({ selectedResults: projected, signal: deadline.signal }));
      throwIfAborted(deadline.signal);
      if (!layout) throw bindingError("Registered published original layout is unavailable.");
      return packCheckedPublishedOriginalSectionContext(projected, options.queryClass, tokenBudget, layout);
    } catch (error) {
      throwIfAborted(options.signal);
      if (isAnswerRouteDeadlineExceeded(error)) throw bindingError("Published original layout reached its time limit.");
      if (error instanceof Error && error.name === "OriginalSectionLayoutBindingError") throw error;
      throw bindingError("Published original layout binding could not be confirmed.");
    } finally {
      deadline.dispose();
    }
  };
}
