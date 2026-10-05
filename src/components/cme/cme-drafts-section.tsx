"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CmeDateField } from "@/components/cme/cme-date-field";
import { CmeNote } from "@/components/cme/cme-flat-list";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, InlineNotice, textMuted } from "@/components/ui-primitives";
import { formatCalendarDateLong, perthCalendarDate } from "@/lib/cme/cpd-year";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import {
  CME_DRAFT_WAITING_NOTE_MAX_LENGTH,
  draftTitle,
  groupDrafts,
  type CmeDraft,
  type CmeDraftWaitingOn,
} from "@/lib/cme/drafts";

/**
 * DRAFTS — a half-finished activity, saved to the account, shown on the log
 * page in three groups: yours to do (the Log tab's count), waiting on a
 * supervisor, waiting on workforce. A draft never counts toward hours (see
 * `src/lib/cme/drafts.ts`), and marking one "waiting" is never itself an
 * approval — it is only a note to come back to.
 *
 * Hidden entirely when there are no drafts, so an owner who never saves one
 * never sees an empty "Drafts" section on their log. Also hidden while signed
 * out, the same as the rest of a private CME record: `cme-log-page.tsx` and
 * `cme-plan-page.tsx` only ever render once a session is known-signed-in
 * (their surrounding `CmeOwnerBoundary` withholds `children` otherwise and
 * they take only a `demoMode` flag from there), so this section takes the
 * matching three flags directly — `signedIn`, `demoMode`, `loadFailed` — so it
 * can be gated and tested the same way without depending on that wiring.
 */

/**
 * "Yours to do" is exactly the count on the Log tab in the CPD header (drafts whose next step is
 * the doctor's, `groupDrafts(...).nextAction`); the two waiting groups are never counted there.
 */
const WAITING_GROUP_LABEL = {
  nextAction: "Yours to do",
  supervisor: "Waiting on others: your supervisor",
  workforce: "Waiting on others: workforce",
} as const;

const waitingOnOptions: SelectOption[] = [
  { value: "", label: "None, yours to do" },
  { value: "supervisor", label: "Waiting for supervisor" },
  { value: "workforce", label: "Waiting for workforce" },
];

export type WaitingOnValue = {
  readonly waitingOn: CmeDraftWaitingOn | null;
  readonly waitingNote: string;
  readonly followUpOn: string;
};

export type WaitingOnControlsProps = {
  readonly value: WaitingOnValue;
  readonly onWaitingOnChange: (waitingOn: CmeDraftWaitingOn | null) => void;
  readonly onWaitingNoteChange: (note: string) => void;
  /** Fired when the note field loses focus — the natural point to persist free text. */
  readonly onWaitingNoteBlur?: () => void;
  readonly onFollowUpOnChange: (date: string) => void;
  readonly disabled?: boolean;
  /** Namespaces every control's id, so more than one instance can sit on a page. */
  readonly idPrefix: string;
};

/**
 * The three "waiting on someone" controls — who, an optional note, a
 * follow-up date — as a small controlled unit with no fetch logic of its own.
 * Fully reusable: the entry form's own Save-as-draft flow renders the exact
 * same component around its own draft state.
 */
export function WaitingOnControls({
  value,
  onWaitingOnChange,
  onWaitingNoteChange,
  onWaitingNoteBlur,
  onFollowUpOnChange,
  disabled = false,
  idPrefix,
}: WaitingOnControlsProps) {
  return (
    <div className="flex flex-col gap-3" data-testid={`${idPrefix}-waiting-controls`}>
      <Select
        label="Waiting on"
        id={`${idPrefix}-waiting-on`}
        options={waitingOnOptions}
        value={value.waitingOn ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onWaitingOnChange(event.target.value === "" ? null : (event.target.value as CmeDraftWaitingOn))
        }
      />
      {value.waitingOn ? (
        <>
          <TextField
            label="Note (optional)"
            id={`${idPrefix}-waiting-note`}
            value={value.waitingNote}
            maxLength={CME_DRAFT_WAITING_NOTE_MAX_LENGTH}
            hint="Don't include patient details."
            disabled={disabled}
            onChange={(event) => onWaitingNoteChange(event.target.value)}
            onBlur={onWaitingNoteBlur}
          />
          <CmeDateField
            label="Follow up on"
            id={`${idPrefix}-follow-up`}
            chips={false}
            today={perthCalendarDate(new Date())}
            value={value.followUpOn}
            disabled={disabled}
            onChange={onFollowUpOnChange}
          />
        </>
      ) : null}
    </div>
  );
}

function DraftRow({
  draft,
  demoMode,
  onChanged,
  onDeleted,
}: {
  draft: CmeDraft;
  demoMode: boolean;
  onChanged: (draft: CmeDraft) => void;
  onDeleted: (id: string) => void;
}) {
  const [waitingOn, setWaitingOn] = useState<CmeDraftWaitingOn | null>(draft.waitingOn);
  const [waitingNote, setWaitingNote] = useState(draft.waitingNote ?? "");
  const [followUpOn, setFollowUpOn] = useState(draft.followUpOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: WaitingOnValue) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cme/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waitingOn: next.waitingOn,
          waitingNote: next.waitingNote.trim() === "" ? null : next.waitingNote.trim(),
          followUpOn: next.followUpOn === "" ? null : next.followUpOn,
        }),
      });
      const body = (await response.json().catch(() => null)) as { draft?: CmeDraft; message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? `Could not update this draft (${response.status}).`);
      if (body?.draft) onChanged(body.draft);
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not update this draft."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cme/drafts/${draft.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Could not delete this draft (${response.status}).`);
      }
      onDeleted(draft.id);
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not delete this draft."));
      setBusy(false);
    }
  }

  return (
    <li
      className="flex flex-col gap-3 border-t border-[color:var(--border)] py-3 first:border-t-0"
      data-testid={`cme-draft-${draft.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium text-[color:var(--text-heading)]">{draftTitle(draft)}</p>
          <p className={cn(textMuted, "mt-0.5 text-xs")}>
            Last edited {formatCalendarDateLong(perthCalendarDate(new Date(draft.updatedAt)))}
          </p>
          {draft.followUpOn ? (
            <p className={cn(textMuted, "mt-1 text-xs")}>Follow up {formatCalendarDateLong(draft.followUpOn)}</p>
          ) : null}
          {draft.waitingNote ? <p className="mt-1 text-sm text-[color:var(--text)]">{draft.waitingNote}</p> : null}
        </div>
        <Link
          href={`/cme/new?draft=${draft.id}`}
          data-testid={`cme-draft-continue-${draft.id}`}
          className="min-h-tap inline-flex shrink-0 items-center text-sm-minus font-medium text-[color:var(--clinical-accent)]"
        >
          Continue
        </Link>
      </div>

      {!demoMode ? (
        <WaitingOnControls
          idPrefix={`cme-draft-${draft.id}`}
          value={{ waitingOn, waitingNote, followUpOn }}
          disabled={busy}
          onWaitingOnChange={(next) => {
            setWaitingOn(next);
            void save({ waitingOn: next, waitingNote, followUpOn });
          }}
          onWaitingNoteChange={setWaitingNote}
          onWaitingNoteBlur={() => void save({ waitingOn, waitingNote, followUpOn })}
          onFollowUpOnChange={(next) => {
            setFollowUpOn(next);
            void save({ waitingOn, waitingNote, followUpOn: next });
          }}
        />
      ) : null}

      {error ? <InlineNotice tone="neutral">{error}</InlineNotice> : null}

      {!demoMode ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Trash2}
            busy={busy}
            busyLabel="Deleting…"
            onClick={() => void remove()}
            testId={`cme-draft-delete-${draft.id}`}
          >
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export type CmeDraftsSectionProps = {
  readonly drafts: readonly CmeDraft[];
  /** Demo mode is read-only: shown without the waiting controls or Delete. */
  readonly demoMode?: boolean;
  /** A draft is a private per-owner record; signed out, the section shows nothing. */
  readonly signedIn?: boolean;
  /** The drafts fetch failed — reported rather than silently hidden. */
  readonly loadFailed?: boolean;
};

export function CmeDraftsSection({
  drafts,
  demoMode = false,
  signedIn = true,
  loadFailed = false,
}: CmeDraftsSectionProps) {
  const [items, setItems] = useState<readonly CmeDraft[]>(drafts);

  if (!signedIn) return null;

  if (loadFailed) {
    return (
      <section className="mt-6" data-testid="cme-drafts-section" aria-labelledby="cme-drafts-heading">
        <h2 id="cme-drafts-heading" className={cn(eyebrowText, "mb-2")}>
          Drafts
        </h2>
        <div data-testid="cme-drafts-load-failed">
          <CmeNote tone="warn" icon={<TriangleAlert aria-hidden="true" strokeWidth={1.6} />}>
            Your drafts could not be loaded. Reload the page to try again.
          </CmeNote>
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  const groups = groupDrafts(items);
  const sections = (["nextAction", "supervisor", "workforce"] as const)
    .map((key) => ({ key, drafts: groups[key] }))
    .filter((group) => group.drafts.length > 0);

  function handleChanged(next: CmeDraft) {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
  }
  function handleDeleted(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="mt-6" data-testid="cme-drafts-section" aria-labelledby="cme-drafts-heading">
      <h2 id="cme-drafts-heading" className={cn(eyebrowText, "mb-2")}>
        Drafts
      </h2>
      <div className="flex flex-col gap-5">
        {sections.map((group) => (
          <div key={group.key} data-testid={`cme-drafts-group-${group.key}`}>
            <h3 className="text-sm font-semibold text-[color:var(--text)]">
              {`${WAITING_GROUP_LABEL[group.key]} · ${group.drafts.length}`}
            </h3>
            <ul className="mt-1 flex flex-col">
              {group.drafts.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  demoMode={demoMode}
                  onChanged={handleChanged}
                  onDeleted={handleDeleted}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
