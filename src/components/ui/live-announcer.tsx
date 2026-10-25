"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * COMPONENTS §5. A 13-mode app with no focus management or route announcement
 * strands assistive-technology users on every navigation: the URL changes, the
 * page changes, and the screen reader says nothing while focus sits on a link
 * that no longer exists.
 *
 * One singleton owns every announcement in the product. That is the point — the
 * anti-pattern this replaces is `aria-live` scattered onto visible content
 * nodes, where a streaming answer re-announces its own fragments and a result
 * count is read out through a low-contrast visible node.
 */

export type AnnouncePriority = "polite" | "assertive";

export type AnnounceOptions = {
  priority?: AnnouncePriority;
  /**
   * Identifies one caller-owned transition. Distinct ids let identical wording
   * represent distinct events inside the repeat window; reusing an id still
   * suppresses duplicate delivery of the same transition.
   */
  eventId?: string;
};

/** Identical messages inside this window are the same event announced twice. */
const dedupeWindowMs = 1_000;
/** Minimum gap between announcements so a queued message cannot cut into the previous sentence. */
const queueGapMs = 150;
/** Clear→set gap so an identical repeat after the dedupe window still mutates the live region. */
const repeatClearMs = 50;

type Listener = (state: { polite: string; assertive: string }) => void;

type AnnouncerInstance = { id: number };

const store = {
  polite: "",
  assertive: "",
  listeners: new Set<Listener>(),
  queue: [] as Array<{ message: string; priority: AnnouncePriority }>,
  recent: new Map<string, number>(),
  draining: false,
  timer: null as ReturnType<typeof setTimeout> | null,
  /** Mount order — the first entry owns the live regions. */
  instances: [] as AnnouncerInstance[],
  activeId: 0,
  nextId: 1,
  ownershipListeners: new Set<() => void>(),
};

function emit() {
  const snapshot = { polite: store.polite, assertive: store.assertive };
  for (const listener of store.listeners) listener(snapshot);
}

function emitOwnership() {
  for (const listener of store.ownershipListeners) listener();
}

function recomputeActive() {
  const next = store.instances[0]?.id ?? 0;
  if (store.activeId === next) return;
  store.activeId = next;
  emitOwnership();
}

function subscribeOwnership(onStoreChange: () => void) {
  store.ownershipListeners.add(onStoreChange);
  return () => {
    store.ownershipListeners.delete(onStoreChange);
  };
}

function getActiveId() {
  return store.activeId;
}

function setRegion(priority: AnnouncePriority, message: string) {
  if (priority === "assertive") store.assertive = message;
  else store.polite = message;
}

function currentRegion(priority: AnnouncePriority) {
  return priority === "assertive" ? store.assertive : store.polite;
}

function drain() {
  const next = store.queue.shift();
  if (!next) {
    store.draining = false;
    return;
  }
  store.draining = true;

  // aria-live announces only when the region's text *changes*. A repeat of the
  // same message after the dedupe window is a new event that announce() let
  // through — clear first so the subsequent set is observable to AT.
  if (currentRegion(next.priority) === next.message) {
    setRegion(next.priority, "");
    emit();
    store.timer = setTimeout(() => {
      setRegion(next.priority, next.message);
      emit();
      store.timer = setTimeout(drain, queueGapMs);
    }, repeatClearMs);
    return;
  }

  setRegion(next.priority, next.message);
  emit();
  store.timer = setTimeout(drain, queueGapMs);
}

/**
 * Announce an outcome. `polite` for results, counts and stage transitions;
 * `assertive` only for loss-of-work risks such as an expiring session, because
 * assertive interrupts whatever the reader is in the middle of.
 */
export function announce(message: string, opts?: AnnounceOptions) {
  const text = message.trim();
  if (!text) return;
  const priority = opts?.priority ?? "polite";
  const now = Date.now();
  const eventId = opts?.eventId?.trim() || null;
  const key = JSON.stringify([priority, eventId, text]);

  const last = store.recent.get(key);
  if (last !== undefined && now - last < dedupeWindowMs) return;
  store.recent.set(key, now);
  for (const [entry, at] of store.recent) if (now - at >= dedupeWindowMs) store.recent.delete(entry);

  store.queue.push({ message: text, priority });
  if (!store.draining) drain();
}

/** Test seam: clears the queue, dedupe window and rendered text between cases. */
export function resetAnnouncerForTests() {
  if (store.timer) clearTimeout(store.timer);
  store.timer = null;
  store.queue.length = 0;
  store.recent.clear();
  store.draining = false;
  store.polite = "";
  store.assertive = "";
  store.instances.length = 0;
  store.activeId = 0;
  store.nextId = 1;
  store.listeners.clear();
  store.ownershipListeners.clear();
  emit();
}

export function LiveAnnouncer() {
  // Stable per mount; allocated here so render can compare against activeId
  // without reading a ref (react-hooks/refs).
  const [instanceId] = useState(() => {
    const id = store.nextId;
    store.nextId += 1;
    return id;
  });
  const [state, setState] = useState({ polite: store.polite, assertive: store.assertive });

  useEffect(() => {
    if (store.instances.length > 0) {
      // Two announcers means every message is read twice. Loud in development;
      // in production the duplicate stays mounted but inactive until (if ever)
      // it becomes first in the ownership queue.
      if (process.env.NODE_ENV !== "production") {
        throw new Error("LiveAnnouncer is a singleton — mount exactly one instance at the app root.");
      }
      console.warn(JSON.stringify({ level: "warn", message: "live-announcer: duplicate instance mounted" }));
    }

    store.instances.push({ id: instanceId });
    recomputeActive();

    return () => {
      store.instances = store.instances.filter((entry) => entry.id !== instanceId);
      recomputeActive();
    };
  }, [instanceId]);

  const activeId = useSyncExternalStore(subscribeOwnership, getActiveId, getActiveId);
  const isActive = activeId === instanceId;

  useEffect(() => {
    if (!isActive) return;
    const listener: Listener = (next) => setState(next);
    store.listeners.add(listener);
    listener({ polite: store.polite, assertive: store.assertive });
    return () => {
      store.listeners.delete(listener);
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <>
      <div data-testid="live-announcer-polite" aria-live="polite" aria-atomic="true" className="sr-only">
        {state.polite}
      </div>
      <div data-testid="live-announcer-assertive" aria-live="assertive" aria-atomic="true" className="sr-only">
        {state.assertive}
      </div>
    </>
  );
}

/**
 * True when the user is inside an overlay or a controlled workflow. Yanking
 * focus to the page `<h1>` while a dialog is open both breaks the focus trap and
 * loses the user's place, so a navigation that happens from inside one keeps
 * its focus deliberately.
 */
function focusIsInControlledWorkflow() {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  return Boolean(active.closest('[role="dialog"], [role="alertdialog"], [data-preserve-focus="true"]'));
}

export function RouteAnnouncer() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    // The first render of a route is a load, not a navigation: the browser has
    // already announced the document, and stealing focus on arrival is exactly
    // the behaviour that makes screen-reader users dread SPAs.
    if (previous.current === null) {
      previous.current = pathname;
      return;
    }
    if (previous.current === pathname) return;
    previous.current = pathname;

    if (!focusIsInControlledWorkflow()) {
      const target =
        document.querySelector<HTMLElement>("main h1") ??
        document.querySelector<HTMLElement>("h1") ??
        document.querySelector<HTMLElement>("main");
      if (target) {
        // A heading is not focusable by default; -1 makes it programmatically
        // focusable without adding it to the tab order.
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    }

    // The title itself is not announced here. Next's App Router mounts its own
    // announcer (`next-route-announcer`, assertive) that reads the new
    // document.title whenever it changes, so a second polite copy made every
    // navigation read the page name twice, plus the heading this focus move reads.
  }, [pathname]);

  return null;
}
