"use client";

import { useRef, useState } from "react";

import { formatModeTime } from "@/components/mode-kit/dates";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { modeNumberText } from "@/components/mode-kit/type";
import {
  afterChange,
  AUDIENCE_LABELS,
  changeRisks,
  draftChangesSomething,
  draftFor,
  type ChangeDraft,
  type GroupRow,
  type OrganiseRead,
  type SeriesRow,
} from "@/components/teaching/organise-model";
import { T5List, T5Row, T5Button } from "@/components/teaching/t5-kit";
import { perthDateKey, shortDayLabel, timeRange } from "@/components/teaching/teaching-dates";
import { TeachingSwitch } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { Checkbox } from "@/components/ui/choice";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import {
  changeReasons,
  memberLabel,
  seriesAudiences,
  seriesKinds,
  seriesRepeats,
  type SeriesAudience,
  type SessionSummary,
} from "@/lib/teaching/model";

/*
 * Organise's sheets. Worded actions use the app's own `Button`: the kit's
 * `ModeActionButton` is an icon-only in-row control (U1 report, R14). Every
 * half-filled form lives in React state only. Reader-facing words say
 * "service", never "team" (R7).
 */

const REASON_LABELS: Record<(typeof changeReasons)[number], string> = {
  presenter_unavailable: "Presenter unavailable",
  room_change: "Room change",
  clinical_pressure: "Clinical pressure",
  public_holiday: "Public holiday",
  rescheduled: "Rescheduled",
  other: "Other",
};
const KIND_LABELS: Record<(typeof seriesKinds)[number], string> = {
  lecture: "Lecture",
  case: "Case presentation",
  journal: "Journal club",
  grand_round: "Grand round",
  simulation: "Simulation",
  workshop: "Workshop",
  other: "Other",
};
export const REPEAT_LABELS: Record<(typeof seriesRepeats)[number], string> = {
  once: "Once",
  weekly: "Every week",
  fortnightly: `Every ${withUnit(2, "weeks")}`,
  monthly_nth: "Monthly, same weekday",
};
const ROLE_LABELS = { doctor: "Member", organiser: "Organiser", admin: "Admin" } as const;

const describe = (s: SessionSummary) =>
  s.status === "cancelled"
    ? "Cancelled"
    : [
        `${shortDayLabel(perthDateKey(s.startsAt))} · ${timeRange(s.startsAt, s.endsAt)}`,
        s.venue ?? "Room not set",
      ].join(" · ");

export function membersWord(count: number): string {
  return withUnit(count, count === 1 ? "member" : "members");
}

/** "No clashes", "1 thing to fix", "2 things to fix", beside the time the check ran. */
export function CheckedLine({ at, count }: { at: Date; count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={cn(modeNumberText, "text-xs", textMuted)}>{`Checked ${formatModeTime(at)}`}</span>
      <ModeStateLabel tone={count ? "warning" : "muted"}>
        {count === 0 ? "No clashes" : count === 1 ? "1 thing to fix" : `${count} things to fix`}
      </ModeStateLabel>
    </div>
  );
}

/** Posting a change (v5.2): before and after, the broken rule with Fix, a live recheck, one post button. */
export function ChangeSheet({
  session,
  others,
  memberCount,
  now,
  onClose,
  onPost,
}: {
  session: SessionSummary;
  others: readonly SessionSummary[];
  /** The members the change reaches (R9): the series' groups, or the whole service. */
  memberCount: number;
  now: Date;
  onClose: () => void;
  onPost: (draft: ChangeDraft, memberCount: number) => void;
}) {
  const [draft, setDraft] = useState<ChangeDraft>(() => draftFor(session));
  const room = useRef<HTMLInputElement>(null);
  const time = useRef<HTMLInputElement>(null);
  const risks = changeRisks(session, draft, others);
  const changes = draftChangesSomething(session, draft);
  const set = (patch: Partial<ChangeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <Sheet open onClose={onClose} title="Change this session">
      <div className="grid gap-3">
        <TeachingSwitch
          value={draft.status}
          onChange={(status) => set({ status })}
          label="Change"
          options={[
            { value: "moved", label: "Move" },
            { value: "cancelled", label: "Cancel" },
          ]}
        />
        {draft.status === "moved" ? (
          <div className="grid gap-2">
            <TextField label="Date" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            <TextField
              ref={time}
              label="Start"
              type="time"
              value={draft.startTime}
              onChange={(e) => set({ startTime: e.target.value })}
            />
            <TextField ref={room} label="Room" value={draft.venue} onChange={(e) => set({ venue: e.target.value })} />
          </div>
        ) : null}
        <Select
          label="Reason"
          value={draft.reason}
          onChange={(e) => set({ reason: e.target.value })}
          options={changeReasons.map((value) => ({ value, label: REASON_LABELS[value] }))}
        />
        <ModeGroupedList eyebrow="Before and after">
          <ModeRow title="Before" subtitle={describe(session)} />
          <ModeRow title="After" subtitle={describe(afterChange(session, draft))} />
        </ModeGroupedList>
        {risks.map((risk) => (
          <div key={risk.rule} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <ModeNotice tone="warning">{risk.text}</ModeNotice>
            <T5Button size="sm" onClick={() => (risk.rule === "room" ? room : time).current?.focus()}>
              Fix
            </T5Button>
          </div>
        ))}
        <CheckedLine at={now} count={risks.length} />
        {!changes && risks.length === 0 ? (
          <p className={cn("text-sm", textMuted)}>Change the date, time or room first.</p>
        ) : null}
        <T5Button
          variant="primary"
          block
          disabled={risks.length > 0 || !changes}
          onClick={() => onPost(draft, memberCount)}
        >
          {`Post to ${membersWord(memberCount)}`}
        </T5Button>
      </div>
    </Sheet>
  );
}

type SeriesForm = {
  title: string;
  kind: string;
  audience: SeriesAudience;
  repeat: string;
  firstDate: string;
  startTime: string;
  minutes: string;
  endDate: string;
  venue: string;
  joinUrl: string;
  groupIds: string[];
  /** Master plan R4/R5: a series a health service's visitors may open (F3). */
  openTo: "team" | "health_service";
};

/** The series editor, with the Audience picker (R4). */
export function SeriesSheet({
  serviceId,
  series,
  organise,
  onClose,
  onSaved,
  demo = false,
}: {
  serviceId: string;
  series: SeriesRow | null;
  organise: OrganiseRead;
  onClose: () => void;
  onSaved: () => void;
  /** The made-up demo service: the form checks itself, then closes with nothing sent or saved. */
  demo?: boolean;
}) {
  const [form, setForm] = useState<SeriesForm>(() => ({
    title: series?.title ?? "",
    kind: series?.kind ?? "lecture",
    audience: series?.audience ?? "all_doctors",
    repeat: series?.repeat ?? "weekly",
    firstDate: series?.firstDate ?? "",
    startTime: series?.startTime ?? "12:30",
    minutes: String(series?.minutes ?? 60),
    endDate: series?.endDate ?? "",
    venue: series?.venue ?? "",
    joinUrl: series?.joinUrl ?? "",
    groupIds: series?.groupIds ?? [],
    openTo: series?.openTo ?? "team",
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savedId = useRef(series?.seriesId ?? null);
  const [missingId, setMissingId] = useState(false);
  const set = (patch: Partial<SeriesForm>) => setForm((current) => ({ ...current, ...patch }));

  async function save() {
    const minutes = Number(form.minutes);
    if (form.title.trim().length < 3 || !form.firstDate) {
      setError("Give the series a title and a first date.");
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 480) {
      setError("A session runs for 10 to 480 minutes.");
      return;
    }
    if (demo) {
      onSaved();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A saved series read without its level keeps it: `series.save` leaves the level alone when
      // `audience` is left out, unless the organiser picked a different one here.
      const sendAudience = !series || series.audience !== undefined || form.audience !== "all_doctors";
      const saved = await teachingPost<{ seriesId?: string }>(teachingServiceUrl(serviceId), {
        action: "series.save",
        ...(savedId.current ? { seriesId: savedId.current } : {}),
        title: form.title.trim(),
        kind: form.kind,
        ...(sendAudience ? { audience: form.audience } : {}),
        repeat: form.repeat,
        firstDate: form.firstDate,
        startTime: form.startTime,
        minutes,
        endDate: form.repeat === "once" ? form.firstDate : form.endDate || form.firstDate,
        venue: form.venue.trim() || null,
        joinUrl: form.joinUrl.trim() || null,
        groupIds: form.groupIds,
        skipDates: series?.skipDates ?? [],
        presenterId: series?.presenterId ?? null,
        materials: series?.materials ?? [],
      });
      // R3/R5: open (or close) the series to the health service, only when the choice changed. A
      // refusal (`teaching_no_health_service`, 409) lands in `error` below; the series itself is
      // already saved, so that notice is the whole story.
      const seriesId = savedId.current ?? saved.seriesId;
      if (!seriesId) {
        setMissingId(true);
        setError(
          "The series may have saved, but its ID was missing. Close this sheet and refresh Organise before trying again.",
        );
        return;
      }
      savedId.current = seriesId;
      if (form.openTo !== (series?.openTo ?? "team")) {
        await teachingPost(`/api/teaching/resources/services/${serviceId}`, {
          action: "series.set_open_to",
          seriesId,
          openTo: form.openTo,
        });
      }
      onSaved();
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={series ? "Edit series" : "New series"}>
      <div className="grid gap-2">
        <TextField label="Title" value={form.title} onChange={(e) => set({ title: e.target.value })} />
        <Select
          label="Kind"
          value={form.kind}
          onChange={(e) => set({ kind: e.target.value })}
          options={seriesKinds.map((value) => ({ value, label: KIND_LABELS[value] }))}
        />
        <Select
          label="Audience"
          value={form.audience}
          onChange={(e) => set({ audience: e.target.value as SeriesAudience })}
          options={seriesAudiences.map((value) => ({ value, label: AUDIENCE_LABELS[value] }))}
        />
        <Select
          label="Repeats"
          value={form.repeat}
          onChange={(e) => set({ repeat: e.target.value })}
          options={seriesRepeats.map((value) => ({ value, label: REPEAT_LABELS[value] }))}
        />
        <TextField
          label="First date"
          type="date"
          value={form.firstDate}
          onChange={(e) => set({ firstDate: e.target.value })}
        />
        <TextField
          label="Start"
          type="time"
          value={form.startTime}
          onChange={(e) => set({ startTime: e.target.value })}
        />
        <TextField
          label="Minutes"
          inputMode="numeric"
          value={form.minutes}
          onChange={(e) => set({ minutes: e.target.value })}
        />
        {form.repeat === "once" ? null : (
          <TextField
            label="Last date"
            type="date"
            value={form.endDate}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        )}
        <TextField label="Room" value={form.venue} onChange={(e) => set({ venue: e.target.value })} />
        <TextField
          label="Online link"
          type="url"
          value={form.joinUrl}
          onChange={(e) => set({ joinUrl: e.target.value })}
        />
        <TeachingSwitch
          label="Open to"
          value={form.openTo}
          onChange={(openTo) => set({ openTo })}
          options={[
            { value: "team", label: "Your service" },
            { value: "health_service", label: "Health service" },
          ]}
        />
        <p className={cn("text-sm", textMuted)}>
          {"Open sessions show in What's on across your health service. Check-in codes stay with your service."}
        </p>
        {organise.groups.length > 0 ? (
          <fieldset className="grid gap-1">
            <legend className={cn("text-sm", textMuted)}>For groups (none means the whole service)</legend>
            {organise.groups.map((group) => (
              <Checkbox
                key={group.groupId}
                label={group.name}
                checked={form.groupIds.includes(group.groupId)}
                onChange={(e) =>
                  set({
                    groupIds: e.target.checked
                      ? [...form.groupIds, group.groupId]
                      : form.groupIds.filter((id) => id !== group.groupId),
                  })
                }
              />
            ))}
          </fieldset>
        ) : null}
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
        <T5Button
          variant="primary"
          block
          busy={busy}
          busyLabel="Saving"
          disabled={missingId}
          onClick={() => void save()}
        >
          Save series
        </T5Button>
      </div>
    </Sheet>
  );
}

export function GroupSheet({
  serviceId,
  group,
  organise,
  onClose,
  onSaved,
  demo = false,
}: {
  serviceId: string;
  group: GroupRow | null;
  organise: OrganiseRead;
  onClose: () => void;
  onSaved: () => void;
  /** The made-up demo service: closes with nothing sent or saved. */
  demo?: boolean;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [userIds, setUserIds] = useState<string[]>(group?.userIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savedId = useRef(group?.groupId ?? null);
  const [missingId, setMissingId] = useState(false);
  async function save() {
    if (!name.trim()) {
      setError("Give the group a name.");
      return;
    }
    if (demo) {
      onSaved();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = teachingServiceUrl(serviceId);
      const saved = await teachingPost<{ groupId?: string }>(url, {
        action: "group.save",
        ...(savedId.current ? { groupId: savedId.current } : {}),
        name: name.trim(),
      });
      const groupId = savedId.current ?? saved.groupId;
      if (!groupId) {
        setMissingId(true);
        setError(
          "The group may have saved, but its ID was missing. Close this sheet and refresh Organise before trying again.",
        );
        return;
      }
      savedId.current = groupId;
      await teachingPost(url, { action: "group.members.set", groupId, userIds });
      onSaved();
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={group ? "Edit group" : "New group"}>
      <div className="grid gap-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        {organise.members.length > 0 ? (
          <fieldset className="grid gap-1">
            <legend className={cn("text-sm", textMuted)}>Members in this group</legend>
            {organise.members.map((m) => (
              <Checkbox
                key={m.userId}
                label={memberLabel(m)}
                checked={userIds.includes(m.userId)}
                onChange={(e) =>
                  setUserIds(e.target.checked ? [...userIds, m.userId] : userIds.filter((id) => id !== m.userId))
                }
              />
            ))}
          </fieldset>
        ) : null}
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
        <T5Button
          variant="primary"
          block
          busy={busy}
          busyLabel="Saving"
          disabled={missingId}
          onClick={() => void save()}
        >
          Save group
        </T5Button>
      </div>
    </Sheet>
  );
}

/** Members, filtered on this device only: a plain box, never the search composer, and no mic. */
export function MembersSheet({ organise, onClose }: { organise: OrganiseRead; onClose: () => void }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = organise.members.filter((m) => !needle || memberLabel(m).toLowerCase().includes(needle));
  return (
    <Sheet open onClose={onClose} title="Members">
      <div className="grid gap-2">
        <TextField
          label="Filter members"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {shown.length > 0 ? (
          <ModeGroupedList>
            {shown.map((m) => (
              <ModeRow key={m.userId} title={memberLabel(m)} subtitle={ROLE_LABELS[m.role]} />
            ))}
          </ModeGroupedList>
        ) : (
          <p className={cn("text-sm", textMuted)}>No member matches that.</p>
        )}
      </div>
    </Sheet>
  );
}

/** The invitation code is shown once; the invitee redeems it under On Call's "Join with invitation" (R12). */
export function InviteSheet({
  serviceId,
  onClose,
  demo = false,
}: {
  serviceId: string;
  onClose: () => void;
  /** The made-up demo service: no invitation is created and no code is shown. */
  demo?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [made, setMade] = useState<{ code: string; expiresAt: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  async function create() {
    if (demo) {
      setDemoDone(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await teachingPost<{ code: string; expiresAt: string }>(teachingServiceUrl(serviceId), {
        action: "invitation.create",
        email: email.trim(),
      });
      setMade({ code: result.code, expiresAt: result.expiresAt, email: email.trim() });
    } catch (cause) {
      setError(teachingErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title="Invite a member">
      <div className="grid gap-2">
        {demoDone ? (
          <p className={cn("text-sm", textMuted)}>
            Demo only. No invitation was created or sent. In a real service the invitee gets a one-time code to enter
            under Join with invitation.
          </p>
        ) : made ? (
          <>
            <p className={cn(modeNumberText, "text-base-minus break-all text-[color:var(--text-heading)] select-all")}>
              {made.code}
            </p>
            <p className={cn("text-sm", textMuted)}>
              {`Give them this code. They sign in with ${made.email} and enter it under Join with invitation. It works until ${shortDayLabel(perthDateKey(made.expiresAt))}, and only once.`}
            </p>
            <T5Button block onClick={() => void copy(made.code)}>
              {copied ? "Copied" : "Copy code"}
            </T5Button>
          </>
        ) : (
          <>
            <TextField
              label="Work email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
            <T5Button variant="primary" block busy={busy} busyLabel="Creating" onClick={() => void create()}>
              Create invitation
            </T5Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** "New change": choose which coming session to move or cancel, then the change sheet opens. */
export function PickSessionSheet({
  sessions,
  onPick,
  onClose,
}: {
  sessions: readonly SessionSummary[];
  onPick: (session: SessionSummary) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose} title="New change">
      <div className="grid gap-2">
        {sessions.length > 0 ? (
          <T5List ruled testId="teaching-organise-pick">
            {sessions.map((s) => (
              <T5Row key={s.occurrenceId} title={s.title} meta={describe(s)} onClick={() => onPick(s)} />
            ))}
          </T5List>
        ) : (
          <p className={cn("text-sm", textMuted)}>No coming sessions to change this week.</p>
        )}
      </div>
    </Sheet>
  );
}
