"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  ClipboardList,
  Clock,
  CornerDownLeft,
  FileText,
  Filter,
  Heart,
  LayoutList,
  Pill,
  Plus,
  Rows3,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  chatComposerIconButton,
  chatComposerInput,
  chatComposerShellBase,
  chatSendButton,
  cn,
} from "@/components/ui-primitives";
import { AnswerSuggestionChips } from "@/components/clinical-dashboard/answer-suggestion-chips";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/* ------------------------------------------------------------------ */
/* Mode configuration (mirrors the shape of appModeSearchConfig so     */
/* production wiring maps 1:1 onto src/lib/app-modes.ts)               */
/* ------------------------------------------------------------------ */

export type CommandMockModeId = "documents" | "services" | "forms" | "differentials" | "prescribing" | "favourites";

type BadgeTone = "accent" | "success" | "warning" | "danger" | "neutral";

type MatchRow = {
  id: string;
  title: string;
  meta: string;
  badge?: string;
  badgeTone?: BadgeTone;
  detail?: string;
  code?: string;
  scopes: string[];
  keywords: string;
};

type ModeConfig = {
  id: CommandMockModeId;
  label: string;
  icon: LucideIcon;
  placeholder: string;
  defaultQuery: string;
  examples: string[];
  recents: string[];
  suggestions: Array<{ text: string; meta: string }>;
  matches: MatchRow[];
  scopes: Array<{ id: string; label: string }>;
  actions: Array<{ label: string; icon: LucideIcon; hint: string }>;
  crossModes: CommandMockModeId[];
  resultsTitle: string;
  smartNotes: string[];
};

const modeConfigs: Record<CommandMockModeId, ModeConfig> = {
  documents: {
    id: "documents",
    label: "Documents",
    icon: FileText,
    placeholder: "Search documents…",
    defaultQuery: "cloz",
    examples: ["clozapine ANC thresholds", "lithium monitoring table", "QT prolongation quote"],
    recents: ["clozapine monitoring", "lithium levels", "olanzapine PRN limits"],
    suggestions: [
      { text: "clozapine monitoring table", meta: "Tables" },
      { text: "clozapine ANC thresholds", meta: "Guidelines" },
      { text: "clozapine rechallenge criteria", meta: "Quotes" },
    ],
    matches: [
      {
        id: "doc-1",
        title: "Clozapine prescribing and monitoring guidelines",
        meta: "Therapeutic Guidelines · v3.2 · Table 3 · p.12",
        badge: "Best match",
        badgeTone: "accent",
        detail: "92%",
        scopes: ["guidelines", "tables", "current"],
        keywords: "clozapine prescribing monitoring guidelines table",
      },
      {
        id: "doc-2",
        title: "Psychotropic medications monitoring handbook",
        meta: "PsychSift Repository · v2.1 · p.18",
        badge: "Current",
        badgeTone: "success",
        detail: "84%",
        scopes: ["guidelines", "current"],
        keywords: "clozapine psychotropic monitoring handbook reference",
      },
      {
        id: "doc-3",
        title: "Neutropenia management in clozapine therapy",
        meta: "Clinical Review · v1.0 · Table 3 · p.9",
        badge: "Review due",
        badgeTone: "warning",
        detail: "72%",
        scopes: ["tables"],
        keywords: "clozapine neutropenia anc management review",
      },
    ],
    scopes: [
      { id: "guidelines", label: "Guidelines" },
      { id: "tables", label: "Tables" },
      { id: "quotes", label: "Quotes" },
      { id: "current", label: "Current only" },
    ],
    actions: [
      { label: "Browse tables", icon: Table2, hint: "Evidence view" },
      { label: "Save this search", icon: Bookmark, hint: "My library" },
    ],
    crossModes: ["prescribing", "forms", "favourites"],
    resultsTitle: "Indexed documents",
    smartNotes: [
      "Match rows carry evidence chips (Table 3 · p.12) and freshness status so a result can be judged before opening.",
      "\u201cBest match\u201d is pinned first and mirrored between the dropdown preview and the full results table.",
      "Scope chips (Tables, Current only) re-filter the dropdown preview live \u2014 same contract as the results table.",
    ],
  },
  services: {
    id: "services",
    label: "Services",
    icon: ShieldCheck,
    placeholder: "Search services…",
    defaultQuery: "crisis",
    examples: ["crisis ATSI phone WA", "perinatal psychiatry metro", "older adult CMH Fremantle"],
    recents: ["13YARN", "crisis regional WA", "eating disorder program"],
    suggestions: [
      { text: "crisis phone referral", meta: "Route" },
      { text: "crisis ATSI-specific", meta: "Eligibility" },
      { text: "crisis free statewide", meta: "Cost" },
    ],
    matches: [
      {
        id: "svc-1",
        title: "13YARN",
        meta: "Crisis / urgent · self phone referral · 13 92 76",
        badge: "Best fit",
        badgeTone: "accent",
        detail: "Free · Medium confidence",
        scopes: ["crisis", "atsi", "free", "phone"],
        keywords: "13yarn crisis atsi aboriginal phone free",
      },
      {
        id: "svc-2",
        title: "Mental Health Emergency Response Line",
        meta: "Phone service · statewide · call charges may apply",
        badge: "Crisis",
        badgeTone: "danger",
        detail: "24/7",
        scopes: ["crisis", "phone"],
        keywords: "mental health emergency response line crisis phone statewide",
      },
      {
        id: "svc-3",
        title: "RuralLink",
        meta: "Regional WA · after-hours mental health",
        badge: "Regional",
        badgeTone: "neutral",
        detail: "Free",
        scopes: ["crisis", "free", "phone", "region"],
        keywords: "rurallink regional wa after hours crisis phone",
      },
    ],
    scopes: [
      { id: "crisis", label: "Crisis" },
      { id: "atsi", label: "ATSI-specific" },
      { id: "free", label: "Free" },
      { id: "phone", label: "Phone referral" },
      { id: "region", label: "My region" },
    ],
    actions: [
      { label: "Refine as filters", icon: Filter, hint: "Tokens \u2192 chips" },
      { label: "Compare shortlist", icon: Rows3, hint: "2 selected" },
    ],
    crossModes: ["documents", "favourites", "forms"],
    resultsTitle: "Referral matches",
    smartNotes: [
      "Rows preview confidence and cost inline \u2014 the two facts that decide whether a referral row is worth opening.",
      "\u201cRefine as filters\u201d converts typed tokens (crisis WA free) into scope chips so ranking becomes transparent.",
      "The shortlist / compare workflow stays one action away from every row.",
    ],
  },
  forms: {
    id: "forms",
    label: "Forms",
    icon: ClipboardList,
    placeholder: "Search forms…",
    defaultQuery: "4a",
    examples: ["transport order", "Form 3A detention", "extension of transport"],
    recents: ["Form 4A", "transport pathway", "examination referral"],
    suggestions: [
      { text: "transport order form 4A", meta: "Forms" },
      { text: "transport order extension 4B", meta: "Forms" },
      { text: "transport pathway PSOLIS", meta: "Pathways" },
    ],
    matches: [
      {
        id: "form-1",
        title: "Transport order",
        meta: "High risk · transport · MHA 2014 s.29",
        badge: "High risk",
        badgeTone: "danger",
        code: "4A",
        scopes: ["highrisk", "official", "pathway"],
        keywords: "4a transport order high risk",
      },
      {
        id: "form-2",
        title: "Extension of Transport Order",
        meta: "Transport · linked to PSOLIS pathway",
        badge: "Pathway",
        badgeTone: "accent",
        code: "4B",
        scopes: ["official", "pathway"],
        keywords: "4b extension transport order pathway",
      },
      {
        id: "form-3",
        title: "Detention to enable examination or movement",
        meta: "High risk · detention · MHA 2014 s.63",
        badge: "High risk",
        badgeTone: "danger",
        code: "3A",
        scopes: ["highrisk", "official"],
        keywords: "3a detention examination movement high risk",
      },
    ],
    scopes: [
      { id: "highrisk", label: "High risk" },
      { id: "official", label: "Official only" },
      { id: "pathway", label: "Pathway-linked" },
    ],
    actions: [
      { label: "View transport pathway", icon: ArrowRight, hint: "Before / after" },
      { label: "Check source evidence", icon: FileText, hint: "278 snippets" },
    ],
    crossModes: ["documents", "services", "favourites"],
    resultsTitle: "Form matches",
    smartNotes: [
      "Typing a bare form code (4a) pins that form's tile to the top of the dropdown with its pathway link.",
      "Form-number tiles reuse the existing results styling so the dropdown and table read as one system.",
      "High-risk forms keep the danger tone in every surface \u2014 dropdown, chips, and results.",
    ],
  },
  differentials: {
    id: "differentials",
    label: "Differentials",
    icon: BrainCircuit,
    placeholder: "Ask or search a presentation…",
    defaultQuery: "confusion",
    examples: ["acute confusion", "first episode psychosis", "catatonia vs NMS"],
    recents: ["confusion", "serotonin syndrome", "alcohol withdrawal"],
    suggestions: [
      { text: "acute confusion / encephalopathy", meta: "Presentation" },
      { text: "confusion post-ictal", meta: "Presentation" },
      { text: "confusion Wernicke risk", meta: "Red flag" },
    ],
    matches: [
      {
        id: "diff-1",
        title: "Acute confusion / encephalopathy",
        meta: "Fluctuating course · inattention · disorientation",
        badge: "Emergent",
        badgeTone: "danger",
        detail: "Best match",
        scopes: ["emergent"],
        keywords: "acute confusion encephalopathy fluctuating inattention",
      },
      {
        id: "diff-2",
        title: "Delirium",
        meta: "Acute onset (hours\u2013days) · fluctuating attention",
        badge: "Emergent",
        badgeTone: "danger",
        detail: "High match",
        scopes: ["emergent", "compare"],
        keywords: "delirium confusion acute attention",
      },
      {
        id: "diff-3",
        title: "Substance intoxication",
        meta: "Recent use · altered consciousness · ataxia",
        badge: "Emergent",
        badgeTone: "danger",
        detail: "Moderate",
        scopes: ["emergent", "compare"],
        keywords: "substance intoxication confusion altered consciousness",
      },
    ],
    scopes: [
      { id: "emergent", label: "Emergent only" },
      { id: "compare", label: "Compare mode" },
    ],
    actions: [
      { label: "Run source search", icon: Search, hint: "Validate locally" },
      { label: "Compare top 3", icon: Rows3, hint: "Side by side" },
    ],
    crossModes: ["documents", "prescribing", "forms"],
    resultsTitle: "Ranked diagnosis pages",
    smartNotes: [
      "Red-flag terms (confusion, overdose) raise a safety-first banner at the top of the dropdown before any ranking.",
      "Match rows keep the Emergent badge and match strength inline so triage happens at a glance.",
      "\u201cRun source search\u201d stays surfaced so demo rankings are always one step from real evidence.",
    ],
  },
  prescribing: {
    id: "prescribing",
    label: "Medication",
    icon: Pill,
    placeholder: "Search medications…",
    defaultQuery: "acamp",
    examples: ["acamprosate renal", "naltrexone dose ceiling", "disulfiram counselling"],
    recents: ["acamprosate", "clozapine titration", "lithium levels"],
    suggestions: [
      { text: "acamprosate renal dosing", meta: "Safety" },
      { text: "acamprosate ceiling 1,998 mg/day", meta: "Dose" },
      { text: "acamprosate vs naltrexone", meta: "Compare" },
    ],
    matches: [
      {
        id: "med-1",
        title: "Acamprosate",
        meta: "Alcohol abstinence maintenance",
        badge: "Exact renal dose match",
        badgeTone: "success",
        detail: "666 mg TID · ceiling 1,998 mg/day",
        scopes: ["indication", "safety", "renal"],
        keywords: "acamprosate alcohol abstinence renal creatinine",
      },
      {
        id: "med-2",
        title: "Naltrexone",
        meta: "Alcohol use disorder treatment",
        badge: "Good clinical fit",
        badgeTone: "accent",
        detail: "50 mg daily · ceiling 50 mg/day",
        scopes: ["indication"],
        keywords: "naltrexone alcohol opioid withdrawal",
      },
      {
        id: "med-3",
        title: "Baclofen",
        meta: "Off-label · specialist use · renal caution",
        badge: "Caution",
        badgeTone: "warning",
        detail: "5 mg TID · ceiling 80 mg/day",
        scopes: ["safety", "renal"],
        keywords: "baclofen alcohol off-label renal sedation",
      },
    ],
    scopes: [
      { id: "indication", label: "Indication" },
      { id: "safety", label: "Safety" },
      { id: "monitor", label: "Monitoring" },
      { id: "renal", label: "Renal dose" },
    ],
    actions: [
      { label: "Open dose calculator", icon: Table2, hint: "Renal adjust" },
      { label: "Monitoring schedule", icon: Clock, hint: "Per medicine" },
    ],
    crossModes: ["documents", "differentials", "favourites"],
    resultsTitle: "Prescribing matches",
    smartNotes: [
      "Dose and ceiling render inline on every row \u2014 the dropdown answers the common question without a page load.",
      "Medicine + \u201crenal\u201d in the query highlights the renal caution badge across dropdown and results.",
      "Rows without a full detail page are labelled instead of dead-ending.",
    ],
  },
  favourites: {
    id: "favourites",
    label: "Favourites",
    icon: Heart,
    placeholder: "Search favourites…",
    defaultQuery: "ward",
    examples: ["ward round set", "pinned monitoring tables", "clozapine clinic"],
    recents: ["Continue: Acamprosate renal screen", "lithium guideline", "QT prolongation quote"],
    suggestions: [
      { text: "ward round set", meta: "Sets" },
      { text: "ward round medication pages", meta: "Items" },
      { text: "ward round renal checks", meta: "Items" },
    ],
    matches: [
      {
        id: "fav-1",
        title: "Acamprosate renal screen",
        meta: "Medication · Ward round set",
        badge: "3 sources",
        badgeTone: "accent",
        detail: "Today 08:44",
        scopes: ["pinned", "source", "recent"],
        keywords: "acamprosate renal screen ward round medication",
      },
      {
        id: "fav-2",
        title: "renal dose saved search",
        meta: "Source · Ward round set",
        badge: "Saved query",
        badgeTone: "neutral",
        detail: "Today 07:55",
        scopes: ["recent", "source"],
        keywords: "renal dose saved search ward round",
      },
      {
        id: "fav-3",
        title: "Lithium monitoring guideline",
        meta: "Document · Prescribing safety set",
        badge: "PDF",
        badgeTone: "neutral",
        detail: "Today 08:20",
        scopes: ["source"],
        keywords: "lithium monitoring guideline prescribing safety pdf",
      },
    ],
    scopes: [
      { id: "pinned", label: "Pinned" },
      { id: "source", label: "Source-backed" },
      { id: "recent", label: "Recently used" },
    ],
    actions: [
      { label: "New set", icon: Plus, hint: "Organise" },
      { label: "Continue last item", icon: ArrowRight, hint: "Acamprosate" },
    ],
    crossModes: ["documents", "prescribing", "services"],
    resultsTitle: "Saved items",
    smartNotes: [
      "\u201cContinue where you left off\u201d is always the first recent row \u2014 the highest-value favourites action.",
      "Rows are grouped by set in the meta line, matching the library navigator's mental model.",
      "Quick views (Pinned, Source-backed, Recently used) become scope chips instead of a separate sidebar-only feature.",
    ],
  },
};

const modeOrder: CommandMockModeId[] = ["documents", "services", "forms", "differentials", "prescribing", "favourites"];

const redFlagTerms = ["confusion", "overdose", "suicid", "chest pain", "unresponsive", "catatoni"];

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

const badgeToneClasses: Record<BadgeTone, string> = {
  accent:
    "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  success: "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
  warning: "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
  danger: "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  neutral: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 shrink-0 items-center rounded-md border px-1.5 text-2xs font-bold",
        badgeToneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

function matchesQuery(row: MatchRow, query: string) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = `${row.title} ${row.keywords}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function matchesScopes(row: MatchRow, activeScopes: string[]) {
  return activeScopes.every((scope) => row.scopes.includes(scope));
}

/* ------------------------------------------------------------------ */
/* Layer 1 — context hint row with compact example chips               */
/* ------------------------------------------------------------------ */

function ContextHintRow({ mode, onPickExample }: { mode: ModeConfig; onPickExample: (example: string) => void }) {
  return <AnswerSuggestionChips suggestions={mode.examples} onPick={onPickExample} label="Examples" layout="scroll" />;
}

/* ------------------------------------------------------------------ */
/* Layer 2 — smart dropdown                                            */
/* ------------------------------------------------------------------ */

type DropdownItem = {
  id: string;
  kind: "recent" | "suggestion" | "match" | "action" | "cross";
  label: string;
  onSelect: () => void;
  render: (active: boolean) => ReactNode;
};

type DropdownSection = {
  key: string;
  heading?: string;
  layout?: "list" | "chips";
  items: DropdownItem[];
};

function OptionShell({ active, children, hint }: { active: boolean; children: ReactNode; hint: string }) {
  return (
    <div
      className={cn(
        "grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-1.5 transition",
        active ? "bg-[color:var(--clinical-accent-soft)]" : "hover:bg-[color:var(--surface-subtle)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">{children}</div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-2xs font-bold text-[color:var(--clinical-accent)]",
          active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        {hint}
        <CornerDownLeft className="h-3 w-3" />
      </span>
    </div>
  );
}

function MatchRowContent({ row, mode }: { row: MatchRow; mode: ModeConfig }) {
  const ModeIcon = mode.icon;
  return (
    <>
      {row.code ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-sm font-black text-[color:var(--clinical-accent)]">
          {row.code}
        </span>
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <ModeIcon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-extrabold text-[color:var(--text-heading)]">{row.title}</span>
          {row.badge ? <Badge tone={row.badgeTone}>{row.badge}</Badge> : null}
        </span>
        <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
          {row.meta}
          {row.detail ? <span className="font-bold text-[color:var(--text)]"> · {row.detail}</span> : null}
        </span>
      </span>
    </>
  );
}

function SmartDropdown({
  mode,
  query,
  activeScopes,
  activeItemId,
  listboxId,
  sections,
  showSafetyBanner,
  onHoverItem,
}: {
  mode: ModeConfig;
  query: string;
  activeScopes: string[];
  activeItemId: string | null;
  listboxId: string;
  sections: DropdownSection[];
  showSafetyBanner: boolean;
  onHoverItem: (id: string) => void;
}) {
  const hasAnyItems = sections.some((section) => section.items.length > 0);

  return (
    <div
      className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface)] shadow-[0_8px_20px_rgb(16_24_40_/_9%),0_24px_56px_rgb(16_24_40_/_14%)]"
      role="presentation"
    >
      {showSafetyBanner ? (
        <div className="flex items-start gap-2.5 border-b border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--danger)]" aria-hidden />
          <div className="min-w-0 text-xs font-semibold leading-5 text-[color:var(--text)]">
            <span className="font-extrabold uppercase tracking-wide text-[color:var(--danger)]">Safety first · </span>
            Stabilise ABCs, check BGL, sats, attention test, collateral, review meds/substances.
            <span className="ml-1 font-bold text-[color:var(--clinical-accent)]">View presentation guide</span>
          </div>
        </div>
      ) : null}

      <div
        id={listboxId}
        role="listbox"
        aria-label={`${mode.label} search suggestions`}
        className="max-h-[calc(100dvh-5rem)] sm:max-h-[26rem] overflow-y-auto p-2"
      >
        {sections.map((section) =>
          section.items.length ? (
            <div key={section.key} className="pb-1 last:pb-0">
              {section.heading ? (
                <div
                  role="presentation"
                  className="px-2.5 pb-1 pt-2 text-2xs font-extrabold uppercase tracking-[0.06em] text-[color:var(--text-soft)]"
                >
                  {section.heading}
                </div>
              ) : null}
              {section.layout === "chips" ? (
                <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-[color:var(--text-muted)]">
                    Search &ldquo;{query}&rdquo; in
                  </span>
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      id={item.id}
                      role="option"
                      aria-selected={activeItemId === item.id}
                      onMouseEnter={() => onHoverItem(item.id)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        item.onSelect();
                      }}
                      className="cursor-pointer"
                    >
                      {item.render(activeItemId === item.id)}
                    </div>
                  ))}
                </div>
              ) : (
                section.items.map((item) => (
                  <div
                    key={item.id}
                    id={item.id}
                    role="option"
                    aria-selected={activeItemId === item.id}
                    onMouseEnter={() => onHoverItem(item.id)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      item.onSelect();
                    }}
                    className="cursor-pointer"
                  >
                    {item.render(activeItemId === item.id)}
                  </div>
                ))
              )}
            </div>
          ) : null,
        )}
        {!hasAnyItems ? (
          <div className="px-3 py-4 text-sm font-semibold text-[color:var(--text-muted)]">
            No suggestions for &ldquo;{query}&rdquo;{activeScopes.length ? " with the current scope filters" : ""}.
            Press Enter to run the full search.
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-2 text-2xs font-bold text-[color:var(--text-soft)]">
        <span className="inline-flex items-center gap-2">
          <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 font-mono">
            &uarr;&darr;
          </kbd>{" "}
          navigate
          <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 font-mono">
            &crarr;
          </kbd>{" "}
          open / search
          <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 font-mono">
            esc
          </kbd>{" "}
          close
        </span>
        <span>Enter with nothing highlighted runs the full search</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layer 3 — scope chips                                               */
/* ------------------------------------------------------------------ */

function ScopeChipRow({
  mode,
  activeScopes,
  onToggle,
}: {
  mode: ModeConfig;
  activeScopes: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${mode.label} search scope`}>
      {mode.scopes.map((scope) => {
        const active = activeScopes.includes(scope.id);
        return (
          <button
            key={scope.id}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(scope.id)}
            className={cn(
              "answer-footer-search-chip",
              focusRing,
              active &&
                "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
            )}
          >
            {active ? <X className="h-3.5 w-3.5" aria-hidden /> : null}
            {scope.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layer 4 — unified results header band + results states             */
/* ------------------------------------------------------------------ */

type ResultsState = "populated" | "loading" | "empty";

function ResultsHeaderBand({
  mode,
  query,
  count,
  activeScopes,
  view,
  onRemoveScope,
  onViewChange,
}: {
  mode: ModeConfig;
  query: string;
  count: number;
  activeScopes: string[];
  view: "table" | "list";
  onRemoveScope: (id: string) => void;
  onViewChange: (view: "table" | "list") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 shadow-[var(--shadow-inset)]">
      <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 text-xs font-bold text-[color:var(--clinical-accent)]">
        <Search className="h-3 w-3" aria-hidden />
        {query || "All"}
      </span>
      <span className="text-sm font-extrabold text-[color:var(--text-heading)]">
        {count} {count === 1 ? "match" : "matches"}
      </span>
      {activeScopes.map((scopeId) => {
        const scope = mode.scopes.find((entry) => entry.id === scopeId);
        if (!scope) return null;
        return (
          <button
            key={scope.id}
            type="button"
            onClick={() => onRemoveScope(scope.id)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 text-xs font-bold text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]",
              focusRing,
            )}
          >
            {scope.label}
            <X className="h-3 w-3" aria-hidden />
          </button>
        );
      })}
      <div className="ml-auto flex items-center gap-1.5">
        <label className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-xs font-bold text-[color:var(--text-muted)]">
          Sort
          <select
            className="bg-transparent text-xs font-bold text-[color:var(--text)] outline-none"
            aria-label="Sort results"
            defaultValue="relevance"
          >
            <option value="relevance">Relevance</option>
            <option value="recent">Last used</option>
            <option value="alpha">A&ndash;Z</option>
          </select>
        </label>
        <div
          className="inline-flex overflow-hidden rounded-lg border border-[color:var(--border)]"
          role="group"
          aria-label="Results view"
        >
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => onViewChange("table")}
            className={cn(
              "grid h-9 w-9 place-items-center",
              focusRing,
              view === "table"
                ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "text-[color:var(--text-muted)]",
            )}
          >
            <Table2 className="h-4 w-4" aria-hidden />
            <span className="sr-only">Table view</span>
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => onViewChange("list")}
            className={cn(
              "grid h-9 w-9 place-items-center border-l border-[color:var(--border)]",
              focusRing,
              view === "list"
                ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : "text-[color:var(--text-muted)]",
            )}
          >
            <LayoutList className="h-4 w-4" aria-hidden />
            <span className="sr-only">List view</span>
          </button>
        </div>
        <button
          type="button"
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-2.5 text-xs font-extrabold text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
            focusRing,
          )}
        >
          <Bookmark className="h-3.5 w-3.5" aria-hidden />
          Save search
        </button>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3" aria-hidden>
      <span className="h-9 w-9 rounded-lg bg-[color:var(--surface-subtle)]" />
      <span className="space-y-1.5">
        <span className="block h-3.5 w-2/3 rounded-md bg-[color:var(--surface-subtle)] bg-[length:200%_100%] bg-no-repeat bg-[linear-gradient(100deg,transparent_30%,color-mix(in_srgb,var(--surface-highlight)_72%,transparent)_50%,transparent_70%)] motion-safe:animate-shimmer" />
        <span className="block h-3 w-1/3 rounded-md bg-[color:var(--surface-subtle)]" />
      </span>
      <span className="h-6 w-14 rounded-md bg-[color:var(--surface-subtle)]" />
    </div>
  );
}

function ResultsPanel({
  mode,
  query,
  rows,
  state,
  activeScopes,
  onClearScopes,
  onPickExample,
  onCrossMode,
  onOpenRow,
}: {
  mode: ModeConfig;
  query: string;
  rows: MatchRow[];
  state: ResultsState;
  activeScopes: string[];
  onClearScopes: () => void;
  onPickExample: (example: string) => void;
  onCrossMode: (target: CommandMockModeId) => void;
  onOpenRow: (row: MatchRow) => void;
}) {
  if (state === "loading") {
    return (
      <div
        className="divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
        role="status"
        aria-label="Loading results"
      >
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <span className="sr-only">Loading {mode.label.toLowerCase()} results</span>
      </div>
    );
  }

  if (state === "empty" || rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] p-5 text-center shadow-[var(--shadow-inset)]">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[color:var(--surface)] text-[color:var(--text-muted)]">
          <Search className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-extrabold text-[color:var(--text-heading)]">
          No {mode.label.toLowerCase()} matches for &ldquo;{query}&rdquo;
        </p>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          Relax the scope, try an example, or jump to another mode.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {activeScopes.length ? (
            <button
              type="button"
              onClick={onClearScopes}
              className={cn(
                "inline-flex min-h-9 items-center gap-1 rounded-lg border border-[color:var(--clinical-accent-border)] px-3 text-xs font-extrabold text-[color:var(--clinical-accent)]",
                focusRing,
              )}
            >
              Clear scope filters ({activeScopes.length})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onPickExample(mode.examples[0])}
            className={cn(
              "inline-flex min-h-9 items-center rounded-lg border border-[color:var(--border)] px-3 text-xs font-extrabold text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
              focusRing,
            )}
          >
            Try: {mode.examples[0]}
          </button>
          {mode.crossModes.slice(0, 2).map((target) => {
            const targetMode = modeConfigs[target];
            const TargetIcon = targetMode.icon;
            return (
              <button
                key={target}
                type="button"
                onClick={() => onCrossMode(target)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 text-xs font-extrabold text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
                  focusRing,
                )}
              >
                <TargetIcon className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" aria-hidden />
                Search in {targetMode.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
      {rows.map((row, index) => {
        const ModeIcon = mode.icon;
        return (
          <div
            key={row.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-3 hover:bg-[color:var(--surface-subtle)]"
          >
            {row.code ? (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-sm font-black text-[color:var(--clinical-accent)]">
                {row.code}
              </span>
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <ModeIcon className="h-4 w-4" aria-hidden />
              </span>
            )}
            <span className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {index === 0 && !row.badge ? <Badge tone="accent">Best match</Badge> : null}
                <span className="truncate text-sm font-extrabold text-[color:var(--text-heading)]">{row.title}</span>
                {row.badge ? <Badge tone={row.badgeTone}>{row.badge}</Badge> : null}
              </span>
              <span className="mt-0.5 block truncate text-xs font-medium text-[color:var(--text-muted)]">
                {row.meta}
              </span>
            </span>
            <span className="hidden text-right text-xs font-bold text-[color:var(--text)] sm:block">
              {row.detail ?? ""}
            </span>
            <button
              type="button"
              onClick={() => onOpenRow(row)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1 rounded-lg border border-[color:var(--clinical-accent-border)] px-3 text-xs font-extrabold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)]",
                focusRing,
              )}
            >
              Open
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The complete command surface for one mode                           */
/* ------------------------------------------------------------------ */

function CommandSurfaceDemo({
  mode,
  onCrossMode,
  resultsState,
  onResultsStateChange,
  onDemoEvent,
}: {
  mode: ModeConfig;
  onCrossMode: (target: CommandMockModeId, query: string) => void;
  resultsState: ResultsState;
  onResultsStateChange: (state: ResultsState) => void;
  onDemoEvent: (message: string) => void;
}) {
  const [query, setQuery] = useState(mode.defaultQuery);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeScopes, setActiveScopes] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [view, setView] = useState<"table" | "list">("table");
  const inputRef = useRef<HTMLInputElement>(null);

  const listboxId = `universal-command-listbox-${mode.id}`;
  const trimmedQuery = query.trim();

  // The page renders this component with key={mode.id}, so switching modes
  // remounts it and every piece of state resets through the initialisers above.

  // Global "/" shortcut demo.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const previewMatches = useMemo(
    () => mode.matches.filter((row) => matchesQuery(row, trimmedQuery) && matchesScopes(row, activeScopes)).slice(0, 3),
    [mode, trimmedQuery, activeScopes],
  );

  const resultRows = useMemo(
    () => mode.matches.filter((row) => matchesScopes(row, activeScopes)),
    [mode, activeScopes],
  );

  const filteredSuggestions = useMemo(() => {
    if (!trimmedQuery) return [];
    const lowered = trimmedQuery.toLowerCase();
    return mode.suggestions
      .filter(
        (entry) =>
          entry.text.toLowerCase().includes(lowered) ||
          lowered.split(/\s+/).every((token) => entry.text.toLowerCase().includes(token)),
      )
      .slice(0, 4);
  }, [mode, trimmedQuery]);

  const showSafetyBanner =
    mode.id === "differentials" && redFlagTerms.some((term) => trimmedQuery.toLowerCase().includes(term));

  const formCodeMatch = useMemo(() => {
    if (mode.id !== "forms") return null;
    const codeQuery = trimmedQuery.replace(/^form\s+/i, "").trim();
    if (!/^\d{1,2}[a-z]?$/i.test(codeQuery)) return null;
    return mode.matches.find((row) => row.code?.toLowerCase() === codeQuery.toLowerCase()) ?? null;
  }, [mode, trimmedQuery]);

  function runSearch(nextQuery = trimmedQuery) {
    setDropdownOpen(false);
    setActiveIndex(-1);
    onResultsStateChange("populated");
    onDemoEvent(`Ran ${mode.label.toLowerCase()} search for \u201c${nextQuery || "all"}\u201d`);
  }

  const sections = useMemo<DropdownSection[]>(() => {
    const built: DropdownSection[] = [];
    let counter = 0;
    const nextId = () => `${listboxId}-item-${counter++}`;

    if (formCodeMatch) {
      built.push({
        key: "form-code",
        heading: "Form code match",
        items: [
          {
            id: nextId(),
            kind: "match",
            label: formCodeMatch.title,
            onSelect: () => {
              setDropdownOpen(false);
              onDemoEvent(`Opened Form ${formCodeMatch.code} \u2014 ${formCodeMatch.title}`);
            },
            render: (active) => (
              <OptionShell active={active} hint="Open">
                <MatchRowContent row={formCodeMatch} mode={mode} />
              </OptionShell>
            ),
          },
        ],
      });
    }

    if (!trimmedQuery) {
      built.push({
        key: "recents",
        heading: `Recent in ${mode.label}`,
        items: mode.recents.map((recent) => ({
          id: nextId(),
          kind: "recent" as const,
          label: recent,
          onSelect: () => {
            const value = recent.replace(/^Continue:\s*/, "");
            setQuery(value);
            runSearch(value);
          },
          render: (active) => (
            <OptionShell active={active} hint="Search">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                {recent.startsWith("Continue:") ? <ArrowRight className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              </span>
              <span className="truncate text-sm font-semibold text-[color:var(--text)]">{recent}</span>
            </OptionShell>
          ),
        })),
      });
    } else {
      built.push({
        key: "suggestions",
        heading: "Suggestions",
        items: filteredSuggestions.map((suggestion) => ({
          id: nextId(),
          kind: "suggestion" as const,
          label: suggestion.text,
          onSelect: () => {
            setQuery(suggestion.text);
            runSearch(suggestion.text);
          },
          render: (active) => (
            <OptionShell active={active} hint="Search">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                <Search className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[color:var(--text)]">{suggestion.text}</span>
              </span>
              <Badge>{suggestion.meta}</Badge>
            </OptionShell>
          ),
        })),
      });
    }

    built.push({
      key: "matches",
      heading: "Top matches",
      items: previewMatches
        .filter((row) => row.id !== formCodeMatch?.id)
        .map((row) => ({
          id: nextId(),
          kind: "match" as const,
          label: row.title,
          onSelect: () => {
            setDropdownOpen(false);
            onDemoEvent(`Opened \u201c${row.title}\u201d directly from the dropdown`);
          },
          render: (active) => (
            <OptionShell active={active} hint="Open">
              <MatchRowContent row={row} mode={mode} />
            </OptionShell>
          ),
        })),
    });

    built.push({
      key: "actions",
      heading: `${mode.label} actions`,
      items: mode.actions.map((action) => ({
        id: nextId(),
        kind: "action" as const,
        label: action.label,
        onSelect: () => {
          setDropdownOpen(false);
          onDemoEvent(`Triggered action \u201c${action.label}\u201d`);
        },
        render: (active) => (
          <OptionShell active={active} hint="Run">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
              <action.icon className="h-4 w-4" />
            </span>
            <span className="truncate text-sm font-semibold text-[color:var(--text)]">{action.label}</span>
            <Badge>{action.hint}</Badge>
          </OptionShell>
        ),
      })),
    });

    if (trimmedQuery) {
      built.push({
        key: "cross-mode",
        layout: "chips",
        items: mode.crossModes.map((target) => {
          const targetMode = modeConfigs[target];
          const TargetIcon = targetMode.icon;
          return {
            id: nextId(),
            kind: "cross" as const,
            label: targetMode.label,
            onSelect: () => onCrossMode(target, trimmedQuery),
            render: (active) => (
              <span
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition",
                  active
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]",
                )}
              >
                <TargetIcon className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" aria-hidden />
                {targetMode.label}
              </span>
            ),
          };
        }),
      });
    }

    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, trimmedQuery, filteredSuggestions, previewMatches, formCodeMatch, listboxId]);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const activeItemId = activeIndex >= 0 && activeIndex < flatItems.length ? flatItems[activeIndex].id : null;

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((current) => (current + 1) % Math.max(flatItems.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((current) => (current <= 0 ? flatItems.length - 1 : current - 1));
    } else if (event.key === "Home" && dropdownOpen && flatItems.length) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && dropdownOpen && flatItems.length) {
      event.preventDefault();
      setActiveIndex(flatItems.length - 1);
    } else if (event.key === "Escape") {
      setDropdownOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (dropdownOpen && activeIndex >= 0 && flatItems[activeIndex]) {
        flatItems[activeIndex].onSelect();
      } else {
        runSearch();
      }
    }
  }

  function toggleScope(id: string) {
    setActiveScopes((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  const effectiveRows = resultsState === "empty" ? [] : resultRows;
  const displayedCount = resultsState === "loading" ? 0 : effectiveRows.length;

  return (
    <div className="overflow-visible rounded-xl border border-[color:var(--border)] bg-[color:var(--background)]">
      {/* Mock app chrome: brand + centred MODE pill + New chat */}
      <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-[color:var(--border)] bg-[color:var(--surface)] px-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-xs font-black text-[color:var(--clinical-accent-contrast)]">
            R
          </span>
        </div>
        <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-2 pr-3 text-sm font-extrabold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]">
            <mode.icon className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="block text-3xs font-bold uppercase tracking-wide text-[color:var(--text-soft)]">Mode</span>
            {mode.label}
          </span>
        </span>
        <span className="justify-self-end rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-xs font-bold text-[color:var(--text-muted)]">
          New chat
        </span>
      </div>

      <div className="px-4 pb-6 pt-5 sm:px-6">
        {/* Command surface */}
        <div className="mx-auto w-full max-w-3xl">
          <ContextHintRow
            mode={mode}
            onPickExample={(example) => {
              setQuery(example);
              setDropdownOpen(true);
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
          />

          <div className="relative mt-1.5">
            {/* The pill bar itself — pixel copy of the production composer, untouched */}
            <form
              className={cn(chatComposerShellBase, "answer-footer-search-pill relative z-10 w-full")}
              onSubmit={(event) => {
                event.preventDefault();
                runSearch();
              }}
              role="search"
              aria-label={`${mode.label} search`}
            >
              <button
                type="button"
                className={cn(chatComposerIconButton, "answer-footer-search-action")}
                aria-label="Search actions"
              >
                <Plus className="h-5 w-5" />
              </button>
              <label className="flex min-w-0 flex-1 items-center overflow-hidden">
                <span className="sr-only">{mode.placeholder}</span>
                <input
                  ref={inputRef}
                  value={query}
                  role="combobox"
                  aria-expanded={dropdownOpen}
                  aria-controls={listboxId}
                  aria-activedescendant={activeItemId ?? undefined}
                  aria-autocomplete="list"
                  placeholder={mode.placeholder}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setDropdownOpen(true);
                    setActiveIndex(-1);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => {
                    setDropdownOpen(false);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={handleInputKeyDown}
                  className={cn(chatComposerInput, "answer-footer-search-input w-full min-w-0")}
                />
                {query ? (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setQuery("");
                      setActiveIndex(-1);
                      inputRef.current?.focus();
                    }}
                    className={cn(chatComposerIconButton, "h-9 w-9")}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </label>
              <span className="answer-footer-search-divider" aria-hidden="true" />
              <button
                type="submit"
                className={cn(chatSendButton, "answer-footer-search-send")}
                aria-label={`Search ${mode.label.toLowerCase()}`}
              >
                <Search className="h-5 w-5" />
              </button>
            </form>

            {dropdownOpen ? (
              <SmartDropdown
                mode={mode}
                query={trimmedQuery}
                activeScopes={activeScopes}
                activeItemId={activeItemId}
                listboxId={listboxId}
                sections={sections}
                showSafetyBanner={showSafetyBanner}
                onHoverItem={(id) => {
                  const index = flatItems.findIndex((item) => item.id === id);
                  if (index >= 0) setActiveIndex(index);
                }}
              />
            ) : null}
          </div>

          <div className="mt-2.5">
            <ScopeChipRow mode={mode} activeScopes={activeScopes} onToggle={toggleScope} />
          </div>
        </div>

        {/* Unified results band + results */}
        <div className="mx-auto mt-6 w-full max-w-4xl space-y-3">
          <ResultsHeaderBand
            mode={mode}
            query={trimmedQuery}
            count={displayedCount}
            activeScopes={activeScopes}
            view={view}
            onRemoveScope={toggleScope}
            onViewChange={setView}
          />
          <ResultsPanel
            mode={mode}
            query={trimmedQuery}
            rows={effectiveRows}
            state={resultsState}
            activeScopes={activeScopes}
            onClearScopes={() => setActiveScopes([])}
            onPickExample={(example) => {
              setQuery(example);
              onResultsStateChange("populated");
            }}
            onCrossMode={(target) => onCrossMode(target, trimmedQuery)}
            onOpenRow={(row) => onDemoEvent(`Opened \u201c${row.title}\u201d from results`)}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wiring map                                                          */
/* ------------------------------------------------------------------ */

const wiringMap: Array<{ piece: string; target: string; notes: string }> = [
  {
    piece: "Context hint row (rotating examples, / hint)",
    target: "src/components/clinical-dashboard/master-search-header.tsx",
    notes:
      "Rendered above the composer on sm+; example sets defined per mode in src/lib/app-modes.ts (extend search config with examples[]).",
  },
  {
    piece: "Smart dropdown (recents, suggestions, top matches, actions, cross-mode)",
    target: "src/components/clinical-dashboard/master-search-header.tsx",
    notes:
      "New sibling of the composer form; recents read the existing clinical-kb-recent-queries store extended per-mode; top matches call the same ranking helpers each mode already uses (rankServiceRecords, rankFormRecords, document search API).",
  },
  {
    piece: "Scope chips row",
    target: "src/lib/app-modes.ts + master-search-header.tsx",
    notes:
      "Chip definitions live beside placeholder/submit config; chips write to the same URL params the results pages already read.",
  },
  {
    piece: "Unified results header band",
    target:
      "Per-page results components (services-navigator-page.tsx, forms-search-results-page.tsx, document-search-results.tsx, favourites-command-library-page.tsx, medication-prescribing-workspace.tsx, differentials-home.tsx)",
    notes:
      "One shared component (query echo, count, scope chips, sort, view toggle, save) replacing each page's improvised header.",
  },
  {
    piece: "Skeleton + empty states",
    target: "Same per-page results components",
    notes:
      "Fixes the current gaps where Services/Forms render blank lists on zero matches; empty state offers scope-clear, example, and cross-mode jumps.",
  },
  {
    piece: "Safety banner / form-code recognition / dose inline",
    target: "Mode-specific dropdown row renderers",
    notes:
      "Red-flag term list for differentials; /^\\d{1,2}[a-z]?$/ code detection for forms; dose/ceiling fields on medication rows.",
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function UniversalSearchCommandMockupsPage() {
  const [modeId, setModeId] = useState<CommandMockModeId>("documents");
  const [resultsState, setResultsState] = useState<ResultsState>("populated");
  const [demoEvent, setDemoEvent] = useState<string | null>(null);

  const mode = modeConfigs[modeId];

  function handleCrossMode(target: CommandMockModeId, query: string) {
    setModeId(target);
    setResultsState("populated");
    setDemoEvent(`Jumped to ${modeConfigs[target].label} with \u201c${query}\u201d`);
  }

  return (
    <div className="min-h-full bg-[color:var(--background)] text-[color:var(--text)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[color:var(--clinical-accent)]">
            Universal search command surface
          </p>
          <h1 className="mt-2 text-balance text-3xl font-extrabold text-[color:var(--text-heading)] sm:text-4xl">
            One smart surface around the untouched pill bar
          </h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)] sm:text-base">
            The pill composer stays pixel-identical. Everything new wraps around it: a context hint row with rotating
            per-mode examples, a smart dropdown (recents, suggestions, live top-match previews, mode actions, cross-mode
            jump), mode-aware scope chips, and one consistent results header band with proper loading and empty states.
            Fully interactive &mdash; type, use arrow keys, press
            <kbd className="mx-1 rounded border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1 font-mono text-xs">
              /
            </kbd>
            anywhere to focus.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Mode tabs + demo controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {modeOrder.map((id) => {
              const entry = modeConfigs[id];
              const EntryIcon = entry.icon;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setModeId(id);
                    setResultsState("populated");
                    setDemoEvent(null);
                  }}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-extrabold transition",
                    focusRing,
                    modeId === id
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                  )}
                >
                  <EntryIcon className="h-4 w-4" aria-hidden />
                  {entry.label}
                </button>
              );
            })}
          </div>
          <label className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text-muted)]">
            Results state
            <select
              value={resultsState}
              onChange={(event) => setResultsState(event.target.value as ResultsState)}
              className="bg-transparent text-xs font-bold text-[color:var(--text)] outline-none"
              aria-label="Results state"
            >
              <option value="populated">Populated</option>
              <option value="loading">Loading</option>
              <option value="empty">Empty</option>
            </select>
          </label>
        </div>

        {demoEvent ? (
          <p
            className="mt-3 inline-flex min-h-8 items-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-xs font-bold text-[color:var(--clinical-accent)]"
            role="status"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {demoEvent}
          </p>
        ) : null}

        {/* Canvas + annotation rail */}
        <section className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <CommandSurfaceDemo
            key={mode.id}
            mode={mode}
            onCrossMode={handleCrossMode}
            resultsState={resultsState}
            onResultsStateChange={setResultsState}
            onDemoEvent={setDemoEvent}
          />

          <aside className="space-y-4">
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
              <h2 className="text-sm font-extrabold text-[color:var(--text-heading)]">
                Smart features in {mode.label}
              </h2>
              <ul className="mt-2 space-y-2 text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                {mode.smartNotes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <span className="text-[color:var(--clinical-accent)]">·</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-[color:var(--text-muted)]">
                Shared across all six modes
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm font-medium text-[color:var(--text)]">
                <li className="flex gap-2">
                  <span className="text-[color:var(--clinical-accent)]">·</span>
                  <span>Hint row: mode identity + rotating example queries (reduced-motion aware)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[color:var(--clinical-accent)]">·</span>
                  <span>Dropdown: recents when empty, suggestions + top matches while typing</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[color:var(--clinical-accent)]">·</span>
                  <span>Enter opens the highlighted row; Enter on the bar runs the full search</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[color:var(--clinical-accent)]">·</span>
                  <span>Scope chips filter both the dropdown preview and the results table</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[color:var(--clinical-accent)]">·</span>
                  <span>Cross-mode jump keeps the query when the mode was wrong</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[color:var(--clinical-accent)]">·</span>
                  <span>One results band: query echo, count, sort, view toggle, save search</span>
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-[color:var(--text-muted)]">
                Try these
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm font-medium text-[color:var(--text-muted)]">
                <li className="flex gap-2">
                  <span>1.</span>
                  <span>Clear the query, focus the bar &mdash; recents appear</span>
                </li>
                <li className="flex gap-2">
                  <span>2.</span>
                  <span>Arrow down through rows, press Enter on a top match</span>
                </li>
                <li className="flex gap-2">
                  <span>3.</span>
                  <span>Toggle a scope chip and watch the dropdown re-filter</span>
                </li>
                <li className="flex gap-2">
                  <span>4.</span>
                  <span>Forms mode: type just &ldquo;4a&rdquo;</span>
                </li>
                <li className="flex gap-2">
                  <span>5.</span>
                  <span>Differentials mode: type &ldquo;confusion&rdquo; for the safety banner</span>
                </li>
                <li className="flex gap-2">
                  <span>6.</span>
                  <span>Switch results state to Loading / Empty</span>
                </li>
              </ul>
            </div>
          </aside>
        </section>

        {/* Wiring map */}
        <section className="mt-10 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5">
          <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">Production wiring map</h2>
          <p className="mt-1 max-w-3xl text-sm font-medium text-[color:var(--text-muted)]">
            Where each piece lands once this direction is approved. No shared CSS changes are needed &mdash; the mockup
            reuses the existing composer primitives untouched.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {wiringMap.map((entry) => (
              <article
                key={entry.piece}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3"
              >
                <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">{entry.piece}</h3>
                <p className="mt-1 break-words font-mono text-xs font-semibold text-[color:var(--clinical-accent)]">
                  {entry.target}
                </p>
                <p className="mt-1.5 text-sm font-medium leading-5 text-[color:var(--text-muted)]">{entry.notes}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
