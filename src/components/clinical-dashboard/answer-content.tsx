"use client";

import { primaryAnswerDisplayText as canonicalPrimaryAnswerDisplayText } from "@/lib/answer-display-text";

import { Fragment, memo, type ReactNode } from "react";
import { Copy } from "lucide-react";

import { SafeBoldText } from "@/components/SafeBoldText";
import { chatActionRow, chatAnswerText, chatMicroAction, cn } from "@/components/ui-primitives";
import { cleanDisplayTitle, comparableAnswerText } from "@/components/clinical-dashboard/display-text";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { AnswerSourceRail } from "@/components/clinical-dashboard/answer-source-rail";
import { AnswerSourceMark, AnswerSourceMarkOverflow } from "@/components/clinical-dashboard/answer-source-mark";
import {
  type AnswerSourceRow,
  buildAnswerSourceRows,
  sourceSpokenLabel,
} from "@/components/clinical-dashboard/answer-source-rows";
import { SignedImage } from "@/components/clinical-dashboard/signed-image";
import { clinicalProseUsefulness } from "@/lib/source-text-sanitizer";
import { type ClaimMarkCluster, type SupportedClaim, resolveClaimMarks } from "@/lib/answer-claim-marks";
import { type SourceLink } from "@/lib/answer-render-policy";
import type { AnswerSection, AnswerSectionKind, RagAnswer, VisualEvidenceCard } from "@/lib/types";
import type { ClientBestSourceRecommendation, ClientSearchResult } from "@/lib/answer-client-payload";

export const SourceImage = memo(function SourceImage({
  endpoint,
  caption,
  className = "max-h-52",
}: {
  endpoint: string;
  caption: string;
  className?: string;
}) {
  return (
    <SignedImage
      endpoint={endpoint}
      alt={caption?.trim() || "Clinical document image"}
      caption={caption}
      className={className}
      zoomable
    />
  );
});

export type AnswerDisplayTextOptions = {
  // Server-`preformatted` answers are display-ready by construction; skip the
  // noise-stripping prose sanitizer and fragment slicing so their document
  // names / facility codes survive.
  preformatted?: boolean;
  // Keep server high-yield bold (**…**) so <SafeBoldText> can render it.
  preserveBold?: boolean;
};

/**
 * Reports whether an answer is a server-`preformatted`, grounded answer whose
 * display text should bypass prose sanitization and be shown as-is.
 *
 * @param answer - The answer to check, or `null`/`undefined` when unavailable
 * @returns `true` when the answer is preformatted and grounded
 */
export function isPreformattedGroundedAnswer(answer: Pick<RagAnswer, "preformatted" | "grounded"> | null | undefined) {
  return Boolean(answer?.preformatted && answer?.grounded);
}

// Shared tail of the sanitize path: run the display sanitizer, then strip the
// synthetic-demo notice both plainAnswerText and primaryAnswerDisplayText need
// removed before the text reaches the screen.
function sanitizeAndStripSyntheticNotice(value: string, options: AnswerDisplayTextOptions) {
  return canonicalPrimaryAnswerDisplayText(value, options);
}
/**
 * Produces sanitized, display-ready text for an answer.
 *
 * @param value - The answer text to sanitize
 * @param options - Controls preformatted handling and bold-text preservation
 * @returns The sanitized answer text
 */
export function plainAnswerText(value: string, options: AnswerDisplayTextOptions = {}) {
  // clinicalProseUsefulness runs the source-noise stripper, so preformatted
  // answers bypass it and go straight to the lossless display path.
  const base = options.preformatted ? value : clinicalProseUsefulness(value).text || value;
  return sanitizeAndStripSyntheticNotice(base, options);
}

/**
 * Produces the complete, sanitized primary answer text.
 *
 * @param value - The answer text to prepare for display
 * @param options - Formatting options, including preformatted mode
 * @returns The display-ready answer text
 */
export function primaryAnswerDisplayText(value: string, options: AnswerDisplayTextOptions = {}) {
  return sanitizeAndStripSyntheticNotice(value, options);
}

export type AnswerDisplayFragment = { display: string; raw: string; truncated: boolean };

/** Preserve every verified word; sentence boundaries only attach existing claim marks. */
export function primaryAnswerDisplayFragments(
  value: string,
  options: AnswerDisplayTextOptions = {},
): AnswerDisplayFragment[] {
  const cleaned = primaryAnswerDisplayText(value, options);
  if (!cleaned) return [];
  if (options.preformatted) return [{ display: cleaned, raw: cleaned, truncated: false }];
  return cleaned.split(/(?<=[.!?])\s+(?=[A-Z*])/).map((text) => ({ display: text, raw: text, truncated: false }));
}

/**
 * Splits a sentence at its last word so the word and the whole mark cluster can
 * be wrapped together — a number stranded alone on the next line reads as a
 * footnote to nothing.
 *
 * Returns `null` when the split is unsafe. Production prose carries server bold,
 * and the last word can sit inside a `**…**` run that a string split would cut
 * in half; an odd number of markers in the head is exactly that case, and the
 * sentence is then rendered whole rather than mangled.
 */
export function splitTrailingWord(text: string): { head: string; tail: string } | null {
  const lastSpace = text.lastIndexOf(" ");
  if (lastSpace <= 0) return null;
  const head = text.slice(0, lastSpace);
  const tail = text.slice(lastSpace + 1);
  if (!tail) return null;
  if ((head.match(/\*\*/g)?.length ?? 0) % 2 !== 0) return null;
  return { head, tail };
}

/** The accessible name of a mark. Distinct from the drawer pager's "Show source N…". */
function markLabel(row: AnswerSourceRow | undefined, index: number, support: ClaimMarkCluster["support"]) {
  const strength = support === "partial" ? "partial support" : "direct support";
  if (!row) return `${sourceSpokenLabel(index)} — ${strength}`;
  return `${sourceSpokenLabel(index)}: ${cleanDisplayTitle(row.title)}, page ${row.pageNumber ?? "not available"} — ${strength}`;
}

/**
 * The sentence that owns the open source is washed while the drawer is up. The
 * drawer covers the lower third of a phone, and this is what stops a clinician
 * losing the sentence they were checking.
 *
 * The left rule is not decoration. Backgrounds are remapped under forced-colors,
 * so colour alone would erase the wash for the readers who most need to keep
 * their place; the border is painted. `-ml-1`/`pl-1` cancel out, so lighting a
 * sentence does not move the text.
 */
const litClaimClass =
  "-ml-1 rounded-[var(--radius-xs)] border-l-2 border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] pl-1";

function AnswerProseSentence({
  fragment,
  cluster,
  rows,
  openSourceIndex,
  onOpenSource,
}: {
  fragment: AnswerDisplayFragment;
  cluster: ClaimMarkCluster | null;
  rows: AnswerSourceRow[];
  openSourceIndex: number | null;
  onOpenSource?: (index: number, support?: "direct" | "partial") => void;
}) {
  if (!cluster || !onOpenSource) return <SafeBoldText text={fragment.display} />;

  const lit = openSourceIndex !== null && cluster.marks.some((mark) => mark.index === openSourceIndex);
  const marks = (
    <>
      {cluster.marks.map((mark, position) => (
        <AnswerSourceMark
          key={`${mark.sourceId}:${mark.index}`}
          index={mark.index}
          leading={position === 0}
          active={openSourceIndex === mark.index}
          partial={cluster.support === "partial"}
          label={markLabel(rows[mark.index], mark.index, cluster.support)}
          onOpen={(index) => onOpenSource(index, cluster.support)}
        />
      ))}
      <AnswerSourceMarkOverflow count={cluster.overflow} />
    </>
  );
  const split = splitTrailingWord(fragment.display);

  return (
    <span
      data-testid="answer-claim"
      data-claim-lit={lit ? "true" : undefined}
      className={cn("transition-colors", lit && litClaimClass)}
    >
      {split ? (
        <>
          <SafeBoldText text={split.head} />{" "}
          {/* The last word and the whole cluster travel together, so a number
              cannot fall alone onto the next line as a footnote to nothing. */}
          <span className="whitespace-nowrap">
            <SafeBoldText text={split.tail} />
            {marks}
          </span>
        </>
      ) : (
        <>
          {/* The split was refused because a bold run crosses the last space.
              Only the cluster is held together here — never the whole sentence.
              An unbreakable sentence is a horizontal-overflow bug on a phone,
              which is a far worse outcome than a mark that occasionally starts
              the next line. */}
          <SafeBoldText text={fragment.display} />
          <span className="whitespace-nowrap">{marks}</span>
        </>
      )}
    </span>
  );
}

/**
 * The cited-source derivations moved to `answer-source-rows`, which the rail,
 * the drawer, and this module all read. They are re-exported here so existing
 * import paths (and the tests that pin them) keep resolving.
 */
export {
  buildAnswerSourceRows,
  sourceCapsuleDisplay,
  sourceStatusDotClass,
  sourceStatusDotTone,
  sourceStatusShortLabel,
  type AnswerSourceRow,
  type CapsulePreviewSource,
} from "@/components/clinical-dashboard/answer-source-rows";

/**
 * Displays a sanitized clinical answer with source status, source previews, and copy actions.
 *
 * @param text - The raw answer text to display.
 * @param query - The user's query context for logging.
 * @param preformatted - Whether to preserve the supplied formatting during display processing.
 * @param bestSource - The highest-priority source recommendation, when available.
 * @param sources - Search results used to build the source preview.
 * @param sourceLinks - Source links and snippets associated with the answer.
 * @param copied - Whether the answer has been copied.
 * @param onCopy - Callback invoked to copy the answer with source status.
 * @param claims - Server-assessed per-sentence support, used to place the numbered source marks.
 * @param openSourceIndex - Rail row the drawer is currently showing, or `null` while it is closed.
 * @returns The rendered answer section, or `null` when the answer has no displayable text.
 */
export function NaturalLanguageAnswer({
  text,
  query,
  preformatted = false,
  clinicalPoints,
  bestSource,
  sources,
  sourceLinks,
  claims,
  railRows,
  copied,
  onCopy,
  onOpenSource,
  onOpenRailSource,
  openSourceIndex = null,
  showCopyAction = true,
  isRefusal = false,
  hideSourceRail = false,
}: {
  // Raw answer text (server bold intact); this component owns display
  // sanitization so <SafeBoldText> can render the high-yield emphasis.
  text: string;
  query?: string;
  preformatted?: boolean;
  sourceCount?: number;
  sourceOnly?: boolean;
  bestSource: ClientBestSourceRecommendation | null;
  sources: ClientSearchResult[];
  clinicalPoints?: ReactNode;
  sourceLinks: SourceLink[];
  /**
   * `answer.supportedClaims`. Absent on a historical turn and on any answer the
   * pipeline did not assess, which is the degrade case: prose with no marks and
   * the rail still carrying every source.
   */
  claims?: readonly SupportedClaim[];
  /**
   * Pre-built rail rows. The answer surface already derives these (annotated
   * with which sources carry a table or an image), so it passes them down rather
   * than leaving this component to derive a second, subtly different list from
   * the same three inputs.
   */
  railRows?: AnswerSourceRow[];
  copied: boolean;
  onCopy: () => void;
  /**
   * Opens the source drawer at the given rail row. The drawer is mounted by the
   * answer surface rather than here, so the rail reports the row and the surface
   * owns which one is open.
   */
  onOpenSource?: (index: number, support?: "direct" | "partial") => void;
  /**
   * Opens the drawer from a rail card rather than from a claim. Separate from
   * `onOpenSource` because the drawer says something different in each case —
   * a card is a document, a mark is a claim about a document — and defaulting
   * to `onOpenSource` would have every rail tap assert a claim nobody made.
   */
  onOpenRailSource?: (index: number) => void;
  /** Which rail row the drawer is showing, so the mark and its sentence can light up. */
  openSourceIndex?: number | null;
  /** Historical turns keep their local copy action; the live turn renders the combined utility row outside. */
  showCopyAction?: boolean;
  /**
   * The answer is a refusal (`answerIsRefusal`). Its rows were searched, not relied
   * on, so the prose carries no source marks and the rail frames every row as
   * "Documents searched" rather than as support for an answer that was not given.
   */
  isRefusal?: boolean;
  /**
   * "Not in your sources" (audit D03): the searched documents do not answer the question,
   * so the list of them is left off rather than shown as if it backed something.
   */
  hideSourceRail?: boolean;
}) {
  const { preferences } = useAppPreferences();
  const fragments = primaryAnswerDisplayFragments(text, { preformatted, preserveBold: true });
  if (!fragments.length) return null;
  const railSources = railRows ?? buildAnswerSourceRows(bestSource, sources, sourceLinks);
  /**
   * Marks may only point at CITED rows: an uncited card carries a dashed em-dash
   * badge rather than a number, so a mark leading to one would show a number the
   * rail does not.
   *
   * Masked to an empty id rather than filtered out. Filtering would renumber
   * every row after an uncited one, which is the silent wrong-page attribution
   * this whole surface exists to prevent — and it would depend on cited rows
   * happening to sort first, which is true today and is not a contract.
   */
  const markableSourceIds = railSources.map((row) => (isRefusal || row.cited === false ? "" : row.id));
  // A historical turn mounts no drawer, so a mark there would advertise a panel
  // that never opens. Those turns render the prose unmarked.
  const clusters = onOpenSource
    ? resolveClaimMarks({
        fragments: fragments.map((fragment) => ({ text: fragment.raw, truncated: fragment.truncated })),
        claims,
        sourceIds: markableSourceIds,
      })
    : fragments.map(() => null);
  return (
    <section
      data-testid="plain-answer-response"
      aria-label="Primary natural-language answer"
      /* No assistant badge, and therefore no column reserved for one. The tile
         was decorative (`aria-hidden`) and its column cost ~2.75rem of every
         line of a clinical answer on a 390px phone. There are two speakers on
         this surface, the person's turn is already a right-aligned bubble, and
         the answer is the one element here that wants the full measure. What
         identifies the turn instead is the answer's verification/support
         framing and, for extractive answers, the Source-only disclosure. Those
         are information rather than decoration. Approved by the owner 2026-08-26
         against /mockups/answer-chat-perfected-v2; see §12.6 of
         docs/answer-page-redesign-handover.md. */
      className="relative rounded-lg bg-transparent py-0.5 text-[color:var(--text-heading)]"
    >
      <div className="min-w-0 space-y-1">
        <p className={chatAnswerText}>
          {/* One span per sentence, joined by a single space, so the prose's
              textContent is byte-identical to the un-marked rendering. */}
          <span data-testid="plain-answer-prose">
            {fragments.map((fragment, index) => (
              <Fragment key={`${index}:${fragment.display}`}>
                {index > 0 ? " " : null}
                <AnswerProseSentence
                  fragment={fragment}
                  cluster={clusters[index]}
                  rows={railSources}
                  openSourceIndex={openSourceIndex}
                  onOpenSource={onOpenSource}
                />
              </Fragment>
            ))}
          </span>
        </p>
        {/* The Source-only pill is NOT here any more (owner decision,
            2026-09-03). It sat below the prose, apart from the three status
            chips above it and built from a third disclosure mechanism, so the
            page carried four warning surfaces before the first cited passage.
            Its governed wording now leads the Answer limitations disclosure in
            `answer-result-surface.tsx`, which the chip row opens.

            The stale-evidence banner moved into that same disclosure earlier
            (2026-09-01) for the same reason: it names WHICH sources are overdue,
            which is a statement about this answer's evidence.

            Both facts still reach the default view. `VerificationNotice` stays
            `hidden print:flex` on a source-only answer, so the limitations
            chip's own label is what carries `Source-only` and `Review due`
            there. Do not shorten that label to a bare count. */}
        {clinicalPoints}
        {hideSourceRail ? null : (
          <AnswerSourceRail
            sources={railSources}
            query={query}
            onOpenSource={onOpenRailSource ?? onOpenSource}
            activeIndex={openSourceIndex}
            compact={preferences.compactCitations}
            isRefusal={isRefusal}
          />
        )}
        {showCopyAction ? (
          <div className={cn(chatActionRow, "mt-0.5")} aria-label="Answer actions">
            <button
              type="button"
              onClick={onCopy}
              className={chatMicroAction}
              aria-label="Copy answer with source status"
            >
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
              {copied ? "Copied with sources" : "Copy with sources"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function UserQuestionBubble({ query }: { query: string }) {
  const cleaned = query.trim();
  if (!cleaned) return null;

  return (
    <section className="flex justify-end px-1" aria-label="User question">
      <div
        data-testid="user-question-bubble"
        className="ml-auto max-w-[min(28rem,86%)] rounded-lg border border-[color:var(--border)] bg-[color:var(--clinical-accent-soft)] px-3 py-2 text-right shadow-[var(--shadow-inset)] sm:max-w-[28rem]"
      >
        <p className="text-sm font-medium leading-6 text-[color:var(--text-heading)]">
          {/* Carried over from AnswerCardQueryEcho when the current turn's
              question moved out of the card header and into this bubble: without
              it a screen reader reads the question as an unlabelled sentence
              immediately before the answer. */}
          <span className="sr-only">Question: </span>
          {cleaned}
        </p>
      </div>
    </section>
  );
}

type KeyClinicalItem = {
  id: string;
  label?: string;
  detail: string;
};

function keyClinicalItemFromText(item: string): KeyClinicalItem | null {
  const cleaned = item.replace(/^[-*•]\s*/, "").trim();
  if (cleaned.length < 24) return null;
  const [labelCandidate, ...detailParts] = cleaned.split(/\s+(?:—|-)\s+/);
  const label = labelCandidate?.trim();
  const detail = detailParts.join(" — ").trim();
  const id = comparableAnswerText(cleaned);
  if (label && detail && label.length <= 64) return { id, label, detail };
  return { id, detail: cleaned };
}

export function keyClinicalItemsFromSections(
  sections: Array<AnswerSection & { citationSources: ClientSearchResult[] }>,
): KeyClinicalItem[] {
  const usefulKinds = new Set<AnswerSectionKind | undefined>([
    "required_actions",
    "monitoring_timing",
    "medication_dose",
    "thresholds",
    "escalation_risk",
    "contraindications_cautions",
    "comparison",
  ]);
  return sections
    .filter((section) => usefulKinds.has(section.kind))
    .flatMap((section) =>
      section.body
        .split(/\n+|(?<=\.)\s+(?=(?:Monitor|Check|Use|Avoid|Escalate|Withhold|Review|Document|Repeat|Consider)\b)/)
        .map((item) => keyClinicalItemFromText(item))
        .filter((item): item is KeyClinicalItem => Boolean(item)),
    )
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 5);
}

export function keyClinicalItemsFromTable(item: VisualEvidenceCard | null): KeyClinicalItem[] {
  const rows = item?.tableRows?.filter((row) => row.some((cell) => cell.trim())) ?? [];
  if (rows.length < 2) return [];

  return rows
    .slice(0, 3)
    .map((row): KeyClinicalItem | null => {
      const [domain, baseline] = row.map((cell) => cell.trim()).filter(Boolean);
      if (!domain || !baseline) return null;
      return {
        id: comparableAnswerText([domain, baseline].join(" ")),
        label: domain,
        detail: baseline,
      };
    })
    .filter((value): value is KeyClinicalItem => value !== null)
    .slice(0, 5);
}
