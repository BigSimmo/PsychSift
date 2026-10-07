"use client";

import { useState } from "react";

import { AdminMeter, adminStyles } from "@/components/admin/admin-kit";
import { WorkButton, WorkCard } from "@/components/mode-kit/work";
import { TextField } from "@/components/ui/text-field";
import { formatDateEcho, formatRelativeDate } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * New job's start card (work-mode redesign, owner request 6 Oct 2026): a date
 * tile, "Starts Mon 2 Nov 2026 · in 5 weeks", "3 of 7 done" with a thin meter,
 * and the one way to set or clear that date. There is no week strip (owner
 * decision). The date field starts blank and echoes what was typed, in words,
 * before Save is enabled; nothing is guessed.
 */
export function AdminNewJobStart({
  startsOn,
  now,
  canEdit,
  readOnlyReason = null,
  onSignIn,
  onSave,
  onClear,
  done = 0,
  total = 0,
}: {
  /** `YYYY-MM-DD`, or null when no start date is recorded. */
  startsOn: string | null;
  now: Date;
  /** False when there is no own row to attach the date to. */
  canEdit: boolean;
  /**
   * Why the date cannot be set, said beneath the start line: signed out (with
   * a sign-in control) or example records. Null says nothing — while loading,
   * after a failed load, or when there is no own row to hold the date.
   */
  readOnlyReason?: "signed-out" | "demo" | null;
  /** Opens the app's sign-in dialog; the signed-out reason offers it. */
  onSignIn?: () => void;
  onSave: (date: string) => Promise<boolean>;
  onClear: () => void;
  /** Own New job steps ticked, and how many there are, for the meter. */
  done?: number;
  total?: number;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const echo = DATE_KEY.test(draft) ? formatDateEcho(draft) : "";
  const today = perthCalendarDate(now);

  const parts = startsOn ? onCallTeachingDateParts(startsOn) : null;

  return (
    <WorkCard padded testId="admin-new-job-start">
      <div className={adminStyles.startHead}>
        {parts?.day && parts.month ? (
          <span aria-hidden="true" className="work-date">
            <span className="work-date__month">{parts.month}</span>
            <span className="work-date__day">{parts.day}</span>
          </span>
        ) : null}
        <p className="work-row__text m-0" data-testid="admin-new-job-start-line">
          {startsOn ? (
            <>
              <span className="work-row__title">{`Starts ${formatDateEcho(startsOn)}`}</span>
              <span className="work-row__sub">{` · ${formatRelativeDate(startsOn, today)}`}</span>
            </>
          ) : (
            <span className="work-row__sub">No start date set</span>
          )}
        </p>
        {total > 0 ? <span className="work-row__end tabular-nums">{`${done} of ${total}`}</span> : null}
      </div>
      {total > 0 ? (
        <div className="mt-3">
          <AdminMeter fraction={done / total} label={`${done} of ${total} New job steps done`} />
        </div>
      ) : null}
      {!canEdit && readOnlyReason === "signed-out" && onSignIn ? (
        <div className={adminStyles.startControls} data-testid="admin-new-job-start-signed-out">
          <WorkButton variant="secondary" onClick={onSignIn} testId="admin-new-job-start-sign-in">
            Sign in to set your start date
          </WorkButton>
        </div>
      ) : null}
      {!canEdit && readOnlyReason === "demo" ? (
        <p className="work-row__sub mt-2 mb-0" data-testid="admin-new-job-start-demo">
          Example records are read-only
        </p>
      ) : null}
      {canEdit ? (
        <div className={adminStyles.startControls}>
          <div data-testid="admin-new-job-start-input">
            <TextField
              label="Start date"
              hideLabel
              type="date"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              fieldClassName="max-w-48"
            />
          </div>
          <WorkButton
            variant="secondary"
            disabled={!DATE_KEY.test(draft) || saving}
            onClick={async () => {
              setSaving(true);
              try {
                if (await onSave(draft)) setDraft("");
              } finally {
                setSaving(false);
              }
            }}
            testId="admin-new-job-start-save"
          >
            {startsOn ? "Change" : "Set start date"}
          </WorkButton>
          {startsOn ? (
            <WorkButton variant="quiet" onClick={onClear} testId="admin-new-job-start-clear">
              Clear
            </WorkButton>
          ) : null}
          {echo ? (
            <span className="work-row__sub w-full" data-testid="admin-new-job-start-echo">
              {echo}
            </span>
          ) : null}
        </div>
      ) : null}
    </WorkCard>
  );
}
