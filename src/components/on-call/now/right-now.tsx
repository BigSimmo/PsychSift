"use client";

import { Clock, Phone } from "lucide-react";
import { useId, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallTrackBar } from "@/components/on-call/kit/track-bar";
import { onCallOutlineButton } from "@/components/on-call/kit/calm";
import { OnCallDialSheet, onCallCallRoute } from "@/components/on-call/kit/dial-sheet";
import { OnCallGroupActionControl } from "@/components/on-call/kit/grouped-list";
import { OnCallStateLabel } from "@/components/on-call/kit/state-label";
import { useOnCallYouCalledAt } from "@/components/on-call/kit/use-you-called";
import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { modeHeadingText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { rememberOnCallYouCalled } from "@/lib/on-call/call-marks";
import { formatOnCallTime } from "@/lib/on-call/display-dates";
import { ON_CALL_YOU_CALLED_ENABLED } from "@/lib/on-call/feature-flags";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { spokenOnCallNumber, type OnCallPeriod } from "@/lib/on-call/number-resolver";
import type { OnCallHospitalHours } from "@/lib/on-call/now-rows";
import { onCallCoverWindow, onCallDurationWords } from "@/lib/on-call/period-window";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";

/**
 * "Right now" (mock-up v10 Now): who covers this hour, flat on the page.
 *
 * The eyebrow names the hospital's period ("Right now · After hours") with
 * "All roles" at its right; the role is the large line, then "Until 08:00 ·
 * 10 h 20 min to go", the number with an outlined Call button, and a thin track
 * from the period's start to its end with a dot for now. Under the track,
 * "Cover as of 21:40, from the hospital's handbook".
 *
 * The period, the until line and the track come only from the hospital's own
 * after-hours times (a Stage B field). Until a hospital sets them, none of the
 * three is drawn and the answer is the switchboard, as before.
 */
export function NowRightNow({
  status,
  answer,
  hours,
  hospitalPeriod,
  hospitalName,
  now,
}: {
  readonly status: "loading" | "ready";
  /** The row that answers "who do I ring now?", or null when the hospital has not recorded one. */
  readonly answer: HandbookItem | null;
  readonly hours: OnCallHospitalHours | null;
  readonly hospitalPeriod: OnCallPeriod | null;
  readonly hospitalName: string | null;
  readonly now: Date;
}) {
  const headingId = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const hospitalPhone = useOnCallHospitalPhone();
  const calledAt = useOnCallYouCalledAt(answer?.id ?? "");
  const cover = onCallCoverWindow(hours, now);
  const afterHours = hospitalPeriod === "after-hours";
  const periodLabel = hospitalPeriod ? (afterHours ? "After hours" : "In hours") : null;
  const dial = answer && answer.dial.kind !== "none" ? answer.dial : null;
  const route = dial ? onCallCallRoute(dial, answer?.mobileDial, hospitalPhone) : null;
  const title = answer?.parsed.label ?? "Switchboard";

  const recordCall = () => {
    if (!answer) return;
    recordOnCallRecent({ id: answer.id, source: "handbook" });
    if (ON_CALL_YOU_CALLED_ENABLED) rememberOnCallYouCalled(answer.id);
  };

  return (
    <section aria-labelledby={headingId} data-testid="on-call-now-right-now" className="grid min-w-0 gap-2 px-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3">
        <h2 id={headingId} className={eyebrowText}>
          {periodLabel ? `Right now · ${periodLabel}` : "Right now"}
        </h2>
        {/* A literal href: the route-reachability guard reads literal hrefs only. */}
        <OnCallGroupActionControl
          action={{ label: "All roles", href: "/on-call/call", testId: "on-call-now-all-roles" }}
        />
      </div>

      {status === "loading" ? (
        <div aria-hidden="true" data-testid="on-call-now-right-now-outline" className="grid gap-2 py-1">
          <span className="h-5 w-3/5 rounded-sm bg-[color:var(--surface-subtle)]" />
          <span className="h-3 w-2/5 rounded-sm bg-[color:var(--surface-subtle)]" />
          <span className="h-12 w-full rounded-sm bg-[color:var(--surface-subtle)]" />
        </div>
      ) : (
        <>
          <div className="grid min-w-0 gap-1">
            <p className={cn(modeHeadingText, "break-words text-xl leading-7 text-[color:var(--text-heading)]")}>
              {title}
            </p>
            {cover ? (
              <p
                className={cn(modeNumberText, "flex items-center gap-1.5 text-sm text-[color:var(--text-muted)]")}
                data-testid="on-call-now-right-now-until"
              >
                <Clock aria-hidden="true" strokeWidth={1.5} className="size-icon-xs shrink-0" />
                <span>
                  <span className="font-semibold text-[color:var(--text)]">{`Until ${cover.until}`}</span>
                  {` · ${onCallDurationWords(cover.minutesLeft)} to go`}
                </span>
              </p>
            ) : null}
          </div>

          {answer && dial ? (
            <div
              className="flex min-w-0 items-center justify-between gap-3 border-t border-[color:var(--border)] pt-2"
              data-testid={`on-call-now-right-now-${answer.id}`}
            >
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`${dial.display}. Dialling details for ${title}`}
                onClick={() => setSheetOpen(true)}
                className={cn(focusRing, "grid min-h-12 min-w-0 content-center rounded-md text-left")}
              >
                <span className={cn(modeNumberText, "text-lg-minus font-medium text-[color:var(--text-heading)]")}>
                  {dial.display}
                </span>
                {dial.route === "hospital-phone" || calledAt ? (
                  <span className={modeSecondaryText}>
                    {[
                      dial.route === "hospital-phone" ? "From a hospital phone" : null,
                      calledAt ? `You called ${formatOnCallTime(calledAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </button>
              {route?.tel ? (
                <a
                  href={route.tel}
                  onClick={recordCall}
                  aria-label={`Call ${title}, ${spokenOnCallNumber(route.display)}`}
                  className={cn(onCallOutlineButton, focusRing, "shrink-0")}
                >
                  <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
                  Call
                </a>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-[color:var(--border)] pt-2" data-testid="on-call-now-right-now-not-set-up">
              <OnCallStateLabel state={{ kind: "not-set-up" }} />
            </p>
          )}

          {cover ? (
            <div className="grid gap-1" data-testid="on-call-now-right-now-track">
              <div aria-hidden="true" className="relative h-3">
                <OnCallTrackBar percent={cover.progress} className="absolute inset-x-0 top-1" />
                <span
                  className="absolute top-0 size-3 -translate-x-1/2 rounded-full border-2 border-[color:var(--mode-identity)] bg-[color:var(--surface)]"
                  style={{ left: `${cover.progress}%` }}
                />
              </div>
              <p className={cn(modeNumberText, "relative h-4 text-xs font-semibold text-[color:var(--text)]")}>
                <span className="absolute left-0">{cover.from}</span>
                {/* "Now" sits under the dot, kept clear of both ends. */}
                <span
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `clamp(4.5rem, ${cover.progress}%, calc(100% - 4.5rem))` }}
                >
                  {`Now ${cover.nowTime}`}
                </span>
                <span className="absolute right-0">{cover.until}</span>
              </p>
              <p className={cn(modeSecondaryText, "text-xs")}>
                {`Cover as of ${cover.nowTime}, from the hospital's handbook`}
              </p>
            </div>
          ) : null}
        </>
      )}

      {answer && dial ? (
        <OnCallDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={title}
          hospitalName={hospitalName}
          dial={dial}
          mobileDial={answer.mobileDial}
          updatedAt={answer.updatedAt}
          sources={answer.sources}
          now={now}
          onCall={recordCall}
          hospitalPhone={hospitalPhone}
          testId={`on-call-now-right-now-${answer.id}-sheet`}
        />
      ) : null}
    </section>
  );
}
