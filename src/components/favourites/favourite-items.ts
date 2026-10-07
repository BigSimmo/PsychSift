"use client";

import { FileText, Pill, Quote, type LucideIcon } from "lucide-react";

import type { AccountFavourite, AccountFavouriteSet } from "@/components/account-data-provider";
import type { FavouriteItem as PrototypeFavouriteItem } from "@/components/clinical-dashboard/favourites-prototype-data";
import { formatLastOpened } from "@/components/favourites/favourites-storage";
import {
  demoOpenedAt,
  UNSORTED_SET_NAME,
  type FavouriteItem,
  type FavouriteType,
} from "@/components/favourites/favourites-view-model";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import { appModeIcons } from "@/lib/app-mode-icons";
import type { ResolvedWorkPageStar } from "@/lib/favourites/work-page-stars";

/**
 * Turns every kind of saved thing into the one `FavouriteItem` shape the
 * Favourites page, the My Day page and the My Day shelf all draw (owner
 * request 7 Oct 2026: one list, shown in both places). Clinical items come
 * from the account; work pages from this device.
 */

const lastUsedByItemId: Record<string, string> = {
  "acamprosate-renal-screen": "Today 08:44",
  "lithium-monitoring-guideline": "Today 08:20",
  "clozapine-monitoring-table": "Yesterday 16:12",
  "renal-dose-search": "Today 07:55",
  "qt-prolongation-quote": "Mon 11:03",
};

const typeByPrototypeType: Record<PrototypeFavouriteItem["type"], FavouriteType> = {
  medications: "Medication",
  documents: "Document",
  sources: "Source",
  services: "Service",
  forms: "Form",
  differentials: "Differential",
  therapies: "Therapy",
};

const fallbackIconByType: Record<PrototypeFavouriteItem["type"], LucideIcon> = {
  medications: Pill,
  documents: FileText,
  sources: Quote,
  services: appModeIcons.services,
  forms: appModeIcons.forms,
  differentials: appModeIcons.differentials,
  therapies: appModeIcons["therapy-compass"],
};

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCommandItem(
  item: PrototypeFavouriteItem,
  lastOpenedMap: Record<string, number>,
  pinnedIds: ReadonlySet<string>,
  favouriteMetadata: ReadonlyMap<string, AccountFavourite>,
  setById: ReadonlyMap<string, AccountFavouriteSet>,
  now: number,
  example: boolean = false,
): FavouriteItem {
  const type =
    item.type === "sources" && item.primaryAction === "Run"
      ? "Saved search"
      : (typeByPrototypeType[item.type] ?? "Source");
  const contentType =
    item.type === "services"
      ? "service"
      : item.type === "forms"
        ? "form"
        : item.type === "differentials"
          ? "differential"
          : item.type === "therapies"
            ? "therapy"
            : undefined;
  const contentKey = contentType ? item.id.slice(item.id.indexOf(":") + 1) : undefined;
  // An example must never borrow a real saved item's set, pin or last-opened time.
  const metadata =
    !example && contentType && contentKey ? favouriteMetadata.get(`${contentType}:${contentKey}`) : undefined;
  const persistedOpened = parseTimestamp(metadata?.lastOpenedAt);
  const localOpened = lastOpenedMap[item.id] ?? null;
  const recordedOpened =
    persistedOpened !== null || localOpened !== null ? Math.max(persistedOpened ?? 0, localOpened ?? 0) : null;
  // Examples carry a label such as "Today 08:44"; it only becomes a time once
  // the client clock exists, so the server and the first client frame agree.
  const openedAt = recordedOpened ?? (example && now > 0 ? demoOpenedAt(lastUsedByItemId[item.id], now) : null);
  const setName = metadata?.setId ? setById.get(metadata.setId)?.name : undefined;
  return {
    id: item.id,
    title: item.title,
    description: item.meta,
    type,
    tabId: item.type,
    // A saved item lives in its account set or in Unsorted. The registry's
    // "Saved services" style labels were type buckets, not sets; the Type view
    // does that job now. Examples keep their preset set so the demo reads true.
    set: setName ?? (example ? item.set : UNSORTED_SET_NAME),
    evidence: item.sourceMeta,
    lastUsed: openedAt !== null ? formatLastOpened(openedAt) : "Saved",
    openedAt,
    action: item.primaryAction,
    href: item.href,
    icon: item.icon ?? fallbackIconByType[item.type],
    pinned: Boolean(metadata?.pinnedAt) || pinnedIds.has(item.id),
    pinnedAt: parseTimestamp(metadata?.pinnedAt),
    contentType,
    contentKey,
    setId: metadata?.setId ?? null,
    sortOrder: metadata?.sortOrder ?? 0,
    example,
  };
}

/** A saved work page, in the same shape as a clinical favourite. */
export function workStarToItem(star: ResolvedWorkPageStar): FavouriteItem {
  const title = star.item.title ?? star.item.label;
  return {
    id: `work:${star.key}`,
    title,
    shortTitle: star.item.label,
    description: star.item.sub ?? star.area.name,
    type: "Work page",
    tabId: "work",
    set: star.area.name,
    evidence: "",
    lastUsed: star.openedAt !== null ? formatLastOpened(star.openedAt) : "Saved",
    openedAt: star.openedAt,
    action: "Open",
    href: star.item.href,
    icon: workFrameIcons[star.item.icon],
    pinned: star.pinnedAt !== null,
    pinnedAt: star.pinnedAt,
    sortOrder: 0,
    workKey: star.key,
    areaName: star.area.name,
    identity: star.area.identity,
    savedAt: star.starredAt,
  };
}
