"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { NumberActionsSheet, NumberFormSheet } from "@/components/favourites/number-sheets";
import { QUICK_LAUNCH_LIMIT, type FavouriteItem } from "@/components/favourites/favourites-view-model";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast } from "@/components/ui/toast";
import {
  forgetPinOrder,
  removeSavedNumbers,
  RESTORE_FAILED,
  restoreSavedNumbers,
  setSavedNumbersPinned,
  useSavedNumbers,
  type SavedNumber,
} from "@/lib/favourites/favourites-local";

// Long enough for a keyboard or screen-reader user to reach Undo in the toast.
const UNDO_TOAST_MS = 10_000;

export type NumberSheetsApi = {
  /** Opens a saved number's actions: call, copy, edit, pin and remove. */
  readonly openNumber: (item: FavouriteItem) => void;
  /** Opens the form to add a new number. */
  readonly addNumber: () => void;
  /** The two sheets, to render once in the host. */
  readonly sheets: ReactNode;
};

/**
 * The saved-number sheets for My Day (its shelf and its Favourites page). The
 * Favourites page wires the same sheets into its own pin and remove flows.
 * `items` is the whole saved list, so pinning counts clinical items, work
 * pages and numbers together against the one My Day limit.
 */
export function useNumberSheets(items: readonly FavouriteItem[]): NumberSheetsApi {
  const numbers = useSavedNumbers();
  const toast = useOptionalToast();
  const [actionId, setActionId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavedNumber | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef<HTMLElement | null>(null);

  const rememberFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) {
      returnFocusRef.current = active;
      // The heading of the section the opener sits in, for when its row is removed.
      fallbackFocusRef.current = active.closest("section")?.querySelector<HTMLElement>("h1, h2, h3") ?? null;
    }
  };

  // Stable on purpose: the sheets read it in their open effects. The opener
  // first; once its row is gone, its section heading, then the page heading.
  const returnFocus = useCallback(() => {
    if (returnFocusRef.current?.isConnected) return returnFocusRef.current;
    const heading = fallbackFocusRef.current?.isConnected
      ? fallbackFocusRef.current
      : document.querySelector<HTMLElement>("main h1");
    if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    return heading;
  }, []);

  const say = useCallback(
    (title: string, tone: "success" | "warning" | "danger" = "success") => {
      if (toast) toast.push({ tone, title });
      else announce(title);
    },
    [toast],
  );

  const openNumber = useCallback((item: FavouriteItem) => {
    rememberFocus();
    setActionId(item.id);
  }, []);

  const addNumber = useCallback(() => {
    rememberFocus();
    setEditing(null);
    setFormOpen(true);
  }, []);

  // Live, so the sheet's pin label follows a change made while it is open.
  const actionItem = actionId ? (items.find((item) => item.id === actionId) ?? null) : null;
  const pinnedCount = items.filter((entry) => entry.pinned).length;
  // Read at Undo time, so a restored number never takes My Day past its limit.
  const pinnedCountRef = useRef(pinnedCount);
  useEffect(() => {
    pinnedCountRef.current = pinnedCount;
  }, [pinnedCount]);

  const togglePin = (item: FavouriteItem) => {
    if (!item.numberId) return;
    if (item.pinned) {
      const saved = setSavedNumbersPinned(new Set([item.numberId]), false);
      if (saved) forgetPinOrder([item.id]);
      say(saved ? "Unpinned from My Day" : "This phone did not save that", "success");
      return;
    }
    if (pinnedCount >= QUICK_LAUNCH_LIMIT) {
      say("My Day holds four pins. Unpin one first.", "warning");
      return;
    }
    say(setSavedNumbersPinned(new Set([item.numberId]), true) ? "Pinned to My Day" : "This phone did not save that");
  };

  const remove = (item: FavouriteItem) => {
    if (!item.numberId) return;
    const removed = removeSavedNumbers(new Set([item.numberId]));
    if (removed.length === 0) {
      say("This phone did not save that", "danger");
      return;
    }
    if (!toast) {
      forgetPinOrder([item.id]);
      announce(`Removed ${item.title}`);
      return;
    }
    toast.push({
      tone: "info",
      title: `Removed ${item.title}`,
      duration: UNDO_TOAST_MS,
      action: {
        label: "Undo",
        onAction: () => {
          const restored = restoreSavedNumbers(removed, {
            pinRoom: QUICK_LAUNCH_LIMIT - pinnedCountRef.current,
          });
          if (!restored.ok) {
            toast.push({
              tone: "danger",
              title: "Could not put the number back",
              body: restored.reason === "full" ? RESTORE_FAILED.full : "Add it again from Favourites.",
            });
          }
        },
      },
      // Undo keeps its place on My Day; otherwise it leaves the kept order.
      onClose: (reason) => {
        if (reason !== "action") forgetPinOrder([item.id]);
      },
    });
  };

  const sheets = (
    <>
      <NumberActionsSheet
        item={actionItem}
        onClose={() => setActionId(null)}
        onEdit={(item) => {
          setActionId(null);
          setEditing(numbers.find((entry) => entry.id === item.numberId) ?? null);
          setFormOpen(true);
        }}
        onTogglePin={togglePin}
        onRemove={(item) => {
          setActionId(null);
          remove(item);
        }}
        returnFocusTarget={returnFocus}
      />
      <NumberFormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        returnFocusTarget={returnFocus}
        pinRoom={pinnedCount < QUICK_LAUNCH_LIMIT}
      />
    </>
  );

  return { openNumber, addNumber, sheets };
}
