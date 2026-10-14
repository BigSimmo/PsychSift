const completeImageDataBlockPattern = /\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g;
const trailingImageDataBlockPattern = /\[\[IMAGE_DATA_START\]\][\s\S]*$/g;
const leadingImageDataBlockRemainderPattern = /^[\s\S]*?\[\[IMAGE_DATA_END\]\]/g;
// "N additional image/table blocks on this page" markers emitted by
// buildPageImageContext when a page exceeds the indexed-image cap; internal
// bookkeeping that must never render or be copied.
const omittedImageDataBlockPattern = /\[\[IMAGE_DATA_OMITTED\]\][\s\S]*?\[\[\/IMAGE_DATA_OMITTED\]\]/g;
const omittedImageDataMarkerPattern = /\[\[\/?IMAGE_DATA_OMITTED\]\]/g;
// Case-INSENSITIVE: a forged close-then-reopen only needs to match the model's
// parse of the fence, and models read `<<<end_source_excerpt>>>` the same as the
// uppercase form. Matching only ALL-CAPS (the pre-hardening behaviour) let a
// lowercase/mixed-case forged sentinel straddle the real block (threat model
// Vector E / INJ-3, INJ-12). The real wrapper is added by fenceSourceEvidence
// AFTER escaping runs on the inner text, so broadening this never escapes the
// genuine outer fence.
const evidenceFenceSentinelPattern = /<<<(?:END[_-]?)?[A-Za-z][A-Za-z0-9_]{0,63}>>>/gi;

const internalImageMetadataPattern =
  /\b(?:Image ID|Source kind|Image type|Table role|Clinical use class|Clinical use reason|Clinical signal score|Admin signal score|Storage path|Image path)\s*:\s*[^;|]+[;|]?\s*/gi;
const internalImageTokenPattern =
  /\b(?:admin_table|clinical_table|decorative_image|diagram_crop|embedded_image|fallback_image|page_region|table_crop)\b/gi;

const sourceDocumentCodeSource = String.raw`(?:[A-Z]{2,8}-[A-Z]{2,8}-\d{2,}(?:\/\d+)?|[A-Z]{2,8}-\d{3,}(?:\/\d+)?)`;
const sourceDocumentCodePattern = new RegExp(String.raw`\b${sourceDocumentCodeSource}\b`, "g");
const sourceDocumentCodeTestPattern = new RegExp(String.raw`\b${sourceDocumentCodeSource}\b`);
const pageBoilerplateSource = String.raw`Page\s+\d+\s+of\s+\d+`;
const pageBoilerplatePattern = new RegExp(String.raw`\b${pageBoilerplateSource}\b`, "gi");
const pageBoilerplateTestPattern = new RegExp(String.raw`\b${pageBoilerplateSource}\b`, "i");
const sourceTitleWithCodePattern = new RegExp(
  String.raw`(?:^|[\s.;])(?:[A-Z][A-Za-z0-9/&(),' -]{2,120}\s+)?(?:Guideline|Procedure|Protocol|Policy|Form)\s+${sourceDocumentCodeSource}(?:\s+${pageBoilerplateSource})?\.?`,
  "gi",
);
const sourceControlLinePattern =
  /\b(?:uncontrolled when printed|document control|document owner|authoris(?:ed|ation)|authorised by|published date|effective from|review date|version\s+\d+|amendment|supporting information|relevant standards|references)\b/i;
// PSPF protective-marking banners stamped on WA Health PDFs ("OFFICIAL",
// "OFFICIAL: Sensitive"). Case-sensitive ALL-CAPS tokens only, anchored to a
// line start, so clinical prose ("the official guideline") and title-case
// names ("Official Visitors Scheme") can never match. Extraction often glues
// the running header onto body text, sometimes twice ("OFFICIAL: OFFICIAL …"),
// hence the {1,3} repetition.
const classificationMarkerSource = String.raw`(?:UNOFFICIAL|OFFICIAL(?:\s*:\s*Sensitive)?|SENSITIVE|PROTECTED)`;
const classificationBannerLinePattern = new RegExp(String.raw`^\s*(?:${classificationMarkerSource}\s*:?\s*){1,3}$`);
const leadingClassificationBannerPattern = new RegExp(
  String.raw`^(?:[ \t]*${classificationMarkerSource}(?=[\s:])(?:[ \t]*:[ \t]*|[ \t]+)){1,3}`,
  "gm",
);
const clinicalSignalPattern =
  /\b(?:administer|anc|assess|baseline|blood|cease|contraindicat|dose|dosing|ecg|escalat|fbc|level|mg|mcg|mmol|monitor|neutrophil|prescrib|review|risk|symptom|threshold|titrate|toxicity|urgent|withhold|wbc)\b/i;
const provenancePhrasePattern =
  /\b(?:Source mentions|Source excerpt|Source passage|Document title|File name|citation_chunk_id|document_id)\s*:?\s*/gi;
const genericReferencePattern = /\s*(?:[-–]\s*)?refer to MIMS Product Information\.?/gi;
const evidenceLabelPattern =
  /(?:^|[\s.;])(?:dose|table|source|medication|monitoring|threshold|risk|action|documentation)\s+evidence\s*:\s*/gi;
const sourceTitleFragmentPattern =
  /\b(?:[A-Z][A-Za-z0-9/&(),' -]{2,120}\s+)?(?:Guideline|Procedure|Protocol|Policy|Appendix|Scale)\b[^.;]{0,180}/g;
const answerMetaIntroPattern =
  /^(?:the\s+)?(?:retrieved|supplied|provided|indexed)\s+(?:medication\/risk\s+)?(?:sources?|excerpts?|passages?)\s+(?:support|show|suggest|provide|returned)\s+(?:these\s+)?(?:practical\s+)?(?:points?|information|evidence)\.?\s*/i;
const provenanceNoiseTermPattern =
  /\b(?:guideline|procedure|protocol|policy|appendix|source|evidence|document|file|page|scale|lunsers|liverpool university|rating scale|retrieved|excerpt|passage)\b/gi;
const concreteClinicalActionPattern =
  /\b(?:administer|arrange|assess|cease|check|complete|contact|document|escalat|follow\s*up|monitor|notify|record|refer|report|review|stop|withhold|dose|prescrib|titrate|(?:must|should|will)\s+be\s+(?:completed|recorded|documented))\b/i;
// Audit H2: threshold-bearing numerics (unit-bearing figures, ranges,
// comparatives like "8 or below", decimals) mark a fragment as carrying
// clinical VALUES. The noise heuristics below must never drop such a fragment:
// sourceTitleFragmentPattern greedily consumes up to 180 chars after a title
// keyword ("… Scale ranges from 3 to 15 …"), which silently deleted threshold
// sentences. Bare integers ("Appendix 1") deliberately do NOT match, so real
// title noise is still dropped. Falsely keeping noise is cosmetic; falsely
// dropping a threshold is a clinical-safety failure, so this leans generous.
const clinicalThresholdSignalPattern =
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|micrograms?|μg|µg|g|kg|ml|mmol|mol|units?|iu|hours?|hrs?|mins?|minutes?|days?|weeks?|months?|years?|mmhg|bpm|°c)\b|\b\d+(?:[.,]\d+)?\s*%|\b\d+(?:[.,]\d+)?\s*(?:[-–—]|to)\s*\d+(?:[.,]\d+)?\b|(?<![a-z0-9])(?:×|x)10\^?\d*|\b(?:below|above|under|over|at\s+least|at\s+most|more\s+than|less\s+than|greater\s+than|fewer\s+than)\s+\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s+or\s+(?:below|above|less|more|lower|higher|greater|fewer)\b|(?<![vV])\b\d+\.\d+\b/i;

// Typographic ligatures produced by PDF text extraction → plain ASCII letters.
const ligatureReplacements: Array<[RegExp, string]> = [
  [/ﬀ/g, "ff"],
  [/ﬁ/g, "fi"],
  [/ﬂ/g, "fl"],
  [/ﬃ/g, "ffi"],
  [/ﬄ/g, "ffl"],
  [/ﬅ/g, "st"],
  [/ﬆ/g, "st"],
];
// Zero-width / invisible formatting characters that survive extraction.
const invisibleCharacterPattern = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
// Whitespace-like controls (vertical tab, form feed, C1 NEL): these represent
// line/page breaks in extracted PDF text, so they become newlines rather than
// being deleted - deleting would fuse words ("dose\\fmonitoring").
const whitespaceControlPattern = /[\u000B\u000C\u0085]/g;
// Remaining C0/C1 control characters, excluding tab (\u0009) and newline (\u000A).
const controlCharacterPattern = /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F]/g;

// Conservative, lossless repair of PDF-extraction glyph artifacts. Must NEVER
// remove clinical meaning: numbers, units, dose strings, comparison symbols
// (≥ ≤ < > → %), and legitimate bullet structure are all left untouched.
// Line-break hyphenation ("inter-\nvention") is deliberately NOT rejoined: a soft-wrap
// hyphen is indistinguishable from a real compound hyphen (low-dose, twice-daily), so
// fusing would corrupt clinical compounds and verbatim quotes.
// Idempotent — running it twice yields the same result.
export function normalizeExtractedGlyphs(value: string) {
  if (!value) return value;
  let out = value.normalize("NFC").replace(/\r\n?/g, "\n");
  for (const [pattern, replacement] of ligatureReplacements) out = out.replace(pattern, replacement);
  out = out
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(invisibleCharacterPattern, "")
    .replace(whitespaceControlPattern, "\n")
    .replace(controlCharacterPattern, "");
  return out;
}

// Removes PSPF protective-marking banners: lines that are nothing but the
// marking ("OFFICIAL", "OFFICIAL: OFFICIAL") and line-leading marking prefixes
// glued onto content ("OFFICIAL: OFFICIAL Lithium Therapy - …" → "Lithium
// Therapy - …"). Never touches the marker words mid-sentence. Idempotent.
export function stripClassificationBanner(value: string) {
  if (!value) return value;
  return value
    .split("\n")
    .filter((line) => !classificationBannerLinePattern.test(line))
    .join("\n")
    .replace(leadingClassificationBannerPattern, "");
}

function compactWhitespace(value: string) {
  return normalizeExtractedGlyphs(value).replace(/\s+/g, " ").trim();
}

export function readableWhitespace(value: string) {
  return normalizeExtractedGlyphs(value)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractImageBlockField(block: string, field: string) {
  const pattern = new RegExp(
    `${field}:\\s*([\\s\\S]*?)(?:;\\s*[A-Z][A-Za-z _-]{1,40}:|\\s*\\[\\[IMAGE_DATA_END\\]\\])`,
    "i",
  );
  return compactWhitespace(block.match(pattern)?.[1] ?? "");
}

function readableImageBlock(block: string) {
  const title = extractImageBlockField(block, "Table title");
  const label = extractImageBlockField(block, "Table label");
  const description = extractImageBlockField(block, "Description");
  const caption = extractImageBlockField(block, "Caption");

  return compactWhitespace(
    [title ? `Clinical table: ${title}` : "", label && !title ? `Clinical table: ${label}` : "", description || caption]
      .filter(Boolean)
      .join(". "),
  );
}

function tableCells(row: string) {
  return row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => compactWhitespace(cell))
    .filter(Boolean);
}

function isSeparatorRow(cells: string[]) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function readableTableRows(tableText: string) {
  const normalizedRows = tableText
    .replace(/\r?\n/g, " ")
    .replace(/\|\s*\|\s*/g, "||")
    .split(/\s*\|\|\s*/)
    .map((row) => tableCells(row))
    .filter((cells) => cells.length > 0 && !isSeparatorRow(cells));

  if (normalizedRows.length === 0) return "";

  const [headers, ...rows] = normalizedRows;
  if (headers.length === 0) return "";
  if (rows.length === 0) return headers.join(" | ");

  return [
    headers.join(" | "),
    ...rows.slice(0, 8).map((row) => {
      const first = row[0] ?? "Row";
      const details = row
        .slice(1)
        .map((cell, index) => {
          const header = headers[index + 1];
          return header ? `${header}: ${cell}` : cell;
        })
        .join("; ");
      return details ? `- ${first}: ${details}` : `- ${first}`;
    }),
  ].join("\n");
}

function readableImageBlockForViewer(block: string) {
  const title = extractImageBlockField(block, "Table title");
  const label = extractImageBlockField(block, "Table label");
  const description = extractImageBlockField(block, "Description");
  const caption = extractImageBlockField(block, "Caption");
  const tableText = extractImageBlockField(block, "Table text");
  const intro = compactWhitespace(
    [title || label ? `Clinical table: ${title || label}` : "", description || caption].filter(Boolean).join(". "),
  );
  const table = readableTableRows(tableText);

  return readableWhitespace([intro, table].filter(Boolean).join("\n\n"));
}

function tokenCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function stripLowYieldLines(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => {
      const normalized = compactWhitespace(line);
      if (!normalized) return true;
      if (classificationBannerLinePattern.test(normalized)) return false;
      const isControlLine = sourceControlLinePattern.test(normalized);
      const hasSourceMarker =
        sourceDocumentCodeTestPattern.test(normalized) || pageBoilerplateTestPattern.test(normalized);
      // H2 (line-level): extraction glues control markers ("Document owner:",
      // "review date") onto body text, and several callers compact the whole
      // excerpt to a single line before this filter runs — so dropping the
      // line deletes clinical content along with the marker. A line carrying
      // threshold-bearing values ("8 or below", "3 to 15") must survive even
      // when it lacks a clinical keyword, same generous bias as the
      // fragment-level rescue below.
      const hasClinicalSignal =
        clinicalSignalPattern.test(normalized) || clinicalThresholdSignalPattern.test(normalized);
      if (isControlLine && !hasClinicalSignal) return false;
      if (hasSourceMarker && normalized.length <= 140 && !hasClinicalSignal) return false;
      return true;
    })
    .join("\n");
}

export function hasClinicalContentSignal(value: string) {
  return clinicalSignalPattern.test(value) || clinicalThresholdSignalPattern.test(value);
}

export function stripLowYieldSourceNoise(text: string) {
  return (
    stripLowYieldLines(text)
      .replace(leadingClassificationBannerPattern, "")
      .replace(internalImageTokenPattern, " ")
      .replace(sourceTitleWithCodePattern, " ")
      .replace(sourceDocumentCodePattern, " ")
      .replace(pageBoilerplatePattern, " ")
      .replace(provenancePhrasePattern, " ")
      .replace(evidenceLabelPattern, " ")
      .replace(genericReferencePattern, "")
      .replace(/\b(?:chunk|similarity)\s+\d+(?:\.\d+)?\b/gi, " ")
      .replace(/\s+([,.;:])/g, "$1")
      // Collapse doubled dots mid-text, but keep a trailing "..." — that is a
      // stored truncation marker repairTruncatedCompactTail needs to see. The
      // lookahead excludes dots so backtracking can't shave a trailing ellipsis
      // down to ".." and still match.
      .replace(/(?:\.\s*){2,}(?=[^.\s])/g, ". ")
  );
}

export function lowYieldSourceNoiseScore(text: string) {
  const originalTokens = tokenCount(compactWhitespace(text));
  if (!originalTokens) return 0;
  const cleanedTokens = tokenCount(compactWhitespace(stripLowYieldSourceNoise(text)));
  const sourceMarkerCount =
    (text.match(sourceDocumentCodePattern) ?? []).length + (text.match(pageBoilerplatePattern) ?? []).length;
  const removedRatio = Math.max(0, originalTokens - cleanedTokens) / originalTokens;
  return Math.max(0, Math.min(1, removedRatio + Math.min(0.35, sourceMarkerCount * 0.12)));
}

export function sourceTextForClinicalProse(text: string) {
  return compactWhitespace(stripLowYieldSourceNoise(stripInternalImageDataBlocks(text)));
}

/**
 * Produces clinical prose with meaningful line breaks preserved.
 *
 * @returns The cleaned text with normalized whitespace and low-yield source noise removed.
 */
export function sourceTextForClinicalProsePreservingBreaks(text: string) {
  return readableWhitespace(stripLowYieldSourceNoise(sourceTextForDisplayPreservingBreaks(text)));
}

// Lossless display normalization for server-`preformatted` answers (document
// support lists, table/visual source references). These are well-formed by
// construction and their "source-noise"-looking tokens — facility codes like
// "MP-0123", all-caps guideline titles — ARE the payload, so the noise-stripping
// prose sanitizer must NOT run on them (it would delete the document names and
// leave garble). Apply only glyph repair + whitespace collapse, matching the
// server's own `finalizeRagAnswerQuality` exemption for `preformatted && grounded`.
// When preserveBold is false, strip **bold** markers so literal Markdown markers
/**
 * Normalizes preformatted text for display while preserving its readable structure.
 *
 * @param options - Controls whether Markdown bold markers are preserved.
 * @returns The normalized text, with bold markers removed unless `preserveBold` is `true`.
 */
export function normalizePreformattedDisplayText(text: string, options: { preserveBold?: boolean } = {}) {
  const normalized = readableWhitespace(text);
  return options.preserveBold ? normalized : normalized.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * Determines whether source text contains little clinically useful content.
 *
 * @param text - Source text to assess.
 * @returns `true` if the text is predominantly source noise or contains only a short remainder, `false` otherwise.
 */
export function isLowYieldClinicalText(text: string) {
  const cleaned = sourceTextForClinicalProse(text);
  if (!cleaned) return true;
  const hasClinicalSignal = clinicalSignalPattern.test(cleaned);
  const hasOnlyShortRemainder = tokenCount(cleaned) <= 5;
  const sourceNoise = lowYieldSourceNoiseScore(text);
  return sourceNoise >= 0.45 && (!hasClinicalSignal || hasOnlyShortRemainder);
}

function sentenceFragments(text: string) {
  return (
    text
      .replace(answerMetaIntroPattern, "")
      // "e.g." and "i.e." do not end a sentence, so the examples after them are judged with it.
      .split(/(?<=[.!?])(?<!\b[Ee]\.[Gg]\.|\b[Ii]\.[Ee]\.)\s+|\s*;\s*/)
      .map((fragment) =>
        compactWhitespace(
          fragment
            .replace(answerMetaIntroPattern, "")
            .replace(evidenceLabelPattern, " ")
            .replace(/^\s*[.;:\-]\s*/, ""),
        ),
      )
      .filter(Boolean)
  );
}

function provenanceNoiseRatio(text: string) {
  const tokens = tokenCount(compactWhitespace(text));
  if (!tokens) return 1;
  const noiseHits = text.match(provenanceNoiseTermPattern)?.length ?? 0;
  return Math.min(1, noiseHits / tokens);
}

function isMostlySourceTitleFragment(text: string) {
  sourceTitleFragmentPattern.lastIndex = 0;
  const sourceTitleLength = (text.match(sourceTitleFragmentPattern) ?? []).join(" ").length;
  if (sourceTitleLength === 0) return false;
  return sourceTitleLength / Math.max(1, text.length) >= 0.38;
}

export function clinicalProseUsefulness(text: string) {
  const cleaned = sourceTextForClinicalProse(text);
  const keptFragments: string[] = [];
  const baselineKeptFragments: string[] = [];
  for (const fragment of sentenceFragments(cleaned)) {
    if (!fragment) continue;
    if (tokenCount(fragment) < 3) continue;
    if (/^the\s+(?:retrieved|supplied|provided|indexed)\s+/i.test(fragment)) continue;
    const hasClinicalSignal = clinicalSignalPattern.test(fragment);
    const hasConcreteClinicalAction = concreteClinicalActionPattern.test(fragment);
    // H2: a fragment carrying threshold-bearing numerics is never dropped by
    // the title/noise heuristics — deleting clinical values is worse than
    // keeping a little provenance noise.
    const hasClinicalThresholdSignal = clinicalThresholdSignalPattern.test(fragment);
    const noiseRatio = provenanceNoiseRatio(fragment);
    const mostlySourceTitle = isMostlySourceTitleFragment(fragment);
    const droppedByBaseline =
      (mostlySourceTitle && !hasConcreteClinicalAction) ||
      (noiseRatio >= 0.28 && !hasConcreteClinicalAction) ||
      (isLowYieldClinicalText(fragment) && !hasConcreteClinicalAction);
    const keptByBaseline = !droppedByBaseline && (hasClinicalSignal || hasConcreteClinicalAction || noiseRatio < 0.16);
    if (!keptByBaseline && !hasClinicalThresholdSignal) continue;
    keptFragments.push(fragment);
    if (keptByBaseline) baselineKeptFragments.push(fragment);
  }
  const textWithoutNoise = readableWhitespace(keptFragments.join(" "));
  const clinicalSignalScore =
    (textWithoutNoise.match(clinicalSignalPattern) ? 1 : 0) +
    (textWithoutNoise.match(concreteClinicalActionPattern) ? 1 : 0) +
    // H2: threshold values ARE clinical signal — text kept purely for its
    // thresholds must still be classifiable as useful.
    (textWithoutNoise.match(clinicalThresholdSignalPattern) ? 1 : 0);
  // Diff-review hardening of H2: the provenance score is computed over the
  // fragments the BASELINE criteria kept. A noise-dense fragment rescued only
  // for its threshold values must not inflate the score past the 0.42
  // usefulness gate — that flipped `useful` to false and made downstream
  // callers (rag-answer-text, ward-output) discard text that previously
  // survived, including its clean actionable sentences.
  const baselineText = readableWhitespace(baselineKeptFragments.join(" "));
  const provenanceScore = provenanceNoiseRatio(baselineText || textWithoutNoise || cleaned);
  return {
    text: textWithoutNoise,
    useful: Boolean(textWithoutNoise && clinicalSignalScore > 0 && provenanceScore < 0.42),
    clinicalSignalScore,
    provenanceScore,
  };
}

export function stripInternalImageDataBlocks(text: string) {
  return compactWhitespace(
    text
      .replace(completeImageDataBlockPattern, " ")
      .replace(trailingImageDataBlockPattern, " ")
      .replace(leadingImageDataBlockRemainderPattern, " ")
      .replace(omittedImageDataBlockPattern, " ")
      .replace(omittedImageDataMarkerPattern, " ")
      .replace(internalImageMetadataPattern, " "),
  );
}

// Exact source quotes keep their WORDING verbatim — no prose-polishing or
// noise-stripping that could add, drop, or reorder words — but they are not
// byte-verbatim: internal image-data blocks are removed, glyph artifacts
// (ligatures, soft hyphens, control chars) are repaired, and whitespace is
// collapsed to single spaces via compactWhitespace (quotes render as one
// continuous quotation, so newline collapse is presentational only; every
// word, hyphen, and punctuation mark is preserved).
export function sourceTextForVerbatimQuote(text: string) {
  return stripInternalImageDataBlocks(text);
}

export function sourceTextForModel(text: string) {
  return compactWhitespace(
    stripLowYieldSourceNoise(
      text
        .replace(completeImageDataBlockPattern, (block) => readableImageBlock(block))
        .replace(trailingImageDataBlockPattern, " ")
        .replace(leadingImageDataBlockRemainderPattern, " ")
        .replace(omittedImageDataBlockPattern, " ")
        .replace(omittedImageDataMarkerPattern, " ")
        .replace(internalImageMetadataPattern, " "),
    ),
  );
}

export function neutralizePromptInstructions(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(
    /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:(?:previous|prior|above)\s+)?instructions?(?:\s+and\s+\w+(?:\s+\d+\s+\w+)?)?/gi,
    "[neutralized-instruction: source instruction removed]",
  );
  cleaned = cleaned.replace(
    /\byou\s+are\s+now\s+an?\s+(?:unrestricted|jailbroken|assistant)(?:\s+\w+){0,3}/gi,
    "[neutralized-instruction: source role-change removed]",
  );
  cleaned = cleaned.replace(
    /\b(?:system|developer)\s+(?:prompt|message|instruction)s?\b/gi,
    "[neutralized-instruction: privileged instruction reference removed]",
  );
  cleaned = cleaned.replace(
    /\b(?:reveal|print|expose|show|leak|return)\s+(?:the\s+)?(?:api\s+key|secret|token|system\s+prompt|developer\s+message|developer\s+instructions?)\b/gi,
    "[neutralized-instruction: secret-exfiltration request removed]",
  );
  cleaned = cleaned.replace(
    /\bfollow\s+(?:these|the|this)\s+instructions?\b/gi,
    "[neutralized-instruction: source instruction removed]",
  );
  cleaned = cleaned.replace(/\bdo\s+not\s+answer\b/gi, "[neutralized-instruction: answer-suppression request removed]");
  // Defense-in-depth widening (threat-model #8). The answerInstructions
  // provenance boundary is the primary defense for the meta-instruction class;
  // these two patterns add belt-and-braces coverage for idioms that carry a
  // near-zero false-positive risk on real clinical prose because they explicitly
  // address the AI/assistant. We deliberately do NOT widen to "additional/new
  // instructions:", "disregard the previous guidance", or bare "do not
  // mention/exceed/administer" — those forms occur legitimately in dosing
  // leaflets and superseding guidelines, so blanking them would corrupt genuine
  // content. The regex is an arms race; the prompt boundary is the durable line.
  cleaned = cleaned.replace(
    /\b(?:note|attention|message|instructions?|instruction|directive|override|reminder|memo)\s+(?:to|for)\s+(?:the\s+|any\s+)?(?:ai|a\.i\.|assistant|assistants|model|llm|language\s+model|chat\s*bot|bot)\b/gi,
    "[neutralized-instruction: AI-directed meta-instruction removed]",
  );
  cleaned = cleaned.replace(
    /\bfrom\s+now\s+on\b[,;]?\s*(?:always\s+|please\s+|you\s+(?:must|should|will|are\s+to)\s+)?[^.\n]{0,40}?\b(?:recommend|say|state|answer|respond|reply|report|mention|claim)\b/gi,
    "[neutralized-instruction: source directive removed]",
  );
  return cleaned;
}

export function sourceTextForModelEvidence(text: string) {
  return neutralizePromptInstructions(sourceTextForModel(text));
}

export function escapeEvidenceFenceSentinels(text: string) {
  return text.replace(evidenceFenceSentinelPattern, (sentinel) => {
    const label = sentinel.slice(3, -3);
    return `[escaped-evidence-fence: ${label}]`;
  });
}

export function fenceSourceEvidence(text: string, kind = "SOURCE_EXCERPT") {
  return `<<<${kind}>>>\n${escapeEvidenceFenceSentinels(text)}\n<<<END_${kind}>>>`;
}

export function sourceTextForDisplay(text: string) {
  return readableWhitespace(stripLowYieldSourceNoise(stripInternalImageDataBlocks(text)));
}

export function sourceTextForDisplayPreservingBreaks(text: string) {
  return readableWhitespace(
    stripLowYieldSourceNoise(
      text
        .replace(completeImageDataBlockPattern, " ")
        .replace(trailingImageDataBlockPattern, " ")
        .replace(leadingImageDataBlockRemainderPattern, " ")
        .replace(omittedImageDataBlockPattern, " ")
        .replace(omittedImageDataMarkerPattern, " ")
        .replace(internalImageMetadataPattern, " "),
    ),
  );
}

// Words that must not be left dangling before an ellipsis: connectors,
// subordinators, and meaning-inverting auxiliaries/negations ("do not…" must
// never become "do…"). Broader than truncateWords' connector list because here
// the preceding token was presumed partial and already dropped.
const unsafeTruncationTailPattern =
  /^(?:or|and|to|with|of|for|the|a|an|until|than|in|on|at|by|not|no|never|nor|do|does|did|is|are|was|were|be|been|being|has|have|had|if|unless|except|without|must|should|shall|may|might|can|cannot|could|will|would|that|which|who|whom|whose|where|when|while|because|since|but|so|then|as|per|via|from|into|onto|during|before|after|between|below|above|under|over|their|its|this|these|those|any|all|each)$/i;

// Repairs text whose stored form was cut mid-word before an ellipsis was glued
// on (the pre-fix retrieval_synopsis truncation: "where poss..."). The final
// token is presumed partial and dropped unless it ends at a natural boundary,
// then the tail walks back past connectors/negations and bare numbers so the
// preview never ends on a misleading stub. Emits " …" (space + ellipsis) —
// which is also the already-repaired marker that keeps this idempotent.
export function repairTruncatedCompactTail(value: string) {
  if (!value || /\s…$/.test(value)) return value;
  const match = value.match(/^([\s\S]*?)\s*(?:\.{3}|…)\s*$/);
  if (!match) return value;
  const words = match[1].trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const last = words[words.length - 1];
  if (/[A-Za-z0-9]$/.test(last)) words.pop();
  // Draining to empty is deliberate: an all-function-word stub ("do not…")
  // is worse than no preview at all.
  while (
    words.length > 0 &&
    (unsafeTruncationTailPattern.test(words[words.length - 1]) ||
      /^[<>≤≥~]?\d[\d.,–—-]*$/.test(words[words.length - 1]))
  ) {
    words.pop();
  }
  return words.length ? `${words.join(" ")} …` : "";
}

// Repairs a stored retrieval_synopsis in place (backfill path): glyph repair,
// protective-marking banner removal per " | "-delimited segment (the synopsis
// prefix format puts the banner mid-string, after "Section: … | Page: N | "),
// and truncated-tail repair. Newly-built synopses already get all of this at
// ingestion; this exists for rows stored before the fix. Idempotent.
export function polishStoredSynopsis(value: string) {
  const segments = normalizeExtractedGlyphs(value)
    .split(/\s*\|\s*/)
    .map((segment) => stripClassificationBanner(segment).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return repairTruncatedCompactTail(segments.join(" | "));
}

// Bullet glyphs (•◦▪‣●) and the PDF/Word sub-bullet rendered as a bare
// lowercase "o" between words become the joiner. A leading bullet is dropped
// outright. Hyphen bullets are left alone — indistinguishable from compound
// hyphens and ranges. The "o" sub-bullet only converts when whitespace-
// delimited, not after a digit ("37 o C" stays), and followed by a
// capitalized token of 2+ chars ("o C" and "blood group o positive" stay).
// A "\n" joiner turns each list item into its own line (extractive-answer
// splitting treats those as fact boundaries); separator joiners get the
// punctuation tidy-up passes, including "Label:; item" → "Label: item".
const inlineBulletGlyphPattern = /\s*[•◦▪‣●]+\s*/g;
// The follower may be a capitalized token or a numeric dose start ("o 25 mg
// nightly"); "37 o C" stays protected by the not-after-a-digit lookbehind
// and by the 2+ char follower requirement (a bare "o C" never matches). A
// chunk or line can also BEGIN with the sub-bullet ("o 12.5 mg twice daily",
// "Dose:\no Start 750 mg"), hence the start/newline alternatives. Lowercase
// followers ("o pregnancy") are deliberately NOT converted: the risk of
// deleting a genuine clinical "o" value outweighs the cosmetic artifact.
// The optional "**" before the follower lets a bolded sub-bullet ("o **Reduce
// dose**") still be recognised when the display path preserves bold markers; a
// superset of the previous match, so non-bold behaviour is unchanged.
const subBulletOGlyphPattern = /(?<=^|[\r\n]|[^\d\s]\s)o(?=\s+(?:\*\*)?(?:\d|[A-Z][a-z0-9]|[A-Z]{2,}))/g;
// Blood-group exemptions: "blood group o RhD negative" / "Blood Type: o
// Negative" (any casing, optional colon), or a bare "group/type o" directly
// followed by an Rh/positive/negative value, keep their lowercase "o" — it
// is the clinical value itself, not a bullet glyph. A non-blood label such
// as "patient group o Adults" or "risk group: o Pregnant patients" still
// converts, so an OCR bullet cannot hide behind an unrelated group/type word.
const bloodLabelTailPattern = /\b(?:blood|abo|rh(?:d)?)\s+(?:group|type):?\s$/i;
const groupTypeLabelTailPattern = /\b(?:group|type):?\s$/i;
// A word qualifying group/type ("risk group:", "test type:") marks a list
// label, not a blood label — its positive/negative items are list content.
const qualifiedGroupTypeTailPattern = /\b[A-Za-z][\w-]*\s+(?:group|type):?\s$/i;
const rhValueHeadPattern = /^\s+(?:\*\*)?rh(?:d)?\b/i;
const posNegValueHeadPattern = /^\s+(?:\*\*)?(?:pos(?:itive)?|neg(?:ative)?)\b/i;
// An entire line that is just the ABO value ("o RhD negative", "o Negative",
// "o Rh positive", "o **RhD negative**", "o **Negative**") — the strongest
// signal that the "o" is the group itself. Bold markers around the value are
// allowed so high-yield emphasis from the server never causes a blood value to
// be misclassified as a bullet.
const standaloneBloodValueLinePattern =
  /^o\s+(?:\*\*)?(?:rh(?:d)?(?:\s+(?:pos(?:itive)?|neg(?:ative)?))?|pos(?:itive)?|neg(?:ative)?)(?:\*\*)?$/i;
const bloodValueWithNounTailLinePattern =
  /^o\s+(?:\*\*)?(?:rh(?:d)?\s+)?(?:pos(?:itive)?|neg(?:ative)?)(?:\*\*)?\s+(?:blood(?!\s+(?:cultures?|tests?|screens?|samples?|results?)\b)|red\s+cells?)\b/i;

/**
 * Replaces OCR-style lowercase `o` sub-bullets while preserving blood-group value text.
 *
 * @param text - Text containing potential OCR sub-bullet markers
 * @param joiner - Text used to replace recognized sub-bullet markers
 * @returns Text with eligible sub-bullet markers replaced
 */
function replaceSubBulletOGlyphs(text: string, joiner: string) {
  return text.replace(subBulletOGlyphPattern, (match, offset: number) => {
    const before = text.slice(0, offset);
    const after = text.slice(offset + match.length);
    if (bloodLabelTailPattern.test(before)) return match;
    if (bloodValueWithNounTailLinePattern.test(text.slice(offset))) return match;
    // A chunk/cell that IS the blood value ("o RhD negative", "o Negative")
    // has no label context at all — but only when the whole line is the
    // value. A positive/negative list ITEM ("o Positive symptoms require
    // urgent review") is a bullet and converts.
    const atItemStart = offset === 0 || text[offset - 1] === "\n" || text[offset - 1] === "\r";
    if (atItemStart) {
      const lineEnd = text.indexOf("\n", offset);
      const lineTail = text.slice(offset, lineEnd === -1 ? text.length : lineEnd).trim();
      if (standaloneBloodValueLinePattern.test(lineTail)) {
        return match;
      }
    }
    if (groupTypeLabelTailPattern.test(before)) {
      // "o Rh…" is a strong blood signal under any group/type label;
      // "o Positive/Negative" counts as a blood value only when the label is
      // an unqualified (or blood-qualified) group/type.
      if (rhValueHeadPattern.test(after)) return match;
      if (posNegValueHeadPattern.test(after) && !qualifiedGroupTypeTailPattern.test(before)) return match;
    }
    return joiner;
  });
}

export function normalizeInlineBulletGlyphs(text: string, options: { joiner?: string } = {}): string {
  const joiner = options.joiner ?? "; ";
  const replaced = replaceSubBulletOGlyphs(
    text.replace(/^\s*[•◦▪‣●]+\s*/, "").replace(inlineBulletGlyphPattern, joiner),
    joiner,
  );
  if (joiner.includes("\n")) {
    return replaced
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }
  return replaced
    .replace(/^[;\s]+/, "")
    .replace(/\n[ \t]*;[ \t]*/g, "\n")
    .replace(/[ \t]+([,.;:])/g, "$1")
    .replace(/;(?:\s*;)+/g, ";")
    .replace(/:\s*;/g, ":")
    .replace(/[ \t]{2,}/g, " ");
}

export function sourceTextForCompactDisplay(text: string) {
  return repairTruncatedCompactTail(
    readableWhitespace(
      normalizeInlineBulletGlyphs(
        sourceTextForDisplayPreservingBreaks(text)
          .replace(
            /(?:^|\n)\s*(?:source|sources|citation|citations|document|file|filename|chunk|page|image|provenance|retrieved|indexed)\s*(?:id|ids|index|number|path)?\s*[:#=-]\s*[^\n]+/gi,
            " ",
          )
          .replace(/\b(?:clinical table|table text|accessible table|image caption|caption|excerpt)\s*[:=-]\s*/gi, " ")
          .replace(/\b(?:source|chunk|document|image)\s*(?:id|index)?\s*[:#=-]?\s*[a-z0-9_-]{8,}\b/gi, " ")
          .replace(/\bpage\s*(?:number)?\s*[:#=-]?\s*(?:n\/a|\d+(?:\s*[-,]\s*\d+)*)\b/gi, " ")
          .replace(/\bchunk\s*(?:index)?\s*[:#=-]?\s*\d+\b/gi, " "),
      ),
    ),
  );
}

export function sourceTextForDocumentViewer(text: string) {
  return readableWhitespace(
    text
      .replace(completeImageDataBlockPattern, (block) => readableImageBlockForViewer(block))
      .replace(trailingImageDataBlockPattern, " ")
      .replace(leadingImageDataBlockRemainderPattern, " ")
      .replace(omittedImageDataBlockPattern, " ")
      .replace(omittedImageDataMarkerPattern, " ")
      .replace(internalImageMetadataPattern, " "),
  );
}

export function sourceTextForIndexedPage(text: string) {
  // normalizeExtractedGlyphs preserves spaces/tabs/newlines, so the fixed-width
  // spacing this viewer path relies on for table parsing survives the repair.
  return normalizeExtractedGlyphs(text)
    .replace(completeImageDataBlockPattern, (block) => readableImageBlockForViewer(block))
    .replace(trailingImageDataBlockPattern, " ")
    .replace(leadingImageDataBlockRemainderPattern, " ")
    .replace(omittedImageDataBlockPattern, " ")
    .replace(omittedImageDataMarkerPattern, " ")
    .replace(internalImageMetadataPattern, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function cleanClinicalSummaryText(text: string) {
  const cleaned = sourceTextForClinicalProsePreservingBreaks(text)
    .replace(/\bSource mentions:\s*/gi, "")
    .replace(
      /(?:\s+-\s*)?(?:Medication point|Dose evidence|Table evidence|Threshold\/action|Risk\/escalation|Workflow step|Section summary|Source point|Monitoring evidence|Monitoring)\s*:\s*/gi,
      ". ",
    )
    .replace(/^\s*(?:[-•]\s+|\*\s+)+/, "")
    .replace(
      /^(?:key\s+(?:practical|clinical|source-backed)\s+points?|high-yield\s+points?|practical\s+points?|clinical\s+summary|document\s+summary|source-backed\s+summary|summary|bottom\s+line|answer)\s*[:\-]\s*/i,
      "",
    )
    .replace(/^\s*[.;:\-]\s*/, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:\.\s*){2,}/g, ". ");

  return readableWhitespace(cleaned);
}
