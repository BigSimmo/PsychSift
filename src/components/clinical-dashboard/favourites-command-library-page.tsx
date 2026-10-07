"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronsRight,
  Copy,
  ExternalLink,
  Folder,
  Search,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useSearchCommand } from "@/components/clinical-dashboard/search-command-context";
import {
  favouriteSetNames,
  type AccountFavouriteSet,
  type FavouriteSetName,
  useOptionalAccountData,
} from "@/components/account-data-provider";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
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
import { toCommandItem } from "@/components/favourites/favourite-items";
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
import { FavouritesContinueCard, FavouritesQuickLaunch } from "@/components/favourites/favourites-launchpad";
import { FavouritesList, FavouritesSelectBar } from "@/components/favourites/favourites-list";
import { FavouritesSetBar, FavouritesSetChips } from "@/components/favourites/favourites-set-chips";
import {
  buildSetChips,
  favouritesSummary,
  groupForView,
  isSourceBacked,
  matchesFavouriteSearch,
  pickContinueItem,
  QUICK_LAUNCH_LIMIT,
  quickLaunchItems,
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
import { modeHomeComposerReservePendingValue, modeHomeDesktopComposerSlotId } from "@/lib/mode-home-composer";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { useAuthSession } from "@/lib/supabase/client";

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
};

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
  return `${item.title}\n${evidenceLine}\n${item.href}`;
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
  const items = useMemo(
    () => [
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
    ],
    [
      demoMode,
      sampleMode,
      sampleFavourites,
      savedRegistryFavourites,
      lastOpenedMap,
      pinnedIds,
      favouriteMetadata,
      setById,
      now,
    ],
  );

  // Remove is held back until its Undo message closes, so a removed row hides
  // here at once while the account still holds it.
  const [pendingRemovalIds, setPendingRemovalIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRemovalsRef = useRef(new Map<string, { items: FavouriteItem[]; toastId: string | null }>());
  const removalCounterRef = useRef(0);
  const accountDataRef = useRef(accountData);
  const toastRef = useRef<ToastApi | null>(null);
  useEffect(() => {
    accountDataRef.current = accountData;
  }, [accountData]);

  // Settles one held-back removal exactly once: `cancel` (Undo, or the account
  // changed) keeps the favourite; `commit` deletes it through the account that
  // is current now. Refs only, so it is safe from effects and stale closures.
  const settleRemoval = useCallback((key: string, outcome: "commit" | "cancel") => {
    const entry = pendingRemovalsRef.current.get(key);
    if (!entry) return;
    pendingRemovalsRef.current.delete(key);
    const ids = entry.items.map((item) => item.id);
    const release = () => setPendingRemovalIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
    const account = accountDataRef.current;
    if (outcome === "cancel" || !account) {
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

  // A different account (or signing out) must never inherit this account's
  // pending removals: keep the favourites and drop the messages.
  useEffect(
    () => () => {
      for (const [key, entry] of [...pendingRemovalsRef.current]) {
        settleRemoval(key, "cancel");
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

  const orderedSetNames = useMemo(
    () => [
      ...accountSets.map((set) => set.name as string),
      ...(demoMode ? prototypeFavouriteSets.map((set) => set.title) : []),
    ],
    [accountSets, demoMode],
  );
  const setChips = useMemo(() => buildSetChips(libraryItems, orderedSetNames), [libraryItems, orderedSetNames]);

  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSetNames, setSelectedSetNames] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedTypeIds, setSelectedTypeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sourceBackedOnly, setSourceBackedOnly] = useState(false);
  const [allView, setAllView] = useState<FavouritesView>("recent");
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

  // A chosen set that has emptied (moved away, removed) drops out of the filter.
  const effectiveSelectedSets = useMemo(
    () => new Set([...selectedSetNames].filter((name) => setChips.some((chip) => chip.name === name))),
    [selectedSetNames, setChips],
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
    (sets.size === 0 || sets.has(item.set)) &&
    (typeIds.size === 0 || typeIds.has(item.tabId)) &&
    (!pinned || item.pinned === true) &&
    (!sourceBacked || isSourceBacked(item)) &&
    matchesFavouriteSearch(item, activeQuery);

  // Single source of truth for "what is in the list right now". The band's
  // match count, the empty-state branch and the list all read this one value.
  const filteredItems = libraryItems.filter((item) => passesFilters(item));
  const groups = groupForView(filteredItems, view, now);
  const quickLaunch = quickLaunchItems(libraryItems);
  const continueItem = pickContinueItem(libraryItems);
  const listAnnouncementKey = `${[...effectiveSelectedSets].sort().join("|")}::${view}`;
  const lastAnnouncementKeyRef = useRef(listAnnouncementKey);
  useEffect(() => {
    if (lastAnnouncementKeyRef.current === listAnnouncementKey) return;
    lastAnnouncementKeyRef.current = listAnnouncementKey;
    announce(`Showing ${filteredItems.length} ${filteredItems.length === 1 ? "favourite" : "favourites"}.`);
  }, [listAnnouncementKey, filteredItems.length]);
  const showLaunchpad = !searching && activeFilterCount === 0 && effectiveMode === "browse";

  const canMutate = (item: FavouriteItem) =>
    Boolean(item.contentType && item.contentKey && accountData?.isAuthenticated && !item.example);
  const mutableCount = libraryItems.filter(canMutate).length;
  const availableSetNames = favouriteSetNames.filter(
    (name) => !accountSets.some((set) => set.name.toLowerCase() === name.toLowerCase()),
  );
  const canCreateSet = Boolean(accountData?.isAuthenticated) && accountSets.length < maxFavouriteSetsPerAccount;
  const accountSetForChip = singleSetName ? accountSets.find((set) => set.name === singleSetName) : undefined;
  const singleSetMutableCount = singleSetName
    ? filteredItems.filter((item) => item.set === singleSetName && canMutate(item)).length
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
    if (canMutate(item) && accountData) {
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
      toast.push(
        failed === 0
          ? {
              tone: "success",
              title: targets.length === 1 ? "Removed from quick launch" : `${targets.length} removed from quick launch`,
            }
          : {
              tone: "danger",
              title: `${failed} could not be removed from quick launch`,
              body: "Check your connection and try again.",
            },
      );
      return;
    }
    const toAdd = targets.filter((item) => !item.pinned);
    const room = QUICK_LAUNCH_LIMIT - libraryItems.filter((item) => item.pinned).length;
    if (room <= 0) {
      toast.push({ tone: "warning", title: "Quick launch is full", body: "Remove one of the four first." });
      return;
    }
    const adding = toAdd.slice(0, room);
    const results = await Promise.all(adding.map((item) => setItemPinned(item, true)));
    const failed = results.filter((saved) => !saved).length;
    if (failed > 0) {
      toast.push({
        tone: "danger",
        title: `${failed} could not be added to quick launch`,
        body: "Check your connection and try again.",
      });
      return;
    }
    toast.push({
      tone: "success",
      title: adding.length === 1 ? "Added to quick launch" : `${adding.length} added to quick launch`,
      body: adding.length < toAdd.length ? "Quick launch holds four. The rest were not added." : undefined,
    });
  }

  async function moveItems(targets: FavouriteItem[], setId: string | null) {
    const mutable = targets.filter(canMutate).filter((item) => (item.setId ?? null) !== setId);
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
    const key = `removal-${(removalCounterRef.current += 1)}`;
    pendingRemovalsRef.current.set(key, { items: mutable, toastId: null });
    setPendingRemovalIds((current) => new Set([...current, ...mutable.map((item) => item.id)]));
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
    onShowActions: (item: FavouriteItem) => openSheet({ kind: "actions", item }),
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
  const typeOptions = favouriteTabs
    .filter((tab) => tab.id !== "all" && tab.id !== "sets")
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
  const pinnedCount = countWith({ pinned: true });
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
          hint: String(pinnedCount),
          disabled: !pinnedOnly && pinnedCount === 0,
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
      valueLabel: favouriteTabs.find((tab) => tab.id === id)?.label ?? id,
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

  const summary = favouritesSummary({
    itemCount: libraryItems.length,
    setCount: setChips.filter((chip) => chip.name !== UNSORTED_SET_NAME).length,
    quickLaunchCount: quickLaunch.length,
  });
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

  return (
    <main
      data-testid="favourites-hub"
      className={cn(
        "min-h-0 overflow-x-clip bg-[color:var(--background)] pb-4 text-[color:var(--text)] sm:grow sm:pb-32 md:pb-0",
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
          <div className="mx-auto grid min-w-0 max-w-[48rem] gap-4 xl:max-w-[56rem]">
            {/* Owner decision 2026-08-23: this standalone command library stays
                structurally distinct from the compact dashboard Favourites hub.
                The marketing lockup is retired here (ledger #164), and the
                2026-09-29 phone redesign keeps it that way: one compact title,
                one summary line and a Select action, so the saved items stay
                above the fold. The heading is not a hero. */}
            <header data-testid="favourites-command-library" className="flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <h1
                  id="favourites-page-heading"
                  tabIndex={-1}
                  className="text-balance text-2xl-minus font-bold leading-tight tracking-tight text-[color:var(--text-heading)] sm:text-2xl"
                >
                  {sharedHomePresentation.favourites.title}
                </h1>
                <p className="nums mt-1 text-sm font-medium text-[color:var(--text-muted)]">{summary}</p>
              </div>
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
                    "inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold",
                    effectiveMode === "select"
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
                    focusRing,
                  )}
                >
                  <CheckSquare className="size-icon-sm" aria-hidden="true" />
                  {effectiveMode === "select" ? "Done" : "Select"}
                </button>
              ) : null}
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

            {libraryItems.length > 0 ? (
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
              summary={{ count: filteredItems.length, noun: filteredItems.length === 1 ? "favourite" : "favourites" }}
            />

            {showLaunchpad && continueItem ? (
              <FavouritesContinueCard item={continueItem} now={now} onOpen={handleOpen} />
            ) : null}

            {showLaunchpad ? (
              <FavouritesQuickLaunch
                items={quickLaunch}
                hasPinnableItems={mutableCount > 0}
                onOpen={handleOpen}
                onShowActions={(item) => openSheet({ kind: "actions", item })}
              />
            ) : null}

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
                  accountSetForChip ? () => openSheet({ kind: "rename-set", set: accountSetForChip }) : undefined
                }
                onDelete={accountSetForChip ? () => setConfirmDeleteSet(accountSetForChip) : undefined}
              />
            ) : null}

            {libraryItems.length > 0 ? (
              <div className="flex min-w-0 items-center gap-2">
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
              libraryItems.length > 0 ? (
                <FavouritesEmptyMatches />
              ) : favouritesRegistryStatus === "ready" ? (
                <EmptyState
                  icon={Folder}
                  title="No favourites yet"
                  body="Tap the heart on any service, form, differential or therapy to save it here."
                  testId="favourites-empty-library"
                />
              ) : null
            ) : (
              <FavouritesList
                groups={groups}
                view={view}
                now={now}
                showSet={!singleSetName}
                mode={effectiveMode}
                selectedIds={selectedIds}
                workspaceItemId={selectedItemId}
                openSwipeId={openSwipeId}
                onOpenSwipeChange={setOpenSwipeId}
                canMutate={canMutate}
                handlers={listHandlers}
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
            )}

            {libraryItems.some((item) => item.example) ? (
              <p className="rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-3 py-2 text-xs text-[color:var(--text-muted)]">
                {sampleMode ? "Sample favourites. The sample doesn't save." : FAVOURITE_EXAMPLES_NOTICE}
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
          onDone={leaveSpecialMode}
          onPin={() => {
            void togglePin(selectedTargets);
            leaveSpecialMode();
          }}
          onMove={() => openSheet({ kind: "move", items: selectedTargets })}
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
