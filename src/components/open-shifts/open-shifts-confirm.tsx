"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

/**
 * Every change a poster makes goes through one confirm: what will happen, a
 * filled "Yes" button and "Go back". Nothing is sent until "Yes".
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  busyLabel,
  danger,
  onConfirm,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  /** Resolves to an error sentence, or null when it worked. */
  onConfirm: () => Promise<string | null>;
  testId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    const failure = await onConfirm();
    // On success the sheet closes or the page moves on; staying busy until then stops a second tap acting twice.
    if (failure) {
      setBusy(false);
      setError(failure);
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      testId={testId}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant={danger ? "danger" : "primary"}
            block
            busy={busy}
            busyLabel={busyLabel}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" block onClick={onClose}>
            Go back
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-[color:var(--text)]">
        {children}
        {error ? (
          <p role="alert" className="font-medium text-[color:var(--danger-text)]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
