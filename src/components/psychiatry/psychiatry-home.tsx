"use client";

import {
  Calculator,
  ChevronRight,
  Compass,
  FileText,
  GitCompareArrows,
  Map as MapIcon,
  Network,
  Pill,
  Search,
  Tags,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { DashTag, IconChip } from "@/components/dashboard-kit/icon-chip";
import type { DashQuickAction } from "@/components/dashboard-kit/quick-actions";
import { dashFigure, dashLink, dashMuted, dashSurface } from "@/components/dashboard-kit/recipes";
import { ProgressRing } from "@/components/dashboard-kit/rings";
import { InformationPageShell } from "@/components/information-page-shell";
import { readAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { cn } from "@/components/ui-primitives";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import {
  clearPsychiatryVisits,
  EMPTY_PSYCHIATRY_VISIT_STATE,
  formatPsychiatryVisitWhen,
  loadPsychiatryVisitState,
  mostOpenedForms,
  PSYCHIATRY_VISIT_KIND_LABEL,
  psychiatryMonthFigures,
  psychiatryWeekBySection,
  subscribePsychiatryVisits,
  type PsychiatryVisit,
  type PsychiatryVisitKind,
} from "@/lib/psychiatry-hub/visits";
import { sharedHomePresentation } from "@/lib/ui-copy";

/**
 * The Psychiatry hub, drawn in the dashboard style My Day uses (owner decision,
 * 3 October 2026: "designed like the personal hub"), in three pages: Ask, Tools
 * and Saved.
 *
 * It is a front door, not clinical content: every card is a way into a section
 * that keeps its own address and search. Colour here is decoration or a
 * section, never a source's status; green, amber and red are not used.
 *
 * The figures are real or absent. Section counts come from the catalogues (read
 * on the server); "Continue", the ring and the forms card read this device's
 * own history (`src/lib/psychiatry-hub/visits.ts`), and a card with nothing to
 * show says so in one line or is left out.
 *
 * The layout is meant to be reused for a "Medicines and tools" hub, and leaves
 * room for a culturally safe care card should First Nations move here.
 */

export interface PsychiatrySectionCounts {
  readonly dsm: number;
  readonly differentials: number;
  readonly presentations: number;
  readonly specifiers: number;
  readonly formulation: number;
  readonly therapy: number;
  readonly forms: number;
}

const PAGE_IDS = ["ask", "tools", "saved"] as const;
type PsychiatryPageId = (typeof PAGE_IDS)[number];
const PAGE_LABELS: Readonly<Record<PsychiatryPageId, string>> = { ask: "Ask", tools: "Tools", saved: "Saved" };

/** The sections, read from the menu's Psychiatry group so the hub and the menu never list different ones. */
const SECTION_MODE_IDS: readonly AppModeId[] = (
  phoneModeGroups.find((group) => group.id === "psychiatry")?.modeIds ?? []
).filter((modeId) => modeId !== "psychiatry");

const KIND_MODE: Readonly<Record<PsychiatryVisitKind, AppModeId>> = {
  dsm: "dsm",
  differentials: "differentials",
  specifiers: "specifiers",
  formulation: "formulation",
  therapy: "therapy-compass",
  forms: "forms",
};

const QUICK_ACTIONS: readonly DashQuickAction[] = [
  { label: "Specifier builder", href: "/specifiers/builder", icon: Tags, testId: "psychiatry-qa-specifier-builder" },
  { label: "Formulation builder", href: "/formulation/builder", icon: Network, testId: "psychiatry-qa-formulation" },
  { label: "Recommend a therapy", href: "/therapy-compass/recommend", icon: Compass, testId: "psychiatry-qa-therapy" },
  {
    label: "Start from a presentation",
    href: "/differentials/presentations",
    icon: appModeIcons.differentials,
    testId: "psychiatry-qa-presentation",
  },
  { label: "Compare diagnoses", href: "/dsm/compare", icon: GitCompareArrows, testId: "psychiatry-qa-compare" },
  { label: "MHA forms", href: "/forms/search", icon: FileText, testId: "psychiatry-qa-forms" },
  { label: "Medication", href: appModeHomeHref("prescribing"), icon: Pill, testId: "psychiatry-qa-medication" },
  { label: "Calculators", href: appModeHomeHref("calculators"), icon: Calculator, testId: "psychiatry-qa-calculators" },
];

const TOOL_LINKS: ReadonlyArray<{ readonly label: string; readonly href: string; readonly mode: AppModeId }> = [
  { label: "Specifier wording builder", href: "/specifiers/builder", mode: "specifiers" },
  { label: "Compare specifiers", href: "/specifiers/compare", mode: "specifiers" },
  { label: "Formulation builder", href: "/formulation/builder", mode: "formulation" },
  { label: "Mechanism map", href: "/formulation/map", mode: "formulation" },
  { label: "Problem pathways", href: "/therapy-compass/pathways", mode: "therapy-compass" },
  { label: "Compare therapies", href: "/therapy-compass/compare", mode: "therapy-compass" },
  { label: "Compare diagnoses", href: "/dsm/compare", mode: "dsm" },
  { label: "The Act and Standards", href: "/forms/act", mode: "forms" },
];

const PsychiatrySavedCard = dynamic(
  () => import("@/components/psychiatry/psychiatry-saved-card").then((module) => module.PsychiatrySavedCard),
  { ssr: false, loading: () => <p className={dashMuted}>Loading your saved items…</p> },
);

const LONG_DATE = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Australia/Perth",
});

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-AU")} ${count === 1 ? one : many}`;
}

function sectionCountLine(modeId: AppModeId, counts: PsychiatrySectionCounts): string | null {
  switch (modeId) {
    case "dsm":
      return plural(counts.dsm, "diagnosis", "diagnoses");
    case "differentials":
      return `${plural(counts.differentials, "diagnosis", "diagnoses")} · ${plural(counts.presentations, "presentation", "presentations")}`;
    case "specifiers":
      return plural(counts.specifiers, "specifier", "specifiers");
    case "formulation":
      return plural(counts.formulation, "mechanism", "mechanisms");
    case "therapy-compass":
      return plural(counts.therapy, "therapy", "therapies");
    case "forms":
      return plural(counts.forms, "form", "forms");
    default:
      return null;
  }
}

function usePsychiatryVisits() {
  return useSyncExternalStore(
    subscribePsychiatryVisits,
    () => loadPsychiatryVisitState(),
    () => EMPTY_PSYCHIATRY_VISIT_STATE,
  );
}

const MINUTE_MS = 60_000;

function subscribeMinute(listener: () => void): () => void {
  const timer = window.setInterval(listener, MINUTE_MS);
  return () => window.clearInterval(timer);
}

/**
 * The reader's clock to the minute, read only in the browser (the server and
 * the hydrating render both see null), so the date line never mismatches.
 */
function useNow(nowProp?: Date): Date | null {
  const minute = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => null,
  );
  if (nowProp) return nowProp;
  return minute === null ? null : new Date(minute);
}

function subscribeNothing(): () => void {
  return () => undefined;
}

/** Whether "Save recent searches" is off, read in the browser only. */
function useRecordingOff(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => !readAppPreferences().saveRecentSearches,
    () => false,
  );
}

function PsychiatryTabs({
  page,
  onChange,
}: {
  readonly page: PsychiatryPageId;
  readonly onChange: (page: PsychiatryPageId) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (delta: number) => {
    const index = PAGE_IDS.indexOf(page);
    const next = PAGE_IDS[(index + delta + PAGE_IDS.length) % PAGE_IDS.length] ?? "ask";
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Psychiatry pages"
      data-testid="psychiatry-tabs"
      className="flex gap-1 rounded-full border border-[color:var(--dash-line)] bg-[color:var(--dash-card)] p-1 sm:max-w-md forced-colors:border"
    >
      {PAGE_IDS.map((id) => {
        const selected = id === page;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={`psychiatry-tab-${id}`}
            aria-selected={selected}
            aria-controls="psychiatry-panel"
            tabIndex={selected ? 0 : -1}
            data-testid={`psychiatry-tab-${id}`}
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
            className={cn(
              focusRing,
              "min-h-12 flex-1 rounded-full text-sm font-dash-title",
              selected
                ? "bg-[color:var(--dash-raised)] text-[color:var(--dash-ink)] shadow-[var(--dash-shadow)] forced-colors:border"
                : "text-[color:var(--dash-muted)]",
            )}
          >
            {PAGE_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Ask page

function AskHero({
  visits,
  thisMonth,
  lastMonth,
  now,
}: {
  readonly visits: readonly PsychiatryVisit[];
  readonly thisMonth: number;
  readonly lastMonth: number;
  readonly now: Date | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(appModeHomeHref("answer", { query: trimmed, run: true }));
  };
  const latest = visits[0] ?? null;
  const showRing = thisMonth > 0 || lastMonth > 0;
  const ringFraction = lastMonth > 0 ? thisMonth / lastMonth : 1;
  return (
    <DashCard title="Ask PsychSift" showTitle={false} tone="hero" testId="psychiatry-card-ask">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center lg:gap-8">
        <form role="search" aria-label="Ask a psychiatry question" onSubmit={submit} className="grid min-w-0 gap-3">
          <div className="grid gap-0.5">
            <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">Ask PsychSift</span>
            <p className="font-dash-figure text-2xl-minus leading-tight tracking-tight text-balance lg:text-3xl-minus">
              What do you need to check?
            </p>
          </div>
          <label
            htmlFor="psychiatry-ask-input"
            className="flex min-h-14 items-center gap-2 rounded-2xl bg-[color:var(--dash-raised)] py-1.5 pr-1.5 pl-3.5 text-[color:var(--dash-ink)] shadow-[var(--dash-shadow)] forced-colors:border"
          >
            <Search aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--dash-muted)]" />
            <span className="sr-only">Your question</span>
            <input
              id="psychiatry-ask-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your guidelines"
              autoComplete="off"
              data-testid="psychiatry-ask-input"
              className="min-h-12 min-w-0 flex-1 bg-transparent text-base text-[color:var(--dash-ink)] outline-none placeholder:text-[color:var(--dash-muted)]"
            />
            <button
              type="submit"
              data-testid="psychiatry-ask-submit"
              className={cn(
                focusRing,
                "min-h-12 shrink-0 rounded-xl bg-[color:var(--dash-hero-3)] px-4 text-sm font-dash-title text-[color:var(--dash-hero-ink)] forced-colors:border",
              )}
            >
              Ask
            </button>
          </label>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0" data-testid="psychiatry-ask-try">
            <span className="text-xs opacity-85">Try</span>
            {sharedHomePresentation.psychiatry.suggestions.map((suggestion) => (
              <Link
                key={suggestion}
                href={appModeHomeHref("answer", { query: suggestion, run: true })}
                className={cn(focusRing, "inline-flex min-h-12 items-center rounded-full no-underline")}
              >
                <span className="rounded-full border border-[color:var(--dash-hero-glass-line)] bg-[color:var(--dash-hero-glass)] px-3 py-1.5 text-xs font-dash-title text-[color:var(--dash-hero-ink)] forced-colors:border">
                  {suggestion}
                </span>
              </Link>
            ))}
          </div>
        </form>

        {showRing || latest ? (
          <div className="grid min-w-0 gap-3">
            {showRing ? (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5" data-testid="psychiatry-month">
                <p className="sr-only">
                  {`${plural(thisMonth, "record", "records")} opened in Psychiatry this month on this device${lastMonth > 0 ? `, against ${lastMonth} last month` : ""}.`}
                </p>
                <ProgressRing
                  fraction={ringFraction}
                  size={92}
                  strokeWidth={7}
                  stroke="stroke-[color:var(--dash-hero-ink)]"
                  track="stroke-[color:var(--dash-hero-track)]"
                  testId="psychiatry-month-ring"
                >
                  <span className={cn(dashFigure, "block text-2xl-minus")}>{thisMonth}</span>
                  <span className="mt-0.5 block text-3xs font-dash-title opacity-85">opened</span>
                </ProgressRing>
                <span aria-hidden="true" className="grid min-w-0 gap-0.5">
                  <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">This month</span>
                  <span className="break-words font-dash-figure text-lg leading-tight">
                    {`${plural(thisMonth, "record", "records")} opened`}
                  </span>
                  <span className="break-words text-sm opacity-90">
                    {lastMonth > 0 ? `Last month: ${lastMonth}` : "On this device"}
                  </span>
                </span>
              </div>
            ) : null}
            {latest ? (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-[color:var(--dash-hero-glass-line)] bg-[color:var(--dash-hero-glass)] px-3 py-2.5"
                data-testid="psychiatry-resume"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">
                    Pick up where you left off
                  </span>
                  <span className="break-words font-dash-figure text-base-minus leading-snug">{latest.title}</span>
                  <span className="text-xs opacity-90">
                    {[
                      PSYCHIATRY_VISIT_KIND_LABEL[latest.kind],
                      now ? formatPsychiatryVisitWhen(latest.at, now.getTime()) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Link
                  href={latest.href}
                  aria-label={`Open ${latest.title}`}
                  data-testid="psychiatry-resume-open"
                  className={cn(focusRing, "inline-flex min-h-12 items-center rounded-full no-underline")}
                >
                  <span className="rounded-full bg-[color:var(--dash-hero-ink)] px-4 py-1.5 text-sm font-dash-title text-[color:var(--dash-hero-button-ink)] forced-colors:border">
                    Open
                  </span>
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </DashCard>
  );
}

/**
 * The quick actions as a grid (two across on a phone, four on a wide screen),
 * as in the approved mock-up, rather than My Day's swipeable row: eight tools
 * read at a glance, and a wrapped label is never cut off.
 */
function QuickActionGrid({ actions }: { readonly actions: readonly DashQuickAction[] }) {
  return (
    <ul
      role="list"
      aria-label="Quick actions"
      data-testid="psychiatry-quick-actions"
      className="grid grid-cols-2 gap-2 lg:grid-cols-4"
    >
      {actions.map(({ label, href, icon: ActionIcon, testId }) => (
        <li key={label} className="min-w-0">
          <Link
            href={href}
            data-testid={testId}
            className={cn(
              focusRing,
              "flex min-h-14 items-center gap-2.5 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] py-2 pr-3 pl-2 font-dash-title text-sm leading-tight text-[color:var(--dash-ink)] no-underline forced-colors:border",
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--dash-blue-tint)] text-[color:var(--dash-blue)] forced-colors:border"
            >
              <ActionIcon aria-hidden="true" className="size-icon-lg" />
            </span>
            <span className="min-w-0 break-words">{label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SectionChip({ mode }: { readonly mode: AppModeId }) {
  const ModeIcon = appModeIcons[mode];
  return (
    <IconChip tint="blue" size="sm">
      <ModeIcon aria-hidden="true" className="size-icon-sm" />
    </IconChip>
  );
}

function LinkRow({
  href,
  chip,
  title,
  subtitle,
  testId,
}: {
  readonly href: string;
  readonly chip: ReactNode;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly testId?: string;
}) {
  return (
    <li className="border-t border-[color:var(--dash-line)] first:border-t-0">
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          focusRing,
          "grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl px-3 py-2 text-[color:var(--dash-ink)] no-underline",
        )}
      >
        {chip}
        <span className="grid min-w-0 gap-0.5">
          <span className="break-words font-dash-title text-base-minus leading-tight">{title}</span>
          {subtitle ? <span className={cn(dashMuted, "break-words")}>{subtitle}</span> : null}
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-sm text-[color:var(--dash-faint)]" />
      </Link>
    </li>
  );
}

function LinkList({
  label,
  children,
  testId,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      data-testid={testId}
      className="grid min-w-0 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] forced-colors:border"
    >
      {children}
    </ul>
  );
}

function ContinueCard({ visits, now }: { readonly visits: readonly PsychiatryVisit[]; readonly now: Date | null }) {
  const recordingOff = useRecordingOff();
  const shown = visits.slice(0, 4);
  return (
    <DashCard
      title="Continue"
      testId="psychiatry-card-continue"
      aside={
        shown.length > 0 ? (
          <>
            <DashTag tint="blue">On this device</DashTag>
            <button
              type="button"
              onClick={clearPsychiatryVisits}
              data-testid="psychiatry-continue-clear"
              className={cn(focusRing, dashLink, "inline-flex min-h-12 items-center rounded-full px-2")}
            >
              Clear
            </button>
          </>
        ) : null
      }
    >
      {shown.length > 0 ? (
        <LinkList label="Recently opened" testId="psychiatry-continue-list">
          {shown.map((visit) => (
            <LinkRow
              key={visit.href}
              href={visit.href}
              chip={<SectionChip mode={KIND_MODE[visit.kind]} />}
              title={visit.title}
              subtitle={[
                PSYCHIATRY_VISIT_KIND_LABEL[visit.kind],
                now ? formatPsychiatryVisitWhen(visit.at, now.getTime()) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </LinkList>
      ) : (
        <p className={dashMuted} data-testid="psychiatry-continue-empty">
          {recordingOff
            ? "Turn on Save recent searches in Settings to see what you opened here. It stays on this device."
            : "Diagnoses, therapies and forms you open will appear here, on this device only."}
        </p>
      )}
    </DashCard>
  );
}

function MentalHealthActCard({
  visits,
  counts,
}: {
  readonly visits: readonly PsychiatryVisit[];
  readonly counts: Readonly<Record<string, number>>;
}) {
  const forms = mostOpenedForms(visits, counts);
  const chip = (href: string, label: string, testId?: string) => (
    <Link
      key={href}
      href={href}
      data-testid={testId}
      className={cn(focusRing, "inline-flex min-h-12 max-w-full items-center rounded-full no-underline")}
    >
      <span className="truncate rounded-full border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 py-1.5 text-xs font-dash-title text-[color:var(--dash-ink)] forced-colors:border">
        {label}
      </span>
    </Link>
  );
  return (
    <DashCard
      title="Mental Health Act"
      testId="psychiatry-card-mha"
      aside={
        <Link
          href="/forms/search"
          className={cn(focusRing, dashLink, "inline-flex min-h-12 items-center rounded-full px-2")}
        >
          All forms
        </Link>
      }
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <span
          aria-hidden="true"
          className="grid w-13 overflow-hidden rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] text-center forced-colors:border"
        >
          <span className="bg-[color:var(--dash-blue)] py-0.5 text-3xs font-dash-figure tracking-widest text-[color:var(--dash-hero-ink)]">
            WA
          </span>
          <span className="py-1 font-dash-figure text-lg leading-none text-[color:var(--dash-ink)]">2014</span>
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="font-dash-title text-base-minus leading-tight text-[color:var(--dash-ink)]">
            {forms.length > 0 ? "Your most-opened forms" : "Forms and the Act"}
          </span>
          <span className={dashMuted}>
            {forms.length > 0
              ? "From this device. Each opens the form and its guidance."
              : "The Mental Health Act 2014 (WA) forms register, and plain-English summaries of the Act."}
          </span>
        </span>
      </div>
      <div className="-my-1 flex flex-wrap gap-x-1.5" data-testid="psychiatry-mha-links">
        {forms.map((form) => chip(form.href, form.title))}
        {forms.length === 0 ? chip("/forms/search", "Search the forms", "psychiatry-mha-search") : null}
        {chip("/forms/act", "The Act and Standards", "psychiatry-mha-act")}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------- Tools page

function SectionsCard({ counts }: { readonly counts: PsychiatrySectionCounts }) {
  return (
    <DashCard title="Sections" testId="psychiatry-card-sections">
      <ul role="list" aria-label="Psychiatry sections" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SECTION_MODE_IDS.map((modeId) => {
          const mode = appModeDefinition(modeId);
          const countLine = sectionCountLine(modeId, counts);
          return (
            <li key={modeId} className="min-w-0">
              <Link
                href={appModeHomeHref(modeId)}
                data-testid={`psychiatry-section-${modeId}`}
                className={cn(
                  focusRing,
                  "grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] px-3 py-2.5 text-[color:var(--dash-ink)] no-underline forced-colors:border",
                )}
              >
                <IconChip tint="blue" size="md">
                  {(() => {
                    const ModeIcon = appModeIcons[modeId];
                    return <ModeIcon aria-hidden="true" className="size-icon-md" />;
                  })()}
                </IconChip>
                <span className="grid min-w-0 gap-0.5">
                  <span className="break-words font-dash-title text-base-minus leading-tight">{mode.label}</span>
                  <span className={cn(dashMuted, "nums break-words")}>{countLine ?? mode.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}

const TOOL_ICON: Readonly<Record<string, LucideIcon>> = {
  "/specifiers/builder": Tags,
  "/specifiers/compare": GitCompareArrows,
  "/formulation/builder": Network,
  "/formulation/map": MapIcon,
  "/therapy-compass/pathways": Workflow,
  "/therapy-compass/compare": GitCompareArrows,
  "/dsm/compare": GitCompareArrows,
  "/forms/act": FileText,
};

function BuildersCard() {
  return (
    <DashCard title="Builders and comparisons" testId="psychiatry-card-builders">
      <LinkList label="Builders and comparisons">
        {TOOL_LINKS.map((tool) => {
          const ToolIcon = TOOL_ICON[tool.href] ?? appModeIcons[tool.mode];
          return (
            <LinkRow
              key={tool.href}
              href={tool.href}
              chip={
                <IconChip tint="blue-2" size="sm">
                  <ToolIcon aria-hidden="true" className="size-icon-sm" />
                </IconChip>
              }
              title={tool.label}
              subtitle={appModeDefinition(tool.mode).label}
            />
          );
        })}
      </LinkList>
    </DashCard>
  );
}

function WeekCard({
  week,
}: {
  readonly week: ReadonlyArray<{ readonly kind: PsychiatryVisitKind; readonly count: number }>;
}) {
  if (week.length === 0) return null;
  const max = Math.max(...week.map((row) => row.count));
  return (
    <DashCard title="Your week" testId="psychiatry-card-week" aside={<DashTag tint="blue">On this device</DashTag>}>
      <p className="sr-only">
        {`Opened in the last seven days: ${week.map((row) => `${PSYCHIATRY_VISIT_KIND_LABEL[row.kind]} ${row.count}`).join(", ")}.`}
      </p>
      <div aria-hidden="true" className="grid gap-2">
        {week.map((row) => (
          <div key={row.kind} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
            <span className="truncate text-[color:var(--dash-muted)]">{PSYCHIATRY_VISIT_KIND_LABEL[row.kind]}</span>
            <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full">
              <rect x="0" y="0" width="100" height="8" rx="4" className="fill-[color:var(--dash-line)]" />
              <rect
                x="0"
                y="0"
                width={Math.max(4, (row.count / max) * 100)}
                height="8"
                rx="4"
                className="fill-[color:var(--dash-blue)] forced-colors:fill-[CanvasText]"
              />
            </svg>
            <span className="nums text-right font-dash-title text-[color:var(--dash-ink)]">{row.count}</span>
          </div>
        ))}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------- the page

export function PsychiatryHome({
  counts,
  now: nowProp,
  initialPage = "ask",
}: {
  readonly counts: PsychiatrySectionCounts;
  readonly now?: Date;
  readonly initialPage?: PsychiatryPageId;
}) {
  const [page, setPage] = useState<PsychiatryPageId>(initialPage);
  const now = useNow(nowProp);
  const state = usePsychiatryVisits();
  const nowMs = now?.getTime() ?? null;
  const month = nowMs === null ? { thisMonth: 0, lastMonth: 0 } : psychiatryMonthFigures(state.opens, nowMs);
  const week = nowMs === null ? [] : psychiatryWeekBySection(state.opens, nowMs);

  return (
    <InformationPageShell testId="psychiatry-home">
      <div className={cn("mx-auto grid w-full max-w-5xl gap-5 sm:gap-6", dashSurface)}>
        <header className="grid min-w-0 gap-0.5" data-testid="psychiatry-header">
          <p className="min-h-5 text-sm text-[color:var(--dash-muted)]">{now ? LONG_DATE.format(now) : null}</p>
          <h1 className="font-dash-figure text-3xl-minus leading-tight tracking-tight text-[color:var(--dash-ink)]">
            Psychiatry
          </h1>
        </header>

        <PsychiatryTabs page={page} onChange={setPage} />

        <div
          id="psychiatry-panel"
          role="tabpanel"
          aria-labelledby={`psychiatry-tab-${page}`}
          className="grid gap-3 sm:gap-4"
        >
          {page === "ask" ? (
            <>
              <AskHero visits={state.visits} thisMonth={month.thisMonth} lastMonth={month.lastMonth} now={now} />
              <DashCard title="Quick actions" testId="psychiatry-card-quick-actions">
                <QuickActionGrid actions={QUICK_ACTIONS} />
              </DashCard>
              <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                <ContinueCard visits={state.visits} now={now} />
                <MentalHealthActCard visits={state.visits} counts={state.counts} />
              </div>
            </>
          ) : null}
          {page === "tools" ? (
            <>
              <SectionsCard counts={counts} />
              <div className="grid items-start gap-3 sm:gap-4 lg:grid-cols-2">
                <BuildersCard />
                <WeekCard week={week} />
              </div>
            </>
          ) : null}
          {page === "saved" ? <PsychiatrySavedCard /> : null}
        </div>
      </div>
    </InformationPageShell>
  );
}
