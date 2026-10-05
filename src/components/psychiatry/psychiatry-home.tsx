"use client";

import {
  BookOpen,
  ChevronRight,
  Compass,
  FileText,
  GitCompareArrows,
  LifeBuoy,
  Map as MapIcon,
  Network,
  Pill,
  Search,
  ShieldCheck,
  Tags,
  Timer,
  WifiOff,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import type { DashQuickAction } from "@/components/dashboard-kit/quick-actions";
import { dashMuted, dashSurface } from "@/components/dashboard-kit/recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import {
  FlatCount,
  flatLink,
  FlatLabel,
  FlatList,
  flatPanel,
  flatPanelPadded,
  FlatRow,
  FlatTag,
} from "@/components/psychiatry/psychiatry-flat";
import { readAppPreferences, subscribeAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { cn } from "@/components/ui-primitives";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { MHA_CLOCK_UNREADABLE, useMhaClockState, type MhaClock } from "@/lib/psychiatry-hub/mha-clocks";
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
  type PsychiatryOpen,
  type PsychiatryVisit,
  type PsychiatryVisitKind,
} from "@/lib/psychiatry-hub/visits";
import { sharedHomePresentation } from "@/lib/ui-copy";

/**
 * The Psychiatry hub, in three pages: Ask, Tools and Saved, drawn to the approved mock-up v3
 * (5 October 2026) in the calmer Work search style: flat hairline lists, grey icons and at most
 * one filled button per screen.
 *
 * It is a front door, not clinical content: every row is a way into a section that keeps its own
 * address and search. Green, amber and red are not used for decoration here.
 *
 * The figures are real or absent. Section counts come from the catalogues (read on the server);
 * "Continue", "Your week" and the forms list read this device's own history
 * (`src/lib/psychiatry-hub/visits.ts`), and a section with nothing to show says so in one line.
 * Offline, search is switched off and says so, rather than failing after a tap.
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
  { label: "Safety plan", href: "/safety-plan", icon: LifeBuoy, testId: "psychiatry-qa-safety-plan" },
  {
    label: "First Nations",
    href: appModeHomeHref("first-nations"),
    icon: appModeIcons["first-nations"],
    testId: "psychiatry-qa-first-nations",
  },
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

/** Whether "Save recent searches" is off, read in the browser only and kept live. */
function useRecordingOff(): boolean {
  return useSyncExternalStore(
    subscribeAppPreferences,
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

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** True only when the browser says it has no connection; the server and hydration assume online. */
function useOffline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !navigator.onLine,
    () => false,
  );
}

function AskSearch({ offline }: { readonly offline: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || offline) return;
    router.push(appModeHomeHref("answer", { query: trimmed, run: true }));
  };
  return (
    <form
      role="search"
      aria-label="Ask a psychiatry question"
      onSubmit={submit}
      className="grid min-w-0 gap-2"
      data-testid="psychiatry-card-ask"
    >
      {offline ? (
        <p
          className="flex items-start gap-2.5 rounded-lg bg-[color:var(--dash-card)] px-3 py-2.5 text-sm text-[color:var(--dash-muted)] forced-colors:border"
          data-testid="psychiatry-offline"
        >
          <WifiOff aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
          <span>
            <b className="font-semibold text-[color:var(--dash-ink)]">Offline.</b> Search needs a connection. Other
            pages may not open until you reconnect.
          </span>
        </p>
      ) : null}
      <div
        className={cn(
          "flex min-h-12 items-center gap-2 rounded-lg border pl-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus)] forced-colors:border",
          offline
            ? "border-dashed border-[color:var(--dash-line-strong)] bg-[color:var(--dash-card)]"
            : "border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)]",
        )}
      >
        <Search aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--dash-ink)]" />
        <label htmlFor="psychiatry-ask-input" className="sr-only">
          Your question
        </label>
        <input
          id="psychiatry-ask-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={offline ? "Search is offline" : "Search your guidelines"}
          disabled={offline}
          autoComplete="off"
          enterKeyHint="search"
          data-testid="psychiatry-ask-input"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm text-[color:var(--dash-ink)] outline-none focus-visible:outline-none focus-visible:shadow-none placeholder:text-[color:var(--dash-muted)] disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={offline}
          data-testid="psychiatry-ask-submit"
          className={cn(
            focusRing,
            "min-h-12 shrink-0 rounded-lg px-3 text-sm font-semibold text-[color:var(--dash-ink)] disabled:text-[color:var(--dash-muted)]",
          )}
        >
          Ask
        </button>
      </div>
      {offline ? null : (
        <div className="flex flex-wrap items-center gap-x-3.5 text-sm" data-testid="psychiatry-ask-try">
          <span className="text-[color:var(--dash-muted)]">Try</span>
          {sharedHomePresentation.psychiatry.suggestions.map((suggestion) => (
            <Link
              key={suggestion}
              href={appModeHomeHref("answer", { query: suggestion, run: true })}
              className={cn(
                focusRing,
                "inline-flex min-h-12 items-center rounded-md font-medium text-[color:var(--dash-ink)] underline decoration-[color:var(--dash-line-strong)] underline-offset-4",
              )}
            >
              {suggestion}
            </Link>
          ))}
        </div>
      )}
    </form>
  );
}

function visitIcon(kind: PsychiatryVisitKind): LucideIcon {
  return appModeIcons[KIND_MODE[kind]];
}

function ResumeRow({ latest, now }: { readonly latest: PsychiatryVisit; readonly now: Date | null }) {
  return (
    <FlatList label="Pick up where you left off" testId="psychiatry-resume">
      <FlatRow
        href={latest.href}
        icon={visitIcon(latest.kind)}
        title={latest.title}
        ariaLabel={`Open ${latest.title}`}
        testId="psychiatry-resume-open"
        subtitle={["Pick up where you left off", now ? formatPsychiatryVisitWhen(latest.at, now.getTime()) : null]
          .filter(Boolean)
          .join(" · ")}
        end={<span className="text-sm font-semibold text-[color:var(--dash-ink)]">Open</span>}
      />
    </FlatList>
  );
}

/** The quick actions as a two-across hairline grid. */
function QuickActionGrid({ actions }: { readonly actions: readonly DashQuickAction[] }) {
  return (
    <ul
      role="list"
      aria-label="Quick actions"
      data-testid="psychiatry-quick-actions"
      className={cn(flatPanel, "grid grid-cols-2")}
    >
      {actions.map(({ label, href, icon: ActionIcon, testId }, index) => (
        <li
          key={label}
          className={cn(
            "min-w-0 border-[color:var(--dash-line)]",
            index >= 2 && "border-t",
            index % 2 === 0 && "border-r",
          )}
        >
          <Link
            href={href}
            data-testid={testId}
            className={cn(
              focusRing,
              "focus-ring-contained flex h-full min-h-13 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium leading-tight text-[color:var(--dash-ink)] no-underline",
            )}
          >
            <ActionIcon aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
            <span className="min-w-0 break-words">{label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A signpost to a section that lives elsewhere: a line of text and a bold link. */
function Signpost({
  href,
  icon: SignIcon,
  text,
  link,
  testId,
}: {
  readonly href: string;
  readonly icon: LucideIcon;
  readonly text: string;
  readonly link: string;
  readonly testId?: string;
}) {
  return (
    <p className="flex min-h-10 items-center gap-2.5 px-0.5 text-sm text-[color:var(--dash-muted)]">
      <SignIcon aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href={href} data-testid={testId} className={cn(flatLink, "shrink-0")}>
        {link}
        <ChevronRight aria-hidden="true" className="size-icon-xs" />
      </Link>
    </p>
  );
}

/** "2 running on this phone · Forms 2 and 3A". Exported for tests. */
export function clockSummary(clocks: readonly MhaClock[]): string {
  if (clocks.length === 0) return "No clocks running";
  const codes = [...new Set(clocks.map((clock) => clock.formCode))];
  const list = codes.length === 1 ? codes[0] : `${codes.slice(0, -1).join(", ")} and ${codes.at(-1)}`;
  return `${clocks.length} running on this phone · ${codes.length === 1 ? "Form" : "Forms"} ${list}`;
}

/**
 * "For a shift": the tools used during an after-hours shift. Only tools that exist are here; the
 * MHA clock row shows a count and form codes from this device, never anything about a person.
 */
function ShiftToolsList({ clockLine }: { readonly clockLine: (clocks: readonly MhaClock[]) => string }) {
  const { clocks, unreadable } = useMhaClockState();
  return (
    <FlatList label="For a shift" testId="psychiatry-card-shift">
      <FlatRow
        renderLink={(className, body) => (
          <Link href="/psychiatry/mha-clock" className={className} data-testid="psychiatry-shift-mha-clock">
            {body}
          </Link>
        )}
        icon={Timer}
        title="MHA clock"
        subtitle={
          <span data-testid="psychiatry-shift-mha-summary">
            {unreadable ? MHA_CLOCK_UNREADABLE : clockLine(clocks)}
          </span>
        }
      />
      <FlatRow
        href="/safety-plan"
        icon={LifeBuoy}
        title="Safety plan"
        subtitle="Build one together"
        testId="psychiatry-shift-safety-plan"
      />
    </FlatList>
  );
}

function ContinueSection({ visits, now }: { readonly visits: readonly PsychiatryVisit[]; readonly now: Date | null }) {
  const recordingOff = useRecordingOff();
  // The newest record is already the "Pick up where you left off" row above, so it is not repeated.
  const shown = visits.slice(1, 4);
  return (
    <section aria-labelledby="psychiatry-continue-title" className="grid gap-2" data-testid="psychiatry-card-continue">
      <FlatLabel
        id="psychiatry-continue-title"
        title="Continue"
        aside={
          visits.length > 0 ? (
            <>
              <FlatTag>On this phone</FlatTag>
              <button
                type="button"
                onClick={clearPsychiatryVisits}
                data-testid="psychiatry-continue-clear"
                className={flatLink}
              >
                Clear
              </button>
            </>
          ) : null
        }
      />
      {shown.length > 0 ? (
        <FlatList label="Recently opened" testId="psychiatry-continue-list">
          {shown.map((visit) => (
            <FlatRow
              key={visit.href}
              href={visit.href}
              icon={visitIcon(visit.kind)}
              title={visit.title}
              subtitle={[
                PSYCHIATRY_VISIT_KIND_LABEL[visit.kind],
                now ? formatPsychiatryVisitWhen(visit.at, now.getTime()) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </FlatList>
      ) : (
        <p className="text-sm text-[color:var(--dash-muted)]" data-testid="psychiatry-continue-empty">
          {visits.length > 0
            ? "Nothing else opened yet."
            : recordingOff
              ? "Turn on Save recent searches in Settings to see what you opened here. It stays on this device."
              : "Diagnoses, therapies and forms you open will appear here, on this device only."}
        </p>
      )}
    </section>
  );
}

function MentalHealthActSection({
  visits,
  opens,
}: {
  readonly visits: readonly PsychiatryVisit[];
  readonly opens: readonly PsychiatryOpen[];
}) {
  const forms = mostOpenedForms(visits, opens, 3);
  const opened = (href: string) => {
    // Opens are kept for 90 days; a form known only from a visit is not given a made-up count.
    const count = opens.filter((open) => open.href === href).length;
    if (count === 0) return "Opened recently on this phone";
    return `Opened ${count === 1 ? "once" : `${count} times`} on this phone`;
  };
  return (
    <section aria-labelledby="psychiatry-mha-title" className="grid gap-2" data-testid="psychiatry-card-mha">
      <FlatLabel
        id="psychiatry-mha-title"
        title="Mental Health Act"
        aside={
          <Link href="/forms/search" className={flatLink}>
            All forms
          </Link>
        }
      />
      <FlatList label="Mental Health Act" testId="psychiatry-mha-links">
        {forms.map((form) => (
          <FlatRow
            key={form.href}
            href={form.href}
            icon={ShieldCheck}
            title={form.title}
            subtitle={opened(form.href)}
          />
        ))}
        {forms.length === 0 ? (
          <FlatRow
            href="/forms/search"
            icon={ShieldCheck}
            title="Search the forms"
            subtitle="The Mental Health Act 2014 (WA) forms register"
            testId="psychiatry-mha-search"
          />
        ) : null}
        <FlatRow
          href="/forms/act"
          icon={BookOpen}
          title="The Act and Standards"
          subtitle="Mental Health Act 2014 (WA)"
          testId="psychiatry-mha-act"
        />
      </FlatList>
    </section>
  );
}

function AskPage({
  visits,
  opens,
  now,
}: {
  readonly visits: readonly PsychiatryVisit[];
  readonly opens: readonly PsychiatryOpen[];
  readonly now: Date | null;
}) {
  const offline = useOffline();
  const latest = visits[0] ?? null;
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-x-8">
      <div className="grid min-w-0 gap-3">
        <AskSearch offline={offline} />
        {latest ? <ResumeRow latest={latest} now={now} /> : null}
        <section aria-labelledby="psychiatry-shift-title" className="grid gap-2">
          <FlatLabel id="psychiatry-shift-title" title="For a shift" />
          <ShiftToolsList clockLine={clockSummary} />
        </section>
      </div>
      <div className="grid min-w-0 gap-3">
        <section
          aria-labelledby="psychiatry-qa-title"
          className="grid gap-2 lg:order-last"
          data-testid="psychiatry-card-quick-actions"
        >
          <FlatLabel id="psychiatry-qa-title" title="Quick actions" />
          <QuickActionGrid actions={QUICK_ACTIONS} />
        </section>
        <Signpost
          href={appModeHomeHref("medicines")}
          icon={Pill}
          text="Medication and calculators are in Medicines"
          link="Medicines"
          testId="psychiatry-medicines-signpost"
        />
        <ContinueSection visits={visits} now={now} />
        <MentalHealthActSection visits={visits} opens={opens} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tools page

function SectionsSection({ counts }: { readonly counts: PsychiatrySectionCounts }) {
  return (
    <section aria-labelledby="psychiatry-sections-title" className="grid gap-2" data-testid="psychiatry-card-sections">
      <FlatLabel
        id="psychiatry-sections-title"
        title="Sections"
        aside={<FlatCount>{SECTION_MODE_IDS.length}</FlatCount>}
      />
      <ul role="list" aria-label="Psychiatry sections" className={cn(flatPanel, "grid grid-cols-2")}>
        {SECTION_MODE_IDS.map((modeId, index) => {
          const mode = appModeDefinition(modeId);
          const ModeIcon = appModeIcons[modeId];
          const last = index === SECTION_MODE_IDS.length - 1;
          return (
            <li
              key={modeId}
              className={cn(
                "min-w-0 border-[color:var(--dash-line)]",
                index >= 2 && "border-t",
                index % 2 === 0 && !last && "border-r",
                last && SECTION_MODE_IDS.length % 2 === 1 && "col-span-2",
              )}
            >
              <Link
                href={appModeHomeHref(modeId)}
                data-testid={`psychiatry-section-${modeId}`}
                className={cn(
                  focusRing,
                  "focus-ring-contained flex h-full min-h-13 items-center gap-2.5 rounded-xl px-3 py-2 text-[color:var(--dash-ink)] no-underline",
                )}
              >
                <ModeIcon aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
                <span className="grid min-w-0">
                  <span className="break-words text-sm font-medium leading-tight">{mode.label}</span>
                  <span className="nums break-words text-xs text-[color:var(--dash-muted)]">
                    {sectionCountLine(modeId, counts) ?? mode.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
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

function toolsClockLine(clocks: readonly MhaClock[]): string {
  // Neutral while countdowns are switched off: the page holds forms, it does not always count limits.
  const holding = "Mental Health Act forms you are holding";
  return clocks.length > 0 ? `${holding} · ${clocks.length} running` : holding;
}

function BuildersSection() {
  return (
    <section aria-labelledby="psychiatry-builders-title" className="grid gap-2" data-testid="psychiatry-card-builders">
      <FlatLabel
        id="psychiatry-builders-title"
        title="Builders and comparisons"
        aside={<FlatCount>{TOOL_LINKS.length}</FlatCount>}
      />
      <FlatList label="Builders and comparisons">
        {TOOL_LINKS.map((tool) => (
          <FlatRow
            key={tool.href}
            href={tool.href}
            icon={TOOL_ICON[tool.href] ?? appModeIcons[tool.mode]}
            title={tool.label}
            subtitle={appModeDefinition(tool.mode).label}
          />
        ))}
      </FlatList>
    </section>
  );
}

function WeekSection({
  week,
  thisMonth,
}: {
  readonly week: ReadonlyArray<{ readonly kind: PsychiatryVisitKind; readonly count: number }>;
  readonly thisMonth: number;
}) {
  const recordingOff = useRecordingOff();
  const max = Math.max(1, ...week.map((row) => row.count));
  const total = week.reduce((sum, row) => sum + row.count, 0);
  const hasData = week.length > 0 || thisMonth > 0;
  return (
    <section aria-labelledby="psychiatry-week-title" className="grid gap-2" data-testid="psychiatry-card-week">
      <FlatLabel id="psychiatry-week-title" title="Your week" aside={<FlatTag>On this phone</FlatTag>} />
      <div className={flatPanelPadded}>
        {hasData ? (
          <>
            <p className="flex items-center gap-3" data-testid="psychiatry-month">
              <span className="nums text-xl font-semibold text-[color:var(--dash-ink)]">{thisMonth}</span>{" "}
              <span className="text-sm text-[color:var(--dash-ink)]">
                {thisMonth === 1 ? "record opened so far this month" : "records opened so far this month"}
              </span>
            </p>
            {week.length > 0 ? (
              <>
                <p className="mt-1 border-t border-[color:var(--dash-line)] pt-2.5 text-xs text-[color:var(--dash-muted)]">
                  Last 7 days by section{" "}
                  <span className="nums text-[color:var(--dash-muted)]">{`· ${total} in all`}</span>
                </p>
                <p className="sr-only">
                  {`Opened in the last seven days: ${week.map((row) => `${PSYCHIATRY_VISIT_KIND_LABEL[row.kind]} ${row.count}`).join(", ")}.`}
                </p>
                <div aria-hidden="true" className="grid gap-1.5">
                  {week.map((row) => (
                    <div
                      key={row.kind}
                      className="grid grid-cols-[5.25rem_minmax(0,1fr)_1.5rem] items-center gap-2 text-xs"
                    >
                      <span className="truncate text-[color:var(--dash-muted)]">
                        {PSYCHIATRY_VISIT_KIND_LABEL[row.kind]}
                      </span>
                      <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full">
                        <rect x="0" y="0" width="100" height="6" rx="3" className="fill-[color:var(--dash-card)]" />
                        <rect
                          x="0"
                          y="0"
                          width={Math.max(4, (row.count / max) * 100)}
                          height="6"
                          rx="3"
                          className="fill-[color:var(--dash-faint)] forced-colors:fill-[CanvasText]"
                        />
                      </svg>
                      <span className="nums text-right font-semibold text-[color:var(--dash-ink)]">{row.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : recordingOff ? null : (
          <p className="text-sm text-[color:var(--dash-ink)]" data-testid="psychiatry-week-empty">
            Nothing opened here yet.
          </p>
        )}
        <p className="text-xs text-[color:var(--dash-muted)]">
          {recordingOff && !hasData
            ? "Turn on Save recent searches in Settings to count what you open here. It stays on this phone."
            : "Counted on this phone while Save recent searches is on."}
        </p>
      </div>
    </section>
  );
}

function ToolsPage({
  counts,
  week,
  thisMonth,
}: {
  readonly counts: PsychiatrySectionCounts;
  readonly week: ReadonlyArray<{ readonly kind: PsychiatryVisitKind; readonly count: number }>;
  readonly thisMonth: number;
}) {
  return (
    <div className="grid gap-3">
      <SectionsSection counts={counts} />
      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-x-8">
        <div className="grid min-w-0 gap-3">
          <section
            aria-labelledby="psychiatry-tools-shift-title"
            className="grid gap-2"
            data-testid="psychiatry-card-shift-tools"
          >
            <FlatLabel id="psychiatry-tools-shift-title" title="For a shift" aside={<FlatCount>2</FlatCount>} />
            <ShiftToolsList clockLine={toolsClockLine} />
          </section>
          <BuildersSection />
        </div>
        <div className="grid min-w-0 gap-3">
          <WeekSection week={week} thisMonth={thisMonth} />
          <div className="grid">
            <Signpost
              href={appModeHomeHref("medicines")}
              icon={Pill}
              text="Medication and calculators"
              link="Medicines"
            />
            <Signpost href={appModeHomeHref("documents")} icon={FileText} text="Your PDFs" link="Documents" />
          </div>
        </div>
      </div>
    </div>
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
  const month = nowMs === null ? { thisMonth: 0, lastMonth: 0 } : psychiatryMonthFigures(state.months, nowMs);
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
          {page === "ask" ? <AskPage visits={state.visits} opens={state.opens} now={now} /> : null}
          {page === "tools" ? <ToolsPage counts={counts} week={week} thisMonth={month.thisMonth} /> : null}
          {page === "saved" ? <PsychiatrySavedCard /> : null}
        </div>
      </div>
    </InformationPageShell>
  );
}
