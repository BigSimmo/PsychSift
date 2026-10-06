"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpLeft,
  ExternalLink,
  FileText,
  Filter,
  Menu,
  MoreHorizontal,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
  X,
} from "lucide-react";

import { cn } from "@/components/ui-primitives";

/**
 * Direction A, taken to a finished state.
 *
 * The comparison study lives at /mockups/answer-chat-redesign; this page is
 * the chosen direction refined, and it argues two specific decisions:
 *
 *  1. The reference mark is a quiet superscript, uniform in colour. Marks
 *     inside running prose are read at the speed of the sentence, so they
 *     must not ask a second question of the eye. Document staleness is a
 *     property of the document, not of the claim, and it is carried by the
 *     rail and the drawer where there is room to say it in words.
 *
 *  2. The drawer shows ONE source at a time. The earlier version listed
 *     every source with its own title, page, origin, status, support pill,
 *     quote and two buttons — the same eight fields three times over. A
 *     pager costs one row and removes all of that repetition.
 *
 * Nothing here is wired to real retrieval. All copy is synthetic.
 */

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/** Frame and mark geometry lives in JS: this repo's mockup CSS pipeline only
 *  re-emits utilities that already exist in non-mockup source, so a novel
 *  arbitrary value written inside a mockup file never reaches the stylesheet. */
export const PHONE_WIDTH = 390;
export const PHONE_HEIGHT = 844;
export const DESKTOP_HEIGHT = 660;
export const PROSE_MEASURE = { maxWidth: "68ch" } as const;

export type SourceStatus = "current" | "review-due";

export type MockSource = {
  id: string;
  index: number;
  short: string;
  title: string;
  origin: string;
  page: number;
  status: SourceStatus;
  support: "Direct" | "Partial";
  quote: string;
  attachment?: { kind: "table" | "figure"; label: string };
};

export const SOURCES: MockSource[] = [
  {
    id: "s1",
    index: 1,
    short: "Physical health protocol",
    title: "Clozapine physical health monitoring protocol",
    origin: "Statewide mental health · 2025",
    page: 12,
    status: "current",
    support: "Direct",
    quote:
      "Full blood count and absolute neutrophil count are taken at baseline, weekly for the first 18 weeks, fortnightly to week 52, and monthly thereafter while treatment continues.",
    attachment: { kind: "table", label: "Monitoring schedule" },
  },
  {
    id: "s2",
    index: 2,
    short: "Myocarditis surveillance",
    title: "Clozapine myocarditis surveillance schedule",
    origin: "Local formulary · 2025",
    page: 14,
    status: "current",
    support: "Direct",
    quote:
      "Troponin and CRP are measured at baseline and weekly for the first four weeks. Seek urgent cardiology review where troponin exceeds twice the upper limit of normal.",
  },
  {
    id: "s3",
    index: 3,
    short: "Shared-care metabolic",
    title: "Shared-care metabolic follow-up checklist",
    origin: "Community mental health · 2023",
    page: 7,
    status: "review-due",
    support: "Partial",
    quote:
      "Weight, waist circumference, lipids and HbA1c are recorded at baseline, at three months, and annually thereafter under shared-care arrangements with the general practitioner.",
  },
];

export const sourceById = (id: string) => SOURCES.find((source) => source.id === id) ?? SOURCES[0];

export type AnswerBlock = {
  id: string;
  text: string;
  sourceIds: string[];
  safety?: boolean;
};

export const QUESTION = "What physical health monitoring does a patient on clozapine need in the first year?";

export const ANSWER_BLOCKS: AnswerBlock[] = [
  {
    id: "b1",
    text: "Haematological monitoring is the part that cannot slip: FBC and ANC at baseline, weekly for the first 18 weeks, fortnightly to week 52, then monthly while treatment continues.",
    sourceIds: ["s1"],
  },
  {
    // Two documents carry this one, which is what makes the cluster mark real
    // rather than a hypothetical: the protocol and the surveillance schedule
    // both specify the cardiac window.
    id: "b2",
    text: "Cardiac surveillance runs alongside it: troponin and CRP at baseline and weekly for the first four weeks, with urgent review for fever, chest pain or breathlessness.",
    sourceIds: ["s1", "s2"],
  },
  {
    id: "b3",
    text: "Metabolic review — weight, waist, lipids and HbA1c — at baseline, three months and annually, usually under shared care with the GP.",
    sourceIds: ["s3"],
  },
  {
    id: "b4",
    text: "Withhold the dose and escalate the same day if the ANC falls below 1.5 × 10⁹/L.",
    sourceIds: ["s1"],
    safety: true,
  },
];

const PRIOR_QUESTION = "Starting dose for clozapine in an inpatient setting?";
const FOLLOW_UPS = [
  "What if the ANC drops mid-titration?",
  "Who does the GP hand back to?",
  "Constipation prophylaxis",
];

/* ══════════════════════  the reference mark  ══════════════════════ */

export type MarkVariant = "superscript" | "bracket" | "pill" | "ghost";

export const MARK_VARIANTS: Array<{
  id: MarkVariant;
  name: string;
  note: string;
}> = [
  {
    id: "superscript",
    name: "Superscript",
    note: "Raised, unboxed, one colour. Reads at the speed of the sentence and leaves the line rhythm intact.",
  },
  {
    id: "bracket",
    name: "Bracketed",
    note: "The academic convention. Unmistakable, but the brackets add two glyphs of noise per claim.",
  },
  {
    id: "pill",
    name: "Filled pill",
    note: "Highest contrast and the easiest to hit, at the cost of a button sitting inside the prose.",
  },
  {
    id: "ghost",
    name: "Outlined",
    note: "Softer than the pill, but a circle still interrupts the baseline and costs vertical space.",
  },
];

/**
 * The mark itself. Two things it must do that a plain <sup> cannot:
 * carry a real tap target without disturbing the line, and show which
 * source is currently open.
 */
export function RefMark({
  source,
  variant,
  active,
  onOpen,
}: {
  source: MockSource;
  variant: MarkVariant;
  active: boolean;
  onOpen: () => void;
}) {
  const shared =
    "relative inline-flex shrink-0 items-center justify-center font-semibold tabular-nums transition select-none";
  const label = `Source ${source.index}, ${source.short}, page ${source.page}`;

  const byVariant: Record<MarkVariant, { style: React.CSSProperties; className: string; text: string }> = {
    superscript: {
      style: {
        fontSize: "0.7em",
        verticalAlign: "super",
        lineHeight: 0,
        padding: "0.2em 0.13em",
        borderRadius: 3,
        top: 0,
        ...(active
          ? {
              background: "var(--clinical-accent-soft)",
              boxShadow: "0 0 0 1px var(--clinical-accent-border)",
            }
          : null),
      },
      className: "text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]",
      text: String(source.index),
    },
    bracket: {
      style: {
        fontSize: "0.82em",
        marginLeft: "0.12em",
        borderRadius: 4,
        padding: "0 0.1em",
        ...(active ? { background: "var(--clinical-accent-soft)" } : null),
      },
      className: "text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]",
      text: `[${source.index}]`,
    },
    pill: {
      style: {
        fontSize: "0.66em",
        marginLeft: "0.3em",
        minWidth: "1.55em",
        height: "1.55em",
        borderRadius: 999,
        background: "var(--clinical-accent)",
        color: "var(--clinical-accent-contrast)",
        verticalAlign: "0.12em",
        ...(active ? { boxShadow: "0 0 0 2px var(--clinical-accent-soft)" } : null),
      },
      className: "",
      text: String(source.index),
    },
    ghost: {
      style: {
        fontSize: "0.66em",
        marginLeft: "0.3em",
        minWidth: "1.6em",
        height: "1.6em",
        borderRadius: 999,
        border: "1px solid var(--clinical-accent-border)",
        verticalAlign: "0.12em",
        ...(active ? { background: "var(--clinical-accent-soft)" } : null),
      },
      className: "text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]",
      text: String(source.index),
    },
  };

  const spec = byVariant[variant];

  return (
    <button
      type="button"
      onClick={(event) => {
        // Safari doesn't focus a button on click by default, and the drawer's
        // return-focus logic reads document.activeElement — focus explicitly
        // so the mark that was clicked is always what gets focus back.
        event.currentTarget.focus();
        onOpen();
      }}
      aria-label={label}
      aria-pressed={active}
      title={`${source.short} · p.${source.page}`}
      style={spec.style}
      className={cn(shared, spec.className, focusRing)}
    >
      {spec.text}
      {/* An unboxed superscript is ~9px tall. This gives the control a real
          touch target without adding a single pixel to the line box. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -14,
          right: -6,
          bottom: -14,
          left: -6,
        }}
      />
    </button>
  );
}

/**
 * A claim and the marks that belong to it. The final word and the whole
 * cluster are bound into one non-breaking run so a mark can never be
 * stranded at the start of the next line.
 */
export function Claim({
  block,
  variant,
  activeSourceId,
  onOpen,
}: {
  block: AnswerBlock;
  variant: MarkVariant;
  activeSourceId: string | null;
  onOpen: (id: string) => void;
}) {
  const cut = block.text.lastIndexOf(" ");
  const head = cut < 0 ? "" : block.text.slice(0, cut + 1);
  const tail = cut < 0 ? block.text : block.text.slice(cut + 1);
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        {block.sourceIds.map((id, index) => {
          const source = sourceById(id);
          return (
            <span key={id}>
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: "0.7em",
                    verticalAlign: "super",
                    lineHeight: 0,
                    margin: "0 -0.02em",
                  }}
                  className="text-[color:var(--text-soft)]"
                >
                  ,
                </span>
              ) : null}
              <RefMark
                source={source}
                variant={variant}
                active={activeSourceId === source.id}
                onOpen={() => onOpen(source.id)}
              />
            </span>
          );
        })}
      </span>
    </>
  );
}

/* ══════════════════════  the source rail  ══════════════════════ */

export function statusLabel(status: SourceStatus) {
  return status === "current" ? "Current" : "Review due";
}

/**
 * Every source at a glance, before anything is opened.
 *
 * The card is the one from the original direction-A study, kept as it was:
 * a numbered badge tinted by document status, the short name, then page and
 * status in words. A coloured edge was tried and dropped — it read as a
 * separate object beside the card rather than part of it, and the badge was
 * already carrying the same signal.
 */
export function SourceRail({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]"
      role="list"
      aria-label="Sources behind this answer"
    >
      {SOURCES.map((source) => (
        <div key={source.id} role="listitem" className="contents">
          <button
            type="button"
            onClick={() => onOpen(source.id)}
            aria-pressed={activeId === source.id}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border bg-[color:var(--surface-raised)] px-2.5 text-left transition hover:shadow-[var(--e1)]",
              activeId === source.id
                ? "border-[color:var(--clinical-accent)] shadow-[var(--e1)]"
                : "border-[color:var(--border)] hover:border-[color:var(--border-strong)]",
              focusRing,
            )}
          >
            <span
              className={cn(
                "grid h-5 min-w-5 place-items-center rounded-md border text-3xs font-bold tabular-nums",
                source.status === "review-due"
                  ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                  : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
              )}
            >
              {source.index}
            </span>
            <span className="min-w-0">
              <span className="block max-w-[160px] truncate text-2xs font-semibold leading-4 text-[color:var(--text-heading)]">
                {source.short}
              </span>
              <span className="block text-3xs leading-4 text-[color:var(--text-muted)]">
                <span className="font-mono tabular-nums">p.{source.page}</span> · {statusLabel(source.status)}
              </span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════  the source drawer  ══════════════════════ */

/**
 * One source, not a list. The pager replaces the repeated title/page/origin/
 * status/support/quote/actions block that every card used to carry, and the
 * drawer takes only the height its content needs.
 */
function SourceDrawer({
  openId,
  onSelect,
  onClose,
  wide,
}: {
  openId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  wide: boolean;
}) {
  // Some comparison frames intentionally open a drawer on first render. Do
  // not steal page focus for those static specimens; an open transition after
  // the initial render, including paging, should still enter the dialog.
  const [autoFocus, setAutoFocus] = useState(false);
  const previousOpenIdRef = useRef(openId);
  useEffect(() => {
    if (previousOpenIdRef.current !== openId) setAutoFocus(true);
    previousOpenIdRef.current = openId;
  }, [openId]);

  if (openId === null) return null;
  // Keyed on the source: the panel's own transient state (an open menu)
  // belongs to that source and is discarded when you move to another.
  return (
    <DrawerPanel key={openId} openId={openId} onSelect={onSelect} onClose={onClose} wide={wide} autoFocus={autoFocus} />
  );
}

function DrawerPanel({
  openId,
  onSelect,
  onClose,
  wide,
  autoFocus,
}: {
  openId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  wide: boolean;
  autoFocus: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const source = sourceById(openId);
  const position = SOURCES.findIndex((item) => item.id === openId);
  const step = (delta: number) => {
    const next = SOURCES[(position + delta + SOURCES.length) % SOURCES.length];
    onSelect(next.id);
  };

  // User-opened (and paged) drawers move focus into the dialog. Comparison
  // specimens that start open do not claim page focus until the reader enters them.
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) initialFocusRef.current?.focus();
  }, [autoFocus]);

  // The backdrop is not focusable, so keyboard events must be observed on
  // window. Scope them to the drawer that owns focus, then keep Tab inside it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog || !dialog.contains(document.activeElement)) return;

      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ),
      );
      if (event.key === "Tab") {
        if (controls.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = SOURCES[(position + 1 + SOURCES.length) % SOURCES.length];
        onSelect(next.id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const next = SOURCES[(position - 1 + SOURCES.length) % SOURCES.length];
        onSelect(next.id);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [position, onSelect, onClose]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close source"
        onClick={onClose}
        className="min-h-0 w-full flex-1 cursor-default bg-[color:var(--overlay-backdrop)] motion-safe:animate-overlay-in"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Source ${source.index} of ${SOURCES.length}`}
        tabIndex={-1}
        className={cn(
          "flex min-h-0 flex-col rounded-t-2xl border-t border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--shadow-elevated)] motion-safe:animate-sheet-up",
          wide && "mx-auto w-full rounded-2xl border",
        )}
        style={{
          maxHeight: "78%",
          ...(wide ? { maxWidth: 560, marginBottom: 16 } : null),
        }}
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-[color:var(--border-strong)]" />

        {/* One chrome row: which source you are on, and the way out. */}
        <div style={{ paddingBottom: 6 }} className="flex items-center gap-1 px-2 pt-2">
          <button
            ref={initialFocusRef}
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous source"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
              focusRing,
            )}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          {SOURCES.map((item) => (
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
          ))}
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next source"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
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
                "grid h-9 w-9 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
                focusRing,
              )}
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 42,
                  width: 208,
                }}
                className="z-30 overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] py-1 shadow-[var(--shadow-elevated)] motion-safe:animate-pop-in"
              >
                {[
                  { label: "Copy passage", Icon: Copy },
                  { label: "Search only this document", Icon: Filter },
                  { label: "Ask about this passage", Icon: Search },
                ].map(({ label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-2xs font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)]",
                      focusRing,
                    )}
                  >
                    <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
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
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
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

          {/* The passage is the reason the drawer exists, so it gets the room. */}
          <blockquote className="mt-3 border-l-2 border-[color:var(--clinical-accent)] pl-3 text-base-minus leading-prose text-[color:var(--text-heading)]">
            {source.quote}
          </blockquote>

          {source.attachment ? (
            <button
              type="button"
              onClick={() => undefined}
              className={cn(
                "mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-semibold text-[color:var(--text)] transition hover:border-[color:var(--clinical-accent-border)]",
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
              "mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--command-hover)]",
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

/* ══════════════════════  the message  ══════════════════════ */

export function AssistantMark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
    >
      <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
    </span>
  );
}

function MessageActions({ hoverReveal }: { hoverReveal: boolean }) {
  const [copied, setCopied] = useState(false);
  const items = [
    {
      key: "copy",
      label: copied ? "Copied with references" : "Copy",
      Icon: copied ? Check : Copy,
      onClick: () => setCopied((value) => !value),
    },
    {
      key: "ask",
      label: "Follow up",
      Icon: CornerUpLeft,
      onClick: () => undefined,
    },
  ] as const;
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 transition-opacity",
        hoverReveal && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
      )}
    >
      {items.map(({ key, label, Icon, onClick }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-2xs font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
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

/** One quiet line for the standing caveat. It never grows, and it never
 *  competes with the answer for the first read. */
function VerifyLine() {
  return (
    <p className="text-3xs leading-4 text-[color:var(--text-muted)]">
      AI-generated · check each number against its page
    </p>
  );
}

function AnswerMessage({
  variant,
  activeSourceId,
  onOpen,
  wide,
}: {
  variant: MarkVariant;
  activeSourceId: string | null;
  onOpen: (id: string) => void;
  wide: boolean;
}) {
  return (
    <div className="group grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
      <AssistantMark />
      <div className="min-w-0 space-y-2.5">
        <div style={PROSE_MEASURE} className="space-y-2">
          {ANSWER_BLOCKS.map((block) => {
            // Opening a drawer covers the lower third of the screen, so the
            // claim it belongs to is washed to hold the reader's place.
            const lit = activeSourceId !== null && block.sourceIds.includes(activeSourceId);
            return (
              <p
                key={block.id}
                style={{ paddingTop: 3, paddingBottom: 3 }}
                className={cn(
                  "-mx-2 rounded-lg px-2 text-base-minus leading-prose transition-colors",
                  lit ? "bg-[color:var(--clinical-accent-soft)]" : "bg-transparent",
                  block.safety ? "font-medium text-[color:var(--text-heading)]" : "text-[color:var(--text-heading)]",
                )}
              >
                {block.safety ? (
                  <ShieldAlert
                    aria-hidden="true"
                    style={{ top: -1 }}
                    className="relative mr-1.5 inline-block h-4 w-4 text-[color:var(--warning)]"
                  />
                ) : null}
                <Claim block={block} variant={variant} activeSourceId={activeSourceId} onOpen={onOpen} />
              </p>
            );
          })}
        </div>

        <SourceRail activeId={activeSourceId} onOpen={onOpen} />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <VerifyLine />
          <MessageActions hoverReveal={wide} />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════  screen chrome  ══════════════════════ */

export function TopBar() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-2.5 py-2">
      <button
        type="button"
        onClick={() => undefined}
        aria-label="Open menu"
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
          focusRing,
        )}
      >
        <Menu aria-hidden="true" className="h-4 w-4" />
      </button>
      <p className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Answer
      </p>
      <span
        aria-hidden="true"
        className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-3xs font-semibold text-[color:var(--text-muted)]"
      >
        <FileText aria-hidden="true" className="h-3 w-3" />
        All documents
      </span>
    </div>
  );
}

export function Composer({ suggestions = false }: { suggestions?: boolean }) {
  return (
    <div className="shrink-0 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-3 pb-3 pt-2">
      {suggestions ? (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {FOLLOW_UPS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => undefined}
              className={cn(
                "inline-flex min-h-8 shrink-0 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-medium text-[color:var(--text-muted)] transition hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--clinical-accent)]",
                focusRing,
              )}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] py-1 pl-3.5 pr-1 shadow-[var(--shadow-inset)]">
        <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--text-placeholder)]">Ask a follow-up…</span>
        <button
          type="button"
          onClick={() => undefined}
          aria-label="Send question"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--command)] text-[color:var(--command-contrast)] transition hover:bg-[color:var(--command-hover)]",
            focusRing,
          )}
        >
          <ArrowUp aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-3xs leading-4 text-[color:var(--text-muted)]">
        Do not enter patient-identifiable information.
      </p>
    </div>
  );
}

function ThreadDivider() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--border)]" />
      <button
        type="button"
        onClick={() => undefined}
        className={cn(
          "inline-flex min-h-7 max-w-full items-center rounded-full px-2 text-2xs text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
          focusRing,
        )}
      >
        <span className="min-w-0 truncate">{PRIOR_QUESTION}</span>
      </button>
      <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--border)]" />
    </div>
  );
}

export function UserTurn() {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-[var(--radius-sm)] bg-[color:var(--clinical-accent-soft)] px-3.5 py-2 text-sm leading-6 text-[color:var(--text-heading)]">
        {QUESTION}
      </p>
    </div>
  );
}

/** The whole screen. `wide` is the desktop reading column, not a media query —
 *  these frames are nested in a page, so a breakpoint would track the browser. */
function AnswerScreen({
  variant,
  wide,
  initialOpenId = null,
}: {
  variant: MarkVariant;
  wide: boolean;
  initialOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  // Capture the trigger during its activation event. Waiting for the drawer's
  // effect would capture the newly-focused drawer control instead.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openSource = (id: string) => {
    if (openId === null && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    setOpenId((current) => (current === id ? null : id));
  };
  const closeSource = () => {
    setOpenId(null);
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  };
  return (
    <>
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("space-y-3 px-3 py-3", wide && "mx-auto w-full max-w-3xl px-5 py-5")}>
          <ThreadDivider />
          <UserTurn />
          <AnswerMessage variant={variant} activeSourceId={openId} onOpen={openSource} wide={wide} />
        </div>
      </div>
      <Composer />
      <SourceDrawer openId={openId} onSelect={setOpenId} onClose={closeSource} wide={wide} />
    </>
  );
}

/* ══════════════════════  page scaffold  ══════════════════════ */

export function PhoneFrame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        {caption}
      </figcaption>
      <div className="mx-auto w-full" style={{ maxWidth: PHONE_WIDTH }}>
        <div
          style={{
            height: PHONE_HEIGHT,
            borderRadius: "1.75rem",
            borderWidth: 6,
          }}
          className="relative flex flex-col overflow-hidden border-[color:var(--border-strong)] bg-[color:var(--background)] shadow-[var(--shadow-elevated)]"
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

export function DesktopFrame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        {caption}
      </figcaption>
      <div
        style={{ height: DESKTOP_HEIGHT }}
        className="relative flex overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--background)] shadow-[var(--e2)]"
      >
        <div
          aria-hidden="true"
          className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-[color:var(--border)] bg-[color:var(--surface-chrome)] py-3 sm:flex"
        >
          {[ShieldCheck, FileText, Table2, Search].map((Icon, index) => (
            <span
              key={index}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-lg",
                index === 0
                  ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "text-[color:var(--decoration-soft)]",
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </figure>
  );
}

export function Panel({
  id,
  step,
  title,
  intro,
  children,
}: {
  id?: string;
  step: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--e2)] sm:p-4"
    >
      <p className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">{step}</p>
      <h2 className="mt-1.5 text-lg font-semibold text-[color:var(--text-heading)]">{title}</h2>
      <p style={PROSE_MEASURE} className="mt-1.5 text-sm leading-6 text-[color:var(--text-muted)]">
        {intro}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Lets the mark be judged in running prose at real size, which is the only
 *  size that matters — a mark enlarged for review always looks fine. */
function MarkSpecimen() {
  const [variant, setVariant] = useState<MarkVariant>("superscript");
  const [openId, setOpenId] = useState<string | null>(null);
  const chosen = MARK_VARIANTS.find((item) => item.id === variant) ?? MARK_VARIANTS[0];

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Reference mark treatment" className="flex flex-wrap gap-1.5">
        {MARK_VARIANTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={variant === item.id}
            onClick={() => setVariant(item.id)}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-2xs font-semibold transition",
              variant === item.id
                ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]",
              focusRing,
            )}
          >
            {item.name}
            {item.id === "superscript" ? (
              <span className="rounded-full bg-[color:var(--success-soft)] px-1.5 text-3xs text-[color:var(--success)]">
                chosen
              </span>
            ) : null}
            {item.id === "pill" ? (
              <span className="text-3xs font-normal text-[color:var(--text-soft)]">was</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:p-4">
        <div style={PROSE_MEASURE} className="space-y-2.5">
          {ANSWER_BLOCKS.slice(0, 3).map((block) => (
            <p key={block.id} className="text-base-minus leading-prose text-[color:var(--text-heading)]">
              <Claim
                block={block}
                variant={variant}
                activeSourceId={openId}
                onOpen={(id) => setOpenId((current) => (current === id ? null : id))}
              />
            </p>
          ))}
        </div>
        <p className="mt-3 border-t border-[color:var(--border)] pt-2.5 text-2xs leading-5 text-[color:var(--text-muted)]">
          <span className="font-semibold text-[color:var(--text-heading)]">{chosen.name}.</span> {chosen.note} Click a
          mark to see its selected state; the second claim carries two sources, so it shows the cluster.
        </p>
      </div>
    </div>
  );
}

export function DetailCard({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
      <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</h3>
      <p className="mt-1 text-2xs leading-5 text-[color:var(--text-muted)]">{body}</p>
      <div className="mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3">
        {children}
      </div>
    </article>
  );
}

/** The mark's four states, shown together because they are only judged
 *  relative to one another. */
function MarkStates() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3 text-base-minus leading-prose text-[color:var(--text-heading)]">
      {(
        [
          ["Resting", { active: false }],
          ["Selected", { active: true }],
        ] as const
      ).map(([label, state]) => (
        <span key={label} className="inline-flex items-baseline gap-2">
          <span className="text-3xs uppercase tracking-eyebrow text-[color:var(--text-muted)]">{label}</span>
          <span>
            …week 52
            <RefMark source={SOURCES[0]} variant="superscript" active={state.active} onOpen={() => undefined} />
          </span>
        </span>
      ))}
      <span className="inline-flex items-baseline gap-2">
        <span className="text-3xs uppercase tracking-eyebrow text-[color:var(--text-muted)]">Cluster</span>
        <span>
          …four weeks
          <RefMark source={SOURCES[0]} variant="superscript" active={false} onOpen={() => undefined} />
          <span
            aria-hidden="true"
            style={{
              fontSize: "0.7em",
              verticalAlign: "super",
              lineHeight: 0,
              margin: "0 -0.02em",
            }}
            className="text-[color:var(--text-soft)]"
          >
            ,
          </span>
          <RefMark source={SOURCES[1]} variant="superscript" active={false} onOpen={() => undefined} />
        </span>
      </span>
    </div>
  );
}

function UnsupportedClaim() {
  return (
    <p style={PROSE_MEASURE} className="text-base-minus leading-prose text-[color:var(--text-heading)]">
      Routine ECG beyond the first four weeks is not specified in your indexed documents.
      <span className="whitespace-nowrap">
        {" "}
        <span
          style={{
            fontSize: "0.7em",
            verticalAlign: "super",
            lineHeight: 0,
            marginLeft: "0.12em",
          }}
          className="font-semibold text-[color:var(--warning)]"
        >
          no source
        </span>
      </span>
    </p>
  );
}

function StreamingClaim() {
  return (
    <p style={PROSE_MEASURE} className="text-base-minus leading-prose text-[color:var(--text-heading)]">
      Haematological monitoring is the part that cannot slip: FBC and ANC at baseline, weekly for the first
      <span
        aria-hidden="true"
        style={{
          marginLeft: 6,
          height: 15,
          width: 7,
          borderRadius: 2,
          background: "var(--clinical-accent)",
        }}
        className="inline-block motion-safe:animate-pulse"
      />
    </p>
  );
}

const REMOVED_FROM_DRAWER = [
  ["Three source cards", "One source, with a pager. The other two are one tap away and cost a single row."],
  ["Passages / Tables / Map tabs", "A table or figure on the cited page appears as one chip inside that source."],
  ["Title and subtitle rows", "The source's own title is the title. Nothing needed a caption above it."],
  ["Support and status pills", "Status is one word in the metadata line; support strength was never actionable."],
  ["Two buttons per card", "One primary action — open the page. The rest sit behind the menu."],
];

const ELEVATIONS = [
  [
    "The claim stays visible",
    "Opening the drawer covers the lower part of the screen, so the claim that owns the open source is washed in accent. You never lose the sentence you were checking.",
  ],
  [
    "A real touch target",
    "A resting superscript is about nine pixels tall. An invisible 44-pixel target sits around it, added with absolute positioning so it costs the line box nothing.",
  ],
  [
    "Marks never strand",
    "The final word of a claim and its whole mark cluster are bound into one non-breaking run, so a number can never fall alone onto the next line.",
  ],
  [
    "Arrow keys move between sources",
    "Left and right step through the sources without closing the drawer; Escape closes it. The pager is the same control by mouse.",
  ],
  [
    "Suggestions moved off the resting screen",
    "Three guessed follow-ups sat permanently above the composer. They belong to the act of typing, and the answer got that space back.",
  ],
  [
    "Copy brings the references",
    "Copying the answer takes the numbered marks and a reference list with page numbers, so it can be pasted into notes and still be checkable.",
  ],
];

export function AnswerChatPerfectedMockupsPage() {
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
              PsychSift · answer page · direction A, finished
            </p>
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-[color:var(--text-heading)] sm:text-3xl">
            Numbered chips, refined
          </h1>
          <p style={PROSE_MEASURE} className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
            Two decisions carry this page. The mark in the prose became a quiet superscript in a single colour, because
            a mark that asks a second question of the eye slows the sentence down. The drawer became one source at a
            time, because listing three sources meant printing the same eight fields three times.
          </p>
        </header>

        <Panel
          step="One"
          title="The mark in the prose"
          intro="Judge it at reading size in real sentences — a reference mark enlarged for review always looks fine. Switch between the four treatments and click one to see its selected state."
        >
          <MarkSpecimen />
        </Panel>

        <Panel
          step="Two"
          title="Why one colour"
          intro="The earlier mark was tinted amber when its document was past its review date. That put two colours inside running text, and it attached a property of the document to a claim. Status now lives where there is room to say it in words: the rail under the answer, and the drawer."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <DetailCard
              title="States of the mark"
              body="Resting, selected, and a two-source cluster. Nothing else changes shape or colour."
            >
              <MarkStates />
            </DetailCard>
            <DetailCard
              title="Where status went"
              body="Onto the source cards, where the badge is tinted and the status is written out beside the page."
            >
              <SourceRail activeId={null} onOpen={() => undefined} />
            </DetailCard>
          </div>
        </Panel>

        <Panel
          step="Three"
          title="The answer"
          intro="Full prose, no card around it, one quiet caveat line. The second claim rests on two documents, so it carries a cluster."
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="lg:shrink-0" style={{ width: "100%", maxWidth: PHONE_WIDTH }}>
              <PhoneFrame caption="Phone · tap any number">
                <AnswerScreen variant="superscript" wide={false} />
              </PhoneFrame>
            </div>
            <div className="min-w-0 flex-1">
              <DesktopFrame caption="Desktop · same message, wider reading column">
                <AnswerScreen variant="superscript" wide />
              </DesktopFrame>
            </div>
          </div>
        </Panel>

        <Panel
          step="Four"
          title="The source drawer"
          intro="One source, its page, its passage, and one way to open it. Arrow keys or the pager move between sources without closing anything, and the claim that owns the open source stays lit behind the drawer."
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="lg:shrink-0" style={{ width: "100%", maxWidth: PHONE_WIDTH }}>
              <PhoneFrame caption="Phone · drawer on source 2">
                <AnswerScreen variant="superscript" wide={false} initialOpenId="s2" />
              </PhoneFrame>
            </div>
            <div className="min-w-0 flex-1 space-y-5">
              <DesktopFrame caption="Desktop · drawer on source 1, with its table chip">
                <AnswerScreen variant="superscript" wide initialOpenId="s1" />
              </DesktopFrame>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">What came out of it</h3>
                <dl className="mt-2 grid gap-1.5">
                  {REMOVED_FROM_DRAWER.map(([gone, instead]) => (
                    <div key={gone} className="grid gap-0.5 border-t border-[color:var(--border)] pt-1.5">
                      <dt className="text-2xs font-semibold text-[color:var(--text-muted)] line-through">{gone}</dt>
                      <dd className="text-2xs leading-5 text-[color:var(--text)]">{instead}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          step="Five"
          title="The states that break naive designs"
          intro="A reference system is only as good as its worst case. These are the three that a numbered-mark design has to answer before it can ship."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <DetailCard
              title="No source for a claim"
              body="The model must be able to say a thing is absent from your library. A worded mark, not a number, and never silence."
            >
              <UnsupportedClaim />
            </DetailCard>
            <DetailCard
              title="While the answer streams"
              body="Marks attach only once a claim is complete, so numbers never appear and then renumber as text arrives."
            >
              <StreamingClaim />
            </DetailCard>
            <DetailCard
              title="A table on the cited page"
              body="It travels with its source inside the drawer rather than earning a tab of its own."
            >
              <button
                type="button"
                onClick={() => undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-semibold text-[color:var(--text)] transition hover:border-[color:var(--clinical-accent-border)]",
                  focusRing,
                )}
              >
                <Table2 aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" />
                Monitoring schedule
                <span className="font-normal text-[color:var(--text-muted)]">on this page</span>
              </button>
            </DetailCard>
          </div>
        </Panel>

        <Panel
          step="Six"
          title="The rest of the polish"
          intro="Smaller decisions, each of which only shows up when the design is actually used."
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ELEVATIONS.map(([title, body]) => (
              <div key={title} className="rounded-lg bg-[color:var(--surface-subtle)] px-3 py-2.5">
                <p className="text-2xs font-bold text-[color:var(--text-heading)]">{title}</p>
                <p className="mt-1 text-2xs leading-5 text-[color:var(--text-muted)]">{body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}
