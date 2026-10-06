"use client";

import { Bell, BellOff, Info } from "lucide-react";

import type { PhoneAlerts } from "@/components/alerts/use-phone-alerts";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { modeModuleSurface, modeInsetHairline } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, ignoreUnavailableActivation } from "@/components/ui-primitives";
import { DEVICE_NAMES } from "@/lib/alerts/phone-state";

const PERTH_TIME = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "Sun 16:02", Perth time. */
function whenArrived(iso: string): string {
  const parts = PERTH_TIME.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")}`;
}

type Step = { readonly title: string; readonly detail: string };

const HOME_SCREEN_STEPS: readonly Step[] = [
  { title: "Tap Share in Safari", detail: "The square with an arrow, at the bottom" },
  { title: "Add to Home Screen", detail: "Then open PsychSift from the new icon" },
  { title: "Tap Allow", detail: "When the phone asks about notifications" },
];

const IPHONE_UNBLOCK_STEPS: readonly Step[] = [
  { title: "Open the Settings app", detail: "Not PsychSift" },
  { title: "Notifications, then PsychSift", detail: "Near the bottom of the list" },
  { title: "Turn on Allow Notifications", detail: "Then come back here" },
];

const BROWSER_UNBLOCK_STEPS: readonly Step[] = [
  { title: "Open this site's settings", detail: "The icon at the left of the address bar" },
  { title: "Find Notifications", detail: "It says Blocked or Don't allow" },
  { title: "Choose Allow", detail: "Then come back here and reload the page" },
];

/** Numbered steps in one card: the number in a small ring, never colour alone. */
function Steps({ steps, testId }: { readonly steps: readonly Step[]; readonly testId: string }) {
  return (
    <ol className={modeModuleSurface} data-testid={testId}>
      {steps.map((step, index) => (
        <li key={step.title} className={cn(modeInsetHairline, "flex min-h-13 items-center gap-3 px-3 py-1")}>
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full border border-[color:var(--border-strong)] text-xs font-semibold text-[color:var(--text-heading)]"
          >
            {index + 1}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className={cn(modeNameText, "text-base-minus leading-5 text-[color:var(--text-heading)]")}>
              <span className="sr-only">{`Step ${index + 1}: `}</span>
              {step.title}
            </span>
            <span className={cn(modeSecondaryText, "leading-5")}>{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A card that states a problem in words: neutral grey when nothing is wrong yet, amber when it is. */
function StateCard({
  tone,
  title,
  body,
  testId,
}: {
  readonly tone: "neutral" | "warning";
  readonly title: string;
  readonly body: string;
  readonly testId: string;
}) {
  const Icon = tone === "warning" ? BellOff : Bell;
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg border bg-[color:var(--surface-raised)] p-3",
        tone === "warning" ? "border-[color:var(--warning)]" : "border-[color:var(--border)]",
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.5}
        className={cn(
          "mt-0.5 size-icon-sm shrink-0",
          tone === "warning" ? "text-[color:var(--warning)]" : "text-[color:var(--text-muted)]",
        )}
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{title}</span>
        <span className="text-sm leading-5 text-[color:var(--text)]">{body}</span>
      </span>
    </div>
  );
}

function Footnote({ children, testId }: { readonly children: React.ReactNode; readonly testId?: string }) {
  return (
    <p className="flex items-start gap-2 px-3 text-sm leading-5 text-[color:var(--text-muted)]" data-testid={testId}>
      <Info aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-icon-sm shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The test button while it cannot work yet: reachable by keyboard, with its reason read out. */
function LockedTestButton({ reason }: { readonly reason: string }) {
  return (
    <>
      <Button
        variant="secondary"
        block
        aria-disabled="true"
        onClick={ignoreUnavailableActivation}
        aria-describedby="alerts-test-locked-reason"
        testId="alerts-test-locked"
      >
        Send test alert
      </Button>
      <span id="alerts-test-locked-reason" className="sr-only">
        {reason}
      </span>
    </>
  );
}

/**
 * "This phone" (or "This computer"): screens 8, 11 and 12, and the computer
 * view's shared-computer switch. Every state says what is true on THIS device
 * now; a check that failed says so and never reads as "off".
 */
export function AlertsDeviceSection({ alerts, shared }: { readonly alerts: PhoneAlerts; readonly shared: boolean }) {
  const device = DEVICE_NAMES[alerts.device];
  const eyebrow = alerts.device === "computer" ? "This computer" : "This phone";
  const sharedLabel = alerts.device === "computer" ? "This is a shared computer" : "This is a shared device";
  const state = alerts.state;

  const sharedRow = (
    <ModeRow
      title={sharedLabel}
      subtitle="Phone alerts and Remind me stay off here"
      testId="alerts-shared-device"
      trailing={
        <ToggleSwitch enabled={shared} onToggle={() => void alerts.setShared(!shared)} aria-label={sharedLabel} />
      }
    />
  );

  if (state === "needs-home-screen" || state === "blocked") {
    const blocked = state === "blocked";
    return (
      <section className="grid min-w-0 gap-3" aria-label={eyebrow} data-testid={`alerts-device-${state}`}>
        <h2 className={cn(eyebrowText, "px-3")}>{eyebrow}</h2>
        <StateCard
          tone={blocked ? "warning" : "neutral"}
          testId={`alerts-device-${state}-card`}
          title={blocked ? "Alerts are turned off for PsychSift" : `Alerts aren't set up on this ${device} yet`}
          body={
            blocked
              ? "Someone tapped Don't Allow, or they were switched off in the phone's settings. Only you can turn them back on."
              : "Apple only allows them once PsychSift is on your Home Screen."
          }
        />
        <Steps
          steps={
            blocked ? (alerts.device === "iphone" ? IPHONE_UNBLOCK_STEPS : BROWSER_UNBLOCK_STEPS) : HOME_SCREEN_STEPS
          }
          testId={`alerts-device-${state}-steps`}
        />
        <LockedTestButton reason={blocked ? "Turn alerts back on first" : "The test unlocks after step 3"} />
        {/* Remind me does not need phone alerts, so a shared device can always be marked as one. */}
        <ModeGroupedList testId="alerts-shared-list">{sharedRow}</ModeGroupedList>
        <Footnote>
          {blocked
            ? "Until then you won't get phone alerts, but everything still shows in My Day."
            : "Until then, everything still shows in My Day."}
        </Footnote>
      </section>
    );
  }

  const subtitle =
    state === "checking"
      ? `Checking this ${device}…`
      : state === "unconfigured"
        ? "Not available yet. Everything still shows in My Day."
        : state === "unsupported"
          ? "This browser can't show alerts"
          : state === "shared"
            ? `Off on this shared ${device}`
            : state === "error"
              ? "Couldn't be checked. Check your connection and try again."
              : state === "on"
                ? [
                    `On for this ${device}`,
                    alerts.lastTestArrivedAt ? `last test arrived ${whenArrived(alerts.lastTestArrivedAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : `Off on this ${device}`;

  return (
    <section className="grid min-w-0 gap-3" data-testid={`alerts-device-${state}`}>
      <ModeGroupedList eyebrow={eyebrow} testId="alerts-device">
        <ModeRow
          title="Phone alerts"
          subtitle={subtitle}
          testId="alerts-phone-row"
          trailing={
            state === "on" || state === "off" ? (
              <ToggleSwitch
                enabled={state === "on"}
                disabled={alerts.busy}
                onToggle={() => void alerts.toggle()}
                aria-label={`Phone alerts on this ${device}`}
              />
            ) : state === "error" ? (
              <Button variant="ghost" size="sm" onClick={alerts.retry} testId="alerts-retry">
                Try again
              </Button>
            ) : undefined
          }
        />
        {state === "on" ? (
          <ModeRow
            title="Send test alert"
            subtitle={
              alerts.testSentAt ? "Sent. It should arrive in a few seconds." : `Checks this ${device} gets them`
            }
            trailing={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void alerts.sendTest()}
                busy={alerts.busy}
                busyLabel="Sending…"
                testId="alerts-send-test"
              >
                Send test
              </Button>
            }
          />
        ) : null}
        {sharedRow}
      </ModeGroupedList>
      {alerts.message ? (
        <p role="status" className="px-3 text-sm text-[color:var(--text-muted)]" data-testid="alerts-device-message">
          {alerts.message}
        </p>
      ) : null}
      <Footnote testId="alerts-device-footnote">
        Settings follow your account. Phone alerts are switched on per device, and signing out here turns them off on
        this device.
      </Footnote>
    </section>
  );
}
