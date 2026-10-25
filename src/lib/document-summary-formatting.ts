// Client-side "smart summary" formatter for indexing-time document summaries.
//
// Stored `document_summaries.summary` text is LLM-generated at indexing but
// frequently carries PDF-header debris: protective-marking banners glued to a
// document title ("OFFICIAL Guideline Lithium Therapy … Reference #: …"),
// Scope/Site/Disciplines runs, sentences repeated 2-3x, inline numbered
// headings ("1. Introduction"), and a mid-word truncated tail. ~2000 live
// documents already have these summaries stored, so the repair has to happen
// at display time — this module turns the raw string into a structured,
// readable display model without re-indexing and without dropping clinical
// content (same generous keep-bias as source-text-sanitizer's H2 rules).

import {
  cleanClinicalSummaryText,
  hasClinicalContentSignal,
  repairTruncatedCompactTail,
} from "@/lib/source-text-sanitizer";

export type DocumentSummarySection = {
  id: string;
  /** null = un-headed "key points" run before/without any detected heading. */
  heading: string | null;
  items: string[];
};

export type FormattedDocumentSummary = {
  /** Short plain-language opener (first 1-2 sentences). */
  lead: string | null;
  sections: DocumentSummarySection[];
  /** A mid-word trailing fragment was repaired or removed. */
  truncatedTail: boolean;
  isEmpty: boolean;
};

const EMPTY_SUMMARY: FormattedDocumentSummary = {
  lead: null,
  sections: [],
  truncatedTail: false,
  isEmpty: true,
};

// Connector words allowed inside a Title-Case run (document titles, headings).
const titleConnectorPattern = /^(?:and|of|the|for|in|to|with|a|an|or|on|at|&)$/i;

// Boilerplate markers that may open a stored summary. Split into two tiers:
// openers can strip from the very start of a segment; gated markers only strip
// once an opener has already matched, so a genuine sentence like "Fremantle
// Hospital provides…" is never beheaded.
const openerMarkerPatterns: RegExp[] = [
  // Protective-marking banners glued inline ("OFFICIAL", "OFFICIAL: Sensitive").
  /^(?:UNOFFICIAL|OFFICIAL(?:\s*:\s*Sensitive)?|SENSITIVE|PROTECTED)\b:?\s*/,
  // Document-type word immediately followed by a Title-Case run (a title), not
  // by ordinary prose ("Guideline recommendations include…" is left alone).
  /^(?:Clinical\s+)?(?:Guideline|Procedure|Protocol|Policy|Standard|Form)\b:?\s+(?=[A-Z0-9])/,
  /^Reference\s*(?:#|No\.?|Number)?\s*:?\s*[A-Za-z0-9][A-Za-z0-9/-]{3,}\s*/i,
  /^(?:Scope|Applicability|Audience|Target\s+audience)\b:?\s*/,
  /^Service\/Department\/Unit\b:?\s*/i,
  /^Disciplines?\b:?\s*(?=[A-Z])/,
  /^Hospital[- ]Wide\b:?\s*/i,
];

const gatedMarkerPatterns: RegExp[] = [
  /^Site\b:?\s*(?=[A-Z])/,
  // Hospital / health-service proper names ("Fiona Stanley Hospital").
  /^(?:[A-Z][A-Za-z'-]+\s+){1,3}(?:Hospitals?|Health\s+Service|Health\s+Campus)\b\s*/,
  // Discipline lists ("Medical, Nursing, Pharmacy").
  /^(?:Medical|Nursing|Midwifery|Pharmacy|Medicine|Dental|Allied\s+Health)(?:\s*[,&]\s*(?:Medical|Nursing|Midwifery|Pharmacy|Medicine|Dental|Allied\s+Health))*\b,?\s*/,
];

// A Title-Case run that leads straight into a boilerplate marker is the glued
// document title ("Lithium Therapy - Initiation and Continuation Reference #:").
const bridgeToMarkerPattern =
  /^[A-Z][^.!?]{0,140}?(?=(?:Reference\s*(?:#|No\.?|Number)?\s*:|Scope\b|Service\/Department\/Unit\b|Disciplines?\b|Hospital[- ]Wide\b))/;

function startsWithBoilerplateMarker(value: string) {
  return (
    openerMarkerPatterns.some((pattern) => pattern.test(value)) ||
    gatedMarkerPatterns.some((pattern) => pattern.test(value))
  );
}

// Strips a *leading* run of document-header boilerplate from a summary segment.
// Only ever eats from the front; never drops text carrying clinical signal
// (thresholds, action verbs) and reverts entirely if it would leave nothing.
// Idempotent: a stripped segment no longer starts with any marker.
export function stripSummaryBoilerplate(text: string): string {
  const input = text.trimStart();
  let out = input;
  let consumedMarker = false;
  let guard = 0;

  stripping: while (out && guard < 40 && input.length - out.length <= 600) {
    guard += 1;
    for (const pattern of openerMarkerPatterns) {
      const match = out.match(pattern);
      if (match && match[0]) {
        out = out.slice(match[0].length).trimStart();
        consumedMarker = true;
        continue stripping;
      }
    }
    if (consumedMarker) {
      for (const pattern of gatedMarkerPatterns) {
        const match = out.match(pattern);
        if (match && match[0]) {
          out = out.slice(match[0].length).trimStart();
          continue stripping;
        }
      }
    }

    const bridge = out.match(bridgeToMarkerPattern);
    if (bridge && bridge[0] && !hasClinicalContentSignal(bridge[0])) {
      out = out.slice(bridge[0].length).trimStart();
      consumedMarker = true;
      continue;
    }

    if (consumedMarker) {
      // Leftover proper-noun run (site names, discipline words). Consume one
      // Title-Case token at a time, but stop at the token that starts a real
      // clause — a Title-Case word followed by lowercase prose ("Lithium is…").
      const token = out.match(/^([A-Z][A-Za-z'()/-]*)([,&/]\s*|\s+|-\s*)/);
      if (token) {
        const rest = out.slice(token[0].length);
        const nextIsTitleCase = /^(?:[A-Z]|(?:and|of|the|for|&)\s+[A-Z])/.test(rest);
        if (nextIsTitleCase && !hasClinicalContentSignal(token[1])) {
          out = rest.trimStart();
          continue;
        }
      }
    }
    break;
  }

  // Safety: if stripping consumed essentially everything, the heuristics were
  // wrong for this text — keep the original rather than losing content.
  if (out.length < 40 && input.length >= 80) return input;
  return out;
}

// Sentence split that survives abbreviations, initials, and numbered
// cross-references ("section 1.9. Therapeutic…"). Lowercase continuations are
// split too: stored summaries drop capitals when passages are glued together.
const sentenceSplitPattern =
  /(?<=[.!?])(?<!\d\.)(?<!\b[A-Z]\.)(?<!\b(?:e\.g|i\.e|etc|cf|vs|viz|approx|resp|incl|no)\.)\s+(?=[A-Za-z0-9("'])/;

function splitSentences(text: string): string[] {
  return text
    .split(sentenceSplitPattern)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizeSentenceKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRepeatKey(existing: string, key: string) {
  return (
    existing === key ||
    (key.length >= 40 && existing.includes(key)) ||
    (existing.length >= 40 && key.includes(existing))
  );
}

// A later, complete sentence that continues a kept one extends it — it adds the
// threshold or action ("… and withhold if the level is above 1.5 mmol/L") — so
// it replaces the shorter one rather than being dropped. Only a continuation
// counts: a repeat with running-header text glued in front is not an extension,
// and a sentence cut off mid-thought never replaces a complete one.
function extendsKept(existing: string, key: string, sentence: string) {
  return key.length > existing.length && key.startsWith(existing) && /[.!?:;)\]"']$/.test(sentence.trim());
}

// Drops exact repeats and long (>=40-char key) containment repeats, keeping the
// first occurrence's position — stored summaries frequently repeat whole
// passages 2-3x. Where the repeat extends the kept sentence, the longer wins.
export function dedupeSummarySentences(sentences: string[]): string[] {
  const kept: string[] = [];
  const keys: string[] = [];
  for (const sentence of sentences) {
    const key = normalizeSentenceKey(sentence);
    if (!key) continue;
    const index = keys.findIndex((existing) => isRepeatKey(existing, key));
    if (index === -1) {
      kept.push(sentence);
      keys.push(key);
    } else if (extendsKept(keys[index], key, sentence)) {
      kept[index] = sentence;
      keys[index] = key;
    }
  }
  return kept;
}

// Inline numbered headings ("1. Introduction", "2.7. Dosage (as lithium
// carbonate)") glued into the flowing summary text. Only at a sentence
// boundary, and never after cross-reference words ("refer to section 1.9.").
const inlineHeadingPattern =
  /(?<=^|[.!?:]\s{1,3})(?<!(?:section|sections|see|refer\s+to|under|per|item|step|table|appendix|page)\s{1,3})(\d{1,2}(?:\.\d{1,2})*)\.?\s+(?=[A-Z])/g;

type HeadingSplit = { heading: string; remainder: string };

// Extracts the heading text from the Title-Case run following a heading
// number. The run's last token is returned to the body when it starts a real
// clause ("1. Introduction Lithium has…" → heading "Introduction", body
// "Lithium has…"). Stops early at boilerplate markers so glued Scope/Site runs
// stay in the body where stripSummaryBoilerplate can remove them.
function extractHeadingText(text: string): HeadingSplit {
  const tokenPattern = /^(\([^()]{0,60}\)|[A-Z][A-Za-z'/-]*|&)(\s+|$)/;
  const consumed: string[] = [];
  let rest = text;

  while (consumed.length < 8 && consumed.join(" ").length < 70) {
    if (startsWithBoilerplateMarker(rest)) break;
    const connector = rest.match(/^(and|of|the|for|in|to|with|a|an|or|on|at)\s+(?=[A-Z(])/);
    if (connector && consumed.length > 0) {
      consumed.push(connector[1]);
      rest = rest.slice(connector[0].length);
      continue;
    }
    const token = rest.match(tokenPattern);
    if (!token) break;
    consumed.push(token[1]);
    rest = rest.slice(token[0].length);
  }

  // Give the clause subject back to the body: "… Monitoring Serum lithium
  // levels should …" keeps "Serum" with the sentence, not the heading. When
  // that empties the heading ("3. Lithium toxicity risk increases…"), the
  // caller treats the segment as ordinary text rather than mangling it.
  if (consumed.length >= 1 && /^[a-z]/.test(rest)) {
    const last = consumed[consumed.length - 1];
    if (/^[A-Z]/.test(last)) {
      consumed.pop();
      rest = `${last} ${rest}`;
    }
  }

  // Trim trailing connectors left dangling by the give-back.
  while (consumed.length && titleConnectorPattern.test(consumed[consumed.length - 1])) {
    rest = `${consumed.pop()} ${rest}`;
  }

  return { heading: consumed.join(" ").trim(), remainder: rest.trim() };
}

function sectionIdFrom(heading: string | null, index: number) {
  if (!heading) return `summary-section-${index}`;
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug ? `summary-${slug}` : `summary-section-${index}`;
}

type RawSection = { heading: string | null; text: string };

function splitIntoRawSections(text: string): RawSection[] {
  const sections: RawSection[] = [];
  let lastIndex = 0;
  let currentHeading: string | null = null;

  for (const match of text.matchAll(inlineHeadingPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex < lastIndex) continue; // Inside heading text already consumed.
    const after = text.slice(matchIndex + match[0].length);
    const { heading, remainder } = extractHeadingText(after);

    if (!heading) continue; // Not a confident heading — leave the text in place.

    sections.push({ heading: currentHeading, text: text.slice(lastIndex, matchIndex).trim() });
    currentHeading = heading;
    // The input is whitespace-collapsed, so the remainder (including any
    // clause-subject give-back) is an exact suffix of `after`.
    lastIndex = matchIndex + match[0].length + (after.length - remainder.length);
  }
  sections.push({ heading: currentHeading, text: text.slice(lastIndex).trim() });

  return sections.filter((section) => section.heading !== null || section.text.length > 0);
}

export function formatDocumentSummary(raw: string | null | undefined): FormattedDocumentSummary {
  if (!raw || !raw.trim()) return EMPTY_SUMMARY;

  // The stored-summary truncation signal is a trailing ellipsis on the RAW text
  // (the pre-fix retrieval_synopsis cut, e.g. "where poss..."). The sanitizer
  // below normalizes that ellipsis into ". ", so capture it first — a complete
  // final sentence that merely lacks punctuation has no raw ellipsis and must
  // never be treated as truncated.
  const rawEndedTruncated = /(?:\.{3}|…)\s*$/.test(raw.trim());

  // Reuse the house sanitizer first (glyph repair, protective markings, source
  // codes, label noise), then flatten to a single line for sentence work.
  const cleaned = cleanClinicalSummaryText(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return EMPTY_SUMMARY;

  const stripped = stripSummaryBoilerplate(cleaned);
  const rawSections = splitIntoRawSections(stripped);

  // Assemble sections with global sentence dedupe (repeats cross section
  // boundaries in stored summaries) and per-section boilerplate stripping
  // (running headers re-glue after inline headings).
  const seen: Array<{ key: string; sentence: string }> = [];
  const seenHeadings = new Map<string, DocumentSummarySection>();
  const orderedSections: DocumentSummarySection[] = [];
  let truncatedTail = false;

  const keepNewSentences = (text: string) => {
    const sentences = dedupeSummarySentences(splitSentences(text));
    const fresh: string[] = [];
    for (const sentence of sentences) {
      const key = normalizeSentenceKey(sentence);
      if (!key) continue;
      const earlier = seen.find((entry) => isRepeatKey(entry.key, key));
      if (!earlier) {
        fresh.push(sentence);
        seen.push({ key, sentence });
        continue;
      }
      if (!extendsKept(earlier.key, key, sentence)) continue;
      // Replace the shorter sentence where it was kept, in an earlier section
      // or earlier in this one.
      for (const items of [...orderedSections.map((section) => section.items), fresh]) {
        const position = items.indexOf(earlier.sentence);
        if (position === -1) continue;
        items[position] = sentence;
        break;
      }
      earlier.key = key;
      earlier.sentence = sentence;
    }
    return fresh;
  };

  for (const rawSection of rawSections) {
    const body = rawSection.heading === null ? rawSection.text : stripSummaryBoilerplate(rawSection.text);
    const items = keepNewSentences(body);
    if (!items.length && !rawSection.heading) continue;

    const headingKey = rawSection.heading ? normalizeSentenceKey(rawSection.heading) : null;
    if (headingKey && seenHeadings.has(headingKey)) {
      const existing = seenHeadings.get(headingKey)!;
      existing.items.push(...items);
      continue;
    }

    const section: DocumentSummarySection = {
      id: sectionIdFrom(rawSection.heading, orderedSections.length),
      heading: rawSection.heading,
      items,
    };
    orderedSections.push(section);
    if (headingKey) seenHeadings.set(headingKey, section);
  }

  // Repair or drop a tail cut mid-thought at indexing. Two truncation signals,
  // both conservative so a complete, unique final sentence that merely lacks
  // punctuation is never dropped or mis-flagged:
  //   (a) the RAW stored summary ended with an ellipsis marker (captured above,
  //       before the sanitizer normalized it into a plain period); or
  //   (b) the final sentence is a prefix of another kept sentence — a cut-off
  //       repeat, e.g. "Lithium is a narro" vs "Lithium is a narrow … drug".
  for (let index = orderedSections.length - 1; index >= 0; index -= 1) {
    const items = orderedSections[index].items;
    if (!items.length) continue;
    const last = items[items.length - 1];
    const endsCleanly = /[.!?:;)\]"']$/.test(last.trim());
    const lastKey = normalizeSentenceKey(last);
    const isTruncatedDuplicate =
      !endsCleanly &&
      lastKey.length >= 8 &&
      orderedSections.some((section) =>
        section.items.some((other) => {
          if (other === last) return false;
          const otherKey = normalizeSentenceKey(other);
          return otherKey.length > lastKey.length && otherKey.startsWith(lastKey);
        }),
      );
    if (!rawEndedTruncated && !isTruncatedDuplicate) break;
    // Strip any terminal dots/ellipsis the sanitizer left (ASCII "..." or a
    // Unicode "…"), then re-mark so repairTruncatedCompactTail drops the partial
    // final token exactly once (avoids a doubled "… …").
    const base = last.replace(/[.\s…]+$/, "");
    const repaired = repairTruncatedCompactTail(`${base} ...`);
    truncatedTail = true;
    if (repaired && repaired.split(/\s+/).length >= 5) {
      items[items.length - 1] = repaired;
    } else {
      items.pop();
    }
    break;
  }

  const sections = orderedSections.filter((section) => section.items.length > 0);
  if (!sections.length) return { ...EMPTY_SUMMARY, truncatedTail };

  // Lead: first 1-2 sentences of the first un-headed section.
  let lead: string | null = null;
  if (sections[0].heading === null) {
    const first = sections[0];
    const leadItems: string[] = [];
    while (first.items.length && leadItems.length < 2 && leadItems.join(" ").length + first.items[0].length <= 300) {
      leadItems.push(first.items.shift()!);
    }
    if (!leadItems.length && first.items.length) leadItems.push(first.items.shift()!);
    lead = leadItems.join(" ") || null;
  }

  const finalSections = sections.filter((section) => section.items.length > 0);
  return {
    lead,
    sections: finalSections,
    truncatedTail,
    isEmpty: !lead && finalSections.length === 0,
  };
}
