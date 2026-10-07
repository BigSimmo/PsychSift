"use client";

import { Bell, Check, Clock, Copy, Inbox, Send, TriangleAlert, UserRound, WifiOff, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { WorkEmpty } from "@/components/mode-kit/work";
import { useAssessmentsExtras, useOfflineSince } from "@/components/teaching/assessments/assessments-extras";
import {
  Inset,
  KeyValue,
  List,
  Pill,
  Row,
  ScreenHeader,
  SectionLabel,
  SmallPrint,
  TextLink,
  WhyNot,
  labelText,
  secondaryText,
  titleText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { SUPERVISION_LEVELS, epa as epaInfo, type SupervisionLevel } from "@/lib/teaching/assessments/content";
import {
  CANT_REASONS,
  EMPTY_ANSWER,
  FEEDBACK_MAX_CHARS,
  INBOX_FILTERS,
  LATER_WHEN,
  SUGGESTED_COLLEAGUES,
  claCopyText,
  dctRemindersFor,
  doctorSees,
  doctorView,
  feedbackProblem,
  filterCounts,
  inboxRequests,
  inboxRowStatus,
  isWaiting,
  matchesFilter,
  sendBlocker,
  sortInbox,
  type CantReason,
  type InboxAnswer,
  type InboxFilter,
  type InboxRail,
  type InboxRequest,
  type InboxSort,
} from "@/lib/teaching/assessments/inbox";
import type { PillTone } from "@/lib/teaching/assessments/model";

/*
 * The consultant inbox (feature 16, mock-up nf_assess_inbox): every request waiting for the supervisor in one
 * dense list, overdue first, each row with a thin status rail and one tag, opened in one tap. Made-up doctors in
 * page memory; nothing is sent. Sam's requests open the sample's own screens; the others take a supervision
 * level and a few lines, checked for patient details before they can go, and send after 10 seconds with Undo.
 * A voice note is not built: it needs the microphone and somewhere to keep audio.
 */

const asSup = { as: "supervisor" };
const SORTS: readonly { value: InboxSort; label: string }[] = [
  { value: "oldest", label: "Oldest" },
  { value: "due", label: "Due date" },
  { value: "doctor", label: "Doctor" },
];

type Draft = { level: SupervisionLevel | null; text: string };
type SheetMode = { id: string; mode: "feedback" | "cant" | "status" | "doctor" } | null;

const RAIL: Record<InboxRail, string> = {
  overdue: "bg-[color:var(--danger-text)]",
  long: "bg-[color:var(--warning)]",
  new: "bg-[color:var(--mode-identity)]",
  none: "bg-transparent",
};

const TAG_TONE: Record<ReturnType<typeof inboxRowStatus>["tone"], PillTone> = {
  bad: "bad",
  warm: "warm",
  accent: "accent",
  neutral: "neutral",
};

function rowTitle(item: InboxRequest): string {
  return `${item.doctor.name} · ${item.kind === "epa" ? `EPA ${item.epa}` : item.title}`;
}

function rowSubtitle(item: InboxRequest): string {
  const what = item.kind === "epa" && item.epa ? `${epaInfo(item.epa).title} · ` : "";
  return `${what}${[item.doctor.grade, `asked ${item.askedOn}`].join(" · ")}`;
}

/** One request: a thin status rail, the doctor, what was asked and when, and one status tag. */
function InboxRow({ item, onOpen }: { item: InboxRequest; onOpen: () => void }) {
  const status = inboxRowStatus(item);
  return (
    <li className="relative border-t border-[color:var(--border)] first:border-t-0" data-rail={status.rail}>
      <i
        aria-hidden="true"
        className={cn("absolute top-2.5 bottom-2.5 left-1 w-0.5 rounded-full forced-colors:hidden", RAIL[status.rail])}
      />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          focusRing,
          "flex min-h-15 w-full min-w-0 items-center gap-3 rounded-lg py-3 pr-3 pl-4 text-left hover:bg-[color:var(--surface-wash)]",
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-heading)]"
        >
          {item.doctor.initials}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={titleText}>{rowTitle(item)}</span>
          <span className={cn(secondaryText, "break-words")}>{rowSubtitle(item)}</span>
        </span>
        <Pill pill={{ label: status.tag, tone: TAG_TONE[status.tone] }} />
      </button>
    </li>
  );
}

export function AssessmentsInbox({ s, openSheet, go }: ScreenProps) {
  const { extras, dispatchExtras, sendAnswers, undoSends, offerUndo, setEditing } = useAssessmentsExtras();
  const offlineSince = useOfflineSince();
  const [tab, setTab] = useState<"waiting" | "done">("waiting");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [sort, setSort] = useState<InboxSort>("oldest");
  const sortLabelId = useId();
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const items = useMemo(() => inboxRequests(s, extras.answers), [s, extras.answers]);
  const counts = filterCounts(items);
  const waiting = sortInbox(items.filter(isWaiting), sort);
  const shown = waiting.filter((i) => matchesFilter(i, filter));
  const done = items.filter((i) => !isWaiting(i) && i.status !== "sending");
  const sending = items.filter((i) => i.status === "sending");
  const overdue = shown.filter((i) => i.overdue);
  const later = shown.filter((i) => i.status === "later");
  const rest = shown.filter((i) => !i.overdue && i.status !== "later");
  const open = sheet ? (items.find((i) => i.id === sheet.id) ?? null) : null;
  const dct = dctRemindersFor(extras.reminders, items);

  // While an answer's sheet is open, a reconnect does not send its older To send copy from under it.
  useEffect(() => {
    setEditing(sheet && sheet.mode !== "doctor" ? sheet.id : null);
    return () => setEditing(null);
  }, [sheet, setEditing]);

  function openItem(item: InboxRequest) {
    if (item.open.kind === "sheet") openSheet({ kind: "supepa", index: item.open.index });
    else if (item.open.kind === "href") go(viewHref(item.open.view, asSup));
    else setSheet({ id: item.id, mode: item.open.kind === "status" ? "status" : "feedback" });
  }

  function draftFor(item: InboxRequest): Draft {
    const kept = drafts[item.id];
    if (kept) return kept;
    const answer = extras.answers[item.id] ?? EMPTY_ANSWER;
    return { level: answer.level, text: answer.text };
  }

  function send(item: InboxRequest, draft: Draft) {
    if (!draft.level || sendBlocker(draft)) return;
    setSheet(null);
    setDrafts((all) => {
      const next = { ...all };
      delete next[item.id];
      return next;
    });
    if (offlineSince) {
      // Kept exactly as typed. The patient-detail check reads a cleaned copy and never changes this text.
      dispatchExtras({ type: "inbox-queue", id: item.id, level: draft.level, text: draft.text });
      announce(`Kept to send to ${item.doctor.name} when you are back online.`);
      return;
    }
    sendAnswers([{ id: item.id, level: draft.level, text: draft.text }], `Sending to ${item.doctor.name} in 10 s`);
  }

  function moveLater(item: InboxRequest) {
    pass(item, "not_this_week", null);
  }

  function pass(item: InboxRequest, reason: CantReason, suggestion: string | null) {
    dispatchExtras({ type: "inbox-cant", id: item.id, reason, suggestion });
    setSheet(null);
    const title =
      reason === "not_this_week"
        ? `Moved to Later · back ${LATER_WHEN}`
        : `${item.doctor.name} sees: ${doctorSees(reason, suggestion)}`;
    offerUndo({
      title,
      body: "Made-up: nothing reaches anyone.",
      undo: () => dispatchExtras({ type: "inbox-restore", id: item.id }),
      undone: "Back in your inbox.",
    });
  }

  const section = (label: string, list: InboxRequest[], end?: ReactNode) =>
    list.length ? (
      <>
        <SectionLabel end={end}>{`${label} · ${list.length}`}</SectionLabel>
        <ul
          role="list"
          aria-label={label}
          className="grid min-w-0 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] forced-colors:border"
        >
          {list.map((item) => (
            <InboxRow key={item.id} item={item} onOpen={() => openItem(item)} />
          ))}
        </ul>
      </>
    ) : null;

  return (
    <div className="grid gap-3" data-testid="assessments-inbox">
      <ScreenHeader
        back={viewHref("home", asSup)}
        backLabel="your requests"
        title="Inbox"
        subtitle={offlineSince ? `Offline · as saved at ${offlineSince}` : "Made-up requests to you"}
      />
      {offlineSince ? (
        <div role="status" data-testid="assessments-inbox-offline">
          <Inset tone="warm" icon={WifiOff} title="No connection">
            {`Requests as saved at ${offlineSince}. What you write is kept on this page as To send, and goes when you are back online.`}
          </Inset>
        </div>
      ) : dct.length ? (
        <div
          data-testid="assessments-inbox-dct"
          className="flex min-w-0 items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3.5 py-3"
        >
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
          >
            <Bell aria-hidden="true" className="size-icon-sm" strokeWidth={1.75} />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className={titleText}>Reminder from the DCT</span>
            <span className={secondaryText}>
              {`${dct[0]!.text} · ${dct[0]!.at}${dct.length > 1 ? ` · and ${dct.length - 1} more` : ""}`}
            </span>
          </span>
          {dct[0]!.requestId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const item = items.find((i) => i.id === dct[0]!.requestId);
                if (item) openItem(item);
              }}
            >
              Open
            </Button>
          ) : null}
        </div>
      ) : null}
      <SegmentedControl
        label="Requests"
        layout="equal"
        value={tab}
        onChange={setTab}
        options={[
          { value: "waiting", label: `Waiting · ${counts.all}` },
          { value: "done", label: `Done · ${done.length}` },
        ]}
      />
      {tab === "waiting" ? (
        <>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {INBOX_FILTERS.map((f) => (
              <ChoiceChip key={f.id} pressed={filter === f.id} onPressedChange={() => setFilter(f.id)}>
                {`${f.label} · ${counts[f.id]}`}
              </ChoiceChip>
            ))}
          </div>
          {sending.length ? (
            <div role="status" className="grid gap-1.5 px-1" data-testid="assessments-inbox-sending">
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className={secondaryText}>
                  {`Sending ${sending.length === 1 ? "1 answer" : `${sending.length} answers`} in 10 s.`}
                </span>
                {/* Undo here as well as on the message, so it stays in reach if the message is pushed off. */}
                <Button variant="secondary" size="sm" onClick={undoSends} testId="assessments-inbox-undo-sending">
                  Undo sending
                </Button>
              </span>
            </div>
          ) : null}
          {waiting.length === 0 ? (
            <WorkEmpty
              icon={Check}
              testId="assessments-inbox-empty"
              title="Nothing waiting"
              body="Doctors ask from their Assessments page. You've answered every request in this made-up list."
              action={
                done.length ? (
                  <Button variant="secondary" size="sm" onClick={() => setTab("done")}>
                    See done
                  </Button>
                ) : undefined
              }
            />
          ) : shown.length === 0 ? (
            <Inset tone="plain" title="None match this filter">
              <TextLink onClick={() => setFilter("all")}>Show all</TextLink>
            </Inset>
          ) : (
            <>
              {/* The sort sits with its label above the lists it orders, so the order and its control read together. */}
              {waiting.length > 1 ? (
                <div
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5"
                  data-testid="assessments-inbox-sort"
                >
                  <span id={sortLabelId} className={cn(labelText, "px-1")}>
                    Sort
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <SegmentedControl
                      ariaLabelledBy={sortLabelId}
                      layout="equal"
                      value={sort}
                      onChange={setSort}
                      options={SORTS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </div>
                </div>
              ) : null}
              {section("Overdue", overdue)}
              {section("Waiting", rest)}
              {section("Later", later)}
            </>
          )}
        </>
      ) : done.length === 0 ? (
        <Inset tone="plain" title="Nothing answered yet">
          What you send or pass on shows here, and the doctor keeps their own copy.
        </Inset>
      ) : (
        <List label="Done">
          {done.map((item) => {
            const answer = extras.answers[item.id];
            const preview = answer ? doctorView(item, answer) : null;
            return (
              <Row
                key={item.id}
                avatar={item.doctor.initials}
                title={rowTitle(item)}
                subtitle={item.doneLine ?? undefined}
                tag={
                  <Pill
                    pill={
                      item.status === "passed"
                        ? { label: "Passed on", tone: "neutral" }
                        : item.id === "sam-eot"
                          ? { label: "Signed", tone: "ok" }
                          : { label: "Sent", tone: "ok" }
                    }
                  />
                }
                {...(preview ? { onClick: () => setSheet({ id: item.id, mode: "doctor" }) } : {})}
              />
            );
          })}
        </List>
      )}
      <SmallPrint>
        Status here. Open a request to see what was asked. Dr Ben Ortiz, Dr Mia Chen, Dr Ravi Kaur and Dr Ella Okafor
        are made-up. Nothing is sent to anyone.
      </SmallPrint>
      <Sheet
        open={open !== null}
        onClose={() => setSheet(null)}
        title={
          open
            ? sheet?.mode === "cant"
              ? "Can't do this one"
              : sheet?.mode === "doctor"
                ? `What ${open.doctor.name} sees`
                : rowTitle(open)
            : "Request"
        }
      >
        {open && sheet?.mode === "feedback" ? (
          <FeedbackSheet
            key={open.id}
            item={open}
            offline={offlineSince !== null}
            draft={draftFor(open)}
            onDraft={(next) => setDrafts((all) => ({ ...all, [open.id]: next }))}
            onSend={(draft) => send(open, draft)}
            onLater={() => moveLater(open)}
            onCant={() => setSheet({ id: open.id, mode: "cant" })}
          />
        ) : null}
        {open && sheet?.mode === "cant" ? (
          <CantSheet
            key={open.id}
            item={open}
            onPass={(reason, suggestion) => pass(open, reason, suggestion)}
            onBack={() => setSheet({ id: open.id, mode: open.open.kind === "status" ? "status" : "feedback" })}
          />
        ) : null}
        {open && sheet?.mode === "status" ? (
          <StatusSheet
            item={open}
            onLater={() => moveLater(open)}
            onCant={() => setSheet({ id: open.id, mode: "cant" })}
          />
        ) : null}
        {open && sheet?.mode === "doctor" && extras.answers[open.id] ? (
          <DoctorSheet
            item={open}
            answer={extras.answers[open.id]!}
            onRestore={() => {
              dispatchExtras({ type: "inbox-restore", id: open.id });
              setSheet(null);
              announce(`${open.doctor.name} is back in your inbox.`);
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function FeedbackSheet({
  item,
  offline,
  draft,
  onDraft,
  onSend,
  onLater,
  onCant,
}: {
  item: InboxRequest;
  offline: boolean;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onSend: (draft: Draft) => void;
  onLater: () => void;
  onCant: () => void;
}) {
  const textId = useId();
  const noteId = useId();
  const whyId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const info = item.epa ? epaInfo(item.epa) : null;
  const problem = feedbackProblem(draft.text);
  const blocker = sendBlocker(draft);
  const first = item.doctor.name.replace(/^Dr /, "").split(" ")[0];
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-feedback">
      <div className="grid gap-1">
        <KeyValue k="Asked" v={item.askedOn} />
        {info ? <KeyValue k="EPA" v={`${item.epa} · ${info.title}`} /> : null}
      </div>
      {info ? <p className={secondaryText}>{info.detail}</p> : null}
      <SegmentedControl
        label={`Supervision ${first} needed`}
        layout="equal"
        value={draft.level ?? ""}
        onChange={(level) => onDraft({ ...draft, level: level as SupervisionLevel })}
        options={SUPERVISION_LEVELS.map((l) => ({ value: l.id, label: l.title.replace(" supervision", "") }))}
      />
      {draft.level ? (
        <p className={cn(secondaryText, "px-1")}>{SUPERVISION_LEVELS.find((l) => l.id === draft.level)!.detail}</p>
      ) : null}
      <div className="grid gap-1.5">
        <label
          htmlFor={textId}
          className="flex justify-between px-1 text-sm font-semibold text-[color:var(--text-heading)]"
        >
          <span>A few lines</span>
          <span className="font-normal text-[color:var(--text-muted)]">Optional</span>
        </label>
        <textarea
          id={textId}
          ref={textRef}
          rows={3}
          maxLength={FEEDBACK_MAX_CHARS}
          value={draft.text}
          aria-invalid={problem ? true : undefined}
          aria-describedby={noteId}
          placeholder="What went well, and one thing to try next time."
          onChange={(event) => onDraft({ ...draft, text: event.target.value })}
          className={cn(fieldControlPlain, "h-auto min-h-24 resize-y py-2 leading-6")}
        />
        <p id={noteId} className="flex justify-between gap-2 px-1 text-xs text-[color:var(--text-muted)]">
          <span>No names, initials, record or bed numbers.</span>
          <span className="nums font-normal">{`${draft.text.length}\u00a0of ${FEEDBACK_MAX_CHARS}`}</span>
        </p>
      </div>
      {problem ? (
        <div
          role="alert"
          data-testid="assessments-inbox-problem"
          className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[color:var(--warning)] bg-[color:var(--surface-raised)] p-3"
        >
          <TriangleAlert
            aria-hidden="true"
            strokeWidth={1.5}
            className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]"
          />
          <span className="grid min-w-0 gap-1">
            <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{problem.title}</span>
            <span className="text-sm leading-5 text-[color:var(--text)]">{problem.body}</span>
            <span className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => textRef.current?.focus()}>
                Edit
              </Button>
              {problem.suggestion !== null ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onDraft({ ...draft, text: problem.suggestion ?? "" });
                    announce("Removed. Check the words still say what you meant.");
                  }}
                >
                  Remove it
                </Button>
              ) : null}
            </span>
          </span>
        </div>
      ) : null}
      <Button
        icon={Send}
        variant="primary"
        block
        disabled={blocker !== null}
        aria-describedby={blocker ? whyId : undefined}
        onClick={() => onSend(draft)}
        testId="assessments-inbox-send"
      >
        {offline ? "Keep to send" : `Send to ${item.doctor.name}`}
      </Button>
      {blocker ? <WhyNot id={whyId}>{blocker}</WhyNot> : null}
      <SmallPrint center>
        {offline
          ? "No connection: it waits here as To send and goes when you are back online, with Undo."
          : "Sends after 10 seconds, with Undo. Made-up: nothing reaches anyone."}
      </SmallPrint>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" icon={Clock} onClick={onLater}>
          Later
        </Button>
        <Button variant="secondary" icon={X} onClick={onCant}>
          Can&apos;t do this one
        </Button>
      </div>
      <SmallPrint center>{`Later brings it back on ${LATER_WHEN}.`}</SmallPrint>
    </div>
  );
}

function CantSheet({
  item,
  onPass,
  onBack,
}: {
  item: InboxRequest;
  onPass: (reason: CantReason, suggestion: string | null) => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState<CantReason>("not_seen");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const name = useId();
  const canSuggest = reason !== "not_this_week";
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-cant">
      <p className={secondaryText}>{rowTitle(item)}</p>
      <fieldset className="grid min-w-0">
        <legend className="px-1 pb-1.5 text-sm font-semibold text-[color:var(--text-heading)]">Why</legend>
        <ul
          role="list"
          className="grid min-w-0 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]"
        >
          {CANT_REASONS.map((r) => (
            <li
              key={r.id}
              className="relative flex min-h-13 items-center gap-3 border-t border-[color:var(--border)] px-3.5 py-2.5 first:border-t-0 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus)]"
            >
              <input
                id={`${name}-${r.id}`}
                type="radio"
                name={name}
                value={r.id}
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
                aria-describedby={`${name}-${r.id}-detail`}
                className="size-4 shrink-0 accent-[color:var(--mode-identity)]"
              />
              <span className="grid min-w-0 gap-0.5">
                <label
                  htmlFor={`${name}-${r.id}`}
                  className={cn(titleText, "cursor-pointer after:absolute after:inset-0")}
                >
                  {r.title}
                </label>
                <span id={`${name}-${r.id}-detail`} className={secondaryText}>
                  {r.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </fieldset>
      {canSuggest ? (
        <div className="grid gap-1.5">
          <span className="flex justify-between px-1 text-sm font-semibold text-[color:var(--text-heading)]">
            <span>Suggest someone</span>
            <span className="font-normal text-[color:var(--text-muted)]">Optional</span>
          </span>
          <div role="group" aria-label="Suggest someone" className="flex flex-wrap gap-1.5">
            {SUGGESTED_COLLEAGUES.map((who) => (
              <ChoiceChip
                key={who}
                pressed={suggestion === who}
                onPressedChange={() => setSuggestion(suggestion === who ? null : who)}
              >
                {who}
              </ChoiceChip>
            ))}
          </div>
        </div>
      ) : null}
      <div
        data-testid="assessments-inbox-cant-preview"
        className="flex min-w-0 items-start gap-2.5 rounded-xl bg-[color:var(--mode-identity-soft)] px-3 py-2.5"
      >
        <UserRound aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--mode-identity)]" />
        <span className="grid min-w-0 gap-0.5 text-sm">
          <b className="font-semibold text-[color:var(--mode-identity)]">{`${item.doctor.name} sees`}</b>
          <span className="text-[color:var(--text)]">{doctorSees(reason, canSuggest ? suggestion : null)}</span>
        </span>
      </div>
      <Button
        variant="primary"
        block
        onClick={() => onPass(reason, canSuggest ? suggestion : null)}
        testId="assessments-inbox-cant-send"
      >
        {reason === "not_this_week" ? "Move to Later" : "Send"}
      </Button>
      <SmallPrint center>With Undo. Made-up: nothing reaches anyone.</SmallPrint>
      <Button variant="ghost" block onClick={onBack}>
        Back to the request
      </Button>
    </div>
  );
}

function StatusSheet({ item, onLater, onCant }: { item: InboxRequest; onLater: () => void; onCant: () => void }) {
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-status">
      <div className="grid gap-1">
        <KeyValue k="Asked" v={item.askedOn} />
        {item.due ? <KeyValue k="Due" v={item.due.replace(/^(Due|By|Overdue since) /, "")} /> : null}
        <KeyValue k="Status" v={item.overdue ? "Overdue" : "Waiting for you"} />
      </div>
      <Inset tone="plain" title="This form isn't built into the sample">
        {`${item.doctor.name} is a made-up example. In use, the ${item.title.toLowerCase()} opens here, the way Sam's end-of-term does.`}
      </Inset>
      {item.status === "waiting" ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={Clock} onClick={onLater}>
            Later
          </Button>
          <Button variant="secondary" icon={X} onClick={onCant}>
            Can&apos;t do this one
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DoctorSheet({ item, answer, onRestore }: { item: InboxRequest; answer: InboxAnswer; onRestore: () => void }) {
  const view = doctorView(item, answer);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  if (!view) return null;
  const passed = answer.status === "passed";
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-doctor">
      <Inset tone="plain" title="A preview">
        {`This is what ${item.doctor.name} sees on their own Assessments page.`}
      </Inset>
      <div className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5">
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full",
              passed
                ? "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
                : "bg-[color:var(--success-bg)] text-[color:var(--success-text)]",
            )}
          >
            {passed ? (
              <Inbox aria-hidden="true" className="size-icon-sm" />
            ) : (
              <Check aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
            )}
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <b className={titleText}>{view.heading}</b>
            <span className={secondaryText}>{view.when}</span>
          </span>
          <Pill pill={passed ? { label: "Passed on", tone: "neutral" } : { label: "Done", tone: "ok" }} />
        </span>
        {view.level ? <KeyValue k="Supervision needed" v={view.level} /> : null}
      </div>
      {view.words ? (
        <>
          <SectionLabel>{passed ? "Your supervisor's note" : "Supervisor's words"}</SectionLabel>
          <p className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 text-sm leading-6 break-words text-[color:var(--text)]">
            {view.words}
          </p>
        </>
      ) : null}
      {passed ? (
        <Button variant="secondary" block onClick={onRestore}>
          Move back to my inbox
        </Button>
      ) : (
        <>
          <Button
            variant="secondary"
            block
            icon={copied === "copied" ? Check : Copy}
            onClick={async () => {
              try {
                await copyTextToClipboard(claCopyText(item, answer));
                setCopied("copied");
                announce("Copied for Clinical Learning Australia");
              } catch {
                setCopied("failed");
                announce("Copy did not work on this browser.");
              }
            }}
            testId="assessments-inbox-copy-cla"
          >
            {copied === "copied" ? "Copied" : "Copy for Clinical Learning Australia"}
          </Button>
          {copied === "failed" ? (
            <p role="status" className="px-1 text-center text-sm text-[color:var(--warning-text)]">
              Copy did not work on this browser. Select the words above instead.
            </p>
          ) : (
            <SmallPrint center>
              The doctor pastes it into their official record. No import format is claimed.
            </SmallPrint>
          )}
        </>
      )}
    </div>
  );
}
