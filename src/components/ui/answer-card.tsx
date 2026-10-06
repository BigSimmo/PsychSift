"use client";

import type { ReactNode } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";

import { cn, type SourceMetadataInput } from "@/components/ui-primitives";
import type { AnswerState, DegradedAnswerState } from "@/components/ui/answer-state";
import { RetrievalStateBanner } from "@/components/ui/retrieval-state-banner";
import { VerificationNotice, type VerificationNoticeProps } from "@/components/ui/verification-notice";
import { AnswerFooter, type AnswerFooterProps } from "@/components/answer/AnswerFooter";
import {
  answerClipboardCaveatLine,
  answerClipboardProvenanceLine,
  answerStateAttribution,
} from "@/lib/answer-clipboard";

/*
 * The answer surface. `answerSurface` was `"rounded-lg bg-transparent"` — the
 * screen the product is judged on had no surface at all.
 *
 * Token note: the v2 semantic tokens (--pad-panel, --measure, --text-md,
 * --leading-prose, --pad-card, --rule-w, --e2) are declared on the opt-in
 * `.ckb-v2` layer, so every reference here carries the v1 fallback it resolves to
 * today. The components therefore render correctly with or without the layer, and
 * pick up the v2 values automatically inside it.
 */

/** A named action under the answer. Every action does something — there is no inert form. */
export type AnswerCardAction = {
  id: string;
  label: string;
  onActivate: () => void;
};

/**
 * Question echo owned by the answer shell. Live product may render this above a
 * table-aside grid (so desktop tableTop stays aligned with the card, matching the
 * old UserQuestionBubble placement) while still using the AnswerCard test id.
 */
export function AnswerCardQueryEcho({ query, className }: { query: string; className?: string }) {
  const cleaned = query.trim();
  if (!cleaned) return null;
  return (
    <p data-testid="answer-card-query" className={cn("text-sm text-[color:var(--text-muted)]", className)}>
      <span className="sr-only">Question: </span>
      {cleaned}
    </p>
  );
}

/**
 * How strongly the cited evidence backs this answer.
 *
 * Required on every card, and deliberately not optional. `deriveTrust` returns
 * "medium" both for an ordinary non-high-confidence answer AND for the case where
 * a HIGH-RISK claim rests on evidence whose authority was never reviewed. That
 * second case previously reached the reader as `{ kind: "ready" }` - visually
 * identical to a fully verified answer - because the only signal wired through
 * (`weakEvidence`) covers "unsupported" and "low" and skips "medium" entirely.
 * The distinction existed in `compactEvidenceSummary` but lived in a
 * conditionally-rendered side card, so it could vanish. Owning the wording here
 * and requiring the prop is what stops it being hideable.
 */
export type AnswerSupportStrength = "strong" | "supported" | "limited" | "unassessed";

/** Wording is owned here so a call site cannot free-text or soften it. */
const ANSWER_SUPPORT_WORDING: Record<AnswerSupportStrength, string> = {
  strong: "Strong support",
  supported: "Supported",
  limited: "Limited support",
  unassessed: "Review support",
};

type AnswerCardBase = {
  /** System-owned verification wording. Required: a generated answer cannot render without it. */
  verification: VerificationNoticeProps;
  /** Evidence-support strength. Required for the same reason `verification` is. */
  support: AnswerSupportStrength;
  /** The question this answer responds to. The card owns the echo's framing. */
  query?: string;
  /** The answer prose. */
  children: ReactNode;
  /** Machine provenance, rendered through AnswerFooter. */
  provenance?: AnswerFooterProps;
  actions?: AnswerCardAction[];
  /**
   * `"raised"` is the bordered, shadowed panel this card has always drawn.
   *
   * `"bare"` removes the frame and the panel padding so the answer sits on the
   * page, which is what the approved chat design draws: a question bubble, an
   * assistant badge, and prose — no container. The card is still the component
   * that owns the verification wording, the support word and the degraded
   * banner, and it still refuses to render an answer without them; only the box
   * around them goes. Adopted for the answer surface 2026-08-25.
   */
  frame?: "raised" | "bare";
  /**
   * Keeps the shared card safe by default while allowing the live answer
   * surface to place source-currency controls beside its source-only disclosure.
   * The content owner must render the same state and source route when it opts
   * into `"content"`.
   */
  retrievalStatePlacement?: "header" | "content";
  /**
   * Where the governed verification sentence is rendered.
   *
   * `"content"` moves it below the answer, which is what the approved specimen
   * draws: the header carries a support chip and the cited count, and the full
   * caution sits under the action row with the sources it refers to. The card
   * still owns the wording — the sentence is the same `VerificationNotice`,
   * placed by the content owner rather than rewritten by it. **A surface that
   * opts in MUST render `<VerificationNotice {...verification} />` itself**;
   * `tests/answer-verification-placement.dom.test.tsx` is what stops that
   * obligation being quietly dropped, the same way `retrievalStatePlacement`
   * above requires the content owner to keep the state and its source route.
   */
  verificationPlacement?: "header" | "content";
  /**
   * Chips rendered under the header status line. The answer surface puts its
   * safety-notes control here; the card keeps ownership of the support word
   * above so the two read as one status block.
   *
   * The card gives these their own full-width row, so a chip that needs a 48px
   * tap target should simply be 48px tall. **Do not shrink one back into the
   * line with a negative margin or a `before:-inset-y-*` pseudo-element** — both
   * leave the hit region outside the element's layout box, where it covers its
   * neighbours; `ui-smoke` measures the chip rectangles for exactly that.
   */
  metaChips?: ReactNode;
  /**
   * A disclosure the chips open, rendered directly beneath them.
   *
   * It belongs here rather than under the answer because a disclosure has to
   * appear where it was tapped. The evidence-gaps panel used to render after the
   * whole card — prose, marks and source rail included — which at 390px put it
   * ~450px below the chip that opened it, far enough off-screen that tapping the
   * chip read as doing nothing at all.
   */
  metaDetail?: ReactNode;
  className?: string;
};

/**
 * A degraded answer must carry the route back to its sources: `onOpenSource` is
 * what turns the banner's caution into an affordance, so the type refuses a
 * degraded card that cannot be re-verified (DECISIONS §Q1).
 */
export type AnswerCardProps = AnswerCardBase &
  (
    | { state: Extract<AnswerState, { kind: "ready" }>; onOpenSource?: (sourceId: string, locator?: string) => void }
    | { state: DegradedAnswerState; onOpenSource: (sourceId: string, locator?: string) => void }
  );

export function AnswerCard({
  state,
  verification,
  support,
  query,
  children,
  provenance,
  actions,
  onOpenSource,
  frame = "raised",
  retrievalStatePlacement = "header",
  verificationPlacement = "header",
  metaChips,
  metaDetail,
  className,
}: AnswerCardProps) {
  const bare = frame === "bare";
  // Vertical density: lux horizontal `--pad-panel` stays, but stacked header+body
  // each carrying full panel padding added ~60px of phantom phone scroll against the
  // `#227` budget of 8 (short-answer smoke) and pushed the desktop table/prose delta
  // past 180px once the query echo moved into this header. Keep the raised card chrome;
  // reclaim the double vertical pad at the header/body seam and the loose gap-stack.
  const panelX = "px-[var(--pad-panel,1.5rem)]";
  const panelY = "py-3";

  // Text, never colour alone — this must survive greyscale print and forced-colors the same way
  // StatusMark does. The bare frame draws it as a chip so the support word, the surface's safety
  // chip and the cited count read as one status line; the icon is decorative beside it rather
  // than a second signal.
  //
  // Sentence case, replacing uppercase. Owner preference, not a spec violation being corrected:
  // `docs/design-system/sweep-2026-08-29-unenforced-rules.md` row 9 counts `uppercase
  // tracking-eyebrow` among the sanctioned sites, and SPEC §11 has no gate. Recorded as
  // preference so a later reader does not take it for a rule.
  //
  // Unlike the interactive chip beside it, this one keeps `--text-3xs`: it holds two words, it
  // keeps `--warning` ink on `--warning-soft` with a `--warning` border and the triangle, so
  // colour and glyph carry it even at the micro size. The chip beside it had a muted-grey label
  // and no such fallback, which is why that one was resized and this one was not.
  const supportChip = (
    <p
      data-testid="answer-card-support"
      data-support={support}
      className={cn(
        "font-semibold",
        bare
          ? cn(
              "inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-3xs",
              support === "strong" || support === "supported"
                ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
            )
          : "text-2xs uppercase tracking-wide text-[color:var(--text-muted)]",
      )}
    >
      {bare ? (
        support === "strong" || support === "supported" ? (
          <ShieldCheck aria-hidden="true" className="size-icon-xs shrink-0" />
        ) : (
          <TriangleAlert aria-hidden="true" className="size-icon-xs shrink-0" />
        )
      ) : null}
      <span className="sr-only">Evidence support: </span>
      {ANSWER_SUPPORT_WORDING[support]}
    </p>
  );

  return (
    <article
      data-testid="answer-card"
      data-state={state.kind}
      data-frame={frame}
      className={cn(
        bare
          ? "bg-transparent"
          : "overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] shadow-[var(--e2)]",
        className,
      )}
    >
      {/* Bare: the notice keeps its own line, and the support word now shares a line with the
          interactive chips instead — see the status row below. The earlier arrangement paired
          the notice with the support word, because on a source-only answer they were two
          stacked banners saying the same thing above a four-line answer. That pairing is gone,
          and so is the height it saved on a model-written answer: the row count there is a wash
          (`[notice] / [support + chips]` for `[notice + support] / [chips]`). The saving is real
          only on a source-only answer, where the notice is `hidden print:flex` and two rows
          genuinely become one. The degraded banner still takes its own line via `w-full`. */}
      <div
        className={cn(
          bare
            ? // Indented onto the prose column, not the page edge: the notice
              // describes the message beside the assistant badge, so it has to
              // start where that message starts. Token, because the badge is
              // declared in a different component.
              "flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            : cn("space-y-2 border-b border-[color:var(--border)]", panelX, panelY),
        )}
      >
        {query ? <AnswerCardQueryEcho query={query} /> : null}
        {/* Above the prose and above the actions, in document order, on screen
            and on print alike — unless the content owner has taken placement,
            in which case it renders the same notice below the answer. */}
        {verificationPlacement === "header" ? <VerificationNotice {...verification} /> : null}
        {/* One status row, not two. The support word and the interactive chips share a line and
            wrap together only when they genuinely do not fit.

            The row is still `w-full`, and that is what makes sharing a line safe. The earlier
            note here was right that a 48px control cannot be bought inside a 24px baseline-
            aligned line without a negative margin, and that a negative margin puts the hit
            region outside the layout box where it silently covers its neighbours. The fix is
            not to give the chips their own row — it is to stop asking a 24px line to hold
            them. This row is centre-aligned and takes its height from the tallest child, so
            the 48px chip sets the height honestly and the static support pill centres inside
            it. On a source-only answer — where `VerificationNotice` is `hidden print:flex` —
            two stacked rows become one and ~24px comes back to the `#227` phone scroll budget.
            On a model-written answer the notice takes the line the support word vacated, so
            the height is a wash rather than a saving. */}
        {bare ? (
          <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
            {supportChip}
            {metaChips}
          </div>
        ) : (
          supportChip
        )}
        {/*
         * Ledger `#227` over `#207`, decided 3 Aug 2026. `#207` required a banner on
         * every degraded state, on the reasoning that an adoption failure here is
         * silent — "the card renders, the prose is fine, and the caution the product
         * shows today is simply gone". That reasoning holds only where the banner is
         * the sole carrier of the caution, and it is not: `VerificationNotice` states
         * `ungrounded` in words, while the source-only disclosure carries the same
         * governed wording for extractive answers. For those two kinds the banner
         * would restate it almost verbatim. `#227` measured the cost of the
         * duplicate on a one-sentence answer — three renderings of one warning,
         * eleven lines of caution around one line of answer, 147px of scroll against
         * a phone budget of 8. Three identical alarms teach a reader to skip all
         * three, so the duplicate is the dangerous outcome, not the omission.
         *
         * The banner survives for exactly the two kinds where it says something the
         * notice cannot: `stale_evidence` names WHICH sources are overdue,
         * `partial_retrieval` names HOW MUCH was missed. The caution itself is never
         * lost for any kind — it is carried by the notice and by `data-state`.
         *
         * `onOpenSource` stays required for every degraded state (DECISIONS §Q1): a
         * degraded answer must remain re-verifiable whether or not a banner renders.
         */}
        {retrievalStatePlacement === "header" &&
        (state.kind === "stale_evidence" || state.kind === "partial_retrieval") ? (
          <div className={bare ? "w-full" : undefined}>
            <RetrievalStateBanner
              state={state}
              onOpenSource={onOpenSource as (sourceId: string, locator?: string) => void}
            />
          </div>
        ) : null}
        {/* After the retrieval banner, not before it. `stale_evidence` and
            `partial_retrieval` banners name WHICH sources are overdue and HOW
            MUCH was missed, and a governed caution that specific should not be
            pushed down the page by an expanded disclosure — three open gaps
            move it roughly 200px at 390px. The disclosure is the reader's own
            request; the banner is the one they did not ask for and most need. */}
        {bare && metaDetail ? <div className="w-full">{metaDetail}</div> : null}
      </div>
      <div
        className={cn(
          bare ? "pt-1.5" : panelX,
          // Header already ends with py-3; keep a tight seam to the prose so the
          // card does not reintroduce the old space-y-3 gap as 24px of stacked pad.
          bare ? null : "pt-2 pb-3",
          // Prose measure is a hard ceiling: an answer that runs the full width of a
          // desktop viewport is unreadable regardless of type size.
          "max-w-[var(--measure)] text-[length:var(--text-md)] leading-prose text-[color:var(--text)]",
        )}
      >
        {children}
      </div>
      {actions?.length ? (
        <div className={cn("flex flex-wrap gap-2", bare ? "pt-2" : cn(panelX, "pb-3"))}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              data-testid="answer-card-action"
              onClick={action.onActivate}
              className="inline-flex min-h-tap items-center rounded-[var(--radius-md)] border border-[color:var(--border-lux)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {provenance ? <AnswerFooter {...provenance} /> : null}
    </article>
  );
}

/**
 * The caveat a copied or exported answer carries with it. Copy is an audit
 * artefact: it leaves the app, loses the banner, and is pasted into notes that
 * outlive the session, so the degraded state has to travel in the text itself.
 * Provenance goes through `clipboardProvenanceLine()` so there is exactly one
 * implementation of the audit line.
 */
export type ClipboardSourceRef = {
  title: string;
  locator?: string;
  /** Absolute or app-relative link back to the cited document. */
  href?: string;
};

export function answerClipboardText({
  body,
  state,
  sourceOnly,
  sources,
  metadata,
}: {
  body: string;
  state: AnswerState;
  /**
   * True when the answer was assembled from source passages rather than written
   * by a model. It cannot be inferred from `state`: `#207` precedence puts
   * `ungrounded` above `source_only`, so an extractive answer that is also
   * weakly supported reports `ungrounded`, and keying attribution on the kind
   * pastes "AI-generated" over passages no model wrote — a false provenance
   * claim in a clinical record. The product composer takes the same explicit
   * flag for the same reason (`@/lib/answer-clipboard`); this primitive was left
   * without one, which mattered the moment `AnswerCard` acquired its first
   * product mount (ledger `#216`).
   */
  sourceOnly?: boolean;
  /** The cited documents, enumerated so the paste can be audited away from the app. */
  sources?: readonly ClipboardSourceRef[];
  /**
   * Provenance for a SINGLE document. Emitted only when it cannot contradict the
   * state — see below.
   */
  metadata?: SourceMetadataInput;
}) {
  // Attribution and the verify instruction are unconditional, including on
  // `ready`. A copied answer loses the banner, the notice and the links, so
  // clinical prose with nothing attached reads in a record as though a clinician
  // wrote and endorsed it. This deliberately exceeds SPEC §13 slice 8, which
  // scoped the copied caveat to non-ready states; see docs/design-system/SPEC.md.
  //
  // Attribution, the degraded caveat and the provenance suppression rule live in
  // `@/lib/answer-clipboard` so this primitive and the product composer (#208)
  // cannot drift apart — one implementation of each rule, two callers.
  const verify = "Verify against the linked source documents before clinical use.";

  const sourceList = sources?.length
    ? ["Sources for review:", ...sources.map((source) => `- ${clipboardSourceLine(source)}`)].join("\n")
    : null;

  return [
    body.trim(),
    `${answerStateAttribution(state, { sourceOnly })} ${verify}`,
    answerClipboardCaveatLine(state),
    sourceList,
    answerClipboardProvenanceLine(state, metadata),
  ]
    .filter(Boolean)
    .join("\n");
}

function clipboardSourceLine({ title, locator, href }: ClipboardSourceRef) {
  const label = [title.trim(), locator?.trim()].filter(Boolean).join(", ");
  return href?.trim() ? `${label} — ${href.trim()}` : label;
}

export {
  DoseLine,
  type DoseLineProps,
  type DoseRow,
  type DoseSourceRef,
  type DoseQuantity,
} from "@/components/ui/dose-line";

export { AnswerFooter, type AnswerFooterProps } from "@/components/answer/AnswerFooter";
