/**
 * Keyboard shortcuts on a computer (site recommendations, 12 Oct 2026, item 5).
 *
 * Pure rules for which key does what, so they can be pinned by unit tests.
 * Work pages already own "/", Ctrl K and "?" (AI Search, see
 * `work-search-button.tsx`), and the Clinical composer already owns "/" and
 * Ctrl K where it is on the page (`universal-search-command-surface.tsx`). The
 * global listener only fills the gaps those leave.
 */

/** Ask the global shortcuts list to open (the Help page's row dispatches it). */
export const OPEN_KEYBOARD_SHORTCUTS_EVENT = "psychsift:open-keyboard-shortcuts";

export type ShortcutKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">;

export type ShortcutAction = "search" | "help" | null;

/** What a key press asks for, before any page has had its say. */
export function shortcutFor(event: ShortcutKey): ShortcutAction {
  if (event.altKey || event.isComposing) return null;
  if (event.key === "/" && !event.metaKey && !event.ctrlKey) return "search";
  if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.shiftKey) return "search";
  if (event.key === "?" && !event.metaKey && !event.ctrlKey) return "help";
  return null;
}

/** Typing in a field (or a rich-text box): the keys are the reader's letters there, not ours. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The rows of the list, worded for the platform's command key. */
export function shortcutRows(apple: boolean): readonly { readonly keys: string[][]; readonly label: string }[] {
  const command = apple ? "⌘" : "Ctrl";
  return [
    { keys: [["/"], [command, "K"]], label: "Search: the search box in Clinical, AI Search in Work" },
    { keys: [["Esc"]], label: "Close a sheet or dialog" },
    { keys: [["?"]], label: "Show this list" },
  ];
}
