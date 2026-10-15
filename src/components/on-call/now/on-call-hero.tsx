"use client";

import { Phone } from "lucide-react";

import { WorkHero } from "@/components/mode-kit/work";
import { onCallShiftClock } from "@/components/on-call/now/shift-clock";
import { onCallCallRoute } from "@/components/on-call/kit/dial-sheet";
import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { rememberOnCallYouCalled } from "@/lib/on-call/call-marks";
import { ON_CALL_YOU_CALLED_ENABLED } from "@/lib/on-call/feature-flags";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { spokenOnCallNumber, type OnCallPeriod } from "@/lib/on-call/number-resolver";
import type { OnCallHospitalHours } from "@/lib/on-call/now-rows";
import { onCallCoverWindow, onCallDurationWords } from "@/lib/on-call/period-window";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";
import type { OnCallShiftContext } from "@/lib/on-call/shift-context";

/**
 * Now's summary card (Work standard, owner 15 Oct 2026): every Work page opens
 * with one filled mode-colour hero, its main action a white pill. On Call's
 * answers "how long have I got, and how do I reach switchboard?".
 *
 * Nothing here is new data: the time left is the reader's rostered shift (the
 * same clock as "Your shift"), the fallback is the hospital's own after-hours
 * window (as "Right now" reads it), and the number is the hospital's recorded
 * switchboard. With no switchboard recorded there is no pill, never an invented
 * number. While the handbook loads the pill's place is held, so nothing moves.
 */
export function NowOnCallHero({
  context,
  answer,
  hours,
  hospitalPeriod,
  hospitalName,
  handbookLoading,
  rosterLoading = false,
  now,
}: {
  readonly context: OnCallShiftContext;
  /** The hospital's switchboard row, or null when none is recorded. */
  readonly answer: HandbookItem | null;
  readonly hours: OnCallHospitalHours | null;
  readonly hospitalPeriod: OnCallPeriod | null;
  readonly hospitalName: string | null;
  readonly handbookLoading: boolean;
  readonly rosterLoading?: boolean;
  readonly now: Date;
}) {
  const hospitalPhone = useOnCallHospitalPhone();
  const clock = onCallShiftClock(context, now);
  const cover = clock ? null : onCallCoverWindow(hours, now);
  const periodLabel = hospitalPeriod ? (hospitalPeriod === "after-hours" ? "After hours" : "In hours") : null;
  const dial = answer && answer.dial.kind !== "none" ? answer.dial : null;
  const route = dial ? onCallCallRoute(dial, answer?.mobileDial, hospitalPhone) : null;
  // The line names the number the pill actually rings. A bare extension with no
  // mobile route can only be keyed from a hospital phone, so it says so.
  const switchboardLine = route
    ? `Switchboard ${route.display}`
    : dial?.kind === "extension"
      ? `Switchboard ${dial.display} from a hospital phone`
      : dial
        ? `Switchboard ${dial.display}`
        : null;

  const eyebrow = [clock ? "On call now" : "Right now", hospitalName].filter(Boolean).join(" · ");
  const title = clock
    ? `${onCallDurationWords(clock.minutesLeft)} left`
    : cover && periodLabel
      ? `${periodLabel} until ${cover.until}`
      : rosterLoading || handbookLoading
        ? "Checking your shift…"
        : "No rostered shift on now";
  const sub = [
    clock
      ? `${clock.periodLabel} shift ends ${clock.until}`
      : cover
        ? `${onCallDurationWords(cover.minutesLeft)} to go`
        : null,
    switchboardLine,
  ]
    .filter(Boolean)
    .join(" · ");

  const recordCall = () => {
    if (!answer) return;
    recordOnCallRecent({ id: answer.id, source: "handbook" });
    if (ON_CALL_YOU_CALLED_ENABLED) rememberOnCallYouCalled(answer.id);
  };

  const action =
    answer && route?.tel ? (
      <a
        href={route.tel}
        onClick={recordCall}
        aria-label={`Call switchboard, ${spokenOnCallNumber(route.display)}`}
        className="work-hero__action"
        data-testid="on-call-now-hero-call"
      >
        <Phone aria-hidden="true" strokeWidth={2} className="size-icon-sm shrink-0" />
        Call switchboard
      </a>
    ) : handbookLoading ? (
      <span aria-hidden="true" className="work-hero__action" data-placeholder="" />
    ) : null;

  return (
    <WorkHero
      testId="on-call-now-hero"
      aria-label="On call summary"
      eyebrow={eyebrow}
      title={<span className="nums">{title}</span>}
      sub={sub ? <span className="nums">{sub}</span> : null}
      footer={action ? <div className="work-hero__actions">{action}</div> : null}
    />
  );
}
