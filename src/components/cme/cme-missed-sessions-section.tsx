"use client";

import { Link2, Plus, Trash2, Unlink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CmeDateField } from "@/components/cme/cme-date-field";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { EmptyState, InlineNotice } from "@/components/ui-primitives";
import { formatCmeRowDate, perthCalendarDate } from "@/lib/cme/cpd-year";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import {
  CME_MISSED_SESSION_MINUTES_MAX,
  CME_MISSED_SESSION_MINUTES_MIN,
  CME_MISSED_SESSION_REASON_HINT,
  CME_MISSED_SESSION_REASON_MAX,
  CME_MISSED_SESSION_TITLE_MAX,
  CME_MISSED_SESSION_TITLE_MIN,
  type CmeMissedSession,
  type CmeMissedSessionKind,
} from "@/lib/cme/missed-sessions";

/**
 * MISSED TEACHING — a section on the CME log page: a teaching or supervision
 * session lost to clinical work, with the ordinary activity that replaced it
 * linked back.
 *
 * A missed session earns no CPD credit of its own — this section never writes
 * anywhere `@/lib/cme/evaluate`, year close, the export or the annual summary
 * read from, and shows no hours for a missed entry. Only the replacement,
 * once logged as an ordinary activity, counts.
 */

/** The load state this section renders for, mirroring `CmeLoadState` without importing it. */
export type CmeMissedSessionsState = "ready" | "signed-out" | "load-failed";

export type CmeMissedSessionsEntryOption = {
  readonly id: string;
  readonly title: string;
  readonly date: string;
};

export type CmeMissedSessionsSectionProps = {
  /** Every missed session the owner has recorded, most recently occurred first. */
  readonly sessions: readonly CmeMissedSession[];
  /** The owner's own logged activities, offered as replacement candidates. */
  readonly entries: readonly CmeMissedSessionsEntryOption[];
  readonly state?: CmeMissedSessionsState;
  readonly demoMode?: boolean;
};

type Draft = {
  occurredOn: string;
  kind: CmeMissedSessionKind;
  title: string;
  minutesLost: string;
  reason: string;
};

const EMPTY_DRAFT: Draft = { occurredOn: "", kind: "teaching", title: "", minutesLost: "", reason: "" };

const KIND_OPTIONS: { value: CmeMissedSessionKind; label: string }[] = [
  { value: "teaching", label: "Teaching" },
  { value: "supervision", label: "Supervision" },
];

function draftToBody(draft: Draft) {
  const minutesLost = Number(draft.minutesLost);
  return {
    occurredOn: draft.occurredOn,
    kind: draft.kind,
    title: draft.title.trim(),
    minutesLost,
    reason: draft.reason.trim() ? draft.reason.trim() : null,
  };
}

function sessionToDraft(session: CmeMissedSession): Draft {
  return {
    occurredOn: session.occurredOn,
    kind: session.kind,
    title: session.title,
    minutesLost: String(session.minutesLost),
    reason: session.reason ?? "",
  };
}

/** `/cme/new`, prefilled with the missed session's own title and id, for "Log the replacement". */
export function missedReplacementHref(session: Pick<CmeMissedSession, "id" | "title">): string {
  return `/cme/new?${new URLSearchParams({ title: session.title, missed: session.id }).toString()}`;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? `${fallback} (${response.status}).`;
}

function MissedSessionFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <CmeDateField
          id={`${idPrefix}-date`}
          label="Date"
          today={perthCalendarDate(new Date())}
          value={draft.occurredOn}
          onChange={(occurredOn) => onChange({ ...draft, occurredOn })}
          required
        />
        <Select
          id={`${idPrefix}-kind`}
          label="Kind"
          options={KIND_OPTIONS}
          value={draft.kind}
          onChange={(event) => onChange({ ...draft, kind: event.target.value as CmeMissedSessionKind })}
        />
      </div>
      <TextField
        id={`${idPrefix}-title`}
        label="What was missed"
        placeholder="For example: Weekly registrar teaching"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        minLength={CME_MISSED_SESSION_TITLE_MIN}
        maxLength={CME_MISSED_SESSION_TITLE_MAX}
        required
      />
      <TextField
        id={`${idPrefix}-minutes`}
        label="Minutes lost"
        type="number"
        inputMode="numeric"
        min={CME_MISSED_SESSION_MINUTES_MIN}
        max={CME_MISSED_SESSION_MINUTES_MAX}
        value={draft.minutesLost}
        onChange={(event) => onChange({ ...draft, minutesLost: event.target.value })}
        required
      />
      <TextField
        id={`${idPrefix}-reason`}
        label="Reason"
        hint={CME_MISSED_SESSION_REASON_HINT}
        placeholder="Optional"
        value={draft.reason}
        maxLength={CME_MISSED_SESSION_REASON_MAX}
        onChange={(event) => onChange({ ...draft, reason: event.target.value })}
      />
    </div>
  );
}

export function CmeMissedSessionsSection({
  sessions: initialSessions,
  entries,
  state = "ready",
  demoMode = false,
}: CmeMissedSessionsSectionProps) {
  const [sessions, setSessions] = useState<readonly CmeMissedSession[]>(initialSessions);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkSelection, setLinkSelection] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const readOnly = demoMode;
  const today = perthCalendarDate(new Date());

  if (state === "signed-out") {
    return (
      <EmptyState
        testId="cme-missed-signed-out"
        title="Sign in to record a missed session."
        body="Missed teaching and supervision records are private to your account."
      />
    );
  }
  if (state === "load-failed") {
    return (
      <EmptyState
        testId="cme-missed-load-failed"
        title="Missed sessions could not be loaded."
        body="No saved data is being guessed or replaced. Please try again when the connection is restored."
      />
    );
  }

  async function submitAdd() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/cme/missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(addDraft)),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not save the missed session"));
      const payload = (await response.json()) as { missedSession: CmeMissedSession };
      setSessions((current) => [payload.missedSession, ...current]);
      setAddDraft(EMPTY_DRAFT);
      setAdding(false);
    } catch (error) {
      setMessage(cmeSaveErrorText(error, "Could not save the missed session."));
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(id: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/cme/missed/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(editDraft)),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not save the missed session"));
      const payload = (await response.json()) as { missedSession: CmeMissedSession };
      setSessions((current) => current.map((session) => (session.id === id ? payload.missedSession : session)));
      setEditingId(null);
    } catch (error) {
      setMessage(cmeSaveErrorText(error, "Could not save the missed session."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/cme/missed/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not delete the missed session"));
      setSessions((current) => current.filter((session) => session.id !== id));
    } catch (error) {
      setMessage(cmeSaveErrorText(error, "Could not delete the missed session."));
    } finally {
      setBusyId(null);
    }
  }

  async function setReplacement(id: string, replacementEntryId: string | null) {
    setBusyId(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/cme/missed/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacementEntryId }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not update the replacement link"));
      const payload = (await response.json()) as { missedSession: CmeMissedSession };
      setSessions((current) => current.map((session) => (session.id === id ? payload.missedSession : session)));
      setLinkingId(null);
      setLinkSelection("");
    } catch (error) {
      setMessage(cmeSaveErrorText(error, "Could not update the replacement link."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section data-testid="cme-missed-sessions" aria-labelledby="cme-missed-sessions-heading" className="grid gap-1.5">
      <h2 id="cme-missed-sessions-heading" className="work-label m-0">
        Missed teaching and supervision
        {sessions.length > 0 ? (
          <>
            {" · "}
            <span className="nums font-normal">{sessions.length}</span>
          </>
        ) : null}
      </h2>

      {demoMode ? (
        <div>
          <InlineNotice tone="neutral">Demo mode is read-only. Missed sessions are shown for inspection.</InlineNotice>
        </div>
      ) : null}

      <p role="status" className="cpd-hint m-0 font-semibold empty:hidden" data-testid="cme-missed-message">
        {message}
      </p>

      <ul role="list" className="m-0 grid gap-2 p-0" data-testid="cme-missed-list">
        {sessions.length === 0 ? (
          <li className="cpd-hint list-none" data-testid="cme-missed-empty">
            No missed sessions recorded. Add one the next time clinical work takes a teaching or supervision slot.
          </li>
        ) : (
          sessions.map((session) => {
            const busy = busyId === session.id;
            const replacementEntry = session.replacementEntryId
              ? (entries.find((entry) => entry.id === session.replacementEntryId) ?? null)
              : null;

            if (editingId === session.id) {
              return (
                <li
                  key={session.id}
                  className="work-card work-card--pad list-none"
                  data-testid={`cme-missed-row-${session.id}`}
                >
                  <MissedSessionFields
                    draft={editDraft}
                    onChange={setEditDraft}
                    idPrefix={`cme-missed-edit-${session.id}`}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" busy={busy} onClick={() => void submitEdit(session.id)}>
                      Save
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </li>
              );
            }

            return (
              <li
                key={session.id}
                className="work-card work-card--pad list-none"
                data-testid={`cme-missed-row-${session.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="work-row__title m-0">{session.title}</p>
                    <p className="work-row__sub m-0">
                      {formatCmeRowDate(session.occurredOn, today)} ·{" "}
                      {session.kind === "teaching" ? "Teaching" : "Supervision"} ·{" "}
                      <span className="nums font-normal">{session.minutesLost}</span> min lost
                    </p>
                    {session.reason ? <p className="work-row__sub m-0">{session.reason}</p> : null}
                  </div>
                  {!readOnly ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(session.id);
                          setEditDraft(sessionToDraft(session));
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        disabled={busy}
                        aria-label={`Delete missed session: ${session.title}`}
                        onClick={() => void remove(session.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {replacementEntry ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--text)]">
                        <Link2 aria-hidden="true" className="size-icon-sm shrink-0" />
                        Replaced by &ldquo;{replacementEntry.title}&rdquo;
                      </span>
                      {!readOnly ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Unlink}
                          disabled={busy}
                          onClick={() => void setReplacement(session.id, null)}
                        >
                          Unlink
                        </Button>
                      ) : null}
                    </div>
                  ) : session.replacementEntryId ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--text)]">
                        <Link2 aria-hidden="true" className="size-icon-sm shrink-0" />
                        Replacement logged
                      </span>
                      {!readOnly ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Unlink}
                          disabled={busy}
                          onClick={() => void setReplacement(session.id, null)}
                        >
                          Unlink
                        </Button>
                      ) : null}
                    </div>
                  ) : !readOnly ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={missedReplacementHref(session)}
                        className="work-button min-h-tap"
                        data-variant="tinted"
                      >
                        Log the replacement
                      </Link>
                      {linkingId === session.id ? (
                        <>
                          <Select
                            id={`cme-missed-link-${session.id}`}
                            label="Link an activity you already logged"
                            hideLabel
                            placeholder="Choose a logged activity"
                            options={entries.map((entry) => ({
                              value: entry.id,
                              label: `${entry.title} (${entry.date})`,
                            }))}
                            value={linkSelection}
                            onChange={(event) => setLinkSelection(event.target.value)}
                            className="max-w-xs"
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || !linkSelection}
                            onClick={() => void setReplacement(session.id, linkSelection)}
                          >
                            Link
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setLinkingId(session.id);
                            setLinkSelection("");
                          }}
                        >
                          Link an activity you already logged
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <p className="cpd-hint m-0">A missed session earns nothing itself. Link the activity that replaced it.</p>

      {!readOnly ? (
        <div>
          {adding ? (
            <div className="work-card work-card--pad" data-testid="cme-missed-add-form">
              <MissedSessionFields draft={addDraft} onChange={setAddDraft} idPrefix="cme-missed-add" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  busy={saving}
                  testId="cme-missed-add-save"
                  onClick={() => void submitAdd()}
                >
                  Save
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setAdding(false);
                    setAddDraft(EMPTY_DRAFT);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="work-button min-h-tap"
              data-variant="secondary"
              data-testid="cme-missed-add-open"
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden="true" className="size-icon-sm" />
              Record a missed session
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
