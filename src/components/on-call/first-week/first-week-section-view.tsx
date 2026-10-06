"use client";

import { ChevronLeft, ChevronRight, KeyRound, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { FIRST_WEEK_SECTION_ICONS } from "@/components/on-call/first-week/first-week-pack-card";
import {
  flatCard,
  flatEyebrow,
  flatIconCircle,
  flatPrimaryButton,
  flatQuietAction,
  flatRow,
  flatSecondaryButton,
  flatTag,
} from "@/components/on-call/flat-recipes";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { cn } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import {
  firstWeekItems,
  firstWeekLoginCounts,
  firstWeekSectionHref,
  firstWeekSectionStatus,
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

function Group({
  eyebrow,
  count,
  testId,
  children,
}: {
  readonly eyebrow: string;
  readonly count?: number;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-1.5" data-testid={testId}>
      <h2 className={flatEyebrow}>
        {eyebrow}
        {count !== undefined ? <span className="nums">{` · ${count}`}</span> : null}
      </h2>
      <ul role="list" className={flatCard}>
        {children}
      </ul>
    </section>
  );
}

function changedSince(item: HandbookItem, readAt: string | undefined): boolean {
  return Boolean(readAt && item.updatedAt && Date.parse(item.updatedAt) > Date.parse(readAt));
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
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            flatRow,
            "items-start py-3",
            changedSince(item, readAt) && "bg-[color:var(--mode-identity-soft)]",
          )}
          data-testid={`on-call-first-week-item-${item.id}`}
        >
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                {item.parsed.label}
              </span>
              {changedSince(item, readAt) ? <span className={flatTag.mode}>Changed</span> : null}
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
          </span>
        </li>
      ))}
    </>
  );
}

function NotWritten({ testId }: { readonly testId: string }) {
  return (
    <div className={cn(flatCard, "grid gap-1 p-4")} data-testid={testId}>
      <p className="text-base-minus font-medium text-[color:var(--text-heading)]">Not written by your hospital yet</p>
      <p className="text-sm text-[color:var(--text-muted)]">
        This comes from your hospital&apos;s handbook. When your department publishes it, it shows here by itself.
      </p>
    </div>
  );
}

function LinkRow({ href, title, sub, testId }: { href: string; title: string; sub: string; testId: string }) {
  return (
    <li className={cn(flatRow, "p-0")}>
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          focusRing,
          "flex min-h-13 min-w-0 flex-1 items-center gap-3 px-3 py-2 no-underline active:bg-[color:var(--surface-wash)]",
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">{title}</span>
          <span className="text-sm leading-5 text-[color:var(--text-muted)]">{sub}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
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
        <div className={cn(flatCard, "grid gap-2 p-4")} role="alert" data-testid="on-call-first-week-logins-failed">
          <p className="text-base-minus font-medium text-[color:var(--text-heading)]">
            Your New job list could not be loaded
          </p>
          <p className="text-sm text-[color:var(--text-muted)]">It needs a connection. Nothing here is guessed.</p>
          <button type="button" onClick={onRetry} className={cn(flatSecondaryButton, focusRing, "w-fit")}>
            Try again
          </button>
        </div>
      ) : null}
      {state === "signed-out" ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]">Sign in to see the logins you listed in New job.</p>
      ) : null}
      {state === "ready" && logins.length === 0 ? (
        <div className={cn(flatCard, "grid gap-1 p-4")} data-testid="on-call-first-week-logins-empty">
          <p className="text-base-minus font-medium text-[color:var(--text-heading)]">No logins listed yet</p>
          <p className="text-sm text-[color:var(--text-muted)]">
            Add the systems you will need in New job, then tick each one as it is set up.
          </p>
        </div>
      ) : null}
      {state === "ready" && logins.length > 0 ? (
        <Group
          eyebrow={own > 0 ? `Ready for day one · ${ready} of ${own}` : "From your service"}
          testId="on-call-first-week-logins"
        >
          {logins.map((login) => (
            <li key={login.id} className={flatRow} data-testid={`on-call-first-week-login-${login.id}`}>
              <span className={flatIconCircle}>
                <KeyRound aria-hidden="true" className="size-icon-md" />
              </span>
              <span className="min-w-0 flex-1 break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                {login.title}
              </span>
              {login.ready === true ? (
                <span className={flatTag.mode}>Ready</span>
              ) : login.ready === false ? (
                <span className={flatTag.amber}>Not yet</span>
              ) : (
                <span className={flatTag.neutral}>Guide</span>
              )}
            </li>
          ))}
        </Group>
      ) : null}
      <div className={cn(flatCard, "flex items-start gap-3 p-3")} data-testid="on-call-first-week-no-passwords">
        <span className={flatIconCircle}>
          <ShieldAlert aria-hidden="true" className="size-icon-md" />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
            Never put a password here
          </span>
          <span className="text-sm text-[color:var(--text-muted)]">
            This list shows status only. PsychSift never asks for or keeps a password.
          </span>
        </span>
      </div>
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

/**
 * One section of "Your first week", read on its own: what the hospital
 * published, then Mark as read and the next section. Every number dials
 * through the On Call row, so it carries its updated line and sources.
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

  let body: ReactNode;
  if (id === "logins") {
    body = <LoginsBody logins={logins} state={loginsState} onRetry={onRetryLogins} />;
  } else if (!handbookReady) {
    body = handbookState;
  } else if (id === "who") {
    body =
      rows.length === 0 ? (
        <NotWritten testId="on-call-first-week-empty-who" />
      ) : (
        <Group eyebrow="Roles at this hospital" count={rows.length} testId="on-call-first-week-who">
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
      );
  } else if (id === "escalate") {
    const emergency = rows.filter((item) => item.section !== "playbook");
    const ladders = rows.filter((item) => item.section === "playbook");
    body = (
      <>
        {rows.length === 0 ? <NotWritten testId="on-call-first-week-empty-escalate" /> : null}
        {ladders.map((item) => (
          <Group key={item.id} eyebrow={item.parsed.label} testId={`on-call-first-week-ladder-${item.id}`}>
            {[...(item.steps ?? [])]
              .sort((a, b) => a.order - b.order)
              .map((step) => (
                <OnCallDialRow
                  key={step.order}
                  id={onCallLadderStepMarkId(item.id, step.order)}
                  source="handbook"
                  leading={
                    <span className="nums text-sm font-semibold text-[color:var(--mode-identity)]">{step.order}</span>
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
          <Group eyebrow="Emergency, any time" count={emergency.length} testId="on-call-first-week-emergency">
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
          Written by your hospital. Hospital emergency procedures always come first.
        </p>
      </>
    );
  } else {
    body = (
      <>
        {rows.length === 0 ? (
          <NotWritten testId={`on-call-first-week-empty-${id}`} />
        ) : (
          <Group
            eyebrow={id === "before" ? "Before day one" : "Your first shifts"}
            count={rows.length}
            testId={`on-call-first-week-${id}`}
          >
            <OrientationRows items={rows} readAt={readAt} now={now} />
          </Group>
        )}
      </>
    );
  }

  return (
    <article
      className="grid min-w-0 gap-4"
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
        <span className={flatIconCircle}>
          <Icon aria-hidden="true" className="size-icon-md" />
        </span>
        <h1
          id="on-call-first-week-section-title"
          className="min-w-0 flex-1 break-words text-xl font-semibold text-[color:var(--text-heading)]"
        >
          {section.title}
        </h1>
        {status === "read" ? <span className={flatTag.mode}>Read</span> : null}
      </div>
      {status === "changed" ? (
        <div
          className={cn(
            flatCard,
            "flex items-start gap-3 border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] p-3",
          )}
          role="status"
          data-testid="on-call-first-week-changed"
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="text-base-minus font-medium text-[color:var(--mode-identity)]">
              Changed since you read it
            </span>
            <span className="text-sm text-[color:var(--text)]">
              Your hospital updated this section. Changed items are marked.
            </span>
          </span>
        </div>
      ) : null}
      {body}
      <div className="grid gap-2 pt-1 sm:flex sm:flex-wrap" data-testid="on-call-first-week-actions">
        {canMark ? (
          status === "read" ? (
            <button
              type="button"
              onClick={() => onMark(false)}
              className={cn(flatSecondaryButton, focusRing)}
              data-testid="on-call-first-week-mark-unread"
            >
              Mark as unread
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onMark(true)}
              className={cn(flatPrimaryButton, focusRing)}
              data-testid="on-call-first-week-mark-read"
            >
              {status === "changed" ? "Mark as read again" : "Mark as read"}
            </button>
          )
        ) : null}
        <Link
          href={next ? firstWeekSectionHref(next) : FIRST_WEEK_HREF}
          className={cn(canMark ? flatQuietAction : flatSecondaryButton, focusRing, "justify-center")}
          data-testid="on-call-first-week-next"
        >
          {next ? `Next: ${FIRST_WEEK_SECTION_SHORT[next]}` : "Back to your first week"}
          {next ? <ChevronRight aria-hidden="true" className="size-icon-sm" /> : null}
        </Link>
      </div>
      {id === "who" && handbookReady ? (
        <ul role="list" className={flatCard}>
          <LinkRow
            href="/on-call/whos-on/roster"
            title="Who is on each day"
            sub="From your team roster"
            testId="on-call-first-week-roster-link"
          />
          <LinkRow
            href="/on-call/who-is-who"
            title="What each role does"
            sub="Roles and acronyms"
            testId="on-call-first-week-who-is-who-link"
          />
        </ul>
      ) : null}
      {id === "first-days" && handbookReady ? (
        <ul role="list" className={flatCard}>
          <LinkRow
            href="/on-call/first-night"
            title="First night"
            sub="Before, during, and if something goes wrong"
            testId="on-call-first-week-first-night-link"
          />
        </ul>
      ) : null}
    </article>
  );
}
