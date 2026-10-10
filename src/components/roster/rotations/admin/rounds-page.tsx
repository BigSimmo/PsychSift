"use client";

import {
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  FilePen,
  Layers,
  Lock,
  Plus,
  RotateCcw,
  Sparkles,
  Users,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";

import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { useOnline } from "@/components/needs-you/use-notification-feed";
import { RosterSignInNotice } from "@/components/roster/invite/roster-sign-in-notice";
import { useRosterNow } from "@/components/roster/roster-format";
import { ROTATIONS_HREF } from "@/components/roster/rotations/rotation-format";
import { useRotations, type RotationsRead } from "@/components/roster/rotations/use-rotations";
import { useExampleData } from "@/lib/example-data/store";
import type { ManagedRound } from "@/lib/roster/rotations/model";

import {
  groupRounds,
  initials,
  manageRoundHref,
  NEW_ROUND_HREF,
  plural,
  roundLine,
  roundStatusTag,
  type RoundGroupId,
} from "./round-admin-model";

/**
 * Roster · Manage team · Rotations (`/roster/manage/rotations`, mockup
 * `S.rounds`): the rotation rounds a roster manager runs for their team, by
 * what needs them first. Open rounds collect preferences, rounds to review
 * hold an allocation not yet published, drafts are not yet sent to anyone.
 */

const GROUP_ICON: Record<RoundGroupId, typeof Layers> = {
  open: Layers,
  review: Sparkles,
  drafts: FilePen,
  published: CheckCircle2,
};

export function RotationRoundsPage() {
  const read = useRotations();
  const now = useRosterNow();
  const people = read.managed[0]?.round.people.length;
  useModeBandHeading({
    eyebrow:
      read.teams.length > 1
        ? `${read.teams.length} teams`
        : read.team
          ? people
            ? `${read.team.name} · ${plural(people, "person", "people")}`
            : read.team.name
          : "Manage team",
    title: "Rotation rounds",
  });
  return (
    <main className="min-w-0">
      <WorkBody testId="rotation-rounds">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Rotation rounds
        </PageTitleUnderBand>
        <RotationsAdminGate read={read} what="rotation rounds">
          <RoundsList rounds={read.managed} now={now} canStart={read.teams.length > 0} />
        </RotationsAdminGate>
      </WorkBody>
    </main>
  );
}

/** People and roles, where the site administrator gives someone a team role. */
const PEOPLE_AND_ROLES_HREF = "/admin/people";

/**
 * Someone who may manage rounds but has no team to start one for. Only the site administrator gets
 * here: everyone else who can manage holds a role for at least one team.
 */
export function RotationNoTeam() {
  return (
    <WorkCard testId="rotation-no-team">
      <WorkEmpty
        icon={Users}
        title="No team to run a round for"
        body="A round belongs to a team, and you aren't in one. Join a team in Roster, or give someone a team role in People and roles."
        action={
          <WorkButton variant="secondary" href={PEOPLE_AND_ROLES_HREF} testId="rotation-no-team-people">
            People and roles
          </WorkButton>
        }
      />
    </WorkCard>
  );
}

function RoundsList({
  rounds,
  now,
  canStart,
}: {
  readonly rounds: readonly ManagedRound[];
  readonly now: Date;
  /** False when there is no team to start a round for, so New round would lead nowhere. */
  readonly canStart: boolean;
}) {
  const groups = groupRounds(rounds);
  if (groups.length === 0) {
    if (!canStart) return <RotationNoTeam />;
    return (
      <WorkCard testId="rotation-rounds-empty">
        <WorkEmpty
          icon={CalendarRange}
          title="No rotation rounds yet"
          body="Set out the terms and rotations for the year, then ask your team to rank them."
          action={
            <WorkButton icon={Plus} href={NEW_ROUND_HREF} testId="rotation-rounds-new-empty">
              New round
            </WorkButton>
          }
        />
      </WorkCard>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`rotation-rounds-${group.id}`} className="grid min-w-0 gap-2.25">
          <WorkSectionLabel
            id={`rotation-rounds-${group.id}`}
            count={group.rounds.length > 1 ? group.rounds.length : undefined}
          >
            {group.label}
          </WorkSectionLabel>
          <WorkCard testId={`rotation-rounds-group-${group.id}`}>
            {group.rounds.map((managed) => {
              const tag = roundStatusTag(managed);
              return (
                <WorkIconRow
                  key={managed.round.id}
                  icon={GROUP_ICON[group.id]}
                  tone={group.id === "published" ? "green" : group.id === "drafts" ? "neutral" : undefined}
                  title={managed.round.name}
                  sub={roundLine(managed, now)}
                  end={<WorkTag tone={tag.tone}>{tag.label}</WorkTag>}
                  href={manageRoundHref(managed.round.id)}
                  testId={`rotation-round-row-${managed.round.id}`}
                />
              );
            })}
          </WorkCard>
        </section>
      ))}
      {canStart ? (
        <div className="grid grid-cols-1 pt-1">
          <WorkButton icon={Plus} size="wide" href={NEW_ROUND_HREF} testId="rotation-rounds-new">
            New round
          </WorkButton>
        </div>
      ) : (
        <RotationNoTeam />
      )}
    </>
  );
}

/**
 * Every administrator screen's states before its content: offline, loading,
 * error, signed out, not live yet for real teams, and not a roster manager.
 * Each says what is wrong in one line and offers the one way on.
 */
export function RotationsAdminGate({
  read,
  what,
  children,
}: {
  readonly read: RotationsRead;
  /** "rotation rounds", for the sentences. */
  readonly what: string;
  readonly children: ReactNode;
}) {
  const online = useOnline();
  const example = useExampleData("rost");

  if (read.status === "ready" && !read.canManage) {
    return (
      <WorkCard testId="rotations-admin-not-manager">
        <WorkEmpty
          icon={Lock}
          title="For roster managers"
          body="Rotation rounds are run by your team's roster manager or Medical Workforce. You can rank your own rotations in Roster."
          action={
            <WorkButton variant="secondary" href={ROTATIONS_HREF} testId="rotations-admin-your-rotations">
              Your rotations
            </WorkButton>
          }
        />
      </WorkCard>
    );
  }
  if (read.status === "ready") return <>{children}</>;
  if (!online && read.source === "live") {
    return (
      <WorkCard testId="rotations-admin-offline">
        <WorkEmpty
          icon={WifiOff}
          title="You're offline"
          body={`Your ${what} need a connection. Try again when you're back online.`}
          action={
            <WorkButton
              variant="secondary"
              icon={RotateCcw}
              onClick={read.retry}
              testId="rotations-admin-offline-retry"
            >
              Try again
            </WorkButton>
          }
        />
      </WorkCard>
    );
  }
  if (read.status === "loading") {
    return <ModeModuleSkeleton rows={3} twoLine eyebrow testId="rotations-admin-loading" />;
  }
  if (read.status === "signed-out") {
    return (
      <RosterSignInNotice testId="rotations-admin-signed-out" onSignedIn={read.retry}>
        Sign in to run rotation rounds.
      </RosterSignInNotice>
    );
  }
  if (read.status === "unavailable") {
    return (
      <WorkCard testId="rotations-admin-unavailable">
        <WorkEmpty
          icon={Layers}
          title="Rotations aren't live for real teams yet"
          body="You can try every step with example data: set up a round, allocate it and publish. Nothing reaches a real team."
          action={
            <div className="grid w-full grid-cols-1 gap-2">
              <WorkButton icon={Sparkles} onClick={example.turnOn} testId="rotations-admin-show-example">
                Show the example
              </WorkButton>
              <WorkButton variant="quiet" href="/roster/manage" testId="rotations-admin-back-manage">
                Back to Manage team
              </WorkButton>
            </div>
          }
        />
      </WorkCard>
    );
  }
  return (
    <WorkCard testId="rotations-admin-error">
      <WorkEmpty
        icon={RotateCcw}
        title="Rotations didn't load"
        body="Check your connection, then try again."
        action={
          <WorkButton variant="secondary" icon={RotateCcw} onClick={read.retry} testId="rotations-admin-retry">
            Try again
          </WorkButton>
        }
      />
    </WorkCard>
  );
}

/** A person's initials in a soft disc, in the area's colour. */
export function RotationAvatar({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft-2)] text-xs font-bold text-[color:var(--mode-identity-deep)]"
    >
      {initials(name)}
    </span>
  );
}

/**
 * The mockup's person row: initials, a name over a short line, and an end.
 * With `onClick` the whole row is the button (and the end must hold no other
 * control); without it, the end may hold its own button.
 */
export function AvatarRow({
  name,
  sub,
  end,
  onClick,
  testId,
  accessibleName,
}: {
  readonly name: string;
  readonly sub?: ReactNode;
  readonly end?: ReactNode;
  readonly onClick?: () => void;
  readonly testId?: string;
  /** Spoken in place of the row's text when tappable, e.g. "Amira Lowe, Term 1, 1st choice. Adjust". */
  readonly accessibleName?: string;
}) {
  const content = (
    <>
      <RotationAvatar name={name} />
      <span className="work-row__text">
        <span className="work-row__title">{name}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
      {end !== undefined ? <span className="work-row__end">{end}</span> : null}
      {onClick ? <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} /> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="work-row" onClick={onClick} aria-label={accessibleName} data-testid={testId}>
        {content}
      </button>
    );
  }
  return (
    <div className="work-row" data-testid={testId}>
      {content}
    </div>
  );
}
