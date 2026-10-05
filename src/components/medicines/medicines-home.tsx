"use client";

import {
  ArrowRight,
  Brain,
  ChevronRight,
  CloudOff,
  ExternalLink,
  FileText,
  Pill,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { dashLink, dashMuted, dashSurface, dashTitle } from "@/components/dashboard-kit/recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { cn } from "@/components/ui-primitives";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import {
  clearMedicineVisits,
  MEDICINES_RECENT_SHOWN,
  medicineVisitHref,
  readMedicineVisits,
  subscribeMedicineVisits,
  type MedicineVisit,
} from "@/lib/medicines-recent";
import { MEDICINES_REFERENCES, PBS_HOME_HREF, WA_STATEWIDE_CHARTS } from "@/lib/medicines-references";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { useOnlineStatus } from "@/lib/use-online-status";
import { PageTitleUnderBand, WithoutModeBand } from "@/components/mode-band/mode-band";

/**
 * The Medicines & tools hub (modes review, phase 3; Medicines mock-up of
 * 5 Oct 2026): a front door, not clinical content.
 *
 * Flat, quiet groups (mock-up v6): the question and search field, the last
 * few medicine pages opened on this device, the sections once as a hairline
 * list with their real counts, and the outside references (the PBS
 * Schedule, the WA statewide mental health medication charts, Formulary One,
 * AMH, Therapeutic Guidelines and HealthPathways WA) are links only: nothing
 * of theirs is copied or summarised here. Colour is blue and neutral only;
 * green, amber and red mean source status on clinical pages and are not used.
 * The only thing read from the device is the "Recent" list
 * (`src/lib/medicines-recent.ts`): medicine names, never times or patients.
 */

export interface MedicinesSectionCounts {
  readonly medications: number;
  readonly calculators: number;
  readonly tools: number;
  readonly factsheets: number;
  readonly dictionary: number;
}

/** The sections, read from the menu's Medicines & tools group so the hub and the menu never list different ones. */
const SECTION_MODE_IDS: readonly AppModeId[] = (
  phoneModeGroups.find((group) => group.id === "care")?.modeIds ?? []
).filter((modeId) => modeId !== "medicines");

const LONG_DATE = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Australia/Perth",
});

const PERTH_MONTH = new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "Australia/Perth" });
const PERTH_MONTH_SHORT = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "Australia/Perth" });

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-AU")} ${count === 1 ? one : many}`;
}

function sectionCountLine(modeId: AppModeId, counts: MedicinesSectionCounts): string | null {
  switch (modeId) {
    case "prescribing":
      return plural(counts.medications, "medicine", "medicines");
    case "calculators":
      return plural(counts.calculators, "calculator", "calculators");
    case "tools":
      return plural(counts.tools, "tool", "tools");
    case "factsheets":
      return plural(counts.factsheets, "factsheet", "factsheets");
    case "dictionary":
      return plural(counts.dictionary, "term", "terms");
    default:
      return null;
  }
}

const MINUTE_MS = 60_000;

function subscribeMinute(listener: () => void): () => void {
  const timer = window.setInterval(listener, MINUTE_MS);
  return () => window.clearInterval(timer);
}

/** The reader's clock to the minute, read only in the browser, so the date line never mismatches the server render. */
function useToday(nowProp?: Date): Date | null {
  const minute = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => null,
  );
  if (nowProp) return nowProp;
  return minute === null ? null : new Date(minute);
}

/** The group heading: small capitals in the muted ink, so it stays readable (the faint rung is below 4.5:1). */
const groupLabel = "font-dash-title text-2xs uppercase tracking-eyebrow text-[color:var(--dash-muted)]";

/** A flat titled group: heading row over its content, no card. */
function Group({
  title,
  aside,
  testId,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="grid min-w-0 content-start gap-1">
      <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
        <h2 id={headingId} className={groupLabel}>
          {title}
        </h2>
        {aside ? <div className="flex shrink-0 items-center gap-1">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A hairline list: rows divided by a line, no outer box. */
const hairlineList = "grid min-w-0";
const hairlineItem = "min-w-0 border-t border-[color:var(--dash-line)] first:border-t-0";
const rowLink = "grid min-h-14 items-center gap-x-3 py-2 text-[color:var(--dash-ink)] no-underline";
const rowIcon = "size-icon-md shrink-0 text-[color:var(--dash-muted)]";
const rowTitle = "break-words font-dash-title text-base-minus leading-tight";
const rowEnd = "size-icon-sm shrink-0 text-[color:var(--dash-faint)]";

function OpensOutside() {
  return (
    <>
      <ExternalLink aria-hidden="true" className={rowEnd} />
      <span className="sr-only">(opens in a new tab)</span>
    </>
  );
}

/** Offline, an outside link keeps working (the signal is only a hint) but says what it needs instead of the open-outside mark. */
function OutsideEnd({ online }: { readonly online: boolean }) {
  return online ? <OpensOutside /> : <span className="sr-only">(opens in a new tab)</span>;
}

/**
 * Shown when the browser reports no connection. `navigator.onLine` is only a
 * hint (docs/pwa.md), so nothing is blocked or greyed (greying live controls
 * would drop them below contrast): the page says what will not work, and
 * everything still answers a tap.
 */
function OfflineNote() {
  return (
    <div
      role="status"
      data-testid="medicines-offline"
      className="flex min-w-0 items-start gap-3 rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-3 forced-colors:border"
    >
      <CloudOff aria-hidden="true" className={cn(rowIcon, "mt-0.5")} />
      <div className="grid min-w-0 gap-0.5">
        <p className={cn(dashTitle, "text-sm")}>No connection</p>
        <p className={dashMuted}>
          Search, sections and outside links need a connection. They open again when you reconnect.
        </p>
      </div>
    </div>
  );
}

function FindArea() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(appModeHomeHref("prescribing", { query: trimmed, run: true }));
  };
  return (
    <section aria-labelledby="medicines-find-heading" data-testid="medicines-card-find" className="grid min-w-0 gap-3">
      <form role="search" aria-label="Search medication guidance" onSubmit={submit} className="grid min-w-0 gap-3">
        <div className="grid gap-0.5">
          <span className={groupLabel}>Medication</span>
          <h2
            id="medicines-find-heading"
            className="font-dash-title text-2xl-minus leading-tight tracking-tight text-balance text-[color:var(--dash-ink)]"
          >
            Which medicine are you checking?
          </h2>
        </div>
        <div className="flex min-h-14 items-center gap-2 rounded-xl border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] py-1 pr-1 pl-4 text-[color:var(--dash-ink)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus)] forced-colors:border">
          <Search aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--dash-muted)]" />
          <label htmlFor="medicines-find-input" className="sr-only">
            Medicine or question
          </label>
          <input
            id="medicines-find-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Dosing, safety or monitoring"
            autoComplete="off"
            data-testid="medicines-find-input"
            className="min-h-12 w-0 min-w-0 flex-1 bg-transparent text-base text-[color:var(--dash-ink)] outline-none placeholder:text-[color:var(--dash-muted)]"
          />
          <button
            type="submit"
            aria-label="Search"
            data-testid="medicines-find-submit"
            className={cn(
              focusRing,
              "grid size-12 shrink-0 place-items-center rounded-lg bg-[color:var(--dash-blue)] text-[color:var(--dash-raised)] forced-colors:border",
            )}
          >
            <ArrowRight aria-hidden="true" className="size-icon-md" />
          </button>
        </div>
        <div
          className="-mx-4 -my-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none]"
          data-testid="medicines-find-try"
        >
          <span className={cn(dashMuted, "shrink-0")}>Try</span>
          {sharedHomePresentation.medicines.suggestions.map((suggestion) => (
            <Link
              key={suggestion}
              href={appModeHomeHref("prescribing", { query: suggestion, run: true })}
              className={cn(focusRing, "inline-flex min-h-12 shrink-0 items-center rounded-xl no-underline")}
            >
              <span className="whitespace-nowrap rounded-xl border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 py-1.5 text-sm text-[color:var(--dash-ink)] forced-colors:border">
                {suggestion}
              </span>
            </Link>
          ))}
        </div>
      </form>
    </section>
  );
}

/**
 * The last few medicine pages opened on this device, names only (never a time).
 * Hidden when there are none: an empty "Recent" heading says nothing useful.
 */
function RecentGroup() {
  const visits = useSyncExternalStore(
    subscribeMedicineVisits,
    () => readMedicineVisits(),
    () => NO_VISITS,
  );
  const shown = visits.slice(0, MEDICINES_RECENT_SHOWN);
  if (shown.length === 0) return null;
  return (
    <Group
      title="Recent"
      testId="medicines-recent"
      aside={
        <button
          type="button"
          onClick={() => {
            clearMedicineVisits();
            // The group (and this button) disappears; keep focus on the page.
            document.getElementById("medicines-find-input")?.focus();
          }}
          aria-label="Clear recent medicines"
          data-testid="medicines-recent-clear"
          className={cn(
            focusRing,
            dashLink,
            "inline-flex min-h-12 min-w-12 items-center justify-end rounded-lg px-1 text-sm",
          )}
        >
          Clear
        </button>
      }
    >
      <ul role="list" aria-label="Recently opened medicines" className={hairlineList}>
        {shown.map((visit) => (
          <li key={visit.slug} className={hairlineItem}>
            <Link
              href={medicineVisitHref(visit)}
              className={cn(focusRing, rowLink, "grid-cols-[auto_minmax(0,1fr)_auto] rounded-lg")}
            >
              <Pill aria-hidden="true" className={rowIcon} />
              <span className="grid min-w-0 gap-0.5">
                <span className={rowTitle}>{visit.name}</span>
                <span className={dashMuted}>Medication</span>
              </span>
              <ChevronRight aria-hidden="true" className={rowEnd} />
            </Link>
          </li>
        ))}
      </ul>
    </Group>
  );
}

const NO_VISITS: readonly MedicineVisit[] = [];

/** One calm list: grey icon, the section's name, and its real count on the right. */
function SectionsGroup({ counts }: { readonly counts: MedicinesSectionCounts }) {
  return (
    <Group title="Sections" testId="medicines-card-sections">
      <ul role="list" aria-label="Medicines and tools sections" className={hairlineList}>
        {SECTION_MODE_IDS.map((modeId) => {
          const mode = appModeDefinition(modeId);
          const countLine = sectionCountLine(modeId, counts);
          const ModeIcon = appModeIcons[modeId];
          return (
            <li key={modeId} className={hairlineItem}>
              <Link
                href={appModeHomeHref(modeId)}
                data-testid={`medicines-section-${modeId}`}
                className={cn(focusRing, rowLink, "grid-cols-[auto_minmax(0,1fr)_auto_auto] rounded-lg")}
              >
                <ModeIcon aria-hidden="true" className={rowIcon} />
                <span className={rowTitle}>{mode.label}</span>
                <span className="nums text-right text-sm text-[color:var(--dash-muted)]">
                  {countLine ?? mode.description}
                </span>
                <ChevronRight aria-hidden="true" className={rowEnd} />
              </Link>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

/**
 * The PBS Schedule is updated on the first day of every month (pbs.gov.au).
 * This row only says so and opens the Schedule; it never claims what changed.
 */
function PbsMonthGroup({ today, online }: { readonly today: Date | null; readonly online: boolean }) {
  const month = today ? PERTH_MONTH.format(today) : null;
  const monthShort = today ? PERTH_MONTH_SHORT.format(today) : null;
  return (
    <Group title="This month" testId="medicines-card-pbs">
      <a
        href={PBS_HOME_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(focusRing, rowLink, "grid-cols-[auto_minmax(0,1fr)_auto] rounded-lg")}
      >
        <span
          aria-hidden="true"
          className="grid min-w-12 shrink-0 rounded-lg px-1 border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] py-1 text-center forced-colors:border"
        >
          <span className="font-dash-title text-3xs uppercase tracking-widest text-[color:var(--dash-muted)]">
            {monthShort ?? "PBS"}
          </span>
          <span className="font-dash-figure text-lg leading-none text-[color:var(--dash-ink)]">1</span>
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className={rowTitle}>{month ? `PBS updated 1 ${month}` : "PBS updates on the 1st of each month"}</span>
          <span className={dashMuted}>{online ? "Check a listing on the PBS Schedule" : "Needs a connection"}</span>
        </span>
        <OutsideEnd online={online} />
      </a>
    </Group>
  );
}

/** All three WA statewide mental health medication charts as a flat list, each opening WA Health's page. */
function StatewideChartsGroup({ online }: { readonly online: boolean }) {
  return (
    <Group
      title="WA statewide charts"
      testId="medicines-card-charts"
      aside={
        <span className={cn(dashMuted, "nums")}>
          {WA_STATEWIDE_CHARTS.length}
          <span className="sr-only"> charts</span>
        </span>
      }
    >
      <ul role="list" aria-label="WA statewide mental health medication charts" className={hairlineList}>
        {WA_STATEWIDE_CHARTS.map((chart) => (
          <li key={chart.id} className={hairlineItem}>
            <a
              href={chart.href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`medicines-chart-${chart.id}`}
              className={cn(focusRing, rowLink, "grid-cols-[auto_minmax(0,1fr)_auto] rounded-lg")}
            >
              <FileText aria-hidden="true" className={rowIcon} />
              <span className="grid min-w-0 gap-0.5">
                <span className={rowTitle}>{chart.title}</span>
                <span className={dashMuted}>{online ? chart.publisher : "Needs a connection"}</span>
              </span>
              <OutsideEnd online={online} />
            </a>
          </li>
        ))}
      </ul>
    </Group>
  );
}

/** Formulary One, AMH, Therapeutic Guidelines and HealthPathways WA: links out, never copied content. */
function ReferencesGroup({ online }: { readonly online: boolean }) {
  return (
    <Group
      title="Outside references"
      testId="medicines-card-references"
      aside={
        <span className={cn(dashMuted, "inline-flex items-center gap-1")}>
          {online ? (
            <>
              Opens outside
              <ExternalLink aria-hidden="true" className="size-icon-xs shrink-0" />
            </>
          ) : (
            "Needs a connection"
          )}
        </span>
      }
    >
      <ul role="list" aria-label="Outside medicine references" className="grid grid-cols-4 gap-1 pt-1">
        {MEDICINES_REFERENCES.map((reference) => (
          <li key={reference.id} className="min-w-0">
            <a
              href={reference.href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`medicines-reference-${reference.id}`}
              className={cn(
                focusRing,
                "grid min-h-12 justify-items-center gap-1.5 rounded-xl px-1 py-1.5 text-center no-underline",
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-full border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] font-dash-title text-xs text-[color:var(--dash-ink)] forced-colors:border"
              >
                {reference.mark}
              </span>
              <span className="w-full break-words text-xs leading-tight text-[color:var(--dash-ink)] [overflow-wrap:break-word]">
                {reference.title}
              </span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </Group>
  );
}

const SIGNPOSTS = [
  { label: "Safety plan", href: "/safety-plan", icon: ShieldCheck, testId: "medicines-signpost-safety-plan" },
  {
    label: "Psychiatry",
    href: appModeHomeHref("psychiatry"),
    icon: Brain,
    testId: "medicines-signpost-psychiatry",
  },
] as const;

/** Quiet routes to what lives in Psychiatry rather than here. */
function SignpostsGroup() {
  return (
    <Group title="Lives in Psychiatry" testId="medicines-card-signposts">
      <ul role="list" className={hairlineList}>
        {SIGNPOSTS.map(({ label, href, icon: SignIcon, testId }) => (
          <li key={label} className={hairlineItem}>
            <Link
              href={href}
              data-testid={testId}
              className={cn(focusRing, rowLink, "grid-cols-[auto_minmax(0,1fr)_auto] rounded-lg")}
            >
              <SignIcon aria-hidden="true" className={rowIcon} />
              <span className={rowTitle}>{label}</span>
              <ChevronRight aria-hidden="true" className={rowEnd} />
            </Link>
          </li>
        ))}
      </ul>
    </Group>
  );
}

export function MedicinesHome({ counts, now }: { readonly counts: MedicinesSectionCounts; readonly now?: Date }) {
  const today = useToday(now);
  const online = useOnlineStatus();
  return (
    <InformationPageShell testId="medicines-home">
      <div className={cn("mx-auto grid w-full max-w-5xl gap-5 sm:gap-6", dashSurface)}>
        <header className="grid min-w-0 gap-0.5" data-testid="medicines-header">
          <WithoutModeBand>
            <p className="min-h-5 text-sm text-[color:var(--dash-muted)]">{today ? LONG_DATE.format(today) : null}</p>
          </WithoutModeBand>
          <PageTitleUnderBand className="font-dash-figure text-3xl-minus leading-tight tracking-tight text-[color:var(--dash-ink)]">
            Medicines &amp; tools
          </PageTitleUnderBand>
        </header>
        {online ? null : <OfflineNote />}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
          <div className="grid min-w-0 gap-6">
            <FindArea />
            <RecentGroup />
            <SectionsGroup counts={counts} />
          </div>
          <div className="grid min-w-0 gap-6">
            <PbsMonthGroup today={today} online={online} />
            <StatewideChartsGroup online={online} />
            <ReferencesGroup online={online} />
            <SignpostsGroup />
          </div>
        </div>
      </div>
    </InformationPageShell>
  );
}
