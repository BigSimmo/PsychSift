"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Info, Pin, PinOff, Search, ShieldCheck, Waves, type LucideIcon } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useFavouritesAccess } from "@/components/clinical-dashboard/use-favourites-access";
import { useSearchCommand } from "@/components/clinical-dashboard/search-command-context";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { SearchResultsHeaderBand } from "@/components/clinical-dashboard/search-results-header-band";
import { ToolLocalSearch } from "@/components/tools/tool-local-search";
import { useToolPins } from "@/components/tools/use-tool-pins";
import { focusRing, stretchedRowLinkClass } from "@/components/card-recipes";
import { CategoryIconTile } from "@/components/category-icon-tile";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { modeHomeComposerReservePendingValue } from "@/lib/mode-home-composer";
import { cn, controlBase, floatingControl } from "@/components/ui-primitives";
import { pageHeadingDescriptionClass, pageHeadingTitleClass } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { TOOL_AREA_ACCENT, toolIdentity } from "@/lib/category-identity";
import { isLocalNoAuthMode, resolveClientDemoMode } from "@/lib/client-env";
import { interpretSmartSearch, smartSearchExpansions } from "@/lib/smart-search-intent";
import { useAuthSession } from "@/lib/supabase/client";
import {
  rankToolRecords,
  localSmartExcludedToolIds,
  toolCatalogRecordsForSession,
  type ToolCatalogRecord,
} from "@/lib/tools-catalog";
import {
  groupToolsForPage,
  toolLaunchNoteById,
  toolPageGroupById,
  withMedicineMatch,
  type ToolPageGroup,
} from "@/lib/tools-page-layout";

/**
 * The Tools page, arranged as a task launcher.
 *
 * It replaced a list of fifteen identical cards, each carrying a black Open button,
 * a Details button and near-universal "Source-backed" and "High yield" chips. That
 * layout gave nothing any weight, hid "Check first" behind a collapsed accordion in
 * a side panel, and let a category filter hide the safety tools. Now:
 *
 * - the whole row opens the tool, and the one secondary control is the "About"
 *   button, which opens everything the tool needs in a sheet, expanded;
 * - tools are grouped by the job being done (`tools-page-layout.ts`), with the
 *   safety tools in their own band ahead of the rest;
 * - an entry that is really a shortcut into Ask or Documents says so on the row;
 * - a pinned row, remembered per browser, replaces the fixed shortcut tiles.
 */

type AboutTool = (tool: ToolCatalogRecord, opener: HTMLElement) => void;

function subscribeNoop() {
  return () => undefined;
}

function ToolIcon({ tool, large = false }: { tool: ToolCatalogRecord; large?: boolean }) {
  const identity = toolIdentity(tool.id, tool.area);
  return <CategoryIconTile icon={identity.icon} accent={identity.accent} size={large ? "md" : "sm"} />;
}

function ToolRow({
  tool,
  onAbout,
  tone = "default",
}: {
  tool: ToolCatalogRecord;
  onAbout: AboutTool;
  tone?: "default" | "safety";
}) {
  const note = toolLaunchNoteById[tool.id];
  return (
    <li
      data-testid={`tool-row-${tool.id}`}
      className={cn(
        "relative flex min-h-16 min-w-0 items-center gap-3 py-2.5 pl-3.5 pr-1",
        "sm:rounded-xl sm:border sm:bg-[color:var(--surface-raised)] sm:shadow-[var(--e1)] sm:hover:border-[color:var(--clinical-accent-border)]",
        tone === "safety" ? "sm:border-[color:var(--warning-border)]" : "sm:border-[color:var(--border)]",
      )}
    >
      <ToolIcon tool={tool} />
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold leading-5 text-[color:var(--text-heading)]">
          <Link
            href={tool.href}
            target={tool.external ? "_blank" : undefined}
            rel={tool.external ? "noreferrer" : undefined}
            className={cn(
              "rounded-sm",
              focusRing,
              // The whole row opens the tool. Not for an external tool: the row gives
              // no hint that a tap would leave the app, so the title stays the only way.
              !tool.external && stretchedRowLinkClass,
            )}
          >
            {tool.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm leading-5 text-[color:var(--text-muted)]">{tool.description}</p>
        {note ? <p className="mt-1 text-xs font-semibold leading-4 text-[color:var(--text-muted)]">{note}</p> : null}
      </div>
      <button
        type="button"
        aria-label={`About ${tool.title}`}
        onClick={(event) => onAbout(tool, event.currentTarget)}
        className={cn(
          "relative z-10 grid h-tap w-tap shrink-0 place-items-center rounded-full transition hover:bg-[color:var(--surface-subtle)]",
          tone === "safety" ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
          focusRing,
        )}
      >
        <Info className="size-icon-lg" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * One joined list on a phone, separate cards from `sm` up. The row carries its own
 * card styling for the wider layout, so the list only swaps between the two.
 */
const toolListClass =
  "grid divide-y overflow-hidden rounded-2xl border sm:grid-cols-2 sm:gap-3 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent lg:grid-cols-3";

function ToolGroupSection({
  group,
  tools,
  onAbout,
}: {
  group: ToolPageGroup;
  tools: ToolCatalogRecord[];
  onAbout: AboutTool;
}) {
  const headingId = `tools-group-${group.id}`;
  return (
    <section aria-labelledby={headingId} data-testid={`tools-group-${group.id}`} className="grid gap-2">
      <h2 id={headingId} className="flex items-center gap-2 px-1 text-base font-bold text-[color:var(--text-heading)]">
        {group.accentArea ? (
          <span
            aria-hidden="true"
            data-category-accent={TOOL_AREA_ACCENT[group.accentArea]}
            className="h-2.5 w-2.5 rounded-sm bg-[color:var(--cat-accent)] forced-colors:bg-[CanvasText]"
          />
        ) : null}
        {group.label}
      </h2>
      <ul
        className={cn(
          toolListClass,
          "divide-[color:var(--border)] border-[color:var(--border)] bg-[color:var(--surface-raised)]",
        )}
      >
        {tools.map((tool) => (
          <ToolRow key={tool.id} tool={tool} onAbout={onAbout} />
        ))}
      </ul>
    </section>
  );
}

function SafetySection({ tools, onAbout }: { tools: ToolCatalogRecord[]; onAbout: AboutTool }) {
  return (
    <section
      aria-labelledby="tools-group-safety"
      data-testid="tools-group-safety"
      className="grid gap-2 rounded-2xl border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] p-2 sm:p-4"
    >
      <h2
        id="tools-group-safety"
        className="flex items-center gap-2 px-1.5 pt-1 text-base font-bold text-[color:var(--warning-text)]"
      >
        <ShieldCheck className="size-icon-md" aria-hidden="true" />
        Safety
      </h2>
      <ul
        className={cn(
          toolListClass,
          "divide-[color:var(--warning-border)] border-[color:var(--warning-border)] bg-[color:var(--surface-raised)] lg:grid-cols-2",
        )}
      >
        {tools.map((tool) => (
          <ToolRow key={tool.id} tool={tool} onAbout={onAbout} tone="safety" />
        ))}
      </ul>
    </section>
  );
}

function PinnedTools({ tools }: { tools: ToolCatalogRecord[] }) {
  return (
    <section aria-labelledby="tools-pinned-heading" data-testid="tools-pinned" className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2
          id="tools-pinned-heading"
          className="text-xs font-bold uppercase tracking-wider text-[color:var(--text-muted)]"
        >
          Pinned
        </h2>
        <p className="text-xs text-[color:var(--text-muted)]">Pin or unpin from a tool&apos;s About button</p>
      </div>
      {tools.length ? (
        <ul className="grid grid-cols-4 gap-2 sm:gap-3">
          {tools.map((tool) => (
            <li key={tool.id} className="min-w-0">
              <Link
                href={tool.href}
                target={tool.external ? "_blank" : undefined}
                rel={tool.external ? "noreferrer" : undefined}
                data-testid={`tool-pin-${tool.id}`}
                className={cn(
                  "flex h-full min-h-tap flex-col items-center gap-1.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-1 py-3 text-center shadow-[var(--e1)] transition hover:border-[color:var(--clinical-accent-border)]",
                  "sm:flex-row sm:gap-3 sm:px-3 sm:text-left",
                  focusRing,
                )}
              >
                <ToolIcon tool={tool} />
                <span className="text-2xs font-semibold leading-tight text-[color:var(--text-heading)] [overflow-wrap:anywhere] sm:text-sm">
                  <span className="sm:hidden">{tool.mobileTitle ?? tool.title}</span>
                  <span className="hidden sm:inline">{tool.title}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-[color:var(--border-strong)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
          Nothing pinned. Open a tool&apos;s About button and choose Pin to keep it here.
        </p>
      )}
    </section>
  );
}

function DetailBlock({
  icon: Icon,
  label,
  tone = "default",
  children,
}: {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "safety";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid gap-2 rounded-xl border px-4 py-3",
        tone === "safety"
          ? "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-subtle)]",
      )}
    >
      <h3
        className={cn(
          "flex items-center gap-2 text-xs font-bold uppercase tracking-wider",
          tone === "safety" ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
        )}
      >
        <Icon className="size-icon-sm" aria-hidden="true" />
        {label}
      </h3>
      <div className="text-sm leading-6 text-[color:var(--text)]">{children}</div>
    </section>
  );
}

function ToolDetail({ tool }: { tool: ToolCatalogRecord }) {
  const note = toolLaunchNoteById[tool.id];
  return (
    <div className="grid gap-3">
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">{tool.detail}</p>
      {note ? <p className="text-xs font-semibold text-[color:var(--text-muted)]">{note}</p> : null}
      <DetailBlock icon={ShieldCheck} label="Check first" tone="safety">
        <ul className="list-disc space-y-1 pl-4">
          {tool.checkFirst.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </DetailBlock>
      <DetailBlock icon={ClipboardList} label="You will need">
        <ul className="list-disc space-y-1 pl-4">
          {tool.neededInput.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </DetailBlock>
      <DetailBlock icon={Waves} label="You will get">
        <p>{tool.output}</p>
      </DetailBlock>
    </div>
  );
}

function ToolDetailActions({
  tool,
  pinned,
  onTogglePin,
}: {
  tool: ToolCatalogRecord;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <Link
        href={tool.href}
        target={tool.external ? "_blank" : undefined}
        rel={tool.external ? "noreferrer" : undefined}
        className={cn(
          controlBase,
          "min-h-12 w-full rounded-xl bg-[color:var(--clinical-accent)] px-4 font-bold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--clinical-accent-hover)]",
        )}
      >
        Open {tool.title}
      </Link>
      <button
        type="button"
        aria-pressed={pinned}
        onClick={onTogglePin}
        className={cn(floatingControl, "min-h-12 gap-2 px-4")}
      >
        <PinIcon className="size-icon-md" aria-hidden="true" />
        {pinned ? "Unpin" : "Pin"}
      </button>
    </div>
  );
}

export function ToolsSearchResultsPage({
  initialQuery = "",
  desktopComposerSlotId,
  canAccessFavourites: canAccessFavouritesProp,
  testId = "tools-search-results-page",
}: {
  initialQuery?: string;
  desktopComposerSlotId?: string;
  /** Optional deterministic override; defaults to the current auth/demo session gate. */
  canAccessFavourites?: boolean;
  testId?: string;
}) {
  const auth = useAuthSession();
  const clientDemoMode = resolveClientDemoMode({
    explicitDemoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
    authUnavailableFallback: !auth.isConfigured,
    localNoAuthMode: isLocalNoAuthMode(),
  });
  const { favouritesAccessible } = useFavouritesAccess(auth.status === "authenticated", clientDemoMode);
  const canAccessFavourites = canAccessFavouritesProp ?? favouritesAccessible;
  const searchCommand = useSearchCommand();
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const router = useRouter();
  const { pinnedToolIds, togglePinnedTool } = useToolPins();
  // A draft typed into this page's own search box wins over everything else. Below
  // that: the route's submitted query so hard loads server-render the exact result
  // set, and after hydration the shared command draft, including an intentionally
  // cleared value, until the next submitted navigation.
  const [localQuery, setLocalQuery] = useState<string | null>(null);
  const query = localQuery ?? (hydrated ? (searchCommand?.query ?? initialQuery) : initialQuery);
  const searching = query.trim().length > 0;
  // The sheet keeps its last tool after closing so the close animation has content.
  const [aboutToolId, setAboutToolId] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutReturnFocusRef = useRef<HTMLElement | null>(null);

  const accessibleTools = useMemo(
    () => toolCatalogRecordsForSession({ authenticated: canAccessFavourites, demoMode: false }),
    [canAccessFavourites],
  );
  const naturalSmartSearch = useMemo(() => interpretSmartSearch("tools", query).naturalLanguage, [query]);
  const smartExpansions = useMemo(() => smartSearchExpansions("tools", query), [query]);

  const matchedTools = useMemo(
    () =>
      searching
        ? withMedicineMatch(
            rankToolRecords(query, undefined, smartExpansions, { authenticated: canAccessFavourites, demoMode: false })
              .map((match) => match.tool)
              .filter((tool) => !naturalSmartSearch || !localSmartExcludedToolIds.has(tool.id)),
            query,
            accessibleTools,
          )
        : accessibleTools,
    [accessibleTools, canAccessFavourites, naturalSmartSearch, query, searching, smartExpansions],
  );

  const groups = useMemo(() => groupToolsForPage(accessibleTools), [accessibleTools]);
  const safetyTools = groups.find((entry) => entry.group.id === "safety")?.tools ?? [];
  const otherGroups = groups.filter((entry) => entry.group.id !== "safety");
  // Pins resolve against the session's tools, so a guest never sees a Saved workflows pin.
  const pinnedTools = pinnedToolIds
    .map((id) => accessibleTools.find((tool) => tool.id === id))
    .filter((tool): tool is ToolCatalogRecord => Boolean(tool));
  const aboutTool = accessibleTools.find((tool) => tool.id === aboutToolId) ?? null;

  function openAbout(tool: ToolCatalogRecord, opener: HTMLElement) {
    aboutReturnFocusRef.current = opener;
    setAboutToolId(tool.id);
    setAboutOpen(true);
  }

  // Submitting is a navigation, not a local state change, so the result set is
  // shareable and survives reload. An empty box has nothing to submit.
  function submitLocalSearch() {
    const submittedQuery = query.trim();
    if (submittedQuery) router.push(`/tools?q=${encodeURIComponent(submittedQuery)}&run=1`);
  }

  return (
    <main
      data-testid={testId}
      className="mx-auto w-full max-w-[90rem] overflow-x-clip px-4 pb-12 pt-4 text-[color:var(--text)] sm:px-6 sm:pt-6 lg:px-8 lg:pt-8"
    >
      {desktopComposerSlotId ? (
        <DesktopComposerPortalSlot
          id={desktopComposerSlotId}
          data-testid="tools-results-home-composer"
          data-composer-reserve={modeHomeComposerReservePendingValue}
          className="mode-home-composer-slot mx-auto mb-4 block w-full max-w-3xl min-h-0 data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-phone)] sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] [&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-phone)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)] sm:mb-6"
        />
      ) : null}
      <div className="mx-auto grid max-w-6xl gap-6">
        {searching ? null : (
          <header className="grid gap-1.5 px-1">
            <h1 className={pageHeadingTitleClass}>Tools</h1>
            <p className={pageHeadingDescriptionClass}>Grouped by the job you are doing. Tap a tool to open it.</p>
          </header>
        )}
        <ToolLocalSearch value={query} onChange={setLocalQuery} onSubmit={submitLocalSearch} className="w-full" />

        {searching ? (
          <>
            {/* Safety stays one tap away while searching, whatever the query matched. */}
            <nav
              aria-label="Safety tools"
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-3 py-2"
            >
              <span className="text-xs font-bold text-[color:var(--warning-text)]">Safety</span>
              {safetyTools.map((tool) => (
                <Link
                  key={tool.id}
                  href={tool.href}
                  className={cn(
                    "inline-flex min-h-tap items-center rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--surface-raised)] px-3 text-sm font-semibold text-[color:var(--warning-text)]",
                    focusRing,
                  )}
                >
                  {tool.title}
                </Link>
              ))}
            </nav>
            <div className="grid gap-3">
              <SearchResultsHeaderBand
                modeId="tools"
                query={query.trim()}
                matchCount={matchedTools.length}
                headingLevel={1}
              />
              {matchedTools.length ? (
                <section aria-label="Tool results">
                  <ul
                    className={cn(
                      toolListClass,
                      "divide-[color:var(--border)] border-[color:var(--border)] bg-[color:var(--surface-raised)]",
                    )}
                  >
                    {matchedTools.map((tool) => (
                      <ToolRow
                        key={tool.id}
                        tool={tool}
                        onAbout={openAbout}
                        tone={toolPageGroupById[tool.id] === "safety" ? "safety" : "default"}
                      />
                    ))}
                  </ul>
                </section>
              ) : (
                <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-lux)] px-4 py-10 text-center">
                  <Search className="h-7 w-7 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                  <h2 className="text-base font-extrabold text-[color:var(--text-heading)]">No tools match</h2>
                  <p className="max-w-md text-sm text-[color:var(--text-muted)]">
                    Try another search, or search the rest of PsychSift below.
                  </p>
                  <Link href="/tools" className={floatingControl}>
                    Show all tools
                  </Link>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <PinnedTools tools={pinnedTools} />
            {safetyTools.length ? <SafetySection tools={safetyTools} onAbout={openAbout} /> : null}
            {otherGroups.map(({ group, tools }) => (
              <ToolGroupSection key={group.id} group={group} tools={tools} onAbout={openAbout} />
            ))}
          </>
        )}
        <UniversalSearchAlsoMatches modeId="tools" query={query} />
      </div>

      {aboutTool ? (
        <Sheet
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          title={aboutTool.title}
          closeLabel={`Close ${aboutTool.title}`}
          headerLeading={<ToolIcon tool={aboutTool} large />}
          titleClassName="text-xl font-extrabold"
          contentClassName="sm:max-w-[36rem]"
          bodyClassName="grid gap-4"
          portal={false}
          returnFocusRef={aboutReturnFocusRef}
          testId="tools-search-detail-sheet"
          footer={
            <ToolDetailActions
              tool={aboutTool}
              pinned={pinnedToolIds.includes(aboutTool.id)}
              onTogglePin={() => togglePinnedTool(aboutTool.id)}
            />
          }
        >
          <ToolDetail tool={aboutTool} />
        </Sheet>
      ) : null}
    </main>
  );
}
