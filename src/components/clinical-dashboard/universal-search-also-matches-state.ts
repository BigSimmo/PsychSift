import type { AppModeId } from "@/lib/app-modes";
import { resolveAnswerHandoffParams } from "@/lib/answer-question-handoff";
import { isSmartLocalOnlyMode, interpretSmartSearch } from "@/lib/smart-search-intent";

/**
 * Answer threads may be restored from session storage on the shared home. The
 * cross-mode panel belongs only to a submitted Answer URL, not to a persisted
 * answer object that happens to still be available after navigation.
 *
 * `locationSearch === null` is the server-render path. The Answer panel is not
 * mounted there until client-side answer state exists, so allowing it preserves
 * hydration while the client applies the actual URL contract before fetching.
 */
export function shouldRunUniversalAlsoMatches(modeId: AppModeId, locationSearch: string | null, query = "") {
  if (isSmartLocalOnlyMode(modeId) && interpretSmartSearch(modeId, query).naturalLanguage) return false;
  if (modeId !== "answer" || locationSearch === null) return true;
  // A submitted Answer URL names its question by an `ask` id (FE-01).
  const params = resolveAnswerHandoffParams(new URLSearchParams(locationSearch));
  const submittedQuery = (params.get("q") ?? params.get("query") ?? "").trim();
  return params.get("run") === "1" && submittedQuery.length > 0;
}
