"use client";

import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

import { FICTIONAL_DATA_MARKER } from "./fixtures";
import { CARING_CONTACT_MOCKUP_ROUTES } from "./routes";
import type { PrimaryDestination, WorkspaceDestination } from "./types";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

const desktopDestinations: readonly { label: PrimaryDestination | "More"; icon: NavigationIcon }[] = [
  { label: "Today", icon: LayoutDashboard },
  { label: "Patients", icon: Users },
  { label: "Schedule", icon: CalendarDays },
  { label: "Templates", icon: FileText },
  { label: "More", icon: MoreHorizontal },
];

const phoneDestinations = desktopDestinations.filter(({ label }) => label !== "Templates");
const desktopMoreDestinations: readonly WorkspaceDestination[] = ["Team", "Guidance", "Reports"];
const phoneMoreDestinations: readonly WorkspaceDestination[] = ["Templates", ...desktopMoreDestinations];

type MoreDestination = WorkspaceDestination | "System states";

const moreDestinations: readonly { label: MoreDestination; description: string; icon: NavigationIcon }[] = [
  { label: "Templates", description: "Governed pathways, messages and approval history", icon: FileText },
  { label: "Team", description: "Ownership, capacity and unclaimed work", icon: Users },
  { label: "Guidance", description: "Programme boundaries and operational guidance", icon: BookOpen },
  { label: "Reports", description: "Aggregate operational reporting", icon: ClipboardList },
  { label: "System states", description: "Components, decisions and recovery scenarios", icon: Settings },
];

export type CaringContactShellFrameProps = {
  activeDestination: WorkspaceDestination;
  onDestinationChange?: (destination: WorkspaceDestination) => void;
  onStartReferral?: () => void;
  routable?: boolean;
  systemStatesActive?: boolean;
  onOpenTeamSwitcher?: () => void;
  title: string;
  eyebrow?: string;
  description?: string;
  headerAction?: ReactNode;
  children: ReactNode;
};

export function CaringContactShellFrame({
  activeDestination,
  onDestinationChange,
  onStartReferral,
  routable = false,
  systemStatesActive = false,
  onOpenTeamSwitcher,
  title,
  eyebrow,
  description,
  headerAction,
  children,
}: CaringContactShellFrameProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [announcement, setAnnouncement] = useState(`${activeDestination} selected`);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  // The deferred focus hop below outlives a fast unmount: it fires 250ms later and
  // touches `document`, which throws once the tree (or a jsdom test environment)
  // is gone. Hold the id so teardown can cancel it.
  const focusTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (focusTimerRef.current !== undefined) window.clearTimeout(focusTimerRef.current);
    },
    [],
  );

  function selectDestination(destination: WorkspaceDestination) {
    const returningFromMore = moreOpen;
    onDestinationChange?.(destination);
    setMoreOpen(false);
    setAnnouncement(`${destination} selected`);
    if (returningFromMore) {
      focusTimerRef.current = window.setTimeout(() => {
        focusTimerRef.current = undefined;
        document.querySelector<HTMLElement>("[data-caring-contact-page-title]")?.focus({ preventScroll: true });
      }, 250);
    }
  }

  function handlePrimaryDestination(destination: PrimaryDestination | "More", trigger: HTMLButtonElement) {
    if (destination === "More") {
      moreTriggerRef.current = trigger;
      setMoreOpen(true);
      setAnnouncement("More destinations opened");
      return;
    }
    selectDestination(destination);
  }

  function destinationHref(destination: MoreDestination) {
    if (destination === "Today") return CARING_CONTACT_MOCKUP_ROUTES.today;
    if (destination === "Patients") return CARING_CONTACT_MOCKUP_ROUTES.patients;
    if (destination === "Schedule") return CARING_CONTACT_MOCKUP_ROUTES.schedule;
    if (destination === "Templates") return CARING_CONTACT_MOCKUP_ROUTES.templates;
    if (destination === "Team") return CARING_CONTACT_MOCKUP_ROUTES.team;
    if (destination === "Guidance") return CARING_CONTACT_MOCKUP_ROUTES.guidance;
    if (destination === "Reports") return CARING_CONTACT_MOCKUP_ROUTES.reports;
    return CARING_CONTACT_MOCKUP_ROUTES.systemStates;
  }

  const navigationItemClass = (selected: boolean) =>
    cn(
      "group flex min-h-tap min-w-0 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
      selected
        ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--rule-accent)]"
        : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
    );

  return (
    <div className="min-h-dvh bg-[color:var(--background)] text-[color:var(--text)] md:flex">
      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface-chrome)] md:flex">
        <div className="flex min-h-[var(--header-h)] items-center justify-center border-b border-[color:var(--border)] px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
            <HeartHandshake aria-hidden="true" className="size-icon-lg" />
          </span>
          <div className="sr-only">
            <p className="truncate text-base font-semibold tracking-tight text-[color:var(--text-heading)]">
              Caring Contacts
            </p>
            <p className="truncate text-xs text-[color:var(--text-muted)]">Caring-contact coordination</p>
          </div>
        </div>

        <div className="px-3 pt-4">
          {routable ? (
            <Link
              href={`${CARING_CONTACT_MOCKUP_ROUTES.newPlan}?stage=agreement`}
              aria-label="Start new caring-contact referral"
              className="flex min-h-tap w-full items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--command)] px-0 text-[color:var(--command-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--command-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <Plus aria-hidden="true" className="size-icon-md" />
              <span className="sr-only">New referral</span>
            </Link>
          ) : (
            <Button
              variant="primary"
              icon={Plus}
              onClick={onStartReferral}
              aria-label="Start new caring-contact referral"
              className="w-full px-0"
            >
              <span className="sr-only">New referral</span>
            </Button>
          )}
        </div>

        <nav aria-label="Desktop workspace" className="mt-3 flex flex-1 flex-col gap-1 px-3">
          {desktopDestinations.map(({ label, icon: Icon }) => {
            const selected =
              label === "More"
                ? systemStatesActive || desktopMoreDestinations.includes(activeDestination)
                : activeDestination === label;
            return routable && label !== "More" ? (
              <Link
                key={label}
                href={destinationHref(label)}
                aria-current={selected ? "page" : undefined}
                aria-label={label}
                className={navigationItemClass(selected)}
              >
                <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
                <span className="sr-only">{label}</span>
              </Link>
            ) : (
              <button
                key={label}
                type="button"
                aria-current={selected ? "page" : undefined}
                aria-haspopup={label === "More" ? "dialog" : undefined}
                aria-expanded={label === "More" ? moreOpen : undefined}
                onClick={(event) => handlePrimaryDestination(label, event.currentTarget)}
                className={navigationItemClass(selected)}
              >
                <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
                <span className="sr-only">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-[color:var(--border)] p-3">
          {routable ? (
            <Link
              href={CARING_CONTACT_MOCKUP_ROUTES.guidance}
              aria-label="Help and guidance"
              className="flex min-h-tap w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <CircleHelp aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="sr-only">Help and guidance</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => selectDestination("Guidance")}
              className="flex min-h-tap w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <CircleHelp aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="sr-only">Help and guidance</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setAnnouncement("Settings are outside this synthetic prototype")}
            className="flex min-h-tap w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <Settings aria-hidden="true" className="size-icon-lg shrink-0" />
            <span className="sr-only">Settings</span>
          </button>
          <div className="mt-2 hidden items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--surface-inset)] text-xs font-semibold">
              AE
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">Alex Example</span>
              <span className="block truncate text-xs text-[color:var(--text-muted)]">Coordinator</span>
            </span>
            <ChevronDown aria-hidden="true" className="size-icon-sm text-[color:var(--text-muted)]" />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-[var(--z-raised)] border-b border-[color:var(--border)] bg-[color:var(--surface-chrome)]/95 backdrop-blur-md forced-colors:bg-[Canvas]">
          <div className="flex min-h-[var(--header-h)] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
                <HeartHandshake aria-hidden="true" className="size-icon-lg" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[color:var(--text-heading)]">Caring Contacts</p>
                <p className="truncate text-xs text-[color:var(--text-muted)]">{title}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenTeamSwitcher ? onOpenTeamSwitcher() : setAnnouncement("Example Aftercare Team remains selected")
              }
              className="hidden min-h-tap items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] md:flex"
            >
              Example Aftercare Team
              <ChevronDown aria-hidden="true" className="size-icon-sm text-[color:var(--text-muted)]" />
            </button>

            <div className="ml-auto flex items-center gap-2">
              <span
                data-testid="caring-contact-synthetic-marker"
                className="hidden rounded-[var(--radius-sm)] border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--clinical-accent)] sm:inline-flex forced-colors:border-[CanvasText]"
                title={FICTIONAL_DATA_MARKER}
              >
                Synthetic prototype
              </span>
              <button
                type="button"
                onClick={() => setAnnouncement("No new notifications")}
                aria-label="Notifications"
                className="grid h-tap w-tap place-items-center rounded-[var(--radius-md)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                <Bell aria-hidden="true" className="size-icon-lg" />
              </button>
              <span className="hidden size-8 place-items-center rounded-full bg-[color:var(--surface-inset)] text-xs font-semibold sm:grid">
                AE
              </span>
            </div>
          </div>
        </header>

        <main className="min-w-0 px-4 pb-24 pt-5 sm:px-6 sm:pt-7 md:pb-8 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-6 flex min-w-0 flex-col gap-4 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                {eyebrow ? (
                  <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--clinical-accent)]">
                    {eyebrow}
                  </p>
                ) : null}
                <h1
                  data-caring-contact-page-title
                  data-caring-contact-stage-heading
                  tabIndex={-1}
                  className={cn(
                    "text-[length:var(--text-hero)] font-semibold leading-[var(--text-hero--line-height)] tracking-[var(--text-hero-tr)] text-[color:var(--text-heading)] outline-none",
                    eyebrow && "mt-2",
                  )}
                >
                  {title}
                </h1>
                {description ? (
                  <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)] sm:text-base">
                    {description}
                  </p>
                ) : null}
              </div>
              {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
            </div>

            {children}
          </div>
        </main>
      </div>

      <nav
        aria-label="Phone workspace"
        className="fixed inset-x-0 bottom-0 z-[var(--z-chrome)] grid grid-cols-4 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] pb-[var(--safe-area-bottom)] md:hidden"
      >
        {phoneDestinations.map(({ label, icon: Icon }) => {
          const selected =
            label === "More"
              ? systemStatesActive || phoneMoreDestinations.includes(activeDestination)
              : activeDestination === label;
          const className = cn(
            "flex min-h-[var(--space-10)] min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]",
            selected ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
          );
          return routable && label !== "More" ? (
            <Link
              key={label}
              href={destinationHref(label)}
              aria-current={selected ? "page" : undefined}
              aria-label={label}
              className={className}
            >
              <Icon aria-hidden="true" className="size-icon-lg" />
              <span className="truncate">{label}</span>
            </Link>
          ) : (
            <button
              key={label}
              type="button"
              aria-current={selected ? "page" : undefined}
              aria-haspopup={label === "More" ? "dialog" : undefined}
              aria-expanded={label === "More" ? moreOpen : undefined}
              onClick={(event) => handlePrimaryDestination(label, event.currentTarget)}
              className={className}
            >
              <Icon aria-hidden="true" className="size-icon-lg" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <Sheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More"
        description="Programme administration and supporting areas"
        closeLabel="Close more destinations"
        returnFocusRef={moreTriggerRef}
        mobileSize="content"
      >
        <div className="divide-y divide-[color:var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)]">
          {moreDestinations.map(({ label, description: itemDescription, icon: Icon }) =>
            !routable && label === "System states" ? null : routable ? (
              <Link
                key={label}
                href={destinationHref(label)}
                onClick={() => setMoreOpen(false)}
                className="flex min-h-tap w-full items-center gap-3 bg-[color:var(--surface)] px-4 py-3 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] text-[color:var(--clinical-accent)] forced-colors:border forced-colors:border-[CanvasText]">
                  <Icon aria-hidden="true" className="size-icon-md" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[color:var(--text)]">{label}</span>
                  <span className="mt-0.5 block text-sm text-[color:var(--text-muted)]">{itemDescription}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            ) : (
              <button
                key={label}
                type="button"
                onClick={() => selectDestination(label as WorkspaceDestination)}
                className="flex min-h-tap w-full items-center gap-3 bg-[color:var(--surface)] px-4 py-3 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] text-[color:var(--clinical-accent)] forced-colors:border forced-colors:border-[CanvasText]">
                  <Icon aria-hidden="true" className="size-icon-md" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[color:var(--text)]">{label}</span>
                  <span className="mt-0.5 block text-sm text-[color:var(--text-muted)]">{itemDescription}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </button>
            ),
          )}
        </div>
      </Sheet>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
