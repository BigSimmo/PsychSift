"use client";

import { ArrowRight, Brain, ChevronRight, ExternalLink, FileText, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { dashLink, dashMuted, dashSurface, dashTitle } from "@/components/dashboard-kit/recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { cn } from "@/components/ui-primitives";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { MEDICINES_REFERENCES, PBS_HOME_HREF, WA_STATEWIDE_CHARTS } from "@/lib/medicines-references";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { PageTitleUnderBand, WithoutModeBand } from "@/components/mode-band/mode-band";

/**
 * The Medicines & tools hub (modes review, phase 3; Medicines mock-up of
 * 5 Oct 2026): a front door, not clinical content.
 *
 * The question and search sit on a light card, the sections appear once as a
 * calm list with their real counts, and the outside references (the PBS
 * Schedule, the WA statewide mental health medication charts, Formulary One,
 * AMH, Therapeutic Guidelines and HealthPathways WA) are links only: nothing
 * of theirs is copied or summarised here. Colour is blue and neutral only;
 * green, amber and red mean source status on clinical pages and are not used.
 * Nothing is stored or read from the device.
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

/** A round tinted icon, the hub's one chip shape. Decorative: its row says the same in words. */
function RoundChip({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full bg-[color:var(--dash-blue-tint)] font-dash-title text-2xs text-[color:var(--dash-blue)] forced-colors:border",
        className,
      )}
    >
      {children}
    </span>
  );
}

function OpensOutside() {
  return (
    <>
      <ExternalLink aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--dash-faint)]" />
      <span className="sr-only">(opens in a new tab)</span>
    </>
  );
}

function FindCard() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(appModeHomeHref("prescribing", { query: trimmed, run: true }));
  };
  return (
    <DashCard title="Find a medicine" showTitle={false} testId="medicines-card-find" className="gap-3 p-4">
      <form role="search" aria-label="Search medication guidance" onSubmit={submit} className="grid min-w-0 gap-3">
        <div className="grid gap-0.5">
          <span className="font-dash-title text-2xs uppercase tracking-widest text-[color:var(--dash-blue)]">
            Medication
          </span>
          <p className="font-dash-figure text-2xl-minus leading-tight tracking-tight text-balance text-[color:var(--dash-ink)]">
            Which medicine are you checking?
          </p>
        </div>
        <div className="flex min-h-14 items-center gap-2 rounded-full border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] py-1 pr-1 pl-4 text-[color:var(--dash-ink)] forced-colors:border">
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
              "grid size-12 shrink-0 place-items-center rounded-full bg-[color:var(--dash-blue)] text-[color:var(--dash-raised)] forced-colors:border",
            )}
          >
            <ArrowRight aria-hidden="true" className="size-icon-md" />
          </button>
        </div>
        <div
          className="-mx-4 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
          data-testid="medicines-find-try"
        >
          <span className={cn(dashMuted, "shrink-0")}>Try</span>
          {sharedHomePresentation.medicines.suggestions.map((suggestion) => (
            <Link
              key={suggestion}
              href={appModeHomeHref("prescribing", { query: suggestion, run: true })}
              className={cn(focusRing, "inline-flex min-h-12 shrink-0 items-center rounded-full no-underline")}
            >
              <span className="whitespace-nowrap rounded-full bg-[color:var(--dash-blue-tint)] px-3 py-1.5 text-xs font-dash-title text-[color:var(--dash-blue)] forced-colors:border">
                {suggestion}
              </span>
            </Link>
          ))}
        </div>
      </form>
    </DashCard>
  );
}

/** One calm list: round icon, the section's name, and its real count on the right. */
function SectionsCard({ counts }: { readonly counts: MedicinesSectionCounts }) {
  return (
    <DashCard title="Sections" testId="medicines-card-sections">
      <ul
        role="list"
        aria-label="Medicines and tools sections"
        className="grid min-w-0 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] forced-colors:border"
      >
        {SECTION_MODE_IDS.map((modeId) => {
          const mode = appModeDefinition(modeId);
          const countLine = sectionCountLine(modeId, counts);
          const ModeIcon = appModeIcons[modeId];
          return (
            <li key={modeId} className="min-w-0 border-t border-[color:var(--dash-line)] first:border-t-0">
              <Link
                href={appModeHomeHref(modeId)}
                data-testid={`medicines-section-${modeId}`}
                className={cn(
                  focusRing,
                  "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-2xl px-3 py-1.5 text-[color:var(--dash-ink)] no-underline",
                )}
              >
                <RoundChip>
                  <ModeIcon aria-hidden="true" className="size-icon-md" />
                </RoundChip>
                <span className="break-words font-dash-title text-base-minus leading-tight">{mode.label}</span>
                <span className={cn(dashMuted, "nums whitespace-nowrap text-right")}>
                  {countLine ?? mode.description}
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-sm text-[color:var(--dash-faint)]" />
              </Link>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}

/**
 * The PBS Schedule is updated on the first day of every month (pbs.gov.au).
 * This card only says so and opens the Schedule; it never claims what changed.
 */
function PbsMonthCard({ today }: { readonly today: Date | null }) {
  const month = today ? PERTH_MONTH.format(today) : null;
  const monthShort = today ? PERTH_MONTH_SHORT.format(today).toUpperCase() : null;
  return (
    <DashCard title="PBS Schedule" showTitle={false} testId="medicines-card-pbs">
      <a
        href={PBS_HOME_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          focusRing,
          "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl no-underline",
        )}
      >
        <span
          aria-hidden="true"
          className="grid w-12 shrink-0 overflow-hidden rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] text-center forced-colors:border"
        >
          <span className="bg-[color:var(--dash-blue)] py-0.5 font-dash-title text-3xs text-[color:var(--dash-raised)]">
            {monthShort ?? "PBS"}
          </span>
          <span className="py-1 font-dash-figure text-lg leading-none text-[color:var(--dash-ink)]">1</span>
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className={cn(dashTitle, "text-base-minus leading-tight")}>
            {month ? `PBS updated 1 ${month}` : "PBS updates on the 1st of each month"}
          </span>
          <span className={dashMuted}>Check a listing on the PBS Schedule</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <OpensOutside />
        </span>
      </a>
    </DashCard>
  );
}

/** A sideways shelf of the WA statewide mental health medication charts, each opening WA Health's page. */
function StatewideChartsCard() {
  return (
    <DashCard title="Statewide charts and forms" testId="medicines-card-charts">
      <ul
        role="list"
        aria-label="WA statewide mental health medication charts"
        className="-mx-3 flex min-w-0 snap-x gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"
      >
        {WA_STATEWIDE_CHARTS.map((chart) => (
          <li key={chart.id} className="w-56 shrink-0 snap-start">
            <a
              href={chart.href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`medicines-chart-${chart.id}`}
              className={cn(
                focusRing,
                "grid h-full min-h-28 content-between gap-3 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-3 no-underline forced-colors:border",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <RoundChip>
                  <FileText aria-hidden="true" className="size-icon-md" />
                </RoundChip>
                <OpensOutside />
              </span>
              <span className="grid gap-0.5">
                <span className={cn(dashTitle, "text-sm leading-snug")}>{chart.title}</span>
                <span className={dashMuted}>{chart.publisher}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}

/** Formulary One, AMH, Therapeutic Guidelines and HealthPathways WA: links out, never copied content. */
function ReferencesCard() {
  return (
    <DashCard
      title="My references"
      testId="medicines-card-references"
      aside={<span className={cn(dashMuted, "normal-case")}>Opens outside</span>}
    >
      <ul role="list" aria-label="Outside medicine references" className="grid grid-cols-4 gap-1">
        {MEDICINES_REFERENCES.map((reference) => (
          <li key={reference.id} className="min-w-0">
            <a
              href={reference.href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`medicines-reference-${reference.id}`}
              className={cn(
                focusRing,
                "grid min-h-12 justify-items-center gap-1.5 rounded-2xl px-1 py-1.5 text-center no-underline",
              )}
            >
              <RoundChip className="size-12 text-xs">{reference.mark}</RoundChip>
              <span className="w-full hyphens-auto break-words font-dash-title text-xs leading-tight text-[color:var(--dash-ink)] [overflow-wrap:anywhere]">
                {reference.title}
              </span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </DashCard>
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
function SignpostsCard() {
  return (
    <DashCard title="Lives in Psychiatry" testId="medicines-card-signposts">
      <ul role="list" className="grid gap-1">
        {SIGNPOSTS.map(({ label, href, icon: SignIcon, testId }) => (
          <li key={label}>
            <Link
              href={href}
              data-testid={testId}
              className={cn(
                focusRing,
                "flex min-h-12 items-center gap-3 rounded-xl px-1 text-[color:var(--dash-ink)] no-underline",
              )}
            >
              <SignIcon aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--dash-muted)]" />
              <span className="min-w-0 flex-1 font-dash-title text-sm">{label}</span>
              <span className={dashLink}>Go</span>
            </Link>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}

export function MedicinesHome({ counts, now }: { readonly counts: MedicinesSectionCounts; readonly now?: Date }) {
  const today = useToday(now);
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
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid min-w-0 gap-3 sm:gap-4">
            <FindCard />
            <SectionsCard counts={counts} />
          </div>
          <div className="grid min-w-0 gap-3 sm:gap-4">
            <PbsMonthCard today={today} />
            <StatewideChartsCard />
            <ReferencesCard />
            <SignpostsCard />
          </div>
        </div>
      </div>
    </InformationPageShell>
  );
}
