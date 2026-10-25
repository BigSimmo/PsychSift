import { resolveAnswerRequestContext, renderAnswerRequestContext } from "@/lib/answer-request-context";
import { buildRelatedInformationMenu, type RelatedInformationMenuKey } from "@/lib/rag/answer-composition";
import type { ClientRagAnswerPayload } from "@/lib/answer-client-payload";
import type { AnswerSectionKind } from "@/lib/types";

const questionLeadPattern = /^(what|how|when|where|which|who|why|can|should|does|do|is|are)\b/i;

const followUpTopicNoise = new Set([
  "what",
  "how",
  "when",
  "where",
  "which",
  "who",
  "why",
  "can",
  "should",
  "does",
  "are",
  "required",
  "requirements",
  "action",
  "actions",
  "dosing",
  "dose",
  "drug",
  "for",
  "guidance",
  "guideline",
  "management",
  "medication",
  "monitoring",
  "policy",
  "protocol",
  "summarise",
  "summary",
  "the",
  "this",
  "toxicity",
  "with",
]);

function significantTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter(
    (token) => !["what", "when", "where", "which", "about", "does", "should", "would", "could"].includes(token),
  );
}

/** Build one bounded resolved user request for the strict query-only API. */
export function buildAnswerFollowUpQuery(priorQuery: string | undefined, followUp: string): string {
  if (!followUp.trim()) return "";
  return renderAnswerRequestContext(resolveAnswerRequestContext(priorQuery, followUp));
}

// ---------------------------------------------------------------------------
// Follow-up suggestion chips (RAG improvement programme, packet S3 / README §A4)
//
// The chips are deterministic and provider-free, and they are clinical output:
// a chip names a question this corpus is expected to be able to answer. Three
// rules make that claim honest, and each is pinned in tests/answer-follow-up.test.ts:
//
//   1. Candidates come from the S2 related-information menu
//      (`buildRelatedInformationMenu`, src/lib/rag/answer-composition.ts) for the
//      answer's own (queryClass, intent) cell — the same menu the generation
//      prompt was given. This module READS that menu and never changes it.
//   2. Evidence gate: a candidate is emitted only when the retrieved evidence the
//      client actually received mentions its subject matter. The client sees a
//      bounded ≤900-char snippet per source (trimSourceForClient in
//      answer-client-payload.ts), so the gate can under-suggest but never
//      over-suggest — the safe direction for a clinical surface.
//   3. Already-answered suppression: a menu kind that the answer already emitted
//      as an `answerSections` entry, or whose concept words are already in the
//      answer text, is dropped rather than offered back to the reader.
//
// Query classes whose menu is "none" (document_lookup, unsupported_or_general)
// keep the narrow legacy templates — §A2's "stays narrow" rule — but run through
// the same gate and suppression. When nothing survives, the function returns []
// and no chip row renders; that is the intended conservative outcome, not a bug.
// ---------------------------------------------------------------------------

// Suggestion anchoring retains its existing short-continuation heuristic.
const selfContainedFollowUpLength = 80;
const followUpCuePattern =
  /\b(what about|how about|and (?:for|in|with|the)|also|too\??$|same (?:for|with)|instead|as well|it\b|they\b|them\b|this\b|that\b|those\b|these\b)\b/i;
const maxFollowUpSuggestions = 4;

/** Bounded evidence scan: chips must cost nothing measurable inside the render memo. */
const maxEvidenceSources = 12;
const maxEvidenceFieldChars = 1200;
const maxEvidenceQuotes = 8;

function normalizeSuggestionKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizedEvidenceTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// Only these menu concepts accept the listed inflections. Query subjects are
// always exact tokens; a clinical acronym cannot license an unrelated prefix.
const menuInflections: Record<string, readonly string[]> = {
  monitor: ["monitors", "monitored", "monitoring"],
  contraindicat: ["contraindicate", "contraindicated", "contraindication", "contraindications"],
  discontinu: ["discontinue", "discontinued", "discontinuing", "discontinuation"],
  escalat: ["escalate", "escalated", "escalating", "escalation"],
  refer: ["refers", "referred", "referring", "referral", "referrals"],
  manage: ["managed", "managing", "management"],
  treat: ["treated", "treating", "treatment", "treatments"],
  differ: ["differs", "differing", "difference", "differences", "different"],
  require: ["requires", "required", "requiring", "requirement", "requirements"],
};

/** Match adjacent normalized tokens, with optional bounded menu inflections. */
function evidenceIncludesTerm(haystack: string, term: string, menuConcept = false): boolean {
  const haystackTokens = normalizedEvidenceTokens(haystack);
  const termTokens = normalizedEvidenceTokens(term);
  if (termTokens.length === 0 || termTokens.length > haystackTokens.length) return false;
  return haystackTokens.some((_, start) =>
    termTokens.every((termToken, offset) => {
      const actual = haystackTokens[start + offset];
      return (
        actual === termToken ||
        (menuConcept &&
          actual !== undefined &&
          (menuInflections[termToken]?.includes(actual) ||
            (termToken.length > 3 && ["s", "ed", "ing"].some((suffix) => actual === `${termToken}${suffix}`))))
      );
    }),
  );
}

/**
 * One deterministic follow-up candidate.
 *
 * `evidenceTerms` are lowercase token/phrase stems; at least one must appear in the
 * retrieved evidence for the candidate to be offered. `answeredTerms` are the
 * narrow concept words that mark the question as already answered by the answer
 * body — deliberately a subset of `evidenceTerms`, so a passing mention in a
 * source does not suppress a question the answer never addressed.
 */
type FollowUpTemplate = {
  kind: AnswerSectionKind;
  question: (topic: string) => string;
  evidenceTerms: readonly string[];
  answeredTerms: readonly string[];
};

/**
 * Follow-up phrasing per menu key, index-aligned with that menu's `items` in
 * src/lib/rag/answer-composition.ts. The alignment (same kind at the same index)
 * is asserted over all 48 class×intent cells in tests/answer-follow-up.test.ts, so
 * a future menu edit fails loudly instead of silently dropping a chip.
 */
/**
 * The one authored way to ask about a gap the answer reported.
 *
 * It lives outside the menus because the builder offers it for every menu key,
 * not only `management` — the menu that happens to list it. A reported gap is a
 * statement about this answer's evidence, so it is worth asking about whatever
 * shape the question had; and the `dosing`, `escalation`, `threshold` and
 * `comparison` menus have no gap item of their own, so without this a gap on
 * those queries would go unmentioned.
 */
const reportedGapQuestion = (topic: string) => `What does the indexed guidance not cover for ${topic}?`;

const menuFollowUpTemplates: Record<Exclude<RelatedInformationMenuKey, "none">, readonly FollowUpTemplate[]> = {
  dosing: [
    {
      kind: "monitoring_timing",
      question: (topic) => `What monitoring is required for ${topic}?`,
      evidenceTerms: ["monitor", "bloods", "fbc", "ecg", "egfr", "tft", "serum", "level"],
      answeredTerms: ["monitor"],
    },
    {
      kind: "contraindications_cautions",
      question: (topic) => `What cautions or contraindications apply to ${topic}?`,
      evidenceTerms: ["contraindicat", "caution", "avoid", "not recommended", "interaction"],
      answeredTerms: ["contraindicat", "caution", "avoid"],
    },
    {
      kind: "escalation_risk",
      question: (topic) => `What should trigger stopping or escalating ${topic}?`,
      evidenceTerms: ["stop", "withhold", "cease", "discontinu", "escalat", "toxicity"],
      answeredTerms: ["stop", "withhold", "cease", "discontinu"],
    },
    {
      kind: "medication_dose",
      question: (topic) => `How is ${topic} dosed in renal or hepatic impairment?`,
      evidenceTerms: ["renal", "hepatic", "egfr", "creatinine", "liver", "impairment"],
      answeredTerms: ["renal", "hepatic", "egfr", "creatinine"],
    },
  ],
  escalation: [
    {
      kind: "required_actions",
      question: (topic) => `What immediate actions are required for ${topic}?`,
      evidenceTerms: ["immediate", "urgent", "stop", "withhold", "seek", "first-line"],
      answeredTerms: ["immediate", "urgent"],
    },
    {
      kind: "thresholds",
      question: (topic) => `What thresholds trigger those actions for ${topic}?`,
      evidenceTerms: ["threshold", "mmol", "exceeds", "above", "below", "score"],
      answeredTerms: ["threshold", "mmol/l", "cut-off"],
    },
    {
      kind: "escalation_risk",
      question: (topic) => `Who should be contacted or referred for ${topic}?`,
      evidenceTerms: ["refer", "contact", "on-call", "consultant", "specialist", "emergency department", "notify"],
      answeredTerms: ["refer", "contact", "on-call", "notify"],
    },
    {
      kind: "documentation",
      question: (topic) => `What should I document for ${topic}?`,
      evidenceTerms: ["document", "record", "chart", "form"],
      answeredTerms: ["document", "record"],
    },
  ],
  threshold: [
    {
      kind: "thresholds",
      question: (topic) => `What are the adjacent thresholds or bands for ${topic}?`,
      evidenceTerms: ["threshold", "band", "range", "cut-off", "score", "mmol"],
      answeredTerms: ["threshold", "band", "range"],
    },
    {
      kind: "required_actions",
      question: (topic) => `What action is required at each band for ${topic}?`,
      evidenceTerms: ["action", "repeat", "manage", "treat", "review"],
      answeredTerms: ["action required", "repeat"],
    },
    {
      kind: "escalation_risk",
      question: (topic) => `What should trigger escalation for ${topic}?`,
      evidenceTerms: ["escalat", "urgent", "refer", "senior", "emergency"],
      answeredTerms: ["escalat"],
    },
  ],
  comparison: [
    {
      kind: "comparison",
      question: (topic) => `Which factors decide between the options for ${topic}?`,
      evidenceTerms: ["factor", "prefer", "first-line", "choice", "consider"],
      answeredTerms: ["factor", "prefer"],
    },
    {
      kind: "comparison",
      question: (topic) => `Where do the sources differ on ${topic}?`,
      evidenceTerms: ["differ", "versus", "compared", "whereas", "alternative"],
      answeredTerms: ["differ", "conflict"],
    },
    {
      kind: "required_actions",
      question: (topic) => `What switching or washout steps apply to ${topic}?`,
      evidenceTerms: ["switch", "washout", "cross-taper", "taper", "swap"],
      answeredTerms: ["switch", "washout", "taper"],
    },
  ],
  management: [
    {
      kind: "required_actions",
      question: (topic) => `What is the first-line management for ${topic}?`,
      evidenceTerms: ["first-line", "first line", "offer", "management", "treat", "initial"],
      answeredTerms: ["first-line", "first line"],
    },
    {
      kind: "documentation",
      question: (topic) => `What should I document for ${topic}?`,
      evidenceTerms: ["document", "record", "chart", "form"],
      answeredTerms: ["document", "record"],
    },
    {
      kind: "source_gap",
      question: reportedGapQuestion,
      // Only offered when the answer itself reported a coverage gap (a conflict is
      // not one); the haystack check below is satisfied by that report, not by source prose.
      evidenceTerms: ["reported_gap"],
      answeredTerms: [],
    },
  ],
};

/**
 * The kinds this module answers for each S2 menu key, in menu order. Exported so
 * tests/answer-follow-up.test.ts can assert index-alignment with
 * `buildRelatedInformationMenu` across every class×intent cell without reaching
 * into the template bodies.
 */
export const followUpTemplateKindsByMenuKey: Readonly<
  Record<Exclude<RelatedInformationMenuKey, "none">, readonly AnswerSectionKind[]>
> = Object.freeze({
  dosing: menuFollowUpTemplates.dosing.map((template) => template.kind),
  escalation: menuFollowUpTemplates.escalation.map((template) => template.kind),
  threshold: menuFollowUpTemplates.threshold.map((template) => template.kind),
  comparison: menuFollowUpTemplates.comparison.map((template) => template.kind),
  management: menuFollowUpTemplates.management.map((template) => template.kind),
});

/**
 * Candidates for the classes whose S2 menu is deliberately "none". These are the
 * pre-S3 narrow templates, kept verbatim in phrasing and now evidence-gated.
 */
const documentLookupTemplates: readonly FollowUpTemplate[] = [
  {
    kind: "required_actions",
    question: () => "What are the key action points?",
    evidenceTerms: ["action", "step", "must", "should", "require"],
    answeredTerms: ["key action"],
  },
  {
    kind: "monitoring_timing",
    question: () => "What monitoring or follow-up is documented?",
    evidenceTerms: ["monitor", "follow-up", "review"],
    answeredTerms: ["monitor", "follow-up"],
  },
  {
    kind: "contraindications_cautions",
    question: () => "Are there any contraindications noted?",
    evidenceTerms: ["contraindicat", "caution", "avoid", "not recommended"],
    answeredTerms: ["contraindicat"],
  },
  {
    kind: "required_actions",
    question: (topic) => `Summarise the practical steps for ${topic}.`,
    evidenceTerms: ["step", "procedure", "process", "plan", "must", "should"],
    answeredTerms: [],
  },
];

const generalTemplates: readonly FollowUpTemplate[] = [
  {
    kind: "monitoring_timing",
    question: (topic) => `What monitoring is required for ${topic}?`,
    evidenceTerms: ["monitor", "review", "level"],
    answeredTerms: ["monitor"],
  },
  {
    kind: "contraindications_cautions",
    question: (topic) => `What are the main cautions for ${topic}?`,
    evidenceTerms: ["caution", "contraindicat", "avoid", "risk", "adverse"],
    answeredTerms: ["caution", "contraindicat"],
  },
  {
    kind: "documentation",
    question: (topic) => `What should I document for ${topic}?`,
    evidenceTerms: ["document", "record", "form"],
    answeredTerms: ["document", "record"],
  },
  {
    kind: "required_actions",
    question: () => "What would change the management plan?",
    evidenceTerms: ["manage", "plan", "treat", "review"],
    answeredTerms: [],
  },
];

function bounded(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > maxEvidenceFieldChars ? value.slice(0, maxEvidenceFieldChars) : value;
}

/**
 * The retrieved evidence this client actually received, lowercased for substring
 * matching. Sources carry the bounded client snippet; quote cards and the
 * server-derived safety findings add the passages the UI already shows. Query
 * analysis is deliberately excluded — canonical terms are query-derived, so
 * counting them here would let a query term vouch for corpus coverage it does
 * not have. The bounded query subject must match an adjacent whole phrase
 * in this haystack before it can license a suggestion.
 */
function buildEvidenceHaystack(answer: ClientRagAnswerPayload): string {
  const parts: string[] = [];
  for (const source of (answer.sources ?? []).slice(0, maxEvidenceSources)) {
    parts.push(source.title ?? "", source.section_heading ?? "", bounded(source.retrieval_synopsis ?? source.content));
  }
  const quotes = (answer.quoteCards ?? []).slice(0, maxEvidenceQuotes);
  for (const quote of quotes) parts.push(bounded(quote.quote));
  for (const warning of answer.safetyWarnings ?? []) parts.push(warning.kind, warning.label, bounded(warning.text));
  return parts.join(" \n").toLowerCase();
}

function topicLabel(priorQuery: string) {
  const trimmed = priorQuery.trim();
  if (!trimmed) return "this topic";

  const candidateTopic = (trimmed.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? [])
    .filter((token) => !followUpTopicNoise.has(token.toLowerCase()))
    .slice(0, 3)
    .join(" ");
  if (candidateTopic) {
    return candidateTopic.length > 48 ? `${candidateTopic.slice(0, 45).trimEnd()}…` : candidateTopic;
  }

  // Long or interrogative queries: use a short topic phrase instead of the full question.
  if (trimmed.length > 48 || questionLeadPattern.test(trimmed)) {
    const tokens = significantTokens(trimmed);
    if (tokens.length > 0) {
      const label = tokens.slice(0, 3).join(" ");
      return label.length > 48 ? `${label.slice(0, 45).trimEnd()}…` : label;
    }
  }

  return trimmed.length > 48 ? `${trimmed.slice(0, 45).trimEnd()}…` : trimmed;
}

function isShortContinuationQuery(query: string) {
  const trimmed = query.trim();
  return trimmed.length < selfContainedFollowUpLength && followUpCuePattern.test(trimmed);
}

/**
 * The thread question a chip's topic should be read from. Short continuation
 * questions ("what about renal impairment?") anchor on the thread's opening
 * question, not the latest follow-up phrasing.
 */
function resolveAnchorQuery(latestQuery: string, priorQueries: string[]) {
  const trimmedLatest = latestQuery.trim();
  const firstQuery = priorQueries.map((query) => query.trim()).find(Boolean);
  if (firstQuery && firstQuery !== trimmedLatest && isShortContinuationQuery(trimmedLatest)) return firstQuery;
  return trimmedLatest;
}

/**
 * Which composition menu applies. Class-carrying answers use the S2 menu
 * verbatim; query-shape fallbacks cover cached or degraded payloads without a
 * query class.
 */
function resolveMenuKey(anchorQuery: string, answer: ClientRagAnswerPayload): RelatedInformationMenuKey {
  const queryClass = answer.queryClass;
  if (queryClass) {
    const intent =
      (queryClass === "medication_dose_risk" || queryClass === "table_threshold") &&
      /\b(?:toxicity|overdose|urgent|emergency|escalat(?:e|ion|ing)?)\b/i.test(anchorQuery)
        ? "escalation_risk"
        : "general";
    return buildRelatedInformationMenu(queryClass, intent).key;
  }
  if (/\b(dose|dosing|mg|monitor|medication|drug)\b/i.test(anchorQuery)) return "dosing";
  if (/\b(threshold|level|cut[- ]?off|range)\b/i.test(anchorQuery)) return "threshold";
  return "none";
}

function templatesForMenuKey(
  menuKey: RelatedInformationMenuKey,
  answer: ClientRagAnswerPayload,
): readonly FollowUpTemplate[] {
  if (menuKey !== "none") return menuFollowUpTemplates[menuKey];
  if (answer.queryClass === "document_lookup") return documentLookupTemplates;
  return generalTemplates;
}

/**
 * Follow-up questions taken verbatim from the answer's own reported gaps.
 *
 * Only a gap that is ALREADY a question is offered. This used to wrap any gap
 * in `What does the source say about <message lowercased>?`, which cannot
 * produce English: every message `detectConflictsOrGaps` writes is a full
 * advisory sentence, not a noun phrase. On the live answer page that rendered
 * as "What does the source say about current evidence comes from one document;
 * broaden document scope if you need cross-document comparison?" — and the
 * threshold-conflict message, being two sentences, came out worse still, with a
 * lowercased "confirm the correct cut-off..." stranded mid-question.
 *
 * Nothing is lost by declining: the `source_gap` template below is authored for
 * exactly this case, is gated on the same `reported_gap` evidence, and asks the
 * question in words a clinician can read.
 */
function gapFollowUpTemplates(answer: ClientRagAnswerPayload) {
  const gaps = answer.conflictsOrGaps ?? [];
  return gaps
    .map((gap) => gap.message.trim())
    .filter((message) => message.endsWith("?"))
    .slice(0, 2);
}

/**
 * Build short follow-up question chips for the latest answer turn.
 *
 * Candidates come from the S2 composition menu for this answer's class/intent,
 * must be supported by the retrieved evidence, and are dropped when the answer
 * already covers them. Returns [] when nothing survives — the chip row then does
 * not render, which is preferable to naming a question this corpus cannot answer.
 * Suggestions also avoid repeating questions already asked in the thread.
 */
export function buildAnswerFollowUpSuggestions(
  priorQuery: string,
  answer: ClientRagAnswerPayload,
  priorQueries: string[] = [],
): string[] {
  const trimmedPrior = priorQuery.trim();
  if (!trimmedPrior) return [];

  const anchorQuery = resolveAnchorQuery(trimmedPrior, priorQueries);
  const evidenceHaystack = buildEvidenceHaystack(answer);
  const subjectHaystack = evidenceHaystack;

  const topic = topicLabel(anchorQuery);
  const topicSupported = evidenceIncludesTerm(subjectHaystack, topic);

  const seen = new Set(priorQueries.map(normalizeSuggestionKey));
  seen.add(normalizeSuggestionKey(trimmedPrior));

  const suggestions: string[] = [];
  const push = (candidate: string) => {
    const normalized = normalizeSuggestionKey(candidate);
    if (!normalized || seen.has(normalized)) return;
    suggestions.push(candidate);
    seen.add(normalized);
  };

  // Reported gaps and conflicts are evidence by construction: the answer itself
  // said the sources disagree or fall short.
  for (const gap of gapFollowUpTemplates(answer)) {
    if (suggestions.length >= maxFollowUpSuggestions) break;
    push(gap);
  }
  // Whether a gap supplied its own question, which is what the `source_gap`
  // suppression below actually means. Reading it off `suggestions.length` was
  // safe only while gaps were the sole thing that could have run by then; now
  // that a gap has to already be a question to qualify, that test would suppress
  // the authored `source_gap` item whenever any earlier menu template matched.
  const gapAskedItself = suggestions.length > 0;
  const reportedGapsOrConflicts = answer.conflictsOrGaps ?? [];
  /**
   * A conflict is not a gap, and the authored gap question says the wrong thing
   * about one. `detectConflictsOrGaps` writes `type: "conflict"` when sources
   * disagree on a withholding threshold — that answer HAS coverage, from several
   * sources; the problem is that they contradict each other. Offering "What does
   * the indexed guidance not cover for X?" there misstates the evidence and
   * points the clinician at the wrong follow-up.
   */
  const hasMissingCoverage = reportedGapsOrConflicts.some((item) => item.type === "gap");
  const answerText = (answer.answer ?? "").toLowerCase();
  const emittedSectionKinds = new Set(
    (answer.answerSections ?? []).map((section) => section.kind).filter((kind): kind is AnswerSectionKind => !!kind),
  );

  if (!topicSupported) return suggestions;

  const menuKey = resolveMenuKey(anchorQuery, answer);
  for (const template of templatesForMenuKey(menuKey, answer)) {
    if (suggestions.length >= maxFollowUpSuggestions) break;
    // (2) evidence gate.
    const supported = template.evidenceTerms.some((term) =>
      term === "reported_gap" ? hasMissingCoverage : evidenceIncludesTerm(evidenceHaystack, term, true),
    );
    if (!supported) continue;
    // (3) already-answered suppression: an emitted section of this kind, the
    // answer body's own words, or — for the source-gap item — a gap chip that is
    // already asking the specific question.
    if (emittedSectionKinds.has(template.kind)) continue;
    if (template.kind === "source_gap" && gapAskedItself) continue;
    if (template.answeredTerms.some((term) => evidenceIncludesTerm(answerText, term, true))) continue;
    push(template.question(topic));
  }

  /**
   * The authored gap question, for the menus that carry no `source_gap` item of
   * their own — only `management` does, so before this a reported gap on a
   * dosing, escalation, threshold or comparison query went unmentioned.
   *
   * Offered LAST, and only into a spare slot. A question about what the evidence
   * does not cover is worth less than a concrete evidence-backed one when the
   * four slots are contested: put it first and a gapped `medication_dose_risk`
   * answer trades "How is lithium dosed in renal or hepatic impairment?" for a
   * meta-question. It also costs the reader little to lose, because the gap's
   * own words are already on screen as a caveat (`answer-render-policy.ts`).
   *
   * The `emittedSectionKinds` check is the menu loop's rule 3 applied here:
   * `source_gap` is a real emitted section kind (`rag.ts` maps gap/unsupported
   * headings onto it), so without this the chip could ask what the guidance does
   * not cover directly beneath a Source gap section that just said.
   */
  if (
    hasMissingCoverage &&
    !gapAskedItself &&
    !emittedSectionKinds.has("source_gap") &&
    suggestions.length < maxFollowUpSuggestions
  ) {
    push(reportedGapQuestion(topic));
  }

  return suggestions;
}
