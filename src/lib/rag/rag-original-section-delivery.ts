import { adaptiveAnswerLimits, legacyAnswerLimits, answerWithinLimits } from "@/lib/rag/rag-answer-contract-limits";
import {
  checkedOriginalSectionAuthorityUnitForResult as checkedOriginalSectionUnitForResult,
  type CheckedOriginalSectionAuthority as CheckedOriginalSectionLayout,
} from "@/lib/rag/rag-source-block";
import { ragAdaptiveAnswerPromptVersion, type RagAnswerGenerationContract } from "@/lib/rag/rag-versioning";
import { citationFromResult as resultCitation } from "@/lib/citations";
import type { RagAnswer, SearchResult } from "@/lib/types";
import { sourceDirectlySupportsAnswerText } from "@/lib/rag/rag-claim-support";

export type OriginalSectionFinalizationContext = {
  checkedOriginalSectionLayout?: CheckedOriginalSectionLayout;
  contract?: RagAnswerGenerationContract;
  /** Internal candidate phase only; final completeness uses the actual delivered contract version. */
  originalSectionDeliveryPending?: boolean;
  originalSectionDeliverySectionCap?: number;
};

type OriginalClinicalField = Readonly<{ text: string; ids: readonly string[]; heading?: string; kind?: string | null }>;
type VerifiedOriginalSectionSentence = Readonly<{
  sourceId: string;
  role: "adult_limits" | "young_abstention" | "other";
  renderedText: string;
  pregnancyPurposeAdded: boolean;
}>;
type OriginalSectionCandidateProof = Readonly<{
  phase: "original" | "constructed";
  layout: CheckedOriginalSectionLayout;
  fields: readonly OriginalClinicalField[];
  observedFields: readonly OriginalClinicalField[];
  sourceIdentity: string;
  verifiedFields: readonly (readonly VerifiedOriginalSectionSentence[])[];
}>;
const originalSectionCandidateProofs = new WeakMap<RagAnswer, OriginalSectionCandidateProof>();
const usesAdaptiveSectionDelivery = (context: OriginalSectionFinalizationContext, answer?: RagAnswer) =>
  context.contract?.promptVersion === ragAdaptiveAnswerPromptVersion &&
  (context.originalSectionDeliveryPending ||
    answer === undefined ||
    (answer.answerContractVersion === ragAdaptiveAnswerPromptVersion && answer.renderAdaptiveAnswer === true));

function candidateClinicalFields(answer: RagAnswer): OriginalClinicalField[] {
  return [
    {
      text: answer.answer,
      ids: answer.citations
        .filter((citation) => citation.provenance !== "review_only")
        .map((citation) => citation.chunk_id),
    },
    ...(answer.answerSections ?? []).map((section) => ({
      text: section.body,
      ids: section.citation_chunk_ids,
      heading: section.heading,
      kind: section.kind ?? null,
    })),
  ];
}
function sameCandidateFields(original: readonly OriginalClinicalField[], current: readonly OriginalClinicalField[]) {
  return (
    original.length === current.length &&
    original.every(
      (field, index) =>
        sameSectionProse(field.text) === sameSectionProse(current[index].text) &&
        sameSectionProse(field.heading ?? "") === sameSectionProse(current[index].heading ?? "") &&
        field.kind === current[index].kind &&
        field.ids.every((id) => current[index].ids.includes(id)),
    )
  );
}
function originalCandidateSourceIdentity(sources: SearchResult[]) {
  return JSON.stringify(
    sources.map((source) => [
      source.id,
      source.document_id,
      source.content,
      source.section_heading,
      source.section_path ?? [],
      source.parent_heading ?? null,
      source.anchor_id ?? null,
      source.source_metadata,
    ]),
  );
}
function frozenClinicalFields(fields: readonly OriginalClinicalField[]) {
  return Object.freeze(fields.map((field) => Object.freeze({ ...field, ids: Object.freeze([...field.ids]) })));
}

/** Metadata/bold copies may carry an issued request-local proof; changed clinical content never does. */
export function carryOriginalSectionCandidateProof(from: RagAnswer, to: RagAnswer): RagAnswer {
  const proof = originalSectionCandidateProofs.get(from);
  if (
    proof &&
    sameCandidateFields(proof.observedFields, candidateClinicalFields(from)) &&
    sameCandidateFields(candidateClinicalFields(from), candidateClinicalFields(to)) &&
    originalCandidateSourceIdentity(to.sources) === proof.sourceIdentity
  )
    originalSectionCandidateProofs.set(to, proof);
  return to;
}
export function carryFinalizedOriginalSectionProof(
  from: RagAnswer,
  to: RagAnswer,
  sourceConstructionCompleted = false,
): RagAnswer {
  const proof = originalSectionCandidateProofs.get(from);
  if (
    proof &&
    sameCandidateFields(proof.observedFields, candidateClinicalFields(from)) &&
    originalCandidateSourceIdentity(to.sources) === proof.sourceIdentity
  )
    originalSectionCandidateProofs.set(
      to,
      Object.freeze({
        ...proof,
        phase: sourceConstructionCompleted ? "constructed" : proof.phase,
        observedFields: frozenClinicalFields(candidateClinicalFields(to)),
      }),
    );
  return to;
}

/** Restore a source's presentation glyph only on its complete surviving statement, before ordinary claim enforcement. */
export function restoreCheckedOriginalSectionBulletPresentation(
  answer: RagAnswer,
  provedConstruction: RagAnswer,
  context: OriginalSectionFinalizationContext,
): RagAnswer {
  const proof = originalSectionCandidateProofs.get(provedConstruction);
  if (
    !proof ||
    proof.layout !== context.checkedOriginalSectionLayout ||
    !answer.grounded ||
    answer.confidence === "unsupported" ||
    !sameCandidateFields(proof.observedFields, candidateClinicalFields(provedConstruction)) ||
    originalCandidateSourceIdentity(answer.sources) !== proof.sourceIdentity ||
    originalCandidateSourceIdentity(provedConstruction.sources) !== proof.sourceIdentity
  )
    return answer;
  const { adult, exclusions } = reviewedOriginalSectionConstruction(provedConstruction, context);
  const bullet = exclusions?.match(/^([•▪◦])\s+/)?.[1];
  if (
    !adult ||
    !exclusions ||
    !bullet ||
    !sourceDirectlySupportsAnswerText(exclusions, adult) ||
    !answer.citations.some((citation) => citation.chunk_id === adult.id && citation.provenance !== "review_only")
  )
    return answer;
  const expected = sameSectionProse(exclusions.replace(/^[•▪◦]\s+/, ""));
  const restorePresentStatement = (text: string) =>
    text
      .split(/((?<=[.!?])\s+)/)
      .map((part) => {
        // The ordinary quality normalizer changes the inline bullet to a semicolon. Only that glyph may be undone;
        // every clinical word, number, polarity and publisher cross-reference must already remain in this same statement.
        const present = part.replace(/^\s*;\s*/, "").trim();
        return sameSectionProse(present) === expected ? `${bullet} ${present}` : part;
      })
      .join("");
  return {
    ...answer,
    answer: restorePresentStatement(answer.answer),
    answerSections: answer.answerSections?.map((section) =>
      section.citation_chunk_ids.includes(adult.id)
        ? { ...section, body: restorePresentStatement(section.body) }
        : section,
    ),
  };
}

/** Called by the private parser before destructive field/citation sanitization. No model field can issue this proof. */
export function prepareOriginalSectionCandidateProof(
  rawCandidate: unknown,
  sources: SearchResult[],
  query: string | undefined,
  context: OriginalSectionFinalizationContext,
): (answer: RagAnswer) => RagAnswer {
  const unchanged = (answer: RagAnswer) => answer;
  const layout = context.checkedOriginalSectionLayout;
  if (!layout || !query || !originalSectionQuestionApplies(query) || !rawCandidate || typeof rawCandidate !== "object")
    return unchanged;
  const raw = rawCandidate as Record<string, unknown>;
  const ids = (value: unknown): string[] | null =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every(
      (id) =>
        typeof id === "string" &&
        sources.some((source) => source.id === id && checkedOriginalSectionUnitForResult(source, layout)),
    )
      ? (value as string[])
      : null;
  const topIds = ids(
    Array.isArray(raw.citations)
      ? raw.citations.map((citation) =>
          citation && typeof citation === "object" ? Reflect.get(citation, "chunk_id") : null,
        )
      : null,
  );
  if (!topIds || typeof raw.answer !== "string" || !Array.isArray(raw.answerSections) || raw.answerSections.length > 8)
    return unchanged;
  const fields: OriginalClinicalField[] = [{ text: raw.answer, ids: topIds }];
  for (const section of raw.answerSections) {
    if (!section || typeof section !== "object") return unchanged;
    const heading = Reflect.get(section, "heading");
    // A clinical assertion hidden in a heading is also original model content, not a harmless label.
    if (
      typeof heading !== "string" ||
      !/^(?:Risk qualifications?|Key recommendations?|Recommendations?|Contraindications(?: and cautions)?|Cautions|Adults|Healthy adults|Pregnancy(?: and breastfeeding)?|Breastfeeding|Additional source qualifications)$/i.test(
        heading.trim(),
      )
    )
      return unchanged;
    const body = Reflect.get(section, "body"),
      citations = ids(Reflect.get(section, "citation_chunk_ids"));
    if (typeof body !== "string" || !body.trim() || !citations) return unchanged;
    const kind = Reflect.get(section, "kind");
    if (
      kind !== undefined &&
      (typeof kind !== "string" || /^(?:source_gap|source_conflict|visual_evidence|quotes|verification)$/.test(kind))
    )
      return unchanged;
    fields.push({ text: body, ids: citations, heading, kind: kind === undefined ? null : (kind as string) });
  }
  if (fields.reduce((total, field) => total + field.text.length, 0) > 131_072) return unchanged;
  const sourceAnswer = { sources } as RagAnswer;
  const construction = reviewedOriginalSectionConstruction(sourceAnswer, context);
  if (!construction.coherentAdult || !construction.increasedRisk) return unchanged;
  const verifiedFields: (readonly VerifiedOriginalSectionSentence[])[] = [];
  for (const field of fields) {
    const headingOwner = /^(?:Adults|Healthy adults)$/i.test(field.heading ?? "")
      ? construction.adult
      : /^(?:Pregnancy(?: and breastfeeding)?|Breastfeeding)$/i.test(field.heading ?? "")
        ? construction.maternal
        : undefined;
    const populationHeading = /^(?:Adults|Healthy adults|Pregnancy(?: and breastfeeding)?|Breastfeeding)$/i.test(
      field.heading ?? "",
    );
    if (populationHeading && (!headingOwner || !field.ids.includes(headingOwner.id))) return unchanged;
    if (/^Pregnancy$/i.test(field.heading ?? "") && /\bbreastfeed/i.test(field.text)) return unchanged;
    if (/^Breastfeeding$/i.test(field.heading ?? "") && /\bpregnan|\bunborn|\bfet(?:us|al)/i.test(field.text))
      return unchanged;
    const scopedIds = headingOwner ? [headingOwner.id] : field.ids;
    if (!field.text.trim()) return unchanged;
    const sentences = sectionProse(field.text)
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => originalSectionSentenceSupported(sentence, scopedIds, construction));
    if (sentences.some((sentence) => sentence === null)) return unchanged;
    verifiedFields.push(Object.freeze(sentences.map((sentence) => Object.freeze(sentence!))));
  }
  const frozenFields = frozenClinicalFields(fields);
  const proof: OriginalSectionCandidateProof = Object.freeze({
    phase: "original",
    layout,
    fields: frozenFields,
    observedFields: frozenFields,
    sourceIdentity: originalCandidateSourceIdentity(sources),
    verifiedFields: Object.freeze(verifiedFields),
  });
  return (answer) => {
    if (originalCandidateSourceIdentity(answer.sources) !== proof.sourceIdentity) return answer;
    let candidate = answer;
    const current = candidateClinicalFields(answer);
    if (!sameCandidateFields(proof.fields, current) && current.length === proof.fields.length) {
      // Undo only observed delimiter deletions inside already verified original propositions.
      // Every other clinical character, citation, section heading and kind must still match.
      const originalSeparator = "any one day; less drinking further lowers risk.";
      const deletedSeparator = "any one day less drinking further lowers risk.";
      const restored = current.map((field, index) => {
        const original = proof.fields[index];
        if (
          original.heading !== field.heading ||
          original.kind !== field.kind ||
          original.ids.length !== field.ids.length ||
          original.ids.some((id, idIndex) => id !== field.ids[idIndex])
        )
          return null;
        const originalText = sectionProse(original.text),
          currentText = sectionProse(field.text);
        if (originalText === currentText) return field.text;
        const recordedRiskSeparator =
          "The adult limits are not a safe or no-risk level; not drinking is the best way to reduce alcohol-related harm.";
        if (
          proof.verifiedFields[index].some((sentence) => sentence.role === "other") &&
          originalText.startsWith(recordedRiskSeparator) &&
          originalText.replace(recordedRiskSeparator, recordedRiskSeparator.replace("; ", " ")) === currentText
        )
          return original.text;
        const recordedAdultSeparator = "any one day; drinking less further reduces risk.";
        if (
          proof.verifiedFields[index].some((sentence) => sentence.role === "adult_limits") &&
          originalText.split(recordedAdultSeparator).length === 2 &&
          originalText.replace(recordedAdultSeparator, recordedAdultSeparator.replace("; ", " ")) === currentText
        )
          return original.text;
        if (
          !proof.verifiedFields[index].some((sentence) => sentence.role === "adult_limits") ||
          originalText.split(originalSeparator).length !== 2 ||
          field.text.split(deletedSeparator).length !== 2 ||
          originalText.replace(originalSeparator, deletedSeparator) !== currentText
        )
          return null;
        return field.text.replace(deletedSeparator, originalSeparator);
      });
      if (restored.every((text): text is string => text !== null)) {
        candidate = {
          ...answer,
          answer: restored[0],
          answerSections: answer.answerSections?.map((section, index) => ({ ...section, body: restored[index + 1] })),
        };
      }
    }
    if (
      sameCandidateFields(proof.fields, candidateClinicalFields(candidate)) &&
      originalCandidateSourceIdentity(candidate.sources) === proof.sourceIdentity
    )
      originalSectionCandidateProofs.set(candidate, proof);
    return candidate;
  };
}

type SectionDeliveryMember = { source: SearchResult; text: string; matches: (text: string) => boolean };
type SectionDeliveryObligation = { label: string; members: SectionDeliveryMember[] };
const sectionProse = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const sameSectionProse = (text: string) => sectionProse(text).replace(/[‘’]/g, "'").toLowerCase();

function originalSectionQuestionApplies(query: string) {
  return (
    /\balcohol\b/i.test(query) &&
    /\bhealthy adults\b/i.test(query) &&
    /\bunder\s+18\b/i.test(query) &&
    /pregnan/i.test(query) &&
    /breastfeed/i.test(query)
  );
}

function boundClinicalSections(answer: RagAnswer, context: OriginalSectionFinalizationContext) {
  const layout = context.checkedOriginalSectionLayout;
  if (!layout) return [];
  return answer.sources.filter((source) => checkedOriginalSectionUnitForResult(source, layout));
}

type OriginalSourceScope = "root" | "key_messages" | "pregnancy" | "breastfeeding";

function boundedSourceSentence(
  source: SearchResult | undefined,
  pattern: RegExp,
  allowedScopes: readonly OriginalSourceScope[] = ["root", "key_messages"],
  requireOrdinarySupport = true,
  preserveSourceBullet = false,
) {
  if (!source) return null;
  const heading = source.section_heading;
  if (!heading || !source.content.startsWith(heading)) return null;
  const remaining = source.content.slice(heading.length).replace(/\r\n?/g, "\n");
  // Governing history/quotation/restriction is not reset by an intervening sentence or a familiar subheading.
  // Ordinary support is not a quotation or subsection interpreter, so unresolved narrative authority refuses this pilot.
  if (
    /\b(?:historical|previous|earlier|formerly|outdated|obsolete|quoted|quote|quotation|hypothetical|statement is false|statement is incorrect|following statement is|not current|only for|only applies|restricted to)\b/i.test(
      remaining,
    )
  )
    return null;
  const scopes: { scope: OriginalSourceScope; raw: string }[] = [];
  const markers = [...remaining.matchAll(/^(Key messages|During pregnancy|When breastfeeding)\s*$/gim)];
  let scope: OriginalSourceScope = "root",
    start = 0;
  for (const marker of markers) {
    scopes.push({ scope, raw: remaining.slice(start, marker.index) });
    scope = /^Key messages$/i.test(marker[1])
      ? "key_messages"
      : /^During pregnancy$/i.test(marker[1])
        ? "pregnancy"
        : "breastfeeding";
    start = marker.index! + marker[0].length;
  }
  scopes.push({ scope, raw: remaining.slice(start) });
  const candidates: string[] = [];
  const exact = new RegExp(`^(?:[AB]\\.\\s*)?(?:[•*]\\s*)?(${pattern.source})$`, "i");
  // These are source-context refusals, not text transformations. Paragraph/bullet boundaries are retained;
  // page markers and intervening sentences do not terminate a governing condition.
  const ambiguous =
    /\b(?:only|unless|except|provided|quoted|quotation|hypothetical|historical|previous guidance|earlier guidance|statement is false|statement is incorrect|following statement is|not current|for example)\b|^\s*(?:if|when|whenever|but|while|whereas|condition|restricted|not applicable)\b/i;
  for (const region of scopes) {
    if (!allowedScopes.includes(region.scope)) continue;
    const prose = region.raw.replace(/^\s*\[Original printed page[^\n]*\]\s*$/gm, "");
    // The finite flat pilot has only the named subsections above. Unknown standalone heading-like lines cannot
    // silently lend their following text the broader section scope. Native wrapped prose is kept intact.
    const unresolvedHeading = prose.split("\n").some((line) => {
      const value = line.trim();
      return (
        /^Guideline\s+\d+:/i.test(value) ||
        (/^[A-Z][\p{L}\p{N} '\u2018\u2019\u2013\u2014-]{1,64}:?$/u.test(value) &&
          (/^(?:For |Women who |People who |Adults |Children |Patients |Special |Other |Restricted )/i.test(value) ||
            !/\b(?:is|are|was|were|have|has|does|do|should|can|may|will|would|must|drink|drinks|drinking|reduce|prevent|include|includes|identifies)\b/i.test(
              value,
            )))
      );
    });
    if (unresolvedHeading || /\b(?:only|unless|except|provided)\b/i.test(prose)) continue;
    const paragraphs = prose.split(/\n\s*\n|(?=^[ \t]*[•*])/m).filter((paragraph) => paragraph.trim());
    if (
      paragraphs.some((paragraph) =>
        /^\s*(?:if|when|whenever|but|while|whereas|condition|restricted|not applicable)\b/i.test(
          sectionProse(paragraph.replace(/^[ \t]*[•*]\s*/gm, "")),
        ),
      )
    )
      continue;
    for (const paragraph of paragraphs) {
      const sourceBullet = preserveSourceBullet ? paragraph.match(/^\s*([•▪◦])\s*/)?.[1] : undefined;
      const sentences = sectionProse(paragraph.replace(/^[ \t]*[•*]\s*/gm, ""))
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !/^[AB]\.$/.test(sentence));
      sentences.forEach((sentence, index) => {
        const match = sentence.match(exact);
        if (!match || sentences.some((context, contextIndex) => contextIndex !== index && ambiguous.test(context)))
          return;
        candidates.push(`${sourceBullet ? `${sourceBullet} ` : ""}${match[1]}`);
      });
    }
  }
  if (candidates.length !== 1) return null;
  const text = candidates[0];
  // Preserve the intact selected section, including all surrounding restrictions, as proof.
  const actualSection = {
    ...source,
    adjacent_context: null,
    retrieval_synopsis: null,
    table_facts: [],
    memory_cards: [],
    index_unit: null,
  };
  return !requireOrdinarySupport || sourceDirectlySupportsAnswerText(text, actualSection) ? text : null;
}

/** Reviewed flat alcohol-summary construction. Values and wording are always extracted from actual served sections. */
function reviewedOriginalSectionConstruction(answer: RagAnswer, context: OriginalSectionFinalizationContext) {
  const sections = boundClinicalSections(answer, context);
  const one = (pattern: RegExp) => {
    const matching = sections.filter((source) => pattern.test(sectionProse(source.section_heading ?? "")));
    return matching.length === 1 ? matching[0] : undefined;
  };
  const adult = one(/^Guideline\s+\d+: Adults$/i);
  const young = one(/^Guideline\s+\d+: Children and people under\s+\d+\s+years of age$/i);
  const maternal = one(/^Guideline\s+\d+: Women who are pregnant or breastfeeding$/i);
  const recommendation = boundedSourceSentence(
    adult,
    /To reduce the risk of harm from alcohol-related disease or injury, healthy men and women should drink no more than \d+ standard drinks a week and no more than \d+ standard drinks on any one day\./,
  );
  const eligibility = boundedSourceSentence(
    adult,
    /This guideline applies to healthy men and women aged \d+ years and over\./,
  );
  const lowerRisk = boundedSourceSentence(adult, /The less you drink, the lower your risk of harm from alcohol\./);
  const bestAbstention = boundedSourceSentence(
    adult,
    /Not drinking at all is the best way to reduce the risk of harm from alcohol\./,
    ["key_messages"],
  );
  const noRisk = boundedSourceSentence(
    adult,
    /The guideline does not represent a ['‘]safe['’] or ['‘]no-risk['’] drinking level, nor does it set an absolute upper limit of intake\./,
  );
  const greaterRisk = boundedSourceSentence(
    adult,
    /This guideline applies to most healthy adults; however, there are some people who are at greater risk of alcohol-related harm\./,
    ["root", "key_messages"],
    false,
  );
  const exclusions = boundedSourceSentence(
    adult,
    /This guideline does not apply to children and young people under the age of \d+ years \(who are covered in Guideline\s+\d+\), or to women who are planning a pregnancy, or are pregnant or breastfeeding \(who are covered in Guideline\s+\d+\)\./,
    ["root", "key_messages"],
    true,
    true,
  );
  const youngRecommendation = boundedSourceSentence(
    young,
    /To reduce the risk of injury and other harms to health, children and people under \d+ years of age should not drink alcohol\./,
    ["root"],
    false,
  );
  // Validate the complete original purpose/scope sentence above before deriving the clinically reviewed direct rendering.
  // The derived clause independently faces ordinary support against the intact actual selected section.
  const youngDirectClause =
    youngRecommendation?.match(/children and people under \d+ years of age should not drink alcohol\./)?.[0] ?? null;
  const coherentYoungAge =
    young &&
    youngRecommendation &&
    sectionProse(young.section_heading ?? "").match(/under (\d+) years of age/)?.[1] ===
      youngRecommendation.match(/under (\d+) years of age/)?.[1];
  const youngDirectRecommendation =
    young && coherentYoungAge && youngDirectClause && sourceDirectlySupportsAnswerText(youngDirectClause, young)
      ? youngDirectClause[0].toUpperCase() + youngDirectClause.slice(1)
      : null;
  const youngNoSafe = boundedSourceSentence(
    young,
    /There is no clear ['‘]safe['’] level of alcohol consumption for children and people under \d+ years of age\./,
  );
  const pregnancy = boundedSourceSentence(
    maternal,
    /To prevent harm from alcohol to their unborn child, women who are pregnant or planning a pregnancy should not drink alcohol\./,
    ["root"],
  );
  const breastfeeding = boundedSourceSentence(
    maternal,
    /For women who are breastfeeding, not drinking alcohol is safest for their baby\./,
    ["root"],
  );
  const sharedSafe = boundedSourceSentence(
    maternal,
    /The evidence does not indicate a safe amount of alcohol that pregnant women and breastfeeding mothers can drink\./,
    ["key_messages"],
  );
  const pregnancyNoSafe = boundedSourceSentence(
    maternal,
    /No safe level of alcohol consumption during pregnancy has been identified\./,
    ["pregnancy"],
  );
  // The reviewed semicolon source qualification remains intact above. Its ordinary right-hand assertion is rendered separately,
  // dependent on the independently supported healthy age scope and exclusions; the Phase A applicability matcher stays unchanged.
  const increasedRisk =
    greaterRisk?.match(/there are some people who are at greater risk of alcohol-related harm\./i)?.[0] ?? null;
  const supportedIncreasedRisk =
    adult && increasedRisk && sourceDirectlySupportsAnswerText(increasedRisk, adult)
      ? increasedRisk[0].toUpperCase() + increasedRisk.slice(1)
      : null;
  // Keep the exact exclusion sentence: unchanged Phase A applicability support requires complete passage identity.
  // The clinically reviewed optional upper-limit omission still faces ordinary support against the intact source.
  const conciseNoRisk = noRisk?.replace(/, nor does it set an absolute upper limit of intake\.$/, ".") ?? null;
  // A heading cannot resolve a nearer condition, quotation, exception or competing population.
  const adultPrefix = adult ? sectionProse(adult.content).slice(sectionProse(adult.section_heading ?? "").length) : "";
  const coherentAdult = Boolean(
    recommendation && eligibility && greaterRisk && adultPrefix.trimStart().startsWith(recommendation),
  );
  return {
    adult,
    young,
    maternal,
    recommendation,
    eligibility,
    lowerRisk,
    bestAbstention,
    noRisk,
    conciseNoRisk:
      adult && conciseNoRisk && sourceDirectlySupportsAnswerText(conciseNoRisk, adult) ? conciseNoRisk : null,
    greaterRisk,
    increasedRisk: supportedIncreasedRisk,
    exclusions,
    youngRecommendation,
    youngDirectRecommendation,
    youngNoSafe,
    pregnancy,
    breastfeeding,
    sharedSafe,
    pregnancyNoSafe,
    coherentAdult,
  };
}

/** Explicit reviewed originals only: every word-bearing fact, polarity, period and beneficiary remains bound to its owning source. */
function legacyOriginalSectionSentenceSupported(
  sentence: string,
  ids: readonly string[],
  source: ReturnType<typeof reviewedOriginalSectionConstruction>,
): boolean {
  const text = sameSectionProse(sentence);
  const exact = (row: SearchResult | undefined, value: string | null) =>
    Boolean(
      row &&
      value &&
      ids.includes(row.id) &&
      text.replace(/^[•▪◦]\s*/, "") === sameSectionProse(value).replace(/^[•▪◦]\s*/, ""),
    );
  if (
    [
      [source.adult, source.recommendation],
      [source.adult, source.eligibility],
      [source.adult, source.lowerRisk],
      [source.adult, source.noRisk],
      [source.adult, source.conciseNoRisk],
      [source.adult, source.increasedRisk],
      [source.adult, source.exclusions],
      [source.young, source.youngRecommendation],
      [source.young, source.youngDirectRecommendation],
      [source.young, source.youngNoSafe],
      [source.maternal, source.pregnancy],
      [source.maternal, source.breastfeeding],
      [source.maternal, source.sharedSafe],
      [source.maternal, source.pregnancyNoSafe],
    ].some(([row, value]) => exact(row as SearchResult | undefined, value as string | null))
  )
    return true;
  const adultAge = source.eligibility?.match(/aged (\d+) years and over/),
    limits = source.recommendation?.match(
      /no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day/,
    );
  const original = text.match(
    /^for healthy adults aged (\d+) years and over, drink no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day(?:; less is lower risk, and these limits are not risk-free)?\.$/,
  );
  if (
    original &&
    source.adult &&
    ids.includes(source.adult.id) &&
    adultAge &&
    limits &&
    source.lowerRisk &&
    source.noRisk &&
    original[1] === adultAge[1] &&
    original[2] === limits[1] &&
    original[3] === limits[2]
  )
    return true;
  const youngAge = source.youngRecommendation?.match(/under (\d+) years of age/);
  if (source.young && ids.includes(source.young.id) && youngAge) {
    if (text === `children and people under ${youngAge[1]} years should not drink alcohol.`) return true;
    if (
      source.youngNoSafe &&
      text === `for people under ${youngAge[1]} years, there is no clear safe level of consumption.`
    )
      return true;
  }
  if (source.maternal && ids.includes(source.maternal.id)) {
    const abstention = "women who are pregnant or planning pregnancy should not drink alcohol";
    const baby = "for breastfeeding women, not drinking is safest for the baby";
    if (source.pregnancy && text === `${abstention}.`) return true;
    if (source.breastfeeding && text === `${baby}.`) return true;
    if (source.pregnancy && source.breastfeeding && text === `${abstention}, and ${baby}.`) return true;
  }
  return false;
}

/** Complete, finite original propositions only. Rendering cannot issue proof for a cropped or corrected claim. */
function originalSectionSentenceSupported(
  sentence: string,
  ids: readonly string[],
  source: ReturnType<typeof reviewedOriginalSectionConstruction>,
): VerifiedOriginalSectionSentence | null {
  const text = sameSectionProse(sentence);
  const bound = (row: SearchResult | undefined) => row && ids.includes(row.id);
  const verified = (
    row: SearchResult,
    renderedText: string,
    role: VerifiedOriginalSectionSentence["role"] = "other",
    pregnancyPurposeAdded = false,
  ): VerifiedOriginalSectionSentence => ({ sourceId: row.id, role, renderedText, pregnancyPurposeAdded });
  const age = source.eligibility?.match(/aged (\d+) years and over/)?.[1];
  const limits = source.recommendation?.match(
    /no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day/,
  );
  const genuineAdult = text.match(
    /^for healthy adults aged (\d+) years and over, the recommendation is no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day; (?:drinking less, or not drinking, further reduces harm|less drinking further lowers risk)\.$/,
  );
  const qualifiedAdult = text.match(
    /^for healthy adults aged (\d+) years and over, drink no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day; less alcohol further reduces harm, and no drinking is best for reducing risk\.$/,
  );
  const sharedLimiterAdult = text.match(
    /^for healthy adults aged (\d+) years and over, drink no more than (\d+) standard drinks a week and (\d+) standard drinks on any one day; drinking less further reduces risk\.$/,
  );
  const legacySupported = legacyOriginalSectionSentenceSupported(sentence, ids, source);
  const legacyAdult = legacySupported && /^for healthy adults aged\b/.test(text);
  const capturedAdult = genuineAdult ?? qualifiedAdult ?? sharedLimiterAdult;
  if (capturedAdult || legacyAdult) {
    if (
      !bound(source.adult) ||
      !source.recommendation ||
      !source.eligibility ||
      !source.lowerRisk ||
      !source.noRisk ||
      !age ||
      !limits ||
      (capturedAdult &&
        (capturedAdult[1] !== age || capturedAdult[2] !== limits[1] || capturedAdult[3] !== limits[2])) ||
      (qualifiedAdult && (!source.coherentAdult || !source.bestAbstention))
    )
      return null;
    const originalRisk = capturedAdult
      ? [source.lowerRisk, qualifiedAdult ? source.bestAbstention : ""].filter(Boolean).join(" ")
      : /; less is lower risk/.test(text)
        ? `${source.lowerRisk} ${source.conciseNoRisk}`
        : "";
    return verified(
      source.adult!,
      [source.recommendation, source.eligibility, originalRisk].filter(Boolean).join(" "),
      "adult_limits",
    );
  }
  const youngAge = source.youngRecommendation?.match(/under (\d+) years of age/)?.[1];
  if (
    bound(source.young) &&
    source.youngDirectRecommendation &&
    youngAge &&
    (text === `people under ${youngAge} years should not drink alcohol.` ||
      (legacySupported &&
        (text === sameSectionProse(source.youngRecommendation ?? "") ||
          /^(?:children and people) under \d+ years(?: of age)? should not drink alcohol\.$/.test(text))))
  ) {
    return verified(source.young!, source.youngDirectRecommendation, "young_abstention");
  }
  const abstention = "women who are pregnant or planning pregnancy should not drink alcohol";
  const baby = "for breastfeeding women, not drinking is safest for the baby";
  const maternalCompound = `${abstention}, and ${baby}; no safe amount has been identified in pregnancy or breastfeeding.`;
  const recordedMaternal = `${abstention}, and for breastfeeding women, not drinking alcohol is safest for the baby.`;
  if (bound(source.maternal) && source.pregnancy && source.breastfeeding && text === recordedMaternal) {
    return verified(source.maternal!, `${source.pregnancy} ${source.breastfeeding}`, "other", true);
  }
  if (
    bound(source.maternal) &&
    source.pregnancy &&
    source.breastfeeding &&
    source.sharedSafe &&
    text === maternalCompound
  ) {
    return verified(
      source.maternal!,
      `${source.pregnancy} ${source.breastfeeding} ${source.sharedSafe}`,
      "other",
      true,
    );
  }
  if (
    bound(source.maternal) &&
    legacySupported &&
    source.pregnancy &&
    (text === `${abstention}.` || (source.breastfeeding && text === `${abstention}, and ${baby}.`))
  ) {
    return verified(
      source.maternal!,
      `${source.pregnancy}${text.includes(baby) ? ` ${source.breastfeeding}` : ""}`,
      "other",
      true,
    );
  }
  if (bound(source.adult) && source.conciseNoRisk && text === "the adult limits are not a safe or no-risk level.") {
    return verified(source.adult!, source.conciseNoRisk);
  }
  if (
    bound(source.adult) &&
    source.conciseNoRisk &&
    source.bestAbstention &&
    text ===
      "the adult limits are not a safe or no-risk level; not drinking is the best way to reduce alcohol-related harm."
  ) {
    return verified(source.adult!, `${source.conciseNoRisk} ${source.bestAbstention}`);
  }
  if (
    bound(source.maternal) &&
    source.sharedSafe &&
    source.pregnancyNoSafe &&
    (text === "no safe amount has been identified in pregnancy or for breastfeeding mothers." ||
      text === "no safe amount has been identified during pregnancy or for breastfeeding mothers.")
  ) {
    return verified(source.maternal!, source.sharedSafe);
  }
  if (
    bound(source.adult) &&
    source.lowerRisk &&
    source.conciseNoRisk &&
    text === "the adult limits reduce risk but do not eliminate it and are not a safe or no-risk drinking level."
  ) {
    return verified(source.adult!, `${source.lowerRisk} ${source.conciseNoRisk}`);
  }
  if (
    bound(source.maternal) &&
    source.sharedSafe &&
    text === "for pregnancy and breastfeeding, the evidence does not indicate a safe amount of alcohol."
  ) {
    return verified(source.maternal!, source.sharedSafe);
  }
  if (!legacySupported) return null;
  const exactOwner = [source.adult, source.young, source.maternal].find(
    (row) => row && ids.includes(row.id) && legacyOriginalSectionSentenceSupported(sentence, [row.id], source),
  );
  const exclusionPresentation =
    source.exclusions && text.replace(/^[•▪◦]\s*/, "") === sameSectionProse(source.exclusions).replace(/^[•▪◦]\s*/, "")
      ? source.exclusions
      : sentence;
  return exactOwner ? verified(exactOwner, exclusionPresentation) : null;
}

function sectionDeliveryObligations(
  answer: RagAnswer,
  context: OriginalSectionFinalizationContext,
): SectionDeliveryObligation[] {
  const construction = reviewedOriginalSectionConstruction(answer, context);
  const member = (
    source: SearchResult | undefined,
    text: string | null,
    matches?: (text: string) => boolean,
  ): SectionDeliveryMember[] =>
    source && text
      ? [
          {
            source,
            text,
            matches: matches ?? ((delivered) => sameSectionProse(delivered).includes(sameSectionProse(text))),
          },
        ]
      : [];
  const a = construction;
  const adultValues = a.recommendation?.match(
    /no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day/,
  );
  const adultAge = a.eligibility?.match(/aged (\d+) years and over/);
  const youngAge = a.youngRecommendation?.match(/under (\d+) years of age/);
  const all = (parts: SectionDeliveryMember[][]) => (parts.every((part) => part.length) ? parts.flat() : []);
  return [
    {
      label: "adult limits and explicit healthy age scope",
      members: a.coherentAdult
        ? all([
            member(a.adult, a.recommendation, (text) =>
              Boolean(
                adultValues &&
                new RegExp(
                  `healthy (?:men and women|adults).*no more than ${adultValues[1]} standard drinks a week and no more than ${adultValues[2]} standard drinks on any one day`,
                  "i",
                ).test(sectionProse(text)),
              ),
            ),
            member(a.adult, a.eligibility, (text) =>
              Boolean(
                adultAge &&
                new RegExp(`healthy (?:men and women|adults) aged ${adultAge[1]} years and over`, "i").test(
                  sectionProse(text),
                ),
              ),
            ),
          ])
        : [],
    },
    {
      label: "lower risk and absence of a safe or no-risk allowance",
      members: all([
        member(a.adult, a.lowerRisk, (text) =>
          /(?:less you drink, the lower your risk|less is lower risk)/i.test(sectionProse(text)),
        ),
        member(a.adult, a.conciseNoRisk, (text) =>
          /(?:does not represent a ['‘]safe['’] or ['‘]no-risk['’] drinking level|limits are not risk-free)/i.test(
            sectionProse(text),
          ),
        ),
      ]),
    },
    {
      label: "adult exclusions and increased-risk qualification",
      members: all([member(a.adult, a.increasedRisk), member(a.adult, a.exclusions)]),
    },
    {
      label: "under-age abstinence and no clear safe level",
      members: all([
        member(a.young, a.youngDirectRecommendation, (text) =>
          Boolean(
            youngAge &&
            new RegExp(
              `(?:children and people|people) under ${youngAge[1]} years(?: of age)? should not drink alcohol`,
              "i",
            ).test(sectionProse(text)),
          ),
        ),
        member(a.young, a.youngNoSafe, (text) =>
          Boolean(
            youngAge &&
            new RegExp(
              `(?:no clear ['‘]?safe['’]? level.*(?:children and people|people) under ${youngAge[1]} years|(?:children and people|people) under ${youngAge[1]} years.*no clear ['‘]?safe['’]? level)`,
              "i",
            ).test(sectionProse(text)),
          ),
        ),
      ]),
    },
    {
      label: "pregnancy and planning pregnancy abstinence to prevent fetal harm",
      members: member(a.maternal, a.pregnancy),
    },
    {
      label: "breastfeeding abstinence as safest for the baby",
      members: member(a.maternal, a.breastfeeding, (text) =>
        /(?:for (?:women who are breastfeeding|breastfeeding women), not drinking(?: alcohol)? is safest for (?:their|the) baby)/i.test(
          sectionProse(text),
        ),
      ),
    },
    { label: "no established safe amount for pregnancy and breastfeeding", members: member(a.maternal, a.sharedSafe) },
  ];
}

function sectionMemberDelivered(
  answer: RagAnswer,
  member: SectionDeliveryMember,
  context: OriginalSectionFinalizationContext,
) {
  const fields = [
    { text: answer.answer, ids: answer.citations.map((citation) => citation.chunk_id) },
    ...(usesAdaptiveSectionDelivery(context, answer) ? (answer.answerSections ?? []) : [])
      .filter((section) => section.kind !== "source_gap" && section.kind !== "source_conflict")
      .map((section) => ({ text: section.body, ids: section.citation_chunk_ids })),
  ];
  return fields.some(
    (field) =>
      field.ids.includes(member.source.id) &&
      field.text
        .split(/(?<=[.!?])\s+/)
        .some((sentence) => member.matches(sentence) && sourceDirectlySupportsAnswerText(sentence, member.source)),
  );
}

export function recoverCheckedOriginalSectionRecommendation(
  answer: RagAnswer,
  query: string,
  context: OriginalSectionFinalizationContext,
): RagAnswer {
  if (
    !context.checkedOriginalSectionLayout ||
    !originalSectionQuestionApplies(query) ||
    (!answer.modelUsed && answer.sourceBackedReviewFallback)
  )
    return answer;
  const proof = originalSectionCandidateProofs.get(answer);
  if (
    !proof ||
    proof.phase !== "original" ||
    proof.layout !== context.checkedOriginalSectionLayout ||
    !sameCandidateFields(proof.fields, candidateClinicalFields(answer)) ||
    !sameCandidateFields(proof.observedFields, candidateClinicalFields(answer)) ||
    originalCandidateSourceIdentity(answer.sources) !== proof.sourceIdentity
  )
    return answer;
  const construction = reviewedOriginalSectionConstruction(answer, context);
  const { adult, recommendation, eligibility, lowerRisk, conciseNoRisk } = construction;
  if (
    !adult ||
    !construction.coherentAdult ||
    !recommendation ||
    !eligibility ||
    !lowerRisk ||
    !conciseNoRisk ||
    !answer.citations.some((citation) => citation.chunk_id === adult.id)
  )
    return answer;
  if (proof.verifiedFields[0]?.[0]?.role !== "adult_limits") return answer;
  const pregnancyPurposeAdded = proof.verifiedFields.some((field) =>
    field.some((sentence) => sentence.pregnancyPurposeAdded),
  );
  const renderField = (index: number) =>
    proof.verifiedFields[index]
      .map(
        (sentence) =>
          `${sentence.pregnancyPurposeAdded ? "Additional source qualifications: " : ""}${sentence.renderedText}`,
      )
      .join(" ");
  // Only the immutable complete original propositions can select these source-supported renderings.
  const recovered = {
    ...answer,
    answer: renderField(0),
    answerSections: (answer.answerSections ?? []).map((section, index) => ({
      ...section,
      body: renderField(index + 1),
    })),
    routingReason: [answer.routingReason, "checked_original_section_recovery"].filter(Boolean).join("; "),
  };
  if (context.contract?.promptVersion !== ragAdaptiveAnswerPromptVersion) {
    // Move already-verified original section prose into the ordinary copied lead before any final guard.
    // This is delivery preservation of the model's original content, distinct from the disclosed source supplement below.
    const originalSections = recovered.answerSections.filter(
      (section) => section.kind !== "source_gap" && section.kind !== "source_conflict",
    );
    recovered.answer = [recovered.answer, ...originalSections.map((section) => section.body)].join(" ");
    for (const section of originalSections)
      for (const id of section.citation_chunk_ids) {
        if (!recovered.citations.some((citation) => citation.chunk_id === id)) {
          const source = recovered.sources.find((row) => row.id === id);
          if (source) recovered.citations.push(resultCitation(source));
        }
      }
    recovered.answerSections = recovered.answerSections.filter((section) => !originalSections.includes(section));
  }
  // The complete source adult sentence begins "To reduce", which the unchanged global opening guard treats as a fragment.
  // Reorder an already-proved, already-delivered child directive instead; no source purpose or scope is omitted.
  const youngAge = construction.youngRecommendation?.match(/under (\d+) years of age/)?.[1];
  const childOpening = youngAge
    ? new RegExp(`^Children and people under ${youngAge} years(?: of age)? should not drink alcohol\\.$`, "i")
    : null;
  const young = construction.young;
  const originalChildPresent =
    young &&
    proof.verifiedFields.some((field) =>
      field.some((sentence) => sentence.sourceId === young.id && sentence.role === "young_abstention"),
    );
  if (
    !young ||
    !construction.youngDirectRecommendation ||
    !originalChildPresent ||
    !recovered.citations.some((citation) => citation.chunk_id === young.id && citation.provenance !== "review_only")
  )
    return answer;
  const deliveredSentences = sectionProse(recovered.answer).split(/(?<=[.!?])\s+/);
  const childIndex = deliveredSentences.findIndex(
    (sentence) => childOpening!.test(sentence) && sourceDirectlySupportsAnswerText(sentence, young),
  );
  if (childIndex < 0) return answer;
  const [verifiedOpening] = deliveredSentences.splice(childIndex, 1);
  recovered.answer = [verifiedOpening, ...deliveredSentences].join(" ");
  // Deliberate source supplementation is disclosed in its existing section and routing fields.
  const supplementary = sectionDeliveryObligations(recovered, context)
    .flatMap((obligation) => obligation.members)
    .filter((member) => !sectionMemberDelivered(recovered, member, context));
  const bySource = new Map<string, SectionDeliveryMember[]>();
  for (const member of supplementary) {
    const list = bySource.get(member.source.id) ?? [];
    if (!list.some((existing) => existing.text === member.text)) list.push(member);
    bySource.set(member.source.id, list);
  }
  for (const [id, members] of bySource) {
    if (context.contract?.promptVersion === ragAdaptiveAnswerPromptVersion) {
      recovered.answerSections.push({
        heading: "Additional source qualifications",
        kind: "contraindications_cautions",
        supportLevel: "direct",
        body: members.map((member) => member.text).join(" "),
        citation_chunk_ids: [id],
      });
    } else {
      // Ordinary legacy copy contains only the lead, so the verified supplement and its disclosure must live there.
      const prefixWouldAlterApplicability = /^(?:[•▪◦]\s*)?This guideline does not apply/i.test(members[0].text);
      const precedingRisk =
        prefixWouldAlterApplicability && construction.adult?.id === id && construction.increasedRisk
          ? `${construction.increasedRisk} `
          : "";
      recovered.answer += ` Additional source qualifications: ${precedingRisk}${members.map((member) => member.text).join(" ")}`;
      if (!recovered.citations.some((citation) => citation.chunk_id === id))
        recovered.citations.push(resultCitation(members[0].source));
    }
  }
  if (bySource.size || pregnancyPurposeAdded) recovered.routingReason += "; checked_original_section_source_supplement";
  const limits =
    context.contract?.promptVersion === ragAdaptiveAnswerPromptVersion ? adaptiveAnswerLimits : legacyAnswerLimits;
  // Recovery is optional: exceeding an unchanged output contract refuses the construction before any guard can prune it.
  if (!answerWithinLimits(recovered, limits)) return answer;
  return carryFinalizedOriginalSectionProof(answer, recovered, true);
}

/** Run after every delivery transform. Source possession and quote cards never count as delivered obligations. */
export function enforceOriginalSectionDeliveredCompleteness(
  answer: RagAnswer,
  query: string,
  context: OriginalSectionFinalizationContext = {},
): RagAnswer {
  if (!context.checkedOriginalSectionLayout || !originalSectionQuestionApplies(query)) return answer;
  if (context.originalSectionDeliveryPending) return answer;
  const obligations = sectionDeliveryObligations(answer, context);
  const missing = obligations.filter(
    (obligation) =>
      !obligation.members.length ||
      !obligation.members.every((member) => sectionMemberDelivered(answer, member, context)),
  );
  const deliveredOriginalProof = originalSectionCandidateProofs.get(answer);
  const limits = usesAdaptiveSectionDelivery(context, answer) ? adaptiveAnswerLimits : legacyAnswerLimits;
  const sectionCap = context.originalSectionDeliverySectionCap ?? limits.sections;
  const supplementDisclosed =
    !answer.routingReason?.includes("checked_original_section_source_supplement") ||
    /Additional source qualifications:/i.test(answer.answer) ||
    (usesAdaptiveSectionDelivery(context, answer) &&
      (answer.answerSections ?? []).some((section) => section.heading === "Additional source qualifications"));
  const substantive =
    answer.grounded &&
    answer.confidence !== "unsupported" &&
    !answer.sourceBackedReviewFallback &&
    answer.answerQualityTier !== "source_only" &&
    deliveredOriginalProof !== undefined &&
    deliveredOriginalProof.layout === context.checkedOriginalSectionLayout &&
    sameCandidateFields(deliveredOriginalProof.observedFields, candidateClinicalFields(answer)) &&
    answerWithinLimits(answer, limits, sectionCap) &&
    supplementDisclosed;
  const token =
    missing.length || !substantive
      ? "checked_original_section_delivery:partial"
      : "checked_original_section_delivery:complete";
  const routingReason = (answer.routingReason ?? "")
    .split("; ")
    .filter((reason) => !reason.startsWith("checked_original_section_delivery:"))
    .concat(token)
    .join("; ");
  const retainedSections = (answer.answerSections ?? []).filter(
    (section) => section.heading !== "Answer completeness limitation",
  );
  if (!missing.length && substantive)
    return carryFinalizedOriginalSectionProof(answer, { ...answer, answerSections: retainedSections, routingReason });
  const labels = missing.length ? missing.map((obligation) => obligation.label) : ["a substantive verified answer"];
  const limitation = `This answer is incomplete: ${labels.join("; ")} could not all be retained and verified in the delivered answer.`;
  // A surviving numeric recommendation cannot become broader when its eligibility or material restrictions were lost.
  const adultDependencyLost = missing.some((obligation) => obligations.slice(0, 3).includes(obligation));
  const dropDependentRecommendation = (text: string) =>
    text
      .split(/(?<=[.!?])\s+/)
      .filter(
        (sentence) =>
          !adultDependencyLost ||
          !/\b(?:no more than|up to|at most|maximum(?: of)?)\s+\d+\s+standard drinks\b|\bhealthy (?:men and women|adults)\b[\s\S]*\b(?:drink|drinks|drinking)\b[\s\S]*\bstandard drinks\b/i.test(
            sectionProse(sentence),
          ),
      )
      .join(" ");
  const prose = dropDependentRecommendation(answer.answer)
    .replace(
      /(?:\s*This answer is incomplete:[\s\S]*?could not all be retained and verified in the delivered answer\.)/g,
      "",
    )
    .trim();
  const partial: RagAnswer = {
    ...answer,
    answer: usesAdaptiveSectionDelivery(context, answer) ? prose : `${prose} ${limitation}`.trim(),
    routingReason,
    answerSections: [
      ...retainedSections
        .map((section) => ({ ...section, body: dropDependentRecommendation(section.body) }))
        .filter((section) => section.body),
      {
        heading: "Answer completeness limitation",
        kind: "source_gap",
        supportLevel: "unsupported",
        citation_chunk_ids: [],
        body: limitation,
      },
    ],
  };
  if (!answerWithinLimits(partial, limits, sectionCap)) {
    // Never append a late warning beyond an accepted cap. Withhold the bounded clinical construction as a whole.
    return {
      ...partial,
      answer:
        "This answer is incomplete: the clinical recommendations and their required qualifications could not all be retained and verified within the delivered answer limits.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      answerSections: [],
    };
  }
  return carryFinalizedOriginalSectionProof(answer, partial);
}
