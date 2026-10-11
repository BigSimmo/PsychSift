"use client";

import { Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { WorkButton, WorkRing } from "@/components/mode-kit/work";
import { ActionStrip } from "@/components/teaching/teaching-actions";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  T5BigFigure,
  T5Check,
  T5Date,
  T5Done,
  T5Empty,
  T5Heading,
  T5Icon,
  T5Kicker,
  T5Link,
  T5List,
  T5Meta,
  T5Meter,
  T5Note,
  T5Page,
  T5Pair,
  T5Panel,
  T5Row,
  T5Section,
} from "@/components/teaching/t5-kit";
import { dayParts, perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  afterLabel,
  deidConfirmedNote,
  feedbackSummary,
  presentingItemLabels,
  readinessAction,
  readinessCount,
  supervisionLabel,
  supervisionSummary,
  talkKicker,
  talkMeta,
  upcomingTalkMeta,
} from "@/components/teaching/presenting-model";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { demoFeedbackTotals, demoSupervision, demoTeach, type DemoTeachSession } from "@/lib/teaching/depth-demo";
import {
  readinessItems,
  supervisionTypeLabels,
  teachingDepthUrl,
  type FeedbackTotals,
  type Readiness,
  type SessionRef,
  type SupervisionPairingView,
  type TeachRead,
} from "@/lib/teaching/depth-model";

/** How many later talks show before "All talks" opens the rest. */
const AFTER_SHOWN = 3;

/*
 * Presenting (mock-up v5 screen 02): your next talk and whether it is ready, the talks after it, how
 * past talks landed, and your supervision hours. It replaces Teach and the Supervision landing; the
 * full Supervision page (logging, confirming, corrections) stays one tap away.
 *
 * Feedback is counts only: pace and usefulness, shown 7 days after a talk once 5 or more people have
 * answered (the server's rule in `feedback.totals`), never a name or an individual answer.
 */

/**
 * TeachingAccountPage's remount-on-sign-in, written out here because that wrapper passes only
 * `demoMode` and Presenting also takes `talkId`.
 */
export function TeachingPresenting({ demoMode, talkId = null }: { demoMode: boolean; talkId?: string | null }) {
  const auth = useAuthSession();
  const demo = useTeachingDemoMode(demoMode);
  return <PresentingPage key={`${auth.authEpoch}:${demo}:${talkId ?? ""}`} demoMode={demo} talkId={talkId} />;
}

/**
 * `talkId` (from `?talk=`) opens that talk in the panel instead of the next one, so the patient-details
 * check can be done ahead for any booked talk; tapping a later talk does the same in place.
 */
function PresentingPage({ demoMode, talkId = null }: { demoMode: boolean; talkId?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(talkId);
  const [allTalks, setAllTalks] = useState(false);
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const teach = useTeachingResource<TeachRead>(demoMode ? null : "/api/teaching/depth?view=teach");
  const supervision = useTeachingResource<{ pairings: SupervisionPairingView[] }>(
    demoMode ? null : "/api/teaching/depth?view=supervision",
  );
  // The demo talk moves to tomorrow once today's has ended (14:45 Perth), so the demo reads the clock too.
  const teachData = useMemo<{ upcoming: DemoTeachSession[]; taught: SessionRef[] } | null>(
    () => (demoMode && today && now ? demoTeach(today, now) : teach.data),
    [demoMode, today, now, teach.data],
  );
  const pairings = useMemo(
    () => (demoMode && today ? demoSupervision(today, { supervising: false }) : (supervision.data?.pairings ?? null)),
    [demoMode, today, supervision.data],
  );

  let body;
  if (!demoMode && teach.status === "signed-out") body = <TeachingSignInNotice />;
  else if (!demoMode && (teach.status === "offline" || teach.status === "error" || teach.status === "setup"))
    body = <TeachingStateNotice state={teach.status} onRetry={teach.retry} />;
  else if (!teachData || !now || !today) body = <ModeModuleSkeleton rows={4} twoLine eyebrow />;
  else {
    const upcoming = teachData.upcoming.filter((talk) => talk.status !== "cancelled");
    const next = upcoming.find((talk) => talk.occurrenceId === selectedId) ?? upcoming[0];
    const isNext = next === upcoming[0];
    const after = upcoming.filter((talk) => talk !== next);
    const shown = allTalks ? after : after.slice(0, AFTER_SHOWN);
    body = (
      <>
        {next ? (
          <NextTalk
            key={next.occurrenceId}
            talk={next}
            isNext={isNext}
            now={now}
            today={today}
            demoMode={demoMode}
            onSaved={demoMode ? () => {} : teach.retry}
          />
        ) : (
          <T5Panel label="Your next talk" testId="teaching-next-talk">
            <T5Heading>No talks booked for you</T5Heading>
            <T5Meta>
              Your organiser names you as presenter. Your talks then show here with what is left to prepare.
            </T5Meta>
          </T5Panel>
        )}
        {after.length > 0 ? (
          <T5Section
            label={`${afterLabel(next, after, today, isNext)} · ${after.length}`}
            right={
              after.length > AFTER_SHOWN ? (
                <T5Link onClick={() => setAllTalks(!allTalks)} expanded={allTalks}>
                  {allTalks ? "Fewer talks" : "All talks"}
                </T5Link>
              ) : null
            }
            testId="teaching-talks-after"
          >
            <T5List>
              {shown.map((talk) => {
                const parts = dayParts(perthDateKey(talk.startsAt));
                return (
                  <T5Row
                    key={talk.occurrenceId}
                    lead={<T5Date day={parts.day} month={parts.month} />}
                    title={
                      <>
                        {talk.title}
                        {/* The date block is hidden from screen readers; say the date here instead. */}
                        <span className="sr-only">{`, ${parts.weekday} ${parts.day} ${parts.month}`}</span>
                      </>
                    }
                    meta={upcomingTalkMeta(talk)}
                    onClick={() => {
                      setSelectedId(talk.occurrenceId);
                      document.getElementById("teaching-next-talk-panel")?.scrollIntoView?.({ block: "start" });
                    }}
                  />
                );
              })}
            </T5List>
          </T5Section>
        ) : null}
        <TaughtBefore taught={teachData.taught} demoMode={demoMode} />
        <Supervision
          pairings={pairings}
          today={today}
          status={demoMode ? "ready" : supervision.status}
          retry={supervision.retry}
        />
      </>
    );
  }
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-presenting">
      <T5Page>
        <h1 className="sr-only">Presenting</h1>
        <div className="mt-3.5 grid min-w-0">{body}</div>
      </T5Page>
    </InformationPageShell>
  );
}

function NextTalk({
  talk,
  now,
  today,
  demoMode,
  onSaved,
  isNext,
}: {
  talk: DemoTeachSession;
  isNext: boolean;
  now: Date;
  today: string;
  demoMode: boolean;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<Readiness>({ items: talk.items, deidConfirmedAt: talk.deidConfirmedAt });
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deidOpen, setDeidOpen] = useState(false);
  // `localRef` is what the reader sees now; `confirmed` is the server's last answer; `queue` sends one
  // write at a time, in the order the reader made them (the same queue Teach used).
  const localRef = useRef(local);
  const confirmed = useRef<Readiness>(local);
  const inFlight = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function show(next: Readiness) {
    localRef.current = next;
    setLocal(next);
  }

  function save(body: Record<string, unknown>, change: (current: Readiness) => Readiness) {
    show(change(localRef.current));
    setError(null);
    const idle = inFlight.current === 0;
    inFlight.current += 1;
    setPending(inFlight.current);
    const write = async () => {
      try {
        confirmed.current = demoMode
          ? change(confirmed.current)
          : await teachingPost<Readiness>(teachingDepthUrl(talk.serviceId), {
              ...body,
              occurrenceId: talk.occurrenceId,
            });
        onSaved();
      } catch (cause) {
        setError(`Not saved. ${teachingErrorMessage(cause)}`);
      } finally {
        inFlight.current -= 1;
        setPending(inFlight.current);
        if (inFlight.current === 0) show(confirmed.current);
      }
    };
    queue.current = idle ? write() : queue.current.then(write);
  }

  function setItem(item: (typeof readinessItems)[number], done: boolean) {
    save({ action: "readiness.set", item, done }, (current) => ({
      ...current,
      items: done
        ? [...current.items.filter((value) => value !== item), item]
        : current.items.filter((value) => value !== item),
    }));
  }

  const ready = readinessItems.filter((item) => local.items.includes(item)).length;
  const action = readinessAction(local);
  const confirmDeid = () =>
    save({ action: "readiness.deid.confirm" }, (current) => ({
      ...current,
      deidConfirmedAt: current.deidConfirmedAt ?? new Date().toISOString(),
    }));
  // Work-mode redesign, owner request 6 Oct 2026: the talk is the page's hero (with how ready it is as
  // a ring), and the checklist is its own card under it. The patient-details check opens a short
  // sheet of four checks, so four ticks never read as ready on their own.
  return (
    <div id="teaching-next-talk-panel" data-testid="teaching-next-talk" className="grid scroll-mt-32 gap-y-2.25">
      <T5Panel hero label={isNext ? "Your next talk" : "Your talk"}>
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <T5Kicker>{talkKicker(talk, now, today, isNext)}</T5Kicker>
            <T5Heading>{talk.title}</T5Heading>
            <T5Meta>{talkMeta(talk)}</T5Meta>
          </div>
          <WorkRing
            value={`${ready}/${readinessItems.length}`}
            label="ready"
            fraction={ready / readinessItems.length}
            accessibleLabel={`${readinessCount(local)}${local.deidConfirmedAt ? " ready" : ""}`}
          />
        </div>
        <ActionStrip
          surface="hero"
          className="mt-1"
          actions={[
            // The slides link sits with the talk's materials on its session page.
            ...(local.items.includes("slides_link")
              ? [{ id: "slides", label: "Open slides", href: `/teaching/session/${talk.occurrenceId}` }]
              : []),
            {
              id: "code",
              label: "Check-in code",
              href: `/teaching/session/${talk.occurrenceId}/check-in`,
              emphasis: local.items.includes("slides_link") ? ("secondary" as const) : ("primary" as const),
            },
          ]}
        />
      </T5Panel>
      <T5Section label="Ready to present" right={readinessCount(local)}>
        <T5List testId="teaching-readiness">
          {readinessItems.map((item) => (
            <T5Check
              key={item}
              label={presentingItemLabels[item]}
              meta={talk.itemNotes?.[item]}
              checked={local.items.includes(item)}
              onChange={(done) => setItem(item, done)}
            />
          ))}
        </T5List>
        {action ? (
          <WorkButton
            size="wide"
            onClick={() => (action.kind === "deid" ? setDeidOpen(true) : setItem(action.item, true))}
          >
            {action.label}
          </WorkButton>
        ) : null}
        <T5Note icon="shield">
          {local.deidConfirmedAt
            ? deidConfirmedNote(local.deidConfirmedAt)
            : "Prepare your aims and reading list outside PsychSift. Do not upload slides, patient details or Teams passcodes."}
        </T5Note>
        <p role="status" className={cn("text-xs text-[color:var(--text-muted)]", pending === 0 && "sr-only")}>
          {pending > 0 ? "Saving…" : ""}
        </p>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-[color:var(--danger-text)]">
            {error}
          </p>
        ) : null}
      </T5Section>
      <DeidSheet
        open={deidOpen}
        onClose={() => setDeidOpen(false)}
        title={talk.title}
        onConfirm={() => {
          setDeidOpen(false);
          confirmDeid();
        }}
      />
    </div>
  );
}

const DEID_CHECKS = [
  "Cases changed so no one can be identified",
  "No names, dates, record numbers or photos",
  "No ward, bed or rare detail that points to a person",
  "No Teams passcodes on slides",
] as const;

/** The patient-details check before a talk: four ticks, then one confirm. Nothing here is uploaded. */
function DeidSheet({
  open,
  onClose,
  title,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onConfirm: () => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const all = ticked.size === DEID_CHECKS.length;
  return (
    <Sheet
      open={open}
      onClose={() => {
        setTicked(new Set());
        onClose();
      }}
      title="No patient details"
      description={title}
    >
      <div data-mode-identity="teaching" className="grid gap-3 pb-2">
        <T5List testId="teaching-deid-checks">
          {DEID_CHECKS.map((label, index) => (
            <T5Check
              key={label}
              label={label}
              checked={ticked.has(index)}
              onChange={(done) =>
                setTicked((previous) => {
                  const next = new Set(previous);
                  if (done) next.add(index);
                  else next.delete(index);
                  return next;
                })
              }
            />
          ))}
        </T5List>
        <T5Note tone="notice" icon="shield">
          Slides stay outside PsychSift. Only the link is kept.
        </T5Note>
        <WorkButton
          size="wide"
          disabled={!all}
          onClick={() => {
            setTicked(new Set());
            onConfirm();
          }}
        >
          I have checked my material
        </WorkButton>
      </div>
    </Sheet>
  );
}

function TaughtBefore({ taught, demoMode }: { taught: readonly SessionRef[]; demoMode: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const latest = taught[0] ?? null;
  return (
    <T5Section
      label={`Taught before · ${taught.length}`}
      right={
        taught.length > 1 ? (
          <T5Link onClick={() => setAll(!all)} expanded={all}>
            {all ? "Latest only" : `All ${taught.length}`}
          </T5Link>
        ) : null
      }
      testId="teaching-taught-before"
    >
      {latest ? (
        <>
          <FeedbackBlock session={latest} demoMode={demoMode} />
          {all && taught.length > 1 ? (
            <T5List>
              {taught.slice(1).map((session) => {
                const open = openId === session.occurrenceId;
                const parts = dayParts(perthDateKey(session.startsAt));
                return (
                  <T5Row
                    key={session.occurrenceId}
                    lead={<T5Date day={parts.day} month={parts.month} />}
                    title={session.title}
                    meta={`${parts.weekday} ${parts.day} ${parts.month}`}
                    end={
                      <T5Link
                        onClick={() => setOpenId(open ? null : session.occurrenceId)}
                        expanded={open}
                        label={`${open ? "Hide feedback on" : "Feedback on"} ${session.title}`}
                      >
                        {open ? "Hide feedback" : "Feedback"}
                      </T5Link>
                    }
                    below={open ? <FeedbackBlock session={session} demoMode={demoMode} compact /> : null}
                  />
                );
              })}
            </T5List>
          ) : null}
        </>
      ) : (
        <T5Empty>
          Talks you have given show here. Feedback totals show 7 days after a talk, once at least 5 people have
          answered.
        </T5Empty>
      )}
    </T5Section>
  );
}

function FeedbackBlock({
  session,
  demoMode,
  compact = false,
}: {
  session: SessionRef;
  demoMode: boolean;
  compact?: boolean;
}) {
  const resource = useTeachingResource<FeedbackTotals>(
    demoMode
      ? null
      : teachingDepthUrl(session.serviceId, { action: "feedback.totals", occurrenceId: session.occurrenceId }),
  );
  const totals = demoMode ? demoFeedbackTotals() : resource.data;
  const parts = dayParts(perthDateKey(session.startsAt));
  const failed = !demoMode && ["error", "offline", "setup", "signed-out"].includes(resource.status);
  const summary = totals ? feedbackSummary(totals) : null;
  return (
    <div
      className={cn("grid gap-2", compact ? "pt-2" : "border-t border-[color:var(--border)] pt-2.5 pb-1")}
      data-testid="teaching-feedback-totals"
    >
      {compact ? null : (
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="text-sm font-medium text-[color:var(--text-heading)]">{session.title}</span>
          <span className="nums shrink-0 text-sm font-normal text-[color:var(--text-muted)]">
            {`${parts.day} ${parts.month}${summary ? ` · ${summary.answers}` : ""}`}
          </span>
        </div>
      )}
      {failed ? (
        <p className="text-sm text-[color:var(--text-muted)]">
          Feedback could not load. <T5Link onClick={resource.retry}>Try again</T5Link>
        </p>
      ) : !totals ? (
        <ModeModuleSkeleton rows={1} />
      ) : !summary ? (
        <p className="text-sm text-[color:var(--text-muted)]">
          No totals yet. They show 7 days after the talk, once at least 5 people have answered.
        </p>
      ) : (
        <>
          {compact ? (
            <p className="nums text-sm font-normal text-[color:var(--text-muted)]">{summary.answers}</p>
          ) : null}
          <span role="img" aria-label={summary.paceSentence} className="flex h-1.5 gap-0.5">
            {summary.pace.map((part) =>
              part.count > 0 ? (
                <i
                  key={part.key}
                  style={{ flexGrow: part.count }}
                  className={cn(
                    "rounded-sm",
                    part.key === "right"
                      ? "bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none"
                      : "bg-[color:var(--border-strong)]",
                  )}
                />
              ) : null,
            )}
          </span>
          <p className="nums text-sm font-normal text-[color:var(--text-muted)]">{summary.paceLine}</p>
          {summary.usefulness ? (
            <T5Pair label="Usefulness" value={<T5BigFigure value={summary.usefulness} unit="out of 5" />} />
          ) : null}
          {compact ? null : <T5Note className="mt-0">The presenter sees answers, never names.</T5Note>}
        </>
      )}
    </div>
  );
}

function Supervision({
  pairings,
  today,
  status,
  retry,
}: {
  pairings: readonly SupervisionPairingView[] | null;
  today: string;
  status: string;
  retry: () => void;
}) {
  const summary = pairings ? supervisionSummary(pairings) : null;
  return (
    <T5Section
      id="supervision"
      label={pairings ? supervisionLabel(pairings, today) : "Supervision"}
      right={<T5Link href="/teaching/supervision">Log supervision</T5Link>}
      testId="teaching-supervision-summary"
    >
      {!summary ? (
        status === "loading" || status === "idle" ? (
          <ModeModuleSkeleton rows={2} />
        ) : (
          <T5Empty>
            Supervision could not load. <T5Link onClick={retry}>Try again</T5Link>
          </T5Empty>
        )
      ) : summary.mine === null && summary.toConfirm === 0 ? (
        <T5Empty>No supervision pairing yet. Your organiser sets one up, then you log hours here.</T5Empty>
      ) : (
        <>
          {summary.mine ? (
            <div className="grid gap-2 border-t border-[color:var(--border)] pt-2.5 pb-1">
              <div className="flex items-baseline justify-between gap-2.5">
                <span>
                  <T5BigFigure value={summary.mine.confirmed} unit={summary.mine.targetLine ?? "confirmed"} />
                </span>
                {summary.mine.toGo ? (
                  <span className="text-sm text-[color:var(--text-muted)]">{summary.mine.toGo}</span>
                ) : null}
              </div>
              {summary.mine.percent !== null ? (
                <T5Meter percent={summary.mine.percent} label={`${summary.mine.percent}% of your target`} />
              ) : null}
            </div>
          ) : null}
          <T5List>
            {summary.entries.map((entry) => (
              <T5Row
                key={entry.entryId}
                lead={<T5Icon icon={Users} />}
                title={supervisionTypeLabels[entry.type]}
                meta={entry.meta}
                end={entry.status === "confirmed" ? <T5Done label="Confirmed" /> : undefined}
              />
            ))}
            {summary.toConfirm > 0 ? (
              <T5Row
                title={
                  summary.toConfirm === 1
                    ? "1 entry or correction to confirm"
                    : `${summary.toConfirm} entries or corrections to confirm`
                }
                meta="You supervise"
                href="/teaching/supervision"
              />
            ) : null}
          </T5List>
        </>
      )}
    </T5Section>
  );
}
