"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { OPEN_KEYBOARD_SHORTCUTS_EVENT, isTypingTarget, shortcutFor } from "@/lib/keyboard-shortcuts";

const KeyboardShortcutsSheet = dynamic(
  () => import("@/components/keyboard-shortcuts/keyboard-shortcuts-sheet").then((mod) => mod.KeyboardShortcutsSheet),
  { ssr: false },
);

/** Another dialog is open over the page: its keys belong to it. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function shown(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * The page's own search box when the shared composer is not on screen (the
 * Psychiatry and Medicines homes draw their own). Null when there is none.
 */
function pageSearchBox(): HTMLInputElement | null {
  const composer = document.getElementById("global-search-input");
  if (composer && shown(composer)) return null;
  const boxes = document.querySelectorAll<HTMLInputElement>('#main-content input[type="search"]:not([disabled])');
  for (const box of boxes) if (shown(box)) return box;
  return null;
}

/**
 * Keyboard shortcuts on a computer (site recommendations, 12 Oct 2026, item 5).
 *
 * Fills the gaps the page owners leave, and only on a screen with a mouse or
 * trackpad, never while typing in a field and never over an open dialog:
 * - "/" and Ctrl K (Command K on a Mac) go to a page's own search box where
 *   the shared composer is not on screen. Where it is, its own shortcut
 *   already does this; on Work pages AI Search owns both keys.
 * - "?" shows the "Keyboard shortcuts" list on Clinical pages (Work pages show
 *   their AI Search list). The Help page opens the same list.
 * Esc already closes every sheet and dialog (the shared Sheet owns it).
 *
 * Page owners that handle a key mark it handled (`preventDefault`), so a key
 * is never acted on twice. The composer's position and behaviour are untouched.
 */
export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const finePointer = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: fine)") : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !finePointer?.matches) return;
      const action = shortcutFor(event);
      if (!action || isTypingTarget(event.target) || dialogOpen()) return;
      if (action === "help") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      const box = pageSearchBox();
      if (!box) return;
      event.preventDefault();
      box.focus();
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  // Loaded on first ask, then kept, so closing can play the sheet's own exit.
  const [asked, setAsked] = useState(false);
  if (open && !asked) setAsked(true);
  return asked ? <KeyboardShortcutsSheet open={open} onClose={() => setOpen(false)} /> : null;
}
