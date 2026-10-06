"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";

import { mobileSectionFabMediaQuery, navigationHashes } from "@/components/clinical-dashboard/dashboard-contracts";
import { cn, LoadingPanel } from "@/components/ui-primitives";
import { useDismissableLayer } from "@/components/use-dismissable-layer";
import { type AppModeId, appModeSearchConfig } from "@/lib/app-modes";

const ApplicationsLauncherWorkspace = dynamic(
  () => import("@/components/applications-launcher-page").then((module) => module.ApplicationsLauncherWorkspace),
  // Legacy client-only launcher, now unreachable: `/?mode=tools` redirects to
  // `/tools`, which ToolsSearchResultsPage renders. Kept only until the guest
  // coverage in tests/favourites-auth-gate.dom.test.tsx is re-homed onto it.
  { ssr: false, loading: () => <LoadingPanel variant="skeleton" lines={6} label="Loading tools" /> },
);

export function ToolsHub({ query, desktopComposerSlotId }: { query: string; desktopComposerSlotId?: string }) {
  return <ApplicationsLauncherWorkspace query={query} desktopComposerSlotId={desktopComposerSlotId} />;
}

type MobileSectionFabItem = {
  label: string;
  description: string;
  icon: typeof FileText;
  href: (typeof navigationHashes)[number];
  count: number | null;
  empty?: boolean;
};

type MobileSectionFabTone = "neutral" | "ready" | "warning" | "empty";

type MobileSectionFabState = {
  statusLabel: string;
  statusTone: MobileSectionFabTone;
  nextStep: string;
  badgeLabel: string | null;
  badgeTone: MobileSectionFabTone;
};

function mobileSectionItemLabel(item: MobileSectionFabItem) {
  if (item.count === null) return item.label;
  return `${item.label}, ${item.count} item${item.count === 1 ? "" : "s"}`;
}

function fabToneClassName(tone: MobileSectionFabTone) {
  if (tone === "ready") {
    return "border-[color:var(--success)]/25 bg-[color:var(--success-soft)] text-[color:var(--success)]";
  }
  if (tone === "warning") {
    return "border-[color:var(--warning)]/25 bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
  }
  if (tone === "empty") {
    return "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]";
  }
  return "border-[color:var(--clinical-accent)]/20 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
}

export function buildMobileSectionFabState({
  hasAnswer,
  searchMode,
  sourceCount,
  quoteCount,
  weakEvidence,
  governanceWarningCount,
}: {
  hasAnswer: boolean;
  searchMode: AppModeId;
  sourceCount: number;
  quoteCount: number;
  weakEvidence: boolean;
  governanceWarningCount: number;
}): MobileSectionFabState {
  const modeSearch = appModeSearchConfig(searchMode);
  if (!hasAnswer) {
    if (modeSearch.resultKind === "tools" || modeSearch.resultKind === "therapies") {
      return {
        statusLabel: modeSearch.statusLabel,
        statusTone: "neutral",
        nextStep: modeSearch.nextStep,
        badgeLabel: null,
        badgeTone: "neutral",
      };
    }
    if (modeSearch.resultKind === "differentials") {
      return {
        statusLabel: "Diffs",
        statusTone: "neutral",
        nextStep: modeSearch.nextStep,
        badgeLabel: null,
        badgeTone: "neutral",
      };
    }
    return {
      statusLabel:
        modeSearch.resultKind === "documents" || modeSearch.resultKind === "forms"
          ? modeSearch.statusLabel
          : "No answer yet",
      statusTone: "empty",
      nextStep: modeSearch.nextStep,
      badgeLabel: modeSearch.badgeLabel,
      badgeTone: "empty",
    };
  }

  if (weakEvidence) {
    return {
      statusLabel: "Weak support",
      statusTone: "warning",
      nextStep: "Verify source before using",
      badgeLabel: "!",
      badgeTone: "warning",
    };
  }

  if (governanceWarningCount > 0) {
    return {
      statusLabel: "Needs source check",
      statusTone: "warning",
      nextStep: `${governanceWarningCount} source warning${governanceWarningCount === 1 ? "" : "s"}`,
      badgeLabel: "!",
      badgeTone: "warning",
    };
  }

  if (quoteCount > 0) {
    return {
      statusLabel: "Ready to verify",
      statusTone: "ready",
      nextStep: "Next: review exact quotes",
      badgeLabel: String(quoteCount),
      badgeTone: "ready",
    };
  }

  if (sourceCount > 0) {
    return {
      statusLabel: "Ready to verify",
      statusTone: "ready",
      nextStep: "Next: verify sources",
      badgeLabel: String(sourceCount),
      badgeTone: "ready",
    };
  }

  return {
    statusLabel: "Answer ready",
    statusTone: "neutral",
    nextStep: "Review answer structure",
    badgeLabel: null,
    badgeTone: "neutral",
  };
}

export function MobileSectionFab({
  items,
  activeHash,
  state,
  hidden = false,
  onNavigate,
}: {
  items: readonly MobileSectionFabItem[];
  activeHash: string;
  state: MobileSectionFabState;
  hidden?: boolean;
  onNavigate: (href: MobileSectionFabItem["href"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelId = "mobile-section-fab-menu";
  const labelId = "mobile-section-fab-label";
  const activeItem = items.find((item) => item.href === activeHash) ?? items[0];
  const ActiveIcon = activeItem.icon;
  const activeItemLabel = mobileSectionItemLabel(activeItem);

  const closeMenu = useCallback((options: { restoreFocus?: boolean } = {}) => {
    setOpen(false);
    if (options.restoreFocus ?? true) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }, []);
  const dismissMobileSectionMenu = useCallback(() => closeMenu(), [closeMenu]);

  useDismissableLayer({
    enabled: open,
    refs: [buttonRef, panelRef],
    restoreFocusRef: buttonRef,
    onDismiss: dismissMobileSectionMenu,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileSectionFabMediaQuery);
    const syncActivation = () => {
      const matches = mediaQuery.matches;
      setActive(matches);
      if (!matches) closeMenu({ restoreFocus: false });
    };

    const frame = window.requestAnimationFrame(syncActivation);
    mediaQuery.addEventListener("change", syncActivation);
    return () => {
      window.cancelAnimationFrame(frame);
      mediaQuery.removeEventListener("change", syncActivation);
    };
  }, [closeMenu]);

  useEffect(() => {
    if (!open) return;
    const closeForRouteChange = () => closeMenu({ restoreFocus: false });
    window.addEventListener("hashchange", closeForRouteChange);
    return () => window.removeEventListener("hashchange", closeForRouteChange);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!hidden) return;
    const frame = window.requestAnimationFrame(() => closeMenu({ restoreFocus: false }));
    return () => window.cancelAnimationFrame(frame);
  }, [closeMenu, hidden]);

  if (hidden || !active) return null;

  return (
    <div data-testid="mobile-section-fab">
      {open ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-transparent"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeMenu();
          }}
        />
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        data-testid="mobile-section-fab-button"
        aria-label={open ? "Close answer section menu" : `Open answer section menu, current section ${activeItemLabel}`}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "fixed z-40 grid h-14 w-14 place-items-center rounded-full border border-[color:var(--command)] bg-[color:var(--command)] text-[color:var(--command-contrast)] shadow-[var(--shadow-elevated)] transition motion-safe:duration-[var(--duration-quick)] hover:-translate-y-0.5 hover:bg-[color:var(--command-hover)] active:translate-y-px",
          "right-[max(0.75rem,var(--safe-area-right))] bottom-[max(0.75rem,var(--safe-area-bottom))]",
          open && "bg-[color:var(--command-hover)]",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X aria-hidden="true" className="h-6 w-6" /> : <ActiveIcon aria-hidden="true" className="h-6 w-6" />}
        {(state.badgeLabel ?? (activeItem.count !== null ? String(activeItem.count) : null)) ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-0 top-0 grid min-h-5 min-w-5 translate-x-1/4 -translate-y-1/4 place-items-center rounded-full border px-1 text-2xs font-bold leading-4 shadow-[var(--e1)]",
              fabToneClassName(state.badgeTone),
            )}
          >
            {state.badgeLabel ?? activeItem.count}
          </span>
        ) : null}
      </button>

      <section
        ref={panelRef}
        id={panelId}
        data-testid="mobile-section-fab-menu"
        role="region"
        aria-labelledby={labelId}
        aria-hidden={!open}
        inert={!open}
        hidden={!open}
        className="fixed z-40 overflow-hidden rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] text-[color:var(--text)] shadow-[var(--shadow-lux)] backdrop-blur-md right-[max(0.75rem,var(--safe-area-right))] bottom-[calc(max(0.75rem,var(--safe-area-bottom))+4.5rem)] max-h-[min(25rem,calc(100dvh-7rem))] w-[min(20rem,calc(100vw-1.5rem))]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2.5 shadow-[var(--shadow-inset)]">
          <span
            aria-hidden="true"
            className="mx-auto mb-2 block h-1 w-9 rounded-full bg-[color:var(--border-strong)]/70"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="min-w-0">
              <p id={labelId} className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                Answer navigator
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[color:var(--text-heading)]">
                Current: {activeItem.label}
              </p>
            </div>
            <span
              data-testid="mobile-section-fab-status"
              className={cn("rounded-full border px-2 py-1 text-2xs font-bold", fabToneClassName(state.statusTone))}
            >
              {state.statusLabel}
            </span>
          </div>
          <p
            data-testid="mobile-section-fab-next-step"
            className="mt-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1.5 text-xs font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]"
          >
            {state.nextStep}
          </p>
        </div>

        <div className="polished-scroll grid max-h-[min(17rem,calc(100dvh-14rem))] gap-1 overflow-y-auto overscroll-contain p-2">
          {items.map((item) => {
            const Icon = item.icon;
            const active = activeHash === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                aria-label={mobileSectionItemLabel(item)}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.href);
                  closeMenu();
                }}
                className={cn(
                  "relative grid min-h-[58px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-transparent py-1.5 pl-3 pr-2 text-sm font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
                  item.empty && !active && "opacity-75",
                  active &&
                    "border-[color:var(--clinical-accent)]/25 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute bottom-2 left-1 top-2 w-1 rounded-full bg-transparent",
                    active && "bg-[color:var(--clinical-accent)]",
                  )}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]",
                    item.empty && !active && "bg-[color:var(--surface-subtle)]",
                    active &&
                      "border-[color:var(--clinical-accent)]/25 bg-[color:var(--surface)] text-[color:var(--clinical-accent)]",
                  )}
                >
                  <Icon aria-hidden="true" className="size-icon-lg" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  <span className="mt-0.5 block truncate text-2xs font-semibold text-[color:var(--text-muted)]">
                    {item.description}
                  </span>
                </span>
                {item.count !== null ? (
                  <span
                    className={cn(
                      "min-w-6 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-1.5 text-center text-2xs font-bold leading-5 text-[color:var(--text)] shadow-[var(--shadow-inset)]",
                      item.empty && "text-[color:var(--text-muted)]",
                      active &&
                        "border-[color:var(--clinical-accent)]/20 bg-[color:var(--surface)] text-[color:var(--clinical-accent)]",
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
