"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronRight,
  ChevronsRight,
  CloudOff,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  Heart,
  Phone,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useSearchCommand } from "@/components/clinical-dashboard/search-command-context";
import {
  favouriteSetNames,
  type AccountFavouriteSet,
  type FavouriteSetName,
  useOptionalAccountData,
} from "@/components/account-data-provider";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { WorkButton, WorkEmpty, WorkIconCircle, WorkSectionLabel } from "@/components/mode-kit/work";
import { SidebarAccountSetupDialog as AccountSetupDialog } from "@/components/clinical-dashboard/lazy-sidebar-dialogs";
import { cn, EmptyState } from "@/components/ui-primitives";
import { Chip, type ChipAppearance } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOptionalToast, type ToastApi } from "@/components/ui/toast";
import { FAVOURITE_EXAMPLES_NOTICE } from "@/components/clinical-dashboard/favourite-example-tag";
import {
  favouriteItems as prototypeFavouriteItems,
  favouriteSets as prototypeFavouriteSets,
  favouriteTabs,
} from "@/components/clinical-dashboard/favourites-prototype-data";
import type { FavouritesSample } from "@/components/clinical-dashboard/favourites-sample-data";
import { useSavedRegistryFavourites } from "@/components/clinical-dashboard/use-saved-registry-favourites";
import { AddWorkPageSheet } from "@/components/favourites/add-work-page-sheet";
import { applyOverride, numberToItem, toCommandItem, workStarToItem } from "@/components/favourites/favourite-items";
import { ArrangeShelfSheet, CustomiseFavouritesSheet } from "@/components/favourites/customise-favourites-sheet";
import { EditFavouriteSheet } from "@/components/favourites/edit-favourite-sheet";
import { NumberActionsSheet, NumberFormSheet } from "@/components/favourites/number-sheets";
import { FavouritesShelf } from "@/components/favourites/favourites-shelf";
import { FavouriteTypeTile } from "@/components/favourites/favourite-type-tile";
import {
  loadFavouriteLastOpened,
  loadFavouritePinnedIds,
  recordFavouriteOpened,
  subscribeFavouritesStorage,
  toggleFavouritePinnedId,
} from "@/components/favourites/favourites-storage";
import {
  FavouriteActionsSheet,
  FavouriteMoveSheet,
  FavouriteSetNameSheet,
  type FavouriteSheetState,
} from "@/components/favourites/favourite-sheets";
import { FavouritesContinueCard } from "@/components/favourites/favourites-launchpad";
import { FavouritesList, FavouritesSelectBar } from "@/components/favourites/favourites-list";
import { FavouritesSetBar, FavouritesSetChips } from "@/components/favourites/favourites-set-chips";
import {
  buildSetChips,
  favouriteScopeOf,
  favouritesSummary,
  groupForView,
  isSourceBacked,
  matchesFavouriteSearch,
  pickContinueItem,
  QUICK_LAUNCH_LIMIT,
  shelfItems,
  UNSORTED_SET_NAME,
  type FavouriteItem,
  type FavouriteType,
  type FavouritesView,
} from "@/components/favourites/favourites-view-model";
import {
  SearchResultsEmptyState,
  SearchResultsHeaderBand,
} from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { maxFavouriteSetsPerAccount } from "@/lib/favourite-set-name";
import { canAccessFavouritesMode } from "@/lib/app-modes";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { useNewWorkMode, useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { modeHomeComposerReservePendingValue, modeHomeDesktopComposerSlotId } from "@/lib/mode-home-composer";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { useAuthSession } from "@/lib/supabase/client";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  forgetPinOrder,
  recordNumberOpened,
  removeSavedNumbers,
  RESTORE_FAILED,
  restoreSavedNumbers,
  setFavouritesLayout,
  setSavedNumbersPinned,
  telHref,
  useFavouriteOverrides,
  useFavouritesLayout,
  useSavedNumbers,
  visibleSections,
  type FavouritesScope,
  type FavouritesSectionId,
  type SavedNumber,
} from "@/lib/favourites/favourites-local";
import {
  recordWorkPageOpened,
  removeWorkPageStars,
  resolveWorkPageStars,
  restoreWorkPageStars,
  setWorkPageStarsPinned,
  useWorkPageStars,
  type WorkPageStar,
} from "@/lib/favourites/work-page-stars";

export type { FavouriteItem } from "@/components/favourites/favourites-view-model";

type PageMode = "browse" | "select" | "reorder";

// Long enough for a keyboard or screen-reader user to reach Undo in the toast.
const UNDO_TOAST_MS = 10_000;

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function subscribeNoop() {
  return () => {};
}

// The page clock ticks once a minute: often enough for "Today 08:44" and the
// day groups to stay true, and stable between renders so React never loops.
function getMinuteNow() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
const getServerNow = () => 0;

const typeAppearance: Record<FavouriteType, ChipAppearance> = {
  Medication: { kind: "information", tone: "accent" },
  Document: { kind: "category", tone: "document" },
  Table: { kind: "category", tone: "table" },
  "Saved search": { kind: "category", tone: "search" },
  Source: { kind: "category", tone: "source" },
  Service: { kind: "category", tone: "service" },
  Form: { kind: "category", tone: "form" },
  Differential: { kind: "information", tone: "accent" },
  Therapy: { kind: "information", tone: "accent" },
  "Work page": { kind: "information", tone: "accent" },
  Number: { kind: "information", tone: "accent" },
};

// The type facet: every clinical tab, plus saved work pages.
const typeTabs: readonly { id: string; label: string }[] = [
  ...favouriteTabs.filter((tab) => tab.id !== "all" && tab.id !== "sets"),
  { id: "work", label: "Work pages" },
];

/** Work pages and saved numbers: kept on this phone, never in a set. */
const isWorkItem = (item: FavouriteItem) => favouriteScopeOf(item) === "work";

const scopeOptions: readonly { value: FavouritesScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "clinical", label: "Clinical" },
  { value: "work", label: "Work" },
];

const viewOptions = {
  all: [
    { value: "recent", label: "Recent" },
    { value: "az", label: "A to Z" },
    { value: "type", label: "Type" },
  ],
  set: [
    { value: "order", label: "My order" },
    { value: "recent", label: "Recent" },
    { value: "az", label: "A to Z" },
  ],
} as const;

function favouriteCitationText(item: FavouriteItem): string {
  const evidenceLine = isSourceBacked(item) ? `Evidence: ${item.evidence}` : item.description;
  // The item's own title: a name the person gave it never goes into a citation.
  return `${item.originalTitle ?? item.title}\n${evidenceLine}\n${item.href}`;
}

async function copyFavouriteCitation(item: FavouriteItem): Promise<boolean> {
  const text = favouriteCitationText(item);

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the local selection-based copy path.
    }
  }

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previouslyFocused?.focus({ preventScroll: true });
  }
}

function MiniIconTile({
  icon: Icon,
  active = false,
  className,
}: {
  icon: LucideIcon;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
        active
          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
          : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

function SmallChip({ children, appearance }: { children: React.ReactNode; appearance: ChipAppearance }) {
  return (
    <Chip size="compact" appearance={appearance}>
      {children}
    </Chip>
  );
}

/** The amber band when the account's saved items did not load. Work pages, kept on this phone, still show. */
function FavouritesLoadFailedBand({
  hasClinicalItems,
  hasWorkPages,
  onRetry,
}: {
  hasClinicalItems: boolean;
  hasWorkPages: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid="favourites-load-failed"
      className="flex min-w-0 items-center gap-2.5 rounded-[var(--work-radius-card)] border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] py-1.5 pl-3 pr-1.5 text-sm font-semibold text-[color:var(--warning-text)]"
    >
      <AlertTriangle className="size-icon-sm shrink-0" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1 py-1.5">
        {hasClinicalItems
          ? "Some saved clinical items did not load."
          : hasWorkPages
            ? "Your saved clinical items did not load. Work pages on this phone are below."
            : "Your saved favourites did not load."}
      </p>
      <WorkButton variant="secondary" onClick={onRetry}>
        Retry
      </WorkButton>
    </div>
  );
}

// One empty state, rendered by whichever of the table / mobile-card layouts the
// breakpoint is showing. Filters and the search term change without a navigation,
// so the shared primitive's polite announcement is the right default here.
function FavouritesEmptyMatches() {
  return (
    <EmptyState
      icon={Search}
      title="No favourites match"
      body="Clear filters or search to show saved clinical work."
      testId="favourites-empty-matches"
      live="polite"
    />
  );
}

/**
 * Saved numbers: the label, the number in Geist Mono and a Call button. A tap
 * on the row opens its actions (call, copy, edit, pin, remove). Kept on this
 * phone, so it shows with or without an account.
 */
function NumbersSection({
  items,
  canAdd,
  onAdd,
  onShowActions,
  onCall,
}: {
  items: readonly FavouriteItem[];
  canAdd: boolean;
  onAdd: () => void;
  onShowActions: (item: FavouriteItem) => void;
  onCall: (item: FavouriteItem) => void;
}) {
  return (
    <section aria-labelledby="favourites-numbers-heading" className="grid gap-1.5" data-testid="favourites-numbers">
      <WorkSectionLabel
        id="favourites-numbers-heading"
        count={items.length > 0 ? <span className="nums">{items.length}</span> : undefined}
      >
        Numbers
      </WorkSectionLabel>
      <ul className="work-card work-rows">
        {items.map((item) => {
          const dial = item.phone ? telHref(item.phone) : null;
          return (
            <li
              key={item.id}
              data-testid={`favourite-number-${item.numberId}`}
              className="flex min-h-tap min-w-0 items-center gap-1 pr-1.5"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`${item.title}, ${item.phone ?? ""}${item.pinned ? ", pinned to My Day" : ""}. Actions`}
                onClick={() => onShowActions(item)}
                className={cn(
                  "flex min-h-tap min-w-0 flex-1 items-center gap-3 rounded-md py-2 pl-3 text-left focus-visible:-outline-offset-2",
                  focusRing,
                )}
              >
                <FavouriteTypeTile item={item} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-bold leading-snug text-[color:var(--work-ink)]">
                    {item.title}
                  </span>
                  {item.note ? (
                    <span className="truncate text-xs text-[color:var(--text-muted)]">{item.note}</span>
                  ) : null}
                  <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-[color:var(--text-muted)]">
                    {item.pinned ? (
                      <Pin className="size-icon-xs shrink-0 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                    ) : null}
                    <span className="truncate font-mono">{item.phone}</span>
                  </span>
                </span>
              </button>
              {dial ? (
                <a
                  href={dial}
                  onClick={() => onCall(item)}
                  aria-label={`Call ${item.title}`}
                  className={cn(
                    "inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full bg-[color:var(--clinical-accent-soft)] px-3.5 text-sm font-bold text-[color:var(--clinical-accent)]",
                    focusRing,
                  )}
                >
                  <Phone className="size-icon-sm" aria-hidden="true" />
                  Call
                </a>
              ) : null}
            </li>
          );
        })}
        {canAdd ? (
          <li>
            <button
              type="button"
              onClick={onAdd}
              className="work-row w-full text-left"
              data-testid="favourites-add-number"
            >
              <WorkIconCircle icon={Plus} tone="neutral" />
              <span className="work-row__text">
                <span className="work-row__title">Add a number</span>
                <span className="work-row__sub">A ward, service or pager, never a patient</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function ItemWorkspace({
  item,
  sets,
  onClose,
  onMove,
  onRemove,
  onReorder,
  onOpen,
}: {
  item: FavouriteItem;
  sets: AccountFavouriteSet[];
  onClose: () => void;
  onMove: (item: FavouriteItem, setId: string | null) => Promise<boolean>;
  onRemove: (item: FavouriteItem) => Promise<boolean>;
  onReorder: (item: FavouriteItem, direction: -1 | 1) => Promise<boolean>;
  onOpen: (item: FavouriteItem) => void;
}) {
  const [activeTab, setActiveTab] = useState<"summary" | "evidence" | "notes">("summary");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationStatus, setMutationStatus] = useState("");
  const Icon = item.icon;
  const actionLabel = item.action === "Copy" ? "Open" : item.action;

  return (
    <aside
      className="hidden min-w-0 border-l border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-6 xl:block"
      data-testid="favourites-item-workspace"
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[color:var(--border)] pb-3">
        <h2 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">Item workspace</h2>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "relative grid h-8 w-8 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] before:absolute before:-inset-2",
            focusRing,
          )}
          aria-label="Collapse item workspace"
        >
          <ChevronsRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-start gap-3">
          <MiniIconTile icon={Icon} active />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg-minus font-bold leading-tight text-[color:var(--text-heading)]">{item.title}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SmallChip appearance={typeAppearance[item.type]}>{item.type}</SmallChip>
              {isSourceBacked(item) ? (
                <SmallChip appearance={{ kind: "status", tone: "success" }}>Source-backed</SmallChip>
              ) : null}
            </div>
          </div>
        </div>

        <p className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]">
          Saved in <Folder className="h-4 w-4" aria-hidden />{" "}
          <span className="text-[color:var(--text-heading)]">{item.set}</span>
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 border-b border-[color:var(--border)]">
        {[
          ["summary", "Summary"],
          ["evidence", "Evidence"],
          ["notes", "Notes"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as "summary" | "evidence" | "notes")}
            className={cn(
              "min-h-tap border-b-2 text-sm-minus font-semibold transition sm:min-h-10",
              activeTab === id
                ? "border-[color:var(--clinical-accent)] text-[color:var(--clinical-accent)]"
                : "border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
              focusRing,
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-5">
        {activeTab === "summary" ? (
          <section className="rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/45 p-3">
            <p className="text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
              Next action
            </p>
            <p className="mt-2 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{item.description}</p>
            <p className="mt-1 text-2xs font-medium text-[color:var(--text-muted)]">Saved action: {actionLabel}</p>
            <Link
              href={item.href}
              onClick={() => onOpen(item)}
              className={cn(
                "mt-3 inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--command)] px-3 text-sm font-bold text-[color:var(--command-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--command-hover)]",
                focusRing,
              )}
            >
              {actionLabel}
              <ExternalLink className="h-4 w-4" aria-hidden />
            </Link>
            <p className="mt-2 text-2xs font-medium text-[color:var(--text-muted)]">Last opened {item.lastUsed}</p>
          </section>
        ) : null}

        {activeTab === "evidence" ? (
          <section>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              Evidence
            </h3>
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
              {isSourceBacked(item) ? (
                <div className="flex min-w-0 items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                  <p className="min-w-0 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                    {item.evidence}
                  </p>
                </div>
              ) : (
                <p className="text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                  No linked evidence source is saved for this item.
                </p>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "notes" ? (
          <section>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              Personal note
            </h3>
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
              <p className="text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                No personal note is saved for this item.
              </p>
            </div>
          </section>
        ) : null}

        <section className="border-t border-[color:var(--border)] pt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
            More
          </h3>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={async () => {
                const copied = await copyFavouriteCitation(item);
                setCopyStatus(copied ? "copied" : "failed");
              }}
              className={cn(
                "inline-flex min-h-tap items-center justify-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm font-bold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
                focusRing,
              )}
            >
              <Copy className="h-4 w-4 text-[color:var(--text-muted)]" aria-hidden />
              {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy citation"}
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {copyStatus === "copied"
                ? `${item.title} citation copied`
                : copyStatus === "failed"
                  ? "Unable to copy citation"
                  : ""}
            </span>
            {item.contentType && item.contentKey ? (
              <>
                <label className="grid gap-1 text-2xs font-semibold text-[color:var(--text-muted)]">
                  Move to set
                  <select
                    value={item.setId ?? ""}
                    disabled={mutationPending}
                    onChange={async (event) => {
                      setMutationPending(true);
                      try {
                        const moved = await onMove(item, event.target.value || null);
                        setMutationStatus(moved ? "Favourite moved." : "Favourite could not be moved.");
                      } catch {
                        setMutationStatus("Favourite could not be moved.");
                      } finally {
                        setMutationPending(false);
                      }
                    }}
                    className="min-h-tap rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--text)] sm:min-h-10"
                  >
                    <option value="">Unsorted</option>
                    {sets.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([-1, 1] as const).map((direction) => {
                    const DirectionIcon = direction === -1 ? ArrowUp : ArrowDown;
                    return (
                      <button
                        key={direction}
                        type="button"
                        disabled={mutationPending}
                        onClick={async () => {
                          setMutationPending(true);
                          try {
                            const reordered = await onReorder(item, direction);
                            setMutationStatus(
                              reordered ? "Favourite order updated." : "Favourite order could not be updated.",
                            );
                          } catch {
                            setMutationStatus("Favourite order could not be updated.");
                          } finally {
                            setMutationPending(false);
                          }
                        }}
                        className={cn(
                          "inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] px-3 text-sm font-bold text-[color:var(--text)] disabled:opacity-60",
                          focusRing,
                        )}
                      >
                        <DirectionIcon className="h-4 w-4" aria-hidden />
                        {direction === -1 ? "Move up" : "Move down"}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={mutationPending}
                  onClick={async () => {
                    setMutationPending(true);
                    try {
                      const removed = await onRemove(item);
                      setMutationStatus(removed ? "Favourite removed." : "Favourite could not be removed.");
                      if (removed) onClose();
                    } catch {
                      setMutationStatus("Favourite could not be removed.");
                    } finally {
                      setMutationPending(false);
                    }
                  }}
                  className={cn(
                    "inline-flex min-h-tap items-center justify-start gap-2 rounded-lg border border-[color:var(--danger-border)] bg-transparent px-3 text-sm font-bold text-[color:var(--danger)] disabled:opacity-60",
                    focusRing,
                  )}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {mutationPending ? "Updating…" : "Remove favourite"}
                </button>
                <p role="status" aria-live="polite" className="text-xs font-semibold text-[color:var(--text-muted)]">
                  {mutationStatus}
                </p>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </aside>
  );
}

// Server snapshots must be referentially stable: a fresh object per call makes
// React warn that getServerSnapshot is uncached and can loop during hydration.
const EMPTY_LAST_OPENED_SNAPSHOT: Record<string, number> = {};
const EMPTY_PINNED_SNAPSHOT: Set<string> = new Set<string>();
const getEmptyLastOpenedSnapshot = () => EMPTY_LAST_OPENED_SNAPSHOT;
const getEmptyPinnedSnapshot = () => EMPTY_PINNED_SNAPSHOT;

export function FavouritesCommandLibraryPage({ query = "", demoMode }: { query?: string; demoMode: boolean }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const auth = useAuthSession();
  const accountData = useOptionalAccountData();
  const searchCommand = useSearchCommand();
  const toastApi = useOptionalToast();
  // Outside the app shell (isolated renders) there is no toast region, so say
  // the outcome through the announcer and let a held-back removal commit.
  const toast = useMemo<ToastApi>(
    () =>
      toastApi ?? {
        push: (entry) => {
          announce(entry.title);
          entry.onClose?.("timeout");
          return "";
        },
        dismiss: () => {},
      },
    [toastApi],
  );
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const now = useSyncExternalStore(subscribeMinute, getMinuteNow, getServerNow);
  // The route's submitted `?q=` server-renders the exact list on a hard load;
  // after hydration the shared composer's live draft owns it. That is what
  // makes the typed query filter this page in place — no navigation, no second
  // input, and no ModeHome to bounce through (ledger #164). The composer is
  // still the one and only composer on the route, so the one-composer contract
  // in docs/search-chrome-behaviour.md is untouched.
  const activeQuery = hydrated ? (searchCommand?.query ?? query) : query;
  // A signed-out visitor sees the real screen filled with a few sample items
  // that live in this page's memory only: nothing is read, saved or stored.
  const sampleMode = !demoMode && (auth.status === "signed_out" || auth.status === "expired");
  // Work pages and the My Day shelf belong to the new work mode. A reader on the classic
  // work mode keeps the plain list: numbers, names, notes and layout.
  const newWorkMode = useNewWorkMode();
  const favouritesAccessible =
    sampleMode ||
    canAccessFavouritesMode({
      authenticated: auth.status === "authenticated",
      demoMode,
    });
  const authSettled = auth.status !== "loading";
  const accountIdentity = auth.status === "authenticated" ? (auth.session?.user?.id ?? "signed-in") : "signed-out";
  const [accountSetupDismissed, setAccountSetupDismissed] = useState(false);
  const accountSetupOpen = authSettled && !favouritesAccessible && !accountSetupDismissed;
  const {
    items: savedRegistryFavourites,
    status: favouritesHookStatus,
    refetch: refetchFavouritesRegistry,
  } = useSavedRegistryFavourites();
  const lastOpenedMap = useSyncExternalStore(
    subscribeFavouritesStorage,
    loadFavouriteLastOpened,
    getEmptyLastOpenedSnapshot,
  );
  const storedPinnedIds = useSyncExternalStore(
    subscribeFavouritesStorage,
    loadFavouritePinnedIds,
    getEmptyPinnedSnapshot,
  );
  const workPageStars = useWorkPageStars();
  const routeVisible = useWorkModeRouteVisible();
  const savedNumbers = useSavedNumbers();
  const overrides = useFavouriteOverrides();
  const layout = useFavouritesLayout();
  const [sampleFavourites, setSampleFavourites] = useState<FavouritesSample | null>(null);
  const [samplePinnedIds, setSamplePinnedIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!sampleMode) return undefined;
    let active = true;
    void import("@/components/clinical-dashboard/favourites-sample-data").then((module) => {
      if (!active) return;
      const sample = module.buildFavouritesSample();
      setSampleFavourites(sample);
      setSamplePinnedIds(new Set(sample.pinnedIds));
    });
    return () => {
      active = false;
    };
  }, [sampleMode]);
  // The sample never reads the browser's saved pins, and never writes them.
  const pinnedIds = sampleMode ? samplePinnedIds : storedPinnedIds;
  const favouriteMetadata = useMemo(
    () =>
      new Map(
        (accountData?.favouriteItems ?? []).map((item) => [`${item.contentType}:${item.contentKey}`, item] as const),
      ),
    [accountData?.favouriteItems],
  );
  const accountSets = useMemo(
    () => [...(accountData?.favouriteSets ?? [])].sort((first, second) => first.sortOrder - second.sortOrder),
    [accountData?.favouriteSets],
  );
  const setById = useMemo(() => new Map(accountSets.map((set) => [set.id, set] as const)), [accountSets]);
  const items = useMemo(() => {
    const all = [
      // Fixtures are tagged by where they came from, not by id, so a saved item can
      // never inherit the Example tag by sharing an id with a fixture.
      ...(demoMode ? prototypeFavouriteItems : []).map((item) =>
        toCommandItem(item, lastOpenedMap, pinnedIds, favouriteMetadata, setById, now, true),
      ),
      ...(sampleMode ? (sampleFavourites?.items ?? []) : []).map((item) =>
        toCommandItem(item, EMPTY_LAST_OPENED_SNAPSHOT, pinnedIds, favouriteMetadata, setById, now, true),
      ),
      ...savedRegistryFavourites.map((item) =>
        toCommandItem(item, lastOpenedMap, pinnedIds, favouriteMetadata, setById, now),
      ),
      // Work pages and numbers saved on this phone. The signed-out sample shows
      // none: it reads nothing that belongs to anyone.
      // A new-only page 404s on the classic work mode, so it stays saved but hidden there.
      ...(sampleMode ? [] : resolveWorkPageStars(workPageStars, routeVisible).map(workStarToItem)),
      ...(sampleMode ? [] : savedNumbers.map(numberToItem)),
    ];
    // The person's own names and notes, kept on this phone. Never on an example.
    return sampleMode ? all : all.map((item) => (item.example ? item : applyOverride(item, overrides[item.id])));
  }, [
    demoMode,
    sampleMode,
    workPageStars,
    routeVisible,
    savedNumbers,
    overrides,
    sampleFavourites,
    savedRegistryFavourites,
    lastOpenedMap,
    pinnedIds,
    favouriteMetadata,
    setById,
    now,
  ]);

  // Remove is held back until its Undo message closes, so a removed row hides
  // here at once while the account still holds it.
  const [pendingRemovalIds, setPendingRemovalIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRemovalsRef = useRef(
    new Map<
      string,
      {
        items: FavouriteItem[];
        /** Every favourite removed, account and phone alike, to drop from the My Day order. */
        removedIds: readonly string[];
        /** Pinned favourites other than numbers that Undo puts back pinned. */
        pinnedBack: number;
        workRemoved: readonly WorkPageStar[];
        numbersRemoved: readonly SavedNumber[];
        toastId: string | null;
      }
    >(),
  );
  // Read at Undo time, so restored numbers never take My Day past its limit.
  const pinnedCountRef = useRef(0);
  const removalCounterRef = useRef(0);
  const accountDataRef = useRef(accountData);
  const toastRef = useRef<ToastApi | null>(null);
  useEffect(() => {
    accountDataRef.current = accountData;
  }, [accountData]);

  // Settles one held-back removal exactly once: `cancel` (Undo) keeps the
  // favourites and puts removed work pages back; `abandon` (the account
  // changed) keeps the account's favourites but never restores a work page into
  // someone else's phone store; `commit` deletes through the account that is
  // current now. Refs only, so it is safe from effects and stale closures.
  const settleRemoval = useCallback((key: string, outcome: "commit" | "cancel" | "abandon") => {
    const entry = pendingRemovalsRef.current.get(key);
    if (!entry) return;
    pendingRemovalsRef.current.delete(key);
    if (outcome === "cancel" && entry.workRemoved.length > 0 && !restoreWorkPageStars(entry.workRemoved)) {
      toastRef.current?.push({
        tone: "danger",
        title: "Could not put the work page back",
        body: "Add it again from Add a work page.",
      });
    }
    if (outcome === "cancel" && entry.numbersRemoved.length > 0) {
      const restored = restoreSavedNumbers(entry.numbersRemoved, {
        pinRoom: QUICK_LAUNCH_LIMIT - pinnedCountRef.current - entry.pinnedBack,
      });
      if (!restored.ok) {
        toastRef.current?.push({
          tone: "danger",
          title: "Could not put the number back",
          body: restored.reason === "full" ? RESTORE_FAILED.full : "Add it again from Add a number.",
        });
      }
    }
    if (outcome === "commit") forgetPinOrder(entry.removedIds);
    const ids = entry.items.map((item) => item.id);
    const release = () => setPendingRemovalIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
    const account = accountDataRef.current;
    if (outcome !== "commit" || !account || entry.items.length === 0) {
      release();
      return;
    }
    void Promise.all(
      entry.items.map((item) =>
        item.contentType && item.contentKey
          ? account.setFavourite(item.contentType, item.contentKey, false).catch(() => false)
          : Promise.resolve(false),
      ),
    )
      .then((results) => {
        const failed = results.filter((removed) => !removed).length;
        if (failed > 0) {
          toastRef.current?.push({
            tone: "danger",
            title: failed === 1 ? "1 favourite could not be removed" : `${failed} favourites could not be removed`,
            body: "It is still saved. Check your connection and try again.",
          });
        }
      })
      .finally(release);
  }, []);

  // Leaving the page, or closing the tab, commits what is waiting: the message
  // said it was removed, so it must not quietly reappear on the next visit.
  useEffect(() => {
    const flush = () => {
      for (const [key, entry] of [...pendingRemovalsRef.current]) {
        settleRemoval(key, "commit");
        if (entry.toastId) toastRef.current?.dismiss(entry.toastId);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [settleRemoval]);
  const libraryItems = useMemo(
    () => items.filter((item) => !pendingRemovalIds.has(item.id)),
    [items, pendingRemovalIds],
  );
  useEffect(() => {
    pinnedCountRef.current = libraryItems.filter((item) => item.pinned).length;
  }, [libraryItems]);

  // A different account (or signing out) must never inherit this account's
  // pending removals: keep the favourites and drop the messages.
  useEffect(
    () => () => {
      for (const [key, entry] of [...pendingRemovalsRef.current]) {
        settleRemoval(key, "abandon");
        if (entry.toastId) toastRef.current?.dismiss(entry.toastId);
      }
    },
    [accountIdentity, settleRemoval],
  );

  // Demo prototypes live outside the hook. If they are the only items while a
  // registry/account read failed, keep their honest nonzero count but mark it
  // partial so it cannot be mistaken for the complete saved library.
  const favouritesRegistryStatus =
    items.length > 0 &&
    (favouritesHookStatus === "partial" || favouritesHookStatus === "error" || favouritesHookStatus === "unauthorized")
      ? "partial"
      : items.length > 0
        ? "ready"
        : favouritesHookStatus;

  // The account's saved items did not load (or only some did). Work pages live
  // on this phone, so they still show under an amber band with Retry.
  const clinicalLoadFailed =
    !sampleMode && !demoMode && (favouritesHookStatus === "error" || favouritesHookStatus === "partial");

  const orderedSetNames = useMemo(
    () => [
      ...accountSets.map((set) => set.name as string),
      ...(demoMode ? prototypeFavouriteSets.map((set) => set.title) : []),
    ],
    [accountSets, demoMode],
  );
  // Work pages never go into a set, so they never make a set chip. They show
  // under All, and under Work pages in the Type view.
  const setChips = useMemo(
    () =>
      buildSetChips(
        libraryItems.filter((item) => !isWorkItem(item)),
        orderedSetNames,
      ),
    [libraryItems, orderedSetNames],
  );

  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSetNames, setSelectedSetNames] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedTypeIds, setSelectedTypeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sourceBackedOnly, setSourceBackedOnly] = useState(false);
  // The view and the scope open where Customise Favourites set them, then
  // follow the reader's taps on this visit.
  const [allViewChoice, setAllView] = useState<FavouritesView | null>(null);
  const allView: FavouritesView = allViewChoice ?? layout.view;
  const [scopeChoice, setScopeChoice] = useState<FavouritesScope | null>(null);
  const scope: FavouritesScope = scopeChoice ?? layout.scope;
  const inScope = (item: FavouriteItem) => scope === "all" || favouriteScopeOf(item) === scope;
  const [setView, setSetView] = useState<FavouritesView>("order");
  const [mode, setMode] = useState<PageMode>("browse");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  // Sheets stay mounted and close through `open`, so the shared Sheet can hand
  // focus back to the control that opened it (it skips that on unmount).
  const [sheetContent, setSheetContent] = useState<FavouriteSheetState>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOriginRef = useRef<HTMLElement | null>(null);
  const sheet = sheetOpen ? sheetContent : null;
  const [confirmRemoveIds, setConfirmRemoveIds] = useState<string[] | null>(null);
  const [reorderPending, setReorderPending] = useState(false);
  const [confirmDeleteSet, setConfirmDeleteSet] = useState<AccountFavouriteSet | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemSnapshot, setSelectedItemSnapshot] = useState<FavouriteItem | null>(null);
  const [addWorkPageOpen, setAddWorkPageOpen] = useState(false);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [editItem, setEditItem] = useState<FavouriteItem | null>(null);
  const [numberActionId, setNumberActionId] = useState<string | null>(null);
  const [numberFormOpen, setNumberFormOpen] = useState(false);
  const [editingNumber, setEditingNumber] = useState<SavedNumber | null>(null);

  // A chosen set that has emptied (moved away, removed) drops out of the
  // filter. Sets hold clinical items only, so Work never filters by one.
  const effectiveSelectedSets = useMemo(
    () =>
      scope === "work"
        ? new Set<string>()
        : new Set([...selectedSetNames].filter((name) => setChips.some((chip) => chip.name === name))),
    [selectedSetNames, setChips, scope],
  );
  const singleSetName = effectiveSelectedSets.size === 1 ? [...effectiveSelectedSets][0]! : null;
  const view: FavouritesView = singleSetName ? setView : allView;
  const searching = activeQuery.trim().length > 0;
  const facetFilterCount = selectedTypeIds.size + Number(pinnedOnly) + Number(sourceBackedOnly);
  const activeFilterCount = effectiveSelectedSets.size + facetFilterCount;
  const effectiveMode: PageMode = mode === "reorder" && !(singleSetName && view === "order") ? "browse" : mode;

  const passesFilters = (
    item: FavouriteItem,
    {
      sets = effectiveSelectedSets,
      typeIds = selectedTypeIds,
      pinned = pinnedOnly,
      sourceBacked = sourceBackedOnly,
    }: {
      sets?: ReadonlySet<string>;
      typeIds?: ReadonlySet<string>;
      pinned?: boolean;
      sourceBacked?: boolean;
    } = {},
  ) =>
    inScope(item) &&
    (sets.size === 0 || (!isWorkItem(item) && sets.has(item.set))) &&
    (typeIds.size === 0 || typeIds.has(item.tabId)) &&
    (!pinned || item.pinned === true) &&
    (!sourceBacked || isSourceBacked(item)) &&
    matchesFavouriteSearch(item, activeQuery);

  // Single source of truth for "what is in the list right now". The band's
  // match count, the empty-state branch and the list all read this one value.
  const filteredItems = libraryItems.filter((item) => passesFilters(item));
  const shelf = shelfItems(libraryItems, layout.shelfSize, layout.pinOrder);
  const sectionsShown = visibleSections(layout);
  const pinnedCount = libraryItems.filter((item) => item.pinned).length;
  const continueItem = pickContinueItem(libraryItems);
  const listAnnouncementKey = `${scope}::${[...effectiveSelectedSets].sort().join("|")}::${view}`;
  const lastAnnouncementKeyRef = useRef(listAnnouncementKey);
  useEffect(() => {
    if (lastAnnouncementKeyRef.current === listAnnouncementKey) return;
    lastAnnouncementKeyRef.current = listAnnouncementKey;
    announce(`Showing ${filteredItems.length} ${filteredItems.length === 1 ? "favourite" : "favourites"}.`);
  }, [listAnnouncementKey, filteredItems.length]);
  const showLaunchpad = !searching && activeFilterCount === 0 && effectiveMode === "browse";

  // Account items can be pinned, moved and removed. A work page lives on this
  // phone: it can be pinned and removed, but never moved into a set.
  const canMove = (item: FavouriteItem) =>
    Boolean(item.contentType && item.contentKey && accountData?.isAuthenticated && !item.example);
  const canMutate = (item: FavouriteItem) => (isWorkItem(item) && !sampleMode) || canMove(item);
  const mutableCount = libraryItems.filter(canMutate).length;
  const availableSetNames = favouriteSetNames.filter(
    (name) => !accountSets.some((set) => set.name.toLowerCase() === name.toLowerCase()),
  );
  const canCreateSet = Boolean(accountData?.isAuthenticated) && accountSets.length < maxFavouriteSetsPerAccount;
  const accountSetForChip = singleSetName ? accountSets.find((set) => set.name === singleSetName) : undefined;
  const singleSetMutableCount = singleSetName
    ? filteredItems.filter((item) => item.set === singleSetName && canMove(item)).length
    : 0;

  const selectedItem = selectedItemId
    ? (libraryItems.find((item) => item.id === selectedItemId) ??
      (selectedItemSnapshot?.id === selectedItemId && !pendingRemovalIds.has(selectedItemId)
        ? selectedItemSnapshot
        : null))
    : null;

  function clearSearch() {
    router.push("/favourites");
  }

  function clearAllFilters() {
    setSelectedSetNames(new Set());
    setSelectedTypeIds(new Set());
    setPinnedOnly(false);
    setSourceBackedOnly(false);
  }

  function leaveSpecialMode() {
    setMode("browse");
    setSelectedIds(new Set());
  }

  function rememberSheetOrigin() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) sheetOriginRef.current = active;
  }

  function openAddWorkPage() {
    rememberSheetOrigin();
    setSheetOpen(false);
    setAddWorkPageOpen(true);
  }

  function openSheet(next: Exclude<FavouriteSheetState, null>) {
    const active = document.activeElement;
    // Remember the row control, not a button inside a sheet being replaced. A
    // swipe-tray button is hidden behind the row once it closes, so hand focus
    // back to that row's visible actions button instead.
    if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) {
      sheetOriginRef.current = active.closest("[data-swipe-tray]")
        ? (active.closest("li")?.querySelector<HTMLElement>("[data-row-actions]") ?? active)
        : active;
    }
    setSheetContent(next);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
  }

  // A saved number opens its own sheet (call, copy, edit); everything else the actions sheet.
  function showActions(item: FavouriteItem) {
    if (item.numberId) {
      rememberSheetOrigin();
      setSheetOpen(false);
      setNumberActionId(item.id);
      return;
    }
    openSheet({ kind: "actions", item });
  }

  function editFavourite(item: FavouriteItem) {
    closeSheet();
    if (item.numberId) {
      setEditingNumber(savedNumbers.find((entry) => entry.id === item.numberId) ?? null);
      setNumberFormOpen(true);
      return;
    }
    setEditItem(item);
  }

  function openAddNumber() {
    rememberSheetOrigin();
    setSheetOpen(false);
    setEditingNumber(null);
    setNumberFormOpen(true);
  }

  // Stable on purpose: the Sheet reads this in its open effect's dependencies.
  // After Remove the origin row is gone, so fall back to the page heading.
  const returnFocusToOrigin = useCallback(
    () =>
      sheetOriginRef.current?.isConnected ? sheetOriginRef.current : document.getElementById("favourites-page-heading"),
    [],
  );

  function handleOpen(item: FavouriteItem) {
    // The sample keeps no "last opened" record, in this browser or the account.
    if (sampleMode) return;
    if (item.workKey) {
      recordWorkPageOpened(item.workKey);
      return;
    }
    if (item.numberId) {
      recordNumberOpened(item.numberId);
      return;
    }
    recordFavouriteOpened(item.id);
    if (!item.example && item.contentType && item.contentKey) {
      void accountData?.recordFavouriteOpen(item.contentType, item.contentKey);
    }
  }

  async function handleMoveNow(item: FavouriteItem, setId: string | null) {
    if (!item.contentType || !item.contentKey) return false;
    return accountData?.moveFavourite(item.contentType, item.contentKey, setId) ?? false;
  }

  async function handleReorder(item: FavouriteItem, direction: -1 | 1) {
    if (!item.contentType || !item.contentKey) return false;
    return accountData?.reorderFavourite(item.contentType, item.contentKey, direction === -1 ? "up" : "down") ?? false;
  }

  async function setItemPinned(item: FavouriteItem, pinned: boolean) {
    if (item.workKey) return setWorkPageStarsPinned(new Set([item.workKey]), pinned);
    if (item.numberId) return setSavedNumbersPinned(new Set([item.numberId]), pinned);
    if (canMove(item) && accountData) {
      const saved = await accountData.setFavouritePinned(item.contentType!, item.contentKey!, pinned);
      // Clear an older browser-only pin only once the account has confirmed.
      if (saved && !pinned && pinnedIds.has(item.id)) toggleFavouritePinnedId(item.id);
      return saved;
    }
    if (sampleMode) {
      // Pinning in the sample lasts only while the page is open.
      setSamplePinnedIds((current) => {
        const next = new Set(current);
        if (pinned) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
      return true;
    }
    // Examples, and items the account cannot hold, pin in this browser only.
    if (pinnedIds.has(item.id) !== pinned) toggleFavouritePinnedId(item.id);
    return true;
  }

  async function togglePin(targets: FavouriteItem[]) {
    if (targets.length === 0) return;
    const unpin = targets.every((item) => item.pinned);
    if (unpin) {
      const results = await Promise.all(targets.map((item) => setItemPinned(item, false)));
      const failed = results.filter((saved) => !saved).length;
      forgetPinOrder(targets.filter((_, index) => results[index]).map((item) => item.id));
      toast.push(
        failed === 0
          ? {
              tone: "success",
              title: targets.length === 1 ? "Unpinned from My Day" : `${targets.length} unpinned from My Day`,
            }
          : {
              tone: "danger",
              title: `${failed} could not be unpinned`,
              body: "Check your connection and try again.",
            },
      );
      return;
    }
    const toAdd = targets.filter((item) => !item.pinned);
    // One limit for clinical items and work pages together: My Day shows four pins.
    const room = QUICK_LAUNCH_LIMIT - libraryItems.filter((item) => item.pinned).length;
    if (room <= 0) {
      toast.push({ tone: "warning", title: "My Day holds four pins. Unpin one first." });
      return;
    }
    const adding = toAdd.slice(0, room);
    const results = await Promise.all(adding.map((item) => setItemPinned(item, true)));
    const failed = results.filter((saved) => !saved).length;
    if (failed > 0) {
      toast.push({
        tone: "danger",
        title: `${failed} could not be pinned`,
        body: "Check your connection and try again.",
      });
      return;
    }
    toast.push({
      tone: "success",
      title: adding.length === 1 ? "Pinned to My Day" : `${adding.length} pinned to My Day`,
      body: adding.length < toAdd.length ? "My Day holds four pins. The rest were not pinned." : undefined,
    });
  }

  async function moveItems(targets: FavouriteItem[], setId: string | null) {
    const mutable = targets.filter(canMove).filter((item) => (item.setId ?? null) !== setId);
    if (mutable.length === 0) return;
    const results = await Promise.all(mutable.map((item) => handleMoveNow(item, setId)));
    const moved = mutable.filter((_, index) => results[index]);
    const failed = mutable.length - moved.length;
    const setName = setId ? (setById.get(setId)?.name ?? "the set") : UNSORTED_SET_NAME;
    if (moved.length === 0) {
      toast.push({ tone: "danger", title: "Could not move", body: "Check your connection and try again." });
      return;
    }
    const previous = moved.map((item) => [item, item.setId ?? null] as const);
    toast.push({
      tone: failed > 0 ? "warning" : "success",
      title: `${moved.length === 1 ? "Moved" : `Moved ${moved.length}`} to ${setName}`,
      body: failed > 0 ? `${failed} could not be moved. Check your connection and try again.` : undefined,
      duration: UNDO_TOAST_MS,
      action: {
        label: "Undo",
        onAction: () => {
          void Promise.all(previous.map(([item, originalSetId]) => handleMoveNow(item, originalSetId))).then(
            (undone) => {
              if (!undone.every(Boolean)) {
                toast.push({
                  tone: "danger",
                  title: "Could not undo the move",
                  body: "Check your connection and move it back from its menu.",
                });
              }
            },
          );
        },
      },
    });
  }

  function removeItems(targets: FavouriteItem[]) {
    const mutable = targets.filter(canMutate);
    if (mutable.length === 0) return;
    // Account items are held back until the Undo message closes. A work page or
    // a number is on this phone, so it leaves at once and Undo puts it back as it was.
    const accountItems = mutable.filter((item) => !isWorkItem(item));
    const workKeys = new Set(mutable.flatMap((item) => (item.workKey ? [item.workKey] : [])));
    const workRemoved = workKeys.size > 0 ? removeWorkPageStars(workKeys) : [];
    const numberIds = new Set(mutable.flatMap((item) => (item.numberId ? [item.numberId] : [])));
    const numbersRemoved = numberIds.size > 0 ? removeSavedNumbers(numberIds) : [];
    const key = `removal-${(removalCounterRef.current += 1)}`;
    pendingRemovalsRef.current.set(key, {
      items: accountItems,
      removedIds: mutable.map((item) => item.id),
      pinnedBack: mutable.filter((item) => item.pinned && !item.numberId).length,
      workRemoved,
      numbersRemoved,
      toastId: null,
    });
    setPendingRemovalIds((current) => new Set([...current, ...accountItems.map((item) => item.id)]));
    setOpenSwipeId(null);
    const toastId = toast.push({
      tone: "info",
      title: mutable.length === 1 ? `Removed ${mutable[0]!.title}` : `Removed ${mutable.length} favourites`,
      duration: UNDO_TOAST_MS,
      action: { label: "Undo", onAction: () => settleRemoval(key, "cancel") },
      onClose: (reason) => settleRemoval(key, reason === "action" ? "cancel" : "commit"),
    });
    const entry = pendingRemovalsRef.current.get(key);
    if (entry) entry.toastId = toastId;
  }

  async function reorderItem(item: FavouriteItem, direction: -1 | 1) {
    setReorderPending(true);
    try {
      const moved = await handleReorder(item, direction);
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-reorder-id="${CSS.escape(item.id)}"][data-direction="${direction}"]`)
          ?.focus({ preventScroll: true });
      });
      announce(
        moved ? `${item.title} moved ${direction === -1 ? "up" : "down"}.` : `${item.title} could not be moved.`,
      );
    } finally {
      setReorderPending(false);
    }
  }

  async function dropReorder(items: FavouriteItem[]) {
    const setId = items[0]?.setId ?? null;
    const refs = items.flatMap((item) =>
      item.contentType && item.contentKey ? [{ contentType: item.contentType, contentKey: item.contentKey }] : [],
    );
    // Only saved account items can be ordered, and every one must be in the same set.
    if (!accountData || refs.length !== items.length || items.some((item) => (item.setId ?? null) !== setId)) return;
    setReorderPending(true);
    try {
      const saved = await accountData.setFavouriteOrder(setId, refs);
      announce(saved ? "New order saved." : "The new order could not be saved.");
      if (!saved) toast.push({ tone: "danger", title: "Could not save the new order", body: "Try again." });
    } finally {
      setReorderPending(false);
    }
  }

  async function deleteSet(set: AccountFavouriteSet) {
    if (!accountData) return;
    setMode("browse");
    setSelectedSetNames(new Set());
    const deleted = await accountData.deleteFavouriteSet(set.id);
    toast.push(
      deleted
        ? { tone: "success", title: `Deleted ${set.name}`, body: "Its favourites are still saved, now in Unsorted." }
        : { tone: "danger", title: "Could not delete the set", body: "Check your connection and try again." },
    );
  }

  async function chooseSetName(name: FavouriteSetName) {
    if (!accountData) return;
    const current = sheet;
    closeSheet();
    if (current?.kind === "rename-set") {
      const renamed = await accountData.renameFavouriteSet(current.set.id, name);
      if (renamed) {
        setSelectedSetNames(new Set([renamed.name]));
        toast.push({ tone: "success", title: `Renamed to ${renamed.name}` });
      } else {
        toast.push({ tone: "danger", title: "Could not rename the set", body: "Check your connection and try again." });
      }
      return;
    }
    const created = await accountData.createFavouriteSet(name);
    if (!created) {
      toast.push({ tone: "danger", title: "Could not create the set", body: "Check your connection and try again." });
      return;
    }
    const moving = current?.kind === "new-set" ? current.items : [];
    if (moving.length > 0) {
      await moveItems(moving, created.id);
      setSelectedSetNames(new Set([created.name]));
      leaveSpecialMode();
    } else {
      toast.push({
        tone: "success",
        title: `Created ${created.name}`,
        body: "Use Move to set on any favourite to add it.",
      });
    }
  }

  const listHandlers = {
    onOpen: handleOpen,
    onSelectForWorkspace: (item: FavouriteItem) => {
      setSelectedItemSnapshot(item);
      handleOpen(item);
      setSelectedItemId(item.id);
    },
    onShowActions: (item: FavouriteItem) => showActions(item),
    onTogglePin: (item: FavouriteItem) => void togglePin([item]),
    onMove: (item: FavouriteItem) => openSheet({ kind: "move", items: [item] }),
    onRemove: (item: FavouriteItem) => removeItems([item]),
    onToggleSelected: (item: FavouriteItem) =>
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      }),
  };
  const selectedTargets = libraryItems.filter((item) => selectedIds.has(item.id));

  const toggleSet = (name: string) => {
    const next = new Set(effectiveSelectedSets);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedSetNames(next);
  };
  const toggleType = (id: string) => {
    const next = new Set(selectedTypeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTypeIds(next);
  };
  const countWith = (overrides: Parameters<typeof passesFilters>[1]) =>
    libraryItems.filter((item) => passesFilters(item, overrides)).length;
  const setOptions = setChips.map((chip) => {
    const projected = effectiveSelectedSets.has(chip.name)
      ? effectiveSelectedSets
      : new Set([...effectiveSelectedSets, chip.name]);
    const count = countWith({ sets: projected });
    return {
      value: chip.name,
      label: chip.name,
      hint: String(count),
      disabled: !effectiveSelectedSets.has(chip.name) && count === 0,
    };
  });
  const typeOptions = typeTabs
    .map((tab) => {
      const projected = selectedTypeIds.has(tab.id) ? selectedTypeIds : new Set([...selectedTypeIds, tab.id]);
      const count = countWith({ typeIds: projected });
      return {
        value: tab.id,
        label: tab.label,
        hint: String(count),
        disabled: !selectedTypeIds.has(tab.id) && count === 0,
      };
    })
    .filter((option) => libraryItems.some((item) => item.tabId === option.value) || selectedTypeIds.has(option.value));
  const pinnedOnlyCount = countWith({ pinned: true });
  const sourceBackedCount = countWith({ sourceBacked: true });
  const filterGroups = [
    resultFilterFacetGroup({
      id: "set",
      label: "Set",
      selected: effectiveSelectedSets,
      options: setOptions,
      onToggle: toggleSet,
    }),
    resultFilterFacetGroup({
      id: "type",
      label: "Type",
      selected: selectedTypeIds,
      options: typeOptions,
      onToggle: toggleType,
    }),
    resultFilterFacetGroup({
      id: "pinned",
      label: "Pinned",
      selected: new Set(pinnedOnly ? ["pinned"] : []),
      options: [
        {
          value: "pinned",
          label: "Pinned only",
          hint: String(pinnedOnlyCount),
          disabled: !pinnedOnly && pinnedOnlyCount === 0,
        },
      ],
      onToggle: () => setPinnedOnly((current) => !current),
    }),
    resultFilterFacetGroup({
      id: "source",
      label: "Source support",
      selected: new Set(sourceBackedOnly ? ["source-backed"] : []),
      options: [
        {
          value: "source-backed",
          label: "Source-backed only",
          hint: String(sourceBackedCount),
          disabled: !sourceBackedOnly && sourceBackedCount === 0,
        },
      ],
      onToggle: () => setSourceBackedOnly((current) => !current),
    }),
  ];
  const appliedFilters = [
    ...[...effectiveSelectedSets].map((name) => ({
      id: `set-${name}`,
      groupLabel: "Set",
      valueLabel: name,
      onRemove: () => toggleSet(name),
    })),
    ...[...selectedTypeIds].map((id) => ({
      id: `type-${id}`,
      groupLabel: "Type",
      valueLabel: typeTabs.find((tab) => tab.id === id)?.label ?? id,
      onRemove: () => toggleType(id),
    })),
    ...(pinnedOnly
      ? [{ id: "pinned", groupLabel: "Status", valueLabel: "Pinned", onRemove: () => setPinnedOnly(false) }]
      : []),
    ...(sourceBackedOnly
      ? [
          {
            id: "source-backed",
            groupLabel: "Support",
            valueLabel: "Source-backed",
            onRemove: () => setSourceBackedOnly(false),
          },
        ]
      : []),
  ];

  if (!favouritesAccessible) {
    return (
      <main
        data-testid="favourites-hub"
        className="min-h-0 overflow-x-clip bg-[color:var(--background)] pb-4 text-[color:var(--text)] sm:grow sm:pb-32 md:pb-0"
      >
        <div className="mx-auto grid min-w-0 max-w-[40rem] gap-4 px-4 py-8 sm:px-6">
          <header data-testid="favourites-command-library" className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h1 className="text-balance text-2xl-minus font-bold leading-tight tracking-tight text-[color:var(--text-heading)] sm:text-2xl">
              {sharedHomePresentation.favourites.title}
            </h1>
            <p className="text-pretty text-sm-minus font-medium leading-6 text-[color:var(--text-muted)]">
              Sign up to save favourites and access them across devices.
            </p>
          </header>
          <div
            role="status"
            className="rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 py-4 text-sm font-semibold text-[color:var(--text)]"
          >
            <p>
              {authSettled
                ? "Favourites are tied to your account. Sign in or create an account to continue."
                : "Checking your account…"}
            </p>
            {authSettled ? (
              <button
                type="button"
                data-testid="favourites-open-account-setup"
                onClick={() => setAccountSetupDismissed(false)}
                className="mt-3 inline-flex min-h-tap items-center justify-center rounded-lg bg-[color:var(--clinical-accent)] px-4 text-sm font-semibold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--clinical-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                Sign up to save favourites
              </button>
            ) : null}
          </div>
        </div>
        <AccountSetupDialog
          open={accountSetupOpen}
          onClose={() => setAccountSetupDismissed(true)}
          intent="favourites"
        />
      </main>
    );
  }

  const summary = favouritesSummary({ itemCount: libraryItems.length, pinnedCount });
  const hasWorkPages = libraryItems.some(isWorkItem);
  const hasClinicalItems = libraryItems.some((item) => !isWorkItem(item));
  const showBand = searching || facetFilterCount > 0 || effectiveSelectedSets.size > 1;
  // One Filter button, always beside the view switcher, so it never moves or
  // swaps element when a filter is applied.
  const filterTrigger = (
    <ResultFilterTrigger
      panelId={filterPanelId}
      testId="favourites-filter-trigger"
      title="Filter favourites"
      open={filterOpen}
      activeCount={activeFilterCount}
      onToggle={() => setFilterOpen((current) => !current)}
    />
  );

  // Clinical and Work: one page, three ways to look at it. Sections draw in
  // the order Customise Favourites set, and hidden ones are left out. Continue
  // and the shelf belong to the All view; under Clinical or Work the chosen
  // list always shows, since hiding it would leave that view empty.
  const scopeItems = libraryItems.filter(inScope);
  const scopeCounts: Record<FavouritesScope, number> = {
    all: libraryItems.length,
    clinical: libraryItems.filter((item) => !isWorkItem(item)).length,
    work: libraryItems.filter(isWorkItem).length,
  };
  const scopeSwitchShown = libraryItems.length > 0 || scope !== "all";
  const sectionOn = (id: FavouritesSectionId) => sectionsShown.includes(id);
  const allScope = scope === "all";
  const showContinue = showLaunchpad && allScope && sectionOn("continue");
  const showShelf = newWorkMode && showLaunchpad && allScope && sectionOn("shelf") && shelf.length > 0;
  // In Select mode numbers join the Work list, so they can be ticked like anything else.
  const numbersSectionOn = !sampleMode && scope !== "clinical" && sectionOn("numbers") && effectiveMode === "browse";
  const numberItems = numbersSectionOn ? filteredItems.filter((item) => Boolean(item.numberId)) : [];
  const showNumbers =
    numbersSectionOn && (numberItems.length > 0 || (!searching && activeFilterCount === 0 && scopeItems.length > 0));
  // A search or a filter looks through everything: a hidden list never hides a match.
  const narrowing = searching || activeFilterCount > 0;
  const clinicalShown = allScope ? narrowing || sectionOn("clinical") : scope === "clinical";
  const workShown = allScope ? narrowing || sectionOn("work") : scope === "work";
  const clinicalItems = clinicalShown ? filteredItems.filter((item) => !isWorkItem(item)) : [];
  const workItems = workShown
    ? filteredItems.filter((item) => isWorkItem(item) && !(numbersSectionOn && item.numberId))
    : [];
  const labelLists = allScope && clinicalItems.length > 0 && workItems.length > 0;
  // The filter controls and any empty state sit where the first list does.
  const firstListSection = layout.order.find((id) => id === "clinical" || id === "work") ?? "clinical";
  const listsDrawn = filteredItems.length > 0;
  // Both lists hidden on All while there is something in them: say so, quietly, with a way back.
  const listsHiddenNote =
    allScope &&
    !narrowing &&
    !clinicalShown &&
    !workShown &&
    filteredItems.some((item) => !isWorkItem(item) || !(numbersSectionOn && item.numberId));
  const workScopeEmpty = (
    <div className="grid gap-3" data-testid="favourites-work-empty">
      <WorkEmpty
        icon={Heart}
        title="No work pages or numbers yet"
        body="Keep a roster, teaching page or ward number one tap away. They stay on this phone."
      />
      {sampleMode ? null : (
        <ul className="work-card work-rows" aria-label="Add to Work">
          {newWorkMode ? (
            <li>
              <button
                type="button"
                onClick={openAddWorkPage}
                className="work-row w-full text-left"
                data-testid="favourites-work-empty-add-page"
              >
                <WorkIconCircle icon={Plus} tone="neutral" />
                <span className="work-row__text">
                  <span className="work-row__title">Add a work page</span>
                  <span className="work-row__sub">A roster, teaching or admin page</span>
                </span>
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              onClick={openAddNumber}
              className="work-row w-full text-left"
              data-testid="favourites-work-empty-add-number"
            >
              <WorkIconCircle icon={Phone} tone="neutral" />
              <span className="work-row__text">
                <span className="work-row__title">Add a number</span>
                <span className="work-row__sub">A ward, service or pager, never a patient</span>
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
  const numberActionItem = numberActionId ? (libraryItems.find((item) => item.id === numberActionId) ?? null) : null;
  const pinnedInOrder = shelfItems(
    libraryItems.filter((item) => item.pinned),
    Number.MAX_SAFE_INTEGER,
    layout.pinOrder,
  );

  return (
    <main
      // Opts this page into the work-mode tokens (white cards, hairlines) the
      // shared Favourites shelf and rows are drawn with. Nothing else keys on it.
      data-work-frame="favourites"
      data-testid="favourites-hub"
      className={cn(
        "min-h-0 overflow-x-clip bg-[color:var(--surface-raised)] pb-4 text-[color:var(--text)] sm:grow sm:pb-32 md:pb-0",
        effectiveMode === "select" && "pb-28 sm:pb-32 md:pb-28",
      )}
    >
      <div
        className={cn(
          // min-h-full, not a viewport calc: the hub above grows to the shell's
          // fill box, so 100% of it is the real remaining height and the xl
          // split rail still reaches the bottom edge.
          "grid min-h-0 min-w-0 overflow-x-clip sm:min-h-full",
          // One column that only splits when the item workspace opens.
          selectedItem && "xl:grid-cols-[minmax(0,1fr)_23rem]",
        )}
      >
        <div className="min-w-0 overflow-x-hidden px-4 pb-6 pt-4 sm:px-6 sm:pt-5 lg:px-7">
          <div className="mx-auto grid min-w-0 max-w-[48rem] gap-3 xl:max-w-[56rem]">
            {/* Owner decision 2026-08-23: this standalone command library stays
                structurally distinct from the compact dashboard Favourites hub.
                The marketing lockup is retired here (ledger #164), and the
                2026-09-29 phone redesign keeps it that way: one compact title,
                one summary line and a Select action, so the saved items stay
                above the fold. The heading is not a hero. */}
            <header data-testid="favourites-command-library" className="flex min-w-0 items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col-reverse">
                <h1
                  id="favourites-page-heading"
                  tabIndex={-1}
                  className="text-balance text-2xl-minus font-bold leading-tight tracking-tight text-[color:var(--work-ink)] sm:text-2xl"
                >
                  {sharedHomePresentation.favourites.title}
                </h1>
                <p className="nums mb-0.5 text-xs font-semibold text-[color:var(--text-muted)]">
                  {clinicalLoadFailed && !hasClinicalItems
                    ? hasWorkPages
                      ? "Work pages only"
                      : "Not loaded"
                    : summary}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {mutableCount >= 2 ? (
                  <button
                    type="button"
                    aria-pressed={effectiveMode === "select"}
                    onClick={() => {
                      if (effectiveMode === "select") {
                        leaveSpecialMode();
                        return;
                      }
                      setMode("select");
                      setSelectedIds(new Set());
                      setOpenSwipeId(null);
                    }}
                    className={cn(
                      "inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold",
                      effectiveMode === "select"
                        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] text-[color:var(--work-ink)] active:bg-[color:var(--work-wash)]",
                      focusRing,
                    )}
                  >
                    <CheckSquare className="size-icon-sm" aria-hidden="true" />
                    {effectiveMode === "select" ? "Done" : "Select"}
                  </button>
                ) : null}
                {sampleMode ? null : (
                  <button
                    type="button"
                    aria-label="Customise Favourites"
                    aria-haspopup="dialog"
                    onClick={() => {
                      rememberSheetOrigin();
                      setSheetOpen(false);
                      setCustomiseOpen(true);
                    }}
                    data-testid="favourites-customise"
                    className={cn(
                      "grid size-tap shrink-0 place-items-center rounded-full border border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] text-[color:var(--work-ink)] active:bg-[color:var(--work-wash)]",
                      focusRing,
                    )}
                  >
                    <SlidersHorizontal className="size-icon-md" aria-hidden="true" />
                  </button>
                )}
              </div>
            </header>

            <DesktopComposerPortalSlot
              id={modeHomeDesktopComposerSlotId}
              data-composer-reserve={modeHomeComposerReservePendingValue}
              className="mode-home-composer-slot favourites-composer-slot -mt-1 block w-full max-w-3xl min-h-0 data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-phone)] sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] [&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-phone)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
            />

            {sampleMode ? (
              <SignedOutSampleNotice title="Sign in to see your favourites" testId="favourites-signed-out-sample">
                Below is a sample made of real entries from the app, so you can see how Favourites works. Pinning works
                here, but the sample doesn&apos;t save. Signed in, it shows the items you save. Nothing is shared.
              </SignedOutSampleNotice>
            ) : !demoMode && auth.status !== "authenticated" && auth.status !== "loading" ? (
              <p
                role="status"
                className="rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 py-3 text-sm font-semibold text-[color:var(--text)]"
              >
                Sign in or create an account from Account settings to save favourites and access them across devices.
              </p>
            ) : null}

            {!online ? (
              <p
                role="status"
                data-testid="favourites-offline"
                className="m-0 flex min-w-0 items-center gap-2.5 rounded-[var(--work-radius-card)] bg-[color:var(--work-wash)] px-3 py-2.5 text-sm font-semibold text-[color:var(--text-muted)]"
              >
                <CloudOff className="size-icon-sm shrink-0" aria-hidden="true" />
                Offline. Showing what this device last loaded. Changes wait until you are back online.
              </p>
            ) : null}

            {clinicalLoadFailed && !showBand ? (
              <FavouritesLoadFailedBand
                hasClinicalItems={hasClinicalItems}
                hasWorkPages={hasWorkPages}
                onRetry={refetchFavouritesRegistry}
              />
            ) : null}

            {scopeSwitchShown ? (
              <SegmentedControl<FavouritesScope>
                label="Show favourites"
                layout="equal"
                value={scope}
                onChange={(next) => {
                  setScopeChoice(next);
                  setOpenSwipeId(null);
                  if (mode === "reorder") setMode("browse");
                }}
                options={scopeOptions.map((option) => ({ ...option, hint: String(scopeCounts[option.value]) }))}
              />
            ) : null}

            {layout.order.map((sectionId) => (
              <Fragment key={sectionId}>
                {sectionId === "continue" && showContinue && continueItem ? (
                  <FavouritesContinueCard item={continueItem} now={now} onOpen={handleOpen} />
                ) : null}

                {sectionId === "shelf" && showShelf ? (
                  <section aria-labelledby="favourites-shelf-heading" className="grid gap-1.5">
                    <WorkSectionLabel
                      id="favourites-shelf-heading"
                      action={
                        sampleMode || libraryItems.length === 0
                          ? undefined
                          : {
                              label: "Arrange",
                              onClick: () => {
                                rememberSheetOrigin();
                                setSheetOpen(false);
                                setArrangeOpen(true);
                              },
                            }
                      }
                    >
                      On My Day
                    </WorkSectionLabel>
                    <FavouritesShelf
                      items={shelf}
                      limit={layout.shelfSize}
                      aria-labelledby="favourites-shelf-heading"
                      onOpen={handleOpen}
                      onShowActions={showActions}
                      onOpenNumber={showActions}
                      onAdd={sampleMode ? undefined : openAddWorkPage}
                    />
                  </section>
                ) : null}

                {sectionId === "numbers" && showNumbers ? (
                  <NumbersSection
                    items={numberItems}
                    canAdd={!searching && activeFilterCount === 0}
                    onAdd={openAddNumber}
                    onShowActions={showActions}
                    onCall={handleOpen}
                  />
                ) : null}

                {sectionId === firstListSection ? (
                  <>
                    {libraryItems.length > 0 && scope !== "work" ? (
                      <FavouritesSetChips
                        chips={setChips}
                        totalCount={libraryItems.length}
                        selectedSets={effectiveSelectedSets}
                        onSelect={(name) => {
                          setSelectedSetNames(name ? new Set([name]) : new Set());
                          setSetView("order");
                          if (mode === "reorder") setMode("browse");
                          setOpenSwipeId(null);
                        }}
                        onNewSet={canCreateSet ? () => openSheet({ kind: "new-set", items: [] }) : undefined}
                      />
                    ) : null}

                    {showBand ? (
                      <SearchResultsHeaderBand
                        modeId="favourites"
                        query={activeQuery}
                        matchCount={filteredItems.length}
                        // Without this a failed registry read renders as "0 matches", which
                        // reads as "you have no saved favourites" rather than "we could not
                        // load them". `partial` keeps unaffected items (local
                        // differentials, etc.) visible without presenting their nonzero
                        // count as the complete library.
                        status={favouritesRegistryStatus}
                        onRetry={
                          favouritesRegistryStatus === "error" || favouritesRegistryStatus === "partial"
                            ? refetchFavouritesRegistry
                            : undefined
                        }
                        filterLabel="Active favourites filters"
                        appliedFilters={appliedFilters}
                        onClearFilters={activeFilterCount > 0 ? clearAllFilters : undefined}
                      />
                    ) : null}

                    <ResultFilterSheet
                      open={filterOpen}
                      onClose={() => setFilterOpen(false)}
                      panelId={filterPanelId}
                      testId="favourites-filter-panel"
                      title="Filter favourites"
                      description="Combine sets, item types, pinned status and source support."
                      chromeResetKey={[
                        activeQuery,
                        Array.from(effectiveSelectedSets).sort().join(","),
                        Array.from(selectedTypeIds).sort().join(","),
                        String(pinnedOnly),
                        String(sourceBackedOnly),
                      ].join("|")}
                      groups={filterGroups}
                      onClearAll={activeFilterCount > 0 ? clearAllFilters : undefined}
                      summary={{
                        count: filteredItems.length,
                        noun: filteredItems.length === 1 ? "favourite" : "favourites",
                      }}
                    />

                    {singleSetName && !showBand ? (
                      <FavouritesSetBar
                        name={singleSetName}
                        count={filteredItems.length}
                        reordering={effectiveMode === "reorder"}
                        onToggleReorder={
                          view === "order" && singleSetMutableCount >= 2 && accountSetForChip
                            ? () => {
                                setOpenSwipeId(null);
                                setMode(effectiveMode === "reorder" ? "browse" : "reorder");
                              }
                            : undefined
                        }
                        onRename={
                          accountSetForChip
                            ? () => openSheet({ kind: "rename-set", set: accountSetForChip })
                            : undefined
                        }
                        onDelete={accountSetForChip ? () => setConfirmDeleteSet(accountSetForChip) : undefined}
                      />
                    ) : null}

                    {/* Nothing to order when the only work items are the numbers above. */}
                    {libraryItems.length > 0 &&
                    (clinicalItems.length + workItems.length > 0 || searching || activeFilterCount > 0) ? (
                      <div className="flex min-w-0 items-center gap-2 pt-1">
                        <SegmentedControl<FavouritesView>
                          label="Organise favourites"
                          layout="equal"
                          value={view}
                          onChange={(next) => {
                            if (singleSetName) setSetView(next);
                            else setAllView(next);
                            if (next !== "order" && mode === "reorder") setMode("browse");
                          }}
                          options={singleSetName ? viewOptions.set : viewOptions.all}
                          className="min-w-0 flex-1"
                        />
                        <span className="shrink-0">{filterTrigger}</span>
                      </div>
                    ) : null}

                    {effectiveMode === "reorder" ? (
                      <p className="text-sm text-[color:var(--text-muted)]">
                        Use the arrows to put this set in the order you use it. Tap Done when finished.
                      </p>
                    ) : null}

                    {/* Only a successful read can say "no matches". While loading or
                          faulted an empty list means we could not look, not that the
                          library is empty; the band's fault panel reports that. */}
                    {searching && filteredItems.length === 0 && favouritesRegistryStatus === "ready" ? (
                      <SearchResultsEmptyState
                        modeId="favourites"
                        query={activeQuery}
                        appliedFilters={appliedFilters}
                        onClearFilters={activeFilterCount > 0 ? clearAllFilters : undefined}
                        onClearSearch={clearSearch}
                      />
                    ) : filteredItems.length === 0 ? (
                      scopeItems.length > 0 ? (
                        <FavouritesEmptyMatches />
                      ) : scope === "work" ? (
                        workScopeEmpty
                      ) : favouritesRegistryStatus === "ready" ? (
                        <div className="grid gap-3">
                          <WorkEmpty
                            icon={Heart}
                            title="Save what you open most"
                            body={
                              newWorkMode
                                ? "Tap the heart on a service, form, diagnosis or therapy. Add a work page to keep it one tap away on My Day."
                                : "Tap the heart on a service, form, diagnosis or therapy."
                            }
                            action={
                              sampleMode || !newWorkMode ? undefined : (
                                <WorkButton onClick={openAddWorkPage} testId="favourites-empty-add-work-page">
                                  Add a work page
                                </WorkButton>
                              )
                            }
                            testId="favourites-empty-library"
                          />
                          <ul className="work-card work-rows" aria-label="Find something to save">
                            <li>
                              <Link href="/services" className="work-row">
                                <WorkIconCircle icon={Users} />
                                <span className="work-row__text">
                                  <span className="work-row__title">Browse services</span>
                                  <span className="work-row__sub">Save one to see it here</span>
                                </span>
                                <ChevronRight className="work-row__chev" aria-hidden="true" />
                              </Link>
                            </li>
                            <li>
                              <Link href="/forms" className="work-row">
                                <WorkIconCircle icon={FileText} />
                                <span className="work-row__text">
                                  <span className="work-row__title">Browse forms</span>
                                  <span className="work-row__sub">Mental Health Act forms and more</span>
                                </span>
                                <ChevronRight className="work-row__chev" aria-hidden="true" />
                              </Link>
                            </li>
                          </ul>
                        </div>
                      ) : favouritesRegistryStatus === "loading" ? (
                        <ul className="work-card work-rows" aria-busy="true" aria-label="Loading favourites">
                          {[0, 1, 2, 3].map((index) => (
                            <li key={index} className="work-row" aria-hidden="true">
                              <span className="size-9 shrink-0 rounded-full bg-[color:var(--work-wash)]" />
                              <span className="grid flex-1 gap-1.5">
                                <span className="h-2.5 w-3/5 rounded-full bg-[color:var(--work-wash)]" />
                                <span className="h-2 w-2/5 rounded-full bg-[color:var(--work-wash)]" />
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null
                    ) : null}

                    {listsHiddenNote ? (
                      <div
                        className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1"
                        data-testid="favourites-lists-hidden"
                      >
                        <p className="m-0 min-w-0 text-sm text-[color:var(--text-muted)]">
                          Clinical and Work lists are hidden.
                        </p>
                        <WorkButton
                          variant="secondary"
                          onClick={() =>
                            setFavouritesLayout({
                              hidden: layout.hidden.filter((id) => id !== "clinical" && id !== "work"),
                            })
                          }
                          testId="favourites-lists-hidden-show"
                        >
                          Show them
                        </WorkButton>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {sectionId === "clinical" && listsDrawn && clinicalShown && clinicalItems.length > 0 ? (
                  <section
                    aria-labelledby={labelLists ? "favourites-clinical-heading" : undefined}
                    className="grid gap-1.5"
                  >
                    {labelLists ? (
                      <WorkSectionLabel
                        id="favourites-clinical-heading"
                        count={<span className="nums">{clinicalItems.length}</span>}
                      >
                        Clinical
                      </WorkSectionLabel>
                    ) : null}
                    <FavouritesList
                      groups={groupForView(clinicalItems, view, now)}
                      view={view}
                      now={now}
                      showSet={!singleSetName}
                      mode={effectiveMode}
                      selectedIds={selectedIds}
                      workspaceItemId={selectedItemId}
                      openSwipeId={openSwipeId}
                      onOpenSwipeChange={setOpenSwipeId}
                      canMutate={canMutate}
                      canMove={canMove}
                      handlers={listHandlers}
                      srHeading={labelLists ? null : "Saved favourites"}
                      reorder={
                        effectiveMode === "reorder"
                          ? {
                              pending: reorderPending,
                              onMove: (item, direction) => void reorderItem(item, direction),
                              onDrop: (items) => void dropReorder(items),
                            }
                          : undefined
                      }
                    />
                  </section>
                ) : null}

                {sectionId === "work" && listsDrawn && workShown && workItems.length > 0 ? (
                  <section
                    aria-labelledby={labelLists ? "favourites-work-heading" : undefined}
                    className="grid gap-1.5"
                  >
                    {labelLists ? (
                      <WorkSectionLabel
                        id="favourites-work-heading"
                        count={<span className="nums">{workItems.length}</span>}
                      >
                        Work
                      </WorkSectionLabel>
                    ) : null}
                    <FavouritesList
                      groups={groupForView(workItems, view, now)}
                      view={view}
                      now={now}
                      showSet={!singleSetName}
                      mode={effectiveMode}
                      selectedIds={selectedIds}
                      workspaceItemId={selectedItemId}
                      openSwipeId={openSwipeId}
                      onOpenSwipeChange={setOpenSwipeId}
                      canMutate={canMutate}
                      canMove={canMove}
                      handlers={listHandlers}
                      srHeading={labelLists ? null : "Saved favourites"}
                      idPrefix="favourites-work-group"
                      testId="favourites-work-list"
                    />
                  </section>
                ) : null}
              </Fragment>
            ))}

            {newWorkMode && showLaunchpad && libraryItems.length > 0 && !sampleMode && scope !== "clinical" ? (
              <div className="work-card">
                <button
                  type="button"
                  onClick={openAddWorkPage}
                  className="work-row"
                  data-testid="favourites-add-work-page-row"
                >
                  <WorkIconCircle icon={Plus} tone="neutral" />
                  <span className="work-row__text">
                    <span className="work-row__title">Add a work page</span>
                    <span className="work-row__sub">Keep a roster, teaching or admin page one tap away</span>
                  </span>
                </button>
              </div>
            ) : null}

            {libraryItems.some((item) => item.example) ? (
              <p className="rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-3 py-2 text-xs text-[color:var(--text-muted)]">
                {sampleMode ? "Sample favourites. The sample doesn't save." : FAVOURITE_EXAMPLES_NOTICE}
              </p>
            ) : null}

            {libraryItems.length > 0 && !sampleMode ? (
              <p className="m-0 flex items-start gap-1.5 px-1 text-xs leading-snug text-[color:var(--text-muted)]">
                <ShieldCheck className="mt-px size-icon-xs shrink-0" aria-hidden="true" />
                Clinical items follow your account. Work pages, numbers, names, notes and layout stay on this phone and
                clear when you sign out.
              </p>
            ) : null}

            <UniversalSearchAlsoMatches modeId="favourites" query={activeQuery} />
          </div>
        </div>
        {selectedItem ? (
          <ItemWorkspace
            key={selectedItem.id}
            item={selectedItem}
            sets={accountSets}
            onClose={() => {
              setSelectedItemId(null);
              setSelectedItemSnapshot(null);
            }}
            onMove={handleMoveNow}
            // Same held-back removal with Undo as everywhere else on the page.
            onRemove={async (item) => {
              removeItems([item]);
              return true;
            }}
            onReorder={handleReorder}
            onOpen={handleOpen}
          />
        ) : null}
      </div>

      {effectiveMode === "select" ? (
        <FavouritesSelectBar
          count={selectedTargets.length}
          canMove={selectedTargets.length === 0 || selectedTargets.some(canMove)}
          onDone={leaveSpecialMode}
          onPin={() => {
            void togglePin(selectedTargets);
            leaveSpecialMode();
          }}
          onMove={() => openSheet({ kind: "move", items: selectedTargets.filter(canMove) })}
          onRemove={() => setConfirmRemoveIds(selectedTargets.map((item) => item.id))}
        />
      ) : null}

      {sheetContent?.kind === "actions" ? (
        <FavouriteActionsSheet
          // A new item gets a fresh sheet, so "Copied" never carries over.
          key={sheetContent.item.id}
          item={libraryItems.find((item) => item.id === sheetContent.item.id) ?? sheetContent.item}
          open={sheetOpen}
          returnFocusTarget={returnFocusToOrigin}
          onClose={() => closeSheet()}
          canMutate={canMutate(sheetContent.item)}
          onOpen={handleOpen}
          onTogglePin={(item) => void togglePin([item])}
          onCopyCitation={copyFavouriteCitation}
          onMove={(item) => openSheet({ kind: "move", items: [item] })}
          onRemove={(item) => removeItems([item])}
          onEdit={canMutate(sheetContent.item) ? editFavourite : undefined}
        />
      ) : null}
      {sheetContent?.kind === "move" ? (
        <FavouriteMoveSheet
          items={sheetContent.items}
          open={sheetOpen}
          returnFocusTarget={returnFocusToOrigin}
          sets={accountSets}
          canCreateSet={canCreateSet}
          onClose={() => closeSheet()}
          onPick={(setId) => {
            const targets = sheetContent.items;
            closeSheet();
            void moveItems(targets, setId).then(() => {
              if (targets.length > 1) leaveSpecialMode();
            });
          }}
          onNewSet={() => openSheet({ kind: "new-set", items: sheetContent.items })}
        />
      ) : null}
      {sheetContent?.kind === "new-set" || sheetContent?.kind === "rename-set" ? (
        <FavouriteSetNameSheet
          key={sheetContent.kind === "rename-set" ? sheetContent.set.id : "new-set"}
          mode={sheetContent.kind === "new-set" ? "create" : "rename"}
          open={sheetOpen}
          returnFocusTarget={returnFocusToOrigin}
          currentName={sheetContent.kind === "rename-set" ? sheetContent.set.name : undefined}
          existingNames={accountSets.map((set) => set.name)}
          suggestedNames={availableSetNames}
          movingCount={sheetContent.kind === "new-set" ? sheetContent.items.length : 0}
          onClose={() => closeSheet()}
          onChoose={(name) => void chooseSetName(name)}
        />
      ) : null}
      {newWorkMode ? (
        <AddWorkPageSheet
          open={addWorkPageOpen}
          onClose={() => setAddWorkPageOpen(false)}
          returnFocusTarget={returnFocusToOrigin}
        />
      ) : null}
      <NumberActionsSheet
        item={numberActionItem}
        onClose={() => setNumberActionId(null)}
        onEdit={(item) => {
          setNumberActionId(null);
          editFavourite(item);
        }}
        onTogglePin={(item) => void togglePin([item])}
        onRemove={(item) => {
          setNumberActionId(null);
          removeItems([item]);
        }}
        returnFocusTarget={returnFocusToOrigin}
      />
      <NumberFormSheet
        open={numberFormOpen}
        onClose={() => setNumberFormOpen(false)}
        editing={editingNumber}
        returnFocusTarget={returnFocusToOrigin}
        pinRoom={pinnedCount < QUICK_LAUNCH_LIMIT}
      />
      <EditFavouriteSheet
        item={editItem}
        overrideName={editItem ? overrides[editItem.id]?.name : undefined}
        overrideNote={editItem ? overrides[editItem.id]?.note : undefined}
        onClose={() => setEditItem(null)}
        returnFocusTarget={returnFocusToOrigin}
      />
      <CustomiseFavouritesSheet
        open={customiseOpen}
        onClose={() => setCustomiseOpen(false)}
        returnFocusTarget={returnFocusToOrigin}
      />
      <ArrangeShelfSheet
        open={arrangeOpen}
        onClose={() => setArrangeOpen(false)}
        returnFocusTarget={returnFocusToOrigin}
        pinned={pinnedInOrder}
        unpinned={libraryItems.filter((item) => !item.pinned && !item.example)}
        pinLimit={QUICK_LAUNCH_LIMIT}
        onTogglePin={(item) => void togglePin([item])}
      />
      <ConfirmDialog
        open={confirmDeleteSet !== null}
        title={`Delete ${confirmDeleteSet?.name ?? "set"}?`}
        description="The set is deleted. Its favourites stay saved and move to Unsorted."
        confirmLabel="Delete set"
        onCancel={() => setConfirmDeleteSet(null)}
        onConfirm={() => {
          const set = confirmDeleteSet;
          setConfirmDeleteSet(null);
          if (set) void deleteSet(set);
        }}
      />
      <ConfirmDialog
        open={confirmRemoveIds !== null}
        title={`Remove ${confirmRemoveIds?.length ?? 0} ${confirmRemoveIds?.length === 1 ? "favourite" : "favourites"}?`}
        description="They leave your favourites. You can undo this from the message that appears."
        confirmLabel={`Remove ${confirmRemoveIds?.length ?? 0} ${confirmRemoveIds?.length === 1 ? "favourite" : "favourites"}`}
        onCancel={() => setConfirmRemoveIds(null)}
        onConfirm={() => {
          const ids = confirmRemoveIds ?? [];
          setConfirmRemoveIds(null);
          removeItems(libraryItems.filter((item) => ids.includes(item.id)));
          leaveSpecialMode();
        }}
      />
    </main>
  );
}
