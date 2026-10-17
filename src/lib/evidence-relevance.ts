import {
  hasDoseEvidenceSupport,
  normalizedClinicalSearchTokens,
  medicationDoseEvidenceQueryIntent,
} from "@/lib/clinical-search";
import { sourceTextForDisplay } from "@/lib/source-text-sanitizer";
import { hasClinicalActionSignal, hasClinicalPopulationSignal } from "@/lib/rag/rag-clinical-language-signals";
import { parseAnswerRequestContext } from "@/lib/answer-request-context";
import { atomicNmhsClozapineRedRangeSegment } from "@/lib/rag/rag-source-segmentation";
import type {
  DocumentMatch,
  EvidenceRelevance,
  EvidenceRelevanceVerdict,
  SearchResult,
  SourceEvidenceRelevance,
  SourceStrength,
} from "@/lib/types";

const genericQueryTerms = new Set([
  "and",
  "answer",
  "available",
  "because",
  "before",
  "could",
  "clinical",
  "consider",
  "document",
  "does",
  "evidence",
  "for",
  "from",
  "have",
  "guideline",
  "help",
  "how",
  "indexed",
  "information",
  "issue",
  "item",
  "list",
  "management",
  "overview",
  "passage",
  "patient",
  "policy",
  "question",
  "recommendation",
  "review",
  "reviewed",
  "reviewing",
  "shown",
  "should",
  "source",
  "support",
  "table",
  "text",
  "that",
  "the",
  "these",
  "this",
  "those",
  "would",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const namedMedicationTerms = new Set([
  "amisulpride",
  "aripiprazole",
  "carbamazepine",
  "clozapine",
  "diazepam",
  "droperidol",
  "haloperidol",
  "lamotrigine",
  "lithium",
  "lorazepam",
  "olanzapine",
  "paliperidone",
  "promethazine",
  "quetiapine",
  "risperidone",
  "valproate",
  "zuclopenthixol",
]);

const verdictLabels: Record<EvidenceRelevanceVerdict, string> = {
  direct: "Direct match",
  partial: "Partial match",
  nearby: "Nearby only",
  none: "No direct indexed evidence",
};

function uniq(values: string[], limit = 8) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTerm(term: string) {
  const cleaned = term.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (cleaned.endsWith("s") && !cleaned.endsWith("ss")) return cleaned.slice(0, -1);
  return cleaned;
}

// Requirement verbs frame the question like "should" does. Kept as terms, they
// let any passage that happens to say "required" outrank the guideline on the
// topic. They are removed before plural stripping, so the nouns "needs" and
// "requirements" still name a subject. "needs" goes only as the verb in "needs to",
// and "need" stays after a determiner or modifier, as in "the clinical need for".
const requirementVerbs =
  /\b(?<!\b(?:a|an|the|this|that|any|no|clinical|unmet|support|care|their|his|her|its|our|your)\s+)need\b|\b(?:needed|require|required|requires)\b|\bneeds(?=\s+to\b)/gi;

// Only this interrogative scaffold becomes a semantic cadence requirement.
const monitoringFrequencyQuestion =
  /\bHow often (?:is|are) ([^?.]+?) (?:checked|monitored|measured|reviewed)(?=[?.]|$|\s+(?:in|for|with|without|among)\b)/i;
const physiologicalMeasurementNouns = ["blood pressure", "renal function", "thyroid function"];
const monitoringMeasurementPattern = new RegExp(
  `\\b(?:levels?|concentrations?|${physiologicalMeasurementNouns.join("|")})\\b`,
  "i",
);

export function queryCoreTerms(query: string) {
  const context = parseAnswerRequestContext(query);
  const request = context
    ? [
        context.subject,
        ...context.constraints,
        context.latestRequest.replace(/^(?:please\s+)?elaborate[.!?]*$/i, ""),
      ].join(" ")
    : query;
  // Planner wording is not an evidence requirement. Keep the facet after the
  // exact scaffold, and keep clinical uses of "focus" and "apply" elsewhere.
  const semanticQuery = request
    .replace(/\bFocus on the requested\s+/g, "")
    .replace(/\b(What|Which)\b([^?.]*?)\bappl(?:y|ies) to\b/gi, "$1$2for")
    .replace(monitoringFrequencyQuestion, "$1 frequency")
    .replace(requirementVerbs, " ");
  const normalized = normalizedClinicalSearchTokens(semanticQuery).map(normalizeTerm).filter(Boolean);
  const raw = (semanticQuery.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(normalizeTerm).filter(Boolean);
  const candidates = uniq([...normalized, ...raw], 14);
  const specific = candidates.filter((term) => term.length >= 3 && !genericQueryTerms.has(term));
  return specific.length ? specific.slice(0, 10) : candidates.filter((term) => term.length >= 3).slice(0, 10);
}

function textIncludesTerm(text: string, term: string) {
  if (!term) return false;
  if (term.length <= 3) return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  return text.includes(term);
}

function normalizeSearchText(value: string) {
  return sourceTextForDisplay(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

const coordinatedSupportNounPattern = /^\s+(?:needs?|requirements?)\b/i;

function hasCoordinatedClinicalPredicate(value: string) {
  const match = value.match(/^\s*(?:(?:also|please|should|must|may|can|will|be)\s+){0,3}([a-z]+)\b(.*)$/i);
  const head = match?.[1];
  if (!head) return false;
  if (head.toLowerCase() === "support" && coordinatedSupportNounPattern.test(match?.[2] ?? "")) return false;
  return hasClinicalActionSignal(head);
}

function boundMonitoringCadencePredicates(text: string, requestedSubject?: string) {
  // Classify cadence attachment only; source authority and clinical support are separate gates.
  // Require recurrence, not a baseline, deadline or course duration. Context such
  // as "during daily treatment" cannot lend its cadence to the monitoring action.
  const clauses = text.split(
    /[.!?;]|\b(?:but|while|during|before|after|until|when|with|without|alongside|throughout|using|as|for)\b/i,
  );
  const action =
    /\b(?:monitor(?:ed|s|ing)?|check(?:ed|s|ing)?|measur(?:e|ed|es|ing)|review(?:ed|s|ing)?|follow[- ]?up|blood tests?)\b/gi;
  const cadence =
    /\b(?:every\s+(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(?:hours?|days?|weeks?|months?|years?)|(?:once|twice|three times)\s+(?:a|per|each)\s+(?:hour|day|week|month|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -](?:hour|day|week|month|year)(?:ly)?\s+intervals|hourly|daily|weekly|fortnightly|monthly|quarterly|annual(?:ly)?|yearly)\b/gi;
  const otherAction =
    /\b(?:start\w*|commenc\w*|continu\w*|tak(?:e|es|en|ing)|giv(?:e|es|en|ing)|administer\w*|prescrib\w*|receiv\w*|treat(?:s|ed|ing)?|dos(?:e|es|ing))\b|\band\b[^,;]*\b(?:treatment|therapy|regimen)\b/i;
  const predicates: Array<{ text: string; populationText: string; subjectText: string; contextText: string }> = [];
  const requestedNoun = requestedSubject ? normalizeSearchText(requestedSubject).trim() : null;
  const isMeasurementNoun = (value: string) => {
    const noun = normalizeSearchText(value).trim();
    if (noun === requestedNoun || physiologicalMeasurementNouns.includes(noun)) return true;
    const medicationMeasurement = noun.match(/^([a-z]+) (?:levels?|concentrations?)$/);
    return Boolean(medicationMeasurement && namedMedicationTerms.has(medicationMeasurement[1]));
  };
  const beforeNextPredicate = (value: string) => {
    for (const conjunction of value.matchAll(/\b(?:and|or|then)\b/gi)) {
      if (hasCoordinatedClinicalPredicate(value.slice(conjunction.index + conjunction[0].length)))
        return value.slice(0, conjunction.index);
    }
    return value;
  };
  const addPredicate = (text: string, object: string, subjectText = text, contextText = text) => {
    // The shared population vocabulary includes renal/hepatic. A plain function
    // measurement in this action's object list is not a patient restriction.
    // Qualifying words (e.g. impairment), prepositions and other predicates stay.
    const populationObject = object.replace(
      /(^|\b(?:and|or)\b)\s*(?:renal|hepatic) function\s*(?=\b(?:and|or)\b|$)/gi,
      "$1 ",
    );
    predicates.push({ text, populationText: text.replace(object, populationObject), subjectText, contextText });
  };
  for (const clause of clauses) {
    for (const schedule of clause.matchAll(cadence)) {
      const before = clause.slice(0, schedule.index);
      const after = clause.slice(schedule.index + schedule[0].length);
      const monitoring = [...before.matchAll(action)].at(-1);
      // A trailing adverb/interval modifies the monitoring predicate only if no
      // intervening action, context preposition or comma makes attachment unclear.
      if (monitoring) {
        const object = before.slice(monitoring.index + monitoring[0].length).replace(/\bon\s+(?:an?\s+)?$/i, "");
        // Consult the shared vocabulary only at a coordinated predicate head.
        // Scanning whole objects would mistake "medication use" or "family
        // support" for separate actions. An action following "and also" still
        // owns its own cadence; ordinary coordinated monitored nouns do not.
        const competingPredicate = object
          .split(/\b(?:and|or|then)\b/i)
          .slice(1)
          .some(hasCoordinatedClinicalPredicate);
        if (
          !/[,;]|\b(?:on|to)\b/i.test(object) &&
          !otherAction.test(object) &&
          !competingPredicate &&
          /^\s*(?:basis|intervals)?\s*(?:(?:and|then)\b|$)/i.test(after)
        ) {
          // Bind the interval to its own predicate and objects. Earlier actions
          // in this sentence cannot supply this predicate's requested subject.
          const passive = /\b(?:(?:has|have|had)\s+)?(?:(?:is|are|was|were|be|been|being)\s*)+$/i.exec(
            before.slice(0, monitoring.index),
          );
          let start = monitoring.index;
          let passiveSubject: string | undefined;
          if (passive) {
            const prefix = before.slice(0, passive.index);
            const joins = [...prefix.matchAll(/\b(?:and|or|then)\b/gi)];
            start = passive.index;
            passiveSubject = "";
            // Extend only across a contiguous suffix of demonstrated measurement
            // nouns. Unknown/descriptive conjuncts stop the subject, even when
            // an earlier conjunct contains the requested medicine/measurement.
            for (let index = joins.length; index >= 0; index -= 1) {
              const previousJoin = joins[index - 1];
              const nextJoin = joins[index];
              const nounStart = previousJoin ? previousJoin.index + previousJoin[0].length : 0;
              const nounEnd = nextJoin?.index ?? prefix.length;
              if (!isMeasurementNoun(prefix.slice(nounStart, nounEnd))) break;
              start = nounStart;
              passiveSubject = prefix.slice(start).trim();
            }
          }
          // Context between this action and its interval belongs to this
          // monitoring predicate; later predicates cannot supply its qualifiers.
          addPredicate(beforeNextPredicate(clause.slice(start)), passiveSubject ?? object, passiveSubject, object);
        }
      }
      // Also retain an explicit preposed schedule: "Monthly monitoring ..." or
      // "Every three months, monitor ...". It must introduce the action itself.
      if (
        !before.trim() &&
        /^\s*,?\s*(?:monitor(?:ed|s|ing)?|check(?:ed|s|ing)?|review(?:ed|s|ing)?|follow[- ]?up|blood tests?)\b/i.test(
          after,
        )
      ) {
        const predicate = beforeNextPredicate(after);
        const monitoring = [...predicate.matchAll(action)][0]!;
        addPredicate(predicate, predicate.slice(monitoring.index + monitoring[0].length));
      }
    }
  }
  return predicates;
}

export function hasBoundMonitoringCadence(text: string) {
  return boundMonitoringCadencePredicates(text).length > 0;
}

export function isBoundMonitoringFrequencyQuestion(query: string) {
  const match = query
    .trim()
    .match(
      /^How often (?:is|are) ([^?.]+?) (?:checked|monitored|measured|reviewed)(?:\s+(?:in|for|with|without|among)\b[^?.]*)?[?.]?$/i,
    );
  const doseIntent = medicationDoseEvidenceQueryIntent(query);
  return Boolean(
    match &&
    monitoringMeasurementPattern.test(match[1]) &&
    !doseIntent.asksAmount &&
    !doseIntent.asksRoute &&
    !/\b(?:doses?|dosing|administer\w*|prescrib\w*|increas\w*)\b/i.test(query),
  );
}

/** Predicate-local measurement, subject and cadence binding; authority is checked separately. */
export function requestedMonitoringCadence(query: string, prose: string) {
  const requestedSubject = query.match(monitoringFrequencyQuestion)?.[1];
  if (!requestedSubject) return false;
  const subjectTerms = queryCoreTerms(requestedSubject);
  const contextTerms = queryCoreTerms(query).filter((term) => term !== "frequency" && !subjectTerms.includes(term));
  // Do not borrow a neighbouring measurement or population's interval.
  const queryTokens = new Set(normalizedClinicalSearchTokens(query));
  const sourceConstraintsMatch = (sentence: string) => {
    const constraint = sentence.match(
      /\b(?:with|without|in|among|during|before|after|aged|for|only|unless|if|when)\b(.+?)(?=\bevery\b|$)/i,
    )?.[0];
    return !constraint || normalizedClinicalSearchTokens(constraint).every((term) => queryTokens.has(term));
  };
  return prose.split(/[.!?;]/).some((sentence) =>
    boundMonitoringCadencePredicates(sentence, requestedSubject).some(
      (predicate) =>
        subjectTerms.every((term) => textIncludesTerm(normalizeSearchText(predicate.subjectText), term)) &&
        contextTerms.every((term) => textIncludesTerm(normalizeSearchText(predicate.contextText), term)) &&
        sourceConstraintsMatch(sentence) &&
        normalizedClinicalSearchTokens(sentence.replace(predicate.text, predicate.populationText))
          .filter(hasClinicalPopulationSignal)
          .every((term) => queryTokens.has(term)) &&
        ["not", "never", "without"].every(
          (term) => !new RegExp(`\\b${term}\\b`, "i").test(sentence) || queryTokens.has(term),
        ),
    ),
  );
}

/** Content-only completeness signal for already verified delivered prose; never source or clinical support. */
export function deliveredProseRelevance(query: string, prose: string) {
  const coreTerms = queryCoreTerms(query);
  const normalized = normalizeSearchText(prose);
  const matchedTerms = coreTerms.filter((term) =>
    term === "frequency" && monitoringFrequencyQuestion.test(query)
      ? requestedMonitoringCadence(query, prose)
      : textIncludesTerm(normalized, term),
  );
  const missingTerms = coreTerms.filter((term) => !matchedTerms.includes(term));
  return {
    coreTerms,
    matchedTerms,
    missingTerms,
    direct:
      coreTerms.length > 0 &&
      matchedTerms.length / coreTerms.length >= 0.72 &&
      matchedTerms.length >= Math.min(2, Math.max(1, coreTerms.length)),
  };
}

function labelsText(labels?: Array<{ label?: string | null; label_type?: string | null }>) {
  return (labels ?? []).map((label) => `${label.label_type ?? ""} ${label.label ?? ""}`).join(" ");
}

function sourceTextBlocks(source: SearchResult) {
  const title = normalizeSearchText(
    `${source.title} ${source.file_name} ${source.section_heading ?? ""} ${(source.section_path ?? []).join(" ")} ${source.retrieval_synopsis ?? ""}`,
  );
  const content = normalizeSearchText(
    [
      source.content,
      source.adjacent_context ?? "",
      ...(source.table_facts ?? []).map((fact) =>
        [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
          .filter(Boolean)
          .join(" "),
      ),
      ...(source.memory_cards ?? []).map((card) => `${card.title} ${card.content}`),
      ...(source.images ?? []).map((image) =>
        [
          image.caption,
          image.tableLabel,
          image.tableTitle,
          image.tableTextSnippet,
          image.accessibleTableMarkdown,
          image.labels?.join(" "),
        ]
          .filter(Boolean)
          .join(" "),
      ),
    ].join(" "),
  );
  const metadata = normalizeSearchText(`${labelsText(source.document_labels)} ${source.document_summary ?? ""}`);
  return { title, content, metadata, all: `${title} ${content} ${metadata}` };
}

function baseRankScore(source: SearchResult | DocumentMatch) {
  const raw =
    "score" in source
      ? source.score
      : (source.score_explanation?.finalScore ?? source.hybrid_score ?? source.similarity ?? 0);
  return clamp(Number.isFinite(raw) ? raw : 0);
}

function sourceStrengthBonus(strength: SourceStrength | undefined) {
  if (strength === "strong") return 0.16;
  if (strength === "moderate") return 0.08;
  if (strength === "limited") return -0.05;
  return 0;
}

function directnessVerdict(args: {
  coreTerms: string[];
  medicationTerms: string[];
  matchedTerms: string[];
  contentMatchedTerms: string[];
  coverageScore: number;
  rankScore: number;
  strength?: SourceStrength;
  doseQuery: boolean;
  hasDoseEvidence: boolean;
}) {
  const medicationCovered =
    args.medicationTerms.length === 0 || args.medicationTerms.every((term) => args.matchedTerms.includes(term));
  const enoughContent = args.contentMatchedTerms.length >= Math.min(2, Math.max(1, args.coreTerms.length));
  const enoughScore = args.rankScore >= 0.5 || args.strength === "strong" || args.strength === "moderate";
  const hasDoseSupport = !args.doseQuery || args.hasDoseEvidence;

  if (
    args.coreTerms.length > 0 &&
    medicationCovered &&
    hasDoseSupport &&
    args.coverageScore >= 0.72 &&
    enoughContent &&
    enoughScore
  ) {
    return "direct" satisfies EvidenceRelevanceVerdict;
  }

  if (
    args.matchedTerms.length > 0 &&
    medicationCovered &&
    hasDoseSupport &&
    (args.coverageScore >= 0.5 ||
      (args.coverageScore >= 0.42 &&
        (args.rankScore >= 0.5 || args.strength === "strong" || args.strength === "moderate")) ||
      args.contentMatchedTerms.length >= 3)
  ) {
    return "partial" satisfies EvidenceRelevanceVerdict;
  }

  if (args.matchedTerms.length > 0 || args.rankScore > 0) return "nearby" satisfies EvidenceRelevanceVerdict;
  return "none" satisfies EvidenceRelevanceVerdict;
}

function supportReason(
  relevance: Pick<SourceEvidenceRelevance, "verdict" | "matchedTerms" | "missingTerms" | "rankScore">,
) {
  if (relevance.verdict === "direct") {
    return `Matched core concepts: ${relevance.matchedTerms.slice(0, 4).join(", ")}.`;
  }
  if (relevance.verdict === "partial") {
    return relevance.missingTerms.length
      ? `Some query concepts are supported, but missing: ${relevance.missingTerms.slice(0, 4).join(", ")}.`
      : "Some query concepts are supported by retrieved source text.";
  }
  if (relevance.verdict === "nearby") {
    return relevance.matchedTerms.length
      ? `Only adjacent concepts matched: ${relevance.matchedTerms.slice(0, 4).join(", ")}.`
      : "Retrieved passages scored as nearby neighbors without direct concept coverage.";
  }
  return "No retrieved indexed passage covered the query concepts.";
}

function relevanceChips(relevance: Pick<SourceEvidenceRelevance, "verdict" | "matchedTerms" | "missingTerms">) {
  const chips: string[] = [];
  if (relevance.matchedTerms.length) chips.push(`matched: ${relevance.matchedTerms.slice(0, 3).join(", ")}`);
  if (relevance.missingTerms.length) chips.push(`missing: ${relevance.missingTerms.slice(0, 3).join(", ")}`);
  if (relevance.verdict === "direct") chips.push("direct evidence");
  if (relevance.verdict === "partial") chips.push("partial support");
  if (relevance.verdict === "nearby") chips.push("nearby only");
  if (relevance.verdict === "none") chips.push("no direct support");
  if (relevance.verdict === "nearby" || relevance.verdict === "none") chips.push("limited support");
  return chips.slice(0, 4);
}

function hasStructuredThresholdComparisonInput(query: string, source: SearchResult, coreTerms: readonly string[]) {
  if (!/^\s*(?:compare|reconcile)\b/i.test(query) || !/\bthresholds?\b/i.test(query)) return false;
  const comparisonIntent = new Set(["compare", "comparison", "reconcile", "implication"]);
  const factualTerms = coreTerms.filter((term) => !comparisonIntent.has(term));
  if (!factualTerms.length) return false;
  const constraint = query.match(
    /\b(?:before|after|until|unless|if|when|without|not|only|with|in|among)\b[^?.]*/i,
  )?.[0];
  return (source.table_facts ?? []).some((fact) => {
    if (
      fact.document_id !== source.document_id ||
      fact.source_chunk_id !== source.id ||
      !fact.clinical_parameter?.trim() ||
      !/\d/.test(fact.threshold_value ?? "") ||
      !fact.action?.trim() ||
      !hasClinicalActionSignal(fact.action)
    )
      return false;
    const parameterTerms = normalizedClinicalSearchTokens(fact.clinical_parameter).map(normalizeTerm);
    if (!parameterTerms.length || !parameterTerms.every((term) => coreTerms.includes(term))) return false;
    // Only the matching, identity-bound fact can supply the requested factual
    // comparison inputs. Other rows cannot lend a parameter, threshold or action.
    const factText = normalizeSearchText(
      [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action].join(" "),
    );
    if (!factualTerms.every((term) => textIncludesTerm(factText, term))) return false;
    return !constraint || factText.includes(normalizeSearchText(constraint).trim());
  });
}

const bloodStopBoundaryTerms = new Set([
  "anc",
  "fbc",
  "wbc",
  "wcc",
  "absolute",
  "neutrophil",
  "full",
  "blood",
  "count",
  "white",
  "cell",
  "threshold",
  "withhold",
  "withheld",
  "stop",
  "cease",
]);

function hasSourceBoundBloodStopBoundary(query: string, source: SearchResult) {
  // Only an unqualified blood-count stop-boundary request can use this semantic
  // match. Check ALL raw words, before queryCoreTerms truncation, so populations,
  // negation and additional clinical constraints cannot disappear.
  const words: string[] = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const scaffold = new Set(["what", "which", "is", "are", "the", "or", "and", "should", "clozapine"]);
  if (
    !words.includes("clozapine") ||
    !words.some((word) => ["anc", "fbc", "wbc", "wcc", "neutrophil", "blood"].includes(word)) ||
    !words.some((word) => ["withhold", "withheld", "stop", "cease"].includes(word)) ||
    !words.every((word) => scaffold.has(word) || bloodStopBoundaryTerms.has(normalizeTerm(word)))
  )
    return false;
  // Reuse the existing exact, single-source row binding. Captions, adjacent
  // chunks, lexical overlap and other documents cannot supply its boundaries.
  return Boolean(
    atomicNmhsClozapineRedRangeSegment({
      sourceLabel: `${source.title} ${source.file_name}`,
      content: source.content,
    }),
  );
}

export function buildSourceRelevance(query: string, source: SearchResult): SourceEvidenceRelevance {
  const coreTerms = queryCoreTerms(query);
  const medicationTerms = coreTerms.filter((term) => namedMedicationTerms.has(term));
  const blocks = sourceTextBlocks(source);
  const boundBloodStopBoundary = hasSourceBoundBloodStopBoundary(query, source);
  const titleMatchedTerms = coreTerms.filter(
    (term) =>
      !(term === "frequency" && monitoringFrequencyQuestion.test(query)) && textIncludesTerm(blocks.title, term),
  );
  const contentMatchedTerms = coreTerms.filter((term) =>
    term === "frequency" && monitoringFrequencyQuestion.test(query)
      ? requestedMonitoringCadence(query, source.content)
      : textIncludesTerm(blocks.content, term) || (boundBloodStopBoundary && bloodStopBoundaryTerms.has(term)),
  );
  const metadataMatchedTerms = coreTerms.filter(
    (term) =>
      !(term === "frequency" && monitoringFrequencyQuestion.test(query)) && textIncludesTerm(blocks.metadata, term),
  );
  const matchedTerms = uniq([...contentMatchedTerms, ...titleMatchedTerms, ...metadataMatchedTerms], 10);
  const missingTerms = coreTerms.filter((term) => !matchedTerms.includes(term));
  const coverageScore = coreTerms.length ? matchedTerms.length / coreTerms.length : 0;
  const contentCoverage = coreTerms.length ? contentMatchedTerms.length / coreTerms.length : 0;
  const rankScore = baseRankScore(source);
  const doseQuery =
    /\b(?:dose|dosing|dosage|mg|mcg|microgram|route|oral|intramuscular|\bim\b|\bpo\b|\bprn\b|titrate|titration|maximum)\b/i.test(
      query,
    );
  const lexicalVerdict = directnessVerdict({
    coreTerms,
    medicationTerms,
    matchedTerms,
    contentMatchedTerms,
    coverageScore,
    rankScore,
    strength: source.source_strength,
    doseQuery,
    hasDoseEvidence: hasDoseEvidenceSupport(source),
  });
  // Preserve the missing comparison/reconciliation/implication intent. This
  // admits factual inputs as partial; it cannot establish a complete answer.
  const verdict =
    (lexicalVerdict === "nearby" || lexicalVerdict === "none") &&
    hasStructuredThresholdComparisonInput(query, source, coreTerms)
      ? "partial"
      : lexicalVerdict;
  const score = clamp(
    coverageScore * 0.52 + contentCoverage * 0.23 + rankScore * 0.2 + sourceStrengthBonus(source.source_strength),
  );
  const partial: SourceEvidenceRelevance = {
    verdict,
    label: verdictLabels[verdict],
    matchedTerms,
    missingTerms,
    directSourceCount: verdict === "direct" ? 1 : 0,
    weakSourceCount: verdict === "nearby" || verdict === "none" ? 1 : 0,
    score: Number(score.toFixed(3)),
    supportReason: "",
    isSourceBacked: verdict === "direct" || verdict === "partial",
    coverageScore: Number(coverageScore.toFixed(3)),
    rankScore: Number(rankScore.toFixed(3)),
    titleMatchedTerms,
    contentMatchedTerms,
    metadataMatchedTerms,
    chips: [],
  };
  partial.supportReason = supportReason(partial);
  partial.chips = relevanceChips(partial);
  return partial;
}

export function annotateSearchResults(query: string, results: SearchResult[]) {
  return results.map((result) => ({
    ...result,
    relevance: result.relevance ?? buildSourceRelevance(query, result),
  }));
}

export function buildEvidenceRelevance(query: string, results: SearchResult[]): EvidenceRelevance {
  if (results.length === 0) {
    return {
      verdict: "none",
      label: verdictLabels.none,
      matchedTerms: [],
      missingTerms: queryCoreTerms(query),
      directSourceCount: 0,
      weakSourceCount: 0,
      score: 0,
      supportReason: "No indexed passages were retrieved for the query.",
      isSourceBacked: false,
    };
  }

  const annotated = results.map((result) => result.relevance ?? buildSourceRelevance(query, result));
  const directSourceCount = annotated.filter((item) => item.verdict === "direct").length;
  const partialSourceCount = annotated.filter((item) => item.verdict === "partial").length;
  const weakSourceCount = annotated.filter((item) => item.verdict === "nearby" || item.verdict === "none").length;
  const matchedTerms = uniq(
    annotated.flatMap((item) => item.matchedTerms),
    10,
  );
  const coreTerms = queryCoreTerms(query);
  const missingTerms = coreTerms.filter((term) => !matchedTerms.includes(term));
  const topScore = Math.max(0, ...annotated.map((item) => item.score));
  const avgTopScore =
    annotated
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .reduce((sum, item) => sum + item.score, 0) / Math.min(3, annotated.length);
  const score = Number(Math.max(topScore, avgTopScore).toFixed(3));
  const verdict: EvidenceRelevanceVerdict =
    directSourceCount > 0 && missingTerms.length === 0
      ? "direct"
      : directSourceCount > 0 || partialSourceCount > 0
        ? "partial"
        : // Audit L3: base nearby-vs-none on matched terms. `results.length > 0`
          // was always true here (empty results early-return above), which made
          // the aggregate "none" verdict unreachable and overstated evidence
          // for result sets matching zero query terms. Strong retrieval scores
          // still count as "nearby" (diff-review hardening): term matching is
          // purely lexical, so a good semantic match ("myocardial infarction"
          // for "heart attack") must not degrade to "none" and trip the
          // danger-level governance banner while every per-source chip reads
          // "nearby".
          matchedTerms.length > 0 || score >= 0.5
          ? "nearby"
          : "none";
  const relevance: EvidenceRelevance = {
    verdict,
    label: verdictLabels[verdict],
    matchedTerms,
    missingTerms,
    directSourceCount,
    weakSourceCount,
    score,
    supportReason: "",
    isSourceBacked: verdict === "direct" || verdict === "partial",
  };
  relevance.supportReason =
    verdict === "direct"
      ? `Direct indexed support found in ${directSourceCount} source${directSourceCount === 1 ? "" : "s"}.`
      : verdict === "partial"
        ? missingTerms.length
          ? `Partial indexed support found; missing: ${missingTerms.slice(0, 4).join(", ")}.`
          : "Partial indexed support found across retrieved sources."
        : verdict === "nearby"
          ? "Retrieved sources are weak or adjacent; treat them as nearby evidence only."
          : "No direct indexed evidence was found.";
  return relevance;
}

function buildDocumentText(document: DocumentMatch) {
  return normalizeSearchText(
    [
      document.title,
      document.file_name,
      document.summarySnippet ?? "",
      document.matchReason,
      labelsText(document.labels),
    ].join(" "),
  );
}

function documentFallbackRelevance(query: string, document: DocumentMatch): SourceEvidenceRelevance {
  const coreTerms = queryCoreTerms(query);
  const haystack = buildDocumentText(document);
  const matchedTerms = coreTerms.filter((term) => textIncludesTerm(haystack, term));
  const missingTerms = coreTerms.filter((term) => !matchedTerms.includes(term));
  const coverageScore = coreTerms.length ? matchedTerms.length / coreTerms.length : 0;
  const rankScore = baseRankScore(document);
  const verdict: EvidenceRelevanceVerdict =
    coverageScore >= 0.75 && rankScore >= 0.5
      ? "direct"
      : coverageScore >= 0.38
        ? "partial"
        : matchedTerms.length || rankScore > 0
          ? "nearby"
          : "none";
  const score = clamp(coverageScore * 0.65 + rankScore * 0.25);
  const relevance: SourceEvidenceRelevance = {
    verdict,
    label: verdictLabels[verdict],
    matchedTerms,
    missingTerms,
    directSourceCount: verdict === "direct" ? 1 : 0,
    weakSourceCount: verdict === "nearby" || verdict === "none" ? 1 : 0,
    score: Number(score.toFixed(3)),
    supportReason: "",
    isSourceBacked: verdict === "direct" || verdict === "partial",
    coverageScore: Number(coverageScore.toFixed(3)),
    rankScore: Number(rankScore.toFixed(3)),
    titleMatchedTerms: matchedTerms,
    contentMatchedTerms: [],
    metadataMatchedTerms: matchedTerms,
    chips: [],
  };
  relevance.supportReason = supportReason(relevance);
  relevance.chips = relevanceChips(relevance);
  return relevance;
}

function combineDocumentSourceRelevance(query: string, document: DocumentMatch, sources: SearchResult[]) {
  if (sources.length === 0) return documentFallbackRelevance(query, document);
  const sourceRelevances = sources.map((source) => source.relevance ?? buildSourceRelevance(query, source));
  const directSourceCount = sourceRelevances.filter((item) => item.verdict === "direct").length;
  const partialSourceCount = sourceRelevances.filter((item) => item.verdict === "partial").length;
  const weakSourceCount = sourceRelevances.filter(
    (item) => item.verdict === "nearby" || item.verdict === "none",
  ).length;
  const coreTerms = queryCoreTerms(query);
  const matchedTerms = uniq(
    sourceRelevances.flatMap((item) => item.matchedTerms),
    10,
  );
  const missingTerms = coreTerms.filter((term) => !matchedTerms.includes(term));
  const score = Number(Math.max(document.score, ...sourceRelevances.map((item) => item.score)).toFixed(3));
  const verdict: EvidenceRelevanceVerdict =
    directSourceCount > 0 && missingTerms.length === 0
      ? "direct"
      : directSourceCount > 0 || partialSourceCount > 0
        ? "partial"
        : matchedTerms.length || document.score > 0
          ? "nearby"
          : "none";
  const relevance: SourceEvidenceRelevance = {
    verdict,
    label: verdictLabels[verdict],
    matchedTerms,
    missingTerms,
    directSourceCount,
    weakSourceCount,
    score,
    supportReason: "",
    isSourceBacked: verdict === "direct" || verdict === "partial",
    coverageScore: coreTerms.length ? Number((matchedTerms.length / coreTerms.length).toFixed(3)) : 0,
    rankScore: Number(document.score.toFixed(3)),
    titleMatchedTerms: uniq(
      sourceRelevances.flatMap((item) => item.titleMatchedTerms),
      6,
    ),
    contentMatchedTerms: uniq(
      sourceRelevances.flatMap((item) => item.contentMatchedTerms),
      6,
    ),
    metadataMatchedTerms: uniq(
      sourceRelevances.flatMap((item) => item.metadataMatchedTerms),
      6,
    ),
    chips: [],
  };
  relevance.supportReason = supportReason(relevance);
  relevance.chips = relevanceChips(relevance);
  return relevance;
}

export function annotateDocumentMatches(query: string, matches: DocumentMatch[], results: SearchResult[] = []) {
  const annotatedResults = annotateSearchResults(query, results);
  const byDocument = new Map<string, SearchResult[]>();
  for (const result of annotatedResults) {
    const list = byDocument.get(result.document_id) ?? [];
    list.push(result);
    byDocument.set(result.document_id, list);
  }
  return matches.map((match) => ({
    ...match,
    relevance: match.relevance ?? combineDocumentSourceRelevance(query, match, byDocument.get(match.document_id) ?? []),
  }));
}

export function weakEvidence(relevance: EvidenceRelevance | null | undefined) {
  return !relevance?.isSourceBacked || relevance.verdict === "nearby" || relevance.verdict === "none";
}
