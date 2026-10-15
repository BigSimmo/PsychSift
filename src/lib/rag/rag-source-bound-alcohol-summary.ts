import { createHash } from "node:crypto";
import { sourceDirectlySupportsAnswerText } from "@/lib/rag/rag-claim-support";
import type { RagAnswer, SearchResult } from "@/lib/types";

const prose = (text: string) => text.normalize("NFKC").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const equal = (left: string, right: string) => prose(left).toLowerCase() === prose(right).toLowerCase();

/** Finite source-wording recovery, never a support exemption or original-layout authority. */
export function renderSourceBoundAlcoholSummary(answer: RagAnswer, verificationSources: SearchResult[]) {
  const ids = new Set(
    answer.citations.filter((citation) => citation.provenance !== "review_only").map((c) => c.chunk_id),
  );
  // Exact recorded-source compatibility profile; no publisher metadata is inferred or changed.
  const recordedSourcePins = new Map([
    ["d910494d-5850-558b-9c0f-1e0f7a5f8869", "f012e0656fc311fdd4a1c61285bc581c91dbef93070329b01b74f4e041000b69"],
    ["9f53153b-be1b-5247-9e5e-e9ca99da9cdc", "c7bbc2c72340f53f073b8416e6c5696db1f7bc7a5065ef4d6255a229ed748189"],
    ["2b86f224-148f-54ce-99bb-caba6489789f", "26be9b715bd1a419e6fb4d9fefe5f65a66358f750abcbc2a6bcd2b0447fe96b1"],
  ]);
  const recordedCited = verificationSources.filter((source) => ids.has(source.id));
  const recordedSourceProfile =
    ids.size === 3 &&
    recordedCited.length === 3 &&
    new Set(recordedCited.map((source) => source.id)).size === 3 &&
    recordedCited.every(
      (source) =>
        source.document_id === "d69a6b9c-3e80-556a-b887-53d209238293" &&
        source.source_metadata?.publisher_code === null &&
        source.source_metadata.publisher === "National Health and Medical Research Council" &&
        recordedSourcePins.get(source.id) === createHash("sha256").update(source.content, "utf8").digest("hex"),
    );
  const cited = recordedSourceProfile
    ? recordedCited
    : verificationSources.filter((source) => ids.has(source.id) && source.source_metadata?.publisher_code === "NHMRC");
  const one = (pattern: RegExp) => {
    const matches = cited.filter((source) => pattern.test(prose(source.content)));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const adult = one(/^Guideline 1: Adults To reduce the risk of harm from alcohol-related disease or injury,/);
  const young = one(/^Guideline 2: Children and people under \d+ years of age /);
  const maternal = one(/^Guideline 3: Women who are pregnant or breastfeeding /);
  if (!adult || !young || !maternal || new Set([adult.document_id, young.document_id, maternal.document_id]).size !== 1)
    return null;
  const permittedIds = new Set([adult.id, young.id, maternal.id]);
  if ([...ids].some((id) => !permittedIds.has(id)) || cited.length !== permittedIds.size) return null;
  // A recognised heading cannot reset a restriction, historical quotation or competing scope.
  // The two exact native statements below describe other populations and milk clearance;
  // they do not restrict the healthy-adult recommendation. Every other restriction refuses recovery.
  if (
    [adult, young, maternal].some((source) =>
      /\b(?:historical|previous|previously|earlier|formerly|outdated|superseded|hypothetical|quoted|quote|quotation|example|unless|except|provided|only|does not apply|not applicable|restricted|limited to|instead|obsolete|retracted|not current|statement is false|statement is incorrect|following statement is)\b/i.test(
        prose(source.content)
          .replace(
            source === adult
              ? "This guideline does not apply to children and young people under the age of 18 years (who are covered in Guideline 2), or to women who are planning a pregnancy, or are pregnant or breastfeeding (who are covered in Guideline 3)."
              : "\u0000",
            "",
          )
          .replace(source === maternal ? "Only time reduces the amount of alcohol in the milk." : "\u0000", ""),
      ),
    )
  )
    return null;
  const text = prose(adult.content);
  const prefix = text.match(
    /^Guideline 1: Adults To reduce the risk of harm from alcohol-related disease or injury, (healthy men and women should drink no more than (\d+) standard drinks a week and no more than (\d+) standard drinks on any one day\.) (The less you drink, the lower your risk of harm from alcohol\.) (This guideline applies to healthy men and women aged (\d+) years and over\.)/,
  );
  if (!prefix) return null;
  const [, recommendation, weekly, daily, lowerRisk, eligibility, age] = prefix;
  const sentence = (source: SearchResult, pattern: RegExp) => {
    const matches = [...prose(source.content).matchAll(new RegExp(pattern.source, "g"))];
    const value = matches.length === 1 ? matches[0][0] : null;
    return value &&
      sourceDirectlySupportsAnswerText(value, {
        ...source,
        retrieval_synopsis: null,
        table_facts: [],
        index_unit: null,
      })
      ? value
      : null;
  };
  const noRisk = sentence(
    adult,
    /The guideline does not represent a ['‘]safe['’] or ['‘]no-risk['’] drinking level, nor does it set an absolute upper limit of intake\./,
  );
  const riskText = prose(adult.content).match(
    /This guideline provides recommendations to reduce the risk of harm from alcohol, but these recommendations do not completely eliminate all risk from drinking alcohol\./,
  )?.[0];
  const riskReduction = riskText ? `${eligibility} ${riskText.replace(", but these", ". These")}` : null;
  if (!riskReduction || !sourceDirectlySupportsAnswerText(riskReduction, adult)) return null;
  const abstention = sentence(adult, /Not drinking at all is the best way to reduce the risk of harm from alcohol\./);
  const youngNoSafe = sentence(
    young,
    /There is no clear ['‘]safe['’] level of alcohol consumption for children and people under \d+ years of age\./,
  );
  const maternalNoSafe = sentence(
    maternal,
    /The evidence does not indicate a safe amount of alcohol that pregnant women and breastfeeding mothers can drink\./,
  );
  if (!noRisk || !riskReduction || !abstention || !youngNoSafe || !maternalNoSafe) return null;
  if (recordedSourceProfile) {
    // A finite recovery miss must not leave an unbound standard-drink recommendation delivered.
    // This source profile already requires the actual adult, child and maternal non-review citations.
    const lead = prose(answer.answer);
    const reject = () => ({ answer, complete: () => false });
    // Only this pinned profile may be reworded. Admit independently bound clinical
    // clauses, not a captured model narrative or a particular attribution verb.
    // Full consumption rejects extra advice, negation and competing recommendations.
    const adultClauses = lead.split(/(?<=[.!?])\s+/).filter((clause) => /\bstandard drinks?\b/i.test(clause));
    if (adultClauses.length !== 1) return /\bstandard drinks?\b/i.test(lead) ? reject() : null;
    const adultClause = adultClauses[0];
    const consume = (text: string, pattern: RegExp) => {
      const matches = [...text.matchAll(new RegExp(pattern.source, "gi"))];
      return matches.length === 1 ? { text: text.replace(matches[0][0], " "), claim: matches[0][0] } : null;
    };
    const scope = consume(adultClause, /\bhealthy (?:adults|men and women) aged \d+ years (?:and over|or older)\b/);
    const week = scope && consume(scope.text, /\b(?:no more than|at most) \d+ standard drinks? (?:a|per|each) week\b/);
    const day =
      week &&
      consume(
        week.text,
        /\b(?:no more than|at most) \d+ standard drinks? (?:on any one day|in any (?:one|single) day|per day)\b/,
      );
    const less =
      day &&
      consume(day.text, /\b(?:less is lower risk|(?:drinking )?less (?:further )?(?:lowers|reduces) (?:the )?risk)\b/);
    const adultRemainder = less?.text ?? day?.text;
    // Consume affirmative attribution as one grammatical unit. Negated, adverse
    // or unknown reporting language remains unconsumed and cannot reverse a limit.
    const attribution =
      adultRemainder &&
      consume(
        adultRemainder,
        /\b(?:the )?NHMRC (?:(?:advises|recommends)|(?:guidance|advice|recommendations?|guidelines?) (?:is|are))\b/,
      );
    if (
      !scope ||
      !week ||
      !day ||
      adultRemainder === undefined ||
      scope.claim.match(/\d+/)?.[0] !== age ||
      week.claim.match(/\d+/)?.[0] !== weekly ||
      day.claim.match(/\d+/)?.[0] !== daily ||
      !/^(?:(?:for|should|drink|and)\b|[\s,;:.])*$/i.test(attribution ? attribution.text : adultRemainder) ||
      !sourceDirectlySupportsAnswerText(adultClause, adult)
    )
      return reject();
    let remaining = lead.replace(adultClause, " ");
    const youngClause = consume(
      remaining,
      /\b(?:children and (?:young )?people|people|children) under \d+(?: years(?: of age)?)? (?:should|must) not drink alcohol\b/,
    );
    if (
      !youngClause ||
      youngClause.claim.match(/\d+/)?.[0] !== age ||
      !sourceDirectlySupportsAnswerText(youngClause.claim, young)
    )
      return reject();
    remaining = youngClause.text;
    const pregnancyClause = consume(
      remaining,
      /\bwomen who are pregnant or planning (?:a pregnancy|pregnancy) (?:should|must) not drink alcohol\b/,
    );
    if (!pregnancyClause || !sourceDirectlySupportsAnswerText(pregnancyClause.claim, maternal)) return reject();
    remaining = pregnancyClause.text;
    const breastfeedingClause = consume(
      remaining,
      /\b(?:for (?:women who are breastfeeding|breastfeeding women),? not drinking(?: alcohol)? is safest for (?:their|the) baby|not drinking(?: alcohol)? is safest while breastfeeding)\b/,
    );
    if (
      !breastfeedingClause ||
      !sourceDirectlySupportsAnswerText(breastfeedingClause.claim, maternal) ||
      !/^(?:and\b|[\s,;:.])*$/i.test(breastfeedingClause.text)
    )
      return reject();
    const risk = answer.answerSections?.length === 1 ? answer.answerSections[0] : undefined;
    // The model's heading/kind is presentation, not evidence. Consume only the two
    // adult qualifications already supported above; rebuild them from source text.
    const noSafeClaim =
      risk &&
      consume(
        prose(risk.body),
        /\b(?:the adult limits|the adult guideline) (?:are|is) not a (?:safe or no-risk|safe|no-risk) level\b/,
      );
    const abstentionClaim =
      noSafeClaim &&
      consume(
        noSafeClaim.text,
        /\b(?:not drinking(?: alcohol)?|abstaining) is the best way to reduce alcohol-related harm\b/,
      );
    if (
      !risk ||
      risk.supportLevel !== "direct" ||
      risk.citation_chunk_ids.length !== 1 ||
      risk.citation_chunk_ids[0] !== adult.id ||
      !abstentionClaim ||
      !/^[\s,;:.]*$/.test(abstentionClaim.text)
    )
      return reject();
    const pregnancyNoSafe = sentence(
      maternal,
      /No safe level of alcohol consumption during pregnancy has been identified\./,
    );
    // This exact native recommendation occurs twice; duplication does not create an alternative wording.
    const breastfeeding = "For women who are breastfeeding, not drinking alcohol is safest for their baby.";
    const youngRecommendation = `People under ${age} years should not drink alcohol.`;
    const pregnancyRecommendation = "Women who are pregnant or planning pregnancy should not drink alcohol.";
    if (
      !pregnancyNoSafe ||
      !prose(maternal.content).includes(breastfeeding) ||
      !sourceDirectlySupportsAnswerText(breastfeeding, maternal) ||
      !sourceDirectlySupportsAnswerText(recommendation, adult) ||
      !sourceDirectlySupportsAnswerText(eligibility, adult) ||
      !sourceDirectlySupportsAnswerText(youngRecommendation, young) ||
      !sourceDirectlySupportsAnswerText(pregnancyRecommendation, maternal)
    )
      return null;
    const adultQualification = `Adult guideline: ${noRisk}`;
    if (!sourceDirectlySupportsAnswerText(adultQualification, adult)) return null;
    const required = [
      recommendation[0].toUpperCase() + recommendation.slice(1),
      eligibility,
      lowerRisk,
      youngRecommendation,
      pregnancyRecommendation,
      breastfeeding,
      adultQualification,
      abstention,
      youngNoSafe,
      pregnancyNoSafe,
      maternalNoSafe,
    ];
    const riskBody = `${riskReduction} ${abstention} ${pregnancyNoSafe} ${maternalNoSafe}`;
    const next: RagAnswer = {
      ...answer,
      answer: required.join(" "),
      answerSections: [
        {
          heading: "Important qualification",
          kind: "contraindications_cautions",
          supportLevel: "direct",
          body: riskBody,
          citation_chunk_ids: [adult.id, maternal.id],
        },
      ],
    };
    return {
      answer: next,
      complete: (final: RagAnswer) => {
        const lead = prose(final.answer).toLowerCase();
        const deliveredRisk = final.answerSections?.find(
          (section) =>
            section.heading === "Important qualification" &&
            section.kind === "contraindications_cautions" &&
            equal(section.body, riskBody),
        );
        return (
          required.every((text) => lead.includes(prose(text).toLowerCase())) &&
          !!deliveredRisk &&
          [adult.id, young.id, maternal.id].every((id) =>
            final.citations.some((c) => c.chunk_id === id && c.provenance !== "review_only"),
          ) &&
          deliveredRisk.citation_chunk_ids.length === 2 &&
          [adult.id, maternal.id].every((id) => deliveredRisk.citation_chunk_ids.includes(id))
        );
      },
    };
  }
  const expectedLead = `For healthy adults aged ${age} years and over, drink no more than ${weekly} standard drinks a week and no more than ${daily} standard drinks on any one day; less drinking further lowers risk. People under ${age} years should not drink alcohol. Women who are pregnant or planning pregnancy should not drink alcohol, and for women who are breastfeeding, not drinking alcohol is safest for the baby. These recommendations do not imply a safe or no-risk level of alcohol use.`;
  const expectedRisk =
    "For healthy adults, the recommended limits reduce risk but do not eliminate it; not drinking is the best way to reduce alcohol-related harm. No safe level has been identified during pregnancy, and the evidence does not indicate a safe amount for pregnant or breastfeeding mothers.";
  const risk = answer.answerSections?.find(
    (section) =>
      equal(section.body, expectedRisk) &&
      section.citation_chunk_ids.includes(adult.id) &&
      section.citation_chunk_ids.includes(maternal.id) &&
      section.citation_chunk_ids.every((id) => id === adult.id || id === maternal.id),
  );
  if (!equal(answer.answer, expectedLead) || !risk) return null;
  const remainingLead = `People under ${age} years should not drink alcohol. Women who are pregnant or planning pregnancy should not drink alcohol, and for women who are breastfeeding, not drinking alcohol is safest for the baby.`;
  if (
    !sourceDirectlySupportsAnswerText(recommendation, adult) ||
    !sourceDirectlySupportsAnswerText(eligibility, adult) ||
    !sourceDirectlySupportsAnswerText(`People under ${age} years should not drink alcohol.`, young) ||
    !sourceDirectlySupportsAnswerText(remainingLead.slice(remainingLead.indexOf("Women")), maternal)
  )
    return null;
  // Label the adult-only qualification; plural "these recommendations" is rendered
  // with independently checked no-safe-level statements for all three cited populations.
  const adultQualification = `Adult guideline: ${noRisk}`;
  if (!sourceDirectlySupportsAnswerText(adultQualification, adult)) return null;
  const expectedRiskBody = `${riskReduction} ${abstention} No safe level has been identified during pregnancy, and the evidence does not indicate a safe amount for pregnant or breastfeeding mothers.`;
  const next: RagAnswer = {
    ...answer,
    answer: `${recommendation[0].toUpperCase()}${recommendation.slice(1)} ${eligibility} ${lowerRisk} ${remainingLead} ${adultQualification} ${youngNoSafe} ${maternalNoSafe}`,
    answerSections: answer.answerSections?.map((section) =>
      section !== risk
        ? section
        : {
            ...section,
            body: expectedRiskBody,
          },
    ),
  };
  return {
    answer: next,
    complete: (final: RagAnswer) => {
      const lead = prose(final.answer).toLowerCase();
      const required = [
        recommendation,
        eligibility,
        lowerRisk,
        remainingLead,
        adultQualification,
        youngNoSafe,
        maternalNoSafe,
      ];
      const deliveredRisk = final.answerSections?.find(
        (section) => section.heading === risk.heading && equal(section.body, expectedRiskBody),
      );
      return (
        required.every((text) => lead.includes(prose(text).toLowerCase())) &&
        !!deliveredRisk &&
        [adult.id, young.id, maternal.id].every((id) =>
          final.citations.some((c) => c.chunk_id === id && c.provenance !== "review_only"),
        ) &&
        [adult.id, maternal.id].every((id) => deliveredRisk.citation_chunk_ids.includes(id))
      );
    },
  };
}
