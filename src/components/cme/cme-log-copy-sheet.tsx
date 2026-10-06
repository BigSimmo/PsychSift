"use client";

import { Check, Copy } from "lucide-react";
import { useState, type RefObject } from "react";

import { cpdHomeFields } from "@/components/cme/cme-log-copy-fields";
import { cmeCpdHomeWords } from "@/components/cme/cme-log-shared";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";
import { cn, InlineNotice, textMuted } from "@/components/ui-primitives";
import { formatEntryForCpdHome } from "@/lib/cme/clipboard";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { CmeFractionBar } from "@/components/cme/cme-progress-visuals";

export type CmeLogCopySheetProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The uncopied, unarchived activities in list order when the sheet opened. Snapshotted on mount. */
  readonly candidates: readonly CmeEntry[];
  /** Live lookup, so a mark or an undo made here is reflected at once. */
  readonly lookup: (id: string) => CmeEntry | undefined;
  readonly set: CmeRequirementSet;
  readonly demoMode: boolean;
  /** Stamps the activity as copied. Rejects when the record could not be saved. */
  readonly onMark: (id: string) => Promise<void>;
  /** Clears the stamp on the last one marked. Rejects when it could not be saved. */
  readonly onUndo: () => Promise<void>;
  /** The last activity marked copied that can still be undone. */
  readonly lastMarkedId: string | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
};

const DEMO_NOTICE = "Sign in to copy and track activities in your private CPD record.";

/**
 * COPY TO YOUR CPD HOME, ONE AT A TIME.
 *
 * Steps through the activities not yet copied, showing each field the CPD-home
 * text carries (from `formatEntryForCpdHome`, so the cost is never among them)
 * with its own Copy button, plus "Copy everything". Nothing is ever marked on
 * its own: PsychSift cannot see the portal, so an activity is stamped copied
 * only when the owner presses "Mark copied, next". A clipboard failure says so
 * and records nothing. "Skip" moves on and leaves the activity on the list.
 *
 * Mount it with a fresh `key` per opening: the queue is the list as it stood
 * when the owner pressed "Copy next", so marking one never reshuffles the rest.
 */
export function CmeLogCopySheet({
  open,
  onClose,
  candidates,
  lookup,
  set,
  demoMode,
  onMark,
  onUndo,
  lastMarkedId,
  returnFocusRef,
}: CmeLogCopySheetProps) {
  const [queue] = useState(() => candidates.filter((entry) => !entry.archivedAt).map((entry) => entry.id));
  const [index, setIndex] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finished = index >= queue.length;
  const current = finished ? undefined : lookup(queue[index]!);
  const text = current && !current.archivedAt ? formatEntryForCpdHome(current, entryYearSet(set, current)) : "";
  const fields = text ? cpdHomeFields(text) : [];
  const stillNotCopied = queue.filter((id) => {
    const entry = lookup(id);
    return entry !== undefined && !entry.transcribed && !entry.archivedAt;
  }).length;
  const lastMarked = lastMarkedId ? lookup(lastMarkedId) : undefined;

  function moveTo(next: number) {
    setIndex(next);
    setCopiedField(null);
    setError(null);
  }

  async function copy(key: string, value: string, label: string) {
    if (demoMode) return;
    setError(null);
    try {
      await copyTextToClipboard(value);
    } catch {
      setCopiedField(null);
      const message = "Could not copy. Check clipboard permission and try again.";
      setError(message);
      announce(message);
      return;
    }
    setCopiedField(key);
    announce(`${label} copied`);
  }

  async function markAndNext() {
    if (!current || busy || demoMode) return;
    setBusy(true);
    setError(null);
    try {
      await onMark(current.id);
    } catch {
      const message = "This record could not be marked copied. Try again.";
      setError(message);
      announce(message);
      setBusy(false);
      return;
    }
    setBusy(false);
    announce(`${current.title} marked copied`);
    moveTo(index + 1);
  }

  async function undo() {
    if (!lastMarkedId || busy || demoMode) return;
    const undoneId = lastMarkedId;
    setBusy(true);
    setError(null);
    try {
      await onUndo();
    } catch {
      const message = "Could not undo the marked-copied status. Try again.";
      setError(message);
      announce(message);
      setBusy(false);
      return;
    }
    setBusy(false);
    announce("Marked copied undone");
    const position = queue.indexOf(undoneId);
    if (position >= 0) moveTo(position);
  }

  const footer = finished ? (
    <Button variant="primary" block onClick={onClose} testId="cme-log-copy-close">
      Close
    </Button>
  ) : (
    <div className="flex gap-2">
      <Button className="flex-1" onClick={() => moveTo(index + 1)} disabled={busy} testId="cme-log-copy-skip">
        Skip
      </Button>
      <Button
        variant="primary"
        className="flex-[2]"
        icon={Check}
        busy={busy}
        busyLabel="Saving…"
        disabled={demoMode || !current}
        onClick={() => void markAndNext()}
        testId="cme-log-copy-mark"
      >
        Mark copied, next
      </Button>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Copy to ${cmeCpdHomeWords(set).name}`}
      description={finished ? undefined : `${index + 1} of ${queue.length}`}
      placement="responsive-right"
      mobilePlacement="bottom"
      returnFocusRef={returnFocusRef}
      testId="cme-log-copy-sheet"
      footer={footer}
    >
      <div className="grid gap-4 text-sm">
        {queue.length > 0 ? (
          <CmeFractionBar fraction={Math.min(index, queue.length) / queue.length} className="h-1" />
        ) : null}

        {demoMode ? (
          <div data-testid="cme-log-copy-demo">
            <InlineNotice tone="neutral">{DEMO_NOTICE}</InlineNotice>
          </div>
        ) : null}

        {lastMarked && !demoMode ? (
          <div data-testid="cme-log-copy-last" className="flex flex-wrap items-center gap-x-2">
            <span className={textMuted}>
              Marked copied: <span className="text-[color:var(--text)]">{lastMarked.title}</span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void undo()}
              className="min-h-tap font-medium text-[color:var(--clinical-accent)] underline underline-offset-2"
            >
              Undo
            </button>
          </div>
        ) : null}

        {finished ? (
          <p data-testid="cme-log-copy-finished" className="text-base-minus text-[color:var(--text)]">
            {stillNotCopied === 0
              ? "Every activity is marked copied."
              : `${stillNotCopied} ${stillNotCopied === 1 ? "activity" : "activities"} not marked copied yet. Skipped ones stay on your list.`}
          </p>
        ) : (
          <>
            <dl
              data-testid="cme-log-copy-fields"
              className="divide-y divide-[color:var(--border)] rounded-lg border border-[color:var(--border)]"
            >
              {fields.map((field, position) => {
                const key = `${position}:${field.label}`;
                const copied = copiedField === key;
                const name = field.label || "this line";
                return (
                  <div key={key} className="flex items-start gap-3 py-1 pl-3 pr-1">
                    <div className="grid min-w-0 flex-1 gap-0.5 py-2">
                      <dt className={cn(textMuted, "text-xs")}>{field.label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-[color:var(--text)]">{field.value}</dd>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={copied ? Check : Copy}
                      disabled={demoMode}
                      aria-label={copied ? `${name} copied` : `Copy ${name}`}
                      onClick={() => void copy(key, field.value, field.label || "Line")}
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                );
              })}
            </dl>
            <Button
              block
              icon={copiedField === "all" ? Check : Copy}
              disabled={demoMode || !text}
              onClick={() => void copy("all", text, "Everything")}
              testId="cme-log-copy-all"
            >
              {copiedField === "all" ? "Copied everything" : "Copy everything"}
            </Button>
          </>
        )}

        {error ? (
          <p data-testid="cme-log-copy-error" className="font-medium text-[color:var(--text)]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** The CPD year an activity counts against is its own date's, whichever year the log is showing. */
function entryYearSet(set: CmeRequirementSet, entry: CmeEntry): CmeRequirementSet {
  return { ...set, year: Number(entry.date.slice(0, 4)) };
}
