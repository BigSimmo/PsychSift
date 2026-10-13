/**
 * Search My Work Question Grammar for Assessments & Alerts (#PT83FG).
 *
 * Extends the question grammar to recognize and parse assessment-specific queries
 * across Entrustable Professional Activities (EPAs), Workplace-Based Assessments (WBAs),
 * Term Assessments (ITAs), Supervisor Reviews, and active assessment alerts.
 */

export type AssessmentCategory =
  "epa" | "wba" | "term_assessment" | "supervisor_review" | "alert" | "general_assessment";

export type AssessmentQueryIntent = "next" | "due" | "count" | "list" | "supervisor" | "status";

export interface AssessmentGrammarMatch {
  readonly isAssessmentQuery: true;
  readonly category: AssessmentCategory;
  readonly intent: AssessmentQueryIntent;
  readonly matchedTerms: readonly string[];
  readonly timeframe?: string;
  readonly understood: string;
  readonly targetArea: "assessments" | "teaching" | "alerts";
}

// Regex patterns for assessment domains
const EPA_PATTERN = /\b(epas?|entrustable professional activit(?:y|ies)|epa milestones?)\b/i;
const WBA_PATTERN = /\b(wbas?|workplace[ -]based assessments?|mini[ -]cex|cbds?|case[ -]based discussions?|dops)\b/i;
const TERM_ASSESSMENT_PATTERN =
  /\b(term assessments?|itas?|mid[ -]term (?:review|assessment)?|end[ -]of[ -]term (?:assessment|review)|term evaluation)\b/i;
const SUPERVISOR_PATTERN =
  /\b(supervisors? (?:review|assessment|meeting|report)|clinical supervisors?|dct review|director of clinical training)\b/i;
const ALERT_PATTERN = /\b(assessment alerts?|assessment reminders?|overdue alerts?|training alerts?)\b/i;
const GENERAL_ASSESSMENT_PATTERN = /\b(assessments?|assessed|evaluations?|appraisals?)\b/i;
const ROSTER_SUBJECT_PATTERN = /\b(shifts?|nights?|evenings?|days? off|free days?)\b/i;

// Intent patterns
const SUPERVISOR_QUERY_PATTERN =
  /\b(who is (?:my )?(?:clinical )?(?:supervisor|assessing me)|my (?:clinical )?supervisor)\b/i;
const DUE_PATTERN = /\b(due|overdue|pending|need to complete|deadline|expir\w*)\b/i;
const COUNT_PATTERN = /\b(how many|count|number of|remaining|hours? left)\b/i;
const NEXT_PATTERN = /\b(upcoming|(?:when is (?:my )?)?next|when am i next)\b/i;

// Timeframe patterns
const TIMEFRAMES: readonly [RegExp, string][] = [
  [/\bthis week\b/i, "this week"],
  [/\bnext week\b/i, "next week"],
  [/\bthis month\b/i, "this month"],
  [/\bnext month\b/i, "next month"],
  [/\bthis term\b/i, "this term"],
  [/\bnext term\b/i, "next term"],
  [/\boverdue\b/i, "overdue"],
  [/\btoday\b/i, "today"],
];

function detectTimeframe(text: string): string | undefined {
  for (const [pattern, label] of TIMEFRAMES) {
    if (pattern.test(text)) return label;
  }
  return undefined;
}

/**
 * Checks whether a user query matches any assessment-specific grammar pattern.
 */
export function isAssessmentQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < 3) return false;

  return (
    EPA_PATTERN.test(q) ||
    WBA_PATTERN.test(q) ||
    TERM_ASSESSMENT_PATTERN.test(q) ||
    SUPERVISOR_PATTERN.test(q) ||
    SUPERVISOR_QUERY_PATTERN.test(q) ||
    ALERT_PATTERN.test(q) ||
    (GENERAL_ASSESSMENT_PATTERN.test(q) &&
      !ROSTER_SUBJECT_PATTERN.test(q) &&
      (NEXT_PATTERN.test(q) || DUE_PATTERN.test(q) || COUNT_PATTERN.test(q) || /\b(my|pending|complete)\b/i.test(q)))
  );
}

/**
 * Parses an assessment query into its structured grammar representation.
 * Returns null if the query is unrelated to assessments.
 */
export function parseMyWorkAssessmentGrammar(query: string): AssessmentGrammarMatch | null {
  const text = query.trim();
  if (!isAssessmentQuery(text)) return null;

  const matchedTerms: string[] = [];
  let category: AssessmentCategory = "general_assessment";

  if (EPA_PATTERN.test(text)) {
    category = "epa";
    matchedTerms.push("epa", "entrustable");
  } else if (WBA_PATTERN.test(text)) {
    category = "wba";
    matchedTerms.push("wba", "mini-cex", "cbd", "dops");
  } else if (TERM_ASSESSMENT_PATTERN.test(text)) {
    category = "term_assessment";
    matchedTerms.push("term assessment", "term review", "term evaluation", "ita", "mid-term", "end-of-term");
  } else if (SUPERVISOR_PATTERN.test(text) || SUPERVISOR_QUERY_PATTERN.test(text)) {
    category = "supervisor_review";
    matchedTerms.push("supervisor");
  } else if (ALERT_PATTERN.test(text)) {
    category = "alert";
    matchedTerms.push("alert");
  } else if (GENERAL_ASSESSMENT_PATTERN.test(text)) {
    category = "general_assessment";
    matchedTerms.push("assessment");
  }

  // Detect query intent: supervisor > count > due > next > status > list
  let intent: AssessmentQueryIntent = "list";
  if (SUPERVISOR_QUERY_PATTERN.test(text)) {
    intent = "supervisor";
  } else if (COUNT_PATTERN.test(text)) {
    intent = "count";
  } else if (DUE_PATTERN.test(text)) {
    intent = "due";
  } else if (NEXT_PATTERN.test(text) || /\bwhen is\b/i.test(text)) {
    intent = "next";
  } else if (/\b(status|progress|track)\b/i.test(text)) {
    intent = "status";
  }

  const timeframe = detectTimeframe(text);

  // Formulate human-readable description of what was understood
  let understood = "";
  const catLabel =
    category === "epa"
      ? "EPA milestones"
      : category === "wba"
        ? "Workplace-Based Assessments (WBAs)"
        : category === "term_assessment"
          ? "term assessments"
          : category === "supervisor_review"
            ? "supervisor meetings and reviews"
            : category === "alert"
              ? "active assessment alerts"
              : "assessments";

  if (intent === "next") {
    understood = `Showing your next upcoming ${catLabel}`;
  } else if (intent === "due") {
    understood = timeframe ? `Showing ${catLabel} due ${timeframe}` : `Showing pending and overdue ${catLabel}`;
  } else if (intent === "count") {
    understood = `Showing progress count for ${catLabel}`;
  } else if (intent === "supervisor") {
    understood = "Showing your assigned clinical supervisor and review schedule";
  } else if (intent === "status") {
    understood = `Showing current completion status for ${catLabel}`;
  } else {
    understood = `Showing ${catLabel}`;
  }

  const targetArea: "assessments" | "teaching" | "alerts" = category === "alert" ? "alerts" : "assessments";

  return {
    isAssessmentQuery: true,
    category,
    intent,
    matchedTerms,
    timeframe,
    understood,
    targetArea,
  };
}

/**
 * Extracts normalized query terms for Search My Work indexing and filtering.
 */
export function extractAssessmentQueryTerms(query: string): {
  category: AssessmentCategory;
  terms: string[];
} | null {
  const match = parseMyWorkAssessmentGrammar(query);
  if (!match) return null;

  const terms = [...match.matchedTerms];
  if (match.timeframe) terms.push(match.timeframe);
  terms.push(match.category);
  terms.push(match.intent);

  return {
    category: match.category,
    terms,
  };
}
