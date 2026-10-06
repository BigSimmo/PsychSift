"use client";

import { useId, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  CornerUpLeft,
  ExternalLink,
  FileText,
  Layers,
  Map as MapIcon,
  Menu,
  Quote,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Table2,
  X,
} from "lucide-react";

import { cn } from "@/components/ui-primitives";

/**
 * Design-scratch study for the Answer page — the app's centrepiece.
 *
 * Brief: make the answer read as a chat message rather than a stack of cards,
 * and give citations a system that is visually obvious, per-claim, and opens
 * from the bottom without the transcript losing its calm.
 *
 * The three directions differ in exactly one dimension — how a claim points at
 * its evidence — and are otherwise held identical (same prose, same sources,
 * same dock mechanics) so the comparison is about the reference system and not
 * about incidental styling.
 *
 *   A · Numbered chips   inline superscript tokens + a source rail
 *   B · Evidence margin  a spine/gutter that aligns evidence to the paragraph
 *   C · Source deck      underlined claims + a fanned card deck
 *
 * Nothing here is wired to real retrieval. All copy is synthetic.
 */

/** Frame dimensions live in JS: this repo's mockup CSS pipeline re-emits only
 *  utilities that already exist elsewhere, so a novel arbitrary value written
 *  inside a mockup file never reaches the stylesheet. */
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
const DESKTOP_HEIGHT = 700;
/** Reading measure, set here for the same reason as the frame dimensions. */
const PROSE_MEASURE = { maxWidth: "68ch" } as const;
/** A reference mark has to sit in the text flow, not shrink-wrap beside it. */
const INLINE_MARK = { display: "inline" } as const;

/**
 * Direction C marks the supported phrase itself, which rules out a <button>:
 * Blink and WebKit coerce a button to `inline-block` whatever `display` says,
 * so a multi-word phrase shrink-wraps and breaks the line around itself
 * instead of flowing. A span carrying the button role is the only element that
 * both flows inline and stays operable by keyboard — worth knowing before this
 * direction is costed.
 */
function InlineRef({
  children,
  onOpen,
  active,
  review,
}: {
  children: React.ReactNode;
  onOpen: () => void;
  active: boolean;
  review: boolean;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-pressed={active}
      style={{
        ...INLINE_MARK,
        textDecorationLine: "underline",
        textDecorationStyle: active ? "solid" : "dotted",
        textDecorationThickness: 2,
        textUnderlineOffset: 4,
        textDecorationColor: review ? "var(--warning)" : "var(--clinical-accent)",
      }}
      className={cn(
        "cursor-pointer rounded-sm transition",
        active && (review ? "bg-[color:var(--warning-soft)]" : "bg-[color:var(--clinical-accent-soft)]"),
        focusRing,
      )}
    >
      {children}
    </span>
  );
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

type SourceStatus = "current" | "review-due";

type MockSource = {
  id: string;
  index: number;
  short: string;
  title: string;
  origin: string;
  page: number;
  status: SourceStatus;
  support: "Direct" | "Partial";
  score: string;
  quote: string;
};

const SOURCES: MockSource[] = [
  {
    id: "s1",
    index: 1,
    short: "Physical health protocol",
    title: "Clozapine physical health monitoring protocol",
    origin: "Statewide mental health · 2025",
    page: 12,
    status: "current",
    support: "Direct",
    score: "92%",
    quote:
      "Full blood count and absolute neutrophil count are taken at baseline, weekly for the first 18 weeks, fortnightly to week 52, and monthly thereafter while treatment continues.",
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
    score: "86%",
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
    score: "71%",
    quote:
      "Weight, waist circumference, lipids and HbA1c are recorded at baseline, at three months, and annually thereafter under shared-care arrangements with the general practitioner.",
  },
];

const sourceById = (id: string) => SOURCES.find((source) => source.id === id) ?? SOURCES[0];

type AnswerBlock = {
  id: string;
  /** The claim, written so it can carry exactly one citation. */
  text: string;
  /** Phrase inside `text` that direction C underlines. */
  anchor: string;
  sourceId: string;
  safety?: boolean;
};

const QUESTION = "What physical health monitoring does a patient on clozapine need in the first year?";

const ANSWER_BLOCKS: AnswerBlock[] = [
  {
    id: "b1",
    text: "Haematological monitoring is the part that cannot slip: FBC and ANC at baseline, weekly for the first 18 weeks, fortnightly to week 52, then monthly while treatment continues.",
    anchor: "weekly for the first 18 weeks, fortnightly to week 52, then monthly",
    sourceId: "s1",
  },
  {
    id: "b2",
    text: "Cardiac surveillance runs alongside it: troponin and CRP at baseline and weekly for the first four weeks, with urgent review for fever, chest pain or breathlessness.",
    anchor: "baseline and weekly for the first four weeks",
    sourceId: "s2",
  },
  {
    id: "b3",
    text: "Metabolic review — weight, waist, lipids and HbA1c — at baseline, three months and annually, usually under shared care with the GP.",
    anchor: "baseline, three months and annually",
    sourceId: "s3",
  },
  {
    id: "b4",
    text: "Withhold the dose and escalate the same day if the ANC falls below 1.5 × 10⁹/L.",
    anchor: "Withhold the dose and escalate the same day",
    sourceId: "s1",
    safety: true,
  },
];

const PRIOR_TURN = {
  question: "Starting dose for clozapine in an inpatient setting?",
  answer: "12.5 mg on day one, then titrate by 25–50 mg daily against blood pressure, pulse, temperature and sedation.",
};

const FOLLOW_UPS = [
  "What if the ANC drops mid-titration?",
  "Who does the GP hand back to?",
  "Constipation prophylaxis",
];

/* ─────────────────────────────  shared atoms  ───────────────────────────── */

function statusDotClass(status: SourceStatus) {
  return status === "current" ? "bg-[color:var(--success)]" : "bg-[color:var(--warning)]";
}

function statusLabel(status: SourceStatus) {
  return status === "current" ? "Current" : "Review due";
}

/** The reference token itself — the smallest unit each direction is arguing about. */
function CitationChip({
  source,
  active = false,
  onClick,
  size = "sm",
}: {
  source: MockSource;
  active?: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}) {
  const review = source.status === "review-due";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Source ${source.index}: ${source.title}, page ${source.page}`}
      aria-pressed={active}
      style={{ top: -1 }}
      className={cn(
        "nums relative ml-1 inline-flex shrink-0 items-center justify-center rounded-full border align-baseline font-semibold leading-none transition",
        size === "sm" ? "h-4 min-w-4 px-1 text-3xs" : "h-5 min-w-5 px-1.5 text-2xs",
        review
          ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
          : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        active && "ring-2 ring-[color:var(--clinical-accent)]/40",
        focusRing,
      )}
    >
      {source.index}
    </button>
  );
}

function SupportPill({ source }: { source: MockSource }) {
  const review = source.status === "review-due";
  return (
    <span
      className={cn(
        "inline-flex min-h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-3xs font-semibold leading-none",
        review
          ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
          : "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
      )}
    >
      {source.support}
    </span>
  );
}

/** Hover-revealed message actions — present, but never competing with the prose. */
function MessageActions({ hoverReveal = false }: { hoverReveal?: boolean }) {
  const [copied, setCopied] = useState(false);
  const items = [
    {
      key: "copy",
      label: copied ? "Copied" : "Copy",
      Icon: copied ? Check : Copy,
      onClick: () => setCopied((v) => !v),
    },
    { key: "save", label: "Save", Icon: Bookmark, onClick: () => undefined },
    { key: "ask", label: "Follow up", Icon: CornerUpLeft, onClick: () => undefined },
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
          aria-label={label}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-2xs font-semibold text-[color:var(--text-muted)] transition",
            "hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
            focusRing,
          )}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Renders a claim so its trailing word and citation chip can never be split
 *  across lines — a stranded superscript is the classic inline-reference flaw. */
function ClaimWithChip({
  text,
  source,
  active,
  onOpen,
}: {
  text: string;
  source: MockSource;
  active: boolean;
  onOpen: () => void;
}) {
  const cut = text.lastIndexOf(" ");
  const head = cut < 0 ? "" : text.slice(0, cut + 1);
  const tail = cut < 0 ? text : text.slice(cut + 1);
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        <CitationChip source={source} active={active} onClick={onOpen} />
      </span>
    </>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-[var(--radius-sm)] bg-[color:var(--clinical-accent-soft)] px-3.5 py-2 text-sm font-medium leading-6 text-[color:var(--text-heading)]">
        {text}
      </p>
    </div>
  );
}

/** A single quiet line standing in for the rest of the thread, so each frame
 *  reads as a transcript without spending a third of the phone on old turns. */
function PriorTurnGhost() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--border)]" />
      <button
        type="button"
        onClick={() => undefined}
        className={cn(
          "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2 text-2xs text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)]",
          focusRing,
        )}
      >
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
        <span className="min-w-0 truncate">{PRIOR_TURN.question}</span>
      </button>
      <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--border)]" />
    </div>
  );
}

function AssistantAvatar() {
  return (
    <span
      aria-hidden="true"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
    >
      <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
    </span>
  );
}

/** The one cautionary line, folded away until asked for. */
function VerifyDisclosure() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="w-fit max-w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2 text-2xs font-medium text-[color:var(--text-muted)] transition",
          "hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
          focusRing,
        )}
      >
        <Sparkles aria-hidden="true" className="h-3 w-3 text-[color:var(--clinical-accent)]" />
        AI-generated · verify against source
        <ChevronDown aria-hidden="true" className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <p
          id={id}
          style={{ maxWidth: "52ch" }}
          className="mt-1.5 rounded-lg bg-[color:var(--surface-subtle)] px-2.5 py-2 text-2xs leading-5 text-[color:var(--text-muted)]"
        >
          Every claim above is numbered to the passage it came from. Check dose, threshold, timing and escalation
          wording against the cited page before acting on it.
        </p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────  the bottom dock  ─────────────────────────── */

type DockTab = "Passages" | "Tables" | "Map";

const DOCK_TABS: Array<{ id: DockTab; Icon: typeof Quote }> = [
  { id: "Passages", Icon: Quote },
  { id: "Tables", Icon: Table2 },
  { id: "Map", Icon: MapIcon },
];

/**
 * One surface for every reference route. All three directions open this and
 * nothing else — replacing the four competing sheets the live page ships
 * (source capsule, clinical notes, evidence, safety findings).
 */
function DockShell({
  open,
  onClose,
  title,
  subtitle,
  tab,
  onTab,
  children,
  tone = "accent",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  tab: DockTab;
  onTab: (next: DockTab) => void;
  children: React.ReactNode;
  tone?: "accent" | "deck";
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close sources"
        onClick={onClose}
        className="min-h-0 w-full flex-1 cursor-default bg-[color:var(--overlay-backdrop)] motion-safe:animate-overlay-in"
      />
      <div
        role="dialog"
        aria-label={title}
        style={{ maxHeight: "64%" }}
        className={cn(
          "flex min-h-0 flex-col rounded-t-2xl border-t border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--shadow-elevated)] motion-safe:animate-sheet-up",
          tone === "deck" && "border-t-2 border-t-[color:var(--clinical-accent)]",
        )}
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-[color:var(--border-strong)]" />
        <div className="flex items-start justify-between gap-3 px-3 pb-2 pt-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" />
              <p className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</p>
            </div>
            <p className="mt-0.5 truncate text-2xs leading-4 text-[color:var(--text-muted)]">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sources"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]",
              focusRing,
            )}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div className="px-3 pb-2">
          <div
            role="tablist"
            aria-label="Evidence type"
            className="inline-flex rounded-lg bg-[color:var(--surface-subtle)] p-0.5"
          >
            {DOCK_TABS.map(({ id, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => onTab(id)}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-2xs font-semibold transition",
                  tab === id
                    ? "bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] shadow-[var(--e1)]"
                    : "text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
                  focusRing,
                )}
              >
                <Icon aria-hidden="true" className="h-3 w-3" />
                {id}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
      </div>
    </div>
  );
}

function DockPlaceholder({ tab }: { tab: DockTab }) {
  const copy =
    tab === "Tables"
      ? "One monitoring table was extracted from page 14 and is shown here at full width."
      : "A support map showing which claim rests on which page, and how strongly.";
  const Icon = tab === "Tables" ? Table2 : MapIcon;
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-[color:var(--border)] px-4 py-8 text-center">
      <Icon aria-hidden="true" className="h-6 w-6 text-[color:var(--clinical-accent)]" />
      <p style={{ maxWidth: "34ch" }} className="mt-2 text-2xs leading-5 text-[color:var(--text-muted)]">
        {copy}
      </p>
    </div>
  );
}

/** A full evidence row: the passage, its provenance, and one way out to the PDF. */
function PassageCard({ source, expanded }: { source: MockSource; expanded: boolean }) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-[color:var(--surface-raised)] p-2.5 transition",
        expanded
          ? "border-[color:var(--clinical-accent-border)] shadow-[var(--e1)]"
          : "border-[color:var(--border)] hover:border-[color:var(--border-strong)]",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
        <span
          className={cn(
            "nums mt-0.5 grid h-6 min-w-6 place-items-center rounded-md border px-1 text-2xs font-bold",
            source.status === "review-due"
              ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
              : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
          )}
        >
          {source.index}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{source.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-[color:var(--text-muted)]">
            <span className="font-mono tabular-nums">p.{source.page}</span>
            <span aria-hidden="true">·</span>
            <span>{source.origin}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(source.status))} />
              {statusLabel(source.status)}
            </span>
          </p>
        </div>
        <SupportPill source={source} />
      </div>
      {expanded ? (
        <>
          <blockquote className="mt-2.5 border-l-2 border-[color:var(--clinical-accent)]/40 pl-2.5 text-sm leading-6 text-[color:var(--text)]">
            &ldquo;{source.quote}&rdquo;
          </blockquote>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[color:var(--command)] px-2.5 text-2xs font-semibold text-[color:var(--command-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--command-hover)]",
                focusRing,
              )}
            >
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              Open p.{source.page}
            </button>
            <button
              type="button"
              onClick={() => undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-semibold text-[color:var(--text)] transition hover:border-[color:var(--border-strong)]",
                focusRing,
              )}
            >
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
              Copy passage
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}

/* ────────────────────────────  device frames  ───────────────────────────── */

function Composer({ edgeToEdge = true }: { edgeToEdge?: boolean }) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-3 pb-3 pt-2",
        !edgeToEdge && "rounded-b-xl",
      )}
    >
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
      <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] py-1 pl-3.5 pr-1 shadow-[var(--shadow-inset)]">
        <span style={{ color: "var(--text-placeholder)" }} className="min-w-0 flex-1 truncate text-sm">
          Ask a follow-up…
        </span>
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

function FrameTopBar({ label }: { label: string }) {
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
        {label}
      </p>
      <span
        aria-hidden="true"
        className="inline-flex min-h-6 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-3xs font-semibold text-[color:var(--text-muted)]"
      >
        Answer
      </span>
    </div>
  );
}

/** 390px-wide phone study. The dock is absolutely positioned inside it. */
function PhoneFrame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        {caption}
      </figcaption>
      <div className="mx-auto w-full" style={{ maxWidth: PHONE_WIDTH }}>
        <div
          style={{ height: PHONE_HEIGHT, borderRadius: "1.75rem", borderWidth: 6 }}
          className="relative flex flex-col overflow-hidden border-[color:var(--border-strong)] bg-[color:var(--background)] shadow-[var(--shadow-elevated)]"
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

/** Desktop study — same transcript, centred reading column, rail sliver at left. */
function DesktopFrame({ caption, children }: { caption: string; children: React.ReactNode }) {
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
          {[ShieldCheck, FileText, BookOpen, Layers].map((Icon, index) => (
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

/* ─────────────────────────  A · numbered chips  ──────────────────────────── */

function ChipAnswer({
  activeId,
  onOpen,
  wide,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
  wide: boolean;
}) {
  return (
    <div className="group grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 space-y-2.5">
        <div style={PROSE_MEASURE} className="space-y-2.5">
          {ANSWER_BLOCKS.map((block) => {
            const source = sourceById(block.sourceId);
            return (
              <p
                key={block.id}
                className={cn(
                  "text-base-minus leading-prose text-[color:var(--text-heading)]",
                  block.safety && "font-medium",
                )}
              >
                {block.safety ? (
                  <ShieldAlert
                    aria-hidden="true"
                    style={{ top: -1 }}
                    className="relative mr-1.5 inline-block h-4 w-4 text-[color:var(--warning)]"
                  />
                ) : null}
                <ClaimWithChip
                  text={block.text}
                  source={source}
                  active={activeId === source.id}
                  onOpen={() => onOpen(source.id)}
                />
              </p>
            );
          })}
        </div>

        {/* The rail: every source at a glance, before anything is opened. */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => onOpen(source.id)}
              className={cn(
                "group/rail inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border bg-[color:var(--surface-raised)] px-2.5 text-left transition",
                "hover:shadow-[var(--e1)]",
                activeId === source.id
                  ? "border-[color:var(--clinical-accent)] shadow-[var(--e1)]"
                  : "border-[color:var(--border)] hover:border-[color:var(--border-strong)]",
                focusRing,
              )}
            >
              <span
                className={cn(
                  "nums grid h-5 min-w-5 place-items-center rounded-md border text-3xs font-bold",
                  source.status === "review-due"
                    ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                    : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
                )}
              >
                {source.index}
              </span>
              <span className="min-w-0">
                <span
                  style={{ maxWidth: 160 }}
                  className="block truncate text-2xs font-semibold leading-4 text-[color:var(--text-heading)]"
                >
                  {source.short}
                </span>
                <span className="block text-3xs leading-4 text-[color:var(--text-muted)]">
                  <span className="font-mono tabular-nums">p.{source.page}</span> · {statusLabel(source.status)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <VerifyDisclosure />
          <MessageActions hoverReveal={wide} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────  B · evidence margin  ─────────────────────────── */

function MarginAnswer({
  activeId,
  onOpen,
  wide,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
  wide: boolean;
}) {
  return (
    <div className="group space-y-2.5">
      <div className={cn(wide && "sm:flex sm:items-start sm:gap-5")}>
        <div className="min-w-0 flex-1">
          {/* The spine descends from the assistant's mark, and every claim hangs
              a node off it. No claim is allowed to sit on the spine unmarked. */}
          <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
            <div className="flex justify-center">
              <AssistantAvatar />
            </div>
            <span />
          </div>
          {ANSWER_BLOCKS.map((block, index) => {
            const source = sourceById(block.sourceId);
            const active = activeId === source.id;
            const last = index === ANSWER_BLOCKS.length - 1;
            return (
              <div key={block.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                <div className="relative flex justify-center">
                  <span
                    aria-hidden="true"
                    style={{ top: 0, bottom: last ? 24 : 0 }}
                    className="absolute w-px bg-[color:var(--border)]"
                  />
                  <button
                    type="button"
                    onClick={() => onOpen(source.id)}
                    aria-label={`Source ${source.index}: ${source.title}, page ${source.page}`}
                    aria-pressed={active}
                    className={cn(
                      "nums relative z-10 mt-1.5 grid h-5 w-5 shrink-0 place-items-center self-start rounded-full border text-3xs font-bold transition",
                      source.status === "review-due"
                        ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                        : "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
                      active && "ring-2 ring-[color:var(--clinical-accent)]/40",
                      focusRing,
                    )}
                  >
                    {source.index}
                  </button>
                </div>
                <div className="min-w-0 pb-1">
                  <p
                    style={PROSE_MEASURE}
                    className={cn(
                      "-mx-2 rounded-lg px-2 py-1 text-base-minus leading-prose transition-colors",
                      active
                        ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--text-heading)]"
                        : "text-[color:var(--text-heading)]",
                      block.safety && "font-medium",
                    )}
                  >
                    {block.safety ? (
                      <ShieldAlert
                        aria-hidden="true"
                        style={{ top: -1 }}
                        className="relative mr-1.5 inline-block h-4 w-4 text-[color:var(--warning)]"
                      />
                    ) : null}
                    {block.text}
                  </p>
                  {/* Phone-side apparatus. On desktop the gutter carries this,
                      so the line under the claim would be a second copy. */}
                  <button
                    type="button"
                    onClick={() => onOpen(source.id)}
                    className={cn(
                      "inline-flex min-h-6 items-center gap-1.5 rounded-md px-1 text-3xs font-semibold text-[color:var(--text-muted)] transition hover:text-[color:var(--clinical-accent)]",
                      wide && "sm:hidden",
                      focusRing,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(source.status))}
                    />
                    {source.short} · <span className="font-mono tabular-nums">p.{source.page}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop gutter: the apparatus, aligned to the claims it serves. */}
        {wide ? (
          <aside
            aria-label="Evidence margin"
            style={{ width: 208 }}
            className="hidden shrink-0 border-l border-[color:var(--border)] pl-3 sm:block"
          >
            <p className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">Evidence</p>
            <div className="mt-2 space-y-1">
              {SOURCES.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onOpen(source.id)}
                  className={cn(
                    "block w-full rounded-lg px-2 py-1.5 text-left transition",
                    activeId === source.id
                      ? "bg-[color:var(--clinical-accent-soft)]"
                      : "hover:bg-[color:var(--surface-subtle)]",
                    focusRing,
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(source.status))}
                    />
                    <span className="nums text-3xs font-bold text-[color:var(--clinical-accent)]">{source.index}</span>
                    <span className="min-w-0 truncate text-2xs font-semibold text-[color:var(--text-heading)]">
                      {source.short}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-3xs text-[color:var(--text-muted)]">
                    <span className="font-mono tabular-nums">p.{source.page}</span> · {source.support} · {source.score}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pl-8">
        <VerifyDisclosure />
        <MessageActions hoverReveal={wide} />
      </div>
    </div>
  );
}

/* ───────────────────────────  C · source deck  ───────────────────────────── */

function splitOnAnchor(text: string, anchor: string) {
  const at = text.indexOf(anchor);
  if (at < 0) return { before: text, match: "", after: "" };
  return { before: text.slice(0, at), match: anchor, after: text.slice(at + anchor.length) };
}

const currentCount = SOURCES.filter((source) => source.status === "current").length;
const reviewCount = SOURCES.length - currentCount;

function DeckAnswer({
  activeId,
  onOpen,
  wide,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
  wide: boolean;
}) {
  const [lead, ...rest] = ANSWER_BLOCKS;
  const leadSource = sourceById(lead.sourceId);

  return (
    <div className="group grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 space-y-3">
        {/* The verdict, at display weight. Everything after it is support. */}
        <p
          style={{ maxWidth: "54ch" }}
          className="text-lg-minus font-semibold leading-tight text-[color:var(--text-heading)]"
        >
          {(() => {
            const { before, match, after } = splitOnAnchor(lead.text, lead.anchor);
            return (
              <>
                {before}
                <InlineRef
                  onOpen={() => onOpen(leadSource.id)}
                  active={activeId === leadSource.id}
                  review={leadSource.status === "review-due"}
                >
                  {match}
                </InlineRef>
                {after}
              </>
            );
          })()}
        </p>

        <div style={PROSE_MEASURE} className="space-y-2">
          {rest.map((block) => {
            const source = sourceById(block.sourceId);
            const { before, match, after } = splitOnAnchor(block.text, block.anchor);
            const review = source.status === "review-due";
            return (
              <p
                key={block.id}
                className={cn(
                  "text-base-minus leading-prose text-[color:var(--text)]",
                  block.safety && "font-medium text-[color:var(--text-heading)]",
                )}
              >
                {block.safety ? (
                  <ShieldAlert
                    aria-hidden="true"
                    style={{ top: -1 }}
                    className="relative mr-1.5 inline-block h-4 w-4 text-[color:var(--warning)]"
                  />
                ) : null}
                {before}
                <InlineRef onOpen={() => onOpen(source.id)} active={activeId === source.id} review={review}>
                  {match}
                </InlineRef>
                {after}
              </p>
            );
          })}
        </div>

        {/* The deck. Closed it is one object with a legible edge; open it fans
            into the dock. Status is readable before anything is tapped. */}
        <div style={PROSE_MEASURE} className="relative pb-5">
          {/* Each card under the front one is a real source, and it carries that
              source's status on its edge — so the deck says "one of these is
              overdue" before anything is opened. */}
          <span
            aria-hidden="true"
            style={{ left: 24, right: 24, top: 28, bottom: 0 }}
            className="absolute rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
          />
          <span
            aria-hidden="true"
            style={{ left: 12, right: 12, top: 14, bottom: 10 }}
            className="absolute rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
          />
          <button
            type="button"
            onClick={() => onOpen(SOURCES[0].id)}
            aria-label={`Open ${SOURCES.length} sources`}
            className={cn(
              "relative block w-full rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface-raised)] px-3 py-2.5 text-left shadow-[var(--e2)] transition",
              "hover:shadow-[var(--shadow-hover)]",
              focusRing,
            )}
          >
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
              >
                <Layers aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                  {SOURCES.length} sources behind this answer
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-[color:var(--text-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
                    {currentCount} current
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[color:var(--warning)]" />
                    {reviewCount} review due
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>4 pages</span>
                </span>
              </span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 rotate-180 text-[color:var(--text-muted)]" />
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <VerifyDisclosure />
          <MessageActions hoverReveal={wide} />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────  screen assembly  ───────────────────────────── */

type Variant = "chips" | "margin" | "deck";

const VARIANT_LABEL: Record<Variant, string> = {
  chips: "A · Numbered chips",
  margin: "B · Evidence margin",
  deck: "C · Source deck",
};

function AnswerScreen({
  variant,
  wide,
  initialOpenId = null,
}: {
  variant: Variant;
  wide: boolean;
  initialOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [tab, setTab] = useState<DockTab>("Passages");
  const open = (id: string) => {
    setTab("Passages");
    setOpenId((current) => (current === id ? null : id));
  };
  const ordered = openId ? [sourceById(openId), ...SOURCES.filter((source) => source.id !== openId)] : SOURCES;

  return (
    <>
      <FrameTopBar label={VARIANT_LABEL[variant]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("space-y-4 px-3 py-3.5", wide && "mx-auto w-full max-w-3xl px-5 py-5")}>
          <PriorTurnGhost />
          <UserTurn text={QUESTION} />
          {variant === "chips" ? <ChipAnswer activeId={openId} onOpen={open} wide={wide} /> : null}
          {variant === "margin" ? <MarginAnswer activeId={openId} onOpen={open} wide={wide} /> : null}
          {variant === "deck" ? <DeckAnswer activeId={openId} onOpen={open} wide={wide} /> : null}
        </div>
      </div>
      <Composer />
      <DockShell
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={variant === "margin" ? "Evidence" : "Sources"}
        subtitle={
          variant === "deck"
            ? `${currentCount} current · ${reviewCount} review due · verify before use`
            : "Check the answer against the cited passage."
        }
        tab={tab}
        onTab={setTab}
        tone={variant === "deck" ? "deck" : "accent"}
      >
        {tab === "Passages" ? (
          <div className="space-y-2">
            {ordered.map((source, index) => (
              <PassageCard key={source.id} source={source} expanded={index === 0} />
            ))}
          </div>
        ) : (
          <DockPlaceholder tab={tab} />
        )}
      </DockShell>
    </>
  );
}

/* ────────────────────────────  page scaffold  ───────────────────────────── */

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs font-semibold leading-none",
        tone === "good" &&
          "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
        tone === "warn" &&
          "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
        tone === "neutral" &&
          "border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
      )}
    >
      {children}
    </span>
  );
}

function DirectionSection({
  variant,
  heading,
  idea,
  reference,
  strength,
  cost,
  recommended = false,
}: {
  variant: Variant;
  heading: string;
  idea: string;
  reference: string;
  strength: string;
  cost: string;
  recommended?: boolean;
}) {
  return (
    <section className="rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--e2)] sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[color:var(--text-heading)]">{heading}</h2>
            {recommended ? (
              <Pill tone="good">
                <Check aria-hidden="true" className="h-3 w-3" />
                Recommended
              </Pill>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm leading-6 text-[color:var(--text-muted)]">{idea}</p>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          ["Reference system", reference],
          ["Strength", strength],
          ["Cost", cost],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[color:var(--surface-subtle)] px-2.5 py-2">
            <dt className="text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              {label}
            </dt>
            <dd className="mt-1 text-2xs leading-5 text-[color:var(--text)]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="lg:shrink-0" style={{ width: "100%", maxWidth: PHONE_WIDTH }}>
          <PhoneFrame caption="Phone · tap any reference to open the dock">
            <AnswerScreen variant={variant} wide={false} />
          </PhoneFrame>
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          <DesktopFrame caption="Desktop · same transcript, wider reading column">
            <AnswerScreen variant={variant} wide />
          </DesktopFrame>
          <DesktopFrame caption="Desktop · dock open on the cited passage">
            <AnswerScreen variant={variant} wide initialOpenId="s2" />
          </DesktopFrame>
          <PhoneFrame caption="Phone · dock open on the cited passage">
            <AnswerScreen variant={variant} wide={false} initialOpenId="s2" />
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}

const COMPARISON: Array<[string, string, string, string]> = [
  ["Where the eye goes first", "The claim, then its number", "The claim, then the spine", "The verdict, then the deck"],
  ["Per-claim traceability", "Explicit · numbered", "Explicit · spatially aligned", "Implicit · underlined phrase"],
  ["Prose calm", "Good — chips are small", "Best — nothing inside the text", "Best — no marks between words"],
  ["Source status visible unopened", "Yes · rail + chip colour", "Yes · spine node colour", "Yes · deck summary line"],
  ["Works at 390px", "Yes", "Yes, but tallest of the three", "Yes"],
  ["Build cost from today", "Low", "Medium — new layout column", "Medium — needs claim anchors"],
];

export function AnswerChatRedesignMockupsPage() {
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
              PsychSift · design scratch
            </p>
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-[color:var(--text-heading)] sm:text-3xl">
            Answer page — chat transcript and reference system
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--text-muted)]">
            Three ways to make the answer read as a message rather than a stack of cards, each with a different way of
            pointing a claim at the passage it came from. Everything else is held constant: same question, same three
            sources, same bottom dock. Every frame is live — tap a reference.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill>One evidence surface, not four</Pill>
            <Pill>Per-claim citations</Pill>
            <Pill>Full prose, no 85-word cap</Pill>
            <Pill tone="warn">Source status always visible</Pill>
          </div>
        </header>

        <section className="rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--e2)] sm:p-4">
          <h2 className="text-base font-semibold text-[color:var(--text-heading)]">What all three change</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              [
                "One door to the evidence",
                "The live page opens four separate sheets — source capsule, clinical notes, evidence, safety findings. All three directions collapse those into a single bottom dock with three tabs.",
              ],
              [
                "Citations attach to claims",
                "Today the sources are a bulk pill under the whole answer, so nothing says which sentence rests on which page. Each direction binds a claim to exactly one source.",
              ],
              [
                "The message is the surface",
                "No card border, no query echo, no verification banner stacked above the prose. The assistant turn sits on the page like a chat message; the caution folds into one quiet line.",
              ],
              [
                "Safety lines keep their weight",
                "A withhold/escalate claim is rendered with a warning glyph and medium weight in every direction, so compaction can never bury it.",
              ],
            ].map(([title, body]) => (
              <li key={title} className="rounded-lg bg-[color:var(--surface-subtle)] px-3 py-2.5">
                <p className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</p>
                <p className="mt-1 text-2xs leading-5 text-[color:var(--text-muted)]">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <DirectionSection
          variant="chips"
          heading="A · Numbered chips and a source rail"
          idea="The closest thing to a familiar research assistant. Each claim ends in a small numbered token; under the message a horizontal rail names every source with its page and status, so the evidence base is legible before anything is opened."
          reference="Inline numeric chip, tinted by source status"
          strength="Unambiguous, scannable, and cheap to build on the current render model."
          cost="Small marks do sit inside the prose, which is the one thing a pure reading surface would avoid."
          recommended
        />

        <DirectionSection
          variant="margin"
          heading="B · Evidence margin"
          idea="An academic apparatus. On desktop a quiet right-hand gutter lists the evidence aligned to the paragraph it supports; on phones the gutter folds into a spine down the left of the message with a numbered node beside each claim. Selecting a node washes the paragraph it belongs to, so the link is shown rather than implied."
          reference="Margin marker aligned to the claim; spine on phones"
          strength="Nothing is printed between the words — the prose stays completely clean."
          cost="The most vertical space of the three on a phone — the spine adds a per-claim source line under every paragraph — and it needs a real second column on desktop, whose alignment has to survive long paragraphs."
        />

        <DirectionSection
          variant="deck"
          heading="C · Verdict and source deck"
          idea="Leads with a single bold verdict, then supporting prose. References are dotted underlines on the exact phrase they support instead of superscripts, and the whole evidence base is one striking stacked deck at the foot of the message that fans open into the dock."
          reference="Dotted underline on the supported phrase"
          strength="The most visually distinctive, and the deck reads as one object with a status summary you can take in at a glance."
          cost="An underline is a weaker pointer than a number when two claims lean on the same source."
        />

        <section className="rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--e2)] sm:p-4">
          <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Side by side</h2>
          <div className="mt-3 overflow-x-auto">
            <table style={{ minWidth: "44rem" }} className="w-full border-separate border-spacing-0 text-left text-2xs">
              <thead>
                <tr className="bg-[color:var(--surface-subtle)]">
                  {["", "A · Chips", "B · Margin", "C · Deck"].map((header) => (
                    <th
                      key={header || "row"}
                      className="border-b border-[color:var(--border)] px-2.5 py-2 font-semibold text-[color:var(--text-heading)]"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([label, a, b, c], index) => (
                  <tr key={label} className={cn(index % 2 === 1 && "bg-[color:var(--surface-subtle)]")}>
                    <th
                      scope="row"
                      className="border-t border-[color:var(--border)]/70 px-2.5 py-2 text-left font-semibold text-[color:var(--text)]"
                    >
                      {label}
                    </th>
                    {[a, b, c].map((cell, index) => (
                      <td
                        key={index}
                        className="border-t border-[color:var(--border)]/70 px-2.5 py-2 align-top leading-5 text-[color:var(--text-muted)]"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-3xl text-2xs leading-5 text-[color:var(--text-muted)]">
            A hybrid is available and probably the right end state: B&rsquo;s spine as the layout, A&rsquo;s numbered
            chips as the marker, and C&rsquo;s status summary line on the dock handle. Pick a direction first — the
            three are deliberately not blended here so the reference system can be judged on its own.
          </p>
        </section>
      </div>
    </main>
  );
}
