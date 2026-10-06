"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Grid2X2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";

import { cardInteractive, cardSelected, cardSelectedDanger, focusRing } from "@/components/card-recipes";
import { CategoryIconTile } from "@/components/category-icon-tile";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { ModeHomeHero } from "@/components/mode-home-template";
import { ShowAllChip } from "@/components/show-all-chip";
import { SearchResultsHeaderBand } from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { useSearchCommand } from "@/components/clinical-dashboard/search-command-context";
import { useFavouritesAccess } from "@/components/clinical-dashboard/use-favourites-access";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, EmptyState, eyebrowText, searchShellInput } from "@/components/ui-primitives";
import { Chip, type ChipStatusTone } from "@/components/ui/chip";
import { Sheet } from "@/components/ui/sheet";
import { toolIdentity } from "@/lib/category-identity";
import { categoryGlyph } from "@/lib/category-identity-icons";
import { isLocalNoAuthMode, resolveClientDemoMode } from "@/lib/client-env";
import { modeHomeComposerReservePendingValue } from "@/lib/mode-home-composer";
import { interpretSmartSearch, smartSearchExpansions } from "@/lib/smart-search-intent";
import { useAuthSession } from "@/lib/supabase/client";
import {
  rankToolRecords,
  toolCatalogRecordsForSession,
  type ToolCatalogArea,
  type ToolCatalogId,
  type ToolCatalogRecord,
  type ToolCatalogStatus,
} from "@/lib/tools-catalog";

type LauncherStatus = ToolCatalogStatus;
type LauncherArea = ToolCatalogArea;
type LauncherFilter = "all" | LauncherArea | "more";

// The catalogue record is the whole app: identity is looked up from the record's
// `id` and `area` rather than carried as an extra field, so a launcher app and a
// search-results tool cannot disagree about their own glyph.
type LauncherApp = ToolCatalogRecord;

function launcherAppMatchesFilter(app: LauncherApp, filter: LauncherFilter): boolean {
  if (filter === "all") return true;
  if (filter === "more") return app.area === "coordination" || app.area === "saved";
  return app.area === filter;
}

const statusLabels: Record<LauncherStatus, string> = {
  ready: "Ready",
  recent: "Recent",
  review_due: "Review due",
};

// Glyph and accent both come from `src/lib/category-identity.ts` now. Two maps
// used to live here — a 14-entry `launcherIconById` and an `iconToneClasses`
// keyed by a union of areas *and* three ad-hoc tool ids, reconciled by an
// `appIconTone` function that overrode the area for `differentials`, `forms` and
// `medication-prescribing`. The tools *search results* page carried its own
// 8-entry copy with a different fallback, so five tools showed one glyph on the
// launcher and a generic grid glyph in results, and every results tile was
// painted the same purple regardless of area. Both surfaces now read the one
// registry, so a tool looks like itself wherever it is reached, rather than
// through a local map.
function launcherAppsForSession(canAccessFavourites: boolean): LauncherApp[] {
  return toolCatalogRecordsForSession({
    authenticated: canAccessFavourites,
    demoMode: false,
  });
}

const toolsLauncherCopy = {
  heading: "Tools",
  description: "Assessment, prescribing, workflows.",
  showAllLabel: "Show all",
  allSectionLabel: "All tools",
  countNoun: "tools",
  emptyTitle: "No tools match",
  emptyBody: "Clear the search or try another clinical workflow, tool name, or category.",
  searchAriaLabel: "Search tools",
  searchPlaceholder: "Search tools…",
  openSelectedAriaLabel: "Open selected tool",
};

// A third copy of the same id→glyph decision used to live here, so a quick
// action could drift from the card it opens. Only the wording is local now.
const quickActionsBase = [
  { label: "Ask", desktopLabel: "Ask evidence", id: "clinical-kb-search" },
  { label: "Compare", desktopLabel: "Compare", id: "differentials" },
  { label: "Prescribe", desktopLabel: "Prescribe", id: "medication-prescribing" },
  { label: "Safety", desktopLabel: "Safety check", id: "risk-safety" },
  { label: "Docs", desktopLabel: "Documents", id: "documents" },
  { label: "Refer", desktopLabel: "Refer", id: "services" },
  { label: "Forms", desktopLabel: "Forms", id: "forms" },
  { label: "Saved", desktopLabel: "Favourites", id: "favourites" },
] as const satisfies ReadonlyArray<{ label: string; desktopLabel: string; id: ToolCatalogId }>;

const localSmartExcludedToolIds = new Set<ToolCatalogId>(["clinical-kb-search", "documents", "favourites"]);

const desktopFiltersBase: Array<{ id: LauncherFilter; label: string }> = [
  { id: "all", label: "All tools" },
  { id: "assessment", label: "Assess" },
  { id: "reference", label: "Evidence" },
  { id: "care", label: "Treat" },
  { id: "coordination", label: "Coordinate" },
  { id: "saved", label: "Saved" },
];

const mobileFilters: Array<{ id: LauncherFilter; label: string }> = [
  { id: "all", label: "All tools" },
  { id: "assessment", label: "Assess" },
  { id: "reference", label: "Evidence" },
  { id: "care", label: "Treat" },
  { id: "more", label: "More" },
];

function appById(id: ToolCatalogId, apps: LauncherApp[]) {
  return apps.find((app) => app.id === id) ?? apps[0];
}

function quickActionsForSession(canAccessFavourites: boolean, naturalSmartSearch: boolean) {
  return quickActionsBase.filter(
    (action) =>
      (canAccessFavourites || action.id !== "favourites") &&
      (!naturalSmartSearch || !localSmartExcludedToolIds.has(action.id)),
  );
}

function desktopFiltersForSession(canAccessFavourites: boolean) {
  return canAccessFavourites ? desktopFiltersBase : desktopFiltersBase.filter((filter) => filter.id !== "saved");
}

/**
 * Tool identity tile. Colour groups the family (five accents, matching the five
 * filter chips a clinician can actually apply); the glyph distinguishes the
 * individual tool.
 *
 * `risk-safety` no longer gets a permanent danger-red tile. Red here asserted
 * caution about a *route*, not about a patient, and it spent the loudest colour
 * in the system on a navigation target — the same category error the factsheet
 * accents make. Safety is carried by the shield glyph, which is now unique to
 * it, and by the danger-toned selected state, which is a real state.
 */
function ToolIcon({ app, size = "md" }: { app: LauncherApp; size?: "sm" | "md" }) {
  const identity = toolIdentity(app.id, app.area);
  return <CategoryIconTile icon={identity.icon} accent={identity.accent} size={size} />;
}

// Launcher status vocabulary mapped onto the design-system `Chip`. The tone and
// icon choices are the launcher's; the chip geometry, tone palette, and truncation
// are the design system's, so this no longer carries a second copy of the recipe.
type StatusChipTone = "neutral" | "source" | "safety" | "high";

const statusChipTone: Record<StatusChipTone, ChipStatusTone> = {
  neutral: "neutral",
  source: "success",
  safety: "warning",
  high: "info",
};

// `source` used ShieldCheck too, so one card could show the same shield three
// times over — on the "Source-backed" chip, on the Guidelines tile, and on the
// Risk & safety tile — for three unrelated meanings. Source-backed is a
// verification claim, so it takes the verification glyph; the shield is safety.
const statusChipIcon: Partial<Record<StatusChipTone, LucideIcon>> = {
  source: BadgeCheck,
  safety: Sparkles,
};

function StatusChip({ label, tone = "neutral" }: { label: string; tone?: StatusChipTone }) {
  return (
    <Chip appearance={{ kind: "status", tone: statusChipTone[tone] }} icon={statusChipIcon[tone]}>
      {label}
    </Chip>
  );
}

function ToolSearch({
  value,
  onChange,
  onSubmit,
  copy,
  className,
}: {
  value: string;
  onChange: (query: string) => void;
  onSubmit: () => void;
  copy: typeof toolsLauncherCopy;
  className?: string;
}) {
  return (
    <form
      role="search"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
      className={cn(
        // Both end tracks hold tap-sized children and the row has no gap, so they
        // read the tap knob rather than a copy of its value — a literal here
        // overlaps the input (or undersizes the submit control) the moment
        // `--spacing-tap` moves.
        "search-shell grid min-h-13 grid-cols-[var(--spacing-tap)_minmax(0,1fr)_var(--spacing-tap)] items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-lux)] text-left shadow-[var(--e2)]",
        className,
      )}
    >
      <span className="grid h-tap w-tap place-items-center rounded-full text-[color:var(--clinical-accent)]">
        <Plus className="size-icon-lg" aria-hidden />
      </span>
      <label className="min-w-0">
        <span className="sr-only">{copy.searchAriaLabel}</span>
        <input
          data-testid="tools-local-search-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={copy.searchPlaceholder}
          className={cn(
            searchShellInput,
            "w-full text-sm font-medium text-[color:var(--text)] placeholder:text-[color:var(--text-placeholder)]",
          )}
        />
      </label>
      <button
        type="submit"
        aria-label={copy.openSelectedAriaLabel}
        data-testid="tools-local-search-submit"
        className={cn(
          "grid h-tap w-tap place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--clinical-accent-hover)]",
          focusRing,
        )}
      >
        <Search className="size-icon-lg" aria-hidden />
      </button>
    </form>
  );
}

function ToolChips({ app, includeStatus = false }: { app: LauncherApp; includeStatus?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {includeStatus ? <StatusChip label={statusLabels[app.status]} /> : null}
      {app.sourceBacked ? <StatusChip label="Source-backed" tone="source" /> : <StatusChip label="Private" />}
      {app.safetyFirst ? (
        <StatusChip label="Safety-first" tone="safety" />
      ) : app.highYield ? (
        <StatusChip label="High yield" tone="high" />
      ) : null}
    </span>
  );
}

function QuickActions({
  onSelect,
  mobile,
  apps,
  canAccessFavourites,
  naturalSmartSearch,
}: {
  onSelect: (id: ToolCatalogId) => void;
  mobile?: boolean;
  apps: LauncherApp[];
  canAccessFavourites: boolean;
  naturalSmartSearch: boolean;
}) {
  const quickActions = quickActionsForSession(canAccessFavourites, naturalSmartSearch);
  return (
    <section
      aria-label="Quick tool shortcuts"
      className={cn(mobile ? "grid grid-cols-4 gap-2" : "grid w-full grid-cols-2 gap-3 md:grid-cols-3")}
    >
      {quickActions.slice(0, mobile ? 8 : 6).map((action) => {
        const app = appById(action.id, apps);
        const identity = toolIdentity(app.id, app.area);
        return (
          <button
            key={action.label}
            type="button"
            aria-label={`Open ${action.desktopLabel}`}
            data-testid={`tool-shortcut-${action.id}`}
            onClick={() => onSelect(action.id)}
            className={cn(
              "group border border-[color:var(--border)] bg-[color:var(--surface-lux)] text-left shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-raised)]",
              focusRing,
              mobile
                ? "grid h-14 min-w-0 place-items-center gap-0.5 rounded-lg px-1 py-1.5 text-center"
                : "grid min-h-14 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 py-2.5",
            )}
          >
            <span
              data-category-accent={identity.accent}
              className={cn(
                "grid place-items-center rounded-lg border border-[color:var(--cat-border)] bg-[color:var(--cat-soft)] text-[color:var(--cat-accent)] shadow-[var(--shadow-inset)] forced-colors:border",
                mobile ? "h-7 w-7" : "h-8 w-8",
              )}
            >
              {categoryGlyph(identity.icon, mobile ? "size-icon-md" : "size-icon-lg")}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate font-bold leading-tight text-[color:var(--text-heading)]",
                  mobile ? "text-2xs" : "text-sm",
                )}
              >
                {mobile ? action.label : action.desktopLabel}
              </span>
              {!mobile ? (
                <span className="mt-0.5 block text-xs font-medium leading-4 text-[color:var(--text-muted)] [overflow-wrap:anywhere]">
                  {app.bestFor}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}

/**
 * Renders responsive tabs for selecting a tool category.
 *
 * @param activeFilter - The currently selected tool category.
 * @param onFilterChange - Called with the selected category when a tab is activated.
 */
function FilterTabs({
  activeFilter,
  onFilterChange,
  canAccessFavourites,
  filterCounts,
}: {
  activeFilter: LauncherFilter;
  onFilterChange: (filter: LauncherFilter) => void;
  canAccessFavourites: boolean;
  filterCounts: Readonly<Record<string, number>>;
}) {
  const desktopFilters = desktopFiltersForSession(canAccessFavourites);
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  // `more` is the desktop "All" tab's overflow state, not a category of its own.
  const resolvedFilter: LauncherFilter = activeFilter === "more" ? "all" : activeFilter;
  // One array for the desktop rail and the phone sheet. The categories partition
  // the tool list, so this is a lens at both breakpoints — the rail used to say
  // many-of-N with `aria-pressed` while the sheet said one-of-N.
  const launcherFilterOptions = desktopFilters.map((filter) => ({
    value: filter.id,
    label: filter.label,
    hint: String(filterCounts[filter.id] ?? 0),
  }));
  return (
    <>
      <div className="hidden sm:block">
        <SegmentedControl
          value={resolvedFilter}
          onChange={onFilterChange}
          options={launcherFilterOptions}
          label="Filter by tool category"
          ariaControls="launcher-results-panel"
        />
      </div>
      {/* The phone half of the same control. This launcher renders no results
          band, so the trigger sits inline here rather than in a ribbon slot —
          but it is the same trigger and the same sheet every search mode now
          uses, which is the point. */}
      <div className="sm:hidden">
        <ResultFilterTrigger
          panelId={filterPanelId}
          testId="tool-filter-trigger-phone"
          title="Filter by tool category"
          open={filterOpen}
          activeCount={resolvedFilter === "all" ? 0 : 1}
          onToggle={() => setFilterOpen((current) => !current)}
        />
        <ResultFilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          panelId={filterPanelId}
          testId="tool-filter-panel"
          title="Filter tools"
          groups={[
            resultFilterGroup({
              id: "category",
              label: "Category",
              value: resolvedFilter,
              options: launcherFilterOptions,
              onChange: (value) => {
                setFilterOpen(false);
                onFilterChange(value);
              },
            }),
          ]}
          onClearAll={
            resolvedFilter === "all"
              ? undefined
              : () => {
                  setFilterOpen(false);
                  onFilterChange("all");
                }
          }
          summary={{
            count: filterCounts[resolvedFilter] ?? 0,
            noun: (filterCounts[resolvedFilter] ?? 0) === 1 ? "tool" : "tools",
          }}
        />
      </div>
    </>
  );
}

/**
 * One tool card at two densities.
 *
 * `ToolCard` and `MobileToolRow` used to be separate components rendering the
 * same content, and they had already drifted: different resting elevation
 * (`--shadow-card` against `--shadow-inset`), different selected tint (`/50`
 * against `/55`), and a hover lift on one but not the other. They keep their
 * two test ids — `ui-smoke` and `ui-tools` target both, and `ui-smoke` is a
 * blocking suite at zero retries — but there is now one implementation.
 *
 * The `Details` affordance is gone. It was a `<span>` painted as a solid accent
 * button *inside* the card's own `<button>`: it read as a nested control while
 * being announced as nothing, it was the loudest element on the card, and since
 * every card carried an identical one it distinguished nothing. The card is the
 * control; a chevron on the decoration tier says so without competing with the
 * title. It takes the category accent on hover, so the affordance points back at
 * the card's own family rather than at the product blue.
 */
function ToolCard({
  app,
  selected,
  onSelect,
  density = "card",
}: {
  app: LauncherApp;
  selected: boolean;
  onSelect: (id: ToolCatalogId) => void;
  density?: "card" | "row";
}) {
  const identity = toolIdentity(app.id, app.area);
  const row = density === "row";
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`View details for ${app.title}`}
      data-testid={`application-${row ? "row" : "card"}-${app.id}`}
      data-category-accent={identity.accent}
      onClick={() => onSelect(app.id)}
      className={cn(
        cardInteractive,
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] text-left",
        row ? "min-h-tap items-center gap-3 p-3" : "items-start gap-4 p-4",
        // `risk-safety` keeps a danger-toned SELECTED state. Selection is a real
        // state, unlike the permanent red tile this card used to carry, where
        // the loudest colour in the system described a navigation target.
        selected && (app.id === "risk-safety" ? cardSelectedDanger : cardSelected),
      )}
    >
      <ToolIcon app={app} size={row ? "sm" : "md"} />
      <span className="min-w-0">
        {/* Size carries the hierarchy, not weight. `font-extrabold` at
            `text-base` put the card title at the same visual weight as the
            section heading above it, so a grid of cards read as a wall of
            headings. */}
        <span
          className={cn(
            "block font-semibold text-[color:var(--text-heading)]",
            row ? "truncate text-sm leading-5" : "text-lg leading-6",
          )}
        >
          {app.title}
        </span>
        <span
          className={cn(
            "block font-medium text-[color:var(--text-muted)] [overflow-wrap:anywhere]",
            row ? "mt-0.5 text-xs leading-4" : "mt-1 text-sm leading-5",
          )}
        >
          {app.description}
        </span>
        {row ? null : (
          <>
            {/* "Best for:" was a bold inline run inside the body copy, which
                gave a label the same emphasis as the clinical text it labels.
                It is a kicker, so it uses the shared eyebrow recipe. */}
            <span className="mt-3 block">
              <span className={eyebrowText}>Best for</span>
              <span className="mt-0.5 block text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                {app.bestFor}
              </span>
            </span>
            <span className="mt-3 block">
              <ToolChips app={app} />
            </span>
          </>
        )}
      </span>
      <ChevronRight
        className={cn(
          "size-icon-lg shrink-0 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--cat-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0",
          row ? "self-center" : "self-start",
        )}
        aria-hidden
      />
    </button>
  );
}

function MobileToolRow(props: { app: LauncherApp; selected: boolean; onSelect: (id: ToolCatalogId) => void }) {
  return <ToolCard {...props} density="row" />;
}

function DetailSection({
  icon: Icon,
  title,
  children,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] shadow-[var(--shadow-inset)]",
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-extrabold text-[color:var(--text-heading)]">
        <Icon className="size-icon-lg text-[color:var(--clinical-accent)]" aria-hidden />
        {title}
      </div>
      <div className={cn("mt-2 text-sm leading-6 text-[color:var(--text-muted)]", compact && "text-xs leading-5")}>
        {children}
      </div>
    </section>
  );
}

function DetailRows({ app }: { app: LauncherApp }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailSection icon={Search} title="Best for">
        <p>{app.detail}</p>
      </DetailSection>
      <DetailSection icon={ShieldCheck} title="Check first">
        <ul className="list-disc space-y-1 pl-4">
          {app.checkFirst.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </DetailSection>
      <DetailSection icon={ClipboardList} title="Needed input">
        <ul className="list-disc space-y-1 pl-4">
          {app.neededInput.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </DetailSection>
      <DetailSection icon={Waves} title="Output">
        <p>{app.output}</p>
      </DetailSection>
    </div>
  );
}

const mobileDetailSections = [
  { id: "check-first", icon: ShieldCheck, label: "Check first" },
  { id: "needed-input", icon: ClipboardList, label: "Needed input" },
  { id: "output", icon: Waves, label: "Output" },
] as const;

type MobileDetailSectionId = (typeof mobileDetailSections)[number]["id"];

function MobileDetailSections({ app }: { app: LauncherApp }) {
  const [openSection, setOpenSection] = useState<MobileDetailSectionId | null>(null);

  function sectionContent(id: MobileDetailSectionId) {
    if (id === "output") return <p>{app.output}</p>;
    const items = id === "check-first" ? app.checkFirst : app.neededInput;
    return (
      <ul className="list-disc space-y-1 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] shadow-[var(--shadow-inset)]">
      {mobileDetailSections.map(({ id, icon: Icon, label }) => {
        const expanded = openSection === id;
        const panelId = `launcher-detail-${id}-panel`;
        return (
          <div key={id} className="border-t border-[color:var(--border)] first:border-t-0">
            <button
              type="button"
              onClick={() => setOpenSection(expanded ? null : id)}
              aria-expanded={expanded}
              aria-controls={panelId}
              className={cn(
                "grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 text-left",
                focusRing,
              )}
            >
              <Icon className="size-icon-lg text-[color:var(--clinical-accent)]" aria-hidden />
              <span className="text-sm font-extrabold text-[color:var(--text-heading)]">{label}</span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-[color:var(--decoration-soft)] transition-transform motion-reduce:transition-none",
                  expanded && "rotate-90",
                )}
                aria-hidden
              />
            </button>
            <div id={panelId} hidden={!expanded} className="px-3 pb-3 text-xs leading-5 text-[color:var(--text-muted)]">
              {sectionContent(id)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailDialog({ app, open, onClose }: { app: LauncherApp; open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={app.title}
      closeLabel={`Close ${app.title}`}
      headerLeading={<ToolIcon app={app} size="md" />}
      descriptionContent={<ToolChips app={app} />}
      titleClassName="text-xl font-extrabold sm:text-2xl"
      contentClassName="sm:max-w-[39rem]"
      footer={
        <div className="grid gap-3">
          <Link
            href={app.href}
            target={app.external ? "_blank" : undefined}
            rel={app.external ? "noopener noreferrer" : undefined}
            className={cn(
              "inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-lg bg-[color:var(--clinical-accent)] px-4 text-sm font-extrabold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--clinical-accent-hover)]",
              focusRing,
            )}
          >
            {app.id === "risk-safety"
              ? "Open safety check"
              : app.actionLabel === "Ask"
                ? "Ask a question"
                : `${app.actionLabel} ${app.mobileTitle ?? app.title}`.trim()}
            {app.external ? (
              <ExternalLink className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </Link>
          <Link
            href={app.href}
            className={cn(
              "inline-flex min-h-tap items-center justify-center gap-2 rounded-lg text-sm font-bold text-[color:var(--clinical-accent)]",
              focusRing,
            )}
          >
            View example
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="sm:hidden">
          <DetailSection icon={Search} title="Best for" compact>
            <p>{app.detail}</p>
          </DetailSection>
          <MobileDetailSections key={app.id} app={app} />
        </div>

        <div className="hidden sm:block">
          <DetailRows app={app} />
        </div>
      </div>
    </Sheet>
  );
}

type ApplicationsLauncherWorkspaceProps = {
  query?: string;
  desktopComposerSlotId?: string;
  className?: string;
  /** Optional override; defaults to the current auth/demo Favourites session gate. */
  canAccessFavourites?: boolean;
};

export function ApplicationsLauncherWorkspace({
  query: controlledQuery,
  desktopComposerSlotId,
  className,
  canAccessFavourites: canAccessFavouritesProp,
}: ApplicationsLauncherWorkspaceProps) {
  const router = useRouter();
  const auth = useAuthSession();
  const clientDemoMode = resolveClientDemoMode({
    explicitDemoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
    authUnavailableFallback: !auth.isConfigured,
    localNoAuthMode: isLocalNoAuthMode(),
  });
  const { favouritesAccessible } = useFavouritesAccess(auth.status === "authenticated", clientDemoMode);
  const canAccessFavourites = canAccessFavouritesProp ?? favouritesAccessible;
  const searchCommand = useSearchCommand();
  const [localQuery, setLocalQuery] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<LauncherFilter>("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const copy = toolsLauncherCopy;
  const launcherApps = useMemo(() => launcherAppsForSession(canAccessFavourites), [canAccessFavourites]);
  const desktopFilters = useMemo(() => desktopFiltersForSession(canAccessFavourites), [canAccessFavourites]);
  const query = localQuery ?? controlledQuery ?? searchCommand?.query ?? "";
  const normalizedQuery = query.trim().toLowerCase();
  const naturalSmartSearch = useMemo(() => interpretSmartSearch("tools", query).naturalLanguage, [query]);
  const smartExpansions = useMemo(() => smartSearchExpansions("tools", query), [query]);
  const [selectedId, setSelectedId] = useState<ToolCatalogId>("risk-safety");
  const effectiveFilter: LauncherFilter = activeFilter === "saved" && !canAccessFavourites ? "all" : activeFilter;

  const queryMatchedApps = useMemo(
    () =>
      normalizedQuery
        ? rankToolRecords(query, undefined, smartExpansions, {
            authenticated: canAccessFavourites,
            demoMode: false,
          })
            .map((match) => match.tool)
            .filter((app) => !naturalSmartSearch || !localSmartExcludedToolIds.has(app.id))
        : launcherApps,
    [canAccessFavourites, launcherApps, naturalSmartSearch, normalizedQuery, query, smartExpansions],
  );
  const filterCounts = Object.fromEntries(
    desktopFilters.map((filter) => [
      filter.id,
      queryMatchedApps.filter((app) => launcherAppMatchesFilter(app, filter.id)).length,
    ]),
  );

  const filteredApps = useMemo(
    () => queryMatchedApps.filter((app) => launcherAppMatchesFilter(app, effectiveFilter)),
    [effectiveFilter, queryMatchedApps],
  );

  const effectiveSelectedId = filteredApps.some((app) => app.id === selectedId)
    ? selectedId
    : (filteredApps[0]?.id ?? selectedId);
  const selectedApp = appById(effectiveSelectedId, launcherApps);
  // Label the results by the selected filter's visible label (mobile-only filters
  // like "More" included) so assistive tech hears which result set is active.
  const activeFilterLabel =
    desktopFilters.find((filter) => filter.id === effectiveFilter)?.label ??
    mobileFilters.find((filter) => filter.id === effectiveFilter)?.label;
  const resultsPanelLabel =
    activeFilterLabel && activeFilterLabel !== copy.allSectionLabel
      ? `${activeFilterLabel} tools`
      : copy.allSectionLabel;

  function updateQuery(nextQuery: string) {
    setLocalQuery(nextQuery);
  }

  function openTool(id: ToolCatalogId) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  function submitSearch() {
    const submittedQuery = query.trim();
    if (submittedQuery) {
      router.push(`/tools?q=${encodeURIComponent(submittedQuery)}&run=1`);
      return;
    }
    if (filteredApps[0]) openTool(filteredApps[0].id);
  }

  return (
    <main
      data-testid="tools-hub"
      aria-labelledby="tools-home-title"
      className={cn(
        "mx-auto w-full max-w-[90rem] overflow-x-hidden px-4 pb-8 text-[color:var(--text)] sm:px-6 lg:px-8",
        "pt-5 sm:pt-8 lg:pt-10",
        className,
      )}
    >
      <section
        aria-label="Tools home"
        data-testid="tools-home"
        className="mx-auto grid max-w-5xl justify-items-center gap-3 text-center sm:gap-4"
      >
        <ModeHomeHero
          testId="tools-home"
          title={copy.heading}
          subtitle={copy.description}
          icon={Grid2X2}
          headingLevel={1}
        />

        <ShowAllChip
          href="/tools"
          icon={Grid2X2}
          label={copy.showAllLabel}
          ariaLabel="Show all tools"
          testId="tools-show-all"
        />

        {desktopComposerSlotId ? (
          <DesktopComposerPortalSlot
            id={desktopComposerSlotId}
            data-composer-reserve={modeHomeComposerReservePendingValue}
            className="mode-home-composer-slot hidden w-full max-w-3xl sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
          />
        ) : (
          <ToolSearch
            value={query}
            onChange={updateQuery}
            onSubmit={submitSearch}
            copy={copy}
            className="w-full max-w-3xl"
          />
        )}

        <div className="w-full max-w-6xl" data-testid="tools-shortcuts">
          <div className="hidden sm:block">
            <QuickActions
              onSelect={openTool}
              apps={launcherApps}
              canAccessFavourites={canAccessFavourites}
              naturalSmartSearch={naturalSmartSearch}
            />
          </div>
          <div className="sm:hidden">
            <QuickActions
              onSelect={openTool}
              apps={launcherApps}
              canAccessFavourites={canAccessFavourites}
              naturalSmartSearch={naturalSmartSearch}
              mobile
            />
          </div>
        </div>
      </section>

      <section
        aria-label={copy.allSectionLabel}
        data-testid="tools-all-tools"
        className="mx-auto mt-8 grid max-w-[86rem] grid-cols-1 gap-4 sm:mt-10"
      >
        {normalizedQuery ? (
          <SearchResultsHeaderBand
            modeId="tools"
            query={query}
            matchCount={filteredApps.length}
            filterLabel="Filter tools by category"
            filterControls={
              <FilterTabs
                activeFilter={effectiveFilter}
                onFilterChange={setActiveFilter}
                canAccessFavourites={canAccessFavourites}
                filterCounts={filterCounts}
              />
            }
          />
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="text-left">
              <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">{copy.allSectionLabel}</h2>
            </div>
            <div className="flex items-center gap-3">
              <FilterTabs
                activeFilter={effectiveFilter}
                onFilterChange={setActiveFilter}
                canAccessFavourites={canAccessFavourites}
                filterCounts={filterCounts}
              />
              <p className="hidden min-h-10 items-center rounded-lg px-1 text-xs font-bold text-[color:var(--text-muted)] lg:inline-flex">
                Sorted A to Z
              </p>
            </div>
          </div>
        )}

        <div id="launcher-results-panel" role="group" aria-label={resultsPanelLabel} className="grid grid-cols-1 gap-4">
          {filteredApps.length === 0 ? (
            // The filter/query that empties this list is applied without a navigation,
            // so the state is introduced dynamically and keeps EmptyState's polite
            // announcement rather than appearing silently.
            <EmptyState icon={Search} title={copy.emptyTitle} body={copy.emptyBody} live="polite" />
          ) : (
            <>
              <div className="hidden grid-cols-2 gap-4 lg:grid xl:grid-cols-3">
                {filteredApps.map((app) => (
                  <ToolCard key={app.id} app={app} selected={effectiveSelectedId === app.id} onSelect={openTool} />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 lg:hidden">
                {filteredApps.map((app) => (
                  <MobileToolRow key={app.id} app={app} selected={effectiveSelectedId === app.id} onSelect={openTool} />
                ))}
              </div>
            </>
          )}
        </div>

        <p className="sr-only">
          Showing {filteredApps.length > 0 ? "1" : "0"} to {filteredApps.length} of {launcherApps.length}{" "}
          {copy.countNoun}
        </p>
      </section>

      <DetailDialog app={selectedApp} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </main>
  );
}
