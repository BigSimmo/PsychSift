"use client";

import { CalendarClock, ClipboardList, Copy, Inbox, Mail, Plus, Send, Share2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AdminStatusWord } from "@/components/admin/admin-status-word";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDock,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
  type WorkTone,
} from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldLabel } from "@/components/ui-primitives";
import {
  anyPatientProblem,
  EXAMPLE_NOT_SENT,
  RECIPIENT_CHECK,
  recipientProblem,
  PaperworkDemoNotice,
  PaperworkField,
  PaperworkFootNote,
  PaperworkOfflineNote,
  PaperworkSampleNotice,
  PaperworkStorageNote,
  PaperworkUnsavedNote,
  usePaperworkHeading,
  usePaperworkPage,
  usePaperworkSay,
  useSingleFlight,
} from "@/components/work-screens/admin/paperwork-shared";
import { buildComplianceOverview } from "@/lib/admin/compliance-overview";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { guardExampleAction, isExampleRecord, type ExampleBlockedAction } from "@/lib/example-data/guards";
import { firstAdminPatientProblem } from "@/lib/work-screens/admin/patient-check";
import {
  dropRecord,
  newPaperworkId,
  putBack,
  REQUEST_KINDS,
  type AdminPaperwork,
  type AdminRequest,
  type RequestKind,
  type RequestOutcome,
} from "@/lib/work-screens/admin/paperwork-model";
import {
  buildRequestMessage,
  chaseMessage,
  cleanRequest,
  editedRequest,
  hasRequestErrors,
  isStaffHealth,
  markSeen,
  markSent,
  MORE_TIME_REASONS,
  moreTimeSuggestions,
  needsChase,
  newRequest,
  recipientForReason,
  recordAnswer,
  reopen,
  REQUEST_KIND_WORDS,
  requestMailtoHref,
  requestStatusWord,
  requestSteps,
  sortRequests,
  validateRequestDraft,
  type MoreTimeReason,
  type RequestDraftInput,
} from "@/lib/work-screens/admin/requests";

const STATUS_TONE: Record<string, WorkTone> = {
  Draft: "neutral",
  Sent: "mode",
  Seen: "mode",
  Agreed: "green",
  Declined: "neutral",
  Answered: "neutral",
};

type Draft = RequestDraftInput & { readonly email: string };

function blankDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    kind: "more-time",
    title: "",
    to: "Medical Workforce",
    dueOn: "",
    askedFor: "",
    reason: null,
    note: "",
    email: "",
    ...overrides,
  };
}

/**
 * Admin · Requests (`/admin/requests`, mockup `admin_requests`, `admin_ask`,
 * `admin_asked`): asks the doctor sends and tracks. They send each one
 * themselves. PsychSift writes the message and keeps the status.
 */
/** The doctor's own words in a request, checked again just before it leaves the page. */
function requestProblem(request: AdminRequest) {
  return firstAdminPatientProblem([request.title, request.note, request.outcomeNote], { allowCapitals: true });
}

const PATIENT_NOT_SENT = "This request may hold a patient detail, so nothing was copied or sent. Edit it first.";

export function AdminRequestsPage({ now: pinned }: { now?: Date } = {}) {
  usePaperworkHeading("Requests", "You send them, PsychSift keeps track");
  const page = usePaperworkPage("admin.requests");
  const { store, online } = page;
  const say = usePaperworkSay();
  const now = useMemo(() => pinned ?? new Date(), [pinned]);
  const today = perthDateOf(now);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [draft, setDraft] = useState<{ value: Draft; editing: string | null } | null>(null);
  const [answering, setAnswering] = useState<AdminRequest | null>(null);
  const [failed, setFailed] = useState(false);
  const once = useSingleFlight();

  const record = store.state;
  const requests = useMemo(() => record?.requests ?? [], [record]);
  const { open, done } = useMemo(() => sortRequests(requests), [requests]);
  const signedOut = page.signedOut;
  const overview = useMemo(
    () => buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, signedOut ? [] : page.own, now, null),
    [signedOut, page.own, now],
  );
  const suggestions = page.entriesState === "ready" && !signedOut ? moreTimeSuggestions(overview, requests, today) : [];
  const chaseCount = open.filter((request) => needsChase(request, today)).length;

  function change(next: (current: AdminPaperwork) => AdminPaperwork): boolean {
    const ok = store.update(next);
    setFailed(!ok);
    return ok;
  }
  function replace(updated: AdminRequest) {
    return change((current) => ({
      ...current,
      requests: current.requests.map((request) => (request.id === updated.id ? cleanRequest(updated) : request)),
    }));
  }
  function withUndo(before: AdminRequest, after: AdminRequest, message: string) {
    if (!replace(after)) return;
    say(message, () => replace(before));
  }

  /**
   * True when an example request was stopped by the example data switch, whose banner then explains.
   * Otherwise (the demo build) `blockedReason` says why on the page.
   */
  function exampleBlocked(request: AdminRequest, kind: ExampleBlockedAction): boolean {
    return isExampleRecord(request) && !guardExampleAction(page.examplesShown, kind);
  }
  /** Null when the request may leave the page, else what was said instead. */
  function blockedReason(request: AdminRequest): string | null {
    if (isExampleRecord(request)) return EXAMPLE_NOT_SENT;
    if (requestProblem(request)) return PATIENT_NOT_SENT;
    return null;
  }
  function sendByCopy(request: AdminRequest) {
    return once(async () => {
      if (exampleBlocked(request, "copy")) return;
      const blocked = blockedReason(request);
      if (blocked) return say(blocked, undefined, "warning");
      try {
        await copyTextToClipboard(request.message);
        if (request.status === "draft")
          withUndo(request, markSent(request, today), `Copied. Paste it to ${request.to}. Marked as sent`);
        else say(`Copied. Paste it to ${request.to}`);
      } catch {
        say("Could not copy. Your browser blocked the clipboard. Use Email draft instead.", undefined, "warning");
      }
    });
  }
  /** Returns false when the email draft must not open. */
  function sendByEmail(request: AdminRequest): boolean {
    if (exampleBlocked(request, "send")) return false;
    const blocked = blockedReason(request);
    if (blocked) {
      say(blocked, undefined, "warning");
      return false;
    }
    withUndo(request, markSent(request, today), `Email draft opened. Marked as sent to ${request.to}`);
    return true;
  }
  function chase(request: AdminRequest) {
    return once(async () => {
      if (exampleBlocked(request, "copy")) return;
      const blocked = blockedReason(request);
      if (blocked) return say(blocked, undefined, "warning");
      try {
        await copyTextToClipboard(chaseMessage(request));
        withUndo(
          request,
          { ...request, followUpOn: addDaysToDate(today, 7) },
          "Follow-up copied. Next chase in a week",
        );
      } catch {
        say("Could not copy. Your browser blocked the clipboard.", undefined, "warning");
      }
    });
  }
  function remove(request: AdminRequest) {
    const index = requests.findIndex((item) => item.id === request.id);
    if (!change((current) => ({ ...current, requests: dropRecord(current.requests, request.id) }))) return;
    // Undo puts this one request back, and leaves any change made since alone.
    say("Request removed", () =>
      change((current) => ({ ...current, requests: putBack(current.requests, request, index) })),
    );
  }

  function saveDraft(value: Draft, editing: string | null, sendAfter: "copy" | "email" | null) {
    const id = editing ?? newPaperworkId("req");
    const base = newRequest(value, id, today, value.email.trim() || undefined);
    const existing = editing ? requests.find((request) => request.id === editing) : undefined;
    const saved = cleanRequest(existing ? editedRequest(existing, base) : base);
    const ok = change((current) => ({
      ...current,
      requests: existing
        ? current.requests.map((request) => (request.id === id ? saved : request))
        : [saved, ...current.requests],
    }));
    if (!ok) return;
    setDraft(null);
    setTab("open");
    if (sendAfter === "copy") void sendByCopy(saved);
    else if (sendAfter === "email") sendByEmail(saved);
    else
      say(
        existing ? "Request saved" : "Saved as a draft. Send it when you are ready",
        existing ? undefined : () => remove(saved),
      );
  }

  const list = tab === "open" ? open : done;

  return (
    <WorkBody testId="admin-requests">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Requests
      </PageTitleUnderBand>
      {signedOut ? (
        <PaperworkSampleNotice what="requests" testId="admin-requests-signed-out" examples={page.examplesShown} />
      ) : null}
      {page.demo ? <PaperworkDemoNotice testId="admin-requests-demo" /> : null}
      {!online ? (
        <PaperworkOfflineNote testId="admin-requests-offline">
          You are offline. Requests are kept on this phone and still work. An email draft waits in your mail app until
          you have signal.
        </PaperworkOfflineNote>
      ) : null}
      {failed ? <PaperworkUnsavedNote testId="admin-requests-unsaved" /> : null}
      <PaperworkStorageNote store={store} testId="admin-requests-storage" />

      {record === null ? (
        <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-requests-loading" />
      ) : (
        <>
          <WorkChips label="Show">
            <WorkChip
              selected={tab === "open"}
              onClick={() => setTab("open")}
              count={open.length}
              testId="admin-requests-tab-open"
            >
              Open
            </WorkChip>
            <WorkChip
              selected={tab === "done"}
              onClick={() => setTab("done")}
              count={done.length}
              testId="admin-requests-tab-done"
            >
              Done
            </WorkChip>
          </WorkChips>

          {tab === "open" && chaseCount > 0 ? (
            <p role="status" className="text-sm text-[color:var(--text)]" data-testid="admin-requests-chase-line">
              {chaseCount === 1
                ? "1 request has had no reply for a week."
                : `${chaseCount} requests have had no reply for a week.`}
            </p>
          ) : null}

          <WorkSectionLabel count={list.length ? (tab === "open" ? "Soonest first" : "Newest first") : undefined}>
            {tab === "open" ? "Your asks" : "Answered"}
          </WorkSectionLabel>
          {list.length === 0 ? (
            <WorkCard>
              <WorkEmpty
                icon={Inbox}
                title={tab === "open" ? "No open requests" : "Nothing answered yet"}
                body={
                  tab === "open"
                    ? "Ask for more time, send a document or ask a question. You send it, and it is tracked here."
                    : "When you record an answer, the request moves here."
                }
                action={
                  tab === "open" ? (
                    <WorkButton
                      icon={Plus}
                      onClick={() => setDraft({ value: blankDraft(), editing: null })}
                      testId="admin-requests-empty-new"
                    >
                      New request
                    </WorkButton>
                  ) : undefined
                }
                testId={`admin-requests-empty-${tab}`}
              />
            </WorkCard>
          ) : (
            <ul className="grid gap-2" data-testid={`admin-requests-list-${tab}`}>
              {list.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  today={today}
                  onCopy={() => void sendByCopy(request)}
                  onEmail={() => sendByEmail(request)}
                  onSeen={() => withUndo(request, markSeen(request, today), "Marked as seen")}
                  onAnswer={() => setAnswering(request)}
                  onChase={() => void chase(request)}
                  onReopen={() => withUndo(request, reopen(request), "Reopened")}
                  onEdit={() =>
                    setDraft({
                      value: blankDraft({
                        kind: request.kind,
                        title: request.title,
                        to: request.to,
                        dueOn: request.dueOn ?? "",
                        askedFor: request.askedFor ?? "",
                        reason: request.reason ?? null,
                        note: request.note ?? "",
                        email: request.toEmail ?? "",
                      }),
                      editing: request.id,
                    })
                  }
                  onRemove={() => remove(request)}
                />
              ))}
            </ul>
          )}

          {tab === "open" && suggestions.length > 0 ? (
            <>
              <WorkSectionLabel count="From Compliance">You may need more time</WorkSectionLabel>
              <WorkCard testId="admin-requests-suggestions">
                {suggestions.map((suggestion) => (
                  <WorkIconRow
                    key={suggestion.key}
                    icon={CalendarClock}
                    tone="neutral"
                    title={suggestion.title}
                    sub={
                      <>
                        <AdminStatusWord bucket={suggestion.bucket} className="text-xs" />
                        {` · ${formatRecordedDate(suggestion.dueOn)}`}
                      </>
                    }
                    end={<span className="text-sm font-semibold text-[color:var(--mode-identity)]">Ask</span>}
                    onClick={() =>
                      setDraft({
                        value: blankDraft({
                          kind: "more-time",
                          title: suggestion.title,
                          dueOn: suggestion.dueOn,
                          askedFor: addDaysToDate(suggestion.dueOn < today ? today : suggestion.dueOn, 14),
                        }),
                        editing: null,
                      })
                    }
                    testId={`admin-requests-suggest-${suggestion.key}`}
                  />
                ))}
              </WorkCard>
            </>
          ) : null}
        </>
      )}

      <WorkSectionLabel>Related</WorkSectionLabel>
      <WorkCard>
        <WorkIconRow
          icon={ClipboardList}
          title="Compliance"
          sub="Every requirement and its date"
          href={ADMIN_PAGE_HREFS.compliance}
        />
        <WorkIconRow
          icon={Share2}
          title="Sharing"
          sub="What you would share, and the pack"
          href={ADMIN_WORK_SCREEN_HREFS.sharing}
        />
      </WorkCard>

      <PaperworkFootNote testId="admin-requests-footnote">
        Kept on this phone. PsychSift sends nothing. Health reasons go to Staff Health only, as a word, never the
        detail.
      </PaperworkFootNote>

      {record !== null ? (
        <WorkDock aria-label="Requests actions">
          <WorkButton
            icon={Plus}
            onClick={() => setDraft({ value: blankDraft(), editing: null })}
            testId="admin-requests-new"
          >
            New request
          </WorkButton>
        </WorkDock>
      ) : null}

      {draft ? (
        <RequestSheet
          initial={draft.value}
          editing={draft.editing !== null}
          onClose={() => setDraft(null)}
          onSave={(value, sendAfter) => saveDraft(value, draft.editing, sendAfter)}
        />
      ) : null}
      {answering ? (
        <AnswerSheet
          request={answering}
          onClose={() => setAnswering(null)}
          onSave={(outcome, note) => {
            withUndo(
              answering,
              recordAnswer(answering, outcome, note, today),
              `Answer recorded: ${outcome === "agreed" ? "agreed" : outcome === "declined" ? "declined" : "answered"}`,
            );
            setAnswering(null);
          }}
        />
      ) : null}
    </WorkBody>
  );
}

function RequestCard({
  request,
  today,
  onCopy,
  onEmail,
  onSeen,
  onAnswer,
  onChase,
  onReopen,
  onEdit,
  onRemove,
}: {
  readonly request: AdminRequest;
  readonly today: string;
  readonly onCopy: () => void;
  readonly onEmail: () => boolean;
  readonly onSeen: () => void;
  readonly onAnswer: () => void;
  readonly onChase: () => void;
  readonly onReopen: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const word = requestStatusWord(request);
  const chase = needsChase(request, today);
  const from =
    request.status === "draft"
      ? `To ${request.to} · draft, not sent`
      : `To ${request.to} · ${request.sentOn ? `sent ${formatRecordedDate(request.sentOn)}` : "sent"}`;
  return (
    <li className="work-card work-card--pad grid gap-2" data-testid="admin-requests-card">
      <p className="text-xs font-semibold text-[color:var(--text-muted)]">{from}</p>
      <p className="text-base-minus font-semibold text-[color:var(--text-heading)] [overflow-wrap:anywhere]">
        {request.title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <WorkTag tone={STATUS_TONE[word] ?? "neutral"}>{word}</WorkTag>
        <WorkTag tone="neutral">{REQUEST_KIND_WORDS[request.kind]}</WorkTag>
        {request.dueOn ? (
          <WorkTag tone="neutral">{`${request.dueOn < today ? "Was due" : "Due"} ${formatRecordedDate(request.dueOn)}`}</WorkTag>
        ) : null}
        {request.askedFor ? (
          <WorkTag tone="neutral">{`Asked to ${formatRecordedDate(request.askedFor)}`}</WorkTag>
        ) : null}
        {chase ? <WorkTag tone="mode">Chase</WorkTag> : null}
      </div>
      {request.status !== "draft" ? (
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="Progress">
          {requestSteps(request).map((step) => (
            <li
              key={step.label}
              className={cn(
                "flex items-center gap-1.5",
                step.done ? "font-semibold text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-2 rounded-full",
                  step.done ? "bg-[color:var(--mode-identity)]" : "border border-[color:var(--border-strong)]",
                )}
              />
              {step.label}
              <span className="sr-only">{step.done ? ", done" : ", not yet"}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {request.outcomeNote ? <p className="text-sm text-[color:var(--text)]">{request.outcomeNote}</p> : null}
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        {request.status === "draft" ? (
          <>
            <WorkButton variant="primary" icon={Copy} onClick={onCopy} testId="admin-requests-copy">
              Copy and mark sent
            </WorkButton>
            {isExampleRecord(request) ? (
              <WorkButton variant="secondary" icon={Mail} onClick={() => void onEmail()} testId="admin-requests-email">
                Email draft
              </WorkButton>
            ) : (
              <a
                href={requestMailtoHref(request)}
                onClick={(event) => {
                  if (!onEmail()) event.preventDefault();
                }}
                className="work-button"
                data-variant="secondary"
                data-testid="admin-requests-email"
              >
                <Mail aria-hidden="true" strokeWidth={2} />
                Email draft
              </a>
            )}
            <WorkButton variant="secondary" onClick={onEdit} testId="admin-requests-edit">
              Edit
            </WorkButton>
          </>
        ) : request.status === "decided" ? (
          <>
            {request.kind === "more-time" && request.outcome === "agreed" ? (
              <WorkButton
                variant="secondary"
                icon={CalendarClock}
                href={ADMIN_PAGE_HREFS.renewals}
                testId="admin-requests-update-renewals"
              >
                Update the date
              </WorkButton>
            ) : null}
            <WorkButton variant="secondary" onClick={onReopen} testId="admin-requests-reopen">
              Reopen
            </WorkButton>
          </>
        ) : (
          <>
            <WorkButton variant={chase ? "secondary" : "primary"} onClick={onAnswer} testId="admin-requests-answer">
              Record the answer
            </WorkButton>
            {request.status === "sent" ? (
              <WorkButton variant="secondary" onClick={onSeen} testId="admin-requests-seen">
                They have seen it
              </WorkButton>
            ) : null}
            {chase ? (
              <WorkButton variant="primary" icon={Send} onClick={onChase} testId="admin-requests-chase">
                Copy a follow-up
              </WorkButton>
            ) : null}
            <WorkButton variant="secondary" icon={Copy} onClick={onCopy} testId="admin-requests-copy-again">
              Copy again
            </WorkButton>
          </>
        )}
        <WorkButton
          variant="quiet"
          icon={Trash2}
          onClick={onRemove}
          testId="admin-requests-remove"
          aria-label={`Remove ${request.title}`}
        >
          Remove
        </WorkButton>
      </div>
    </li>
  );
}

function RequestSheet({
  initial,
  editing,
  onClose,
  onSave,
}: {
  readonly initial: Draft;
  readonly editing: boolean;
  readonly onClose: () => void;
  readonly onSave: (value: Draft, sendAfter: "copy" | "email" | null) => void;
}) {
  const [value, setValue] = useState<Draft>(initial);
  const [tried, setTried] = useState(false);
  const errors = validateRequestDraft(value);
  const healthReason = value.kind === "more-time" && value.reason === "Health reason";
  const blocked = hasRequestErrors(errors) || anyPatientProblem(value.title, value.note) || recipientProblem(value.to);
  const preview = buildRequestMessage(value);
  const set = <K extends keyof Draft>(key: K, next: Draft[K]) => setValue((current) => ({ ...current, [key]: next }));

  function attempt(sendAfter: "copy" | "email" | null) {
    setTried(true);
    if (!blocked) onSave(value, sendAfter);
  }
  const quickDates = value.dueOn ? [7, 14, 28].map((days) => addDaysToDate(value.dueOn, days)) : [];

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? "Edit request" : "New request"}
      description="You send it yourself. PsychSift keeps track."
      testId="admin-requests-sheet"
      footer={
        <div className="grid gap-2">
          <WorkButton size="wide" icon={Copy} onClick={() => attempt("copy")} testId="admin-requests-sheet-copy">
            Copy and mark sent
          </WorkButton>
          <WorkButton size="wide" variant="secondary" onClick={() => attempt(null)} testId="admin-requests-sheet-save">
            {editing ? "Save" : "Save as a draft"}
          </WorkButton>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <p className={fieldLabel}>What kind</p>
          <WorkChips label="What kind">
            {REQUEST_KINDS.map((kind) => (
              <WorkChip
                key={kind}
                selected={value.kind === kind}
                onClick={() => set("kind", kind as RequestKind)}
                testId={`admin-requests-kind-${kind}`}
              >
                {REQUEST_KIND_WORDS[kind]}
              </WorkChip>
            ))}
          </WorkChips>
        </div>
        <PaperworkField
          label={value.kind === "more-time" ? "More time for" : value.kind === "document" ? "Which document" : "About"}
          value={value.title}
          onChange={(next) => set("title", next)}
          maxLength={120}
          error={tried ? errors.title : null}
          checkPatient
          testId="admin-requests-title"
        />
        <PaperworkField
          label="To"
          value={value.to}
          onChange={(next) => set("to", next)}
          maxLength={60}
          error={tried || healthReason ? errors.to : null}
          checkPatient={RECIPIENT_CHECK}
          testId="admin-requests-to"
        />
        <PaperworkField
          label="Their email · optional"
          type="email"
          inputMode="email"
          value={value.email}
          onChange={(next) => set("email", next)}
          maxLength={120}
          hint={healthReason ? "A Staff Health address only." : "For the email draft. Kept on this phone."}
          error={tried ? errors.email : null}
          testId="admin-requests-email-address"
        />
        <PaperworkField
          label={value.kind === "more-time" ? "Due on" : "Due or needed by · optional"}
          type="date"
          value={value.dueOn}
          onChange={(next) => set("dueOn", next)}
          error={tried ? errors.dueOn : null}
          testId="admin-requests-due"
        />
        {value.kind === "more-time" ? (
          <>
            {quickDates.length ? (
              <WorkChips label="New date">
                {quickDates.map((date) => (
                  <WorkChip key={date} selected={value.askedFor === date} onClick={() => set("askedFor", date)}>
                    {formatRecordedDate(date)}
                  </WorkChip>
                ))}
              </WorkChips>
            ) : null}
            <PaperworkField
              label="New date"
              type="date"
              value={value.askedFor}
              onChange={(next) => set("askedFor", next)}
              error={tried ? errors.askedFor : null}
              testId="admin-requests-asked-for"
            />
            <div className="grid gap-1.5">
              <p className={fieldLabel}>Reason</p>
              <WorkChips label="Reason">
                {MORE_TIME_REASONS.map((reason) => (
                  <WorkChip
                    key={reason}
                    selected={value.reason === reason}
                    onClick={() =>
                      setValue((current) => {
                        const next = current.reason === reason ? null : (reason as MoreTimeReason);
                        const toHealth = next === "Health reason" && !isStaffHealth(current.to);
                        return {
                          ...current,
                          reason: next,
                          to: recipientForReason(next, isStaffHealth(current.to) ? "Medical Workforce" : current.to),
                          // An address typed for someone else must not carry a health reason.
                          email: toHealth ? "" : current.email,
                        };
                      })
                    }
                    testId={`admin-requests-reason-${reason.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {reason}
                  </WorkChip>
                ))}
              </WorkChips>
              {value.reason === "Health reason" ? (
                <p className="text-xs text-[color:var(--text-muted)]" data-testid="admin-requests-health-line">
                  Sent to Staff Health only. The message says the word, never the detail.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        <PaperworkField
          label="Note · optional"
          value={value.note}
          onChange={(next) => set("note", next)}
          maxLength={400}
          multiline
          checkPatient
          hint="No patient details."
          testId="admin-requests-note"
        />
        <div className="grid gap-1.5">
          <p className={fieldLabel}>What they will see</p>
          <pre
            className="whitespace-pre-wrap break-words rounded-[var(--work-radius-field)] border border-[color:var(--work-line)] bg-[color:var(--work-surface)] p-3 font-sans text-sm leading-6"
            data-testid="admin-requests-preview"
          >
            {`To ${value.to.trim() || "…"}\n${preview}`}
          </pre>
        </div>
      </div>
    </Sheet>
  );
}

function AnswerSheet({
  request,
  onClose,
  onSave,
}: {
  readonly request: AdminRequest;
  readonly onClose: () => void;
  readonly onSave: (outcome: RequestOutcome, note: string) => void;
}) {
  const [outcome, setOutcome] = useState<RequestOutcome>("agreed");
  const [note, setNote] = useState("");
  const blocked = anyPatientProblem(note);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Record the answer"
      description={request.title}
      testId="admin-requests-answer-sheet"
      footer={
        <WorkButton
          size="wide"
          disabled={blocked}
          onClick={() => onSave(outcome, note)}
          testId="admin-requests-answer-save"
        >
          Save the answer
        </WorkButton>
      }
    >
      <div className="grid gap-4">
        <WorkChips label="Answer">
          {(["agreed", "declined", "other"] as const).map((option) => (
            <WorkChip
              key={option}
              selected={outcome === option}
              onClick={() => setOutcome(option)}
              testId={`admin-requests-outcome-${option}`}
            >
              {option === "agreed" ? "Agreed" : option === "declined" ? "Declined" : "Something else"}
            </WorkChip>
          ))}
        </WorkChips>
        <PaperworkField
          label="What they said · optional"
          value={note}
          onChange={setNote}
          maxLength={200}
          checkPatient
          testId="admin-requests-answer-note"
        />
        {request.kind === "more-time" && outcome === "agreed" ? (
          <p className="text-sm text-[color:var(--text-muted)]" data-testid="admin-requests-answer-renewals">
            Once saved, the request shows a link to update the date in Renewals, so your reminders move with it.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
