import { toxicityHeadingBulletPassages } from "@/lib/rag/rag-toxicity-list";
import {
  adjacentLabelledNumericBandConflicts,
  containsLabelledNumericBand,
  containsNumericBandReference,
  detectLabelledNumericBandConflicts,
  extractClinicalValueAtoms,
  failClosedForLabelledNumericBandConflict,
  labelledNumericBandConflictsAffectingText,
  LABELLED_NUMERIC_BAND_CONFLICT_NOTE,
  textReferencesAdjacentBandConflict,
  type ClinicalValueAtom,
  type LabelledNumericBandConflict,
} from "@/lib/answer-verification";
import { hasForeignMedicationClinicalValueBinding, medicationEntitiesInText } from "@/lib/medication-entities";
import { sanitizeAnswerText } from "@/lib/rag/rag-answer-text";
import { appendRoutingReason } from "@/lib/rag/rag-routing";
import {
  atomicNmhsClozapineRedRangeSegment,
  reflowBoundedSourceLines,
  reflowWrappedAgitationDoseLines,
  reflowWrappedEscalationRecipientLines,
} from "@/lib/rag/rag-source-segmentation";
import { sourceTextForClinicalProsePreservingBreaks } from "@/lib/source-text-sanitizer";
import type { CitationProvenance, EvidenceAssessment, RagAnswer, SearchResult, SupportedClaim } from "@/lib/types";

const acceptedProvenance = new Set<CitationProvenance>([
  "model_selected",
  "section_selected",
  "exact_quote",
  "deterministic_support",
]);

const highRiskPattern =
  /\b(?:administ(?:er|ered|ering|ration)|admit(?:ted|ting)?|avoid|contraindicat(?:ed|ion)?|must\s+not|do\s+not\s+use|withhold|cease|stop|discontinue|continue|do\s+not\s+stop|escalat(?:e|ed|es|ing|ion)|give|given|prescrib(?:e|ed|ing)|refer(?:red|ring|ral)?|restrain(?:ed|ing|t)?|sedat(?:e|ed|ing|ion)|start(?:ed|ing)?|transfer(?:red|ring)?|urgent(?:ly)?|immediate(?:ly)?|emergency|pregnan(?:cy|t)|renal|hepatic|dose|dosage|route|oral(?:ly)?|intramuscular(?:ly)?|subcutaneous(?:ly)?|sublingual(?:ly)?|intravenous(?:ly)?|\bim\b|\bpo\b|daily|weekly|hourly|nightly|fortnightly|monthly|threshold|cut-?off|monitor(?:ing)?|repeat|review interval|mg|mcg|mmol|x10)\b/i;

const genericDrugEntityPattern = /\bdrug\s+[a-z]\b/gi;

const topicStopwords = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "when",
  "whenever",
  "below",
  "above",
  "at",
  "do",
  "not",
  "must",
  "use",
  "give",
  "includes",
  "include",
  "offers",
  "source",
  "cited",
  "covered",
]);

const triggerTopicStopwords = new Set([
  "clinical",
  "clinically",
  "develop",
  "developed",
  "developing",
  "develops",
  "indicated",
  "indication",
  "necessary",
  "needed",
  "occur",
  "occurred",
  "occurring",
  "occurs",
  "patient",
  "patients",
  "present",
  "presenting",
  "required",
  "sign",
  "signs",
  "symptom",
  "symptoms",
]);

function cleanText(value: string) {
  return value
    .replace(/^[ \t]*>[ \t]+(?=[A-Za-z*_`#])/gm, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitClaims(value: string) {
  // Preserve model-authored line boundaries until after splitting. Calling
  // cleanText first collapses newlines, which can merge independently cited
  // bullet claims into one compound claim that no single chunk can support.
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*>[ \t]+(?=[A-Za-z*_`#])/gm, "")
    .replace(/[*_`#]/g, "")
    .split(
      /\s*;\s*|(?<=[.!?])(?<!\b[Ee]\.[Gg]\.|\b[Ii]\.[Ee]\.)(?:[ \t]+|\n+)|(?<=\bthe following:)[ \t]+|\n+|,\s*(?:and|but|then)\s+(?=(?:administer|avoid|cease|continue|discontinue|escalate|give|prescribe|sedate|start|stop|use|withhold)\b)|\s+(?:and|then)\s+(?=(?:administer|avoid|cease|continue|discontinue|escalate|give|prescribe|sedate|start|stop|use|withhold)\b)/i,
    )
    .map(cleanText)
    .filter(Boolean);
}

function splitComparisonClaims(value: string) {
  return splitClaims(value)
    .flatMap((claim) => claim.split(/\s*;\s*|\s+(?:whereas|while)\s+/i))
    .map((claim) => claim.trim())
    .filter(Boolean);
}

/**
 * Canonical identity for a clinical value atom, shared with the extractive
 * lead-figure promotion guard (rag-extractive-answer.ts) so promotion and
 * claim-support agree on whether a figure is present in the evidence corpus.
 */
export function clinicalValueAtomKey(atom: ClinicalValueAtom) {
  return [
    atom.kind,
    atom.canonicalValue,
    atom.comparator ?? "",
    atom.canonicalUnit ?? "",
    atom.denominatorUnit ?? "",
    atom.denominatorTime ?? "",
    atom.denominatorWeight ?? "",
    atom.route ?? "",
    atom.frequency ?? "",
  ].join("|");
}

function entities(value: string) {
  return new Set([
    ...medicationEntitiesInText(value),
    ...Array.from(value.toLowerCase().matchAll(genericDrugEntityPattern), (match) => match[0].replace(/\s+/g, " ")),
  ]);
}

function topicTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !topicStopwords.has(token) && !/^\d/.test(token)),
  );
}

function highRiskTriggerTokens(value: string) {
  const tokens = new Set<string>();
  const triggerPatterns = [
    /\b(?:when|whenever|if|unless|during|after|before)\b\s*([^,;.!?]+?)(?=\s*,|\s+\b(?:administer|avoid|cease|continue|discontinue|escalate|give|prescribe|start|stop|use|withhold)\b|[;.!?]|$)/gi,
    /\b(?:administer|avoid|cease|continue|discontinue|escalate|give|prescribe|start|stop|use|withhold)\b[^,;.!?]{0,80}?\bfor\b\s*([^,;.!?]+?)(?=\s+\bfor\b|\s*,|[;.!?]|$)/gi,
  ];
  for (const pattern of triggerPatterns) {
    for (const match of value.matchAll(pattern)) {
      for (const token of topicTokens(match[1] ?? "")) {
        if (!triggerTopicStopwords.has(token)) tokens.add(token);
      }
    }
  }
  return tokens;
}

function compatibleHighRiskTrigger(claim: string, evidence: string) {
  if (!isHighRiskClaim(claim)) return true;
  const triggerTokens = highRiskTriggerTokens(claim);
  if (triggerTokens.size === 0) return true;
  const evidenceTopics = topicTokens(evidence);
  return [...triggerTokens].every((token) => evidenceTopics.has(token));
}

function isHighRiskClaim(value: string) {
  return highRiskPattern.test(value) || extractClinicalValueAtoms(value).length > 0;
}

type ActionPolarity =
  | "do_not_stop"
  | "stop"
  | "continue"
  | "do_not_use"
  | "use_allowed"
  | "urgent"
  | "urgent_not_required"
  | "escalate"
  | "do_not_escalate"
  | "routine"
  | "none";

function hasNegatedUrgency(value: string) {
  return /\b(?:not urgent|no urgent escalation|urgent escalation (?:is )?not required|urgent escalation (?:is )?unnecessary)\b/i.test(
    value,
  );
}

function hasNegatedEscalation(value: string) {
  return (
    /\b(?:(?:(?:do|must|should|need)\s+(?:[a-z]+ly\s+){0,2}not|(?:should\s+)?never)\s+(?:(?:urgently|immediately|routinely)\s+)?(?:be\s+)?escalat(?:e|ed|es|ing)|no\s+need\s+to\s+escalate)\b/i.test(
      value,
    ) ||
    /\b(?:is|are|was|were)\s+not\s+to\s+be\s+escalated\b/i.test(value) ||
    /\b(?:there\s+is\s+)?no\s+(?:need|requirement)\s+(?:for|to)\s+(?:urgent\s+)?escalat(?:e|ion)\b/i.test(value) ||
    /\bno\s+(?:urgent\s+)?escalation\s+(?:(?:is|was)\s+)?(?:needed|required|indicated|necessary|appropriate|recommended)\b/i.test(
      value,
    ) ||
    /\bescalation\s+(?:(?:is|was|remains)\s+)?(?:not\s+(?:needed|required|indicated|necessary|appropriate|recommended)|unnecessary|contraindicated)\b/i.test(
      value,
    ) ||
    /\bescalation\s+(?:should|must)\s+not\s+(?:be\s+)?(?:undertaken|performed|required|occur|proceed)\b/i.test(value)
  );
}

function hasPositiveEscalation(value: string) {
  if (hasNegatedEscalation(value)) return false;
  return (
    /\b(?:escalate|escalates)\b/i.test(value) ||
    /\b(?:should|must|need(?:s)?\s+to|is\s+to|are\s+to|can|may|is|are|was|were|be)\s+(?:urgently\s+)?escalated\b/i.test(
      value,
    ) ||
    /\bescalation\s+(?:(?:is|are|was|were|remains?)\s+)?(?:needed|required|indicated|necessary|appropriate|recommended|warranted)\b/i.test(
      value,
    ) ||
    /\b(?:requires?|needs?|warrants?)\s+(?:urgent\s+)?escalation\b/i.test(value) ||
    /\b(?:consider|recommend(?:s|ed)?)\s+escalating\b/i.test(value)
  );
}

function actionPolarity(value: string): ActionPolarity {
  if (/\b(?:(?:do|must|should)\s+not|never)\s+(?:stop|cease|discontinue)\b/i.test(value)) {
    return "do_not_stop";
  }
  if (/\b(?:stop|cease|discontinue|withhold)\b/i.test(value)) return "stop";
  if (/\bcontinue\b/i.test(value)) return "continue";
  if (/\b(?:may|can)\s+(?:be\s+)?use|not\s+contraindicated\b/i.test(value)) return "use_allowed";
  if (/\b(?:contraindicat(?:ed|ion)?|must\s+not|do\s+not\s+use|avoid)\b/i.test(value)) return "do_not_use";
  if (hasNegatedEscalation(value)) return "do_not_escalate";
  if (hasNegatedUrgency(value)) return "urgent_not_required";
  if (hasPositiveEscalation(value)) return "escalate";
  if (/\b(?:urgent(?:ly)?|immediate(?:ly)?|emergency)\b/i.test(value)) return "urgent";
  if (/\b(?:next appointment|routine|non-urgent)\b/i.test(value)) return "routine";
  return "none";
}

function compatiblePolarity(claim: string, evidence: string) {
  const expected = actionPolarity(claim);
  if (expected === "none") return true;
  // A retrieved chunk can contain several independent directives. Comparing
  // against one chunk-global first match rejects a directly supporting later
  // sentence merely because an unrelated earlier sentence says "stop" or
  // "do not use". Compare the claim with each action clause instead.
  const clauses = evidence
    .split(
      /(?:[.!?;\n]+|,\s+(?:but|and)\s+|\s+(?:but|and)\s+(?=(?:do|must|should|never|avoid|cease|continue|discontinue|escalat|give|stop|urgent|withhold)\b))/i,
    )
    .map((value) => value.trim())
    .filter(Boolean);
  return clauses.some((clause) => actionPolarity(clause) === expected);
}

type SafetyDimension = "pregnancy" | "renal" | "hepatic" | "urgent_escalation" | "urgent_escalation_not_required";

function safetyDimensions(value: string) {
  const dimensions = new Set<SafetyDimension>();
  if (/\bpregnan(?:cy|t)\b/i.test(value)) dimensions.add("pregnancy");
  if (/\b(?:renal|kidney)\b/i.test(value)) dimensions.add("renal");
  if (/\b(?:hepatic|liver)\b/i.test(value)) dimensions.add("hepatic");
  if (hasNegatedUrgency(value)) {
    dimensions.add("urgent_escalation_not_required");
  } else if (/\b(?:immediate(?:ly)?|emergency)\b/i.test(value) || /(?<!non[-\s])\burgent(?:ly)?\b/i.test(value)) {
    dimensions.add("urgent_escalation");
  }
  return dimensions;
}

function compatibleSafetyDimensions(claim: string, evidence: string) {
  const evidenceDimensions = safetyDimensions(evidence);
  return [...safetyDimensions(claim)].every((dimension) => evidenceDimensions.has(dimension));
}

type DirectiveAction =
  | "give"
  | "admit"
  | "transfer"
  | "refer"
  | "restrain"
  | "sedate"
  | "start"
  | "stop"
  | "continue"
  | "avoid"
  | "monitor"
  | "repeat"
  | "escalate"
  | "use";

const boundedDirectiveNegation = String.raw`(?:not(?:\s+ever)?|never|under\s+no\s+circumstances|by\s+no\s+means)\s+(?:[a-z]+ly\s+){0,2}(?:(?:to\s+)?be\s+)?`;
const boundedDirectiveAdverbs = String.raw`(?:[a-z]+ly\s+){0,2}`;
const positiveDirectivePredicate = String.raw`(?:recommended|indicated|required|needed|appropriate|necessary|advised|warranted)`;
const negativeDirectivePredicate = String.raw`(?:unnecessary|unwarranted|inadvisable|inappropriate|contraindicated)`;
const directiveActionDefinitions: Array<{
  action: DirectiveAction;
  forms: string;
  pattern: RegExp;
  negatedPattern: RegExp;
  postNegatedPattern: RegExp;
}> = [
  ["give", String.raw`administ(?:er|ered|ering|ration)|give|given|prescrib(?:e|ed|ing)`],
  ["admit", String.raw`admit(?:ted|ting)?|admission`],
  ["transfer", String.raw`transfer(?:red|ring)?`],
  ["refer", String.raw`refer(?:red|ring|ral)?`],
  ["restrain", String.raw`restrain(?:ed|ing|t)?`],
  ["sedate", String.raw`sedat(?:e|ed|ing|ion)`],
  ["start", String.raw`start(?:ed|ing)?`],
  [
    "stop",
    String.raw`stop(?:ped|ping)?|cease(?:d|s|ing)?|discontinu(?:e|ed|es|ing|ation)|withhold|withheld|withholding`,
  ],
  ["continue", String.raw`continu(?:e|ed|es|ing|ation)`],
  ["avoid", String.raw`avoid(?:ed|s|ing)?`],
  ["monitor", String.raw`monitor(?:ed|s|ing)?`],
  ["repeat", String.raw`repeat(?:ed|s|ing)?`],
  ["escalate", String.raw`escalat(?:e|ed|es|ing|ion)`],
  ["use", String.raw`use|used|using`],
].map(([action, forms]) => ({
  action: action as DirectiveAction,
  forms,
  pattern: new RegExp(String.raw`\b(?:${forms})\b`, "i"),
  negatedPattern: new RegExp(String.raw`\b${boundedDirectiveNegation}(?:${forms})\b`, "i"),
  postNegatedPattern: new RegExp(
    String.raw`(?:\brefrain\s+from\s+(?:${forms})\b|\b(?:do|does|did)\s+not\s+need\s+to\s+(?:${forms})\b|\b(?:it\s+)?(?:is|was)\s+not\s+${boundedDirectiveAdverbs}${positiveDirectivePredicate}\s+to\s+(?:${forms})\b|\bthere\s+(?:is|was)\s+no\s+(?:indication|need|requirement|recommendation)\s+(?:to|for)\s+(?:${forms})\b|\bno\s+(?:need|requirement)\s+(?:to|for)\s+(?:${forms})\b|\bno\s+(?:${forms})\b[^.!?;\n]{0,60}\b(?:(?:is|are|was|were)\s+${boundedDirectiveAdverbs})?${positiveDirectivePredicate}\b|\b(?:${forms})\b[^.!?;\n]{0,60}\b(?:is|are|was|were)\s+${boundedDirectiveAdverbs}(?:not\s+(?:ever\s+)?${boundedDirectiveAdverbs}${positiveDirectivePredicate}|${negativeDirectivePredicate})\b)`,
    "i",
  ),
}));

function directiveActions(value: string) {
  const actions = new Set<DirectiveAction>();
  for (const definition of directiveActionDefinitions) {
    if (definition.pattern.test(value)) actions.add(definition.action);
  }
  return actions;
}

function negatedDirectiveActions(value: string) {
  const actions = new Set<DirectiveAction>();
  for (const definition of directiveActionDefinitions) {
    if (definition.negatedPattern.test(value) || definition.postNegatedPattern.test(value)) {
      actions.add(definition.action);
    }
  }
  if (hasNegatedEscalation(value)) actions.add("escalate");
  return actions;
}

const directiveImperativeForms: Record<DirectiveAction, string> = {
  give: String.raw`administer|give|prescribe`,
  admit: "admit",
  transfer: "transfer",
  refer: "refer",
  restrain: "restrain",
  sedate: "sedate",
  start: "start",
  stop: String.raw`stop|cease|discontinue|withhold`,
  continue: "continue",
  avoid: "avoid",
  monitor: "monitor",
  repeat: "repeat",
  escalate: "escalate",
  use: "use",
};

function normativeDirectiveActions(value: string) {
  const actions = new Set<DirectiveAction>();
  const negated = negatedDirectiveActions(value);
  for (const definition of directiveActionDefinitions) {
    if (!definition.pattern.test(value)) continue;
    if (negated.has(definition.action)) {
      actions.add(definition.action);
      continue;
    }
    const imperative = directiveImperativeForms[definition.action];
    const descriptiveContext =
      /\b(?:audit|case|record(?:ed|s)?|report(?:ed|s)?|histor(?:y|ical)|observed|patient\s+chart|progress\s+notes?|EHR|electronic\s+health\s+record|at\s+this\s+visit|visit\s+note|clinical\s+record)\b/i.test(
        value,
      );
    const hasNormativeSignal =
      new RegExp(
        String.raw`(?:^|[.!?;:,]\s*|\b(?:and|then)\s+)${boundedDirectiveAdverbs}(?:${imperative})\b`,
        "i",
      ).test(value) ||
      new RegExp(
        String.raw`\b(?:should|must|need(?:s)?\s+to|recommended\s+to|required\s+to|is\s+to|are\s+to)\s+(?:${boundedDirectiveNegation})?${boundedDirectiveAdverbs}(?:be\s+)?(?:${definition.forms})\b`,
        "i",
      ).test(value) ||
      (!descriptiveContext &&
        new RegExp(
          String.raw`\b(?:${definition.forms})\b[^.!?;\n]{0,60}\b(?:is|are|was|were|remains?)\s+${boundedDirectiveAdverbs}(?:${positiveDirectivePredicate}|${negativeDirectivePredicate})\b`,
          "i",
        ).test(value)) ||
      new RegExp(
        String.raw`\b(?:requires?|needs?|warrants?|recommends?)\s+(?:urgent\s+|immediate\s+)?(?:${definition.forms})\b`,
        "i",
      ).test(value) ||
      (!descriptiveContext &&
        new RegExp(String.raw`\b(?:is|are)\s+${boundedDirectiveAdverbs}(?:${definition.forms})\b`, "i").test(value)) ||
      // Descriptive guideline norm: "the usual/recommended <action> dose … is <value>"
      // (S1c R2). The digit anchor and the premodifier bound keep incidental
      // norm-adjacent action words ("a typical error is a repeated dose …") inert.
      (!descriptiveContext &&
        new RegExp(
          String.raw`\b(?:usual|recommended|typical|standard|initial)\b[^.!?;:\n]{0,30}?\b(?:${definition.forms})\b\s+(?:[a-z-]+\s+){0,2}dos(?:e|age|ing|es)\b[^.!?;:\n]{0,60}?\b(?:is|are)\b[^.!?;:\n]{0,16}?\d`,
          "i",
        ).test(value));
    if (hasNormativeSignal) actions.add(definition.action);
  }
  return actions;
}

function compatibleDirectiveActions(claim: string, evidence: string) {
  const expected = directiveActions(claim);
  if (expected.size === 0) return true;
  const present = directiveActions(evidence);
  const expectedNegated = negatedDirectiveActions(claim);
  const presentNegated = negatedDirectiveActions(evidence);
  const expectedNormative = normativeDirectiveActions(claim);
  const presentNormative = normativeDirectiveActions(evidence);
  return [...expected].every(
    (action) =>
      present.has(action) &&
      expectedNegated.has(action) === presentNegated.has(action) &&
      (!expectedNormative.has(action) || presentNormative.has(action)),
  );
}

// Exported so the extractive figure-promotion guard (rag-extractive-answer.ts) can check a
/**
 * Extracts and concatenates all text fields of a source result into the evidence corpus used for claim verification.
 *
 * @param source - Search result to format
 * @returns Combined evidence text
 */
export function sourceEvidenceText(source: SearchResult) {
  return [
    source.section_heading,
    source.content,
    source.retrieval_synopsis,
    source.table_facts
      ?.map((fact) =>
        [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
          .filter(Boolean)
          .join(" "),
      )
      .join(" "),
    source.index_unit
      ? [source.index_unit.title, source.index_unit.content, JSON.stringify(source.index_unit.metadata ?? {})]
          .filter(Boolean)
          .join(" ")
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function evidenceTextSupportsClaim(
  claim: string,
  evidence: string,
  passage: string,
  adjacentTopicText?: string,
  allowValueOnly = false,
  antecedentText?: string,
) {
  if (!compatibleFactualRelation(claim, evidence)) return false;
  if (!compatibleFindingDirections(claim, evidence)) return false;
  const claimEntities = entities(claim);
  const evidenceEntities = entities(evidence);
  // Only the medicines named in the segment directly before may stand in for "the combination";
  // every other check below still runs against this segment alone.
  for (const entity of entities(antecedentText ?? "")) evidenceEntities.add(entity);
  if (claimEntities.size > 0 && [...claimEntities].some((entity) => !evidenceEntities.has(entity))) return false;
  if (hasForeignMedicationClinicalValueBinding(claim, evidence)) return false;
  if (!compatiblePolarity(claim, evidence)) return false;
  if (!compatibleDirectiveActions(claim, evidence)) return false;
  if (!compatibleSafetyDimensions(claim, evidence)) return false;
  if (!compatibleHighRiskTrigger(claim, evidence)) return false;

  const evidenceAtoms = new Set(extractClinicalValueAtoms(evidence).map(clinicalValueAtomKey));
  const claimAtoms = extractClinicalValueAtoms(claim);
  if (claimAtoms.some((atom) => !evidenceAtoms.has(clinicalValueAtomKey(atom)))) return false;

  const claimTopics = topicTokens(claim);
  // Short directives can have no four-letter topic token ("No CPR."). They
  // still need actual sentence support, not the empty-set overlap shortcut.
  if (claimTopics.size === 0) {
    if (claimAtoms.length > 0) {
      const label = claimAtoms.reduce((text, atom) => text.replace(atom.rawText, " "), cleanText(claim));
      // Only the attributed comparison-entry caller may rely on atoms alone.
      // Ordinary short facts must also bind their short label (INR, pH, etc.)
      // to this value, within the same source clause rather than a title.
      if (!/[a-z]/i.test(label)) return allowValueOnly;
      // Omitted copulas and a single leading article are harmless in terse
      // results. Preserve every other clause token, including negation and
      // qualifications; a substring cannot establish the asserted fact.
      const tokens = (text: string) =>
        (text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []).filter(
          (token, index) => !/^(?:is|are)$/.test(token) && !(index === 0 && /^(?:a|an|the)$/.test(token)),
        );
      const expected = tokens(claim);
      return splitClaims(passage).some((sentence) => {
        const actual = tokens(sentence);
        return actual.length === expected.length && expected.every((token, index) => actual[index] === token);
      });
    }
    return splitClaims(passage).some(
      (sentence) => cleanText(sentence).toLowerCase() === cleanText(claim).toLowerCase(),
    );
  }
  const evidenceTopics = topicTokens(evidence);
  // S1c R3: a claim synthesising two adjacent source bullets may count topic tokens
  // from an immediately adjacent atom-free segment. Only this overlap ratio widens —
  // entities, polarity, directives, safety dimensions, the trigger check, and the
  // value-atom containment above all still hold against the single segment.
  for (const token of topicTokens(adjacentTopicText ?? "")) evidenceTopics.add(token);
  const matchedTopics = [...claimTopics].filter((token) => evidenceTopics.has(token)).length;
  return matchedTopics / claimTopics.size >= 0.5;
}

// "Increased muscle tone" or "reduced fluid intake" names a finding, not a change one thing makes to
// another: a participle opening a clause or list item, or following a list joiner, modifies the noun
// after it. Reading it as a relation made a verbatim list of toxicity signs unsupportable (#ZZ4RAP).
function namesFindingNotChange(text: string, match: RegExpMatchArray, participle = match[0]) {
  if (match.index === undefined || !/^(?:increased|decreased|reduced)$/.test(participle)) return false;
  // A participle that takes an object and a value ("Reduced lithium to 300 mg") is still a change.
  if (/^\s+[a-z]+(?:\s+[a-z]+)?\s+(?:to|by|from)\s+\d/.test(text.slice(match.index + participle.length))) return false;
  // Only a list position counts: "a risk of decreased lithium levels" keeps its direction check.
  return /(?:^|^o|[,:;(•-]|,\s*(?:and|or)|\b(?:include|includes|including|such as))\s*$/.test(
    text.slice(0, match.index),
  );
}

// A finding still has a direction, bound to the finding it modifies: "increased muscle tone" does not
// support "reduced muscle tone", even when the evidence also says "reduced consciousness" or a heading
// says "increased" elsewhere. Each (direction, finding) pair in the claim must appear in the evidence.
function findingDirectionPairs(value: string, findingsOnly: boolean) {
  const text = cleanText(value).toLowerCase();
  return new Set(
    [...text.matchAll(/\b(increased|decreased|reduced)\s+([a-z]+)/g)]
      .filter((match) => !findingsOnly || namesFindingNotChange(text, match, match[1]))
      .map((match) => `${match[1] === "increased" ? "up" : "down"}:${match[2]}`),
  );
}

function compatibleFindingDirections(claim: string, evidence: string) {
  // The evidence carries its title prefix, so count every participle it states, not only list-position ones.
  const evidencePairs = findingDirectionPairs(evidence, false);
  return [...findingDirectionPairs(claim, true)].every((pair) => evidencePairs.has(pair));
}

// Relation words bind two arguments; their occurrence anywhere in a chunk does
// not support their direction, polarity or scope. This is a conservative prose
// check in the existing support path, not a source of clinical knowledge.
function factualRelation(value: string) {
  const text = cleanText(value).toLowerCase();
  const relations = [
    ...text.matchAll(
      /\b(caus(?:e|es|ed)|lead(?:s)?\s+to|led\s+to|results?\s+in|results?\s+from|because(?:\s+of)?|due\s+to|caused\s+by|increas(?:e|es|ed)|reduc(?:e|es|ed)|decreas(?:e|es|ed)|improv(?:e|es|ed)|worsen(?:s|ed)?|higher\s+than|lower\s+than)\b/g,
    ),
  ].filter((match) => !namesFindingNotChange(text, match));
  const relation = relations[0];
  if (!relation || relation.index === undefined) return null;
  // Match passive before the shorter active "caused" alternative.
  const marker =
    relation[0] === "caused" && /^\s+by\b/.test(text.slice(relation.index + relation[0].length))
      ? "caused by"
      : relation[0];
  // Predicate particles belong to the relationship, so "result in fatigue"
  // cannot introduce an invented population named "fatigue".
  const argumentsText = [text.slice(0, relation.index), text.slice(relation.index + marker.length)];
  const population = argumentsText.flatMap((part) =>
    [
      ...part.matchAll(
        /\b(?:in|among|for)\s+([^,.;]+?)(?=,|\s+(?:may|can|could|does|do|is|are|causes?|leads?|results?)\b|[.;]|$)/g,
      ),
    ].map((match) => match[1].trim()),
  );
  const conditions = [...text.matchAll(/\b(?:if|unless|when|only|except)\b[^,.;]*/g)].map((match) => match[0]);
  const argument = (part: string) =>
    topicTokens(
      part
        .replace(/\b(?:in|among|for)\s+[^,.;]+(?:,|[.;]|$)/g, " ")
        .replace(
          /\b(?:may|might|can|could|does|do|not|never|always|sometimes|usually|possibly|probably|certainly|all|every|everyone|some|only|be|been|being|is|are)\b/g,
          " ",
        ),
    );
  const left = argument(argumentsText[0]);
  const right = argument(argumentsText[1]);
  const reverse = /^(?:results? from|because|due to|caused by)/.test(marker);
  return {
    predicateCount: relations.length,
    subject: reverse ? right : left,
    object: reverse ? left : right,
    kind: /^(?:reduc|decreas)/.test(marker)
      ? "decrease"
      : /^increas/.test(marker)
        ? "increase"
        : /^improv/.test(marker)
          ? "improve"
          : /^worsen/.test(marker)
            ? "worsen"
            : marker === "higher than"
              ? "higher"
              : marker === "lower than"
                ? "lower"
                : "cause",
    negated: /\b(?:not|never|no)\b/.test(text),
    possible: /\b(?:may|might|can|could|possibly|sometimes)\b/.test(text),
    universal: /\b(?:always|all|every|everyone|certainly)\b/.test(text),
    population,
    conditions,
  };
}

function compatibleFactualRelation(claim: string, evidence: string) {
  if (splitClaims(evidence).some((sentence) => cleanText(sentence).toLowerCase() === cleanText(claim).toLowerCase()))
    return true;
  const expected = factualRelation(claim);
  if (!expected) return true;
  // The atomic matcher cannot bind several predicates with unordered residual
  // words. Exact compound sentences passed above; other compounds are withheld
  // until their individual bindings can be established.
  if (expected.predicateCount !== 1) return false;
  return splitClaims(evidence).some((sentence) => {
    const actual = factualRelation(sentence);
    if (!actual || actual.predicateCount !== 1 || actual.kind !== expected.kind || actual.negated !== expected.negated)
      return false;
    if ((actual.possible && !expected.possible) || (expected.universal && !actual.universal)) return false;
    if (expected.conditions.join("|") !== actual.conditions.join("|")) return false;
    if ([...new Set(expected.population)].sort().join("|") !== [...new Set(actual.population)].sort().join("|"))
      return false;
    const sameArgument = (wanted: Set<string>, present: Set<string>) =>
      wanted.size > 0 && wanted.size === present.size && [...wanted].every((token) => present.has(token));
    return sameArgument(expected.subject, actual.subject) && sameArgument(expected.object, actual.object);
  });
}

function usesSourceBoundComparisonReflow(source: SearchResult, claim: string) {
  const knownPolicySource =
    /^(?:MHSP\.AdmissionCommunityPts|MHSP\.Discharge)\.pdf$/i.test(source.file_name) ||
    /^(?:Admission of Community Patients|Discharge Planning for Community Patients)(?:\s*\([^)]+\))?\.pdf$/i.test(
      source.file_name,
    ) ||
    /^(?:Admission Of Community Patients|Discharge Planning For Community Patients)(?:\s*\([^)]+\))?$/i.test(
      source.title,
    );
  const knownRequirementClaim =
    /\b(?:medical clearance|prioriti[sz]ation of beds?|locate (?:an? )?bed|high[\s-]observation beds?|discharge planning|discharge plans?|ongoing care arrangements?|admissions? accompanied by police)\b/i.test(
      claim,
    );
  return knownPolicySource && knownRequirementClaim;
}

function sourceEvidenceClaimSegmentGroups(source: SearchResult, claim: string) {
  const split = (value: string | null | undefined, context?: string | null, reflowVisualLines = false) => {
    const rawValue = reflowWrappedAgitationDoseLines(reflowWrappedEscalationRecipientLines(value ?? ""));
    // Always rejoin PDF visual line wraps before sentence-splitting. Splitting raw extracted
    // text on `\n+` fragments a source sentence at its hard wrap ("…for adults is 500 mg nocte
    // and for patients over 65 years it\nis 250 mg nocte"), so no single segment carries every
    // atom of a claim restating that sentence — a verbatim-faithful high-risk claim then reads
    // as unsupported and the whole answer degrades to source-only (#231, measured live
    // 2026-08-17). Blank lines, bullets, terminal punctuation, colons, and numbered headings
    // stay hard boundaries, and the general path joins only visible sentence continuations
    // (lowercase/digit/parenthesis starts) so separate capitalized source lines cannot
    // manufacture support. The comparison-reflow path keeps its historical aggressive join
    // plus low-yield noise stripping for its two known policy documents, unchanged.
    const blocks = reflowVisualLines
      ? reflowBoundedSourceLines(sourceTextForClinicalProsePreservingBreaks(rawValue))
      : reflowBoundedSourceLines(rawValue, { requireContinuationStart: true });
    return blocks.flatMap((block) => {
      const sharedConditional = block.match(/^\s*((?:when|whenever|if|unless)\b[^,;.!?]+),?/i)?.[1];
      const parts = block.split(
        /\s*;\s*|(?<=[.!?])(?<!\b[Ee]\.[Gg]\.|\b[Ii]\.[Ee]\.)(?:[ \t]+|\n+)|\n+|,\s*(?:but|while|whereas)\s+|\s+(?:while|whereas)\s+|,?\s+and\s+(?!a\s+(?:second|third|fourth|\d+(?:st|nd|rd|th))\s+dose\s+\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?)\b)(?=(?:a|an|the|another|other|it|this|that|they|these|those|admission|escalation|referral|restraint|sedation|transfer)\b)/i,
      );
      return parts
        .map((segment, index) => {
          const passage = index > 0 && sharedConditional ? `${sharedConditional}, ${segment.trim()}` : segment.trim();
          // Keep passage provenance separate from title/heading context. The
          // latter can lend topic context but cannot itself assert a short fact.
          return {
            passage,
            evidence: [context, passage].filter(Boolean).join(". "),
            antecedent: precedingSentence(parts, index),
          };
        })
        .filter((segment) => Boolean(segment.passage));
    });
  };
  const sourceContext = [source.title, source.section_heading].filter(Boolean).join(" ");
  const reflowComparisonContent = usesSourceBoundComparisonReflow(source, claim);
  const atomicClozapineRedRange = atomicNmhsClozapineRedRangeSegment({
    sourceLabel: [source.title, source.file_name].filter(Boolean).join(" "),
    content: source.content ?? "",
  });
  // Segments are grouped by source representation so adjacency means "next to each
  // other in the same representation", never a flat-list coincidence across e.g. the
  // content/synopsis boundary.
  return [
    ...(atomicClozapineRedRange
      ? [
          [
            {
              passage: atomicClozapineRedRange,
              evidence: `${sourceContext}. ${atomicClozapineRedRange}`,
              antecedent: "",
            },
          ],
        ]
      : []),
    split(source.content, sourceContext, reflowComparisonContent),
    split(source.retrieval_synopsis, sourceContext),
    ...(source.table_facts ?? []).map((fact) =>
      split(
        [[fact.row_label, fact.clinical_parameter, fact.threshold_value].filter(Boolean).join(" "), fact.action]
          .filter(Boolean)
          .join(": "),
        fact.table_title,
      ),
    ),
    split(source.index_unit?.content, source.index_unit?.title),
    // A toxicity list heading with one of its bullets is one statement ("Signs of severe toxicity: o
    // Increased muscle tone, …"); every support check still runs against that heading-and-bullet text.
    toxicityHeadingBulletPassages(source.content).map((passage) => ({
      passage,
      evidence: [sourceContext, passage].filter(Boolean).join(". "),
      antecedent: "",
    })),
  ].filter((group) => group.length > 0);
}

// "Avoid the combination where possible" names its medicines only in the sentence before it. Only that
// sentence may lend them: an earlier sentence about another medicine (even one called safe) may not.
function precedingSentence(parts: string[], index: number) {
  const sentence: string[] = [];
  for (let at = index - 1; at >= 0; at -= 1) {
    if (sentence.length > 0 && /[.!?]["')\]]*\s*$/.test(parts[at])) break;
    sentence.unshift(parts[at]);
  }
  return sentence.join(" ");
}

// "Avoid the combination where possible" names its medicines only in the source text before it.
const combinationAnaphorPattern = /\b(?:the|this|that|such)\s+combinations?\b/i;

// Lowercased words, comparators and decimals, with "such as" and "for example" read as "e.g.", and sentence or list-item
// boundaries kept as "|" so a match can be anchored to them. A colon or semicolon is not an anchor:
// "If eGFR is below 30: stop lithium" must not support "Stop lithium" alone.
function verbatimTokens(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/\be\.\s?g\.|\bsuch as\b|\bfor example\b/g, " eg ")
      .replace(/\bi\.\s?e\./g, " ie ")
      .replace(/[.!?](?=\s|$)|[•\n]/g, " | ")
      // Units and exponents are part of the value: "× 10⁹/L" must not match "× 10³/L", nor "µg" match "g".
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (digits) => ` ^${[...digits].map((d) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(d)).join("")} `)
      .replace(/[µμ]/g, " micro ")
      .replace(/(?<=\d)\s*:\s*(?=\d)/g, " ratio ")
      .replace(/[^a-z0-9|<>≤≥=%.^/×]+/g, " ")
      .replace(/\.(?!\d)|(?<!\d)\./g, " ")
      .replace(/([<>≤≥=%/×])/g, " $1 ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((token, index, tokens) => !(token === "o" && (index === 0 || tokens[index - 1] === "|")))
  );
}

// A claim that restates whole source text word for word is supported by it, even when the segment
// split above cut that sentence at "e.g." or "and the" (#ZZ4RAP: "NSAIDs (e.g. ibuprofen) can reduce
// lithium clearance and therefore increase lithium levels and the risk of toxicity"). The match must
// start and end at a source sentence or list-item boundary, so a claim that drops a leading "do not",
// a leading condition or a trailing qualifier never matches.
export function claimRestatesSourceVerbatim(claim: string, source: SearchResult) {
  const wanted = verbatimTokens(claim).filter((token) => token !== "|");
  if (wanted.length < 6) return false;
  const blocks = reflowBoundedSourceLines(source.content ?? "", { requireContinuationStart: true });
  return blocks.some((block, blockIndex) => {
    const tokens = verbatimTokens(block);
    // A block that continues a colon-led or unfinished line is governed by it, so its start is
    // not a sentence boundary.
    const blockStartsSentence = blockIndex === 0 || /[.!?]["')\]]*\s*$/.test(blocks[blockIndex - 1]);
    return tokens.some((_, start) => {
      if (start === 0 ? !blockStartsSentence : tokens[start - 1] !== "|") return false;
      let position = start;
      // The match stays inside one source sentence or list item: words joined across a boundary
      // can attach a condition to the wrong instruction.
      for (const token of wanted) {
        if (tokens[position] !== token) return false;
        position += 1;
      }
      return position === tokens.length || tokens[position] === "|";
    });
  });
}

function sourceSupportsClaim(claim: string, source: SearchResult, allowValueOnly = false) {
  if (claimRestatesSourceVerbatim(claim, source)) return true;
  return sourceEvidenceClaimSegmentGroups(source, claim).some((group) =>
    group.some(({ evidence, passage, antecedent }, index) => {
      // S1c R3: lend only the immediately adjacent segments' topic tokens, and only
      // from segments carrying no clinical value atoms of their own — an atom-bearing
      // neighbour is a competing value context (e.g. the other population's dose), not
      // supplementary prose, and lending its topics would let a claim bind this
      // segment's value to the neighbour's condition.
      const adjacentTopicText = [group[index - 1]?.evidence, group[index + 1]?.evidence]
        .filter((neighbour): neighbour is string => Boolean(neighbour))
        .filter((neighbour) => extractClinicalValueAtoms(neighbour).length === 0)
        .join(" ");
      return evidenceTextSupportsClaim(
        claim,
        evidence,
        passage,
        adjacentTopicText || undefined,
        allowValueOnly,
        combinationAnaphorPattern.test(passage) ? antecedent : undefined,
      );
    }),
  );
}

/**
 * Whether one source chunk independently supports every top-level claim in
 * generated answer prose. This intentionally ignores answer sections: it is
 * used only to decide whether a retrieved chunk may be promoted into the
 * top-level citation list, so section-scoped support cannot piggyback on it.
 */
export function sourceDirectlySupportsAnswerText(answerText: string, source: SearchResult) {
  const claims = splitClaims(answerText);
  return claims.length > 0 && claims.every((claim) => sourceSupportsClaim(claim, source));
}

function currentGoodDirectSupportSource(source: SearchResult) {
  const metadata = source.source_metadata;
  if (metadata?.document_status !== "current" || metadata.extraction_quality !== "good") return false;
  return !source.indexing_quality || source.indexing_quality.extraction_quality === "good";
}

function sourceBandConflictSegments(source: SearchResult) {
  const groupedTableFacts = new Map<string, string[]>();
  for (const fact of source.table_facts ?? []) {
    const key = [fact.table_title ?? "", fact.clinical_parameter ?? ""].join("||");
    const rows = groupedTableFacts.get(key) ?? [];
    rows.push([fact.row_label, fact.threshold_value, fact.action].filter(Boolean).join(" "));
    groupedTableFacts.set(key, rows);
  }
  const segments = [
    source.content,
    source.adjacent_context,
    source.adjacent_context ? [source.content, source.adjacent_context].filter(Boolean).join("\n") : null,
    source.adjacent_context ? [source.adjacent_context, source.content].filter(Boolean).join("\n") : null,
    source.retrieval_synopsis,
    ...[...groupedTableFacts.entries()].map(([key, rows]) => `${key.replace("||", " ")} ${rows.join("; ")}`),
    source.index_unit?.content,
  ].filter((value): value is string => Boolean(value));
  for (const [key, rows] of groupedTableFacts) {
    const [tableTitle, clinicalParameter] = key.split("||");
    const scopeTerms = [tableTitle, clinicalParameter]
      .map((value) => value.trim())
      .filter((value) => value && !/^(?:scores?|risks?|severit(?:y|ies)|levels?|bands?|ranges?)$/i.test(value));
    if (scopeTerms.length === 0) continue;
    for (const representation of [source.content, source.retrieval_synopsis, source.index_unit?.content]) {
      if (!representation) continue;
      const scopedBandSegments = representation
        .split(/\s*;\s*|(?<=[.!?])\s+|\n+|\s+(?:while|whereas)\s+/i)
        .map((value) => value.trim())
        .filter(
          (value) =>
            containsLabelledNumericBand(value) &&
            scopeTerms.some((term) => value.toLowerCase().includes(term.toLowerCase())),
        );
      for (const scopedBandSegment of scopedBandSegments) {
        segments.push(`${scopedBandSegment.replace(/[.!?]\s*$/, ";")} ${rows.join("; ")}`);
      }
    }
  }
  return segments;
}

function sourceBandConflicts(source: SearchResult) {
  return sourceBandConflictSegments(source).flatMap((value) => detectLabelledNumericBandConflicts(value));
}

/**
 * Detects same-chunk labelled-band conflicts that specifically affect delivered text.
 *
 * @param source - Candidate search result
 * @param text - Answer or section text
 * @param bandContext - Optional surrounding band context
 * @returns Array of affecting labelled numeric band conflicts
 */
export function sourceLabelledNumericBandConflictsAffectingText(source: SearchResult, text: string, bandContext = "") {
  return sourceBandConflictSegments(source).flatMap((segment) =>
    labelledNumericBandConflictsAffectingText(text, segment, bandContext),
  );
}

/**
 * Checks whether a search result source contains internal labelled numeric band contradictions.
 *
 * @param source - Search result to inspect
 * @returns `true` if conflicting numeric bands are present
 */
export function sourceHasLabelledNumericBandConflict(source: SearchResult) {
  return sourceBandConflicts(source).length > 0;
}

function nonNumericAlternativeAfterBandConflict(answerText: string, conflict: LabelledNumericBandConflict) {
  let conflictStart = conflict.start;
  let conflictEnd = conflict.end;
  while (conflictStart > 0 && /[*_`]/.test(answerText[conflictStart - 1])) conflictStart -= 1;
  while (conflictEnd < answerText.length && /[*_`]/.test(answerText[conflictEnd])) conflictEnd += 1;
  const before = answerText.slice(0, conflictStart);
  const after = answerText.slice(conflictEnd);
  const actionMatch = before.match(/^(.+)\b(?:when|if)\b[^.!?\n]*$/i);
  const alternativeMatch = after.match(/^[\s),;:\-]*or\s+(whenever|when|if)\s+([^.!?\n]+)[.!?]?\s*$/i);
  if (!actionMatch || !alternativeMatch) return null;
  const alternative = alternativeMatch[2].trim();
  if (/^(?:it|this|that|they|these|those|otherwise)\b/i.test(alternative)) return null;
  const condition = alternative.replace(/,\s*irrespective\s+of\s+(?:the\s+)?score\s*$/i, "").trim();
  if (
    !condition ||
    /[,;:]/.test(condition) ||
    /\b(?:and|but|or|then)\b/i.test(condition) ||
    directiveActions(condition).size > 0
  ) {
    return null;
  }
  const candidate = `${actionMatch[1].trim()} ${alternativeMatch[1].toLowerCase()} ${alternative}`
    .replace(/\s+/g, " ")
    .replace(/[.!?]*$/, ".");
  if (/\d/.test(candidate) || extractClinicalValueAtoms(candidate).length > 0) return null;
  return candidate;
}

/**
 * Withhold internally contradictory labelled bands. A single, explicitly
 * alternative nonnumeric condition may survive only when an existing trusted
 * citation independently supports the complete reconstructed claim.
 */
export function enforceLabelledNumericBandCoherence(
  answer: RagAnswer,
  original?: {
    answerText?: string;
    sectionTexts?: string[];
    sectionFields?: Array<{ body: string; citationChunkIds: string[] }>;
    verificationSources?: SearchResult[];
    query?: string;
  },
): RagAnswer {
  const answerText = original?.answerText ?? answer.answer;
  const sectionFields =
    original?.sectionFields ??
    original?.sectionTexts?.map((body, index) => ({
      body,
      citationChunkIds: answer.answerSections?.[index]?.citation_chunk_ids ?? [],
    })) ??
    (answer.answerSections ?? []).map((section) => ({
      body: section.body,
      citationChunkIds: section.citation_chunk_ids,
    }));
  const sectionTexts = sectionFields.map((section) => section.body);
  const topLevelConflicts = detectLabelledNumericBandConflicts(answerText);
  const sectionConflicts = sectionTexts.flatMap((section) => detectLabelledNumericBandConflicts(section));
  const directQuoteConflicts = (answer.quoteCards ?? []).flatMap((quote) =>
    detectLabelledNumericBandConflicts(quote.quote),
  );
  const coherenceSources = original?.verificationSources ?? answer.sources;
  const sourceById = new Map(coherenceSources.map((source) => [source.id, source]));
  const adjacentSourceConflicts = adjacentLabelledNumericBandConflicts(coherenceSources);
  // Conflict detection is defensive: inspect every cited supporting source,
  // regardless of whether its provenance is strong enough for promotion.
  const topLevelCitationIds = answer.citations.map((citation) => citation.chunk_id);
  const actionableBareNumericBand = (claim: string) =>
    (directiveActions(claim).size > 0 || /\b(?:urgent(?:ly)?|threshold|score|risk|result)\b/i.test(claim)) &&
    /(?:[<>≤≥]\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?(?:\s*(?:[-–—]|\bto\b|\bthrough\b)\s*\d+(?:[.,]\d+)?)?)/i.test(claim);
  const labelledScalarBand = (claim: string) =>
    /(?:\b(?:very\s+(?:high|low|severe)|borderline|moderate|medium|minimal|normal|high|low|mild|severe|green|amber|red)\b[^.!?\n]{0,48}\d|\d[^.!?\n]{0,48}\b(?:very\s+(?:high|low|severe)|borderline|moderate|medium|minimal|normal|high|low|mild|severe|green|amber|red)\b)/i.test(
      claim,
    );
  const needsBandSourceInspection = (claim: string) =>
    containsNumericBandReference(claim) || actionableBareNumericBand(claim) || labelledScalarBand(claim);
  const comparisonBandScopes = (() => {
    if (!answer.preformatted || answer.responseMode !== "comparison_matrix") return [];
    const entries = (answer.comparisonMatrix?.rows ?? []).flatMap((row) =>
      row.entries.map((entry) => ({
        ...entry,
        parameter: row.parameter,
        label:
          answer.comparisonMatrix?.documents.find((document) => document.documentId === entry.documentId)?.title ??
          entry.documentId,
      })),
    );
    return entries.flatMap((entry) => {
      const segment = attributedEntrySegment(answerText, entry, entries);
      return segment && needsBandSourceInspection(segment)
        ? [{ claim: segment, citationChunkIds: entry.chunkIds }]
        : [];
    });
  })();
  const proseBandClaimScopes = [
    ...comparisonBandScopes,
    ...splitClaims(answerText)
      .filter(needsBandSourceInspection)
      .map((claim) => ({ claim, citationChunkIds: topLevelCitationIds })),
    ...sectionFields.flatMap((section) =>
      splitClaims(section.body)
        .filter(needsBandSourceInspection)
        .map((claim) => ({ claim, citationChunkIds: section.citationChunkIds })),
    ),
  ];
  const quoteBandClaimScopes = (answer.quoteCards ?? [])
    .map((quote, quoteIndex) => ({ quote, quoteIndex }))
    .filter(({ quote }) => needsBandSourceInspection(quote.quote))
    .map(({ quote, quoteIndex }) => ({
      claim: quote.quote,
      citationChunkIds: [quote.chunk_id],
      quoteIndex,
    }));
  const sourceConflictsForScopes = (scopes: Array<{ claim: string; citationChunkIds: string[] }>) =>
    scopes.flatMap(({ claim, citationChunkIds }) =>
      citationChunkIds.flatMap((chunkId) => {
        const source = sourceById.get(chunkId);
        if (!source) return [];
        const localConflicts = sourceDirectlySupportsAnswerText(claim, source)
          ? sourceLabelledNumericBandConflictsAffectingText(source, claim, original?.query)
          : [];
        const adjacentConflicts = adjacentSourceConflicts
          .filter(
            (conflict) =>
              conflict.chunkIds.includes(chunkId) &&
              textReferencesAdjacentBandConflict(claim, chunkId, [conflict], original?.query),
          )
          .flatMap((conflict) => conflict.conflicts);
        return [...localConflicts, ...adjacentConflicts];
      }),
    );
  const adjacentConflictChunkIdsForScopes = (scopes: Array<{ claim: string; citationChunkIds: string[] }>) =>
    scopes.flatMap(({ claim, citationChunkIds }) =>
      citationChunkIds.flatMap((chunkId) =>
        adjacentSourceConflicts
          .filter(
            (conflict) =>
              conflict.chunkIds.includes(chunkId) &&
              textReferencesAdjacentBandConflict(claim, chunkId, [conflict], original?.query),
          )
          .flatMap((conflict) => conflict.chunkIds),
      ),
    );
  const citedSourceConflicts = sourceConflictsForScopes(proseBandClaimScopes);
  const citedAdjacentConflictChunkIds = [...new Set(adjacentConflictChunkIdsForScopes(proseBandClaimScopes))];
  const quoteScopeConflicts = quoteBandClaimScopes.map((scope) => ({
    quoteIndex: scope.quoteIndex,
    chunkId: scope.citationChunkIds[0],
    conflicts: sourceConflictsForScopes([scope]),
    adjacentChunkIds: adjacentConflictChunkIdsForScopes([scope]),
  }));
  const quoteSourceConflicts = quoteScopeConflicts.flatMap((item) => item.conflicts);
  const quoteConflicts = [...directQuoteConflicts, ...quoteSourceConflicts];
  const conflicts = [...topLevelConflicts, ...sectionConflicts, ...citedSourceConflicts];
  if (conflicts.length === 0 && quoteConflicts.length === 0) return answer;

  if (conflicts.length === 0) {
    const unsafeQuoteIndexes = new Set([
      ...(answer.quoteCards ?? [])
        .map((quote, index) => ({ quote, index }))
        .filter(({ quote }) => detectLabelledNumericBandConflicts(quote.quote).length > 0)
        .map(({ index }) => index),
      ...quoteScopeConflicts.filter((item) => item.conflicts.length > 0).map((item) => item.quoteIndex),
    ]);
    const retainedQuoteCards = (answer.quoteCards ?? []).filter((_, index) => !unsafeQuoteIndexes.has(index));
    const removedChunkIds = [...unsafeQuoteIndexes]
      .flatMap((index) => [
        answer.quoteCards?.[index]?.chunk_id,
        ...(quoteScopeConflicts.find((item) => item.quoteIndex === index)?.adjacentChunkIds ?? []),
      ])
      .filter((chunkId): chunkId is string => Boolean(chunkId));
    return {
      ...answer,
      confidence: answer.confidence === "high" ? "medium" : answer.confidence,
      quoteCards: retainedQuoteCards,
      conflictsOrGaps: [
        ...(answer.conflictsOrGaps ?? []).filter(
          (item) => !item.message.startsWith(LABELLED_NUMERIC_BAND_CONFLICT_NOTE),
        ),
        {
          type: "conflict",
          message: `${LABELLED_NUMERIC_BAND_CONFLICT_NOTE} The conflicting quote excerpt was withheld.`,
          ...(removedChunkIds.length > 0 ? { source_chunk_ids: [...new Set(removedChunkIds)] } : {}),
        },
      ],
      routingReason: appendRoutingReason(answer.routingReason, "numeric_band_conflict_quote_withheld"),
    };
  }

  const reconstructedCandidate =
    answer.grounded &&
    answer.confidence !== "unsupported" &&
    !answer.preformatted &&
    topLevelConflicts.length === 1 &&
    sectionConflicts.length === 0
      ? nonNumericAlternativeAfterBandConflict(answerText, topLevelConflicts[0])
      : null;
  if (!reconstructedCandidate) {
    return failClosedForLabelledNumericBandConflict(answer, conflicts, citedAdjacentConflictChunkIds);
  }

  // Detection runs on the raw provider text so score-band syntax is not lost,
  // but recovered prose must still cross the ordinary answer-text boundary.
  // Revalidate after sanitizing because artifact removal can change the claim
  // that is ultimately shown and cited.
  const candidate = sanitizeAnswerText(reconstructedCandidate);
  if (
    !candidate ||
    /\d/.test(candidate) ||
    extractClinicalValueAtoms(candidate).length > 0 ||
    detectLabelledNumericBandConflicts(candidate).length > 0
  ) {
    return failClosedForLabelledNumericBandConflict(answer, conflicts, citedAdjacentConflictChunkIds);
  }

  const retainedCitations = answer.citations.filter((citation) => {
    if (!acceptedProvenance.has(citation.provenance ?? "model_selected")) return false;
    const source = sourceById.get(citation.chunk_id);
    if (!source) return false;
    return currentGoodDirectSupportSource(source) && sourceDirectlySupportsAnswerText(candidate, source);
  });
  if (retainedCitations.length === 0) {
    return failClosedForLabelledNumericBandConflict(answer, conflicts, citedAdjacentConflictChunkIds);
  }

  const affectedLabels = [...new Set(conflicts.flatMap((item) => item.labels))];
  return {
    ...answer,
    answer: candidate,
    confidence: answer.confidence === "high" ? "medium" : answer.confidence,
    citations: retainedCitations,
    answerSections: [],
    quoteCards: [],
    conflictsOrGaps: [
      ...(answer.conflictsOrGaps ?? []).filter((item) => !item.message.startsWith(LABELLED_NUMERIC_BAND_CONFLICT_NOTE)),
      {
        type: "conflict",
        message: `${LABELLED_NUMERIC_BAND_CONFLICT_NOTE} Only the independently supported nonnumeric alternative is shown.${
          affectedLabels.length > 0 ? ` Affected labels: ${affectedLabels.join(", ")}.` : ""
        }`,
        source_chunk_ids: [...new Set(retainedCitations.map((citation) => citation.chunk_id))],
      },
    ],
    routingReason: appendRoutingReason(answer.routingReason, "numeric_band_conflict_nonnumeric_recovery"),
    supportedClaims: undefined,
    evidenceAssessments: undefined,
    unverifiedNumericTokens: undefined,
    faithfulnessWarning: undefined,
  };
}

function sourceIsRelated(claim: string, source: SearchResult) {
  const evidence = sourceEvidenceText(source);
  const claimEntities = entities(claim);
  const evidenceEntities = entities(evidence);
  if (claimEntities.size > 0 && [...claimEntities].some((entity) => evidenceEntities.has(entity))) return true;
  const claimTopics = topicTokens(claim);
  const evidenceTopics = topicTokens(evidence);
  return [...claimTopics].some((token) => evidenceTopics.has(token));
}

type ClaimInput = {
  text: string;
  chunkIds: string[];
  provenance: CitationProvenance;
  sectionIndex?: number;
  comparisonEntries?: Array<{ label: string; parameter: string; value: string | null; chunkIds: string[] }>;
  requiresIndividualAttribution?: boolean;
};

function normalizeAttribution(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ": ")
    .trim();
}

function attributedEntrySegment(
  claim: string,
  entry: NonNullable<ClaimInput["comparisonEntries"]>[number],
  entries: NonNullable<ClaimInput["comparisonEntries"]>,
) {
  const lowerClaim = claim.toLowerCase();
  const labelToken = `${entry.label.toLowerCase()}:`;
  const labelIndex = lowerClaim.indexOf(labelToken);
  if (labelIndex < 0) return null;
  const start = labelIndex + labelToken.length;
  const boundaries = [lowerClaim.indexOf(";", start)]
    .concat(
      entries
        .filter((candidate) => candidate !== entry)
        .map((candidate) => lowerClaim.indexOf(`${candidate.label.toLowerCase()}:`, start)),
    )
    .filter((index) => index >= start);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : claim.length;
  return claim.slice(start, end).trim();
}

function comparisonClauseHasAttribution(text: string, sources: SearchResult[]) {
  if (entities(text).size > 0) return true;
  const normalized = normalizeAttribution(text);
  return sources.some((source) => {
    const labels = [source.title, source.file_name.replace(/\.[^.]+$/, ""), source.document_id];
    return labels.some((label) => label.length >= 4 && normalized.includes(normalizeAttribution(label)));
  });
}

const clinicalRecommendationPattern =
  /\b(?:administer|avoid|cease|continue|contraindicat(?:ed|ion)?|discontinue|dose|escalat|give|initiat|monitor|recommend|repeat|should|start|stop|urgent|use|withhold|must|may|can)\b/i;

function normalizedGapText(value: string) {
  return value
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isBoundedEvidenceGapSegment(segment: string, parameter: string) {
  const normalized = normalizedGapText(segment);
  const normalizedParameter = normalizedGapText(parameter);
  if (normalized === "no evidence found" || normalized === `no evidence found for ${normalizedParameter}`) {
    return true;
  }
  if (extractClinicalValueAtoms(segment).length > 0 || clinicalRecommendationPattern.test(segment)) return false;
  return true;
}

function comparisonRows(answer: RagAnswer, claim: string) {
  const normalizedClaim = claim.toLowerCase();
  return (answer.comparisonMatrix?.rows ?? []).filter((row) => {
    const parameterTokens = row.parameter
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);
    return parameterTokens.length > 0 && parameterTokens.every((token) => normalizedClaim.includes(token));
  });
}

function claimInputs(answer: RagAnswer): { inputs: ClaimInput[] } {
  const eligibleCitationIds = (answer.citations ?? [])
    .filter((citation) => acceptedProvenance.has(citation.provenance ?? "model_selected"))
    .map((citation) => citation.chunk_id);
  const scopedInput = (
    text: string,
    fallback: string[],
    provenance: CitationProvenance,
    sectionIndex?: number,
  ): ClaimInput => {
    if (!answer.preformatted || answer.responseMode !== "comparison_matrix") {
      return {
        text,
        chunkIds: fallback,
        provenance,
        sectionIndex,
        requiresIndividualAttribution: answer.responseMode === "comparison_matrix",
      };
    }
    const rows = comparisonRows(answer, text);
    const comparisonEntries = rows.flatMap((row) =>
      row.entries.map((entry) => ({
        ...entry,
        parameter: row.parameter,
        label:
          answer.comparisonMatrix?.documents.find((document) => document.documentId === entry.documentId)?.title ??
          entry.documentId,
      })),
    );
    return {
      text,
      chunkIds: [...new Set(comparisonEntries.flatMap((entry) => entry.chunkIds))],
      provenance,
      sectionIndex,
      comparisonEntries,
    };
  };
  const split =
    answer.responseMode === "comparison_matrix"
      ? answer.preformatted
        ? (value: string) => {
            const claim = cleanText(value);
            return claim ? [claim] : [];
          }
        : splitComparisonClaims
      : splitClaims;
  const topLevelClaims = split(answer.answer);
  const topLevel = topLevelClaims.map((text) => scopedInput(text, eligibleCitationIds, "model_selected"));
  const sectionSplits = (answer.answerSections ?? []).map((section, sectionIndex) => ({
    claims: split(section.body),
    chunkIds: section.citation_chunk_ids,
    sectionIndex,
  }));
  const sections = sectionSplits.flatMap(({ claims: sectionClaims, chunkIds, sectionIndex }) =>
    sectionClaims.map((text) => scopedInput(text, chunkIds, "section_selected", sectionIndex)),
  );
  return {
    inputs: [...topLevel, ...sections],
  };
}

function claimAssessment(
  input: ClaimInput,
  index: number,
  sourceById: Map<string, SearchResult>,
  forceRoutine: boolean,
): SupportedClaim {
  const eligibleSources = input.chunkIds
    .map((id) => sourceById.get(id))
    .filter((source): source is SearchResult => !!source);
  const hasAttribution =
    !input.requiresIndividualAttribution || comparisonClauseHasAttribution(input.text, eligibleSources);
  const directSources = hasAttribution
    ? eligibleSources.filter((source) => sourceSupportsClaim(input.text, source))
    : [];
  const comparisonEntryResults = (input.comparisonEntries ?? []).map((entry) => {
    const segment = attributedEntrySegment(input.text, entry, input.comparisonEntries ?? []);
    if (!segment) return { direct: false, supportingChunkId: null };
    if (entry.value === null) {
      return { direct: isBoundedEvidenceGapSegment(segment, entry.parameter), supportingChunkId: null };
    }
    if (!normalizeAttribution(segment).includes(normalizeAttribution(entry.value))) {
      return { direct: false, supportingChunkId: null };
    }
    const supportingSource = entry.chunkIds
      .map((id) => sourceById.get(id))
      .find((source) => source && sourceSupportsClaim(segment, source, true));
    return { direct: Boolean(supportingSource), supportingChunkId: supportingSource?.id ?? null };
  });
  const comparisonSupportingChunkIds = comparisonEntryResults
    .map((result) => result.supportingChunkId)
    .filter((id): id is string => Boolean(id));
  const comparisonDirect =
    Boolean(input.comparisonEntries?.length) &&
    comparisonEntryResults.every((result) => result.direct) &&
    comparisonSupportingChunkIds.length > 0;
  const related = eligibleSources.some((source) => sourceIsRelated(input.text, source));
  return {
    claimId: `claim-${index + 1}`,
    text: input.text,
    riskClass: !forceRoutine && isHighRiskClaim(input.text) ? "high_risk" : "routine",
    supportingChunkIds: comparisonDirect ? comparisonSupportingChunkIds : directSources.map((source) => source.id),
    supportStatus: directSources.length || comparisonDirect ? "direct" : related ? "partial" : "unsupported",
  };
}

function evidenceAssessment(source: SearchResult, claims: SupportedClaim[], inputs: ClaimInput[]): EvidenceAssessment {
  const metadata = source.source_metadata;
  const supports = claims.filter((claim) => claim.supportingChunkIds.includes(source.id));
  const mappedInputs = inputs.filter((input) => input.chunkIds.includes(source.id));
  const partial = mappedInputs.some((input) => sourceIsRelated(input.text, source));
  return {
    relevance: source.relevance?.verdict ?? (mappedInputs.length > 0 ? "nearby" : "none"),
    claimSupport: supports.length ? "direct" : partial ? "partial" : "unsupported",
    authority:
      metadata?.clinical_validation_status && metadata.clinical_validation_status !== "unknown"
        ? metadata.clinical_validation_status
        : "unverified",
    currency: metadata?.document_status ?? "unknown",
    extractionQuality: metadata?.extraction_quality ?? "unknown",
  };
}

function assessClaimSupportDetails(answer: RagAnswer, verificationSources: SearchResult[] = answer.sources) {
  const sourceById = new Map(verificationSources.map((source) => [source.id, source]));
  const documentLookupAnswer =
    answer.responseMode === "document_lookup" ||
    answer.queryClass === "document_lookup" ||
    (answer.preformatted &&
      (answer.answerSections?.length ?? 0) > 0 &&
      (answer.answerSections ?? []).every((section) => section.kind === "documentation"));
  const sourceBackedReviewAnswer = Boolean(answer.sourceBackedReviewFallback);
  const { inputs } = claimInputs(answer);
  const claims = inputs.map((input, index) =>
    claimAssessment(input, index, sourceById, Boolean(documentLookupAnswer || sourceBackedReviewAnswer)),
  );
  const evidenceAssessments = Object.fromEntries(
    verificationSources.map((source) => [source.id, evidenceAssessment(source, claims, inputs)]),
  );
  return { claims, evidenceAssessments, inputs };
}

/**
 * Evaluates support status and evidence assessments for all clinical claims in an answer without mutating the answer.
 *
 * @param answer - RAG answer to assess
 * @returns Object with supportedClaims and evidenceAssessments
 */
export function assessClaimSupport(answer: RagAnswer, verificationSources?: SearchResult[]) {
  const { claims, evidenceAssessments } = assessClaimSupportDetails(answer, verificationSources);
  return { claims, evidenceAssessments };
}

/**
 * Assesses clinical claim support across top-level answer and sections, enforcing fail-closed degradation upon unsupported high-risk claims.
 *
 * @param answer - The candidate RAG answer
 * @returns Verified and safely degraded or augmented RAG answer
 */
export function assessAndEnforceClaimSupport(answer: RagAnswer, verificationSources?: SearchResult[]): RagAnswer {
  const { claims, evidenceAssessments, inputs } = assessClaimSupportDetails(answer, verificationSources);
  if (!answer.grounded || answer.confidence === "unsupported" || answer.responseMode === "evidence_gap") {
    return { ...answer, supportedClaims: claims, evidenceAssessments };
  }
  const reviewOnly =
    answer.responseMode === "document_lookup" ||
    answer.queryClass === "document_lookup" ||
    answer.sourceBackedReviewFallback ||
    (answer.preformatted &&
      (answer.answerSections?.length ?? 0) > 0 &&
      answer.answerSections!.every((section) => section.kind === "documentation"));
  const governanceGap = (claim: SupportedClaim) =>
    claim.riskClass === "high_risk" &&
    claim.supportingChunkIds.some(
      (id) => evidenceAssessments[id]?.currency === "outdated" || evidenceAssessments[id]?.extractionQuality === "poor",
    );
  const unsafe = claims.map(
    (claim) =>
      governanceGap(claim) ||
      (claim.supportStatus !== "direct" && (!reviewOnly || factualRelation(claim.text) !== null)),
  );
  if (!unsafe.some(Boolean)) {
    return {
      ...answer,
      supportedClaims: claims,
      evidenceAssessments,
      confidence:
        claims.some((claim) => claim.supportStatus !== "direct") && answer.confidence === "high"
          ? "medium"
          : answer.confidence,
    };
  }

  // The model output is already bounded upstream. Assess all of it, and retain
  // independently supported claims within their original citation scopes.
  const retainedText = (sectionIndex?: number) => {
    // Comparison inputs carry row-level attribution, so do not reconstruct a
    // failed row from prose fragments that no longer own those entry bindings.
    if (answer.responseMode === "comparison_matrix") return "";
    const original = sectionIndex === undefined ? answer.answer : answer.answerSections![sectionIndex].body;
    const rejected = new Set(
      inputs.filter((input, index) => input.sectionIndex === sectionIndex && unsafe[index]).map((input) => input.text),
    );
    // A coordinated instruction is not independently salvageable: withholding
    // "and escalate urgently" must not turn it into a stop-only recommendation.
    return original
      .split(/\r?\n+|(?<=[.!?])(?<!\b[Ee]\.[Gg]\.|\b[Ii]\.[Ee]\.)\s+/)
      .flatMap((sentence) => {
        const groups: string[] = [];
        for (const clause of sentence.split(/\s*;\s*/)) {
          // A bounded condition/consequent pair can own a separate instruction
          // for another medication. Count actions and entities in the consequent
          // only: a drug mentioned in a bare condition cannot supply its subject.
          const consequent = clause.match(/^(?:only\s+)?(?:if|unless|when)\b[^,;]+,\s*([^,;]+)$/i)?.[1];
          const consequentEntities = entities(consequent ?? "");
          const previousEntities = entities(groups[groups.length - 1] ?? "");
          const independentConditionalInstruction =
            consequent !== undefined &&
            normativeDirectiveActions(consequent).size > 0 &&
            consequentEntities.size > 0 &&
            [...consequentEntities].every((entity) => !previousEntities.has(entity));
          const continuesInstruction =
            /^(?:then|and|or|but)\b/i.test(clause) ||
            (/^(?:only\s+)?(?:if|unless|when)\b/i.test(clause) && !independentConditionalInstruction) ||
            (normativeDirectiveActions(clause).size > 0 && entities(clause).size === 0);
          if (groups.length > 0 && continuesInstruction) groups[groups.length - 1] += `; ${clause}`;
          else groups.push(clause);
        }
        return groups;
      })
      .filter((sentence) => !splitClaims(sentence).some((claim) => rejected.has(claim)))
      .join(" ")
      .trim();
  };
  const scopeChanged = (sectionIndex?: number) =>
    inputs.some((input, index) => input.sectionIndex === sectionIndex && unsafe[index]);
  let lead = scopeChanged() ? retainedText() : answer.answer;
  let sections = (answer.answerSections ?? []).flatMap((section, index) => {
    if (!scopeChanged(index)) return [section];
    const body = retainedText(index);
    return body ? [{ ...section, body }] : [];
  });
  let citations = answer.citations;
  if (!lead && sections.length > 0) {
    const promoted = sections[0];
    lead = promoted.body;
    citations = (verificationSources ?? answer.sources)
      .filter((source) => promoted.citation_chunk_ids.includes(source.id))
      .map((source) => ({
        chunk_id: source.id,
        document_id: source.document_id,
        title: source.title,
        file_name: source.file_name,
        page_number: source.page_number,
        chunk_index: source.chunk_index,
        provenance: "section_selected" as const,
      }));
    sections = sections.slice(1);
  }
  if (!lead) {
    const hasHighRiskGap = claims.some((claim, index) => unsafe[index] && claim.riskClass === "high_risk");
    return {
      ...answer,
      answer:
        "The available cited evidence does not directly support the answer claims. Review the retrieved source passages before making a clinical decision.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      answerSections: [],
      quoteCards: [],
      bestSource: null,
      responseMode: "evidence_gap",
      routingMode: "unsupported",
      routingReason: appendRoutingReason(
        answer.routingReason,
        claims.some(governanceGap)
          ? "material_source_governance_gap"
          : hasHighRiskGap
            ? "claim_support_high_risk_gap"
            : "claim_support_factual_gap",
      ),
      supportedClaims: claims,
      evidenceAssessments,
    };
  }
  const retained: RagAnswer = {
    ...answer,
    answer: lead,
    answerSections: sections,
    citations,
    bestSource: null,
    confidence: answer.confidence === "high" ? "medium" : answer.confidence,
    conflictsOrGaps: [
      ...(answer.conflictsOrGaps ?? []),
      {
        type: "gap",
        message: "Answer claims were withheld because their cited evidence did not directly support them.",
      },
    ],
    routingReason: appendRoutingReason(
      answer.routingReason,
      scopeChanged() ? "claim_support_unsupported_claims_withheld" : "claim_support_unsupported_sections_withheld",
    ),
  };
  const reassessed = assessClaimSupportDetails(retained, verificationSources);
  return { ...retained, supportedClaims: reassessed.claims, evidenceAssessments: reassessed.evidenceAssessments };
}
