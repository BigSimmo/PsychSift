"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useOptionalAccountData } from "@/components/account-data-provider";
import { useSavedRegistryFavourites } from "@/components/clinical-dashboard/use-saved-registry-favourites";
import { applyOverride, numberToItem, toCommandItem, workStarToItem } from "@/components/favourites/favourite-items";
import {
  loadFavouriteLastOpened,
  loadFavouritePinnedIds,
  recordFavouriteOpened,
  subscribeFavouritesStorage,
} from "@/components/favourites/favourites-storage";
import { shelfItems, type FavouriteItem } from "@/components/favourites/favourites-view-model";
import type { SavedFavouritesBandStatus } from "@/components/clinical-dashboard/saved-registry-favourites-status";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import {
  recordNumberOpened,
  useFavouriteOverrides,
  useFavouritesLayout,
  useSavedNumbers,
} from "@/lib/favourites/favourites-local";
import { recordWorkPageOpened, resolveWorkPageStars, useWorkPageStars } from "@/lib/favourites/work-page-stars";

/**
 * Everything saved to Favourites, in one list, for anywhere outside the
 * Favourites page that shows it (My Day Today's shelf, the My Day Favourites
 * page). Clinical items come from the account; work pages, saved numbers,
 * the person's own names and notes, and the shelf's size and pin order come
 * from this device (`favourites-local.ts`).
 * The Favourites page builds the same items with the same converters
 * (`favourite-items.ts`), plus its demo and sample fixtures.
 */

const EMPTY_LAST_OPENED: Record<string, number> = {};
const EMPTY_PINNED: ReadonlySet<string> = new Set();
const getEmptyLastOpened = () => EMPTY_LAST_OPENED;
const getEmptyPinned = () => EMPTY_PINNED;

function getMinuteNow() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
const getServerNow = () => 0;

export type FavouritesShelfState = {
  /** Every saved item, clinical, work pages and numbers, with the person's own names and notes applied. */
  readonly items: readonly FavouriteItem[];
  /** The shelf, in shelf order: as many tiles as the person chose (four or eight), pins in their arranged order. */
  readonly shelf: readonly FavouriteItem[];
  /**
   * `loading` until the account has answered for a signed-in reader; `error`
   * or `partial` when clinical items could not all be read (work pages still
   * show); `ready` otherwise. A signed-out reader is `ready` with only work pages.
   */
  readonly status: SavedFavouritesBandStatus;
  readonly signedIn: boolean;
  readonly retry: () => void;
  /** Records the open, on the account for clinical items and on the device for work pages and numbers. */
  readonly recordOpen: (item: FavouriteItem) => void;
};

export function useFavouritesShelf(limit?: number): FavouritesShelfState {
  const accountData = useOptionalAccountData();
  const { items: registryItems, status, refetch } = useSavedRegistryFavourites();
  const workStars = useWorkPageStars();
  const routeVisible = useWorkModeRouteVisible();
  const numbers = useSavedNumbers();
  const overrides = useFavouriteOverrides();
  const layout = useFavouritesLayout();
  const lastOpened = useSyncExternalStore(subscribeFavouritesStorage, loadFavouriteLastOpened, getEmptyLastOpened);
  const pinnedIds = useSyncExternalStore(subscribeFavouritesStorage, loadFavouritePinnedIds, getEmptyPinned);
  const now = useSyncExternalStore(subscribeMinute, getMinuteNow, getServerNow);

  const favouriteItems = accountData?.favouriteItems;
  const favouriteSets = accountData?.favouriteSets;
  const items = useMemo(() => {
    const metadata = new Map((favouriteItems ?? []).map((item) => [`${item.contentType}:${item.contentKey}`, item]));
    const setById = new Map((favouriteSets ?? []).map((set) => [set.id, set]));
    const clinical = registryItems.map((item) => toCommandItem(item, lastOpened, pinnedIds, metadata, setById, now));
    // A new-only page 404s on the classic work mode, so it stays saved but hidden there.
    const work = resolveWorkPageStars(workStars, routeVisible).map(workStarToItem);
    return [...clinical, ...work, ...numbers.map(numberToItem)].map((item) => applyOverride(item, overrides[item.id]));
  }, [
    favouriteItems,
    favouriteSets,
    registryItems,
    lastOpened,
    pinnedIds,
    now,
    workStars,
    routeVisible,
    numbers,
    overrides,
  ]);

  const shelfLimit = limit ?? layout.shelfSize;
  const shelf = useMemo(() => shelfItems(items, shelfLimit, layout.pinOrder), [items, shelfLimit, layout.pinOrder]);

  const recordOpen = useCallback(
    (item: FavouriteItem) => {
      if (item.example) return;
      if (item.workKey) {
        recordWorkPageOpened(item.workKey);
        return;
      }
      if (item.numberId) {
        recordNumberOpened(item.numberId);
        return;
      }
      recordFavouriteOpened(item.id);
      if (item.contentType && item.contentKey) void accountData?.recordFavouriteOpen(item.contentType, item.contentKey);
    },
    [accountData],
  );

  return {
    items,
    shelf,
    status,
    signedIn: Boolean(accountData?.isAuthenticated),
    retry: refetch,
    recordOpen,
  };
}
