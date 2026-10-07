"use client";

import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileText,
  KeyRound,
  Moon,
  ShieldAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { FIRST_WEEK_SECTION_ICONS, FirstWeekProgressStrip } from "@/components/on-call/first-week/first-week-pack-card";
import { flatQuietAction } from "@/components/on-call/flat-recipes";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import {
  WorkButton,
  WorkCard,
  WorkDock,
  WorkEmpty,
  WorkIconCircle,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { useRosterTeams } from "@/components/roster/use-roster-team";
import { cn } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import {
  firstWeekChangeSummary,
  firstWeekItemChanged,
  firstWeekItems,
  firstWeekLoginCounts,
  firstWeekSectionHref,
  firstWeekSectionStatus,
  formatFirstWeekDate,
  nextFirstWeekSection,
  FIRST_WEEK_HREF,
  FIRST_WEEK_SECTION_SHORT,
  type FirstWeekLogin,
  type FirstWeekLoginsState,
  type FirstWeekSection,
  type FirstWeekSectionId,
} from "@/lib/on-call/first-week-pack";
import { onCallLadderStepMarkId } from "@/lib/on-call/now-rows";
import { resolveHandbookPhone } from "@/lib/on-call/number-resolver";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";

/**
 * A labelled group: the kit's small-caps label over a hairline card of rows.
 * `dial` rows (the On Call dial row) draw their own inset hairlines, so the
 * card adds none between them.
 */
function Group({
  label,
  count,
  testId,
  dial = false,
  children,
}: {
  readonly label: string;
  readonly count?: number;
  readonly testId?: string;
  readonly dial?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-1.5" data-testid={testId}>
      <WorkSectionLabel count={count}>{label}</WorkSectionLabel>
      {dial ? (
        <WorkCard>
          <ul className="m-0 list-none p-0">{children}</ul>
        </WorkCard>
      ) : (
        <WorkCard as="ul">{children}</WorkCard>
      )}
    </section>
  );
}

function OrientationRows({
  items,
  readAt,
  now,
}: {
  readonly items: readonly HandbookItem[];
  readonly readAt: string | undefined;
  readonly now: Date;
}) {
  return (
    <>
      {items.map((item) => {
        const changed = firstWeekItemChanged(item, readAt);
        return (
          <li
            key={item.id}
            className={cn("grid min-w-0 gap-1 px-3 py-3", changed && "bg-[color:var(--mode-identity-soft)]")}
            data-testid={`on-call-first-week-item-${item.id}`}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                {item.parsed.label}
              </span>
              {changed ? <WorkTag>Changed</WorkTag> : null}
            </span>
            {item.body ? (
              <span className="whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--text)]">
                {item.body}
              </span>
            ) : null}
            <OnCallUpdatedLine
              updatedAt={item.updatedAt}
              lastConfirmedAt={item.lastConfirmedAt}
              sources={item.sources}
              now={now}
            />
          </li>
        );
      })}
    </>
  );
}

function NotWritten({ testId }: { readonly testId: string }) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={FileText}
        title="Not written by your hospital yet"
        body="This comes from your hospital's handbook. When your department publishes it, it shows here by itself."
        testId={testId}
      />
    </WorkCard>
  );
}

/** The roster login: a team you are in is ready; no team yet opens Join a team. */
function RosterLoginRow() {
  const teams = useRosterTeams();
  if (teams.status === "signed-out" || teams.status === "unavailable") return null;
  const enabled =
    teams.status === "ready" && Array.isArray(teams.data?.teams) ? teams.data.teams.filter((team) => team.enabled) : [];
  if (teams.status === "ready" && enabled.length > 0) {
    return (
      <li className="min-w-0">
        <WorkIconRow
          icon={CalendarDays}
          leadsTo="roster"
          title="Team roster"
          sub={enabled.map((team) => team.name).join(", ")}
          end={<WorkTag tone="green">Ready</WorkTag>}
          testId="on-call-first-week-roster-login"
        />
      </li>
    );
  }
  return (
    <li className="min-w-0">
      <WorkIconRow
        icon={CalendarDays}
        leadsTo="roster"
        title="Team roster"
        sub={
          teams.status === "loading"
            ? "Checking your teams"
            : teams.status === "ready"
              ? "Use the invite link your roster manager sent"
              : "Could not check your teams"
        }
        href="/roster/join"
        end={teams.status === "ready" ? <WorkTag>Join</WorkTag> : undefined}
        testId="on-call-first-week-roster-login"
      />
    </li>
  );
}

function LoginsBody({
  logins,
  state,
  onRetry,
}: {
  readonly logins: readonly FirstWeekLogin[];
  readonly state: FirstWeekLoginsState;
  readonly onRetry: () => void;
}) {
  const { ready, own } = firstWeekLoginCounts(logins);
  return (
    <>
      {state === "loading" ? <OnCallModuleSkeleton rows={3} eyebrow /> : null}
      {state === "failed" ? (
        <WorkCard padded>
          <div className="grid gap-2" role="alert" data-testid="on-call-first-week-logins-failed">
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">
              Your New job list could not be loaded
            </p>
            <p className="text-sm text-[color:var(--text-muted)]">It needs a connection. Nothing here is guessed.</p>
            <div>
              <WorkButton variant="secondary" onClick={onRetry}>
                Try again
              </WorkButton>
            </div>
          </div>
        </WorkCard>
      ) : null}
      {state === "signed-out" ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]">Sign in to see the logins you listed in New job.</p>
      ) : null}
      {state === "ready" && own > 0 ? (
        <WorkCard padded testId="on-call-first-week-logins-meter">
          <WorkSectionLabel as="p" count={<span className="nums">{`${ready} of ${own}`}</span>}>
            Ready for day one
          </WorkSectionLabel>
          <FirstWeekProgressStrip
            progress={{ read: ready, total: own, changed: 0 }}
            label="Logins ready"
            valueText={`${ready} of ${own} logins ready`}
            testId="on-call-first-week-logins-progress"
          />
        </WorkCard>
      ) : null}
      {state === "ready" && logins.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={KeyRound}
            title="No logins listed yet"
            body="Add the systems you will need in New job, then tick each one as it is set up."
            testId="on-call-first-week-logins-empty"
          />
        </WorkCard>
      ) : null}
      {state === "ready" ? (
        <section className="grid min-w-0 gap-1.5" data-testid="on-call-first-week-logins">
          <WorkSectionLabel>
            {own > 0 ? `Ready for day one · ${ready} of ${own}` : "From your service"}
          </WorkSectionLabel>
          <WorkCard as="ul">
            {logins.map((login) => (
              <li key={login.id} className="min-w-0" data-testid={`on-call-first-week-login-${login.id}`}>
                <WorkIconRow
                  icon={KeyRound}
                  tone={login.ready === null ? "neutral" : undefined}
                  title={login.title}
                  end={
                    login.ready === true ? (
                      <WorkTag tone="green">Ready</WorkTag>
                    ) : login.ready === false ? (
                      <WorkTag tone="amber">Not yet</WorkTag>
                    ) : (
                      <WorkTag tone="neutral">Guide</WorkTag>
                    )
                  }
                />
              </li>
            ))}
            <RosterLoginRow />
          </WorkCard>
        </section>
      ) : null}
      <WorkCard padded testId="on-call-first-week-no-passwords">
        <div className="flex items-start gap-3">
          <WorkIconCircle icon={ShieldAlert} tone="neutral" />
          <span className="grid min-w-0 gap-0.5">
            <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
              Never put a password here
            </span>
            <span className="text-sm text-[color:var(--text-muted)]">
              This list shows status only. PsychSift never asks for or keeps a password.
            </span>
          </span>
        </div>
      </WorkCard>
      <Link
        href="/admin/new-job"
        className={cn(flatQuietAction, focusRing)}
        data-testid="on-call-first-week-new-job-link"
      >
        Tick these off in New job
        <ChevronRight aria-hidden="true" className="size-icon-sm" />
      </Link>
    </>
  );
}

/** "1 thing changed since you read it", with when the hospital last changed it. */
function ChangedBanner({ count, latest }: { readonly count: number; readonly latest: string | null }) {
  return (
    <div
      className="flex items-start gap-3 rounded-[var(--work-radius-card,0.875rem)] border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] p-3"
      role="status"
      data-testid="on-call-first-week-changed"
    >
      <WorkIconCircle icon={Bell} />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-base-minus font-medium text-[color:var(--mode-identity)]">
          {count > 1 ? `${count} things changed since you read it` : "Changed since you read it"}
        </span>
        <span className="text-sm text-[color:var(--text)]">
          {latest
            ? `Your hospital updated this on ${formatFirstWeekDate(perthDateOf(latest)).replace(/ \d{4}$/, "")}. Changed items are marked.`
            : "Your hospital updated this section. Changed items are marked."}
        </span>
      </span>
    </div>
  );
}

/**
 * One section of "Your first week", read on its own: what the hospital
 * published, then Mark as read and the next section in a dock. Every number
 * dials through the On Call row, so it carries its updated line and sources.
 */
export function FirstWeekSectionView({
  section,
  items,
  siteId,
  hospitalName,
  handbookReady,
  handbookState,
  logins,
  loginsState,
  readAt,
  now,
  onMark,
  onRetryLogins,
}: {
  readonly section: FirstWeekSection;
  readonly items: readonly HandbookItem[];
  readonly siteId: string | null;
  readonly hospitalName: string | null;
  readonly handbookReady: boolean;
  /** The handbook's own state (sign in, loading, could not load), drawn when it is not ready. */
  readonly handbookState: ReactNode;
  readonly logins: readonly FirstWeekLogin[];
  readonly loginsState: FirstWeekLoginsState;
  readonly readAt: string | undefined;
  readonly now: Date;
  readonly onMark: (read: boolean) => void;
  readonly onRetryLogins: () => void;
}) {
  const id: FirstWeekSectionId = section.id;
  const Icon = FIRST_WEEK_SECTION_ICONS[id];
  const status = firstWeekSectionStatus(section, readAt);
  const next = nextFirstWeekSection(id);
  const rows = id === "logins" || !handbookReady ? [] : firstWeekItems(items, id, siteId);
  const canMark = id === "logins" ? loginsState === "ready" && logins.length > 0 : handbookReady && rows.length > 0;
  const change = status === "changed" ? firstWeekChangeSummary(rows, readAt) : null;

  let body: ReactNode;
  if (id === "logins") {
    body = <LoginsBody logins={logins} state={loginsState} onRetry={onRetryLogins} />;
  } else if (!handbookReady) {
    body = handbookState;
  } else if (id === "who") {
    body = (
      <>
        {rows.length === 0 ? (
          <NotWritten testId="on-call-first-week-empty-who" />
        ) : (
          <Group label="Roles at this hospital" count={rows.length} testId="on-call-first-week-who" dial>
            {rows.map((item) => (
              <OnCallDialRow
                key={item.id}
                id={item.id}
                source="handbook"
                title={item.parsed.label}
                subtitle={item.parsed.team ?? undefined}
                dial={item.dial}
                mobileDial={item.mobileDial}
                updatedAt={item.updatedAt}
                lastConfirmedAt={item.lastConfirmedAt}
                sources={item.sources}
                hospitalName={hospitalName}
                now={now}
                testId={`on-call-first-week-role-${item.id}`}
              />
            ))}
          </Group>
        )}
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={CalendarRange}
              title="Who is on each day"
              sub="Straight from your team roster"
              href="/on-call/whos-on/roster"
              testId="on-call-first-week-roster-link"
            />
          </li>
          <li className="min-w-0">
            <WorkIconRow
              icon={Users}
              title="What each role does"
              sub="Roles and acronyms"
              href="/on-call/who-is-who"
              testId="on-call-first-week-who-is-who-link"
            />
          </li>
        </WorkCard>
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          Names on shift come from the roster, so they are never copied into the pack.
        </p>
      </>
    );
  } else if (id === "escalate") {
    const emergency = rows.filter((item) => item.section !== "playbook");
    const ladders = rows.filter((item) => item.section === "playbook");
    body = (
      <>
        {rows.length === 0 ? <NotWritten testId="on-call-first-week-empty-escalate" /> : null}
        {ladders.map((item) => (
          <Group key={item.id} label={item.parsed.label} testId={`on-call-first-week-ladder-${item.id}`} dial>
            {[...(item.steps ?? [])]
              .sort((a, b) => a.order - b.order)
              .map((step) => (
                <OnCallDialRow
                  key={step.order}
                  id={onCallLadderStepMarkId(item.id, step.order)}
                  source="handbook"
                  leading={
                    <span className="nums grid size-7 place-items-center rounded-full border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-sm font-semibold text-[color:var(--mode-identity)]">
                      {step.order}
                    </span>
                  }
                  title={step.whoToCall}
                  subtitle={[
                    step.when,
                    step.hours === "in-hours" ? "In hours" : step.hours === "after-hours" ? "After hours" : null,
                    step.waitMinutes ? `Hospital-set wait ${step.waitMinutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  dial={step.phone ? resolveHandbookPhone(step.phone) : null}
                  updatedAt={item.updatedAt}
                  lastConfirmedAt={item.lastConfirmedAt}
                  sources={item.sources}
                  hospitalName={hospitalName}
                  now={now}
                  testId={`on-call-first-week-step-${item.id}-${step.order}`}
                />
              ))}
          </Group>
        ))}
        {emergency.length > 0 ? (
          <Group label="Emergency, any time" count={emergency.length} testId="on-call-first-week-emergency" dial>
            {emergency.map((item) => (
              <OnCallDialRow
                key={item.id}
                id={item.id}
                source="handbook"
                tone="emergency"
                title={item.parsed.label}
                dial={item.dial}
                mobileDial={item.mobileDial}
                updatedAt={item.updatedAt}
                lastConfirmedAt={item.lastConfirmedAt}
                sources={item.sources}
                hospitalName={hospitalName}
                now={now}
                testId={`on-call-first-week-emergency-${item.id}`}
              />
            ))}
          </Group>
        ) : null}
        <OnCallCrisisLines now={now} testId="on-call-first-week-crisis-lines" />
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          Written by your hospital. Every number comes from its handbook, so it stays current. Hospital emergency
          procedures always come first.
        </p>
      </>
    );
  } else if (id === "expect") {
    body = (
      <>
        {rows.length === 0 ? (
          <NotWritten testId="on-call-first-week-empty-expect" />
        ) : (
          <Group label="A normal week" count={rows.length} testId="on-call-first-week-expect">
            <OrientationRows items={rows} readAt={readAt} now={now} />
          </Group>
        )}
        <section className="grid min-w-0 gap-1.5" data-testid="on-call-first-week-hours">
          <WorkSectionLabel>Leave and hours</WorkSectionLabel>
          <WorkCard as="ul">
            <li className="min-w-0">
              <WorkIconRow
                icon={CalendarDays}
                leadsTo="roster"
                title="Leave requests"
                sub="In Roster, to your roster manager"
                href="/roster/requests"
                testId="on-call-first-week-leave-link"
              />
            </li>
            <li className="min-w-0">
              <WorkIconRow
                icon={FileText}
                leadsTo="my-day"
                title="Overtime and breaks"
                sub={<span className="font-medium text-[color:var(--mode-identity)]">Check your agreement</span>}
                href="/my-day/profile/agreement"
                testId="on-call-first-week-agreement-link"
              />
            </li>
          </WorkCard>
        </section>
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          Hours, overtime and breaks come from your agreement, not from this pack.
        </p>
      </>
    );
  } else {
    const before = rows.filter((item) => item.orientationPhase === "before_start");
    const onTheDay = rows.filter((item) => item.orientationPhase !== "before_start");
    body = (
      <>
        {rows.length === 0 ? <NotWritten testId="on-call-first-week-empty-first-day" /> : null}
        {before.length > 0 ? (
          <Group label="Before you start" count={before.length} testId="on-call-first-week-before">
            <OrientationRows items={before} readAt={readAt} now={now} />
          </Group>
        ) : null}
        {onTheDay.length > 0 ? (
          <Group label="On your first shift" count={onTheDay.length} testId="on-call-first-week-first-shift">
            <OrientationRows items={onTheDay} readAt={readAt} now={now} />
          </Group>
        ) : null}
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={Moon}
              title="First night"
              sub="Before, during, and if something goes wrong"
              href="/on-call/first-night"
              testId="on-call-first-week-first-night-link"
            />
          </li>
          <li className="min-w-0">
            <WorkIconRow
              icon={KeyRound}
              leadsTo="my-work"
              title="New job"
              sub="Your start date and checklist"
              href="/admin/new-job"
              testId="on-call-first-week-new-job-row"
            />
          </li>
        </WorkCard>
      </>
    );
  }

  return (
    <article
      className="grid min-w-0 gap-2.5"
      aria-labelledby="on-call-first-week-section-title"
      data-testid={`on-call-first-week-section-${id}`}
    >
      <Link
        href={FIRST_WEEK_HREF}
        className={cn(flatQuietAction, focusRing, "w-fit")}
        data-testid="on-call-first-week-back"
      >
        <ChevronLeft aria-hidden="true" className="size-icon-sm" />
        Your first week
      </Link>
      <div className="flex min-w-0 items-center gap-3 px-1">
        <WorkIconCircle icon={Icon} />
        <h1
          id="on-call-first-week-section-title"
          className="min-w-0 flex-1 break-words text-xl font-semibold text-[color:var(--text-heading)]"
        >
          {section.title}
        </h1>
        {status === "read" ? <WorkTag>Read</WorkTag> : null}
      </div>
      {change ? <ChangedBanner count={change.count} latest={change.latest} /> : null}
      {body}
      <div data-testid="on-call-first-week-actions">
        <WorkDock aria-label="Section actions">
          {canMark ? (
            status === "read" ? (
              <WorkButton variant="secondary" onClick={() => onMark(false)} testId="on-call-first-week-mark-unread">
                Mark as unread
              </WorkButton>
            ) : (
              <WorkButton onClick={() => onMark(true)} testId="on-call-first-week-mark-read">
                {status === "changed" ? "Mark as read again" : "Mark as read"}
              </WorkButton>
            )
          ) : null}
          <WorkButton
            variant={canMark ? "quiet" : "secondary"}
            href={next ? firstWeekSectionHref(next) : FIRST_WEEK_HREF}
            testId="on-call-first-week-next"
          >
            {next ? `Next: ${FIRST_WEEK_SECTION_SHORT[next]}` : "Done"}
          </WorkButton>
        </WorkDock>
      </div>
    </article>
  );
}
