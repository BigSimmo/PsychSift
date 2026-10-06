"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  CornerUpLeft,
  ExternalLink,
  FileText,
  Filter,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
  ThumbsDown,
  TriangleAlert,
  X,
} from "lucide-react";

import { cn } from "@/components/ui-primitives";
import {
  Composer,
  DesktopFrame,
  DetailCard,
  Panel,
  PHONE_WIDTH,
  PhoneFrame,
  PROSE_MEASURE,
  TopBar,
  UserTurn,
  focusRing,
  type MockSource,
  type SourceStatus,
} from "@/components/answer-chat-perfected-mockups";

/**
 * Direction A, second pass — the states, not the specimen.
 *
 * /mockups/answer-chat-perfected draws one answer: model-written, confident,
 * three sources, every claim numbered. It draws it well, and the two decisions
 * it argues for — one colour for the mark, one source at a time in the drawer —
 * are kept here unchanged.
 *
 * This page exists because the payload produces at least five materially
 * different answers and that page draws one of them. On the only measurement
 * the handover cites (30 blinded pairs, 2026-08-18) twenty were `source_only`:
 * assembled without the model, carrying no sections, and therefore carrying no
 * numbers at all. The state the rail exists to serve was never drawn.
 *
 * It also corrects four things that were checked against the code rather than
 * assumed:
 *
 *  1. The mark's tap target overlapped its neighbours — vertically with the
 *     marks on the line above, horizontally with the other half of its own
 *     cluster. A tap between two numbers could open the wrong source.
 *  2. In forced-colors the active ring (a box-shadow) and the claim wash (a
 *     background) are not painted, so the mechanism that holds the reader's
 *     place silently disappeared.
 *  3. The streaming frame drew a typewriter caret. The stream contract excludes
 *     token events by name because they would re-expose unvalidated clinical
 *     prose. What actually arrives first is the evidence.
 *  4. The pager printed one button per source and the render policy allows six.
 *
 * Nothing here is wired to real retrieval. All copy is synthetic.
 */

/* ══════════════════════  data  ══════════════════════ */

/** `AnswerSection.supportLevel` in `src/lib/types.ts`, verbatim. It decides
 *  whether a claim may carry a number at all, which makes it the most
 *  actionable field on the surface — the first pass struck it as "never
 *  actionable" and deleted it from the drawer. */
type SupportLevel = "direct" | "partial" | "nearby" | "unsupported";

/** `AnswerState` in `src/lib/answer-state-types.ts`, minus `ungrounded`
 *  (which renders as `source_only` plus a stronger notice). */
type AnswerStateKind = "ready" | "source_only" | "stale_evidence" | "partial_retrieval";

type V2Source = MockSource & { missing?: boolean };

const S = (
  id: string,
  index: number,
  short: string,
  title: string,
  origin: string,
  page: number,
  status: SourceStatus,
  quote: string,
  extra: Partial<V2Source> = {},
): V2Source => ({ id, index, short, title, origin, page, status, support: "Direct", quote, ...extra });

const SIX_SOURCES: V2Source[] = [
  S(
    "s1",
    1,
    "Physical health protocol",
    "Clozapine physical health monitoring protocol",
    "Statewide mental health · 2025",
    12,
    "current",
    "Full blood count and absolute neutrophil count are taken at baseline, weekly for the first 18 weeks, fortnightly to week 52, and monthly thereafter while treatment continues.",
    { attachment: { kind: "table", label: "Monitoring schedule" } },
  ),
  S(
    "s2",
    2,
    "Myocarditis surveillance",
    "Clozapine myocarditis surveillance schedule",
    "Local formulary · 2025",
    14,
    "current",
    "Troponin and CRP are measured at baseline and weekly for the first four weeks. Seek urgent cardiology review where troponin exceeds twice the upper limit of normal.",
  ),
  S(
    "s3",
    3,
    "Shared-care metabolic",
    "Shared-care metabolic follow-up checklist",
    "Community mental health · 2023",
    7,
    "review-due",
    "Weight, waist circumference, lipids and HbA1c are recorded at baseline, at three months, and annually thereafter under shared-care arrangements with the general practitioner.",
    { support: "Partial" },
  ),
  S(
    "s4",
    4,
    "Neutropenia thresholds",
    "Haematological monitoring thresholds and actions",
    "Statewide mental health · 2025",
    19,
    "current",
    "Withhold the dose and escalate the same day where the absolute neutrophil count falls below 1.5 × 10⁹/L. Do not restart without haematology advice.",
  ),
  S(
    "s5",
    5,
    "Constipation pathway",
    "Clozapine-induced gastrointestinal hypomotility pathway",
    "Local formulary · 2024",
    3,
    "current",
    "Prophylactic aperients are started with clozapine and continued for the duration of treatment. Bowel habit is asked about at every review.",
  ),
  S(
    "s6",
    6,
    "GP handback criteria",
    "Shared-care handback and re-referral criteria",
    "Community mental health · 2022",
    5,
    "review-due",
    "Handback to general practice is considered after twelve months of stable dosing, unbroken monitoring and no haematological events.",
    { support: "Partial" },
  ),
];

const THREE_SOURCES = SIX_SOURCES.slice(0, 3);

const sourceIn = (pool: V2Source[], id: string) => pool.find((source) => source.id === id) ?? pool[0];

type V2Section = {
  id: string;
  /** `AnswerSection.kind`. `bottom_line` leads and is never given a heading —
   *  a run-in label above the first sentence of an answer is noise. */
  kind: "bottom_line" | "monitoring_timing" | "escalation_risk" | "documentation" | "source_gap";
  heading: string | null;
  text: string;
  sourceIds: string[];
  support: SupportLevel;
  safety?: boolean;
};

/** A model-synthesis answer as the payload actually shapes it: headed sections,
 *  each with its own citation ids and its own support level. */
const SECTIONS: V2Section[] = [
  {
    id: "n1",
    kind: "bottom_line",
    heading: null,
    text: "Three tracks run through the first year — haematological, cardiac and metabolic — and only the first is inflexible.",
    sourceIds: ["s1"],
    support: "direct",
  },
  {
    id: "n2",
    kind: "monitoring_timing",
    heading: "Bloods",
    text: "FBC and ANC at baseline, weekly for the first 18 weeks, fortnightly to week 52, then monthly while treatment continues.",
    sourceIds: ["s1"],
    support: "direct",
  },
  {
    id: "n3",
    kind: "monitoring_timing",
    heading: "Cardiac",
    text: "Troponin and CRP at baseline and weekly for the first four weeks, with urgent review for fever, chest pain or breathlessness.",
    sourceIds: ["s1", "s2"],
    support: "direct",
  },
  {
    id: "n4",
    kind: "monitoring_timing",
    heading: "Metabolic",
    text: "Weight, waist, lipids and HbA1c at baseline, three months and annually, usually under shared care with the GP.",
    sourceIds: ["s3"],
    support: "partial",
  },
  {
    id: "n5",
    kind: "escalation_risk",
    heading: null,
    text: "Withhold the dose and escalate the same day if the ANC falls below 1.5 × 10⁹/L.",
    sourceIds: ["s1"],
    support: "direct",
    safety: true,
  },
  {
    id: "n6",
    kind: "source_gap",
    heading: null,
    text: "Routine ECG beyond the first four weeks is not specified in your indexed documents.",
    sourceIds: [],
    support: "unsupported",
  },
];

/** The same question answered without the model: passages stitched into prose,
 *  no sections, and therefore no claim-level attribution to draw. */
const SOURCE_ONLY_PROSE =
  "Your documents describe full blood count and absolute neutrophil count at baseline, weekly for the first 18 weeks and fortnightly to week 52; troponin and CRP weekly for the first four weeks; and weight, lipids and HbA1c at baseline, three months and annually.";

/* ══════════════════════  the mark  ══════════════════════ */

/**
 * The tap target, corrected.
 *
 * The first pass extended the target 14px above and below a ~10px glyph. Prose
 * at this size sets on a ~25px line, so consecutive lines' targets overlapped by
 * about 3px, and inside a cluster the ±6px horizontal extensions overlapped
 * across the comma. Both mean a tap can land on a number and open its
 * neighbour's source.
 *
 * The honest ceiling for an inline mark is the line box: anything taller is
 * stolen from the line above. That is ~25px, not the repo's 48px production
 * standard, and it cannot be fixed by wanting it to be bigger. It is the
 * strongest argument the rail has — every source is reachable a second time
 * from a card at full tap size, and on a source-only answer the rail is the
 * only way in.
 */
function MarkHit({ place }: { place: "only" | "first" | "middle" | "last" }) {
  const reachLeft = place === "only" || place === "first" ? 10 : 2;
  const reachRight = place === "only" || place === "last" ? 10 : 2;
  return (
    <span
      aria-hidden="true"
      style={{ position: "absolute", top: -7, bottom: -8, left: -reachLeft, right: -reachRight }}
    />
  );
}

/**
 * One colour, as decided. What changes is not hue but whether a number is
 * earned: `direct` prints the number, `partial` prints it under a dotted rule,
 * and `nearby`/`unsupported` never print one at all.
 *
 * Forced-colors: the active state is an `outline`, not a `box-shadow`. Box
 * shadows are not painted in that mode, so the first pass's ring vanished and
 * an open mark was indistinguishable from a closed one.
 */
function V2Mark({
  source,
  support,
  active,
  place = "only",
  onOpen,
}: {
  source: V2Source;
  support: SupportLevel;
  active: boolean;
  place?: "only" | "first" | "middle" | "last";
  onOpen: () => void;
}) {
  const partial = support === "partial";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen();
      }}
      aria-label={`Source ${source.index}, ${source.short}, page ${source.page}${partial ? ", partial support" : ""}`}
      aria-pressed={active}
      title={`${source.short} · p.${source.page}`}
      style={{
        fontSize: "0.7em",
        verticalAlign: "super",
        lineHeight: 0,
        padding: "0.2em 0.13em",
        borderRadius: 3,
        top: 0,

        ...(active ? { background: "var(--clinical-accent-soft)", outline: "1px solid var(--clinical-accent)" } : null),
      }}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center font-semibold tabular-nums transition",
        "text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]",
        focusRing,
      )}
    >
      {source.index}
      {/* Partial support. A dotted underline and a 1px bottom border were both
          tried and neither is drawn under a 0.7em glyph with line-height 0 —
          checked in the browser, not assumed. One glyph reads at any size, in
          any contrast mode, and the drawer says what it means in words. */}
      {partial ? <span aria-hidden="true">*</span> : null}
      <MarkHit place={place} />
    </button>
  );
}

/**
 * The two levels that never get a number, and they are not the same thing.
 *
 * `nearby` retrieved something related that does not state the claim: still a
 * control, because the reader should be able to go and see what it does say.
 * `unsupported` found nothing at all: a statement, not a control, because there
 * is nowhere for it to lead. Both say it in words — never a number, never
 * silence, and never a second hue inside the running prose.
 */
function WordMark({ onOpen }: { onOpen?: () => void }) {
  const style = {
    fontSize: "0.72em",
    verticalAlign: "super",
    lineHeight: 0,
    marginLeft: "0.1em",
  } as const;
  const className = "font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]";
  return (
    <span className="whitespace-nowrap">
      {" "}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Related source — does not state this claim"
          style={{ ...style, textDecoration: "underline", textUnderlineOffset: "0.2em" }}
          className={cn("relative", className, "hover:text-[color:var(--clinical-accent)]", focusRing)}
        >
          related
          <MarkHit place="only" />
        </button>
      ) : (
        <span style={style} className={className}>
          no source
        </span>
      )}
    </span>
  );
}

/**
 * Marks bound to the end of a claim.
 *
 * Production prose runs through `SafeBoldText` and carries `**bold**`, so the
 * final word can sit inside a span where a string split cannot reach it. The
 * lift must bind the cluster to a trailing anchor emitted by the renderer, not
 * to `lastIndexOf(" ")`. Here the split is honest because the copy is plain,
 * and the cluster is capped so a claim on four documents cannot produce an
 * unbreakable run wider than a phone column.
 */
function MarkedText({
  section,
  pool,
  activeId,
  onOpen,
}: {
  section: V2Section;
  pool: V2Source[];
  activeId: string | null;
  onOpen: (id: string, sectionId?: string | null) => void;
}) {
  if (section.support === "unsupported" || section.support === "nearby" || section.sourceIds.length === 0) {
    const nearbyId = section.support === "nearby" ? section.sourceIds[0] : undefined;
    return (
      <>
        {section.text}
        <WordMark onOpen={nearbyId ? () => onOpen(nearbyId, section.id) : undefined} />
      </>
    );
  }
  const shown = section.sourceIds.slice(0, 2);
  const overflow = section.sourceIds.length - shown.length;
  const cut = section.text.lastIndexOf(" ");
  const head = cut < 0 ? "" : section.text.slice(0, cut + 1);
  const tail = cut < 0 ? section.text : section.text.slice(cut + 1);
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        {shown.map((id, index) => {
          const source = sourceIn(pool, id);
          const place =
            shown.length === 1 && overflow === 0
              ? "only"
              : index === 0
                ? "first"
                : index === shown.length - 1 && overflow === 0
                  ? "last"
                  : "middle";
          return (
            <span key={id}>
              {index > 0 ? <MarkComma /> : null}
              <V2Mark
                source={source}
                support={section.support}
                active={activeId === source.id}
                place={place}
                onOpen={() => onOpen(source.id, section.id)}
              />
            </span>
          );
        })}
        {overflow > 0 ? (
          <>
            <MarkComma />
            <button
              type="button"
              onClick={() => onOpen(section.sourceIds[shown.length], section.id)}
              aria-label={`${overflow} more sources for this claim`}
              style={{ fontSize: "0.7em", verticalAlign: "super", lineHeight: 0, padding: "0.2em 0.13em" }}
              className={cn(
                "relative inline-flex font-semibold tabular-nums text-[color:var(--text-muted)] hover:text-[color:var(--clinical-accent)]",
                focusRing,
              )}
            >
              +{overflow}
              <MarkHit place="last" />
            </button>
          </>
        ) : null}
      </span>
    </>
  );
}

function MarkComma() {
  return (
    <span
      aria-hidden="true"
      style={{ fontSize: "0.7em", verticalAlign: "super", lineHeight: 0, margin: "0 -0.02em" }}
      className="text-[color:var(--text-soft)]"
    >
      ,
    </span>
  );
}

/* ══════════════════════  the rail  ══════════════════════ */

function statusWord(status: SourceStatus) {
  return status === "current" ? "Current" : "Review due";
}

/**
 * The rail, at production tap size.
 *
 * `min-h-12` here, not the `min-h-11` the first pass carried. Mockups are
 * exempt from that gate and production is not, and the rail is the one place on
 * this surface where a full 48px target is actually available — the inline mark
 * can never have one. Under-sizing it here would be designing away the only
 * compliant path to a source.
 *
 * `compact` is the answer to `compactCitations`, which currently shrinks a
 * capsule that this design deletes: collapse to a single chip that expands,
 * rather than letting the preference become a silent no-op.
 */
/**
 * The card row scrolls and has to say so without a scrollbar.
 *
 * Same mechanism the shipped composer already uses for its suggestion chips
 * (`.answer-suggestion-chips-scroll` in `globals.css`): a mask that fades the
 * last stretch of whatever is under it, so it reads correctly on light, on dark
 * and on the drawer's tinted surface alike. A painted gradient overlay would
 * have to name the colour behind it and would name the wrong one on at least
 * one of those three.
 *
 * Written as an inline style rather than an arbitrary Tailwind property because
 * `[mask-image:…]` did not generate a rule here — the class landed on the
 * element and the computed value stayed `none`. Checked in the browser, not
 * assumed. Like its shipped sibling it keeps the fade under forced colours; a
 * mask is not a paint, so unlike the ring and the claim wash it survives there.
 */
const RAIL_SCROLL_FADE = {
  scrollbarWidth: "none",
  maskImage: "linear-gradient(90deg, black calc(100% - 1.75rem), transparent)",
  WebkitMaskImage: "linear-gradient(90deg, black calc(100% - 1.75rem), transparent)",
} as const;

function V2Rail({
  pool,
  activeId,
  onOpen,
  compact = false,
  unnumbered = false,
}: {
  pool: V2Source[];
  activeId: string | null;
  onOpen: (id: string) => void;
  compact?: boolean;
  /** Preview cards carry no number. The preview is the top slice of the
   *  retrieval results in retrieval order (`buildEvidencePreviewUnit`), while
   *  the final list is rebuilt from what the answer actually cites and capped by
   *  trust (`collectSourceCandidates` / `dedupeSourceLinks`). Different sets in a
   *  different order — so a number assigned at preview time can point at a
   *  different document once the answer lands, which is the precise failure this
   *  design exists to prevent. Numbering is what arrival buys. */
  unnumbered?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={cn(
          "inline-flex min-h-12 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-2xs font-semibold text-[color:var(--text-heading)]",
          focusRing,
        )}
      >
        Sources
        <span className="rounded-full bg-[color:var(--clinical-accent-soft)] px-1.5 text-3xs tabular-nums text-[color:var(--clinical-accent)]">
          {pool.length}
        </span>
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label={`Sources behind this answer, ${pool.length}`}
      className="flex gap-1.5 overflow-x-auto pb-1"
      style={RAIL_SCROLL_FADE}
    >
      {pool.map((source) => (
        <button
          key={source.id}
          type="button"
          onClick={() => onOpen(source.id)}
          aria-pressed={activeId === source.id}
          className={cn(
            "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border bg-[color:var(--surface-raised)] px-2.5 text-left transition hover:shadow-[var(--e1)]",
            activeId === source.id
              ? "border-[color:var(--clinical-accent)] shadow-[var(--e1)]"
              : "border-[color:var(--border)] hover:border-[color:var(--border-strong)]",
            focusRing,
          )}
        >
          <span
            aria-hidden={unnumbered ? "true" : undefined}
            className={cn(
              "grid h-5 min-w-5 place-items-center rounded-md border text-3xs font-bold tabular-nums",
              unnumbered
                ? "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-soft)]"
                : source.status === "review-due"
                  ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                  : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
            )}
          >
            {unnumbered ? "\u2022" : source.index}
          </span>
          <span className="min-w-0">
            <span
              style={{ maxWidth: 160 }}
              className="block truncate text-2xs font-semibold leading-4 text-[color:var(--text-heading)]"
            >
              {source.short}
            </span>
            <span className="block text-3xs leading-4 text-[color:var(--text-muted)]">
              <span className="font-mono tabular-nums">p.{source.page}</span> · {statusWord(source.status)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════  the drawer  ══════════════════════ */

/**
 * One source at a time, as decided. Three changes.
 *
 * The pager printed a button per source; the render policy caps primary sources
 * at six, and six buttons plus prev, next, overflow and close need ~396px inside
 * a ~362px phone drawer. Above four it becomes a counter and the rail behind
 * keeps random access.
 *
 * Support comes back as one clause of words. If support decides whether a claim
 * may carry a number, the reader is owed the reason a number is dotted or absent
 * at the moment they open the page it points at.
 *
 * The menu carries the report. `evidence-panels.tsx` already ships the taxonomy
 * — wrong_source, missing_source, numeric_error — and the moment a clinician
 * opens a cited page and finds it does not say the thing is the highest-value
 * moment in the product to catch a bad citation.
 *
 * The lift builds this on `src/components/ui/sheet.tsx`, which already portals,
 * traps focus, returns it late, and is a bottom sheet on phone and a centred
 * dialog from `sm:` up. This frame is a drawing of that, not a second
 * implementation of it.
 */
function V2Drawer({
  pool,
  openId,
  support,
  onSelect,
  onClose,
  wide,
}: {
  pool: V2Source[];
  openId: string | null;
  support: SupportLevel | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  wide: boolean;
}) {
  if (openId === null) return null;
  // Keyed on the source: the panel's own transient state (an open menu)
  // belongs to that source and is discarded when you move to another.
  return (
    <V2DrawerPanel
      key={openId}
      pool={pool}
      openId={openId}
      support={support}
      onSelect={onSelect}
      onClose={onClose}
      wide={wide}
    />
  );
}

function V2DrawerPanel({
  pool,
  openId,
  support,
  onSelect,
  onClose,
  wide,
}: {
  pool: V2Source[];
  openId: string;
  support: SupportLevel | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  wide: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const source = sourceIn(pool, openId);
  const position = pool.findIndex((item) => item.id === openId);
  const step = (delta: number) => onSelect(pool[(position + delta + pool.length) % pool.length].id);
  const numericPager = pool.length <= 4;

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close source"
        onClick={onClose}
        className="min-h-0 w-full flex-1 cursor-default bg-[color:var(--overlay-backdrop)] motion-safe:animate-overlay-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Source ${source.index} of ${pool.length}`}
        className={cn(
          "flex min-h-0 flex-col rounded-t-2xl border-t border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--shadow-elevated)] motion-safe:animate-sheet-up",
          wide && "mx-auto w-full rounded-2xl border",
        )}
        style={{ maxHeight: "78%", ...(wide ? { maxWidth: 560, marginBottom: 16 } : null) }}
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-[color:var(--border-strong)]" />

        <div style={{ paddingBottom: 6 }} className="flex items-center gap-1 px-2 pt-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous source"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>

          {numericPager ? (
            pool.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-label={`Show source ${item.index}, ${item.short}`}
                aria-current={item.id === openId}
                style={{ minWidth: 36 }}
                className={cn(
                  "relative grid h-9 place-items-center rounded-full text-2xs font-bold tabular-nums transition",
                  item.id === openId
                    ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                  focusRing,
                )}
              >
                {item.index}
                {item.status === "review-due" ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      bottom: 5,
                      height: 4,
                      width: 4,
                      borderRadius: 999,
                      background: "var(--warning)",
                    }}
                  />
                ) : null}
              </button>
            ))
          ) : (
            <span
              aria-live="polite"
              className="px-1.5 text-2xs font-semibold tabular-nums text-[color:var(--text-heading)]"
            >
              {source.index} of {pool.length}
            </span>
          )}

          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next source"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>

          <span className="flex-1" />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="More actions for this source"
              aria-expanded={menuOpen}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
                focusRing,
              )}
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div
                style={{ position: "absolute", right: 0, bottom: 42, width: 236 }}
                className="z-30 overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] py-1 shadow-[var(--shadow-elevated)] motion-safe:animate-pop-in"
              >
                {[
                  { label: "Copy passage", Icon: Copy, warn: false },
                  { label: "Search only this document", Icon: Filter, warn: false },
                  { label: "Ask about this passage", Icon: Search, warn: false },
                  { label: "This page doesn't support the claim", Icon: ThumbsDown, warn: true },
                ].map(({ label, Icon, warn }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-2.5 px-3 text-left text-2xs font-medium transition hover:bg-[color:var(--surface-subtle)]",
                      warn
                        ? "border-t border-[color:var(--border)] text-[color:var(--text-heading)]"
                        : "text-[color:var(--text)]",
                      focusRing,
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "h-3.5 w-3.5",
                        warn ? "text-[color:var(--warning)]" : "text-[color:var(--text-muted)]",
                      )}
                    />
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <h2 className="text-base font-semibold leading-5 text-[color:var(--text-heading)]">{source.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-[color:var(--text-muted)]">
            <span className="font-mono tabular-nums">p.{source.page}</span>
            <span aria-hidden="true">·</span>
            <span>{source.origin}</span>
            <span aria-hidden="true">·</span>
            <span
              className={cn(
                "font-semibold",
                source.status === "review-due" ? "text-[color:var(--warning)]" : "text-[color:var(--success)]",
              )}
            >
              {source.status === "review-due" ? "Past review date" : "Current"}
            </span>
          </p>

          {/* The support clause. One line, in words — the reason this claim's
              number is plain, marked, or absent, stated where it is checked.
              Support is a property of a claim, so when the drawer was opened
              from the rail or the pager there is no claim to describe and the
              clause is omitted rather than guessed. */}
          <p className="mt-2 text-2xs leading-5 text-[color:var(--text-muted)]">
            {support === null
              ? "Opened from the source list, so this is the document, not a claim."
              : support === "direct"
                ? "This page states the claim directly."
                : support === "partial"
                  ? "This page supports part of the claim. Read the passage before relying on the rest."
                  : "Related to the question — this page does not state the claim."}
          </p>

          <blockquote className="mt-3 border-l-2 border-[color:var(--clinical-accent)] pl-3 text-base-minus leading-prose text-[color:var(--text-heading)]">
            {source.quote}
          </blockquote>

          {source.attachment ? (
            <button
              type="button"
              onClick={() => undefined}
              className={cn(
                "mt-3 inline-flex min-h-12 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-semibold text-[color:var(--text)] transition hover:border-[color:var(--clinical-accent-border)]",
                focusRing,
              )}
            >
              <Table2 aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" />
              {source.attachment.label}
              <span className="font-normal text-[color:var(--text-muted)]">on this page</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => undefined}
            className={cn(
              "mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--command-hover)]",
              focusRing,
            )}
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            Open page {source.page}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════  answer-level chrome  ══════════════════════ */

/**
 * The verification notice sits ABOVE the prose.
 *
 * The first pass put a quiet line underneath it. `answer-result-surface.tsx`
 * records the opposite, with reasons: system-owned verification wording is
 * placed above the answer in document order, on screen and print alike, and its
 * attribution is read from `answerQualityTier` so it can never announce
 * "AI-generated" above a notice saying no model wrote this. Drawn below, this
 * design would be sent back at review.
 */
function VerificationNotice({ kind, sourceCount }: { kind: AnswerStateKind; sourceCount: number }) {
  const model = kind !== "source_only";
  // Two deliberate lines, not one sentence left to wrap wherever the column
  // ends. With the avatar gone this line is what identifies the turn, and it
  // was breaking mid-phrase — "…check each" / "number against its page" — which
  // reads as a layout accident rather than as provenance. Split at the
  // separator the sentence already carries: what wrote it, then what the reader
  // owes it. Same words.
  return (
    <p className="text-3xs leading-4 text-[color:var(--text-muted)]">
      <span className="font-semibold">
        {model ? `AI-generated from ${sourceCount} cited sources` : "Assembled from your documents"}
      </span>
      <span className="block">
        {model ? "Check each number against its page" : "Check each statement against its source"}
      </span>
    </p>
  );
}

/**
 * `stale_evidence` and `partial_retrieval` carry the full banner: each says
 * something the verification notice cannot, and each owes a route back to a
 * cited page, because a degraded `AnswerCard` requires `onOpenSource` — a
 * caution is never raised with nowhere to go.
 *
 * `source_only` does not get that treatment. Production carries it as a compact
 * amber disclosure that expands (`source-only-disclosure` in
 * `answer-content.tsx`), and the notice above already names the attribution, so
 * a full banner here would print the same sentence twice (`#227`). Compact, and
 * no route of its own: on this state the rail is the route.
 */
function SourceOnlyDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <section
      role="note"
      className="w-fit max-w-full overflow-hidden rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn("inline-flex min-h-12 w-full items-center gap-1.5 px-2.5 text-left text-2xs", focusRing)}
      >
        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--warning)]" />
        <span className="font-semibold text-[color:var(--text-heading)]">Source-only</span>
        <span className="text-[color:var(--text-muted)]">· verify passages</span>
      </button>
      {open ? (
        <p className="border-t border-[color:var(--warning-border)] px-2.5 py-2 text-2xs leading-5 text-[color:var(--text-muted)]">
          Assembled from your documents without the AI model, so it may be less complete. Verify dose, threshold, timing
          and monitoring against the cited passages.
        </p>
      ) : null}
    </section>
  );
}

function StateBanner({ kind, onOpenSource }: { kind: AnswerStateKind; onOpenSource: () => void }) {
  if (kind === "source_only") return <SourceOnlyDisclosure />;
  if (kind === "ready") return null;
  const copy: Record<
    Exclude<AnswerStateKind, "ready" | "source_only">,
    { title: string; body: string; action: string }
  > = {
    stale_evidence: {
      title: "1 of 3 sources is past its review date",
      body: "Source 3 has not been reviewed since 2023. The metabolic claim rests on it and may not reflect current practice.",
      action: "Open source 3",
    },
    partial_retrieval: {
      title: "Retrieved 2 of 4 selected sources",
      body: "Two documents could not be read for this answer. What is below rests on the two that were, and the metabolic track is not covered.",
      action: "Open source 1",
    },
  };
  const { title, body, action } = copy[kind];
  return (
    <section
      role="note"
      className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-2.5 py-2"
    >
      <p className="flex items-center gap-1.5 text-2xs font-semibold text-[color:var(--text-heading)]">
        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--warning)]" />
        {title}
      </p>
      <p className="mt-1 text-2xs leading-5 text-[color:var(--text-muted)]">{body}</p>
      <button
        type="button"
        onClick={onOpenSource}
        className={cn(
          "mt-1.5 inline-flex min-h-12 items-center gap-1.5 text-2xs font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2",
          focusRing,
        )}
      >
        {action}
      </button>
    </section>
  );
}

function ActionRow() {
  return (
    <div className="flex items-center gap-0.5">
      {[
        { key: "copy", label: "Copy with sources", Icon: Copy },
        { key: "ask", label: "Follow up", Icon: CornerUpLeft },
      ].map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => undefined}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-2xs font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
            focusRing,
          )}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════  the message  ══════════════════════ */

/** Sections keep their headings. The payload delivers them and the first pass
 *  discarded them: `bottom_line` leads unheaded, the timing sections take a
 *  quiet run-in label so the prose still reads as prose rather than as a form,
 *  and `source_gap` is the natural home for the worded mark. */
function SectionProse({
  sections,
  pool,
  activeId,
  onOpen,
}: {
  sections: V2Section[];
  pool: V2Source[];
  activeId: string | null;
  onOpen: (id: string, sectionId?: string | null) => void;
}) {
  return (
    <div style={PROSE_MEASURE} className="space-y-2">
      {sections.map((section) => {
        const lit = activeId !== null && section.sourceIds.includes(activeId);
        return (
          <p
            key={section.id}
            style={{
              paddingTop: 3,
              paddingBottom: 3,
              ...(lit ? { borderLeft: "2px solid var(--clinical-accent)" } : null),
            }}
            className={cn(
              "-mx-2 rounded-lg px-2 text-base-minus leading-prose text-[color:var(--text-heading)] transition-colors",
              // The wash is a background and forced-colors remaps backgrounds, so
              // the rule on the left carries the same signal where paint cannot.
              lit ? "bg-[color:var(--clinical-accent-soft)]" : "bg-transparent",
              section.safety && "font-medium",
            )}
          >
            {section.safety ? (
              <ShieldAlert
                aria-hidden="true"
                style={{ top: -1 }}
                className="relative mr-1.5 inline-block h-4 w-4 text-[color:var(--warning)]"
              />
            ) : null}
            {section.heading ? (
              <span className="mr-1.5 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                {section.heading}
              </span>
            ) : null}
            <MarkedText section={section} pool={pool} activeId={activeId} onOpen={onOpen} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * Partial retrieval read two of four documents, so the metabolic track — the
 * one resting on source 3 — is simply not in the answer. A mark pointing at a
 * source the answer never retrieved is the failure this whole design exists to
 * avoid, so the frame drops the section rather than the citation.
 *
 * `source_only` carries none here, but **do not read that as an invariant.**
 * `applyProviderLabels` tags any model-less `routingMode: "extractive"` answer
 * `source_only`, and `buildExtractiveAnswer` passes `answerSections` straight
 * through — so a source-only answer can arrive WITH sections and their support
 * levels. Marks are therefore gated on the sections themselves, never on the
 * quality tier. One rule, no special case.
 */
const SECTIONS_BY_STATE: Record<AnswerStateKind, V2Section[]> = {
  ready: SECTIONS,
  source_only: [],
  stale_evidence: SECTIONS,
  partial_retrieval: [SECTIONS[0], SECTIONS[1], SECTIONS[2], SECTIONS[4]],
};

function AnswerScreen({
  kind,
  wide,
  pool = THREE_SOURCES,
  compactRail = false,
  initialOpenId = null,
  /** The claim whose mark opened the drawer. Null models a rail or pager open,
   *  which carries no claim — and the drawer then says so rather than guessing. */
  initialSectionId = null,
}: {
  kind: AnswerStateKind;
  wide: boolean;
  pool?: V2Source[];
  compactRail?: boolean;
  initialOpenId?: string | null;
  initialSectionId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [openSectionId, setOpenSectionId] = useState<string | null>(initialSectionId);
  const sections = SECTIONS_BY_STATE[kind];
  // Gated on the sections, not on `kind`. See SECTIONS_BY_STATE.
  const marks = sections.length > 0;
  // Support belongs to a claim, not to a source: one document can carry a claim
  // directly and another only partly. Resolve it from the section whose mark was
  // pressed, and leave it null when the drawer was opened from the rail or the
  // pager — those carry no claim, and inventing one is the exact failure this
  // design exists to prevent.
  const openSupport =
    openSectionId === null ? null : (sections.find((section) => section.id === openSectionId)?.support ?? null);
  const openSource = (id: string, sectionId?: string | null) =>
    setOpenId((current) => {
      const next = current === id ? null : id;
      setOpenSectionId(next === null ? null : (sectionId ?? null));
      return next;
    });

  return (
    <>
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("space-y-3 px-3 py-3", wide && "mx-auto w-full max-w-3xl px-5 py-5")}>
          <UserTurn />
          {/* No assistant avatar, and therefore no gutter behind it.
              An avatar column costs ~2.75rem of every line on a 390px screen
              and buys nothing a reader needs: there are only two speakers, the
              person's turn is already a right-aligned bubble, and the answer is
              the one thing on this surface that wants the full measure. Every
              mature chat product settled here for the same reason. What
              identifies the turn instead is the provenance line below — which
              is information, not decoration. */}
          <div className="pt-1.5">
            <div className="min-w-0 space-y-3">
              <VerificationNotice kind={kind} sourceCount={pool.length} />
              <StateBanner
                kind={kind}
                onOpenSource={() => openSource(pool[kind === "stale_evidence" ? 2 : 0].id, null)}
              />
              {marks ? (
                <SectionProse sections={sections} pool={pool} activeId={openId} onOpen={openSource} />
              ) : (
                <p style={PROSE_MEASURE} className="text-base-minus leading-prose text-[color:var(--text-heading)]">
                  {SOURCE_ONLY_PROSE}
                </p>
              )}
              <div className="space-y-1.5 border-t border-[color:var(--border)] pt-2.5">
                <p className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                  {kind === "partial_retrieval" ? "Sources read" : "Cited documents"}
                </p>
                <V2Rail pool={pool} activeId={openId} compact={compactRail} onOpen={(id) => openSource(id, null)} />
              </div>
              <ActionRow />
            </div>
          </div>
        </div>
      </div>
      <Composer />
      <V2Drawer
        pool={pool}
        openId={openId}
        support={openSupport}
        onSelect={(id) => {
          setOpenId(id);
          setOpenSectionId(null);
        }}
        onClose={() => {
          setOpenId(null);
          setOpenSectionId(null);
        }}
        wide={wide}
      />
    </>
  );
}

/* ══════════════════════  evidence first  ══════════════════════ */

/**
 * What actually arrives before the prose.
 *
 * `answer-stream-contract.ts` excludes token events by name, and the
 * incremental-delivery design rejects raw token delivery, provisional prose and
 * in-place revision outright: any of them can put a dose on screen before the
 * safety gates can take it off. So the typewriter caret the first pass drew is
 * not a state this product can be in.
 *
 * The evidence preview is. It lands after retrieval, ranking, owner-scope and
 * governance, it carries the trimmed sources, and the client already consumes
 * it. The rail can be numbered and on screen before there is an answer to
 * number — the fastest useful content this surface has, and nobody had drawn it.
 */
function PendingScreen({ stage }: { stage: "asked" | "evidence" | "answered" }) {
  return (
    <>
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 px-3 py-3">
          <UserTurn />
          {/* No assistant avatar, and therefore no gutter behind it.
              An avatar column costs ~2.75rem of every line on a 390px screen
              and buys nothing a reader needs: there are only two speakers, the
              person's turn is already a right-aligned bubble, and the answer is
              the one thing on this surface that wants the full measure. Every
              mature chat product settled here for the same reason. What
              identifies the turn instead is the provenance line below — which
              is information, not decoration. */}
          <div className="pt-1.5">
            <div className="min-w-0 space-y-3">
              {stage === "asked" ? (
                <p aria-live="polite" className="text-2xs text-[color:var(--text-muted)]">
                  Searching your documents…
                </p>
              ) : (
                <>
                  <p aria-live="polite" className="text-2xs text-[color:var(--text-muted)]">
                    {stage === "evidence" ? "3 sources found · writing the answer…" : null}
                  </p>
                  {stage === "answered" ? <VerificationNotice kind="ready" sourceCount={3} /> : null}
                  {stage === "answered" ? (
                    <SectionProse
                      sections={SECTIONS.slice(0, 4)}
                      pool={THREE_SOURCES}
                      activeId={null}
                      onOpen={() => undefined}
                    />
                  ) : (
                    <div aria-hidden="true" className="space-y-1.5">
                      {[92, 78, 86].map((width) => (
                        <span
                          key={width}
                          style={{ width: `${width}%`, height: 9, borderRadius: 4 }}
                          className="block bg-[color:var(--border)] motion-safe:animate-pulse"
                        />
                      ))}
                    </div>
                  )}
                  <V2Rail
                    pool={THREE_SOURCES}
                    activeId={null}
                    onOpen={() => undefined}
                    unnumbered={stage !== "answered"}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <Composer />
    </>
  );
}

/* ══════════════════════  specimens  ══════════════════════ */

const SUPPORT_ROWS: Array<{ level: SupportLevel; label: string; rule: string }> = [
  { level: "direct", label: "Direct", rule: "The section's pages state the claim. It earns a plain number." },
  {
    level: "partial",
    label: "Partial",
    rule: "The pages carry part of it. The number takes an asterisk, and the drawer says which part in words.",
  },
  {
    level: "nearby",
    label: "Nearby",
    rule: "Retrieved, related, does not state the claim. No number — a number here is worse than none — but still a way in, because the reader should be able to see what it does say.",
  },
  {
    level: "unsupported",
    label: "None",
    rule: "Absent from the library. A statement, not a control: there is nowhere for it to lead.",
  },
];

/**
 * The vertical constraint, at reading size.
 *
 * Two marks landing on consecutive lines is the case that decides how tall an
 * inline target may be. The first pass reached 14px above and below a ~10px
 * glyph set on a ~25px line, so these two boxes overlapped each other by a few
 * pixels — and where they overlap, the tap goes to whichever paints last rather
 * than to the one under the finger.
 */
function ConsecutiveLineSpecimen() {
  return (
    <div className="mt-3 border-t border-[color:var(--border)] pt-3">
      <p className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Marks on consecutive lines
      </p>
      <p className="mt-1 max-w-[30ch] text-base-minus leading-prose text-[color:var(--text-heading)]">
        <MarkedText
          section={{
            id: "line-a",
            kind: "monitoring_timing",
            heading: null,
            text: "Troponin and CRP weekly for four weeks",
            sourceIds: ["s2"],
            support: "direct",
          }}
          pool={THREE_SOURCES}
          activeId={null}
          onOpen={() => undefined}
        />{" "}
        <MarkedText
          section={{
            id: "line-b",
            kind: "monitoring_timing",
            heading: null,
            text: "then monthly while treatment continues",
            sourceIds: ["s1"],
            support: "direct",
          }}
          pool={THREE_SOURCES}
          activeId={null}
          onOpen={() => undefined}
        />
      </p>
      <p className="mt-1 text-2xs leading-5 text-[color:var(--text-muted)]">
        Both numbers are live controls and their targets meet without overlapping. Under the first pass&rsquo;s geometry
        the upper target reached about 3px past the baseline of the line below it.
      </p>
    </div>
  );
}

/** Both paints together, because forced-colors is only judged against what it
 *  replaces. The right-hand column resolves `Canvas` and `CanvasText`, which is
 *  what the OS substitutes when a clinician turns high contrast on. */
function ForcedColorsSpecimen() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["As designed", false],
          ["As high contrast paints it", true],
        ] as const
      ).map(([caption, forced]) => (
        <div
          key={caption}
          style={forced ? { background: "Canvas", color: "CanvasText", borderColor: "CanvasText" } : undefined}
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
        >
          <p
            style={forced ? { color: "CanvasText" } : undefined}
            className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
          >
            {caption}
          </p>
          <p
            style={{
              ...(forced
                ? { color: "CanvasText", borderLeft: "2px solid CanvasText", paddingLeft: 8 }
                : { borderLeft: "2px solid var(--clinical-accent)", paddingLeft: 8 }),
              ...(forced ? null : { background: "var(--clinical-accent-soft)" }),
            }}
            className="mt-2 rounded-r-lg py-1 text-base-minus leading-prose text-[color:var(--text-heading)]"
          >
            Troponin and CRP at baseline and weekly for the first four weeks
            <span
              style={{
                fontSize: "0.7em",
                verticalAlign: "super",
                lineHeight: 0,
                padding: "0.2em 0.13em",
                borderRadius: 3,
                ...(forced
                  ? { color: "CanvasText", outline: "1px solid CanvasText" }
                  : {
                      color: "var(--clinical-accent)",
                      background: "var(--clinical-accent-soft)",
                      outline: "1px solid var(--clinical-accent)",
                    }),
              }}
              className="font-semibold tabular-nums"
            >
              2
            </span>
            .
          </p>
          <p
            style={forced ? { color: "CanvasText" } : undefined}
            className="mt-2 text-2xs leading-5 text-[color:var(--text-muted)]"
          >
            {forced
              ? "The outline and the left rule survive. A box-shadow ring and a background wash — what the first pass used — would both be dropped here, leaving open and closed marks identical."
              : "Open mark and its claim. The ring is an outline and the wash is paired with a left rule, so neither signal depends on paint that forced-colors removes."}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════  under the answer  ══════════════════════ */

/**
 * The block the owner photographed: the safety row, then the two quiet controls
 * beneath it.
 *
 * `rail` reproduces what production draws today — a 2px warning-coloured rule
 * across the top of the whole card. Removing it loses no signal, and the repo
 * had already settled the question on the sibling surface:
 * `also-matches-accent-mockups.tsx` records the chosen direction as "no top
 * rail; colour lives in the icon tile and the short code chip". The
 * design-system contract separately holds colour-only status indicators at
 * zero, so the icon and the words carry the warning either way — the rule was
 * carrying nothing the row did not already say, while claiming the full width
 * of a card whose second row is not a warning at all.
 */
function SafetyCardSpecimen({ rail }: { rail: boolean }) {
  const chipClass = cn(
    "inline-flex min-h-12 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
    focusRing,
  );
  return (
    <section
      aria-label={rail ? "Answer support, as shipped" : "Answer support, proposed"}
      className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]"
    >
      <button
        type="button"
        onClick={() => undefined}
        aria-label="Open safety-critical source findings"
        className={cn(
          "grid min-h-[56px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left transition hover:bg-[color:var(--surface-subtle)]",
          rail && "border-t-2 border-t-[color:var(--warning)]",
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-md text-[color:var(--warning)]",
            // Colour moves into the tile once the rail goes, so the row still
            // reads as a warning at a glance rather than as a plain list item.
            rail ? null : "border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]",
          )}
        >
          <CircleAlert aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[color:var(--text-heading)]">Safety findings</span>
          {rail ? (
            <span className="mt-1 block truncate text-xs leading-5 text-[color:var(--text-muted)]">
              Red flag · Lithium Clinical Guideline(EMHS), p. 3
            </span>
          ) : (
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-5 text-[color:var(--text-muted)]">
              <span className="shrink-0 rounded border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-1.5 text-3xs font-bold uppercase tracking-eyebrow text-[color:var(--warning)]">
                Red flag
              </span>
              {/* The missing space before the bracket is in the document title
                  itself, so it reaches every citation label. Normalising it in
                  `cleanCitationTitle` fixes it once, for display only. */}
              <span className="truncate">Lithium Clinical Guideline (EMHS), p. 3</span>
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="inline-flex min-h-8 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-wash)] px-2 text-xs font-semibold tabular-nums text-[color:var(--text-muted)]">
            5
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 text-[color:var(--text-muted)]" />
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-1 border-t border-[color:var(--border)] px-2 py-1">
        <button type="button" onClick={() => undefined} className={chipClass}>
          <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--warning)]" />
          Evidence gaps
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-wash)] px-1.5 text-3xs font-bold tabular-nums text-[color:var(--text-muted)]">
            2
          </span>
        </button>
        <button type="button" onClick={() => undefined} className={chipClass}>
          <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
          Report a problem
        </button>
      </div>
    </section>
  );
}

const FOLLOW_UP_QUESTIONS = [
  "What is the target range in maintenance?",
  "When do I recheck after a dose change?",
  "Which interactions raise the level?",
];

/**
 * One list, not two.
 *
 * Production draws "Also in your library" (documents and records) and "Also
 * matches" (other modes) as separate blocks, one under the other, each with its
 * own eyebrow and its own count. On a phone they read as the same panel
 * repeated. They are one question — where else does this appear — so they are
 * one list here, and each row says what kind of thing it is rather than leaving
 * the reader to infer it from which panel it landed in.
 */
const ELSEWHERE = [
  { name: "Lithium carbonate (IR/SR)", kind: "Medication", Icon: FileText },
  { name: "Lithium monitoring", kind: "Factsheet", Icon: FileText },
  { name: "Prescribing", kind: "Mode", Icon: Layers },
  { name: "Calculators", kind: "Mode", Icon: Layers },
  { name: "Forms", kind: "Mode", Icon: Layers },
  { name: "DSM", kind: "Mode", Icon: Layers },
];

/** Direction A — ask next as chips, then one scrolling row of everywhere else. */
function ElsewhereRowSpecimen() {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          Ask next
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={RAIL_SCROLL_FADE}>
          {FOLLOW_UP_QUESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => undefined}
              className={cn(
                "inline-flex min-h-12 shrink-0 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-2xs font-medium text-[color:var(--text-heading)] transition hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--clinical-accent)]",
                focusRing,
              )}
            >
              {question}
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-[color:var(--border)] pt-2.5">
        <p className="mb-1.5 text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          Also in your library · <span className="tabular-nums">{ELSEWHERE.length}</span>
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={RAIL_SCROLL_FADE}>
          {ELSEWHERE.map(({ name, kind, Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => undefined}
              className={cn(
                "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2.5 text-left transition hover:border-[color:var(--border-strong)]",
                focusRing,
              )}
            >
              <span
                aria-hidden="true"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
              >
                <Icon aria-hidden="true" className="h-3 w-3" />
              </span>
              <span className="min-w-0">
                <span
                  style={{ maxWidth: 150 }}
                  className="block truncate text-2xs font-semibold leading-4 text-[color:var(--text-heading)]"
                >
                  {name}
                </span>
                <span className="block text-3xs leading-4 text-[color:var(--text-muted)]">{kind}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Direction B — the follow-ups as full-width questions, everywhere-else on one line. */
function ElsewhereListSpecimen() {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]">
        {FOLLOW_UP_QUESTIONS.map((question, index) => (
          <button
            key={question}
            type="button"
            onClick={() => undefined}
            className={cn(
              "flex min-h-12 w-full items-center gap-2 px-3 text-left text-2xs font-medium text-[color:var(--text-heading)] transition hover:bg-[color:var(--surface-subtle)]",
              index > 0 && "border-t border-[color:var(--border)]",
              focusRing,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{question}</span>
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)]" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => undefined}
        aria-expanded={false}
        className={cn(
          "flex min-h-12 w-full items-center gap-2 rounded-xl border border-[color:var(--border)] px-3 text-left transition hover:bg-[color:var(--surface-subtle)]",
          focusRing,
        )}
      >
        <span className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          Also in your library
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-[color:var(--text-muted)]">
          Lithium carbonate · Lithium monitoring · Prescribing · +3
        </span>
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)]" />
      </button>
    </div>
  );
}

const RECONCILE: Array<[string, string, string]> = [
  [
    "Verification notice",
    "First pass put a quiet line under the answer.",
    "Moved above the prose. `answer-result-surface.tsx` records that placement and reads its attribution from `answerQualityTier`, so it cannot announce AI authorship above a source-only notice.",
  ],
  [
    "Table aside",
    "`table-specific-answer-layout` gives tables their own column on wide screens today.",
    "Settled: the column goes. Tables fold into a chip in the drawer, so a table travels with the page it came from and the answer keeps one reading column. Accepted cost — a table can no longer be read beside the answer on a large screen.",
  ],
  [
    "compactCitations",
    "The preference shrinks a capsule this design deletes.",
    "Settled: kept, retargeted at the rail — collapse to one chip that expands. The pinned invariant — the missing-source warning is never hidden — still holds, because the notice and any worded mark sit outside the rail.",
  ],
  [
    "Clinical notes sheet",
    "Folded away. Essentials was the tab nothing obviously carried.",
    "Settled: it goes — audited first, then corrected in review. The sheet drops any section carrying only tables and builds rows from items alone, so its structured-support and table-only comparison rows never rendered at all. Everything it does render originates in the answer prose or its sections, which this design shows as the prose. No content is lost; one at-a-glance view is — the grouped threshold list — and that is the thing to re-check on real answers before the old surface is deleted.",
  ],
  [
    "Answer feedback",
    "No way to report a citation that does not support its claim.",
    "One item in the drawer menu, mapping to the `wrong_source` type the feedback taxonomy already ships.",
  ],
];

/* ══════════════════════  page  ══════════════════════ */

export function AnswerChatPerfectedV2MockupsPage() {
  return (
    <main className="min-h-screen bg-[color:var(--background)] px-3 py-4 text-[color:var(--text)] sm:px-6 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-4 shadow-[var(--e2)] sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
            >
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            </span>
            <p className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              PsychSift · answer page · direction A, second pass
            </p>
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-[color:var(--text-heading)] sm:text-3xl">
            The states, not the specimen
          </h1>
          <p style={PROSE_MEASURE} className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
            The first pass is kept, including both decisions it argues for: one colour for the mark, one source at a
            time in the drawer. What it drew was a single answer — model-written, confident, every claim numbered. The
            payload produces at least five, and on the only measurement in the handover the one it never drew was the
            most common. This page draws the rest of them, and corrects four things that were checked against the code.
          </p>
        </header>

        <Panel
          step="One"
          title="The four answers"
          intro="Same question, four payloads. The first is what the design already drew. The second is what twenty of thirty answers were in the 2026-08-18 blinded read: assembled without the model and, in this case, carrying no sections — so no numbers at all. That is the state the rail exists for, and the one the design was silent about."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ["Model synthesis · numbered", "ready"],
                ["Source-only · this one has no sections", "source_only"],
                ["Stale evidence · banner + route", "stale_evidence"],
                ["Partial retrieval · one track missing", "partial_retrieval"],
              ] as const
            ).map(([caption, kind]) => (
              <PhoneFrame key={kind} caption={caption}>
                <AnswerScreen
                  kind={kind}
                  wide={false}
                  pool={kind === "partial_retrieval" ? THREE_SOURCES.slice(0, 2) : THREE_SOURCES}
                />
              </PhoneFrame>
            ))}
          </div>
          <p style={PROSE_MEASURE} className="mt-4 text-2xs leading-5 text-[color:var(--text-muted)]">
            Note what the second frame proves. With no numbers in the prose, every route to a source runs through the
            rail — so the rail cannot be treated as a summary of the marks, and it cannot be the control that gets
            shrunk when space is tight.
          </p>
          <p style={PROSE_MEASURE} className="mt-2 text-2xs leading-5 text-[color:var(--text-muted)]">
            One correction to the handover, found while building this:{" "}
            <span className="font-semibold text-[color:var(--text-heading)]">
              source-only does not mean section-less.
            </span>{" "}
            The deterministic extractive route passes <code className="font-mono">answerSections</code> straight through
            and is then tagged source-only for having no model, so that answer can arrive with sections and support
            levels intact. Marks are gated on the sections, never on the quality tier — one rule rather than a special
            case, and it means a source-only answer sometimes does carry numbers.
          </p>
        </Panel>

        <Panel
          step="Two"
          title="A number has to be earned"
          intro="The first pass struck support from the drawer as 'never actionable'. It is the field that decides whether a claim may carry a number at all — AnswerSection.supportLevel, already resolved per section — which makes it the most actionable thing on the surface. Four levels, three treatments, still one colour."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <DetailCard
              title="The four levels in running prose"
              body="Judge them at reading size. Click a number to see its open state."
            >
              <div style={PROSE_MEASURE} className="space-y-2.5">
                {SUPPORT_ROWS.map(({ level, label, rule }) => (
                  <div key={level}>
                    <p className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                      {label}
                    </p>
                    <p className="text-base-minus leading-prose text-[color:var(--text-heading)]">
                      <MarkedText
                        section={{
                          id: level,
                          kind: "monitoring_timing",
                          heading: null,
                          text:
                            level === "unsupported" || level === "nearby"
                              ? "Routine ECG beyond the first four weeks is not specified in your indexed documents"
                              : "Troponin and CRP at baseline and weekly for the first four weeks",
                          sourceIds: level === "unsupported" ? [] : ["s2"],
                          support: level,
                        }}
                        pool={THREE_SOURCES}
                        activeId={null}
                        onOpen={() => undefined}
                      />
                    </p>
                    <p className="mt-0.5 text-2xs leading-5 text-[color:var(--text-muted)]">{rule}</p>
                  </div>
                ))}
              </div>
            </DetailCard>
            <DetailCard
              title="The tap target, corrected"
              body="The first pass extended each mark 14px above and below a 10px glyph on a 25px line, so consecutive lines overlapped — and inside a cluster the horizontal extensions overlapped across the comma. A tap could open the neighbour's source."
            >
              <div
                style={PROSE_MEASURE}
                className="space-y-2 text-base-minus leading-prose text-[color:var(--text-heading)]"
              >
                <p>
                  Cardiac surveillance runs alongside the bloods: troponin and CRP at baseline and weekly for the first
                  four weeks
                  <MarkedText
                    section={{
                      id: "cluster",
                      kind: "monitoring_timing",
                      heading: null,
                      text: "",
                      sourceIds: ["s1", "s2", "s4"],
                      support: "direct",
                    }}
                    pool={SIX_SOURCES}
                    activeId={null}
                    onOpen={() => undefined}
                  />
                </p>
                <p className="text-2xs leading-5 text-[color:var(--text-muted)]">
                  Vertical reach is now the line box and no more — about 25px, not the 48px this repo requires of
                  production controls. An inline mark cannot have 48px without stealing the line above it, and that is
                  not a limitation to design around; it is the reason every source is reachable a second time from a
                  rail card at full tap size. Cluster targets split rather than overlap, and a claim on more than two
                  documents shows <span className="font-semibold">+1</span> instead of growing an unbreakable run.
                </p>
                <ConsecutiveLineSpecimen />
              </div>
            </DetailCard>
          </div>
          <div className="mt-3">
            <ForcedColorsSpecimen />
          </div>
        </Panel>

        <Panel
          step="Three"
          title="Evidence arrives first"
          intro="The first pass drew a typewriter caret. The stream contract excludes token events by name — they would re-expose unvalidated clinical prose — so that frame drew a state this product refuses to be in. What does arrive early is the evidence preview, after retrieval and governance, and the client already consumes it."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["1 · asked", "asked"],
                ["2 · evidence preview lands", "evidence"],
                ["3 · verified answer lands", "answered"],
              ] as const
            ).map(([caption, stage]) => (
              <PhoneFrame key={stage} caption={caption}>
                <PendingScreen stage={stage} />
              </PhoneFrame>
            ))}
          </div>
          <p style={PROSE_MEASURE} className="mt-4 text-2xs leading-5 text-[color:var(--text-muted)]">
            The sources are on screen before the answer is, and deliberately <em>not</em> numbered yet. The preview is
            the top slice of the retrieval results in retrieval order; the final list is rebuilt from what the answer
            actually cites and capped by how far the answer is trusted. Those are different sets in a different order,
            so a number assigned here could point at a different document once the answer lands. Numbering is what
            arrival buys. Sections then land whole and already verified — never a claim that renumbers as more text
            arrives, which is the failure the first pass was trying to draw with a caret.
          </p>
        </Panel>

        <Panel
          step="Four"
          title="The drawer, at three sources and at six"
          intro="One source at a time, unchanged. The pager printed a button per source and the render policy permits six; six of them plus prev, next, overflow and close need about 396px inside a 362px phone drawer. Above four it becomes a counter, and the rail behind keeps random access."
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="lg:shrink-0" style={{ width: "100%", maxWidth: PHONE_WIDTH }}>
              <PhoneFrame caption="Phone · six sources, counter pager, opened from a mark">
                <AnswerScreen kind="ready" wide={false} pool={SIX_SOURCES} initialOpenId="s3" initialSectionId="n4" />
              </PhoneFrame>
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <DesktopFrame caption="Desktop · three sources, numeric pager, table chip">
                <AnswerScreen kind="ready" wide pool={THREE_SOURCES} initialOpenId="s1" />
              </DesktopFrame>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">What came back, and why</h3>
                <dl className="mt-2 grid gap-1.5">
                  {[
                    [
                      "Support, as one clause of words",
                      "Not a pill. If support decides whether the claim gets a number, the reader is owed the reason at the moment they open the page it points at. It is scoped to the claim whose mark was pressed, so one document cited by two claims can be direct for one and partial for the other — and a drawer opened from the rail says plainly that it carries no claim at all rather than inventing one.",
                    ],
                    [
                      "A way to say the page doesn't support the claim",
                      "The feedback taxonomy already ships wrong_source. This is the moment a bad citation is catchable, and there was no control for it anywhere.",
                    ],
                    [
                      "A counter above four sources",
                      "The numeric pager is kept where it fits, because random access by number is better than stepping. It just cannot fit six.",
                    ],
                  ].map(([title, body]) => (
                    <div key={title} className="grid gap-0.5 border-t border-[color:var(--border)] pt-1.5">
                      <dt className="text-2xs font-semibold text-[color:var(--text-heading)]">{title}</dt>
                      <dd className="text-2xs leading-5 text-[color:var(--text)]">{body}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          step="Five"
          title="Sections keep their headings"
          intro="The payload delivers headed sections with kinds — bottom_line, monitoring_timing, escalation_risk, source_gap — and the first pass rendered four unheaded sentences. Headings are how a clinician skips to the one track they came for."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <DetailCard
              title="Run-in, not stacked"
              body="A block header per section turns an answer into a form. The label runs into the first line instead, so the prose still reads as prose."
            >
              <SectionProse sections={SECTIONS} pool={THREE_SOURCES} activeId={null} onOpen={() => undefined} />
            </DetailCard>
            <DetailCard
              title="compactCitations, retargeted"
              body="Settled: kept rather than retired. The preference shrinks a capsule this design deletes; pointed at the rail it still means something — collapsed to one chip that expands, while the notice and any worded mark stay visible, which is the invariant its test pins."
            >
              <div className="space-y-2">
                <V2Rail pool={THREE_SOURCES} activeId={null} onOpen={() => undefined} compact />
                <p className="text-2xs leading-5 text-[color:var(--text-muted)]">Compact — tap to expand.</p>
                <V2Rail pool={THREE_SOURCES} activeId={null} onOpen={() => undefined} />
              </div>
            </DetailCard>
          </div>
        </Panel>

        <Panel
          step="Six"
          title="What this collides with"
          intro="Five things the design touches that already have owners or recorded decisions. Three were open questions for the owner and are now settled — recorded here with their reasoning so nobody reopens them while building. All five still want a sentence in the PR rather than being discovered at review."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-[color:var(--border)]">
                  {["Surface", "Today", "This design"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="py-1.5 pr-3 text-3xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RECONCILE.map(([surface, today, now]) => (
                  <tr key={surface} className="border-b border-[color:var(--border)] align-top">
                    <th scope="row" className="py-2 pr-3 text-2xs font-semibold text-[color:var(--text-heading)]">
                      {surface}
                    </th>
                    <td className="py-2 pr-3 text-2xs leading-5 text-[color:var(--text-muted)]">{today}</td>
                    <td className="py-2 text-2xs leading-5 text-[color:var(--text)]">{now}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={PROSE_MEASURE} className="mt-4 text-2xs leading-5 text-[color:var(--text-muted)]">
            The build order in the handover still holds: the rail and the drawer first, on every answer, then marks
            where sections earn them. This page changes what &ldquo;every answer&rdquo; has to mean.
          </p>
        </Panel>

        <Panel
          step="Seven"
          title="What sits under the answer"
          intro="Two corrections photographed on a live phone. The safety card draws a warning-coloured rule across the top of a card whose second row is not a warning, and below it two near-identical panels ask the same question twice while the follow-up questions this design argues for are switched off on phones entirely."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <DetailCard
              title="The safety card, rail and no rail"
              body="The rule spans a card that also holds Evidence gaps and Report a problem, so it colours two controls that carry no warning. Take it off and the colour moves into the icon tile and a short severity chip — the direction already chosen for the sibling surface in also-matches-accent-mockups.tsx."
            >
              <div className="space-y-3">
                {(
                  [
                    ["As shipped", true],
                    ["Proposed", false],
                  ] as const
                ).map(([label, rail]) => (
                  <div key={label}>
                    <p className="mb-1.5 text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                      {label}
                    </p>
                    <SafetyCardSpecimen rail={rail} />
                  </div>
                ))}
              </div>
            </DetailCard>
            <DetailCard
              title="Two panels become one, and the follow-ups come back"
              body="Direction A keeps the horizontal card row the answer already uses, so the surface has one repeated shape rather than three. Direction B trades the row for full-width questions and folds every other match onto a single expandable line — quieter, and it costs a tap. Pick one."
            >
              <div className="space-y-4">
                {(
                  [
                    ["Direction A · one scrolling row", <ElsewhereRowSpecimen key="a" />],
                    ["Direction B · questions in full, matches on one line", <ElsewhereListSpecimen key="b" />],
                  ] as const
                ).map(([label, node]) => (
                  <div key={label}>
                    <p className="mb-1.5 text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                      {label}
                    </p>
                    {node}
                  </div>
                ))}
              </div>
            </DetailCard>
          </div>
          <p style={PROSE_MEASURE} className="mt-4 text-2xs leading-5 text-[color:var(--text-muted)]">
            One thing both directions fix that is not styling: the phone never showed the follow-up questions at all —
            <code className="font-mono"> hidden sm:block</code> in{" "}
            <code className="font-mono">answer-result-surface.tsx</code> gates them behind a 640px breakpoint. The most
            likely next tap on the surface was desktop-only.
          </p>
          <p style={PROSE_MEASURE} className="mt-2 text-2xs leading-5 text-[color:var(--text-muted)]">
            And one wording change: &ldquo;4 related modes&rdquo; names an internal concept. Each row here says what the
            thing is — Medication, Factsheet, Mode — so nothing has to be translated before it is tapped.
          </p>
        </Panel>
      </div>
    </main>
  );
}
