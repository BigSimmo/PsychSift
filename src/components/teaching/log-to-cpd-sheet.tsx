"use client";

import { Check, Minus, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { WorkButton } from "@/components/mode-kit/work";
import { durationMinutes, perthTime } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import {
  attendanceLabels,
  teachingCpdBodySchema,
  teachingCpdEntryHref,
  type AttendanceMethod,
} from "@/lib/teaching/model";

/** The scheduled length in quarter hours, the unit `POST /api/teaching/cpd` accepts. */
export function defaultCpdHours(session: { startsAt: string; endsAt: string }): string {
  return String(Math.max(1, Math.round(durationMinutes(session.startsAt, session.endsAt) / 15)) / 4);
}

export function parseCpdHours(raw: string): number | null {
  const hours = Number(raw.trim());
  if (!teachingCpdBodySchema.shape.hours.safeParse(hours).success) return null;
  return hours;
}

const MIN_HOURS = 0.25;
const MAX_HOURS = 8;

/** One quarter hour up or down from what is typed, kept inside 0.25 to 8. */
export function stepCpdHours(raw: string, direction: 1 | -1): string {
  const typed = Number(raw.trim());
  const base = Number.isFinite(typed) && typed > 0 ? Math.round(typed * 4) / 4 : 1;
  return String(Math.min(MAX_HOURS, Math.max(MIN_HOURS, base + direction * 0.25)));
}

const fieldLabel = "px-0.5 text-3xs font-bold tracking-label uppercase text-[color:var(--text-muted)]";

/**
 * Log one attended session to CPD (spec §9; work-mode redesign, owner request 6 Oct 2026): the
 * reader's own check-in when the page knows it, the hours as a quarter-hour stepper (the field
 * stays typeable), and one button that says what it saves. One request id per mount, so a double
 * tap or a retry cannot log it twice. Links run one way, into CPD. The demo saves nothing and
 * says so. There is no Undo: the CPD endpoint has no removal, so the saved state links to the
 * entry in CPD instead.
 */
export function LogToCpdSheet({
  open,
  onClose,
  occurrenceId,
  startsAt,
  endsAt,
  onLogged,
  subtitle,
  checkIn,
  demo = false,
}: {
  open: boolean;
  onClose: () => void;
  occurrenceId: string;
  startsAt: string;
  endsAt: string;
  onLogged?: (entryId: string, hours: number) => void;
  /** "Grand rounds · Tue 6 Oct". */
  subtitle?: string;
  /** The reader's own check-in, when the page knows it. */
  checkIn?: { method: AttendanceMethod; recordedAt: string } | null;
  /** Made-up records: nothing is sent. */
  demo?: boolean;
}) {
  const [hours, setHours] = useState(() => defaultCpdHours({ startsAt, endsAt }));
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ entryId: string; created: boolean } | null>(null);
  const fieldId = useId();
  const valid = parseCpdHours(hours);

  async function save() {
    const value = parseCpdHours(hours);
    if (value === null) {
      setError("Use quarter hours between 0.25 and 8, for example 1.25.");
      return;
    }
    if (demo) {
      setError("The demo doesn't save to CPD.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await teachingPost<{ entryId: string; created: boolean }>("/api/teaching/cpd", {
        occurrenceId,
        hours: value,
        requestId,
      });
      setSaved(result);
      onLogged?.(result.entryId, value);
    } catch (failure) {
      setError(teachingErrorMessage(failure, "cpd"));
    } finally {
      setBusy(false);
    }
  }

  const step = (direction: 1 | -1) => {
    setError(null);
    setHours((value) => stepCpdHours(value, direction));
  };
  const round = cn(
    "relative isolate grid size-12 shrink-0 place-items-center rounded-full text-[color:var(--text-heading)] before:absolute before:inset-1.5 before:-z-10 before:rounded-full before:bg-[color:var(--surface-wash)] before:content-[''] disabled:opacity-40",
    focusRing,
  );
  return (
    <Sheet open={open} onClose={onClose} title="Log to CPD" description={subtitle}>
      <div data-mode-identity="teaching" className="grid gap-3.25 pb-2">
        {saved ? (
          <div className="grid gap-2" role="status">
            <p className="flex items-center gap-2 text-base-minus font-bold text-[color:var(--text-heading)]">
              <span aria-hidden="true" className="work-ic work-ic--sm" data-tone="green">
                <Check aria-hidden="true" strokeWidth={3} />
              </span>
              {saved.created ? "Logged to CPD." : "Already in your CPD record."}
            </p>
            <Link
              href={teachingCpdEntryHref(saved.entryId)}
              className={cn(
                "inline-flex min-h-12 items-center text-sm-minus font-bold text-[color:var(--mode-identity)]",
                focusRing,
              )}
            >
              Add a reflection in CPD
            </Link>
            <WorkButton variant="secondary" size="wide" onClick={onClose}>
              Done
            </WorkButton>
          </div>
        ) : (
          <form
            className="grid gap-3.25"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void save();
            }}
          >
            {checkIn ? (
              <div className="grid gap-1.75">
                <p className={fieldLabel}>Your check-in</p>
                <div className="work-card flex min-h-12 items-center gap-2.5 px-3 py-2.25">
                  <span aria-hidden="true" className="work-ic" data-tone="green">
                    <Check aria-hidden="true" strokeWidth={2.6} />
                  </span>
                  <span className="grid min-w-0 gap-px">
                    <b className="text-sm-minus font-bold text-[color:var(--text-heading)]">
                      {attendanceLabels[checkIn.method]}
                    </b>
                    <small className="nums text-xs font-normal text-[color:var(--text-muted)]">
                      {`At ${perthTime(checkIn.recordedAt)} · session ${perthTime(startsAt)} to ${perthTime(endsAt)}`}
                    </small>
                  </span>
                </div>
              </div>
            ) : null}
            <div className="grid gap-1.75">
              <div className="flex items-center justify-between">
                <label htmlFor={fieldId} className={fieldLabel}>
                  Hours
                </label>
                <span className="text-2xs font-semibold text-[color:var(--text-muted)]">In quarter hours</span>
              </div>
              <div
                className={cn(
                  "flex min-h-12 items-center justify-between gap-1 rounded-[var(--work-radius-field)] border bg-[color:var(--surface-raised)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[color:var(--focus)]",
                  error ? "border-[color:var(--danger-text)]" : "border-[color:var(--border-strong)]",
                )}
              >
                <button
                  type="button"
                  className={round}
                  aria-label="A quarter hour less"
                  disabled={busy || Number(hours) <= MIN_HOURS}
                  onClick={() => step(-1)}
                >
                  <Minus aria-hidden="true" className="size-4" strokeWidth={2.2} />
                </button>
                <span className="flex min-w-0 flex-1 items-baseline justify-center gap-1">
                  <input
                    id={fieldId}
                    type="number"
                    inputMode="decimal"
                    step={0.25}
                    min={MIN_HOURS}
                    max={MAX_HOURS}
                    value={hours}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${fieldId}-error` : undefined}
                    onChange={(event) => {
                      setError(null);
                      setHours(event.target.value);
                    }}
                    className="nums w-16 [appearance:textfield] bg-transparent text-right text-lg-minus font-bold text-[color:var(--text-heading)] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span aria-hidden="true" className="text-lg-minus font-bold text-[color:var(--text-heading)]">
                    h
                  </span>
                </span>
                <button
                  type="button"
                  className={round}
                  aria-label="A quarter hour more"
                  disabled={busy || Number(hours) >= MAX_HOURS}
                  onClick={() => step(1)}
                >
                  <Plus aria-hidden="true" className="size-4" strokeWidth={2.2} />
                </button>
              </div>
              {error ? (
                <p
                  id={`${fieldId}-error`}
                  role="alert"
                  className="px-0.5 text-xs font-semibold text-[color:var(--danger-text)]"
                >
                  {error}
                </p>
              ) : null}
            </div>
            <WorkButton type="submit" size="wide" disabled={busy}>
              {busy ? "Saving" : valid === null ? "Log to CPD" : `Log ${withUnit(valid, "h")} to CPD`}
            </WorkButton>
            <p className="flex items-center justify-center gap-1.5 text-2xs font-semibold text-[color:var(--text-muted)]">
              <ShieldCheck aria-hidden="true" className="size-3.5" strokeWidth={2} />
              Your CPD log is private
            </p>
          </form>
        )}
      </div>
    </Sheet>
  );
}
