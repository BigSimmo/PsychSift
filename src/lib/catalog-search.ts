// Shared search primitives for the registry catalogs (medications, services, forms,
// differentials, tools). Before this module each domain re-implemented its own text
// normalizer (with divergent regexes, so the same query tokenized differently per domain)
// and its own weighted includes() ranker. The domain rankers are thin wrappers over
// rankCatalogRecords with their historical field weights; the wrapper owns its reason
// labels and match shape so existing API/UI contracts are unchanged.

import { matchesTermInWords, wordBoundaryWords } from "@/lib/keyword-query";

// Canonical normalizer (the medications implementation — the superset of the retired
// services/forms variants: NFKD + diacritic strip, and `+ . / -` survive so dose strings
// ("5+5", "0.5mg", "IM/PO") and hyphenated clinical terms stay searchable).
export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactSearchText(value: string) {
  return value.replace(/\s+/g, "");
}

/**
 * Whole-word/whole-phrase containment for an already-normalized haystack and
 * term (both produced by `normalizeSearchText`, so words are single-space
 * separated). Plain `.includes()` on a short extracted subject term (e.g.
 * "ect") false-positives inside unrelated words (e.g. "effects"); padding
 * both sides with a space anchors the match to word boundaries, and works
 * unchanged for multi-word phrase terms.
 */
export function includesWholeTerm(haystack: string, term: string) {
  if (!term) return false;
  return ` ${haystack} `.includes(` ${term} `);
}

function typoDistanceLimit(term: string) {
  // One edit recovers common clinical typos without allowing exact long drug
  // names to cross-match distinct catalogue entries (for example fluoxetine
  // and duloxetine, or prednisone and prednisolone).
  if (term.length >= 5) return 1;
  // Four-character clinical abbreviations (SSRI/SNRI, ADHD/ODD, etc.) are
  // often one edit apart; require five characters before allowing a typo.
  return 0;
}

/** Bounded Damerau-Levenshtein distance for conservative catalogue typo recovery. */
function boundedTypoDistance(left: string, right: string, limit: number) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let previousPrevious: number[] | undefined;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      let distance = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      if (
        previousPrevious &&
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2] + 1);
      }
      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > limit) return limit + 1;
    previousPrevious = previous.slice();
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

const textWordBoundaryCache = new Map<string, string[]>();
function getCachedWordBoundaryWords(text: string): string[] {
  let words = textWordBoundaryCache.get(text);
  if (!words) {
    if (textWordBoundaryCache.size > 2000) textWordBoundaryCache.clear();
    words = wordBoundaryWords(text);
    textWordBoundaryCache.set(text, words);
  }
  return words;
}

const textUniqueWordsCache = new Map<string, string[]>();
function getCachedUniqueWords(text: string): string[] {
  let words = textUniqueWordsCache.get(text);
  if (!words) {
    if (textUniqueWordsCache.size > 2000) textUniqueWordsCache.clear();
    words = Array.from(new Set(normalizeSearchText(text).split(/\s+/).filter(Boolean)));
    textUniqueWordsCache.set(text, words);
  }
  return words;
}

const compactTextCache = new Map<string, string>();
function getCachedCompactText(text: string): string {
  let compact = compactTextCache.get(text);
  if (!compact) {
    if (compactTextCache.size > 2000) compactTextCache.clear();
    compact = compactSearchText(text);
    compactTextCache.set(text, compact);
  }
  return compact;
}

function fuzzyTokensAgainstWords(
  queryTokens: readonly string[],
  words: readonly string[],
  typoCache?: Map<string, boolean>,
) {
  if (queryTokens.length === 0 || words.length === 0) return [];
  return queryTokens.filter((term) => {
    if (words.some((word) => word.includes(term))) return false;
    const limit = typoDistanceLimit(term);
    if (limit <= 0) return false;
    return words.some((word) => {
      if (Math.abs(term.length - word.length) > limit) return false;
      if (typoCache) {
        const key = `${term}:${word}`;
        let match = typoCache.get(key);
        if (match === undefined) {
          match = boundedTypoDistance(term, word, limit) <= limit;
          typoCache.set(key, match);
        }
        return match;
      }
      return boundedTypoDistance(term, word, limit) <= limit;
    });
  });
}

/** The query half of a fuzzy comparison, which is constant for a whole ranking run. */
function fuzzyQueryTokens(query: string) {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

/**
 * Number of the given query tokens with a conservative near-word match in `text`.
 *
 * Split from `fuzzySearchTokens` so `rankCatalogRecords` can tokenize the query
 * once per search instead of once per record per field: the query does not change
 * while ranking, and re-normalizing it for every haystack was the single largest
 * cost in a catalogue search profile.
 */
function fuzzyTokensAgainstText(queryTokens: readonly string[], text: string, typoCache?: Map<string, boolean>) {
  const words = getCachedUniqueWords(text);
  return fuzzyTokensAgainstWords(queryTokens, words, typoCache);
}

/** Number of query tokens with a conservative near-word match in normalized text. */
function fuzzySearchTokens(query: string, text: string) {
  return fuzzyTokensAgainstText(fuzzyQueryTokens(query), text);
}

export function fuzzySearchTokenCount(query: string, text: string) {
  return fuzzySearchTokens(query, text).length;
}

export type CatalogField<T> = {
  // Wrapper-facing key used to build human-readable reasons (e.g. "title", "contact").
  id: string;
  weight: number;
  text: (record: T) => string;
};

export type CatalogMatchSignals = {
  // Literal or conservative fuzzy matched term count per field id
  // (only fields with at least one match are present).
  fields: Record<string, number>;
  // Matched term count against the full-text haystack.
  content: number;
  // Matched term count for terms introduced by expandTokens (e.g. symptom
  // aliases) that were not part of the raw query.
  expanded: number;
  fuzzy: number;
  compact: boolean;
  phrase: boolean;
  prefix: boolean;
  exact: boolean;
  broad: boolean;
};

export type CatalogRankedMatch<T> = {
  record: T;
  score: number;
  signals: CatalogMatchSignals;
};

export type RankCatalogOptions<T> = {
  fields: Array<CatalogField<T>>;
  // The widest haystack for the record; also the compact-match haystack.
  fullText: (record: T) => string;
  contentWeight?: number;
  // Compact-query bonus (query with spaces removed found in the compacted haystack).
  // 0 disables. compactExtraText widens the compact haystack (e.g. compacted title).
  compactBonus?: number;
  compactMinLength?: number;
  compactExtraText?: (record: T) => string;
  // Whole normalized query found in the full text.
  phraseBonus?: number;
  // Values compared for exact equality with the normalized query (title/slug).
  exactValues?: (record: T) => string[];
  exactBonus?: number;
  // Values checked for a starts-with match on the normalized query (partial
  // typing of a name). 0 disables.
  prefixValues?: (record: T) => string[];
  prefixBonus?: number;
  prefixMinLength?: number;
  // Catalogue-wide "broad intent" terms ("forms", "services") granting a flat bonus.
  broadTerms?: string[];
  broadBonus?: number;
  // Token expansion hook (differential alias table). Receives the deduped query terms.
  expandTokens?: (terms: string[]) => string[];
  // Optional extra weight for specific multi-word expansion phrases. This is
  // useful when a complete governed phrase is stronger than several generic
  // one-word matches in long catalogue records.
  expandedPhraseBonus?: number;
  limit?: number;
  // Defaults to input order (stable) when omitted.
  tieBreak?: (left: T, right: T) => number;
};

export function rankCatalogRecords<T>(
  records: T[],
  query: string,
  options: RankCatalogOptions<T>,
): Array<CatalogRankedMatch<T>> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const contentWeight = options.contentWeight ?? 2;
  const compactBonus = options.compactBonus ?? 0;
  const compactMinLength = options.compactMinLength ?? 4;
  const phraseBonus = options.phraseBonus ?? 4;
  const exactBonus = options.exactBonus ?? 10;
  const prefixBonus = options.prefixBonus ?? 0;
  const prefixMinLength = options.prefixMinLength ?? 3;
  const broadBonus = options.broadBonus ?? 1;
  const expandedPhraseBonus = options.expandedPhraseBonus ?? 0;

  const compactQuery = compactSearchText(normalizedQuery);
  // `normalizedQuery` is already normalized and `normalizeSearchText` is idempotent
  // (pinned by tests/catalog-search-query-tokens.test.ts), so these tokens are exactly
  // what each per-record fuzzy call used to recompute for itself.
  const fuzzyTokens = fuzzyQueryTokens(normalizedQuery);
  const baseTerms = Array.from(new Set(normalizedQuery.split(/\s+/).filter((term) => term.length > 1)));
  const terms = options.expandTokens
    ? Array.from(new Set(options.expandTokens(baseTerms).filter((term) => term.length > 1)))
    : baseTerms;
  const baseTermSet = new Set(baseTerms);
  const expandedTerms = terms.filter((term) => !baseTermSet.has(term));
  const broad = Boolean(options.broadTerms?.length && terms.some((term) => options.broadTerms!.includes(term)));

  const recordFullTextCache = new WeakMap<object, string>();
  function getRecordFullText<T>(record: T, fullTextFn: (r: T) => string): string {
    if (record && typeof record === "object") {
      let cached = recordFullTextCache.get(record);
      if (!cached) {
        cached = fullTextFn(record);
        recordFullTextCache.set(record, cached);
      }
      return cached;
    }
    return fullTextFn(record);
  }

  const recordFieldTextCache = new WeakMap<object, Map<string, string>>();
  function getRecordFieldText<T>(record: T, fieldId: string, textFn: (r: T) => string): string {
    if (record && typeof record === "object") {
      let map = recordFieldTextCache.get(record);
      if (!map) {
        map = new Map();
        recordFieldTextCache.set(record, map);
      }
      let text = map.get(fieldId);
      if (text === undefined) {
        text = textFn(record);
        map.set(fieldId, text);
      }
      return text;
    }
    return textFn(record);
  }

  const typoCache = new Map<string, boolean>();

  const ranked = records
    .map((record, index) => {
      const text = getRecordFullText(record, options.fullText);
      const fields: Record<string, number> = {};
      let score = 0;
      let fuzzy = 0;
      const compact =
        compactBonus > 0 &&
        compactQuery.length >= compactMinLength &&
        (getCachedCompactText(text).includes(compactQuery) ||
          (options.compactExtraText
            ? getCachedCompactText(getRecordFieldText(record, "__compact_extra__", options.compactExtraText)).includes(
                compactQuery,
              )
            : false));

      for (const field of options.fields) {
        const haystack = getRecordFieldText(record, field.id, field.text);
        if (!haystack) continue;
        // Fields are the high-weight name/title/tag signals, so a term must
        // align with a word boundary — substring hits ("renal" inside
        // "adrenaline") stay confined to the low-weight content haystack.
        // Split the field haystack once, then test every term against it.
        const haystackWords = getCachedWordBoundaryWords(haystack);
        const matched = terms.filter((term) => matchesTermInWords(haystackWords, term)).length;
        if (matched) {
          fields[field.id] = matched;
          score += matched * field.weight;
        }

        // A typo in a title/name/code field must retain that field's weight.
        // Otherwise an intended record ties incidental full-text mentions and
        // a limited universal-search result can omit the best match entirely.
        const fuzzyFieldMatches = compact ? 0 : fuzzyTokensAgainstText(fuzzyTokens, haystack, typoCache).length;
        if (fuzzyFieldMatches) {
          fields[field.id] = (fields[field.id] ?? 0) + fuzzyFieldMatches;
        }
        fuzzy += fuzzyFieldMatches;
        score += fuzzyFieldMatches * field.weight;
      }

      const content = terms.filter((term) => text.includes(term)).length;
      score += content * contentWeight;

      const expanded = expandedTerms.filter((term) => text.includes(term)).length;
      const expandedPhrases = expandedTerms.filter((term) => term.includes(" ") && text.includes(term)).length;
      score += expandedPhrases * expandedPhraseBonus;
      const fuzzyContentFallback =
        !compact && fuzzy === 0 ? fuzzyTokensAgainstText(fuzzyTokens, text, typoCache).length : 0;
      fuzzy += fuzzyContentFallback;
      // Broad full-text fuzzy evidence is only a fallback and stays weaker than
      // literal content or a weighted field match.
      score += fuzzyContentFallback * Math.max(1, contentWeight * 0.5);

      if (compact) score += compactBonus;

      const phrase = phraseBonus > 0 && text.includes(normalizedQuery);
      if (phrase) score += phraseBonus;

      const exact = Boolean(options.exactValues?.(record).some((value) => value === normalizedQuery));
      if (exact) score += exactBonus;

      const prefix =
        prefixBonus > 0 &&
        normalizedQuery.length >= prefixMinLength &&
        Boolean(options.prefixValues?.(record).some((value) => value.startsWith(normalizedQuery)));
      if (prefix) score += prefixBonus;

      if (broad) score += broadBonus;

      return {
        record,
        index,
        score,
        signals: {
          fields,
          content,
          expanded,
          fuzzy,
          compact,
          phrase,
          prefix,
          exact,
          broad,
        } satisfies CatalogMatchSignals,
      };
    })
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (options.tieBreak ? options.tieBreak(left.record, right.record) : left.index - right.index),
    )
    .map(({ record, score, signals }) => ({ record, score, signals }));

  return options.limit !== undefined ? ranked.slice(0, options.limit) : ranked;
}
