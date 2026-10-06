import { documentCitationHref, formatCitationLabel } from "@/lib/citations";
import { queryCoreTerms } from "@/lib/evidence-relevance";
import { sanitizeAnswerText } from "@/lib/rag/rag-answer-text";
import type {
  ClientCitation,
  ClientRagAnswerPayload,
  ClientSafetyWarning,
  ClientSearchResult,
} from "@/lib/answer-client-payload";
import {
  clinicalProseUsefulness,
  sourceTextForCompactDisplay,
  sourceTextForDisplay,
} from "@/lib/source-text-sanitizer";
import type { RagAnswer, SafetyWarningKind, SearchResult } from "@/lib/types";

export type SafetyFindingKind = SafetyWarningKind;
export type SafetyFinding = ClientSafetyWarning;

const safetyPatterns: Array<{ kind: SafetyFindingKind; label: string; pattern: RegExp }> = [
  {
    kind: "contraindication",
    label: "Contraindication",
    // `hypersensitivity` is deliberately split across this tier and the next. The
    // phrase forms here — "known hypersensitivity", "hypersensitivity to <drug>" —
    // name a property of the patient that forbids the drug, which is what this
    // tier means. A bare mention ("hypersensitivity reactions have been reported")
    // is an adverse-effect statement, so it is caught one tier down rather than
    // promoted to the top severity and the danger colour.
    pattern:
      /\b(contraindicat\w*|do not use|avoid|not recommended|must not|known hypersensitivity|hypersensitivity to)\b/i,
  },
  {
    kind: "red_flag",
    label: "Red flag",
    // `immediate(?:ly)?`: every token here is wrapped in \b...\b, so a bare
    // `immediate` matched "with immediate effect" and MISSED "immediately", the
    // commoner clinical phrasing — a silent no-finding, not a wrong label.
    //
    // The stop instructions (cease/withhold/hold the dose) sit here rather than in
    // `contraindication` because they are event-driven: stop the drug now, because
    // something has happened. A contraindication is a standing property of the
    // patient ("do not use in severe hepatic impairment"). Keeping them at this
    // tier also means no passage that reads "Contraindication" today changes.
    //
    // `boxed warning` / `black box` is the strongest labelled warning a regulator
    // applies, but it does not forbid prescribing, so it is a red flag rather than
    // a contraindication. `anaphyla\w*` is an acute emergency, the same class as
    // `seizure` and `chest pain` already in this tier.
    //
    // `hold` is only ever matched inside a dose phrase; a bare \bhold\b matches
    // ordinary prose ("hold the view that ...").
    //
    // `urgent(?:ly)?` and `seizures?`: the same trailing-`\b` defect again. Bare
    // `urgent` missed "Urgently reassess the patient." and bare `seizure` missed
    // "seizures", both silently. Widening this tier moves passages onto the
    // danger colour, so it waited for the owner: Josh (psychiatrist, product
    // owner) signed it off on 2026-09-25 (#GHC4XZ). Explicit suffix groups, not
    // `\w*`, so nothing beyond the adverb and the plural is claimed.
    pattern:
      /\b(red flag|urgent(?:ly)?|emergency|immediate(?:ly)?|severe|toxicity|seizures?|chest pain|dyspnoea|ceas(?:e|es|ed|ing)|withhold\w*|withheld|hold (?:the next |the |further |all |any |subsequent |next )?doses?|boxed warning|black box|hypersensitivity|anaphyla\w*)\b/i,
  },
  {
    kind: "escalation",
    label: "Escalation",
    // `escalat(?:e|es|ed|ing|ion|ions)`: the same trailing-`\b` defect that
    // `immediate(?:ly)?` fixed one tier up (#GHC4XZ, #9XRDF7). Every token here
    // is wrapped in `\b...\b`, so the bare stem `escalat` demanded a word
    // boundary straight after those seven letters and therefore matched NEITHER
    // "escalate" NOR "escalation". The entry fired only through "senior review",
    // "specialist review", "urgent review", "higher level" or "transfer", so a
    // passage reading "Escalate to the consultant." produced no chip at all --
    // the silent-miss direction, not a wrong label.
    //
    // Written as an explicit suffix group rather than `escalat\w*` because `\w*`
    // also swallows "escalator" and "escalators": ordinary hospital-estate prose
    // ("the patient fell on the escalator") that carries no clinical instruction
    // and would arrive painted with the `act` tone.
    //
    // Widening a mid-array entry is not purely additive. `safetyPatterns.find`
    // takes the FIRST match in severity order, so this entry now also claims
    // passages that read Dose limit, Monitoring, Exclusion or Caveat today --
    // everything below it in the array. Passages already reaching
    // Contraindication or Red flag are untouched. Every measured movement is
    // pinned in tests/clinical-safety.test.ts.
    //
    // `transfer(?:s|red|ring)?` (#GHC4XZ, owner sign-off 2026-09-25): bare
    // `transfer` missed "transferring" and "transferred". An explicit suffix
    // group, never `transfer\w*`, which would claim "transferrin" (an iron
    // study) and "transference" (a psychotherapy term) as escalations.
    //
    // Drug-passage exclusion (#GHC4XZ, owner decisions 9 and 16, 2026-09-25):
    // a drug that "transfers into breast milk" or is "transferred across the
    // placenta" is pharmacokinetics, not an instruction to move the patient,
    // so those passages get no Escalation chip. Decision 16 narrowed the
    // exclusion to the drug-passage OBJECTS only: (breast / human) milk, the
    // placenta, the fetus or foetus, the CSF and the blood-brain barrier,
    // reached by into / across / via / to (optionally after one -ly adverb:
    // "transfers readily across the placenta"), optionally through "transfer of
    // <one to three words>" ("Transfer of lithium across the placenta"), plus
    // (trans)placental transfer. Any other object -- "transfer into ICU",
    // "transfer of care to the community team" -- is a patient transfer and
    // keeps Escalation, and so does a named destination that starts with one
    // of those objects ("transfer to the placenta accreta service", "the CSF
    // shunt clinic"): a service word after the object re-arms the chip, because
    // a patient transfer must never lose it. The trailing `\b` stops the optional suffix
    // backtracking round the lookahead ("transfer|red into"). The lookahead
    // stays linear: the word count is bounded and `[\w-]` and `\s` are
    // disjoint, so each word has exactly one way to match.
    pattern:
      /\b(escalat(?:e|es|ed|ing|ion|ions)|senior review|specialist review|urgent review|higher level|(?<!\b(?:trans)?placental\s+)transfer(?:s|red|ring)?(?!\s+(?:[a-z]+ly\s+)?(?:of(?:\s+[\w-]+){1,3}\s+)?(?:into|across|via|to)\s+(?:the\s+)?(?:(?:breast|human|maternal)\s+)?(?:milk|breastmilk|placenta|fo?etus|csf|blood[-\s]brain\s+barrier)\b(?!\s+(?:accreta|pr(?:a)?evia|shunt|clinics?|services?|units?|teams?|cent(?:re|er)s?|wards?|departments?)\b)))\b/i,
  },
  {
    kind: "dose_limit",
    label: "Dose limit",
    pattern: /\b(maximum dose|max dose|dose limit|do not exceed|mg\/day|microgram|mcg)\b/i,
  },
  {
    kind: "monitoring",
    label: "Monitoring",
    // `monitor(?:s|ed|ing)?`: the trailing-`\b` defect again (#9XRDF7). Bare
    // `monitor` matched the imperative ("Monitor the full blood count weekly")
    // but missed "monitoring", "monitored" and "monitors", so "Monitoring
    // should continue for eighteen weeks." produced no finding. The `i` flag
    // was never the issue; the word boundary was.
    //
    // An explicit suffix group rather than `monitor\w*`, for the same reason as
    // the escalation entry above: keep the token to the verb and its
    // inflections instead of anything that merely begins with those letters.
    //
    // This entry sits fifth of seven, so widening it takes passages from the
    // two tiers BELOW it (Exclusion, Caveat) as well as labelling passages that
    // had no finding at all. Anything already matching a higher tier keeps its
    // label. Measured movements are pinned in tests/clinical-safety.test.ts.
    pattern: /\b(monitor(?:s|ed|ing)?|baseline|repeat|review|blood test|level|fbc|anc|renal|thyroid|metabolic)\b/i,
  },
  {
    kind: "exclusion",
    label: "Exclusion",
    pattern: /\b(exclusion|exclude|not applicable|unless|except|avoid if)\b/i,
  },
  {
    kind: "caveat",
    label: "Caveat",
    pattern: /\b(caution|consider|if symptoms|seek advice|consult|limited evidence)\b/i,
  },
];

/**
 * How much of a passage two findings must share before containment is treated as
 * "the same passage". Below this, a short fragment is a substring of too much.
 */
const minPassageOverlap = 40;

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const conciseTextLimit = 260;
const conciseTextCut = 257;

// Audit L111: the chip text was cut at a fixed character offset with no word or
// number boundary, so a dose or count straddling the cut rendered as a partial
// number — "ANC 1500" became "ANC 1" — which reads as a complete threshold.
// Cut at the last word boundary instead. When a single token runs past the whole
// limit there is no boundary to use, so drop a trailing partial number rather
// than show half of one.
function truncateAtSafeBoundary(text: string, cut: number) {
  const slice = text.slice(0, cut);
  // Audit L111, second boundary case (Codex review on PR #2610): when the cut
  // itself lands on whitespace, the slice already ends on a COMPLETE token, so
  // backing up to the previous space deletes a whole value. "…ANC below 1500"
  // became "…ANC below" — worse than the original defect, because it still reads
  // as a finished clinical instruction with the threshold silently removed.
  if (/\s/.test(text.charAt(cut)) || /\s$/.test(slice)) return slice.trimEnd();
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0) return slice.slice(0, lastSpace).trimEnd();
  return slice.replace(/[\d.,]*\d[\d.,]*$/, "").trimEnd() || slice.trimEnd();
}

function conciseSourceText(text: string) {
  const useful = clinicalProseUsefulness(text);
  const normalized = normalizeText(
    (sourceTextForCompactDisplay(useful.text || text) || sourceTextForDisplay(text))
      .replace(/\bsource mentions\s*:?\s*/gi, "")
      // Audit M9: this scrub removes a document code such as
      // "Procedure PAE-PRO-0338/16". With the `i` flag it also matched any
      // lowercase hyphenated word, so "protocol re-challenge",
      // "policy co-prescribing" and "procedure post-operative" lost the subject
      // of the sentence in a rendered Safety finding. The keyword stays
      // case-insensitive by spelling; the code itself must be upper case and
      // must contain a digit, which every real code does.
      .replace(
        /\b(?:[Pp]rocedure|[Pp]olicy|[Pp]rotocol)\s+(?=[A-Z0-9/-]*\d)[A-Z]{2,}(?:-[A-Z0-9]+)+(?:\/\d+)?\b[\s.:-]*/g,
        "",
      )
      .replace(/\bpage\s+\d+\s+of\s+\d+\b[\s.:-]*/gi, "")
      .replace(/\bchunk\s*(?:id|index)?\s*[:#=-]?\s*[a-z0-9_-]+\b[\s.:-]*/gi, ""),
  );
  if (normalized.length <= conciseTextLimit) return normalized;
  return `${truncateAtSafeBoundary(normalized, conciseTextCut)}...`;
}

function citationFromSource(source: ClientSearchResult): ClientCitation {
  return {
    chunk_id: source.id,
    document_id: source.document_id,
    title: source.title,
    file_name: source.file_name,
    page_number: source.page_number,
    chunk_index: source.chunk_index,
    similarity: source.similarity,
    source_metadata: source.source_metadata,
  };
}

function hasQueryConceptOverlap(text: string, terms: string[]) {
  if (terms.length === 0) return true;
  const haystack = text.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

type SafetyAnswerInput = Omit<ClientRagAnswerPayload, "sources"> & {
  sources: Array<ClientSearchResult | SearchResult>;
  smartPanel?: Pick<NonNullable<RagAnswer["smartPanel"]>, "query">;
};

/**
 * Collapse findings that are the same passage counted twice.
 *
 * The candidate list below draws from `quoteCards` AND `sources`, and a quote
 * card is an extract of its own parent chunk — same document, same page, its
 * text a substring of the chunk's. Both used to survive, because the dedupe key
 * was the text itself and two different lengths of one passage are two different
 * strings. They could also carry different labels: `safetyPatterns.find` returns
 * the first pattern the text matches, and the longer text reaches severities the
 * extract does not. On the live clozapine answer that rendered as "3 safety
 * notes" over two passages, the first two of them the same words under "Red
 * flag" and "Monitoring".
 *
 * A count is the whole point of this surface, so an inflated one is not cosmetic.
 * Same document, same page, one text containing the other: keep the fuller text,
 * and keep the most severe label of the group — a passage that names both an
 * urgent trigger and a monitoring step is a red flag that also mentions
 * monitoring, not two findings.
 *
 * Applied to every path into this module, including an answer that arrives with
 * `safetyWarnings` already computed, so a future producer of those warnings
 * cannot reintroduce the double count.
 */
export function collapseDuplicateSafetyFindings(findings: SafetyFinding[]): SafetyFinding[] {
  // A single pass is order-greedy: it merges into the FIRST passage-key match,
  // so a finding that contains two already-kept ones lands on the first and
  // leaves the second nested inside it. That matters because this runs twice on
  // the same data — server-side into the payload, then again on the client — and
  // a pass that has not reached a fixed point can return a different count each
  // time, so the chip reads "2 safety notes" before hydration and "1" after.
  // Every iteration that changes anything removes at least one finding, so the
  // input length bounds the loop.
  let current = findings;
  for (let pass = 0; pass < findings.length; pass += 1) {
    const next = collapseSafetyFindingsOnce(current);
    if (next.length === current.length) return next;
    current = next;
  }
  return current;
}

function collapseSafetyFindingsOnce(findings: SafetyFinding[]): SafetyFinding[] {
  const kept: SafetyFinding[] = [];
  const normalized = new Map<SafetyFinding, string>();
  const passageKey = (finding: SafetyFinding) =>
    `${finding.citation?.document_id}:${finding.citation?.page_number ?? "?"}`;

  for (const finding of findings) {
    const text = normalizeText(finding.text).toLowerCase();
    normalized.set(finding, text);
    const duplicateIndex = kept.findIndex((candidate) => {
      const other = normalized.get(candidate) ?? "";
      if (other === text && passageKey(candidate) === passageKey(finding)) return true;
      const contains = other.includes(text) || text.includes(other);
      if (!contains) return false;
      // Same chunk is not a heuristic: a quote card and the source it was cut
      // from carry the same `chunk_id`, so containment there is proof of one
      // passage however short the extract. The length floor below exists only
      // for the cross-chunk case, and applying it here would let a quote under
      // 40 characters double-count against its own parent — the exact defect
      // this function was written for.
      const sameChunk =
        Boolean(candidate.citation?.chunk_id) && candidate.citation?.chunk_id === finding.citation?.chunk_id;
      if (sameChunk) return true;
      if (passageKey(candidate) !== passageKey(finding)) return false;
      // Across chunks, containment only counts when the shorter side is long
      // enough to identify a passage. A stray fragment is a substring of almost
      // anything.
      const shorter = other.length < text.length ? other : text;
      return shorter.length >= minPassageOverlap;
    });

    if (duplicateIndex === -1) {
      kept.push(finding);
      continue;
    }

    const existing = kept[duplicateIndex];
    const existingText = normalized.get(existing) ?? "";
    const fuller = text.length > existingText.length ? finding : existing;
    const severest = safetyKindPriority[finding.kind] < safetyKindPriority[existing.kind] ? finding : existing;
    // The id encodes the kind, so a merge that takes one finding's text and
    // another's severity has to rebuild it rather than keep a `monitoring:` id
    // on a row now labelled "Red flag".
    kept[duplicateIndex] =
      fuller === severest
        ? fuller
        : {
            ...fuller,
            id: `${severest.kind}:${fuller.citation?.chunk_id ?? fuller.id}`,
            kind: severest.kind,
            label: severest.label,
          };
    normalized.set(kept[duplicateIndex], normalizeText(kept[duplicateIndex].text).toLowerCase());
  }

  return kept;
}

/**
 * The label the pattern list alone gives `text`, with none of the extractor's
 * trimming. Tests only: `extractSafetyFindings` cuts every passage to 260
 * characters first, so it cannot hand a pattern the hostile input a
 * linear-time guard needs.
 */
export function __safetyPatternLabelForTests(text: string): string | undefined {
  return safetyPatterns.find((item) => item.pattern.test(text))?.label;
}

export function extractSafetyFindings(answer: SafetyAnswerInput | null | undefined, limit = 5): SafetyFinding[] {
  if (answer?.safetyWarnings) return collapseDuplicateSafetyFindings(answer.safetyWarnings).slice(0, limit);
  if (!answer?.grounded) return [];
  if (answer.relevance && !answer.relevance.isSourceBacked) return [];

  const sourceByChunkId = new Map((answer.sources ?? []).map((source) => [source.id, source]));
  const queryTerms = queryCoreTerms(answer.smartPanel?.query ?? "");
  const relevanceTerms = answer.relevance?.matchedTerms ?? [];
  const coreTerms = queryTerms.length ? queryTerms : relevanceTerms;

  const candidates = [
    ...(answer.quoteCards ?? []).map((quote) => {
      const source = sourceByChunkId.get(quote.chunk_id);
      return {
        id: quote.chunk_id,
        text: quote.quote,
        citation: quote,
        source,
        sourceStrength: quote.source_strength ?? source?.source_strength,
      };
    }),
    ...(answer.sources ?? []).map((source) => ({
      id: source.id,
      text: source.content,
      citation: citationFromSource(source),
      source,
      sourceStrength: source.source_strength,
    })),
  ];

  const seen = new Set<string>();
  const findings: SafetyFinding[] = [];

  for (const candidate of candidates) {
    const text = sanitizeAnswerText(conciseSourceText(candidate.text)) || conciseSourceText(candidate.text);
    if (!text) continue;
    if (answer.relevance) {
      const sourceBacked =
        candidate.source && "relevance" in candidate.source && candidate.source.relevance?.isSourceBacked;
      const moderateOrStrong = candidate.sourceStrength === "strong" || candidate.sourceStrength === "moderate";
      const overlapsQuery = hasQueryConceptOverlap(text, coreTerms);
      if (!sourceBacked && !(moderateOrStrong && overlapsQuery)) continue;
    }

    const match = safetyPatterns.find((item) => item.pattern.test(text));
    if (!match) continue;

    const key = `${match.kind}:${candidate.citation.document_id}:${candidate.citation.page_number}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      id: `${match.kind}:${candidate.id}`,
      kind: match.kind,
      label: match.label,
      text,
      citation: candidate.citation,
      href: documentCitationHref(candidate.citation),
    });

    // Deliberately NOT `>= limit`: the collapse below can merge two of these
    // into one, and stopping at the limit first would let a duplicate crowd out
    // a genuinely distinct finding.
    if (findings.length >= limit * 2) break;
  }

  return collapseDuplicateSafetyFindings(findings).slice(0, limit);
}

export function formatSafetyFindingLabel(finding: SafetyFinding) {
  return `${finding.label} · ${formatCitationLabel(finding.citation)}`;
}

const safetyKindPriority: Record<SafetyFindingKind, number> = {
  contraindication: 10,
  red_flag: 20,
  escalation: 30,
  dose_limit: 40,
  monitoring: 50,
  exclusion: 60,
  caveat: 70,
};

export function sortSafetyFindingsBySeverity(findings: SafetyFinding[]): SafetyFinding[] {
  return [...findings].sort((left, right) => safetyKindPriority[left.kind] - safetyKindPriority[right.kind]);
}

/**
 * What the reader is being asked to do, which is not the same question as how
 * severe the finding is.
 *
 * The three tiers exist so routine monitoring stops being painted amber.
 * `docs/design-system/TOKENS.md` reserves the clinical status colours for
 * "source state and sanctioned urgency only", and an answer whose every finding
 * is a warning colour teaches the reader that the warning colours mean nothing —
 * which is exactly the state a contraindication cannot afford them to be in.
 *
 * `stop` earns `--danger`, `act` earns `--warning`, and `know` deliberately
 * earns neither.
 */
export type SafetyFindingTone = "stop" | "act" | "know";

const safetyKindTone: Record<SafetyFindingKind, SafetyFindingTone> = {
  contraindication: "stop",
  red_flag: "stop",
  escalation: "act",
  dose_limit: "act",
  monitoring: "know",
  exclusion: "know",
  caveat: "know",
};

export function safetyFindingTone(kind: SafetyFindingKind): SafetyFindingTone {
  return safetyKindTone[kind];
}

/**
 * The findings collapsed to one entry per kind, in severity order, for the
 * rail of clinical points under an answer.
 *
 * Grouped by kind rather than listed per finding because `SafetyFinding` has no
 * short title: it carries `label` ("Contraindication") and `text` (the whole
 * passage), and a rail of full passages is the panel this rail exists to
 * replace. The count keeps two monitoring findings from rendering as two
 * identical pills.
 */
export type SafetyFindingGroup = {
  kind: SafetyFindingKind;
  label: string;
  tone: SafetyFindingTone;
  count: number;
};

export function groupSafetyFindingsByKind(findings: SafetyFinding[]): SafetyFindingGroup[] {
  const groups = new Map<SafetyFindingKind, SafetyFindingGroup>();
  for (const finding of sortSafetyFindingsBySeverity(findings)) {
    const existing = groups.get(finding.kind);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(finding.kind, {
      kind: finding.kind,
      label: finding.label,
      tone: safetyFindingTone(finding.kind),
      count: 1,
    });
  }
  return [...groups.values()];
}
