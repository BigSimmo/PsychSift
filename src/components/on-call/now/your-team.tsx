"use client";

import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallActionLink, onCallBadge } from "@/components/on-call/kit/calm";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { onCallRoleBadge } from "@/components/on-call/kit/role-badge";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { ON_CALL_WHOS_ON_ENABLED } from "@/lib/on-call/feature-flags";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import type { OnCallTeam } from "@/lib/on-call/handbook-title";
import { saveOnCallMyTeam } from "@/lib/on-call/my-team-storage";
import { ON_CALL_AFTER_HOURS_MANAGER, ON_CALL_TEAM_ROW_LIMIT } from "@/lib/on-call/now-rows";

/** The team chooser: every team the handbook names, then "No team". 52px rows, a check on the current one. */
function TeamChooser({
  teams,
  myTeam,
  onChosen,
}: {
  readonly teams: readonly OnCallTeam[];
  readonly myTeam: OnCallTeam | null;
  readonly onChosen: () => void;
}) {
  const options: { readonly team: OnCallTeam | null; readonly label: string }[] = [
    ...teams.filter((team) => team !== ON_CALL_AFTER_HOURS_MANAGER).map((team) => ({ team, label: team })),
    { team: null, label: "No team" },
  ];
  return (
    <ul role="list" className={modeModuleSurface}>
      {options.map((option) => {
        const current = option.team === myTeam;
        return (
          <li key={option.label} className={modeInsetHairline}>
            <button
              type="button"
              aria-pressed={current}
              onClick={() => {
                saveOnCallMyTeam(option.team);
                onChosen();
              }}
              className={cn(
                modeRowHeight.double,
                modePressable,
                focusRing,
                "flex w-full min-w-0 items-center gap-3 px-3 text-left",
              )}
            >
              <span
                className={cn(
                  modeNameText,
                  "min-w-0 flex-1 break-words text-base-minus text-[color:var(--text-heading)]",
                )}
              >
                {option.label}
              </span>
              {current ? (
                <Check
                  aria-hidden="true"
                  strokeWidth={2}
                  className="size-icon-lg shrink-0 text-[color:var(--primary)]"
                />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Also on tonight" (mock-up v10 Now; was "Your team"): three roles from the reader's own team, chosen once and
 * kept on this device. Roles only; the handbook holds no names.
 *
 * With no team chosen and no rows, the module is one "Choose your team" row.
 * While the hospital loads it keeps the space of three rows when a team is
 * chosen, so it never grows under the thumb. The "Everyone on" link to Who's
 * on appears only while `ON_CALL_WHOS_ON_ENABLED` is on.
 */
export function NowYourTeam({
  status,
  rows,
  teams,
  myTeam,
  hospitalName,
  now,
}: {
  readonly status: "loading" | "ready";
  readonly rows: readonly HandbookItem[];
  readonly teams: readonly OnCallTeam[];
  readonly myTeam: OnCallTeam | null;
  readonly hospitalName: string | null;
  readonly now: Date;
}) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  if (status === "loading") {
    return myTeam ? (
      <OnCallModuleSkeleton rows={ON_CALL_TEAM_ROW_LIMIT} eyebrow testId="on-call-now-team-outlines" />
    ) : null;
  }
  const chooser = (
    <Sheet open={open} onClose={() => setOpen(false)} title="Choose your team" testId="on-call-now-team-chooser">
      <div data-mode-identity="on-call" className="min-w-0">
        <TeamChooser teams={teams} myTeam={myTeam} onChosen={() => setOpen(false)} />
      </div>
    </Sheet>
  );
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-1" data-testid="on-call-now-team">
      <div className="flex min-h-12 min-w-0 items-center justify-between gap-2 px-1">
        <h2 id={headingId} className={cn(eyebrowText, "min-w-0 break-words")}>
          Also on tonight
        </h2>
        {ON_CALL_WHOS_ON_ENABLED ? (
          <Link href="/on-call/whos-on" className={cn(onCallActionLink, focusRing)}>
            Everyone on
          </Link>
        ) : null}
      </div>
      <ul role="list" className="work-card min-w-0">
        {rows.length > 0 ? (
          rows.map((item) => {
            const badge = onCallRoleBadge(item.parsed.label);
            return (
              <OnCallDialRow
                key={item.id}
                id={item.id}
                source="handbook"
                title={item.parsed.label}
                subtitle={item.parsed.team === myTeam ? undefined : (item.parsed.team ?? undefined)}
                leading={badge ? <span className={onCallBadge}>{badge}</span> : undefined}
                dial={item.dial}
                mobileDial={item.mobileDial}
                updatedAt={item.updatedAt}
                lastConfirmedAt={item.lastConfirmedAt}
                sources={item.sources}
                hospitalName={hospitalName}
                now={now}
                testId={`on-call-now-team-${item.id}`}
              />
            );
          })
        ) : (
          <li className={modeInsetHairline}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
              data-testid="on-call-now-team-choose"
              className={cn(
                modeRowHeight.single,
                modePressable,
                focusRing,
                "flex w-full min-w-0 items-center gap-3 px-3 text-left",
              )}
            >
              <span
                className={cn(
                  modeNameText,
                  "min-w-0 flex-1 break-words text-base-minus text-[color:var(--text-heading)]",
                )}
              >
                {myTeam ? `Not set up for this hospital` : "Choose your team"}
              </span>
              <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </button>
          </li>
        )}
      </ul>
      {rows.length > 0 || myTeam ? (
        <p className={cn(modeSecondaryText, "flex min-w-0 flex-wrap items-center gap-x-2 px-1")}>
          <span className="min-w-0 break-words">{myTeam ? `Your team: ${myTeam}` : "No team chosen"}</span>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            data-testid="on-call-now-team-change"
            className={cn(onCallActionLink, focusRing)}
          >
            Change team
          </button>
        </p>
      ) : null}
      {chooser}
    </section>
  );
}
