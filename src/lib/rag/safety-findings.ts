/**
 * Safety findings extraction (#747FC0).
 * Re-exports the safety findings extractor and types from clinical-safety.
 */

export {
  extractSafetyFindings,
  collapseDuplicateSafetyFindings,
  formatSafetyFindingLabel,
  sortSafetyFindingsBySeverity,
  __safetyPatternLabelForTests,
  type SafetyFinding,
  type SafetyFindingKind,
} from "@/lib/clinical-safety";
