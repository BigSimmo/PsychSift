import {
  clinicalProseUsefulness,
  isLowYieldClinicalText,
  normalizeInlineBulletGlyphs,
  sourceTextForClinicalProse,
} from "@/lib/source-text-sanitizer";

const likelyFragmentPhrases =
  /\b(?:answer|heading|body|grounded|confidence|citations?|answerSections?|citation_chunk_ids|conflictsOrGaps|quoteCards?|source_chunk_ids|chunk_id)\b/i;
const answerSectionArtifactPattern =
  /"?(answer|heading|body|grounded|confidence|citations?|answerSections?|citation_chunk_ids|conflictsOrGaps|quoteCards?|source_chunk_ids|chunk_id)"?\s*:\s*/i;
// Mid-text truncation must only fire on a genuine leaked JSON key — i.e. a
// double-quoted key followed by a colon ("confidence":). A bare English word +
// colon ("...document the confidence: high...") is legitimate clinical prose and
// must NOT cause the rest of the answer/section to be sliced away.
const leakedJsonKeyPattern =
  /"(answer|heading|body|grounded|confidence|citations?|answerSections?|citation_chunk_ids|conflictsOrGaps|quoteCards?|source_chunk_ids|chunk_id)"\s*:/i;
const productCatalogueFragmentPattern =
  /\b[A-Z][A-Za-z ]+\s+\d+\s*mg\b[^.?!]*?\b(?:tablet|capsule|solution|modified release|enteric-coated)\b[^.?!]*?[®™]\s*/gi;
const brandOrFormularyFragmentPattern =
  /\b(?:Lithicarb|Quilonum\s+SR|Campral)[®™]?|\b(?:imprest|formulary)\s+(?:location|one)\b.*?(?=\b(?:therapy|treatment|start|commence|begin|check|monitor|baseline|dose|dosing)\b|[.?!]|$)/gi;
const imprestLocationPattern =
  /\bimprest\s+location\s*:\s*.*?(?=\b(?:therapy|treatment|start|commence|begin|check|monitor|baseline|dose|dosing)\b|$)/gi;
const allCapsSourceHeadingPattern = /\b(?=[A-Z0-9/&,+() -]*\s[A-Z0-9])[A-Z][A-Z0-9/&,+() -]{8,}\b/g;
const sourceFormCodePattern = /\b[A-Z]{2,8}\d{3,}(?:\/\d+)?\b/g;
const bracketedCitationMarkerPattern =
  /\s*(?:\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]|\(\s*\d+(?:\s*[-,]\s*\d+)*\s*\))(?=\.?(?:\s|$))/g;
const trailingCitationDigitPattern = /(?<=[a-z)])\d+(?=\.?(?:\s|$))/g;
const clinicalAbbreviationCitationDigitPattern =
  /\b(ANC|FBC|WBC|ECG|EEG|LFTs?|UEC|U&E|QTc|BMI|BP|HR|RR|CRP|ESR|TSH|HbA1c)\d+(?=\.?(?:\s|$))/gi;
const orphanSourceHeadingPattern =
  /^(?:lithium\s+)?(?:monitoring|baseline tests?|dose|dosage|dosage adjustments?|therapy|source|table|section)$/i;
const sourceInventoryWordingPattern =
  /\b(?:the\s+(?:strongest\s+)?retrieved\s+(?:source|sources|passages|excerpts)\s+(?:support|supports|show|shows|indicate|indicates)|retrieved\s+(?:source|sources|passages|excerpts)|indexed\s+source\s+passages\s+matched|no\s+concise\s+source\s+sentence|source-backed|based\s+on\s+(?:the\s+)?(?:provided\s+)?(?:sources|excerpts|passages|retrieved\s+sources)|dose evidence|monitoring evidence|table evidence|direct source-backed answer)\b/i;
const clippedClinicalFragmentPattern =
  /\b(?:stabili[sz]e\s+the\s+do|the\s+do\b|liver\s+functi\b|respiratio\b|if\s+a\s+60%\s+decrease\s+in\s+b\b|guidance(?:\s+for\s+[^.!?]{1,60})?\s+is\s+that\s+(?:adjust|monitoring|higher\s+doses?\s+than|lower\s+doses?\s+than))\b/i;
const danglingClinicalClausePattern =
  /(?:^|[.!?]\s+)[^.!?]*\b(?:before|after|with|than|for|to|of|and|or|when\s+compared\s+with)\s*[.!?](?:\s|$)/i;
const extractiveAnswerArtifactPattern =
  /^(?:»|›|→)|(?:^|[.!?]\s+)(?:mg|mcg|micrograms?|g|ml|units?|iu)\b|\b(?:Best Uses|Bottom Line|clinical Focus)\b/i;
const genericMedicationCasePatterns: Array<[RegExp, string]> = [
  [/\bLithium Carbonate\b/g, "lithium carbonate"],
  [/\bClozapine\b/g, "clozapine"],
  [/\bAcamprosate\b/g, "acamprosate"],
  [/\bSertraline\b/g, "sertraline"],
  [/\bNaltrexone\b/g, "naltrexone"],
  [/\bDisulfiram\b/g, "disulfiram"],
  [/\bBaclofen\b/g, "baclofen"],
];

/**
 * Normalizes whitespace in text by trimming and collapsing consecutive spaces into single space.
 *
 * @param value - Raw text string
 * @returns Clean single-line trimmed string
 */
export function normalizeSectionText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Tokenizes text into lowercase alphanumeric words.
 *
 * @param text - Input string to tokenize
 * @returns Array of lowercase alphanumeric tokens
 */
export function splitBalancedWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Checks whether text appears to be leaked JSON syntax, schema artifacts, or punctuation noise.
 *
 * @param value - String to evaluate
 * @returns `true` if the string resembles leaked JSON structure
 */
export function looksLikeJsonArtifact(value: string) {
  const normalized = normalizeSectionText(value);
  if (!normalized) return true;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasJsonStructure = /[{}\[\]]/.test(normalized);
  const quoteCount = (normalized.match(/"/g) ?? []).length;
  const colonCount = (normalized.match(/:/g) ?? []).length;
  const keyValuePairs = (normalized.match(/"[^"]+"\s*:\s*/g) ?? []).length;
  const keyPairDensity = tokenCount > 0 ? keyValuePairs / tokenCount : 0;
  const hasKnownKeys = likelyFragmentPhrases.test(normalized);
  const hasBalancedBraces = (normalized.match(/[{}\[\]]/g) ?? []).length >= 2;
  const hasBalancedBrackets = (normalized.match(/[\[\]]/g) ?? []).length >= 2;
  const tokenDensity = splitBalancedWords(normalized);
  const isMostlyPunctuationNoise = tokenDensity.length >= 6 && tokenDensity.every((word) => word.length <= 2);
  const hasBracketKeyPairs =
    /"\s*(?:answer|heading|body|grounded|confidence|citation_chunk_ids|conflictsOrGaps|quoteCards?|source_chunk_ids|chunk_id)\s*"/i.test(
      normalized,
    );

  if (normalized.startsWith("{") && normalized.endsWith("}") && (hasKnownKeys || quoteCount >= 4)) {
    return true;
  }

  if (
    hasJsonStructure &&
    hasBalancedBraces &&
    keyValuePairs >= 2 &&
    quoteCount >= 4 &&
    colonCount >= 2 &&
    hasKnownKeys &&
    (tokenCount <= 70 || keyPairDensity > 0.2)
  ) {
    return true;
  }

  if (
    normalized.includes("}") &&
    normalized.includes("{") &&
    hasKnownKeys &&
    /"[^"]+":\s*"/.test(normalized) &&
    tokenCount <= 40
  ) {
    return true;
  }

  if (isMostlyPunctuationNoise) return true;
  if (
    hasBracketKeyPairs &&
    hasJsonStructure &&
    (quoteCount >= 2 || colonCount >= 2 || hasBalancedBrackets) &&
    tokenCount <= 70
  ) {
    return true;
  }

  return false;
}

/**
 * Sanitizes structured answer text by stripping JSON artifacts, noisy headings, and catalog fragments.
 *
 * @param value - Raw answer or section text
 * @param options - Length/token thresholds and prefix handling options
 * @returns Clean sanitized text or empty string if unusable
 */
export function sanitizeStructuredText(
  value: string,
  options: { minLength?: number; minTokens?: number; keepLeading?: boolean } = {},
) {
  const { minLength = 2, minTokens = 1, keepLeading = false } = options;
  const normalized = normalizeSectionText(sourceTextForClinicalProse(value));
  if (!normalized) return "";

  // A leaked key at the very start is stripped (lenient: it is clearly an
  // artifact prefix). Mid-text, only truncate at a genuine quoted JSON key so we
  // never cut real prose at an ordinary word like "confidence:" or "body:".
  const leakedKeyIndex = normalized.search(leakedJsonKeyPattern);
  const trimmed =
    normalized.search(answerSectionArtifactPattern) === 0
      ? normalized.replace(answerSectionArtifactPattern, "").trim()
      : leakedKeyIndex > 0
        ? // Slice off the leaked JSON tail and also drop any opening brace/bracket
          // left dangling just before it (e.g. "...daily. {" -> "...daily.").
          normalized
            .slice(0, leakedKeyIndex)
            .replace(/[\s{[]+$/, "")
            .trim()
        : normalized;

  const finalText = keepLeading ? trimmed : trimmed.trim();
  if (!finalText) return "";
  if (finalText.length < minLength) return "";
  if (looksLikeJsonArtifact(finalText)) return "";
  const tokenCount = finalText.split(/\s+/).filter(Boolean).length;
  if (tokenCount < minTokens) return "";
  if (!/[A-Za-z]{2,}/.test(finalText)) return "";
  const usefulness = clinicalProseUsefulness(finalText);
  if (!usefulness.useful && isLowYieldClinicalText(finalText)) return "";
  return usefulness.text || finalText;
}

function normalizeGenericMedicationCase(value: string) {
  let normalized = value;
  for (const [pattern, replacement] of genericMedicationCasePatterns) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

// "e.g." and "i.e." stay inside their sentence; splitting there printed "(e. g." and let the
// fragment filters drop the examples that followed (#ZZ4RAP).
function answerSentenceFragments(value: string) {
  return value.match(/(?:\d+\.\d+|\b[Ee]\.[Gg]\.|\b[Ii]\.[Ee]\.|[^.!?])+[.!?]?/g) ?? [value];
}

function removeOrphanAnswerHeadings(value: string) {
  const fragments = answerSentenceFragments(value);
  return fragments
    .map((fragment) => normalizeSectionText(fragment))
    .filter((fragment) => {
      const normalized = fragment.replace(/[.!?]+$/, "").trim();
      if (!normalized) return false;
      if (orphanSourceHeadingPattern.test(normalized)) return false;
      return true;
    })
    .join(" ");
}

function removeBadAnswerFragments(value: string) {
  const fragments = answerSentenceFragments(value);
  return fragments
    .map((fragment) => normalizeSectionText(fragment))
    .filter((fragment) => {
      const normalized = fragment.replace(/[.!?]+$/, "").trim();
      if (!normalized) return false;
      if (sourceInventoryWordingPattern.test(normalized)) return false;
      if (clippedClinicalFragmentPattern.test(normalized)) return false;
      brandOrFormularyFragmentPattern.lastIndex = 0;
      if (brandOrFormularyFragmentPattern.test(normalized)) return false;
      if (/\btable\s+\d+\b/i.test(normalized) && normalized.length > 180) return false;
      return true;
    })
    .join(" ");
}

// Dense monitoring tables are sometimes flattened into run-ons where an inpatient schedule is
// immediately followed by a community schedule with no sentence break (e.g. "...monitored daily
// for inpatients for community patients weekly..."). The synthesis prompt handles most of these,
// but this is a narrow deterministic safety-net for the clearest recurring pattern. It also
/**
 * Separates flattened inpatient and community patient schedule phrases into distinct sentences.
 *
 * @param value - Clinical prose containing a setting-related run-on phrase
 * @returns The prose with the targeted setting run-on replaced by separate sentences
 */
function separateSettingRunOns(value: string): string {
  return value
    .replace(/\bfor inpatients,?\s+for community patients,?/gi, "for inpatients. For community patients,")
    .replace(/\bfor community patients,?\s+for inpatients,?/gi, "for community patients. For inpatients,");
}

function stripAnswerArtifactNoise(text: string) {
  return text
    .replace(productCatalogueFragmentPattern, " ")
    .replace(brandOrFormularyFragmentPattern, " ")
    .replace(imprestLocationPattern, " ")
    .replace(allCapsSourceHeadingPattern, " ")
    .replace(sourceFormCodePattern, " ")
    .replace(/\b(?:dose evidence|monitoring evidence|table evidence|source point)\s*:\s*/gi, " ")
    .replace(/\s+to\s+stabili[sz]e\s+the\s+do\b\.?/gi, ".")
    .replace(/\b(?:liver functi|respiratio)\b[^.?!]*[.?!]?/gi, " ")
    .replace(bracketedCitationMarkerPattern, "")
    .replace(clinicalAbbreviationCitationDigitPattern, "$1")
    .replace(/(?<=[a-z)])\s*\.\s*\d+(?=\.?(?:\s|$))/g, ".")
    .replace(trailingCitationDigitPattern, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function restoreBoldSpans(text: string, boldSpans: string[]) {
  let restored = text;
  for (const span of boldSpans) {
    if (restored.includes(span) && !restored.includes(`**${span}**`)) {
      restored = restored.replace(span, `**${span}**`);
    }
  }
  return restored;
}

/**
 * Cleans clinical answer text by removing artifacts, normalizing formatting, and improving readability.
 *
 * @param value - The clinical answer text to polish
 * @param options - Formatting options
 * @param options.preserveBold - Whether to preserve inline bold markers
 * @returns The polished clinical answer text
 */
export function polishClinicalAnswerProse(value: string, options: { preserveBold?: boolean } = {}) {
  // Bold markers normally come off before bullet normalization so an emphasized
  // item ("o **Reduce dose**") still reads as a sub-bullet to the "o" matcher.
  // The display path passes preserveBold so <SafeBoldText> can render the
  // server's high-yield emphasis (and the un-bold unverified-number safety
  // signal); the sub-bullet matcher tolerates a leading "**" so bolded
  // sub-bullets still normalize. The server answer-gen path keeps the default
  // (strip), so its quality gates are unchanged.
  const normalized = normalizeSectionText(value);
  const boldSpans = [...normalized.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]);
  const bulletNormalized = normalizeInlineBulletGlyphs(
    options.preserveBold ? normalized : normalized.replace(/\*\*([^*]+)\*\*/g, "$1"),
  );
  // Artifact regexes were written for unbolded catalogue/source noise; run
  // them on a de-bolded copy so preserveBold still strips Lithicarb-style junk.
  const deBolded = bulletNormalized.replace(/\*\*([^*]+)\*\*/g, "$1");
  const cleaned = stripAnswerArtifactNoise(deBolded);

  const polished = normalizeGenericMedicationCase(
    separateSettingRunOns(removeOrphanAnswerHeadings(removeBadAnswerFragments(cleaned))),
  );

  return options.preserveBold ? restoreBoldSpans(polished, boldSpans) : polished;
}

/**
 * Strips artifacts, normalizes punctuation and brand fragments, and polishes answer prose.
 *
 * @param value - Raw answer string
 * @returns Cleaned and polished prose string
 */
export function sanitizeAnswerText(value: string) {
  const cleaned = sanitizeStructuredText(value, { minLength: 8, minTokens: 2, keepLeading: true });
  return cleaned ? polishClinicalAnswerProse(cleaned) : "";
}

/**
 * Evaluates whether text contains clinical answer quality issues like unreferenced digits, fragments, or catalog noise.
 *
 * @param value - Answer string to evaluate
 * @returns `true` if a quality defect is detected
 */
export function hasClinicalAnswerQualityIssue(value: string) {
  const normalized = normalizeSectionText(value);
  if (!normalized) return true;
  productCatalogueFragmentPattern.lastIndex = 0;
  brandOrFormularyFragmentPattern.lastIndex = 0;
  allCapsSourceHeadingPattern.lastIndex = 0;
  sourceFormCodePattern.lastIndex = 0;
  bracketedCitationMarkerPattern.lastIndex = 0;
  clinicalAbbreviationCitationDigitPattern.lastIndex = 0;
  const bareDoseFigurePattern =
    /\b(?:maximum(?:\s+(?:recommended|daily))?(?:\s+dose)?|dose(?!\s+\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)\b)(?:\s+(?:of|is|to))?|increase(?:d)?\s+to)\s*:?\s*\d+(?:\.\d+)?(?!\d|\.\d|\s*(?:mg|milligrams?|mcg|micrograms?|g|grams?|kg|kilograms?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|international\s+units?|units?|iu|mmol(?:\/l)?|millimoles?(?:\s+per\s+lit(?:er|re))?|meq|milliequivalents?|tablets?|capsules?|puffs?|drops?|sprays?|patch(?:es)?)\b)/i;
  return (
    sourceInventoryWordingPattern.test(normalized) ||
    clippedClinicalFragmentPattern.test(normalized) ||
    danglingClinicalClausePattern.test(normalized) ||
    extractiveAnswerArtifactPattern.test(normalized) ||
    productCatalogueFragmentPattern.test(normalized) ||
    brandOrFormularyFragmentPattern.test(normalized) ||
    allCapsSourceHeadingPattern.test(normalized) ||
    sourceFormCodePattern.test(normalized) ||
    bracketedCitationMarkerPattern.test(normalized) ||
    clinicalAbbreviationCitationDigitPattern.test(normalized) ||
    bareDoseFigurePattern.test(normalized) ||
    /(?<=[a-z)])\d+(?=\.?(?:\s|$))/.test(normalized)
  );
}

/**
 * Checks whether section text passes minimum usable token and length requirements after sanitization.
 *
 * @param value - Raw section text
 * @param options - Minimum token and length constraints
 * @returns `true` if the section text is usable
 */
export function isUsableAnswerSectionText(value: string, options: { minTokens?: number; minLength?: number } = {}) {
  return Boolean(sanitizeStructuredText(value, options));
}

/**
 * Safely casts an unknown value to a non-array record map or empty object.
 *
 * @param value - Input value
 * @returns Record map
 */
export function safeRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Safely extracts a non-empty string value from a metadata record by key.
 *
 * @param metadata - Metadata record map
 * @param key - Field key to look up
 * @returns Trimmed string value or null
 */
export function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
