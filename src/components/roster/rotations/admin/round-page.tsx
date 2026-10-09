"use client";

import {
  CalendarRange,
  Clock3,
  FilePen,
  Lock,
  MapPin,
  PenLine,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkCheckRow,
  WorkChip,
  WorkChips,
  WorkDock,
  WorkEmpty,
  WorkHero,
  WorkIconRow,
  WorkRing,
  WorkSectionLabel,
  WorkTag,
  useWorkUndoToast,
} from "@/components/mode-kit/work";
import { Switch } from "@/components/open-shifts/open-shifts-ui";
import { useRosterNow } from "@/components/roster/roster-format";
import {
  formatClosing,
  formatDayWithYear,
  formatTermDates,
  placesWords,
} from "@/components/roster/rotations/rotation-format";
import { useRotations, type RotationsRead } from "@/components/roster/rotations/use-rotations";
import { Sheet } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { announce } from "@/components/ui/live-announcer";
import { cn, controlDisabled } from "@/components/ui-primitives";
import { ordinal } from "@/lib/roster/rotations/allocate";
import { placesPerTerm, type ManagedRound } from "@/lib/roster/rotations/model";
import { preferenceCounts } from "@/lib/roster/rotations/operations";

import {
  adminRankTag,
  capacityCheck,
  daysUntil,
  freeWords,
  groupByRotation,
  MANAGE_ROTATIONS_HREF,
  manageRoundHref,
  moveOptions,
  peopleYears,
  placementWords,
  plural,
  rankMeter,
  resultHeadline,
  resultLine,
  roundIdFromParam,
  ROUND_ZONE,
  sentRanking,
  stillToSend,
  yearSpanLabel,
} from "./round-admin-model";
import { EditRoundForm } from "./round-form";
import { AvatarRow, RotationAvatar, RotationsAdminGate } from "./rounds-page";

/**
 * One rotation round for its administrator (`/roster/manage/rotations/<round>`,
 * mockups `S.round`, `S.review`, `S.adjust`). What it shows follows the round:
 * a draft's summary, an open round's preferences coming in, then the
 * allocation to review, adjust and publish. Once published the same review
 * stays editable and every change updates doctors' calendars.
 * `?edit=1` shows the round form in place.
 */

const hint = "text-xs text-[color:var(--work-ink-muted)]";

export function RotationRoundPage({ roundId }: { readonly roundId: string }) {
  const read = useRotations();
  const params = useSearchParams();
  const router = useRouter();
  const id = roundIdFromParam(roundId);
  const managed = read.managed.find((item) => item.round.id === id || item.round.id === roundId) ?? null;
  const editing = params?.get("edit") === "1";
  const href = manageRoundHref(managed?.round.id ?? id);
  useModeBandHeading({
    eyebrow: managed ? (editing ? "Edit round" : eyebrowFor(managed)) : "Rotation rounds",
    title: managed?.round.name ?? "Rotation round",
  });
  return (
    <main className="min-w-0">
      <WorkBody testId="rotation-round">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          {managed?.round.name ?? "Rotation round"}
        </PageTitleUnderBand>
        <RotationsAdminGate read={read} what="rotation rounds">
          {!managed ? (
            <WorkCard testId="rotation-round-missing">
              <WorkEmpty
                icon={Search}
                title="That round isn't here"
                body="It may have been deleted, or it belongs to another team."
                action={
                  <WorkButton variant="secondary" href={MANAGE_ROTATIONS_HREF} testId="rotation-round-missing-back">
                    All rounds
                  </WorkButton>
                }
              />
            </WorkCard>
          ) : editing ? (
            <EditRoundForm
              read={read}
              managed={managed}
              onDone={() => router.replace(href)}
              onCancel={() => router.replace(href)}
            />
          ) : (
            <RoundBody read={read} managed={managed} onEdit={() => router.push(`${href}?edit=1`)} />
          )}
        </RotationsAdminGate>
      </WorkBody>
    </main>
  );
}

function eyebrowFor(managed: ManagedRound): string {
  const { round, allocation } = managed;
  switch (round.status) {
    case "draft":
      return "Draft · not sent yet";
    case "open":
      return `Closes ${formatClosing(round.closesAt, ROUND_ZONE)}`;
    case "closed":
      return allocation ? `Allocation run ${formatClosing(allocation.runAt, ROUND_ZONE)}` : "Closed to changes";
    default:
      return round.publishedAt ? `Published ${formatDayWithYear(round.publishedAt, ROUND_ZONE)}` : "Published";
  }
}

function RoundBody({
  read,
  managed,
  onEdit,
}: {
  readonly read: RotationsRead;
  readonly managed: ManagedRound;
  readonly onEdit: () => void;
}) {
  const { status } = managed.round;
  if (status === "draft") return <DraftView read={read} managed={managed} onEdit={onEdit} />;
  if (status === "open" || !managed.allocation) return <CollectingView read={read} managed={managed} onEdit={onEdit} />;
  return <ReviewView read={read} managed={managed} onEdit={onEdit} />;
}

// ---------------------------------------------------------------- shared parts

type Busy = { readonly busy: boolean; readonly problem: string | null };

/** Runs one action at a time and keeps its message. */
function useRunner() {
  const [state, setState] = useState<Busy>({ busy: false, problem: null });
  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: () => void) => {
    setState({ busy: true, problem: null });
    const result = await action();
    if (!result.ok) {
      setState({ busy: false, problem: result.message });
      announce(result.message, { priority: "assertive" });
      return false;
    }
    setState({ busy: false, problem: null });
    done?.();
    return true;
  };
  return { ...state, run, clear: () => setState({ busy: false, problem: null }) };
}

function Problem({ text }: { readonly text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="work-card work-card--pad" data-testid="rotation-round-problem">
      <WorkCheckRow tone="warn">{text}</WorkCheckRow>
    </div>
  );
}

/**
 * An in-page "are you sure", in place of the dock while it is asked. Focus
 * moves to its question; Not yet puts the dock back.
 */
function ConfirmPanel({
  title,
  body,
  confirm,
  tone = "primary",
  busy,
  onConfirm,
  onCancel,
  testId,
}: {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirm: string;
  readonly tone?: "primary" | "amber";
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testId: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="work-card work-card--pad sticky bottom-[max(0.75rem,var(--safe-area-bottom,0px))] grid gap-3 shadow-[var(--e2)]"
      data-testid={testId}
    >
      <h2
        id={`${testId}-title`}
        ref={heading}
        tabIndex={-1}
        className="m-0 text-base font-semibold text-[color:var(--work-ink)] focus-visible:outline-none"
      >
        {title}
      </h2>
      <div className="text-sm text-[color:var(--work-ink-muted)]">{body}</div>
      <div className="grid grid-cols-2 gap-2">
        <WorkButton variant="secondary" onClick={onCancel} disabled={busy} testId={`${testId}-cancel`}>
          Not yet
        </WorkButton>
        <WorkButton variant={tone} onClick={onConfirm} disabled={busy} testId={`${testId}-confirm`}>
          {busy ? "Working" : confirm}
        </WorkButton>
      </div>
    </section>
  );
}

function RoundFacts({
  managed,
  onEdit,
  editLabel,
}: {
  readonly managed: ManagedRound;
  readonly onEdit: () => void;
  readonly editLabel: string;
}) {
  const { round } = managed;
  return (
    <>
      <WorkSectionLabel>Round</WorkSectionLabel>
      <WorkCard testId="rotation-round-facts">
        <WorkIconRow icon={CalendarRange} title={plural(round.terms.length, "term")} sub={yearSpanLabel(round.terms)} />
        <WorkIconRow
          icon={MapPin}
          title={plural(round.rotations.length, "rotation")}
          sub={placesWords(placesPerTerm(round))}
        />
        <WorkIconRow
          icon={Users}
          title={plural(round.people.length, "person", "people")}
          sub={round.minRanked > 0 ? `Each ranks at least ${round.minRanked}` : "Each ranks at least one"}
        />
        <WorkIconRow
          icon={PenLine}
          title={editLabel}
          sub="Dates, rotations, people and deadline"
          onClick={onEdit}
          testId="rotation-round-edit"
        />
      </WorkCard>
    </>
  );
}

// ---------------------------------------------------------------- draft

function DraftView({
  read,
  managed,
  onEdit,
}: {
  readonly read: RotationsRead;
  readonly managed: ManagedRound;
  readonly onEdit: () => void;
}) {
  const { round } = managed;
  const router = useRouter();
  const toast = useWorkUndoToast();
  const runner = useRunner();
  const [asking, setAsking] = useState<"delete" | null>(null);
  const capacity = capacityCheck(round.people.length, placesPerTerm(round));

  return (
    <>
      <WorkCard padded testId="rotation-round-draft-intro">
        <p className="m-0 text-sm font-semibold text-[color:var(--work-ink)]">Not sent to anyone yet</p>
        <p className={cn(hint, "mt-1")}>
          {`When you open it, ${plural(round.people.length, "person", "people")} can rank the rotations until ${formatClosing(round.closesAt, ROUND_ZONE)}, Perth time.`}
        </p>
      </WorkCard>
      <Problem text={runner.problem} />
      <WorkCard>
        <WorkIconRow icon={Clock3} title="Closes" sub={`${formatClosing(round.closesAt, ROUND_ZONE)}, Perth time`} />
      </WorkCard>
      <div className="work-card work-card--pad">
        <WorkCheckRow tone={capacity.tone === "ok" ? "ok" : "warn"}>{capacity.text}</WorkCheckRow>
      </div>
      {round.note ? (
        <>
          <WorkSectionLabel>Note to your team</WorkSectionLabel>
          <WorkCard padded>
            <p className="m-0 text-sm text-[color:var(--work-ink)]">{round.note}</p>
          </WorkCard>
        </>
      ) : null}
      <RoundFacts managed={managed} onEdit={onEdit} editLabel="Edit round" />
      <div className="grid grid-cols-1">
        <WorkButton variant="quiet" icon={Trash2} onClick={() => setAsking("delete")} testId="rotation-round-delete">
          Delete draft
        </WorkButton>
      </div>
      {asking === "delete" ? (
        <ConfirmPanel
          title="Delete this draft?"
          body="It hasn't been sent to anyone. This can't be undone."
          confirm="Delete draft"
          tone="amber"
          busy={runner.busy}
          onCancel={() => setAsking(null)}
          onConfirm={() =>
            void runner.run(
              () => read.actions.deleteDraft(round.id),
              () => {
                toast?.("Draft deleted");
                announce("Draft deleted");
                router.replace(MANAGE_ROTATIONS_HREF);
              },
            )
          }
          testId="rotation-round-delete-confirm"
        />
      ) : (
        <WorkDock aria-label="Round actions">
          <WorkButton variant="secondary" icon={FilePen} onClick={onEdit} testId="rotation-round-draft-edit">
            Edit
          </WorkButton>
          <WorkButton
            icon={Send}
            disabled={runner.busy}
            onClick={() =>
              void runner.run(
                () => read.actions.openRound(round.id),
                () => {
                  toast?.("Round open. Your team can rank now");
                  announce("Round open. Your team can rank now");
                },
              )
            }
            testId="rotation-round-open"
          >
            Open round
          </WorkButton>
        </WorkDock>
      )}
    </>
  );
}

// ---------------------------------------------------------------- open, or closed before allocating

function CollectingView({
  read,
  managed,
  onEdit,
}: {
  readonly read: RotationsRead;
  readonly managed: ManagedRound;
  readonly onEdit: () => void;
}) {
  const { round } = managed;
  const now = useRosterNow();
  const toast = useWorkUndoToast();
  const runner = useRunner();
  const [asking, setAsking] = useState<"allocate" | "close" | null>(null);
  const counts = preferenceCounts(managed);
  const waiting = stillToSend(managed);
  const open = round.status === "open";
  const days = daysUntil(round.closesAt, now);
  const left = counts.total - counts.sent;
  const sub = open
    ? days > 0
      ? `${left} still to send · ${plural(days, "day")} left`
      : `${left} still to send · closing time passed`
    : "Closed to changes. Allocate when you're ready";

  const allocate = () =>
    void runner.run(
      () => read.actions.runAllocation(round.id),
      () => {
        setAsking(null);
        toast?.("Allocation ready to review");
        announce("Allocation ready to review");
      },
    );

  return (
    <>
      <WorkHero
        eyebrow="Preferences"
        title={`${counts.sent} of ${counts.total} sent`}
        sub={sub}
        ring={
          <WorkRing
            value={counts.sent}
            label={`of ${counts.total}`}
            fraction={counts.total ? counts.sent / counts.total : 0}
            accessibleLabel={`${counts.sent} of ${counts.total} have sent their preferences`}
          />
        }
        testId="rotation-round-collecting-hero"
      />
      <Problem text={runner.problem} />

      <WorkSectionLabel count={waiting.length || undefined}>Still to send</WorkSectionLabel>
      {waiting.length === 0 ? (
        <div className="work-card work-card--pad" data-testid="rotation-round-all-sent">
          <WorkCheckRow>Everyone has sent their preferences</WorkCheckRow>
        </div>
      ) : (
        <WorkCard testId="rotation-round-waiting">
          {waiting.map((person) => (
            <AvatarRow
              key={person.id}
              name={person.name}
              sub={person.state === "draft" ? "Draft saved, not sent" : "Not started"}
              end={
                person.state === "draft" ? (
                  <WorkTag tone="amber">Draft</WorkTag>
                ) : (
                  <WorkTag tone="neutral">Not started</WorkTag>
                )
              }
            />
          ))}
        </WorkCard>
      )}
      {waiting.length > 0 ? (
        <p className={cn(hint, "px-1")}>Only sent preferences count when you allocate. A draft is not a choice.</p>
      ) : null}

      <RoundFacts managed={managed} onEdit={onEdit} editLabel="Edit round" />

      {asking === "allocate" ? (
        <ConfirmPanel
          title="Allocate now?"
          body={
            <>
              {open ? "This closes the round, so no one can send or change preferences. " : null}
              {left > 0
                ? `${plural(left, "person", "people")} haven't sent, so they get the places left over.`
                : "Everyone has sent."}
            </>
          }
          confirm={open ? "Close and allocate" : "Allocate"}
          busy={runner.busy}
          onCancel={() => setAsking(null)}
          onConfirm={allocate}
          testId="rotation-round-allocate-confirm"
        />
      ) : asking === "close" ? (
        <ConfirmPanel
          title="Close early?"
          body="No one can send or change preferences after this. You can open it again before the closing time."
          confirm="Close round"
          tone="amber"
          busy={runner.busy}
          onCancel={() => setAsking(null)}
          onConfirm={() =>
            void runner.run(
              () => read.actions.closeRound(round.id),
              () => {
                setAsking(null);
                toast?.("Round closed");
                announce("Round closed");
              },
            )
          }
          testId="rotation-round-close-confirm"
        />
      ) : (
        <WorkDock aria-label="Round actions">
          {open ? (
            <WorkButton
              variant="secondary"
              onClick={() => setAsking("close")}
              disabled={runner.busy}
              testId="rotation-round-close"
            >
              Close early
            </WorkButton>
          ) : days > 0 ? (
            <WorkButton
              variant="secondary"
              disabled={runner.busy}
              onClick={() =>
                void runner.run(
                  () => read.actions.openRound(round.id),
                  () => {
                    toast?.("Round open again");
                    announce("Round open again");
                  },
                )
              }
              testId="rotation-round-reopen"
            >
              Open again
            </WorkButton>
          ) : null}
          <WorkButton
            icon={Sparkles}
            onClick={() => setAsking("allocate")}
            disabled={runner.busy}
            testId="rotation-round-allocate"
          >
            Allocate now
          </WorkButton>
        </WorkDock>
      )}
    </>
  );
}

// ---------------------------------------------------------------- review and published

type Selected = { readonly personId: string; readonly termId: string } | null;

function ReviewView({
  read,
  managed,
  onEdit,
}: {
  readonly read: RotationsRead;
  readonly managed: ManagedRound;
  readonly onEdit: () => void;
}) {
  const { round } = managed;
  const allocation = managed.allocation!;
  const published = round.status === "published";
  const toast = useWorkUndoToast();
  const runner = useRunner();
  const [view, setView] = useState<"rotation" | "person">("rotation");
  const [termId, setTermId] = useState(round.terms[0]?.id ?? "");
  const [asking, setAsking] = useState<"run" | "publish" | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const term = round.terms.find((item) => item.id === termId) ?? round.terms[0];
  const summary = allocation.summary;
  const firsts = summary.byRank[0] ?? 0;
  const pct = summary.placements ? Math.round((firsts / summary.placements) * 100) : 0;
  const segments = rankMeter(summary);
  const problems = allocation.problems;

  return (
    <>
      <WorkHero
        eyebrow={published ? "Published" : "Result"}
        title={resultHeadline(summary)}
        sub={`${resultLine(summary)}${summary.unfilled ? ` · ${plural(summary.unfilled, "empty term")}` : ""}`}
        ring={
          <WorkRing
            value={`${pct}%`}
            label="1st"
            fraction={pct / 100}
            accessibleLabel={`${pct} percent of places are a 1st choice`}
          />
        }
        footer={<RankMeterBar segments={segments} />}
        testId="rotation-round-result-hero"
      />
      <Problem text={runner.problem} />

      {published ? (
        <WorkCard testId="rotation-round-published-note">
          <div className="px-3 pt-3">
            <WorkCheckRow>On every doctor&apos;s calendar. Changes you make here update their calendars.</WorkCheckRow>
          </div>
          <WorkIconRow
            icon={PenLine}
            title="Edit dates and rotations"
            sub="Term dates, names and places"
            onClick={onEdit}
            testId="rotation-round-published-edit"
          />
        </WorkCard>
      ) : null}

      {problems.length > 0 || summary.unfilled > 0 ? (
        <>
          <WorkSectionLabel count={problems.length || undefined}>To check</WorkSectionLabel>
          <div className="work-card work-card--pad" data-testid="rotation-round-problems">
            {problems.map((text) => (
              <WorkCheckRow key={text} tone="warn">
                {text}
              </WorkCheckRow>
            ))}
            {summary.unfilled > 0 && problems.length === 0 ? (
              <WorkCheckRow tone="warn">
                {`${plural(summary.unfilled, "term")} across the year ${summary.unfilled === 1 ? "has" : "have"} no one placed. Tap a person to place them.`}
              </WorkCheckRow>
            ) : null}
          </div>
        </>
      ) : null}

      <SegmentedControl
        label="Show the allocation"
        layout="equal"
        value={view}
        onChange={setView}
        options={[
          { value: "rotation", label: "By rotation" },
          { value: "person", label: "By person" },
        ]}
      />

      {view === "rotation" && term ? (
        <ByRotation managed={managed} termId={term.id} onTerm={setTermId} onPick={setSelected} />
      ) : (
        <ByPerson managed={managed} onPick={setSelected} />
      )}

      {published ? null : (
        <>
          <RoundFacts managed={managed} onEdit={onEdit} editLabel="Edit round" />
          <p className={cn(hint, "px-1")}>Editing the round clears this allocation, so you run it again after.</p>
        </>
      )}

      {selected ? (
        <AdjustSheet
          read={read}
          managed={managed}
          personId={selected.personId}
          termId={selected.termId}
          onClose={() => setSelected(null)}
          onSaved={(words) => {
            setSelected(null);
            toast?.(words);
            announce(words);
          }}
        />
      ) : null}

      {published ? null : asking === "run" ? (
        <ConfirmPanel
          title="Run it again?"
          body="Placements you fixed stay where they are. Everything else is worked out again, so moves you didn't fix are lost."
          confirm="Run again"
          busy={runner.busy}
          onCancel={() => setAsking(null)}
          onConfirm={() =>
            void runner.run(
              () => read.actions.runAllocation(round.id),
              () => {
                setAsking(null);
                toast?.("Allocation run again");
                announce("Allocation run again");
              },
            )
          }
          testId="rotation-round-run-confirm"
        />
      ) : asking === "publish" ? (
        <ConfirmPanel
          title="Publish the rotations?"
          body={
            <>
              Doctors see their rotations and they go on calendars.
              {summary.unfilled > 0
                ? ` ${plural(summary.unfilled, "term")} still ${summary.unfilled === 1 ? "has" : "have"} no one placed.`
                : ""}
            </>
          }
          confirm="Publish"
          busy={runner.busy}
          onCancel={() => setAsking(null)}
          onConfirm={() =>
            void runner.run(
              () => read.actions.publish(round.id),
              () => {
                setAsking(null);
                toast?.("Published. Rotations are on calendars");
                announce("Published. Rotations are on calendars");
              },
            )
          }
          testId="rotation-round-publish-confirm"
        />
      ) : (
        <WorkDock aria-label="Allocation actions">
          <WorkButton
            variant="secondary"
            icon={RotateCcw}
            onClick={() => setAsking("run")}
            disabled={runner.busy}
            testId="rotation-round-run-again"
          >
            Run again
          </WorkButton>
          <WorkButton
            icon={Send}
            onClick={() => setAsking("publish")}
            disabled={runner.busy}
            testId="rotation-round-publish"
          >
            Publish
          </WorkButton>
        </WorkDock>
      )}
    </>
  );
}

const SEGMENT_SHADE = ["opacity-100", "opacity-70", "opacity-45", "opacity-25"] as const;

/** The hero's stacked meter: 1st, 2nd, 3rd, then lower, in shades of the hero's text colour. */
function RankMeterBar({ segments }: { readonly segments: ReturnType<typeof rankMeter> }) {
  const words = segments.map((segment) => `${segment.count} ${segment.label}`).join(", ");
  return (
    <div className="grid gap-1.5">
      <div
        role="img"
        aria-label={`Places by choice: ${words}`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-[color:var(--work-ring-track-on-hero)]"
      >
        {segments.map((segment, index) =>
          segment.fraction > 0 ? (
            <span
              key={segment.key}
              className={cn("h-full bg-current", SEGMENT_SHADE[index])}
              style={{ width: `${(segment.fraction * 100).toFixed(2)}%` }}
            />
          ) : null,
        )}
      </div>
      <p aria-hidden="true" className="m-0 flex flex-wrap gap-x-3 text-2xs font-semibold">
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <span key={segment.key}>{`${segment.key === "lower" ? "Lower" : segment.label} ${segment.count}`}</span>
          ))}
      </p>
    </div>
  );
}

function ByRotation({
  managed,
  termId,
  onTerm,
  onPick,
}: {
  readonly managed: ManagedRound;
  readonly termId: string;
  readonly onTerm: (termId: string) => void;
  readonly onPick: (selected: Selected) => void;
}) {
  const { round } = managed;
  const view = useMemo(() => groupByRotation(managed, termId), [managed, termId]);
  const term = round.terms.find((item) => item.id === termId);
  return (
    <>
      <WorkChips scroll label="Term">
        {round.terms.map((item) => (
          <WorkChip
            key={item.id}
            selected={item.id === termId}
            onClick={() => onTerm(item.id)}
            testId={`rotation-round-term-${item.id}`}
          >
            {item.label}
          </WorkChip>
        ))}
      </WorkChips>
      {term ? <p className={cn(hint, "-mt-1 px-1")}>{formatTermDates(term.start, term.end)}</p> : null}
      {view.groups
        .filter((group) => group.rotation.places > 0 || group.people.length > 0)
        .map((group) => {
          const free = group.rotation.places - group.people.length;
          return (
            <section key={group.rotation.id} aria-label={group.rotation.name} className="grid min-w-0 gap-2.25">
              <WorkSectionLabel count={`${group.people.length} of ${group.rotation.places}`}>
                {group.rotation.name}
              </WorkSectionLabel>
              <WorkCard testId={`rotation-round-group-${group.rotation.id}`}>
                {group.people.map(({ person, placement }) => {
                  const tag = adminRankTag(placement.rank);
                  return (
                    <AvatarRow
                      key={person.id}
                      name={person.name}
                      sub={placementWords(placement)}
                      end={
                        <span className="flex items-center gap-1">
                          {placement.locked ? <WorkTag tone="neutral">Fixed</WorkTag> : null}
                          <WorkTag tone={tag.tone}>{tag.label}</WorkTag>
                        </span>
                      }
                      onClick={() => onPick({ personId: person.id, termId })}
                      accessibleName={`${person.name}, ${placementWords(placement)}. Adjust`}
                      testId={`rotation-round-person-${person.id}`}
                    />
                  );
                })}
                {free > 0 ? (
                  <div className="work-row">
                    <span className="work-row__text">
                      <span className="work-row__sub">{`${plural(free, "place")} free${group.rotation.site ? ` · ${group.rotation.site}` : ""}`}</span>
                    </span>
                  </div>
                ) : null}
              </WorkCard>
            </section>
          );
        })}
      {view.unfilled.length > 0 ? (
        <section aria-label="No rotation this term" className="grid min-w-0 gap-2.25">
          <WorkSectionLabel count={view.unfilled.length}>No rotation this term</WorkSectionLabel>
          <WorkCard testId="rotation-round-unfilled">
            {view.unfilled.map(({ person, reason }) => (
              <AvatarRow
                key={person.id}
                name={person.name}
                sub={reason}
                end={<WorkTag tone="amber">Empty</WorkTag>}
                onClick={() => onPick({ personId: person.id, termId })}
                accessibleName={`${person.name}, no rotation this term. Place them`}
                testId={`rotation-round-unfilled-${person.id}`}
              />
            ))}
          </WorkCard>
        </section>
      ) : null}
    </>
  );
}

function ByPerson({
  managed,
  onPick,
}: {
  readonly managed: ManagedRound;
  readonly onPick: (selected: Selected) => void;
}) {
  const years = useMemo(() => peopleYears(managed), [managed]);
  return (
    <>
      {years.map((year) => (
        <WorkCard
          key={year.person.id}
          as="section"
          aria-label={year.person.name}
          testId={`rotation-round-year-${year.person.id}`}
        >
          <div className="work-row">
            <RotationAvatar name={year.person.name} />
            <span className="work-row__text">
              <span className="work-row__title">{year.person.name}</span>
              <span className="work-row__sub">
                {[
                  plural(year.firstChoices, "1st choice"),
                  year.empty ? `${plural(year.empty, "empty term")}` : null,
                  sentRanking(managed, year.person.id) ? null : "no preferences sent",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </div>
          {year.terms.map(({ term, placement, rotation }) => {
            const tag = placement ? adminRankTag(placement.rank) : null;
            return (
              <button
                key={term.id}
                type="button"
                className="work-row"
                onClick={() => onPick({ personId: year.person.id, termId: term.id })}
                aria-label={`${year.person.name}, ${term.label}: ${rotation ? `${rotation.name}, ${placementWords(placement!)}` : "no rotation"}. Adjust`}
                data-testid={`rotation-round-year-${year.person.id}-${term.id}`}
              >
                <span className="grid w-20 shrink-0">
                  <span className="text-3xs font-bold tracking-label text-[color:var(--mode-identity)] uppercase">
                    {term.label}
                  </span>
                  <span className="text-2xs font-semibold text-[color:var(--work-ink-muted)]">
                    {formatTermDates(term.start, term.end)}
                  </span>
                </span>
                <span className="work-row__text">
                  <span className="work-row__title">{rotation?.name ?? "No rotation"}</span>
                  {rotation?.site ? <span className="work-row__sub">{rotation.site}</span> : null}
                </span>
                <span className="work-row__end flex items-center gap-1">
                  {placement?.locked ? <WorkTag tone="neutral">Fixed</WorkTag> : null}
                  {tag ? <WorkTag tone={tag.tone}>{tag.label}</WorkTag> : <WorkTag tone="amber">Empty</WorkTag>}
                </span>
              </button>
            );
          })}
        </WorkCard>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- adjust one placement

function AdjustSheet({
  read,
  managed,
  personId,
  termId,
  onClose,
  onSaved,
}: {
  readonly read: RotationsRead;
  readonly managed: ManagedRound;
  readonly personId: string;
  readonly termId: string;
  readonly onClose: () => void;
  readonly onSaved: (words: string) => void;
}) {
  const { round } = managed;
  const person = round.people.find((item) => item.id === personId);
  const term = round.terms.find((item) => item.id === termId);
  const placements = managed.allocation?.placements ?? [];
  const current = placements.find((p) => p.personId === personId && p.termId === termId) ?? null;
  const [choice, setChoice] = useState<string | null>(current?.rotationId ?? null);
  const [fixed, setFixed] = useState(current?.locked ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => moveOptions(managed, personId, termId), [managed, personId, termId]);
  const ranking = sentRanking(managed, personId);
  const published = round.status === "published";
  if (!person || !term) return null;

  const rotationName = (id: string | null) =>
    round.rotations.find((rotation) => rotation.id === id)?.name ?? "No rotation";
  const moved = choice !== (current?.rotationId ?? null);
  const lockChanged = choice !== null && fixed !== (current?.locked ?? false);
  const changed = moved || lockChanged;

  async function save() {
    if (!person || !term) return;
    setBusy(true);
    setProblem(null);
    const result =
      !moved && current && choice !== null
        ? await read.actions.setLock(round.id, personId, termId, fixed)
        : await read.actions.movePlacement(round.id, {
            personId,
            termId,
            rotationId: choice,
            lock: choice !== null && fixed,
          });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      announce(result.message, { priority: "assertive" });
      return;
    }
    const words = !moved
      ? fixed
        ? `${person.name} fixed in ${rotationName(choice)}`
        : `${person.name} no longer fixed`
      : choice === null
        ? `${person.name} cleared for ${term.label}`
        : `${person.name} moved to ${rotationName(choice)} for ${term.label}`;
    onSaved(words);
  }

  const placedTerm = (rotationId: string) => {
    const where = placements.find((p) => p.personId === personId && p.rotationId === rotationId);
    return where ? (round.terms.find((item) => item.id === where.termId)?.label ?? null) : null;
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${person.name} · ${term.label}`}
      description={
        current ? `${rotationName(current.rotationId)} · ${placementWords(current)}` : "No rotation this term"
      }
      testId="rotation-round-adjust"
      footer={
        <div data-work-frame="sheet" data-mode-identity="roster" className="grid grid-cols-1 gap-2">
          {published && changed ? (
            <p className={cn(hint, "m-0 text-center")}>Their calendar updates when you save.</p>
          ) : null}
          <WorkButton
            size="wide"
            onClick={() => void save()}
            disabled={!changed || busy}
            testId="rotation-round-adjust-save"
          >
            {busy ? "Saving" : changed ? "Save change" : "No change yet"}
          </WorkButton>
        </div>
      }
    >
      <div data-work-frame="sheet" data-mode-identity="roster" className="grid gap-3">
        {problem ? (
          <div role="alert" className="work-card work-card--pad">
            <WorkCheckRow tone="warn">{problem}</WorkCheckRow>
          </div>
        ) : null}

        <WorkSectionLabel as="h3">Their ranking</WorkSectionLabel>
        {ranking && ranking.length > 0 ? (
          <WorkCard as="ul" aria-label={`${person.name}'s ranking`}>
            {ranking.map((rotationId, index) => {
              const where = placedTerm(rotationId);
              return (
                <li key={rotationId} className="work-row">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                      index === 0
                        ? "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
                        : "bg-[color:var(--mode-identity-soft-2)] text-[color:var(--mode-identity-deep)]",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="work-row__text">
                    <span className="work-row__title">
                      <span className="sr-only">{`${ordinal(index + 1)}: `}</span>
                      {rotationName(rotationId)}
                    </span>
                    <span className="work-row__sub">{where ? `Placed in ${where}` : "Not placed"}</span>
                  </span>
                  {where === term.label ? <WorkTag tone="green">This term</WorkTag> : null}
                </li>
              );
            })}
          </WorkCard>
        ) : (
          <div className="work-card work-card--pad">
            <WorkCheckRow tone="warn">They didn&apos;t send preferences, so any free place is fair.</WorkCheckRow>
          </div>
        )}

        <WorkSectionLabel as="h3">{`Move to, ${term.label}`}</WorkSectionLabel>
        <WorkCard>
          <div role="radiogroup" aria-label={`Rotation for ${person.name} in ${term.label}`}>
            {options.map((option) => {
              const tag = adminRankTag(option.rank);
              const checked = choice === option.rotation.id;
              return (
                <button
                  key={option.rotation.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={option.blocked !== null}
                  onClick={() => {
                    setChoice(option.rotation.id);
                    setProblem(null);
                  }}
                  className={cn("work-row", controlDisabled, checked && "bg-[color:var(--mode-identity-soft-2)]")}
                  data-testid={`rotation-round-adjust-option-${option.rotation.id}`}
                >
                  <RadioDot checked={checked} />
                  <span className="work-row__text">
                    <span className="work-row__title">{option.rotation.name}</span>
                    <span className="work-row__sub">{option.blocked ?? freeWords(option)}</span>
                  </span>
                  <span className="work-row__end">
                    <WorkTag tone={option.blocked ? "neutral" : tag.tone}>{tag.label}</WorkTag>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={choice === null}
              onClick={() => {
                setChoice(null);
                setProblem(null);
              }}
              className={cn("work-row", choice === null && "bg-[color:var(--mode-identity-soft-2)]")}
              data-testid="rotation-round-adjust-clear"
            >
              <RadioDot checked={choice === null} />
              <span className="work-row__text">
                <span className="work-row__title">Clear</span>
                <span className="work-row__sub">No rotation this term</span>
              </span>
            </button>
          </div>
        </WorkCard>

        <WorkCard>
          <div className="work-row">
            <span className="work-row__text">
              <span className="work-row__title" id="rotation-round-fix-label">
                <Lock aria-hidden="true" className="mr-1 inline size-icon-xs align-[-1px]" strokeWidth={2.2} />
                Fix this placement
              </span>
              <span className="work-row__sub">
                {choice === null ? "Choose a rotation to fix it" : "Kept when you run it again"}
              </span>
            </span>
            <Switch
              checked={choice !== null && fixed}
              onChange={setFixed}
              label="Fix this placement"
              disabled={choice === null}
            />
          </div>
        </WorkCard>
      </div>
    </Sheet>
  );
}

function RadioDot({ checked }: { readonly checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border-2",
        checked ? "border-[color:var(--mode-identity)]" : "border-[color:var(--work-line-strong)]",
      )}
    >
      {checked ? <span className="size-2.5 rounded-full bg-[color:var(--mode-identity)]" /> : null}
    </span>
  );
}
