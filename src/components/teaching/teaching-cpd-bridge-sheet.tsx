"use client";

import { T5Button } from "@/components/teaching/t5-kit";

import { withUnit } from "./teaching-number";
import { Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { teachingCpdEntryHref } from "@/lib/teaching/model";

const UNDO_DURATION_MS = 6000;
const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TeachingCpdBridgeSheet({
  open,
  onClose,
  occurrenceId,
  title,
  hours = 1.0,
  testId = "teaching-cpd-bridge",
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly occurrenceId: string;
  readonly title: string;
  readonly hours?: number;
  readonly testId?: string;
}) {
  const [savedResult, setSavedResult] = useState<{ entryId: string; created: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoProgress, setUndoProgress] = useState(1); // 1 to 0
  const undoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Clean up animation on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  async function handleLog() {
    setBusy(true);
    setError(null);
    setUndoError(null);
    try {
      const result = await teachingPost<{ entryId: string; created: boolean }>("/api/teaching/cpd", {
        occurrenceId,
        hours,
        requestId: crypto.randomUUID(),
      });
      setSavedResult(result);

      if (result.created) {
        // Start 6-second radial undo timer only for newly created entries
        startTimeRef.current = Date.now();
        const tick = () => {
          const elapsed = Date.now() - (startTimeRef.current ?? Date.now());
          const remaining = Math.max(0, 1 - elapsed / UNDO_DURATION_MS);
          setUndoProgress(remaining);
          if (remaining > 0) {
            animFrameRef.current = requestAnimationFrame(tick);
          }
        };
        animFrameRef.current = requestAnimationFrame(tick);

        undoTimerRef.current = setTimeout(() => {
          setUndoProgress(0);
        }, UNDO_DURATION_MS);
      }
    } catch (err) {
      setError(teachingErrorMessage(err, "cpd"));
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!savedResult?.created || !savedResult.entryId) return;
    setUndoBusy(true);
    setUndoError(null);
    try {
      const res = await fetch(`/api/cme/entries/${savedResult.entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) {
        throw new Error(`Failed to undo CPD log (${res.status})`);
      }
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setSavedResult(null);
      setUndoProgress(1);
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "Failed to undo CPD log");
    } finally {
      setUndoBusy(false);
    }
  }

  const strokeDashoffset = CIRCUMFERENCE * (1 - undoProgress);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Attendance & CPD"
      testId={testId}
      footer={
        savedResult ? (
          <T5Button block onClick={onClose} testId={`${testId}-done`}>
            Done
          </T5Button>
        ) : (
          <T5Button
            variant="primary"
            block
            busy={busy}
            busyLabel="Logging"
            onClick={() => void handleLog()}
            testId={`${testId}-log-button`}
          >
            {`Log ${withUnit(hours.toFixed(1), "h")} to CPD`}
          </T5Button>
        )
      }
    >
      <div className="grid gap-3 py-1">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3">
          <span className="text-2xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            Verified Attendance
          </span>
          <p className="mt-1 text-base-minus font-medium text-[color:var(--text-heading)]">{title}</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
            {`${withUnit(hours.toFixed(1), "h")} · Category 1: Educational Activities`}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[color:var(--danger-text)]">
            {error}
          </p>
        )}

        {savedResult && (
          <div
            data-testid={`${testId}-confirmed`}
            className="flex flex-col gap-3 rounded-xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[color:var(--success-text)]">
                <span
                  className="grid size-6 place-items-center rounded-full bg-[color:var(--success)] text-[color:var(--command-contrast)]"
                  aria-hidden="true"
                >
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium">
                  {savedResult.created
                    ? `Logged ${withUnit(hours.toFixed(1), "h")} to CPD`
                    : "Already in your CPD record"}
                </span>
              </div>

              {/* Radial 6-Second Animated Undo Button - only for new creations */}
              {savedResult.created && undoProgress > 0 && (
                <div className="relative grid size-10 place-items-center">
                  <svg viewBox="0 0 44 44" className="size-10 -rotate-90 transform" aria-hidden="true">
                    <circle
                      cx="22"
                      cy="22"
                      r={RADIUS}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="text-[color:var(--success-border)]"
                    />
                    <circle
                      cx="22"
                      cy="22"
                      r={RADIUS}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      className="text-[color:var(--success)]"
                    />
                  </svg>
                  <button
                    type="button"
                    disabled={undoBusy}
                    onClick={() => void handleUndo()}
                    data-testid={`${testId}-undo-button`}
                    aria-label="Undo CPD log"
                    className={cn(
                      "absolute inset-0 grid place-items-center text-xs font-semibold text-[color:var(--success-text)] active:scale-95",
                      focusRing,
                    )}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {undoError && (
              <p role="alert" className="text-xs font-medium text-[color:var(--danger-text)]">
                {undoError}
              </p>
            )}

            <Link
              href={teachingCpdEntryHref(savedResult.entryId)}
              className={cn("text-xs text-[color:var(--mode-identity)] underline underline-offset-2", focusRing)}
            >
              Add reflection or attach slide notes in CPD
            </Link>
          </div>
        )}
      </div>
    </Sheet>
  );
}
