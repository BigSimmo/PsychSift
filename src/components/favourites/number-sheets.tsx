"use client";

import { Check, Clipboard, Pencil, Phone, Pin, PinOff, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from "react";

import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  addSavedNumber,
  checkNumberDraft,
  dialableDigits,
  isMobileNumber,
  MAX_SAVED_NUMBERS,
  NUMBER_LABEL_MAX,
  NUMBER_NOTE_MAX,
  recordNumberOpened,
  telHref,
  updateSavedNumber,
  type NumberDraftProblems,
  type SavedNumber,
} from "@/lib/favourites/favourites-local";

/* ------------------------------------------------ shared sheet pieces */

// Sheets portal to <body>, outside the page's work-mode token scope, so the
// rows use the app tokens the work-mode ones map to (white card, hairline
// rows), the same as `favourite-sheets.tsx`. Flat: no shadow on content.

export const sheetFocusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

export const sheetCard =
  "grid overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] [&>*+*]:border-t [&>*+*]:border-[color:var(--border)]";

export const sheetRow = cn(
  "flex min-h-12 w-full items-center gap-3 px-3 py-1.5 text-left text-sm font-bold text-[color:var(--text-heading)] active:bg-[color:var(--surface-wash)]",
  sheetFocusRing,
  "focus-visible:-outline-offset-2",
);

/** A flat square icon button, 48 px, for move up, move down and the like. */
export const sheetIconButton = cn(
  "grid size-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] active:bg-[color:var(--surface-wash)] disabled:cursor-not-allowed disabled:text-[color:var(--disabled)]",
  sheetFocusRing,
);

export const sheetSectionLabel =
  "m-0 px-1 pb-1.5 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]";

export const sheetFootnote = cn("m-0 px-1 pt-1 text-xs", textMuted);

export function SheetActionIcon({
  icon: Icon,
  tone = "neutral",
}: {
  icon: LucideIcon;
  tone?: "neutral" | "danger" | "muted";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full",
        tone === "danger"
          ? "bg-[color:var(--danger-bg)] text-[color:var(--danger)]"
          : tone === "muted"
            ? "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]"
            : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
      )}
    >
      <Icon className="size-icon-sm" aria-hidden="true" />
    </span>
  );
}

export function SheetRowText({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="grid min-w-0 flex-1">
      <span className="truncate">{title}</span>
      {sub ? <span className="text-xs font-medium text-[color:var(--text-muted)]">{sub}</span> : null}
    </span>
  );
}

/** The visual track of a switch. The whole row is the switch, so this is decoration. */
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-6 w-tap shrink-0 items-center rounded-full border transition motion-reduce:transition-none",
        on
          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)]"
          : "border-[color:var(--border-strong)] bg-[color:var(--surface-inset)]",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] transition-transform motion-reduce:transition-none",
          on ? "translate-x-6" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

export type ReturnFocusTarget = HTMLElement | null | (() => HTMLElement | null);

/**
 * A stable `resolveReturnFocusTarget` for Sheet. The target is kept in a ref so
 * an inline function from the caller does not re-run the sheet's open effect
 * on every render.
 */
export function useReturnFocusResolver(returnFocusTarget: ReturnFocusTarget | undefined) {
  const returnFocusTargetRef = useRef(returnFocusTarget);
  useEffect(() => {
    returnFocusTargetRef.current = returnFocusTarget;
  }, [returnFocusTarget]);
  return useCallback(() => {
    const target = returnFocusTargetRef.current;
    return (typeof target === "function" ? target() : target) ?? null;
  }, []);
}

/** Keeps a focused field above the phone keyboard once the keyboard has risen. */
export function keepAboveKeyboard(event: FocusEvent<HTMLElement>) {
  const field = event.currentTarget;
  window.setTimeout(() => {
    if (field.isConnected && typeof field.scrollIntoView === "function") {
      field.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, 300);
}

const SAVE_FAILED = {
  full: `You can keep ${MAX_SAVED_NUMBERS} numbers. Remove one first.`,
  storage: "This phone did not save that.",
} as const;

const PRIVACY_NOTE = "Kept on this phone only. Cleared when you sign out.";

/* ------------------------------------------------------ add or edit */

type Field = keyof NumberDraftProblems;

/**
 * Add a saved number, or edit one. Errors show after a field is left and on
 * save, never while typing for the first time. A mobile number gets a quiet
 * reminder, not a block.
 */
export function NumberFormSheet({
  open,
  onClose,
  editing,
  returnFocusTarget,
  onSaved,
  pinRoom = true,
}: {
  open: boolean;
  onClose: () => void;
  editing?: SavedNumber | null;
  /** The element focus returns to on close, or a function that finds it at close time. */
  returnFocusTarget?: ReturnFocusTarget;
  onSaved?: (id: string) => void;
  /** False when My Day already holds its four pins: Pin to My Day is then off and says why. */
  pinRoom?: boolean;
}) {
  const resolveReturnFocus = useReturnFocusResolver(returnFocusTarget);
  const isEdit = Boolean(editing);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit number" : "Add a number"}
      description="For services and wards, never a patient."
      closeLabel={isEdit ? "Close edit number" : "Close add a number"}
      resolveReturnFocusTarget={resolveReturnFocus}
      testId="number-form-sheet"
      bodyClassName="p-3 pb-6"
    >
      <div data-work-frame="sheet">
        <NumberForm
          key={editing?.id ?? "new"}
          editing={editing ?? null}
          onClose={onClose}
          onSaved={onSaved}
          pinRoom={pinRoom}
        />
      </div>
    </Sheet>
  );
}

function NumberForm({
  editing,
  onClose,
  onSaved,
  pinRoom,
}: {
  editing: SavedNumber | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
  pinRoom: boolean;
}) {
  const pinReasonId = useId();
  const [label, setLabel] = useState(editing?.label ?? "");
  const [number, setNumber] = useState(editing?.number ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [pinned, setPinned] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<Field>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const problems = checkNumberDraft({ label, number, note });
  const shown = (field: Field) => (submitted || touched.has(field) ? problems[field] : undefined);
  const leave = (field: Field) => setTouched((current) => new Set(current).add(field));
  const mobile = isMobileNumber(number);

  function submit() {
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(problems).length) return;
    const draft = { label, number, note };
    const result = editing
      ? updateSavedNumber(editing.id, draft)
      : addSavedNumber({ ...draft, pinned: pinned && pinRoom });
    if (result.ok) {
      onSaved?.(result.id);
      onClose();
      return;
    }
    if (result.reason === "full" || result.reason === "storage") setFormError(SAVE_FAILED[result.reason]);
    else if (!result.problems) setFormError("That number is no longer on this phone.");
  }

  return (
    <form
      className="grid gap-4 px-1 pt-1"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextField
        label="Name"
        required
        value={label}
        placeholder="Ward 4B"
        maxLength={NUMBER_LABEL_MAX}
        autoComplete="off"
        enterKeyHint="next"
        error={shown("label")}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => leave("label")}
        onFocus={keepAboveKeyboard}
      />
      <div className="grid gap-1.5">
        <TextField
          label="Number"
          required
          type="tel"
          inputMode="tel"
          value={number}
          placeholder="6457 2210"
          autoComplete="off"
          enterKeyHint="next"
          hint="Spaces and brackets are fine. Calls use the digits."
          error={shown("number")}
          className="font-mono tabular-nums"
          onChange={(event) => setNumber(event.target.value)}
          onBlur={() => leave("number")}
          onFocus={keepAboveKeyboard}
        />
        {mobile ? (
          <p data-testid="number-mobile-warning" className={cn("m-0 text-xs", textMuted)}>
            Mobiles usually belong to a person. Save work numbers only.
          </p>
        ) : null}
      </div>
      <TextField
        label="Note"
        value={note}
        placeholder="Bleep, ask for the registrar"
        maxLength={NUMBER_NOTE_MAX}
        autoComplete="off"
        enterKeyHint="done"
        hint="Optional. Never write patient details."
        error={shown("note")}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => leave("note")}
        onFocus={keepAboveKeyboard}
      />
      {editing ? null : (
        <div className={sheetCard}>
          <button
            type="button"
            role="switch"
            aria-checked={pinned && pinRoom}
            aria-describedby={pinRoom ? undefined : pinReasonId}
            disabled={!pinRoom}
            className={cn(sheetRow, "disabled:cursor-not-allowed disabled:active:bg-transparent")}
            onClick={() => setPinned((value) => !value)}
          >
            <SheetActionIcon icon={Pin} tone={pinRoom ? "neutral" : "muted"} />
            <SheetRowText
              title={pinRoom ? "Pin to My Day" : <span className="text-[color:var(--text-muted)]">Pin to My Day</span>}
              sub={pinRoom ? undefined : <span id={pinReasonId}>My Day holds four pins. Unpin one first.</span>}
            />
            <SwitchTrack on={pinned && pinRoom} />
          </button>
        </div>
      )}
      {formError ? (
        <p
          role="alert"
          className="m-0 flex items-start gap-1.5 text-sm font-semibold text-[color:var(--danger)]"
          data-testid="number-form-error"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
          <span>{formError}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" block>
        {editing ? "Save changes" : "Save number"}
      </Button>
      <p className={sheetFootnote}>{PRIVACY_NOTE}</p>
    </form>
  );
}

/* ------------------------------------------------------------ actions */

type CopyState = "idle" | "copied" | "failed";

/**
 * Call, copy, edit, pin and remove for one saved number. Remove hands back to
 * the caller, which offers Undo.
 */
export function NumberActionsSheet({
  item,
  onClose,
  onEdit,
  onTogglePin,
  onRemove,
  returnFocusTarget,
}: {
  item: FavouriteItem | null;
  onClose: () => void;
  onEdit: (item: FavouriteItem) => void;
  onTogglePin: (item: FavouriteItem) => void;
  onRemove: (item: FavouriteItem) => void;
  /** Where focus goes on close: the opener, or a heading once the row is gone. */
  returnFocusTarget?: ReturnFocusTarget;
}) {
  const resolveReturnFocus = useReturnFocusResolver(returnFocusTarget);
  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={item?.title ?? "Saved number"}
      description="Number on this phone"
      closeLabel="Close number actions"
      resolveReturnFocusTarget={resolveReturnFocus}
      testId="number-actions-sheet"
      bodyClassName="p-3 pb-5"
    >
      {item ? (
        <div data-work-frame="sheet">
          <NumberActions
            key={item.id}
            item={item}
            onClose={onClose}
            onEdit={onEdit}
            onTogglePin={onTogglePin}
            onRemove={onRemove}
          />
        </div>
      ) : null}
    </Sheet>
  );
}

function NumberActions({
  item,
  onClose,
  onEdit,
  onTogglePin,
  onRemove,
}: {
  item: FavouriteItem;
  onClose: () => void;
  onEdit: (item: FavouriteItem) => void;
  onTogglePin: (item: FavouriteItem) => void;
  onRemove: (item: FavouriteItem) => void;
}) {
  const phone = item.phone ?? "";
  const href = telHref(phone);
  const dialable = dialableDigits(phone);
  const pinLabel = item.pinned ? "Unpin from My Day" : "Pin to My Day";
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function settle(next: Exclude<CopyState, "idle">) {
    if (!mounted.current) return;
    setCopy(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (mounted.current) setCopy("idle");
    }, 4000);
  }

  function handleCopy() {
    if (!dialable) return;
    // Never rejects unhandled: every failure lands in the visible "failed" state.
    void copyTextToClipboard(dialable).then(
      () => settle("copied"),
      () => settle("failed"),
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5 px-1">
        <p className="m-0 min-w-0 break-all font-mono text-2xl font-semibold tabular-nums text-[color:var(--text-heading)]">
          {phone}
        </p>
        {item.note ? <p className={cn("m-0 text-sm", textMuted)}>{item.note}</p> : null}
      </div>
      <div className={sheetCard}>
        {href ? (
          <a
            href={href}
            className={sheetRow}
            onClick={() => {
              if (item.numberId) recordNumberOpened(item.numberId);
            }}
          >
            <SheetActionIcon icon={Phone} />
            <SheetRowText title={`Call ${phone}`} sub="Opens your phone app" />
          </a>
        ) : (
          <div role="group" aria-disabled="true" aria-label="Call" className={cn(sheetRow, "active:bg-transparent")}>
            <SheetActionIcon icon={Phone} tone="muted" />
            <SheetRowText
              title={<span className="text-[color:var(--text-muted)]">Call</span>}
              sub="This number is too short to call. Edit it to fix."
            />
          </div>
        )}
        <button type="button" className={sheetRow} onClick={handleCopy} disabled={!dialable}>
          <SheetActionIcon icon={copy === "copied" ? Check : copy === "failed" ? TriangleAlert : Clipboard} />
          <SheetRowText
            title={copy === "copied" ? "Copied" : copy === "failed" ? "Not copied" : "Copy number"}
            sub={
              copy === "failed" ? `This phone blocked copying. The number is ${dialable}.` : "For a pager or the record"
            }
          />
        </button>
        <button type="button" className={sheetRow} onClick={() => onEdit(item)}>
          <SheetActionIcon icon={Pencil} />
          <SheetRowText title="Edit" sub="Name, number and note" />
        </button>
        <button
          type="button"
          className={sheetRow}
          onClick={() => {
            onTogglePin(item);
            onClose();
          }}
        >
          <SheetActionIcon icon={item.pinned ? PinOff : Pin} />
          <SheetRowText title={pinLabel} />
        </button>
        <button
          type="button"
          className={cn(sheetRow, "text-[color:var(--danger)] active:bg-[color:var(--danger-soft)]")}
          onClick={() => {
            onRemove(item);
            onClose();
          }}
        >
          <SheetActionIcon icon={X} tone="danger" />
          <SheetRowText title="Remove" />
        </button>
      </div>
      <p className={sheetFootnote}>{PRIVACY_NOTE}</p>
      <span className="sr-only" role="status" aria-live="polite">
        {copy === "copied"
          ? `${dialable} copied`
          : copy === "failed"
            ? `Could not copy. The number is ${dialable}.`
            : ""}
      </span>
    </div>
  );
}
