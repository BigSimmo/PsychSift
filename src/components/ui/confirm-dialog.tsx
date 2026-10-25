"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { fieldControlPlain, textMuted, cn } from "@/components/ui-primitives";

export type ConfirmDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  /** What will happen, in plain terms. Say the irreversible part out loud. */
  description: ReactNode;
  /** Object-specific action label, e.g. "Delete 3 documents". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive by default — this is the governance-action preset. */
  tone?: "danger" | "primary";
  busy?: boolean;
  busyLabel?: string;
  /**
   * When set, the confirm control stays disabled until the user types this exact
   * string. Reserved for actions with no undo (deleting an indexed source,
   * retiring an approved guideline) — a typed confirmation is friction on
   * purpose. Leave unset for reversible actions; ceremony everywhere trains
   * people to type through it.
   */
  confirmPhrase?: string;
  confirmPhraseLabel?: string;
};

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  busyLabel,
  confirmPhrase,
  confirmPhraseLabel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  const inputId = useId();

  // A stale confirmation phrase from a previous open would let the next
  // destructive action through with no typing at all. Reset during render rather
  // than in an effect: an effect would leave one frame where the confirm control
  // is already enabled against the previous answer.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setTyped("");
  }

  const phraseSatisfied = !confirmPhrase || typed.trim() === confirmPhrase;

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      mobilePlacement="bottom"
      portal
      testId="confirm-dialog"
      closeLabel={cancelLabel}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone}
            onClick={onConfirm}
            disabled={!phraseSatisfied}
            busy={busy}
            busyLabel={busyLabel ?? `${confirmLabel}…`}
            testId="confirm-dialog-confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className={cn("text-sm leading-6", textMuted)}>{description}</div>
        {confirmPhrase ? (
          <div>
            <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-[color:var(--text-muted)]">
              {confirmPhraseLabel ?? `Type ${confirmPhrase} to confirm`}
            </label>
            <input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className={fieldControlPlain}
            />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
