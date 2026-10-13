/** @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcuts } from "@/components/keyboard-shortcuts/keyboard-shortcuts";
import { OPEN_KEYBOARD_SHORTCUTS_EVENT, isTypingTarget, shortcutFor, shortcutRows } from "@/lib/keyboard-shortcuts";

function key(init: Partial<KeyboardEventInit> & { key: string }) {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...init };
}

describe("shortcutFor", () => {
  it("reads / and Ctrl or Command K as search, ? as the list", () => {
    expect(shortcutFor(key({ key: "/" }))).toBe("search");
    expect(shortcutFor(key({ key: "k", ctrlKey: true }))).toBe("search");
    expect(shortcutFor(key({ key: "K", metaKey: true }))).toBe("search");
    expect(shortcutFor(key({ key: "?", shiftKey: true }))).toBe("help");
  });

  it("ignores other keys and chords", () => {
    expect(shortcutFor(key({ key: "k" }))).toBeNull();
    expect(shortcutFor(key({ key: "/", ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: "/", altKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: "k", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutFor(key({ key: "/", isComposing: true }))).toBeNull();
  });

  it("treats fields and rich-text boxes as typing", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("names the platform's command key", () => {
    expect(shortcutRows(true)[0].keys[1]).toEqual(["⌘", "K"]);
    expect(shortcutRows(false)[0].keys[1]).toEqual(["Ctrl", "K"]);
  });
});

describe("KeyboardShortcuts", () => {
  let fine = true;
  beforeEach(() => {
    fine = true;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: fine)" ? fine : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    document.body.innerHTML = "";
  });
  afterEach(() => vi.restoreAllMocks());

  function mountSearchPage() {
    const main = document.createElement("div");
    main.id = "main-content";
    const box = document.createElement("input");
    box.type = "search";
    // jsdom has no layout: report the box as on screen.
    box.getClientRects = () => [{}] as unknown as DOMRectList;
    main.append(box);
    document.body.append(main);
    return box;
  }

  it("puts the cursor in a page's own search box on /", () => {
    const box = mountSearchPage();
    render(<KeyboardShortcuts />);
    const event = new KeyboardEvent("keydown", { key: "/", cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(document.activeElement).toBe(box);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a key a page owner already handled", () => {
    const box = mountSearchPage();
    render(<KeyboardShortcuts />);
    const event = new KeyboardEvent("keydown", { key: "/", cancelable: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(document.activeElement).not.toBe(box);
  });

  it("does nothing on a touch-only screen", () => {
    fine = false;
    const box = mountSearchPage();
    render(<KeyboardShortcuts />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", cancelable: true }));
    });
    expect(document.activeElement).not.toBe(box);
  });

  it("opens the list on ?", async () => {
    render(<KeyboardShortcuts />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", shiftKey: true, cancelable: true }));
    });
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("opens the list when the Help page asks", async () => {
    render(<KeyboardShortcuts />);
    act(() => {
      window.dispatchEvent(new Event(OPEN_KEYBOARD_SHORTCUTS_EVENT));
    });
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
