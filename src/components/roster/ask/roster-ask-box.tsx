"use client";

import { Search, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Sheet } from "@/components/ui/sheet";
import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

import { modeControlShape, modeTapArea } from "@/components/mode-kit/recipes";
import type { Pending } from "@/components/roster/ask/roster-ask-session";

// Loaded on the first submitted question; see roster-ask-session.tsx.
const RosterAskSession = dynamic(
  () => import("@/components/roster/ask/roster-ask-session").then((module) => module.RosterAskSession),
  { ssr: false },
);

/**
 * The ask form itself: local grammar only. Roster reads begin only after a
 * question is submitted, so opening the sheet costs nothing.
 */
function RosterAskPanel({
  inputRef,
  onNavigate,
}: {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onNavigate: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState(false);
  const nextId = useRef(0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    nextId.current += 1;
    setPending({ id: nextId.current, text });
    setActive(true);
  }

  return (
    <section aria-label="Ask Roster" className="grid gap-3">
      <form
        onSubmit={onSubmit}
        className="flex min-w-0 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-1.5 transition-colors duration-[var(--duration-instant)] focus-within:border-[color:var(--command)] focus-within:bg-[color:var(--surface-raised)] focus-within:shadow-[var(--e1)]"
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="Ask or change your roster"
          placeholder="Ask or change your roster"
          autoComplete="off"
          enterKeyHint="search"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPending(null);
          }}
          className="min-h-12 min-w-0 flex-1 rounded-md bg-transparent px-2 text-base-minus text-[color:var(--text)] outline-none placeholder:text-[color:var(--text-muted)]"
        />
        <button type="submit" aria-label="Read roster question" className={modeTapArea}>
          <span className={modeControlShape.command}>
            <Search aria-hidden="true" className="size-4" />
          </span>
        </button>
      </form>
      {!pending ? (
        <p className="px-2 text-sm text-[color:var(--text-muted)]">
          Try &ldquo;When am I next on nights?&rdquo; or &ldquo;I can&apos;t work Saturday&rdquo;.
        </p>
      ) : null}
      {active ? (
        <RosterAskSession
          pending={pending}
          onNavigate={() => {
            setText("");
            setPending(null);
            setActive(false);
            onNavigate();
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * A compact round icon that opens Ask Roster in a sheet. It sits in a page
 * header, so asking never costs the page any vertical space.
 */
export function RosterAskButton({
  className,
  variant = "icon",
}: {
  readonly className?: string;
  /** `field`: a full-width box that reads like the question field (Shifts), instead of the round icon. */
  readonly variant?: "icon" | "field";
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      {variant === "field" ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          data-testid="roster-ask-open"
          data-mode-identity="roster"
          className={cn(
            "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] py-1 pl-3.5 pr-1 text-left",
            focusRing,
            className,
          )}
        >
          <Sparkles
            aria-hidden="true"
            strokeWidth={1.6}
            className="size-icon-md shrink-0 text-[color:var(--text-muted)]"
          />
          <span className="min-w-0 flex-1 break-words text-base-minus leading-5 text-[color:var(--text-muted)]">
            Ask or change your roster
          </span>
          <span
            aria-hidden="true"
            className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-[color:var(--border-strong)] px-3.5 text-base-minus font-semibold text-[color:var(--text-heading)]"
          >
            Ask
          </span>
        </button>
      ) : null}
      {variant === "icon" ? (
        <button
          type="button"
          aria-label="Ask or change your roster"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={cn(modeTapArea, "group rounded-full", className)}
          data-testid="roster-ask-open"
        >
          <span
            data-mode-identity="roster"
            className="grid size-10 place-items-center rounded-full border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)] shadow-[var(--e1)] transition-transform duration-[var(--duration-instant)] group-active:scale-95 forced-colors:border motion-reduce:transition-none"
          >
            <Sparkles aria-hidden="true" strokeWidth={1.75} className="size-icon-lg" />
          </span>
        </button>
      ) : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Ask your roster"
        description="Ask about shifts, or start a swap, leave or a date you can't work."
        mobilePlacement="bottom"
        initialFocusRef={inputRef}
        testId="roster-ask-sheet"
      >
        {open ? <RosterAskPanel inputRef={inputRef} onNavigate={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}
