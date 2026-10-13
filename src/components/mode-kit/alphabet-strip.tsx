"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@/components/ui-primitives";

/**
 * The phone A to Z strip for long alphabetical lists (Clinical audit, 13 Oct
 * 2026, item 13), like the index down the side of Contacts on iPhone.
 *
 * - Phones only: hidden from `sm`, where the lists are short enough on screen
 *   and the pages already carry their own letter controls.
 * - Only letters that exist in the list are drawn, in list order.
 * - The whole strip is one press-and-drag target: a press anywhere on it jumps
 *   to the letter under the finger and dragging keeps jumping, so no single
 *   letter has to be 48px tall on its own.
 * - It sits in the page's right gutter, between the header and the bottom
 *   search box (`--phone-overlay-chrome-h` and `--mobile-composer-reserve`),
 *   so it never covers the box or a row's own buttons. It shows only while the
 *   list itself is on screen.
 * - Keyboard: one tab stop; arrow keys, Home and End move between letters and
 *   Enter or Space jumps, moving focus to that letter's heading.
 * - Large text: when the letters no longer fit the strip's height it hides
 *   itself rather than overlapping or shrinking the letters to nothing.
 * - Jumps are instant (no smooth scrolling), so reduced motion holds.
 */
export type AlphabetStripEntry = {
  /** The letter as shown, for example "A". */
  readonly letter: string;
  /** The id of the element that starts this letter (a heading or first row). */
  readonly targetId: string;
};

export function AlphabetStrip({
  entries,
  listId,
  label = "Jump to letter",
  testId = "alphabet-strip",
  minEntries = 4,
}: {
  readonly entries: readonly AlphabetStripEntry[];
  /** The list the strip indexes. The strip shows only while it is on screen. */
  readonly listId: string;
  readonly label?: string;
  readonly testId?: string;
  /** Fewer letters than this and the strip is not worth drawing. */
  readonly minEntries?: number;
}) {
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const draggingRef = useRef(false);
  const lastJumpRef = useRef<number | null>(null);
  const [listOnScreen, setListOnScreen] = useState(false);
  const [fits, setFits] = useState(true);
  const [focusIndex, setFocusIndex] = useState(0);
  const [pressedLetter, setPressedLetter] = useState<string | null>(null);

  const enabled = entries.length >= minEntries;

  useEffect(() => {
    if (!enabled) return;
    const list = document.getElementById(listId);
    if (!list) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer (an old browser or a test): treat the list as on screen.
      const frame = requestAnimationFrame(() => setListOnScreen(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(([entry]) => setListOnScreen(Boolean(entry?.isIntersecting)));
    observer.observe(list);
    return () => observer.disconnect();
  }, [enabled, listId]);

  // Hide rather than overlap when the letters cannot fit (large text, short
  // landscape phones). Measured on the letters' own height against the strip's.
  useLayoutEffect(() => {
    if (!enabled) return;
    const nav = navRef.current;
    const list = listRef.current;
    if (!nav || !list) return;
    const measure = () => setFits(list.scrollHeight <= nav.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(list);
    return () => observer.disconnect();
  }, [enabled, entries.length]);

  const jumpTo = useCallback(
    (index: number, moveFocus: boolean) => {
      const entry = entries[index];
      if (!entry) return;
      const target = document.getElementById(entry.targetId);
      if (!target) return;
      target.scrollIntoView({ block: "start", behavior: "auto" });
      if (moveFocus) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    },
    [entries],
  );

  const indexAt = useCallback(
    (clientY: number) => {
      const list = listRef.current;
      if (!list || !entries.length) return null;
      const rect = list.getBoundingClientRect();
      if (rect.height <= 0) return null;
      const fraction = (clientY - rect.top) / rect.height;
      return Math.min(entries.length - 1, Math.max(0, Math.floor(fraction * entries.length)));
    },
    [entries.length],
  );

  const pressAt = useCallback(
    (clientY: number) => {
      const index = indexAt(clientY);
      if (index === null || index === lastJumpRef.current) return;
      lastJumpRef.current = index;
      setFocusIndex(index);
      setPressedLetter(entries[index]?.letter ?? null);
      jumpTo(index, false);
    },
    [entries, indexAt, jumpTo],
  );

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // A mouse click on a letter is handled by the button itself.
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    draggingRef.current = true;
    lastJumpRef.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressAt(event.clientY);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (draggingRef.current) pressAt(event.clientY);
  };
  const endPress = (event: PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    lastJumpRef.current = null;
    setPressedLetter(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(entries.length - 1, focusIndex + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(0, focusIndex - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    buttonRefs.current[next]?.focus();
  };

  if (!enabled) return null;

  const shown = listOnScreen && fits;

  return (
    <>
      <nav
        ref={navRef}
        aria-label={label}
        data-testid={testId}
        data-shown={shown ? "true" : "false"}
        className={cn(
          "fixed right-0 z-[30] flex w-4 touch-none items-center justify-center select-none sm:hidden",
          "top-[calc(var(--phone-overlay-chrome-h,4rem)+0.75rem)] bottom-[calc(var(--mobile-composer-reserve,6rem)+0.5rem)]",
          shown ? "visible" : "invisible",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
      >
        <ol ref={listRef} className="flex flex-col items-center" onKeyDown={onKeyDown}>
          {entries.map((entry, index) => (
            <li key={entry.targetId}>
              <button
                ref={(node) => {
                  buttonRefs.current[index] = node;
                }}
                type="button"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={`Jump to ${entry.letter}`}
                onClick={() => {
                  setFocusIndex(index);
                  jumpTo(index, true);
                }}
                onFocus={() => setFocusIndex(index)}
                className="block w-4 rounded-sm text-center font-mono text-3xs leading-[1.35] font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[color:var(--focus)]"
              >
                {entry.letter}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {pressedLetter ? (
        // The letter under the finger, large in the middle of the screen while
        // dragging, so the reader sees where they are. No animation.
        <span
          aria-hidden="true"
          data-testid={`${testId}-bubble`}
          className="pointer-events-none fixed top-1/2 left-1/2 z-[30] grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] font-mono text-3xl font-semibold text-[color:var(--text-heading)] shadow-[var(--e2)] sm:hidden"
        >
          {pressedLetter}
        </span>
      ) : null}
    </>
  );
}

/**
 * Scroll margin for a strip target, so a jump lands the letter just under the
 * phone header instead of behind it.
 */
export const alphabetStripTargetClass = "scroll-mt-[calc(var(--phone-overlay-chrome-h,4rem)+0.75rem)]";

/**
 * Turns an ordered list of items into strip entries: the first item for each
 * starting letter. Anything that does not start with A to Z is grouped as "#".
 *
 * Returns no entries unless the list really is in A to Z order: a ranked list
 * gets no strip, because jumping to "M" there would land in the wrong place.
 * A lone row filed out of place in an otherwise A to Z list (a catalogue that
 * sorts "WACHS Goldfields" under G) is skipped rather than starting its own
 * letter: a row counts only when its letter sits between its neighbours'.
 */
export function alphabetStripEntries<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  idOf: (item: T) => string,
): AlphabetStripEntry[] {
  const letters = items.map((item) => alphabetStripLetter(nameOf(item)));
  const entries: AlphabetStripEntry[] = [];
  let outOfPlace = 0;
  for (let index = 0; index < items.length; index += 1) {
    const letter = letters[index]!;
    const before = letters[index - 1];
    const after = letters[index + 1];
    const inPlace = (before === undefined || before <= letter) && (after === undefined || letter <= after);
    if (!inPlace) {
      outOfPlace += 1;
      continue;
    }
    const previous = entries.at(-1)?.letter;
    if (letter === previous) continue;
    if (previous !== undefined && letter < previous) return [];
    entries.push({ letter, targetId: idOf(items[index]!) });
  }
  // More than a few strays means the list is not really alphabetical.
  if (outOfPlace > Math.max(2, items.length * 0.05)) return [];
  return entries;
}

/** The index letter for a name: its first A to Z letter, upper case, or "#". */
export function alphabetStripLetter(name: string): string {
  const first = name.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}
