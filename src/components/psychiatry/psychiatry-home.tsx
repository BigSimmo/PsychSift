"use client";

import {
  BookOpen,
  Compass,
  GitCompareArrows,
  LifeBuoy,
  Map as MapIcon,
  Network,
  ShieldCheck,
  Tags,
  Timer,
  WifiOff,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";

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
  subscribePsychiatryVisits,
  type PsychiatryOpen,
  type PsychiatryVisit,
  type PsychiatryVisitKind,
} from "@/lib/psychiatry-hub/visits";
import { PageTitleUnderBand, useModeBandCurrentTab, WithoutModeBand } from "@/components/mode-band/mode-band";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { desktopPageComposerSlotId, modeHomeComposerReservePendingValue } from "@/lib/mode-home-composer";

/**
 * The Psychiatry hub, in two pages: Home and Saved (owner design review, 12 October 2026, which
 * folded the old Ask and Tools pages into one Home), drawn in the calmer Work search style: flat
 * hairline lists, grey icons and at most one filled button per screen.
 *
 * It is a front door, not clinical content: every row is a way into a section that keeps its own
 * address and search. Green, amber and red are not used for decoration here.
 *
 * The figures are real or absent. Section counts come from the catalogues (read on the server);
 * "Continue" and the forms list read this device's own history
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
  readonly calculators: number;
  readonly dictionary: number;
}

/** Home is `ask`, the id its tab has always had, so saved links and the band's tab key still match. */
const PAGE_IDS = ["ask", "saved"] as const;
type PsychiatryPageId = (typeof PAGE_IDS)[number];

/**
 * ?page= names the page; anything else (or none) falls back to `fallback`. The retired Tools page
 * (`?page=tools`, folded into Home on 12 October 2026) lands on Home rather than on whatever the
 * fallback is, so an old link or bookmark always opens the page that now holds its tools.
 */
export function parsePsychiatryPage(value: string | null | undefined, fallback: PsychiatryPageId): PsychiatryPageId {
  if (value === "tools") return "ask";
  return PAGE_IDS.find((id) => id === value) ?? fallback;
}

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

// Builders: the quick actions, and every builder and comparison the retired Tools page listed, so
// Home reaches all of them. Safety plan lives once, under "For a shift", and the MHA forms and the
// Act once, under "Mental Health Act", so none of those is repeated here.
const BUILDERS: readonly DashQuickAction[] = [
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
  {
    label: "Compare therapies",
    href: "/therapy-compass/compare",
    icon: GitCompareArrows,
    testId: "psychiatry-qa-compare-therapies",
  },
  {
    label: "Compare specifiers",
    href: "/specifiers/compare",
    icon: GitCompareArrows,
    testId: "psychiatry-qa-compare-specifiers",
  },
  { label: "Mechanism map", href: "/formulation/map", icon: MapIcon, testId: "psychiatry-qa-mechanism-map" },
  { label: "Problem pathways", href: "/therapy-compass/pathways", icon: Workflow, testId: "psychiatry-qa-pathways" },
  // First Nations is not repeated here: it is one of the Sections above
  // (Clinical audit, 13 Oct 2026, item 15), so the page lists it once.
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
    case "calculators":
      return plural(counts.calculators, "calculator", "calculators");
    case "dictionary":
      return plural(counts.dictionary, "term", "terms");
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

/**
 * Offline, the shell hides the search box because it cannot answer, so the page
 * says why once.
 */
function OfflineNote() {
  return (
    <p
      className="flex items-start gap-2.5 rounded-lg bg-[color:var(--dash-card)] px-3 py-2.5 text-sm text-[color:var(--dash-muted)] forced-colors:border"
      data-testid="psychiatry-offline"
    >
      <WifiOff aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
      <span>
        <b className="font-semibold text-[color:var(--dash-ink)]">Offline.</b> Search needs a connection. Other pages
        may not open until you reconnect.
      </span>
    </p>
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

/** The builders as a two-across hairline grid. */
function QuickActionGrid({ actions }: { readonly actions: readonly DashQuickAction[] }) {
  return (
    <ul
      role="list"
      aria-label="Builders"
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
        title="MHA time limits"
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
  counts,
}: {
  readonly visits: readonly PsychiatryVisit[];
  readonly opens: readonly PsychiatryOpen[];
  readonly now: Date | null;
  readonly counts: PsychiatrySectionCounts;
}) {
  const latest = visits[0] ?? null;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2 lg:gap-x-8">
      <div className="grid min-w-0 gap-5">
        {latest ? <ResumeRow latest={latest} now={now} /> : null}
        {/* Continue leads the content once it holds something (Clinical audit,
            13 Oct 2026, item 15); empty, it keeps its quiet place at the end. */}
        {latest ? <ContinueSection visits={visits} now={now} /> : null}
        <section aria-labelledby="psychiatry-shift-title" className="grid gap-2">
          <FlatLabel id="psychiatry-shift-title" title="For a shift" />
          <ShiftToolsList clockLine={clockSummary} />
        </section>
        <MentalHealthActSection visits={visits} opens={opens} />
      </div>
      <div className="grid min-w-0 gap-5">
        <SectionsSection counts={counts} />
        <section
          aria-labelledby="psychiatry-qa-title"
          className="grid gap-2"
          data-testid="psychiatry-card-quick-actions"
        >
          <FlatLabel
            id="psychiatry-qa-title"
            title="Builders"
            aside={
              // The one link to the plain list of every tool (item 15).
              <Link href="/tools" className={flatLink} data-testid="psychiatry-all-tools">
                All tools
              </Link>
            }
          />
          <QuickActionGrid actions={BUILDERS} />
        </section>
        {latest ? null : <ContinueSection visits={visits} now={now} />}
      </div>
    </div>
  );
}

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
  // The band's Home / Saved tabs are links to ?page=, so the address names the page.
  const searchParams = useSearchParams();
  const page = parsePsychiatryPage(searchParams?.get("page"), initialPage);
  useModeBandCurrentTab(`psychiatry-${page}`);
  const now = useNow(nowProp);
  const state = usePsychiatryVisits();
  // Offline the shell hides the box, so its reserved space goes too.
  const offline = useOffline();

  return (
    <InformationPageShell testId="psychiatry-home">
      <div className={cn("mx-auto grid w-full max-w-5xl gap-5 sm:gap-6", dashSurface)}>
        {/* From tablet up the search box sits here, under the band and above the
            page, as it does under a Clinical search page's title. Phones use the
            usual bottom box. */}
        <DesktopComposerPortalSlot
          id={desktopPageComposerSlotId}
          data-testid="psychiatry-composer"
          data-composer-reserve={offline ? undefined : modeHomeComposerReservePendingValue}
          className="desktop-page-composer-slot mx-auto hidden w-full min-w-0 sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
        />
        <header className="grid min-w-0 gap-0.5" data-testid="psychiatry-header">
          <WithoutModeBand>
            <p className="min-h-5 text-sm text-[color:var(--dash-muted)]">{now ? LONG_DATE.format(now) : null}</p>
          </WithoutModeBand>
          <PageTitleUnderBand className="font-dash-figure text-3xl-minus leading-tight tracking-tight text-[color:var(--dash-ink)]">
            Psychiatry
          </PageTitleUnderBand>
        </header>

        <div id="psychiatry-panel" className="grid gap-3 sm:gap-4">
          {offline ? <OfflineNote /> : null}
          {page === "ask" ? <AskPage visits={state.visits} opens={state.opens} now={now} counts={counts} /> : null}
          {page === "saved" ? <PsychiatrySavedCard /> : null}
        </div>
      </div>
    </InformationPageShell>
  );
}
