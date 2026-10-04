"use client";

import { Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

import { RosterAskAnswer } from "@/components/roster/ask/roster-ask-answer";
import { useRosterAskContext } from "@/components/roster/ask/use-roster-ask-context";
import { modeControlShape, modeTapArea } from "@/components/mode-kit/recipes";
import { answerQuestion, askNeedsTeamReady } from "@/lib/roster/ask/answer";
import { askIntentHref } from "@/lib/roster/ask/handoff";
import { parseAsk, type AskChoice, type AskContext, type AskResult } from "@/lib/roster/ask/parse";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";

function readingFor(result: AskResult, ctx: AskContext): string | null {
  if (result.kind !== "change") return null;
  const intent = result.intent;
  if (intent.kind === "dates")
    return `${intent.dateKind === "prefer_off" ? "Prefer off" : "Can't work"} ${formatPerthDay(intent.from)}${intent.to === intent.from ? "" : `–${formatPerthDay(intent.to)}`}`;
  if (intent.kind === "leave")
    return `Request leave ${formatPerthDay(intent.from)}${intent.to === intent.from ? "" : `–${formatPerthDay(intent.to)}`}`;
  const shift = ctx.assignments.find((item) => item.id === intent.assignmentId);
  const detail = shift
    ? `${formatPerthDay(perthDateOf(shift.startsAt))} ${shift.kind.replace("_", " ")}`
    : "your shift";
  if (intent.kind === "swap") return `Swap ${detail}`;
  return `${intent.kind === "give_away" ? "Give away" : "Can't make"} ${detail}`;
}

type Pending = { readonly id: number; readonly text: string };

function RosterAskSession({
  pending,
  onNavigate,
}: {
  readonly pending: Pending | null;
  readonly onNavigate: () => void;
}) {
  const router = useRouter();
  const { parser, answers, teamChoices, selectedTeamId, selectTeam, loading, teamLoading } = useRosterAskContext();
  const [selection, setSelection] = useState<{ id: number; teamId: string | null; choice: AskChoice } | null>(null);
  const chosen =
    pending && selection?.id === pending.id && selection.teamId === selectedTeamId ? selection.choice : null;
  const ctx = {
    ...parser,
    ...(chosen?.date ? { selectedDate: chosen.date } : {}),
    ...(chosen?.userId ? { selectedUserId: chosen.userId } : {}),
  };
  const result = pending && !loading ? parseAsk(pending.text, ctx) : null;
  const waitingOnTeam = Boolean(result && askNeedsTeamReady(result) && teamLoading);
  const answer = result?.kind === "question" && !waitingOnTeam ? answerQuestion(result.q, answers) : null;
  const reading = result && !waitingOnTeam ? readingFor(result, ctx) : null;

  function choose(choice: AskChoice) {
    if (!pending) return;
    setSelection({ id: pending.id, teamId: selectedTeamId, choice });
  }

  function open() {
    if (result?.kind !== "change") return;
    const href = askIntentHref(result.intent, selectedTeamId);
    onNavigate();
    router.push(href);
  }

  return (
    <>
      {teamChoices.length > 1 ? (
        <label className="grid gap-1 px-3 text-sm text-[color:var(--text-muted)]">
          Team roster
          <select
            value={selectedTeamId ?? ""}
            onChange={(event) => {
              selectTeam(event.target.value);
              setSelection(null);
            }}
            className="min-h-12 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-[color:var(--text)]"
          >
            {teamChoices.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {pending && /\bbecause\b/i.test(pending.text) ? (
        <p className="px-3 text-sm text-[color:var(--text-muted)]">Reasons aren&apos;t saved.</p>
      ) : null}
      {waitingOnTeam ? (
        <p role="status" className="px-3 text-sm text-[color:var(--text-muted)]">
          Loading the team roster…
        </p>
      ) : null}
      {result && !waitingOnTeam ? (
        <RosterAskAnswer result={result} answer={answer} reading={reading} onChoice={choose} onOpen={open} />
      ) : null}
    </>
  );
}

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
export function RosterAskButton({ className }: { readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
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
