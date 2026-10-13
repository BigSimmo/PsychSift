import { medicationDoseEvidenceQueryIntent } from "@/lib/clinical-search";
import { parseAnswerRequestContext } from "@/lib/answer-request-context";
import type {
  AdaptiveAnswerRequest,
  RagAskedPart,
  RagRequestedFacetDetail,
  ClinicalAmbiguity,
  ClinicalQueryAnalysis,
  RagQueryPlan,
  RagSubquestion,
  RagSubquestionPurpose,
  SiteContentDomain,
} from "@/lib/types";
import { hasClinicalPopulationSignal } from "@/lib/rag/rag-clinical-language-signals";

export const ragQueryPlanVersion = "rag-query-plan-v1" as const;
const siteDomainSignals: ReadonlyArray<readonly [SiteContentDomain, RegExp]> = [
  ["services", /\bservices?\b/i],
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
const jurisdictionSignal =
  /\b(?:WA|Western Australia|Australia|Australian|NSW|Victoria|Queensland|Tasmania|ACT|NT|SA)\b/i;
const settingSignal = /\b(?:inpatient|outpatient|community|hospital|ward|emergency department|ED|clinic)\b/i;
const administrativeFormSignal =
  /\b(?:application|assessment|consent|referral|template)\s+forms?\b|\bforms?\s+(?:is\s+)?(?:downloadable|needed|required|template)\b|\b(?:complete|download|submit|upload)\b(?:\s+\w+){0,3}\s+forms?\b/i;

function isSimpleDefinitionQuery(query: string, analysis: ClinicalQueryAnalysis) {
  if (analysis.intent !== "definition") return false;
  const normalized = query.trim();
  const definitionShape =
    /^(?:what\s+is\b|define\b|describe\b|meaning\b|term\b|give\s+(?:a\s+)?(?:comprehensive\s+)?definition\b)/i.test(
      normalized,
    ) ||
    /\b(?:definition|meaning)\s+of\b|\bwhat\s+does\b.+\bmean\b|\b(?:definition|meaning|term)\s*[?.!]*$/i.test(
      normalized,
    );
  return definitionShape;
}

function protectsBroadDecomposition(query: string, analysis: ClinicalQueryAnalysis) {
  if (isSimpleDefinitionQuery(query, analysis)) return true;
  if (analysis.queryClass === "document_lookup" || analysis.queryClass === "unsupported_or_general") return true;
  if (analysis.queryClass === "table_threshold") return true;
  if (analysis.queryClass !== "medication_dose_risk") return false;
  return (
    analysis.medications.length > 0 ||
    analysis.thresholdTerms.length > 0 ||
    analysis.documentTitleIntent ||
    analysis.documentTitleTerms.length > 0 ||
    /\b(?:dose|dosing|mg|micrograms?|milligrams?|route|oral|intramuscular|IM|missed dose)\b/i.test(query)
  );
}

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
  if (hasClinicalPopulationSignal(query)) {
    reasons.push("population_explicit");
  }
  if (jurisdictionSignal.test(query)) {
    reasons.push("jurisdiction_explicit");
  }
  if (settingSignal.test(query)) {
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
    /\b(?:adolescent|child|adult|older|pregnan(?:t|cy|cies)|WA|Western Australia|inpatient|outpatient|community|hospital|ward|ED)\b/i.test(
      query,
    );
  const requiredObject = query.match(
    /\b(?:which|what)\s+(form|procedure|guideline|policy|document|service|medication|tool|calculator)\s+is\s+(?:required|needed|used)\b/i,
  );
  const hasClinicalTarget =
    analysis.medications.length > 0 ||
    hasClinicalPopulationSignal(query) ||
    /\b(?:monitoring|treatment|assessment|admission|discharge)\b/i.test(query);
  const hasContextAnchor = jurisdictionSignal.test(query) || settingSignal.test(query);
  if (requiredObject && !(hasClinicalTarget && hasContextAnchor)) {
    const dimensions: ClinicalAmbiguity["dimensions"] = ["document"];
    if (!hasContextAnchor) dimensions.push("jurisdiction");
    if (!hasClinicalTarget) dimensions.push("decision");
    return {
      material: true,
      dimensions,
      clarificationQuestion: `Which clinical workflow, care setting, and jurisdiction should determine the required ${requiredObject[1].toLowerCase()}?`,
    };
  }

  if (asksUnqualifiedRequiredPeriod && !hasRetrievalAnchor) {
    return {
      material: true,
      dimensions: ["population", "setting", "medicine", "jurisdiction", "decision"],
      clarificationQuestion:
        "Which population, care setting, medicine, or jurisdiction should the required observation period apply to?",
    };
  }
  return null;
}

function identifiableComparisonSide(side: string, analysis: ClinicalQueryAnalysis) {
  if (
    /^(?:the\s+)?(?:benefits?|risks?|efficacy|safety|advantages?|disadvantages?|pros?|cons?)(?:\s+of\b.*)?$/i.test(side)
  ) {
    return false;
  }
  if (analysis.medications.some((medicine) => side.toLowerCase().includes(medicine.toLowerCase()))) return true;
  if (hasClinicalPopulationSignal(side) || jurisdictionSignal.test(side) || settingSignal.test(side)) return true;
  if (/\b(?:guideline|policy|procedure|protocol|form|service|therapy|medication)\b/i.test(side)) return true;
  return /^[A-Z][A-Z0-9-]{1,}$/.test(side.trim());
}

function comparisonSides(query: string, analysis: ClinicalQueryAnalysis): [string, string] | null {
  if (!analysis.comparisonIntent) return null;

  const match = query.match(/\b(?:compare|difference between)\s+(.+?)\s+(?:and|versus|vs\.?|with)\s+(.+)/i);
  if (!match) return null;
  const clean = (value: string) =>
    value
      .replace(/[?.!]+$/g, "")
      .replace(/\s+(?:monitoring|treatment|management|requirements?|approaches?|guidance)\b.*$/i, "")
      .trim();
  const left = clean(match[1]);
  const right = clean(match[2]);
  return left && right && identifiableComparisonSide(left, analysis) && identifiableComparisonSide(right, analysis)
    ? [left, right]
    : null;
}

function subquestion(id: number, question: string, purpose: RagSubquestionPurpose): RagSubquestion {
  return { id: `sq-${id}`, question, purpose, required: true };
}

const askedPartPatterns: ReadonlyArray<readonly [RagAskedPart, RegExp, RagSubquestionPurpose]> = [
  ["assessment", /\b(?:assess(?:ment)?|investigations?|examinations?)\b/i, "primary"],
  ["differential", /\bdifferentials?\b/i, "primary"],
  ["rationale", /\b(?:rationale|why|explain|explanation|mechanism)\b/i, "primary"],
  ["management", /\b(?:manage(?:d|ment)?|treatment|actions?)\b/i, "required_action"],
  ["dosing", /\b(?:dosing|dosage|dose)\b/i, "required_action"],
  ["monitoring", /\b(?:monitor(?:ing)?|review requirements)\b/i, "monitoring"],
  ["risk", /\b(?:risks?|safety|escalation)\b/i, "risk"],
  ["comparison", /\b(?:compare|comparison|versus|difference between)\b/i, "comparison_side"],
  ["service_workflow", /\b(?:services?|forms?|tools?|referral)\b/i, "primary"],
];

/** Narrow only our own bound facet lanes; the original request remains the overall coverage owner. */
export function coverageQueryForSubquestion(plan: RagQueryPlan, part: RagSubquestion): string {
  const facets = part.requestedFacets;
  const asked = plan.askedParts;
  if (!facets?.length || !asked?.length || facets.some((facet) => !asked.includes(facet))) return part.question;
  const suffix =
    facets.length === 1 ? ` Focus on the requested ${facets[0]}.` : ` Address the requested ${facets.join(", ")}.`;
  if (part.question !== `${plan.originalQuery}${suffix}`) return part.question;
  // Do not rewrite constraint-bearing clauses (including negation, population,
  // setting and source limits), even when their words resemble another facet.
  const context = parseAnswerRequestContext(plan.originalQuery);
  const requests = context
    ? [context.subject, ...context.constraints, context.latestRequest.replace(/^(?:please\s+)?elaborate[.!?]*$/i, "")]
    : [plan.originalQuery];
  const canonicalAsked = effectiveAskedParts(requests);
  const canonicalPart = broadSubquestions(plan.originalQuery, canonicalAsked).find(
    (candidate) => candidate.id === part.id,
  );
  if (
    JSON.stringify(asked) !== JSON.stringify(canonicalAsked) ||
    canonicalPart?.question !== part.question ||
    JSON.stringify(canonicalPart.requestedFacets) !== JSON.stringify(facets)
  )
    return part.question;
  return requests
    .map((request) => {
      const constraintStart =
        /\b(?:with|without|in|among|during|before|after|until|unless|if|when|aged|only|excluding|exclude|no|not)\b/i.exec(
          request,
        )?.index ?? request.length;
      let focus = request.slice(0, constraintStart);
      for (const [facet, pattern] of askedPartPatterns) {
        if (!asked.includes(facet) || facets.includes(facet)) continue;
        const removable =
          facet === "service_workflow" ? `${pattern.source}(?:\\s+(?:records?|pages?))?` : pattern.source;
        focus = focus.replace(new RegExp(removable, "gi"), (match, offset: number, text: string) =>
          text[offset - 1] === "-" || text[offset + match.length] === "-" ? match : " ",
        );
      }
      return `${focus}${request.slice(constraintStart)}`;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveAnswerSourcePolicy(query: string): NonNullable<RagQueryPlan["sourcePolicy"]> {
  const context = parseAnswerRequestContext(query);
  const requests = context ? [context.subject, ...context.constraints, context.latestRequest] : [query];
  let policy: NonNullable<RagQueryPlan["sourcePolicy"]> = "primary_plus_approved_supplements";
  for (const request of requests) {
    if (
      /\b(?:only|solely|exclusively)\b.{0,35}\b(?:source|document|guideline|policy)\b|\b(?:never|not|don't|no|without|disable|exclude|avoid|omit|forbid)\b[^.!?;]*\bsupplements?\b/i.test(
        request,
      )
    )
      policy = "only_this_source";
    // Only an explicit affirmative instruction clears a retained restriction.
    // A permission question, conditional or negated suggestion never widens it.
    else if (
      /^(?:for this[, :]\s*)?(?:please\s+)?(?:allow|include|enable|use)\s+(?:approved\s+)?supplements?\s*[.!]*$/i.test(
        request.trim(),
      )
    )
      policy = "primary_plus_approved_supplements";
  }
  return policy;
}

/** Apply user facets in order; the context owner has already resolved topic/population resets. */
function effectiveAskedParts(requests: string[]): RagAskedPart[] {
  const retained = new Set<RagAskedPart>();
  for (const request of requests) {
    // Only a facet focus resets parts. "Only this source" is a source restriction.
    const focus = /\bonly\s+(?:(?:discuss|explain|describe|cover|give|address)\s+)?(?:the\s+)?(.+)/i.exec(request)?.[1];
    if (focus && askedPartPatterns.some(([, pattern]) => pattern.exec(focus)?.index === 0)) retained.clear();
    for (const sentence of request.split(/[.;!?]/)) {
      let excluded = false;
      for (const clause of sentence.split(/,|\b(?:and|or|but|plus)\b/i)) {
        const matches = askedPartPatterns
          .flatMap(([part, pattern]) => {
            const match = pattern.exec(clause);
            return match ? [{ part, index: match.index }] : [];
          })
          .sort((left, right) => left.index - right.index);
        for (const match of matches) {
          const prefix = clause.slice(0, match.index);
          // Match the whole bounded command before its determiner. A negative
          // command wins over its embedded affirmative verb ("do not give").
          const command =
            /\b(?:(omit|exclude|skip|without|no|not|don't|do not)(?:\s+(?:include|discuss|cover|explain|elaborate on|describe|give|address))?|(?:include|discuss|cover|explain|elaborate on|describe|give|address))\s+(?:the\s+)?$/i.exec(
              prefix,
            );
          if (command) excluded = Boolean(command[1]);
          if (excluded) retained.delete(match.part);
          else retained.add(match.part);
        }
      }
    }
  }
  return askedPartPatterns.filter(([part]) => retained.has(part)).map(([part]) => part);
}

/** Bind explicit delivery details from unscaffolded user clauses, never retrieval text. */
function requestedFacetDetails(requests: string[], askedParts: RagAskedPart[]) {
  const details: Partial<Record<RagAskedPart, RagRequestedFacetDetail[]>> = {};
  const add = (facet: RagAskedPart, detail: RagRequestedFacetDetail, include = true) => {
    if (!askedParts.includes(facet)) return;
    const next = include
      ? [...new Set([...(details[facet] ?? []), detail])]
      : (details[facet] ?? []).filter((value) => value !== detail);
    if (next.length) details[facet] = next;
    else delete details[facet];
  };
  const omitted = (text: string, detail: string) =>
    new RegExp(
      `\\b(?:omit|exclude|skip|without|no|not|don't|do not)(?:\\s+(?:include|discuss|cover|give|the|monitoring|dosing|dose)){0,3}\\s+${detail}\\b`,
      "i",
    ).test(text);
  for (const request of requests) {
    const explicit = medicationDoseEvidenceQueryIntent(request);
    if (explicit.asksRoute) add("dosing", "route", !omitted(request, "routes?"));
    if (/\bmax(?:imum)?\b/i.test(request)) add("dosing", "maximum", !omitted(request, "max(?:imum)?"));
    for (const sentence of request.split(/[.;!?]/)) {
      const clauses = sentence.split(/,|\b(?:and|but|plus)\b/i);
      const owners = clauses.map((clause) =>
        (["dosing", "monitoring"] as const).filter((facet) =>
          askedPartPatterns.find(([part]) => part === facet)![1].test(clause),
        ),
      );
      for (let index = 0; index < clauses.length; index++) {
        if (!medicationDoseEvidenceQueryIntent(clauses[index]).asksFrequency) continue;
        let bound = owners[index];
        if (bound.length > 1) {
          const detailIndex =
            /\b(?:frequenc\w*|how often|how frequently|once|twice|daily|nightly|weekly|monthly|hourly|prn|bd|tds|qds|qid|every|\d+\s+times?)\b/i.exec(
              clauses[index],
            )?.index;
          if (detailIndex !== undefined) {
            const distances = bound.map((facet) => {
              const anchor = askedPartPatterns.find(([part]) => part === facet)![1].exec(clauses[index])!;
              return {
                facet,
                distance: Math.min(
                  Math.abs(anchor.index - detailIndex),
                  Math.abs(anchor.index + anchor[0].length - detailIndex),
                ),
              };
            });
            const closest = Math.min(...distances.map(({ distance }) => distance));
            bound = distances.filter(({ distance }) => distance === closest).map(({ facet }) => facet);
          }
        }
        if (!bound.length) {
          // A separate "how often?" detail follows the last explicitly named facet.
          bound =
            owners
              .slice(0, index)
              .reverse()
              .find((parts) => parts.length) ?? [];
          if (!bound.length) bound = owners.slice(index + 1).find((parts) => parts.length) ?? [];
          if (!bound.length) bound = (["dosing", "monitoring"] as const).filter((facet) => askedParts.includes(facet));
        }
        for (const facet of bound) add(facet, "frequency", !omitted(clauses[index], "frequenc(?:y|ies)"));
      }
      // Shared grammatical requests attach one frequency to both named activities.
      if (
        !omitted(sentence, "frequenc(?:y|ies)") &&
        /\b(?:how often|how frequently|frequency of)\b/i.test(sentence) &&
        /\b(?:dos(?:e|es|ing|age)\s+and\s+monitoring|monitoring\s+and\s+dos(?:e|es|ing|age))\b/i.test(sentence)
      ) {
        add("dosing", "frequency");
        add("monitoring", "frequency");
      }
    }
  }
  return details;
}

function broadSubquestions(query: string, askedParts: RagAskedPart[]) {
  const asked = askedPartPatterns.filter(([part]) => askedParts.includes(part));
  const parts = asked.map(([part, , purpose], index) => ({
    ...subquestion(index + 2, `${query} Focus on the requested ${part}.`, purpose),
    requestedFacets: [part],
  }));
  // Group the tail within the existing query budget instead of losing asked parts.
  if (parts.length > 3)
    parts.splice(2, parts.length - 2, {
      ...subquestion(
        4,
        `${query} Address the requested ${asked
          .slice(2)
          .map(([part]) => part)
          .join(", ")}.`,
        "primary",
      ),
      requestedFacets: asked.slice(2).map(([part]) => part),
    });
  return [{ ...subquestion(1, query, "primary"), requestedFacets: askedParts }, ...parts];
}

export function detectClinicalAmbiguity(query: string, analysis: ClinicalQueryAnalysis): ClinicalAmbiguity | null {
  return materialAmbiguity(query, analysis);
}

export function buildRagQueryPlan(
  query: string,
  analysis: ClinicalQueryAnalysis,
  originalAdaptiveRequest?: string,
): RagQueryPlan & AdaptiveAnswerRequest {
  // Mode scaffolding remains retrieval input; adaptive user fields use the unmodified request.
  const requestQuery = originalAdaptiveRequest ?? query;
  const resolvedContext = parseAnswerRequestContext(requestQuery);
  const requestedQuery = resolvedContext?.latestRequest ?? requestQuery;
  const effectiveRequests = resolvedContext
    ? [resolvedContext.subject, ...resolvedContext.constraints, resolvedContext.latestRequest]
    : [requestQuery];
  const askedParts = effectiveAskedParts(effectiveRequests);
  const requestedDepth =
    resolvedContext?.depth ??
    (/\b(?:comprehensive|detailed|elaborate|explain|examples?)\b/i.test(requestedQuery)
      ? "detailed"
      : /\b(?:brief|briefly|concise|short)\b/i.test(requestedQuery)
        ? "concise"
        : "standard");
  const safetyQuery = effectiveRequests.join(" ").replace(/\b(?:without|no)\s+renal impairment\b/gi, "");
  const materialSafetyDependencies: RagSubquestionPurpose[] =
    analysis.medications.length > 0 &&
    /\b(?:dosing|prescrib(?:e|ing)|start|initiat(?:e|ion)|treat(?:ment)?|manag(?:e|ed|ement))\b/i.test(requestQuery) &&
    /\b(?:renal impairment|hepatic impairment|pregnan\w*|overdose|toxicity)\b/i.test(safetyQuery)
      ? ["risk"]
      : [];
  const requestContract = {
    askedParts,
    requestedDepth,
    materialSafetyDependencies,
    sourcePolicy: resolveAnswerSourcePolicy(requestQuery),
  } as const;
  const ambiguity = materialAmbiguity(query, analysis);
  const explicitDomains = [
    ...siteDomainSignals.filter(([, pattern]) => pattern.test(query)).map(([domain]) => domain),
    ...(administrativeFormSignal.test(query) ? (["forms"] as const) : []),
  ];
  const inferredDomains: SiteContentDomain[] =
    explicitDomains.length > 0
      ? []
      : analysis.medications.length > 0
        ? ["medications"]
        : isSimpleDefinitionQuery(query, analysis)
          ? ["dictionary"]
          : /\b(?:differential|diagnos(?:is|es|tic))\b/i.test(query)
            ? ["differentials"]
            : [];
  const targetSiteDomains = explicitDomains.length > 0 ? explicitDomains : inferredDomains;
  const siteDomainDecision = explicitDomains.length > 0 ? "explicit" : inferredDomains.length > 0 ? "inferred" : "none";
  const reasonCodes = unique([...analysis.reasons, ...dimensionReasons(query, analysis)]);
  if (ambiguity) {
    return {
      ...requestContract,
      version: ragQueryPlanVersion,
      kind: "clarification_required",
      originalQuery: query,
      interpretation: `Material retrieval ambiguity requires one clarification: ${ambiguity.dimensions.join(", ")}.`,
      subquestions: [],
      targetSiteDomains: [],
      siteDomainDecision: "none",
      reasonCodes: [...reasonCodes, "material_retrieval_ambiguity"],
    };
  }

  const sides = comparisonSides(query, analysis);
  const broad =
    !protectsBroadDecomposition(query, analysis) &&
    (analysis.queryClass === "broad_summary" ||
      analysis.intent === "broad_summary" ||
      /\b(?:managed?|management|including treatment|monitoring and escalation|comprehensive|overview)\b/i.test(query));
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
  } else if (
    broad ||
    (resolvedContext ? askedParts.join(" and ") : requestedQuery)
      .split(/[,;\n]|\s+(?:and|plus|including|as well as)\s+/i)
      .filter((part) => askedPartPatterns.some(([kind, pattern]) => kind !== "comparison" && pattern.test(part)))
      .length > 1
  ) {
    kind = "decomposed";
    subquestions = broadSubquestions(query, askedParts);
    reasonCodes.push("broad_management_decomposition");
  } else if (analysis.comparisonIntent) {
    reasonCodes.push("comparison_sides_unresolved_single_plan");
  }

  for (const dependency of materialSafetyDependencies) {
    if (subquestions.some((part) => part.purpose === dependency)) continue;
    const question = `${query} Address the safety implications of the stated clinical constraint before recommending an action.`;
    if (subquestions.length < 4) subquestions.push(subquestion(subquestions.length + 1, question, dependency));
    else
      subquestions[3] = {
        ...subquestions[3],
        question: subquestions[3].question + " " + question,
        purpose: dependency,
      };
    kind = "decomposed";
  }
  const deliveryDetails = requestedFacetDetails(effectiveRequests, askedParts);
  subquestions = subquestions.map((part) => {
    const bound = Object.fromEntries(
      (part.requestedFacets ?? []).flatMap((facet) =>
        deliveryDetails[facet] ? [[facet, deliveryDetails[facet]]] : [],
      ),
    );
    return Object.keys(bound).length ? { ...part, requestedFacetDetails: bound } : part;
  });
  const interpretationDimensions = reasonCodes.filter((reason) =>
    /document|medicine|population|jurisdiction|setting|acronym|typo|comparison|broad/i.test(reason),
  );
  return {
    ...requestContract,
    version: ragQueryPlanVersion,
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
