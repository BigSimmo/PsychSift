"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { NumberActionsSheet, NumberFormSheet } from "@/components/favourites/number-sheets";
import { QUICK_LAUNCH_LIMIT, type FavouriteItem } from "@/components/favourites/favourites-view-model";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast } from "@/components/ui/toast";
import {
  removeSavedNumbers,
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

  const rememberFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) returnFocusRef.current = active;
  };

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

  const togglePin = (item: FavouriteItem) => {
    if (!item.numberId) return;
    if (item.pinned) {
      say(
        setSavedNumbersPinned(new Set([item.numberId]), false)
          ? "Unpinned from My Day"
          : "This phone did not save that",
        "success",
      );
      return;
    }
    if (items.filter((entry) => entry.pinned).length >= QUICK_LAUNCH_LIMIT) {
      say("My Day holds four pins. Unpin one first.", "warning");
      return;
    }
    say(setSavedNumbersPinned(new Set([item.numberId]), true) ? "Pinned to My Day" : "This phone did not save that");
  };

  const remove = (item: FavouriteItem) => {
    if (!item.numberId) return;
    const removed = removeSavedNumbers(new Set([item.numberId]));
    if (removed.length === 0) return;
    if (!toast) {
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
          if (!restoreSavedNumbers(removed)) {
            toast.push({
              tone: "danger",
              title: "Could not put the number back",
              body: "Add it again from Favourites.",
            });
          }
        },
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
      />
      <NumberFormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        returnFocusTarget={() => returnFocusRef.current}
      />
    </>
  );

  return { openNumber, addNumber, sheets };
}
