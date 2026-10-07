"use client";

import { Inbox, Send, TriangleAlert } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { useAssessmentsExtras } from "@/components/teaching/assessments/assessments-extras";
import {
  Inset,
  KeyValue,
  List,
  Pill,
  Row,
  ScreenHeader,
  SectionLabel,
  SectionNote,
  SmallPrint,
  TextLink,
  WhyNot,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { UNDO_MS } from "@/components/teaching/use-delayed-post";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import { SUPERVISION_LEVELS, epa as epaInfo, type SupervisionLevel } from "@/lib/teaching/assessments/content";
import {
  CANT_REASONS,
  EMPTY_ANSWER,
  FEEDBACK_MAX_CHARS,
  INBOX_FILTERS,
  ageText,
  feedbackProblem,
  filterCounts,
  inboxRequests,
  isWaiting,
  matchesFilter,
  sendBlocker,
  sortInbox,
  type CantReason,
  type InboxFilter,
  type InboxRequest,
  type InboxSort,
} from "@/lib/teaching/assessments/inbox";

/*
 * The consultant inbox (feature 16): every request waiting for the supervisor, oldest first, each opened in
 * one tap. Made-up doctors in page memory; nothing is sent. Sam's requests open the sample's own screens;
 * the others take a supervision level and a few lines, checked for patient details before they can go.
 */

const asSup = { as: "supervisor" };
const SORTS: readonly { value: InboxSort; label: string }[] = [
  { value: "oldest", label: "Oldest first" },
  { value: "due", label: "Due date" },
  { value: "doctor", label: "Doctor" },
];

type Draft = { level: SupervisionLevel | null; text: string };
type SheetMode = { id: string; mode: "feedback" | "cant" | "status" } | null;

function tagFor(item: InboxRequest) {
  if (item.overdue) return <Pill pill={{ label: "Overdue", tone: "warm" }} />;
  if (item.status === "later") return <Pill pill={{ label: "Later", tone: "neutral" }} />;
  if (item.age <= 1) return <Pill pill={{ label: "New", tone: "accent" }} />;
  return <Pill pill={{ label: ageText(item.age), tone: "neutral" }} />;
}

function doneTag(item: InboxRequest) {
  if (item.status === "passed") return <Pill pill={{ label: "Passed on", tone: "neutral" }} />;
  if (item.id === "sam-eot") return <Pill pill={{ label: "Signed", tone: "ok" }} />;
  return <Pill pill={{ label: "Sent", tone: "ok" }} />;
}

function subtitleFor(item: InboxRequest): string {
  const asked = `asked ${item.askedOn}`;
  return [item.doctor.grade, asked, item.due].filter(Boolean).join(" · ");
}

export function AssessmentsInbox({ s, openSheet, go }: ScreenProps) {
  const { extras, dispatchExtras } = useAssessmentsExtras();
  const toast = useToast();
  const [tab, setTab] = useState<"waiting" | "done">("waiting");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [sort, setSort] = useState<InboxSort>("oldest");
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const sortId = useId();

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
    if (!draft.level) return;
    dispatchExtras({ type: "inbox-send", id: item.id, level: draft.level, text: draft.text.trim() });
    setSheet(null);
    toast.push({
      tone: "info",
      title: `Sending to ${item.doctor.name} in 10 s`,
      body: "Made-up: nothing reaches anyone.",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onAction: () => {
          dispatchExtras({ type: "inbox-undo", id: item.id });
          announce("Not sent. Your answer is kept for when you reopen it.");
        },
      },
      onClose: (reason) => {
        if (reason !== "action") dispatchExtras({ type: "inbox-commit", id: item.id });
      },
    });
  }

  function cant(item: InboxRequest, reason: CantReason) {
    dispatchExtras({ type: "inbox-cant", id: item.id, reason });
    setSheet(null);
    const title =
      reason === "not_this_week"
        ? "Moved to Later"
        : reason === "other_consultant"
          ? `${item.doctor.name} is told to ask another consultant`
          : `${item.doctor.name} is told you did not see this work`;
    toast.push({
      tone: "info",
      title,
      body: "Made-up: nothing reaches anyone.",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onAction: () => {
          dispatchExtras({ type: "inbox-restore", id: item.id });
          announce("Back in your inbox.");
        },
      },
    });
  }

  const row = (item: InboxRequest) => (
    <Row
      key={item.id}
      avatar={item.doctor.initials}
      title={`${item.doctor.name} · ${item.kind === "epa" ? `EPA ${item.epa}` : item.title}`}
      subtitle={item.kind === "epa" ? `${epaInfo(item.epa!).title} · ${subtitleFor(item)}` : subtitleFor(item)}
      tag={tagFor(item)}
      onClick={() => openItem(item)}
    />
  );

  return (
    <div className="grid gap-3" data-testid="assessments-inbox">
      <ScreenHeader
        back={viewHref("home", asSup)}
        backLabel="your requests"
        title="Inbox"
        subtitle="Made-up requests to you"
      />
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {INBOX_FILTERS.map((f) => (
                <ChoiceChip key={f.id} pressed={filter === f.id} onPressedChange={() => setFilter(f.id)}>
                  {`${f.label} · ${counts[f.id]}`}
                </ChoiceChip>
              ))}
            </div>
            <label htmlFor={sortId} className="flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
              Sort
              <select
                id={sortId}
                value={sort}
                onChange={(event) => setSort(event.target.value as InboxSort)}
                className={cn(fieldControlPlain, "w-auto pr-8")}
              >
                {SORTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {sending.length ? (
            <p role="status" className={cn(secondaryText, "px-1")}>
              {`Sending ${sending.length === 1 ? "1 answer" : `${sending.length} answers`}. Undo is on the message at the bottom.`}
            </p>
          ) : null}
          {waiting.length === 0 ? (
            <div data-testid="assessments-inbox-empty">
              <Inset tone="ok" icon={Inbox} title="Nothing waiting">
                You&apos;ve answered every request in this made-up list. Done shows what went.
              </Inset>
            </div>
          ) : shown.length === 0 ? (
            <Inset tone="plain" title="None match this filter">
              <TextLink onClick={() => setFilter("all")}>Show all</TextLink>
            </Inset>
          ) : (
            <>
              {overdue.length ? (
                <>
                  <SectionLabel>{`Overdue · ${overdue.length}`}</SectionLabel>
                  <List>{overdue.map(row)}</List>
                </>
              ) : null}
              {rest.length ? (
                <>
                  <SectionLabel end={<SectionNote>{SORTS.find((o) => o.value === sort)!.label}</SectionNote>}>
                    {`Waiting · ${rest.length}`}
                  </SectionLabel>
                  <List>{rest.map(row)}</List>
                </>
              ) : null}
              {later.length ? (
                <>
                  <SectionLabel>{`Later · ${later.length}`}</SectionLabel>
                  <List>{later.map(row)}</List>
                </>
              ) : null}
            </>
          )}
        </>
      ) : done.length === 0 ? (
        <Inset tone="plain" title="Nothing answered yet">
          What you send or pass on shows here.
        </Inset>
      ) : (
        <List label="Done">
          {done.map((item) => (
            <Row
              key={item.id}
              avatar={item.doctor.initials}
              title={`${item.doctor.name} · ${item.kind === "epa" ? `EPA ${item.epa}` : item.title}`}
              subtitle={item.doneLine ?? undefined}
              tag={doneTag(item)}
              end={
                item.status === "passed" ? (
                  <TextLink
                    onClick={() => {
                      dispatchExtras({ type: "inbox-restore", id: item.id });
                      announce(`${item.doctor.name} is back in your inbox.`);
                    }}
                  >
                    Move back
                  </TextLink>
                ) : undefined
              }
            />
          ))}
        </List>
      )}
      <SmallPrint>
        Status here. Open a request to see what was asked. Dr Ben Ortiz, Dr Mia Chen, Dr Ravi Kaur and Dr Ella Okafor
        are made-up; nothing is sent to anyone.
      </SmallPrint>
      <Sheet
        open={open !== null}
        onClose={() => setSheet(null)}
        title={
          open
            ? sheet?.mode === "cant"
              ? "Can't do this one"
              : `${open.doctor.name} · ${open.kind === "epa" ? `EPA ${open.epa}` : open.title}`
            : "Request"
        }
      >
        {open && sheet?.mode === "feedback" ? (
          <FeedbackSheet
            key={open.id}
            item={open}
            draft={draftFor(open)}
            onDraft={(next) => setDrafts((all) => ({ ...all, [open.id]: next }))}
            onSend={(draft) => send(open, draft)}
            onCant={() => setSheet({ id: open.id, mode: "cant" })}
          />
        ) : null}
        {open && sheet?.mode === "cant" ? (
          <CantSheet
            onPick={(reason) => cant(open, reason)}
            onBack={() => setSheet({ id: open.id, mode: "feedback" })}
          />
        ) : null}
        {open && sheet?.mode === "status" ? <StatusSheet item={open} /> : null}
      </Sheet>
    </div>
  );
}

function FeedbackSheet({
  item,
  draft,
  onDraft,
  onSend,
  onCant,
}: {
  item: InboxRequest;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onSend: (draft: Draft) => void;
  onCant: () => void;
}) {
  const textId = useId();
  const noteId = useId();
  const whyId = useId();
  const info = item.epa ? epaInfo(item.epa) : null;
  const problem = feedbackProblem(draft.text);
  const blocker = sendBlocker(draft);
  const first = item.doctor.name.replace(/^Dr /, "").split(" ")[0];
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-feedback">
      <div className="grid gap-1">
        <KeyValue k="Asked" v={item.askedOn} />
        {info ? <KeyValue k="EPA" v={info.title} /> : null}
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
          <span className="nums font-normal">{`${draft.text.length} of ${FEEDBACK_MAX_CHARS}`}</span>
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
            {problem.suggestion !== null ? (
              <span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDraft({ ...draft, text: problem.suggestion ?? "" })}
                >
                  Remove it
                </Button>
              </span>
            ) : null}
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
        Send
      </Button>
      {blocker ? <WhyNot id={whyId}>{blocker}</WhyNot> : null}
      <SmallPrint center>Sends after 10&nbsp;seconds, with Undo. Made-up: nothing reaches anyone.</SmallPrint>
      <Button variant="ghost" block onClick={onCant}>
        Can&apos;t do this one
      </Button>
    </div>
  );
}

function CantSheet({ onPick, onBack }: { onPick: (reason: CantReason) => void; onBack: () => void }) {
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-cant">
      <List label="Reasons">
        {CANT_REASONS.map((r) => (
          <Row key={r.id} title={r.title} subtitle={r.detail} onClick={() => onPick(r.id)} />
        ))}
      </List>
      <SmallPrint>Each one comes with Undo. Made-up: nothing reaches anyone.</SmallPrint>
      <Button variant="secondary" block onClick={onBack}>
        Back to the request
      </Button>
    </div>
  );
}

function StatusSheet({ item }: { item: InboxRequest }) {
  return (
    <div className="grid gap-3" data-testid="assessments-inbox-status">
      <div className="grid gap-1">
        <KeyValue k="Asked" v={item.askedOn} />
        {item.due ? <KeyValue k="Due" v={item.due.replace(/^(Due|By) /, "")} /> : null}
        <KeyValue k="Status" v={item.overdue ? "Overdue" : "Waiting for you"} />
      </div>
      <Inset tone="plain" title="This form isn't built into the sample">
        {`${item.doctor.name} is a made-up example. In use, the ${item.title.toLowerCase()} opens here, the way Sam's end-of-term does.`}
      </Inset>
    </div>
  );
}
