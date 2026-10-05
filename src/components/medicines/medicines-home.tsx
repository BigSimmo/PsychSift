"use client";

import {
  BookMarked,
  BookOpenText,
  Brain,
  Calculator,
  GitCompareArrows,
  Pill,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { IconChip } from "@/components/dashboard-kit/icon-chip";
import type { DashQuickAction } from "@/components/dashboard-kit/quick-actions";
import { dashMuted, dashSurface } from "@/components/dashboard-kit/recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { cn } from "@/components/ui-primitives";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { PageTitleUnderBand, WithoutModeBand } from "@/components/mode-band/mode-band";

/**
 * The Medicines & tools hub (modes review, phase 3): the Psychiatry hub's
 * layout reused for the medication and reference sections, on one page.
 *
 * It is a front door, not clinical content: every card is a way into a section
 * that keeps its own address and search. Colour is decoration only; green,
 * amber and red are not used. The section counts are real (read on the
 * server); nothing here is stored or read from the device.
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

const QUICK_ACTIONS: readonly DashQuickAction[] = [
  { label: "Search medication", href: appModeHomeHref("prescribing"), icon: Pill, testId: "medicines-qa-medication" },
  { label: "Calculators", href: appModeHomeHref("calculators"), icon: Calculator, testId: "medicines-qa-calculators" },
  { label: "Safety plan", href: "/safety-plan", icon: ShieldCheck, testId: "medicines-qa-safety-plan" },
  { label: "Factsheet topics", href: "/factsheets/topics", icon: BookOpenText, testId: "medicines-qa-factsheets" },
  { label: "Browse the dictionary", href: "/dictionary/browse", icon: BookMarked, testId: "medicines-qa-dictionary" },
  {
    label: "Compare definitions",
    href: "/dictionary/compare",
    icon: GitCompareArrows,
    testId: "medicines-qa-compare",
  },
  { label: "All tools", href: appModeHomeHref("tools"), icon: Wrench, testId: "medicines-qa-tools" },
  { label: "Psychiatry", href: appModeHomeHref("psychiatry"), icon: Brain, testId: "medicines-qa-psychiatry" },
];

const LONG_DATE = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Australia/Perth",
});

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

function FindHero() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(appModeHomeHref("prescribing", { query: trimmed, run: true }));
  };
  return (
    <DashCard title="Find a medicine" showTitle={false} tone="hero" testId="medicines-card-find">
      <form role="search" aria-label="Search medication guidance" onSubmit={submit} className="grid min-w-0 gap-3">
        <div className="grid gap-0.5">
          <span className="text-3xs font-dash-title uppercase tracking-widest opacity-80">Medication</span>
          <p className="font-dash-figure text-2xl-minus leading-tight tracking-tight text-balance lg:text-3xl-minus">
            Which medicine are you checking?
          </p>
        </div>
        <div className="flex min-h-14 items-center gap-2 rounded-2xl bg-[color:var(--dash-raised)] py-1.5 pr-1.5 pl-3.5 text-[color:var(--dash-ink)] shadow-[var(--dash-shadow)] forced-colors:border">
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
            data-testid="medicines-find-submit"
            className={cn(
              focusRing,
              "min-h-12 shrink-0 rounded-xl bg-[color:var(--dash-hero-3)] px-4 text-sm font-dash-title text-[color:var(--dash-hero-ink)] forced-colors:border",
            )}
          >
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0" data-testid="medicines-find-try">
          <span className="text-xs opacity-85">Try</span>
          {sharedHomePresentation.medicines.suggestions.map((suggestion) => (
            <Link
              key={suggestion}
              href={appModeHomeHref("prescribing", { query: suggestion, run: true })}
              className={cn(focusRing, "inline-flex min-h-12 items-center rounded-full no-underline")}
            >
              <span className="rounded-full border border-[color:var(--dash-hero-glass-line)] bg-[color:var(--dash-hero-glass)] px-3 py-1.5 text-xs font-dash-title text-[color:var(--dash-hero-ink)] forced-colors:border">
                {suggestion}
              </span>
            </Link>
          ))}
        </div>
      </form>
    </DashCard>
  );
}

/** Two across on a phone, four on a wide screen, as on the Psychiatry hub. */
function QuickActionGrid({ actions }: { readonly actions: readonly DashQuickAction[] }) {
  return (
    <ul
      role="list"
      aria-label="Quick actions"
      data-testid="medicines-quick-actions"
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

function SectionsCard({ counts }: { readonly counts: MedicinesSectionCounts }) {
  return (
    <DashCard title="Sections" testId="medicines-card-sections">
      <ul
        role="list"
        aria-label="Medicines and tools sections"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {SECTION_MODE_IDS.map((modeId) => {
          const mode = appModeDefinition(modeId);
          const countLine = sectionCountLine(modeId, counts);
          const ModeIcon = appModeIcons[modeId];
          return (
            <li key={modeId} className="min-w-0">
              <Link
                href={appModeHomeHref(modeId)}
                data-testid={`medicines-section-${modeId}`}
                className={cn(
                  focusRing,
                  "grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] px-3 py-2.5 text-[color:var(--dash-ink)] no-underline forced-colors:border",
                )}
              >
                <IconChip tint="blue" size="md">
                  <ModeIcon aria-hidden="true" className="size-icon-md" />
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
        <div className="grid gap-3 sm:gap-4">
          <FindHero />
          <DashCard title="Quick actions" testId="medicines-card-quick-actions">
            <QuickActionGrid actions={QUICK_ACTIONS} />
          </DashCard>
          <SectionsCard counts={counts} />
        </div>
      </div>
    </InformationPageShell>
  );
}
