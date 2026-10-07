"use client";

import { ChevronLeft, ChevronRight, Lock, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { cardSurface } from "@/components/card-recipes";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast } from "@/components/ui/toast";
import { cn, eyebrowText, floatingControl, textMuted } from "@/components/ui-primitives";
import type { ReminderTextProblem } from "@/lib/alerts/remind-me";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * Small, presentational pieces the four junior Admin features share
 * (contract end, leave wallet, starter pack, ready for day one). Kept thin
 * so the main build can reskin them onto its work kit. Admin's design
 * contract holds here too: grey status, no device storage, no tick icons.
 */

/** Ten seconds to change your mind, the same window Teaching's delayed posts use. */
export const JUNIOR_UNDO_MS = 10_000;

/* ------------------------------------------------------------ writes */

async function entryFrom(response: Response): Promise<OnCallEntry> {
  if (!response.ok) throw await parseApiErrorResponse(response);
  const json: unknown = await response.json();
  const parsed = onCallEntrySchema.safeParse((json as { entry?: unknown } | null)?.entry);
  if (!parsed.success) throw new Error("Save response was invalid.");
  return parsed.data;
}

export async function createEntry(body: unknown): Promise<OnCallEntry> {
  return entryFrom(
    await fetch("/api/on-call/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function patchEntry(id: string, body: unknown): Promise<OnCallEntry> {
  return entryFrom(
    await fetch(`/api/on-call/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteEntry(id: string): Promise<void> {
  const response = await fetch(`/api/on-call/entries/${id}`, { method: "DELETE" });
  if (!response.ok) throw await parseApiErrorResponse(response);
}

export function errorWords(error: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "You are offline. Nothing was saved. Try again when you have signal.";
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A short random slug suffix, so two saves never collide. */
export function slugSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/* ------------------------------------------------------------ online */

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Whether the browser says it is online. Always true on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

/* -------------------------------------------------------------- copy */

export type CopyState = "idle" | "copied" | "failed";

/**
 * Copy text, say so in words on the button and to screen readers, then go
 * back to idle after a few seconds. Two quick taps copy once each, never
 * leave the button stuck on "Copied".
 */
export function useCopy(resetMs = 2500) {
  const [state, setState] = useState<{ key: string | null; value: CopyState }>({ key: null, value: "idle" });
  const timer = useRef<number | null>(null);
  useEffect(() => () => (timer.current ? window.clearTimeout(timer.current) : undefined), []);
  const copy = useCallback(
    async (text: string, key = "default", spoken = "Copied") => {
      if (timer.current) window.clearTimeout(timer.current);
      try {
        await copyTextToClipboard(text);
        setState({ key, value: "copied" });
        announce(spoken);
      } catch {
        setState({ key, value: "failed" });
        announce("Could not copy. Select the text and copy it yourself.");
      }
      timer.current = window.setTimeout(() => setState({ key: null, value: "idle" }), resetMs);
    },
    [resetMs],
  );
  const stateFor = (key = "default"): CopyState => (state.key === key ? state.value : "idle");
  return { copy, stateFor };
}

export function copyLabel(state: CopyState, idle: string): string {
  return state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : idle;
}

/* -------------------------------------------------------------- undo */

/**
 * Undo for ten seconds. In the app this is the shared toast with an Undo action, so it sits where every toast
 * sits: above the work-frame bottom dock and the phone's safe area, never under or on top of the dock. Where no
 * toast provider is mounted (a bare test render), the same words show in a fixed bar of its own.
 *
 * `onDismiss` runs once when the ten seconds pass or the toast is closed; never when the page itself takes the
 * Undo away (a newer Undo replaces it), so an old timer can never clear a newer Undo.
 */
export function JuniorUndoBar({
  label,
  onUndo,
  onDismiss,
  testId,
  durationMs = JUNIOR_UNDO_MS,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
  testId: string;
  durationMs?: number;
}) {
  const toast = useOptionalToast();
  // The provider's push and dismiss are stable; the object around them is new on every render.
  const push = toast?.push;
  const dismiss = toast?.dismiss;
  const dismissRef = useRef(onDismiss);
  const undoRef = useRef(onUndo);
  useEffect(() => {
    dismissRef.current = onDismiss;
    undoRef.current = onUndo;
  }, [onDismiss, onUndo]);
  useEffect(() => {
    if (!push || !dismiss) return undefined;
    let taken = false;
    const id = push({
      tone: "success",
      title: label,
      duration: durationMs,
      action: { label: "Undo", onAction: () => undoRef.current() },
      onClose: (reason) => {
        if (!taken && reason !== "action") dismissRef.current();
      },
    });
    return () => {
      taken = true;
      dismiss(id);
    };
  }, [push, dismiss, label, durationMs]);
  useEffect(() => {
    if (push) return undefined;
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [push, durationMs]);
  if (push) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[var(--z-chrome)] flex justify-center px-4 print:hidden"
    >
      <div className="flex min-h-12 max-w-full items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3">
        <span className="min-w-0 text-sm text-[color:var(--text)]">{label}</span>
        <button
          type="button"
          onClick={onUndo}
          data-testid={`${testId}-undo`}
          className={cn(floatingControl, "text-xs")}
        >
          Undo
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------- patient details */

/**
 * The patient-detail catch, in Admin's grey: what looks wrong, a safer
 * wording when there is one, and one tap to use it. Save or Copy stays off
 * until the text reads as safe.
 */
export function PatientDetailCatch({
  problem,
  onUseSuggestion,
  testId,
}: {
  problem: ReminderTextProblem;
  onUseSuggestion?: (suggestion: string) => void;
  testId: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] p-3"
    >
      <TriangleAlert
        aria-hidden="true"
        strokeWidth={1.5}
        className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--text-heading)]"
      />
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{problem.title}</span>
        <span className="text-sm leading-5 text-[color:var(--text)]">
          {problem.body}
          {problem.suggestion ? ` Try “${problem.suggestion}”.` : null}
        </span>
        {problem.suggestion && onUseSuggestion ? (
          <span>
            <Button variant="secondary" size="sm" onClick={() => onUseSuggestion(problem.suggestion!)}>
              Use this wording
            </Button>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ layout */

export function JuniorSectionLabel({
  children,
  count,
  action,
  id,
}: {
  children: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex min-h-8 items-end justify-between gap-2 px-1">
      <h2 id={id} className={eyebrowText}>
        {children}
        {count !== undefined ? (
          <span className="nums font-medium normal-case tracking-normal">{` · ${count}`}</span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

/**
 * The page's way back to its real parent (Admin Today, or New job), the same pattern the CPD pages use: it
 * follows this tab's history when there is one and falls back to `href`, so it never dead-ends.
 */
export function JuniorBackLink({ href, label, testId }: { href: string; label: string; testId?: string }) {
  return (
    <ContextualBackLink
      fallbackHref={href}
      data-testid={testId}
      className={cn(
        "-ml-1 inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)] no-underline",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      )}
    >
      <ChevronLeft aria-hidden="true" className="size-icon-sm" />
      {label}
    </ContextualBackLink>
  );
}

/**
 * A flat panel: white, one hairline, no fill lift and no shadow (Admin's flat design). For a page's lead
 * panel and its notes, where the shared raised card would look lifted.
 */
export const juniorFlatPanel = "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]";

/**
 * A text link that reads as a link: underlined, in Admin's link colour, a chevron after it, and a full
 * 48 px tap target.
 */
export const juniorTextLinkClass =
  "inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)] underline decoration-1 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/** The chevron that follows a `juniorTextLinkClass` link. */
export function JuniorLinkChevron() {
  return <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0" />;
}

/** A footer note, icon and words left-aligned together, as the shared kit's quiet notes are. */
export function JuniorFootNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className={cn(textMuted, "flex items-start gap-1.5 px-1 text-xs leading-5")}>
      <Lock aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-icon-xs shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------ the day */

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds until the next Perth midnight (Perth keeps no daylight saving). */
export function msUntilNextPerthDay(now: Date): number {
  const perth = now.getTime() + PERTH_OFFSET_MS;
  return Math.max(1000, (Math.floor(perth / DAY_MS) + 1) * DAY_MS - perth);
}

/**
 * "Now" for an Admin page, kept current: it moves on at Perth midnight and whenever the page comes back into
 * view, so a page left open overnight never shows yesterday's days left. A pinned `now` (a test) stays put.
 */
export function useJuniorNow(pinned?: Date): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (pinned) return undefined;
    const timer = window.setTimeout(() => setNow(new Date()), msUntilNextPerthDay(now));
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [now, pinned]);
  return pinned ?? now;
}

/* --------------------------------------------------------- entry rows */

/** The look of every feature's entry link: a flat hairline row, tint circle, title, line and chevron. */
export const juniorEntryRowClass = cn(
  cardSurface,
  "flex min-h-12 items-center gap-3 px-3 py-2.5 no-underline text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
);

/** The inside of an entry row. The caller wraps it in its own literal `<Link href>`. */
export function JuniorEntryRowBody({ icon: Icon, title, line }: { icon: LucideIcon; title: string; line: string }) {
  return (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)]">
        <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-sm text-[color:var(--text-heading)]" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-medium">{title}</span>
        <span className={cn(textMuted, "text-xs")}>{line}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </>
  );
}

/** A quiet text link for a section header. */
export const juniorQuietLinkClass =
  "inline-flex min-h-12 items-center text-xs font-semibold text-[color:var(--clinical-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]";

export function JuniorNotice({
  title,
  children,
  testId,
  action,
}: {
  title: string;
  children?: ReactNode;
  testId?: string;
  action?: ReactNode;
}) {
  return (
    <div data-testid={testId} className={cn(cardSurface, "grid gap-1 p-3")}>
      <p className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</p>
      {children ? <div className="text-sm leading-5 text-[color:var(--text)]">{children}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
