import type {
  ClinicalAmbiguity,
  ClinicalQueryAnalysis,
  RagQueryPlan,
  RagSubquestion,
  RagSubquestionPurpose,
  SiteContentDomain,
} from "@/lib/types";

const broadPurposeOrder = [
  "primary",
  "required_action",
  "monitoring",
  "risk",
] as const satisfies readonly RagSubquestionPurpose[];
const siteDomainSignals: ReadonlyArray<readonly [SiteContentDomain, RegExp]> = [
  ["services", /\bservices?\b/i],
  ["forms", /\bforms?\b/i],
  ["medications", /\bmedications?|medicines?|drugs?\b/i],
  ["differentials", /\bdifferentials?|diagnos(?:is|es|tic)\b/i],
  ["specifiers", /\bspecifiers?\b/i],
  ["dsm", /\bdsm(?:-?5(?:-?tr)?)?\b/i],
  ["formulation", /\bformulations?\b/i],
  ["therapies", /\btherap(?:y|ies|eutic)\b/i],
  ["dictionary", /\bdictionary|definition|meaning\b/i],
  ["factsheets", /\bfact\s*sheets?\b/i],
  ["calculators", /\bcalculators?|scores?\b/i],
  ["tools", /\btools?\b/i],
];

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function dimensionReasons(query: string, analysis: ClinicalQueryAnalysis) {
  const reasons: string[] = [];
  const hasDocumentSignal =
    analysis.documentTitleIntent ||
    analysis.documentTitleTerms.length > 0 ||
    /\b(?:guideline|policy|procedure|protocol|document|section|chapter|appendix|table|form)\b/i.test(query);
  const hasMedicineSignal =
    analysis.medications.length > 0 ||
    analysis.typoCorrections.some((correction) => /clozapin|lithium|olanzapin|quetiapin/i.test(correction.to));

  if (hasDocumentSignal) reasons.push("document_explicit");
  if (hasMedicineSignal) reasons.push("medicine_explicit");
  if (
    /\b(?:adolescents?|children|child|paediatric|pediatric|adult|older adults?|elderly|pregnan\w*|perinatal)\b/i.test(
      query,
    )
  ) {
    reasons.push("population_explicit");
  }
  if (/\b(?:WA|Western Australia|Australia|Australian|NSW|Victoria|Queensland|Tasmania|ACT|NT|SA)\b/i.test(query)) {
    reasons.push("jurisdiction_explicit");
  }
  if (/\b(?:inpatient|outpatient|community|hospital|ward|emergency department|ED|clinic)\b/i.test(query)) {
    reasons.push("setting_explicit");
  }
  if (analysis.acronyms.length > 0) reasons.push("acronym_expanded");
  if (analysis.typoCorrections.length > 0) reasons.push("medicine_alias_or_typo_preserved");
  if (/\b(?:section|chapter|appendix|table)\s+(?:titled|called|named)\b/i.test(query)) {
    reasons.push("document_section_exact");
  }
  return reasons;
}

function materialAmbiguity(query: string, analysis: ClinicalQueryAnalysis): ClinicalAmbiguity | null {
  const asksUnqualifiedRequiredPeriod =
    /\b(?:what|how long).{0,24}\brequired\s+(?:observation|monitoring|review|follow[ -]?up)\s+period\b/i.test(query);
  const hasRetrievalAnchor =
    analysis.medications.length > 0 ||
    analysis.documentTitleIntent ||
    analysis.documentTitleTerms.length > 0 ||
    /\b(?:adolescent|child|adult|older|pregnan|WA|Western Australia|inpatient|outpatient|community|hospital|ward|ED)\b/i.test(
      query,
    );
  if (!asksUnqualifiedRequiredPeriod || hasRetrievalAnchor) return null;

  return {
    material: true,
    dimensions: ["population", "setting", "medicine", "jurisdiction", "decision"],
    clarificationQuestion:
      "Which population, care setting, medicine, or jurisdiction should the required observation period apply to?",
  };
}

function comparisonSides(query: string, analysis: ClinicalQueryAnalysis): [string, string] | null {
  if (!analysis.comparisonIntent) return null;
  const medicines = unique(analysis.medications).slice(0, 2);
  if (medicines.length === 2) return [medicines[0], medicines[1]];

  const match = query.match(/\b(?:compare|difference between)\s+(.+?)\s+(?:and|versus|vs\.?|with)\s+(.+)/i);
  if (!match) return null;
  const clean = (value: string) =>
    value
      .replace(/[?.!]+$/g, "")
      .replace(/\s+(?:monitoring|treatment|management|requirements?|approaches?|guidance)\b.*$/i, "")
      .trim();
  const left = clean(match[1]);
  const right = clean(match[2]);
  return left && right ? [left, right] : null;
}

function subquestion(id: number, question: string, purpose: RagSubquestionPurpose): RagSubquestion {
  return { id: `sq-${id}`, question, purpose, required: true };
}

function broadSubquestions(query: string) {
  const focus: Record<(typeof broadPurposeOrder)[number], string> = {
    primary: query,
    required_action: `${query} Focus on required treatment and escalation actions.`,
    monitoring: `${query} Focus on monitoring and review requirements.`,
    risk: `${query} Focus on material risks and safety escalation.`,
  };
  return broadPurposeOrder.map((purpose, index) => subquestion(index + 1, focus[purpose], purpose));
}

export function detectClinicalAmbiguity(query: string, analysis: ClinicalQueryAnalysis): ClinicalAmbiguity | null {
  return materialAmbiguity(query, analysis);
}

export function buildRagQueryPlan(query: string, analysis: ClinicalQueryAnalysis): RagQueryPlan {
  const ambiguity = materialAmbiguity(query, analysis);
  const explicitDomains = siteDomainSignals.filter(([, pattern]) => pattern.test(query)).map(([domain]) => domain);
  const inferredDomains: SiteContentDomain[] =
    explicitDomains.length > 0
      ? []
      : analysis.medications.length > 0
        ? ["medications"]
        : analysis.intent === "definition"
          ? ["dictionary"]
          : /\b(?:differential|diagnos(?:is|es|tic))\b/i.test(query)
            ? ["differentials"]
            : [];
  const targetSiteDomains = explicitDomains.length > 0 ? explicitDomains : inferredDomains;
  const siteDomainDecision = explicitDomains.length > 0 ? "explicit" : inferredDomains.length > 0 ? "inferred" : "none";
  const reasonCodes = unique([...analysis.reasons, ...dimensionReasons(query, analysis)]);
  if (ambiguity) {
    return {
      version: "rag-query-plan-v1",
      kind: "clarification_required",
      originalQuery: query,
      interpretation: `Material retrieval ambiguity requires one clarification: ${ambiguity.dimensions.join(", ")}.`,
      subquestions: [],
      targetSiteDomains,
      siteDomainDecision,
      reasonCodes: [...reasonCodes, "material_retrieval_ambiguity"],
    };
  }

  const sides = comparisonSides(query, analysis);
  const broad =
    analysis.queryClass === "broad_summary" ||
    analysis.intent === "broad_summary" ||
    /\b(?:managed?|management|including treatment|monitoring and escalation|comprehensive|overview)\b/i.test(query);
  let kind: RagQueryPlan["kind"] = "single";
  let subquestions = [subquestion(1, query, "primary")];
  if (sides) {
    kind = "decomposed";
    subquestions = [
      subquestion(1, query, "primary"),
      subquestion(2, `${sides[0]}: directly relevant evidence for this comparison.`, "comparison_side"),
      subquestion(3, `${sides[1]}: directly relevant evidence for this comparison.`, "comparison_side"),
    ];
    reasonCodes.push("comparison_sides_identified");
  } else if (broad) {
    kind = "decomposed";
    subquestions = broadSubquestions(query);
    reasonCodes.push("broad_management_decomposition");
  } else if (analysis.comparisonIntent) {
    reasonCodes.push("comparison_sides_unresolved_single_plan");
  }

  const interpretationDimensions = reasonCodes.filter((reason) =>
    /document|medicine|population|jurisdiction|setting|acronym|typo|comparison|broad/i.test(reason),
  );
  return {
    version: "rag-query-plan-v1",
    kind,
    originalQuery: query,
    interpretation: interpretationDimensions.length
      ? `Deterministic interpretation: ${interpretationDimensions.join(", ")}.`
      : "Deterministic interpretation: original clinical question retained.",
    subquestions: subquestions.slice(0, 4),
    targetSiteDomains,
    siteDomainDecision,
    reasonCodes: unique(reasonCodes),
  };
}
