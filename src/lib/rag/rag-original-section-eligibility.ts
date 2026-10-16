import { classifyRagQuery } from "@/lib/clinical-search";
import { queryClassForClinicalMode, queryForClinicalMode, type ClinicalQueryMode } from "@/lib/clinical-query-mode";

type OriginalSectionEligibilityArgs = {
  query: string;
  queryMode?: ClinicalQueryMode;
  documentId?: string | null;
  documentIds?: readonly string[] | null;
  skipCache?: boolean;
  loadRegisteredPublishedOriginalSectionLayout?: unknown;
};

/**
 * Original-section delivery runs only for an unscoped broad summary (see loadCheckedPublishedOriginal
 * in rag.ts). An ineligible request drops the loader so it keeps the answer, coalescing and retrieval
 * caches; an eligible one bypasses them so its request-local layout authority is current. A
 * pre-retrieval misclassification only ever falls back to baseline packing, never to unchecked
 * original-section delivery.
 */
export function withOriginalSectionEligibility<T extends OriginalSectionEligibilityArgs>(args: T): T {
  if (!args.loadRegisteredPublishedOriginalSectionLayout) return args;
  const queryMode = args.queryMode ?? "auto";
  const eligible =
    !args.documentId &&
    !args.documentIds?.length &&
    (queryClassForClinicalMode(queryMode) ??
      classifyRagQuery(queryForClinicalMode(args.query, queryMode)).queryClass) === "broad_summary";
  return eligible ? { ...args, skipCache: true } : { ...args, loadRegisteredPublishedOriginalSectionLayout: undefined };
}
