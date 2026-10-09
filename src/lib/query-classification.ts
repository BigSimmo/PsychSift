/**
 * Query Classification & Consumer Query Filtering (#3944SV).
 *
 * Provides query classification patterns and helpers ensuring bare psychiatric
 * conditions (e.g., "bipolar", "schizoaffective") are not falsely rejected as
 * non-clinical consumer queries.
 */

export {
  clearlyNonClinicalConsumerPattern,
  psychiatricOrClinicalContextPattern,
  clearlyOutsideCorpusMedicalPattern,
  shouldShortCircuitUnsupportedSearch,
  isUnsupportedSoftTailAnalysis,
} from "@/lib/rag/rag-query-guard";

import { clearlyNonClinicalConsumerPattern, psychiatricOrClinicalContextPattern } from "@/lib/rag/rag-query-guard";

/**
 * Checks whether a query string represents a non-clinical consumer search
 * while safeguarding bare and qualified psychiatric conditions.
 */
export function isNonClinicalConsumerText(query: string): boolean {
  if (!clearlyNonClinicalConsumerPattern.test(query)) return false;
  if (psychiatricOrClinicalContextPattern.test(query)) return false;
  return true;
}
