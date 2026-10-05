"use client";

import { Lock, TriangleAlert } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { ChoiceChips, SheetLabel } from "@/components/alerts/alerts-rows";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { ModeRow } from "@/components/mode-kit/grouped-list";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import {
  checkReminderText,
  REMIND_ME_TEXT_LIMIT,
  reminderWhenLabel,
  remindMeWhenOptions,
} from "@/lib/alerts/remind-me";
import { useSharedDevice } from "@/lib/alerts/shared-device";

/**
 * Screens 14 and 15: Remind me. A short note and a time, kept on this phone.
 * The words are checked as they are typed; Save stays off while they look like
 * a patient detail, and the sheet offers the same note without that part.
 */
export function RemindMeSheet({
  open,
  onClose,
  now,
  shiftEndsAt,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly now: Date;
  /** Today's rostered shift end, for the "End of shift" choice. */
  readonly shiftEndsAt: string | null;
}) {
  const { add } = useRemindMe();
  const shared = useSharedDevice();
  const whenId = useId();
  const noteId = useId();
  const [text, setText] = useState("");
  const options = useMemo(() => remindMeWhenOptions(now, shiftEndsAt), [now, shiftEndsAt]);
  // Null means "the default": the second choice, worked out from the time the sheet is open, not page load.
  const [when, setWhen] = useState<string | null>(null);
  const [failure, setFailure] = useState<"full" | "failed" | null>(null);
  const problem = text.trim() ? checkReminderText(text) : null;
  const chosen = options.find((option) => option.id === when) ?? options[1] ?? options[0]!;
  const canSave = Boolean(text.trim()) && !problem && !shared;

  const close = () => {
    setText("");
    setWhen(null);
    setFailure(null);
    onClose();
  };
  const save = () => {
    const result = add(text, chosen.dueAt);
    if (result === "saved") close();
    else setFailure(result === "full" ? "full" : "failed");
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Remind me"
      testId="remind-me-sheet"
      footer={
        <Button variant="primary" block disabled={!canSave} onClick={save} testId="remind-me-save">
          Save reminder
        </Button>
      }
    >
      <div className="grid min-w-0 gap-4">
        <TextField
          label="What to remind you about"
          hideLabel
          value={text}
          maxLength={REMIND_ME_TEXT_LIMIT}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask switchboard for the new pager list"
          aria-describedby={noteId}
          aria-invalid={problem ? true : undefined}
          autoComplete="off"
        />
        <div className="grid gap-1">
          <SheetLabel id={whenId}>When</SheetLabel>
          <ChoiceChips
            labelledBy={whenId}
            options={options.map((option) => ({ value: option.id, label: option.label }))}
            value={chosen.id}
            onChange={setWhen}
            testId="remind-me-when"
          />
        </div>
        {problem ? (
          <div
            role="alert"
            data-testid="remind-me-problem"
            className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[color:var(--warning)] bg-[color:var(--surface-raised)] p-3"
          >
            <TriangleAlert
              aria-hidden="true"
              strokeWidth={1.5}
              className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]"
            />
            <span className="grid min-w-0 gap-1">
              <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{problem.title}</span>
              <span className="text-sm leading-5 text-[color:var(--text)]">
                {problem.body}
                {problem.suggestion ? ` Try “${problem.suggestion}”.` : null}
              </span>
              {problem.suggestion ? (
                <span>
                  <Button variant="secondary" size="sm" onClick={() => setText(problem.suggestion!)}>
                    Use this wording
                  </Button>
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
        <p id={noteId} className="flex items-start gap-2 text-sm leading-5 text-[color:var(--text-muted)]">
          <Lock aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-icon-sm shrink-0" />
          <span>
            {shared
              ? "This is marked as a shared device, so it keeps no reminders. Use your own phone."
              : "No names, record numbers or bed numbers. The words stay on this phone and never reach our server or your calendar. For now it shows under Your reminders on the Alerts page, and it won't buzz. Not for legal deadlines such as Mental Health Act times."}
          </span>
        </p>
        {failure ? (
          <p role="status" className="text-sm text-[color:var(--text-muted)]">
            {failure === "full"
              ? "This phone already holds 20 reminders. Tick one off or remove one first."
              : "This phone couldn't save it. Try again."}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Your reminders: the notes on this phone, due ones first, each with Done and Remove. */
export function YourRemindersSheet({
  open,
  onClose,
  now,
  onAdd,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly now: Date;
  readonly onAdd: () => void;
}) {
  const { reminders, markDone, remove } = useRemindMe();
  const shared = useSharedDevice();
  // Still to do first (due ones at the top, as stored), ticked-off ones last.
  const ordered = [...reminders.filter((item) => !item.doneAt), ...reminders.filter((item) => item.doneAt)];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your reminders"
      description="Kept on this phone only"
      testId="your-reminders-sheet"
      footer={
        <Button variant="primary" block onClick={onAdd} disabled={shared} testId="your-reminders-add">
          Remind me
        </Button>
      }
    >
      <div className="grid min-w-0 gap-3">
        {reminders.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]" data-testid="your-reminders-empty">
            {shared ? "This shared device keeps no reminders." : "None set on this phone."}
          </p>
        ) : (
          <ul role="list" className={modeModuleSurface}>
            {ordered.map((item) => {
              const status = reminderWhenLabel(item, now);
              return (
                <ModeRow
                  key={item.id}
                  title={<span className={item.doneAt ? "line-through" : undefined}>{item.text}</span>}
                  subtitle={status}
                  trailing={
                    item.doneAt ? (
                      <Button variant="ghost" size="sm" onClick={() => remove(item.id)}>
                        Remove
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => markDone(item.id)}>
                        Done
                      </Button>
                    )
                  }
                />
              );
            })}
          </ul>
        )}
        <p className="text-sm leading-5 text-[color:var(--text-muted)]">
          Buzzing while the app is closed arrives with the next update. Signing out clears them.
        </p>
      </div>
    </Sheet>
  );
}
