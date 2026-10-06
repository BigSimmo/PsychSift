"use client";

import { Check, CloudOff, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { focusRing } from "@/components/card-recipes";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { ON_CALL_HUB_PAGE_ICONS, type OnCallHubPage } from "@/components/on-call/on-call-section-identity";
import type {
  HospitalHandbookOption,
  HospitalHandbookState,
  HospitalHandbookStatus,
} from "@/components/on-call/use-hospital-handbook";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

const ON_CALL_SERVICE_HREF = "/on-call/service";

function SignInState({
  page,
  title,
  testId,
}: {
  readonly page: OnCallHubPage;
  readonly title: string;
  readonly testId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EmptyState
        icon={ON_CALL_HUB_PAGE_ICONS[page]}
        title={title}
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Sign in
          </Button>
        }
        testId={testId}
      />
      <AccountSetupDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The two states that need the reader to sign in: a title and the Sign in
 * action, nothing more (review S1). Keyed by status rather than switched on, so
 * a status name never reads as reader-facing prose to the wording guard
 * (`tests/on-call-hub-wording.test.ts`).
 */
const SIGN_IN_TITLES: Partial<Record<HospitalHandbookStatus, string>> = {
  "signed-out": "Hospital numbers are for signed-in members.",
  expired: "Your session ended. Sign in again to see your hospital's numbers.",
};

/**
 * What a hub page shows while the hospital handbook is not ready, in words that
 * say what the state means and what to do (amendment 1.6). `ready` renders
 * nothing: the page draws its own modules.
 *
 * Loading keeps the modules' space with static outlines, so nothing below moves
 * when the rows arrive. `unavailable` is its own wording rather than
 * `OnCallLoadFailed`, which speaks of "your On Call entries" and would name the
 * wrong thing here.
 */
export function OnCallHandbookState({
  handbook,
  page,
}: {
  readonly handbook: HospitalHandbookState;
  readonly page: OnCallHubPage;
}) {
  const testId = `on-call-handbook-state-${handbook.status}`;
  const signIn = SIGN_IN_TITLES[handbook.status];
  if (signIn) return <SignInState page={page} title={signIn} testId={testId} />;
  switch (handbook.status) {
    case "ready":
      return null;
    case "loading":
      return (
        <div className="grid min-w-0 gap-5" data-testid={testId}>
          <OnCallModuleSkeleton rows={2} eyebrow />
          <OnCallModuleSkeleton rows={4} twoLine eyebrow />
        </div>
      );
    case "no-service":
      return (
        <EmptyState
          icon={ON_CALL_HUB_PAGE_ICONS[page]}
          title="You are not in a hospital handbook yet."
          body="Ask your hospital's handbook admin for an invite."
          actions={
            <Link href={ON_CALL_SERVICE_HREF} className={cn(buttonFaceClass({ variant: "secondary" }), "no-underline")}>
              Manage service
            </Link>
          }
          testId={testId}
        />
      );
    case "unavailable":
      return (
        <EmptyState
          icon={CloudOff}
          title="Hospital numbers could not be loaded."
          body="Hospital numbers need a connection. If you cannot connect, use a hospital phone or ask the ward team for switchboard."
          actions={
            <Button type="button" variant="secondary" icon={RotateCw} onClick={handbook.retry}>
              Try again
            </Button>
          }
          testId={testId}
        />
      );
  }
  return null;
}

function optionKey(option: HospitalHandbookOption): string {
  return `${option.serviceId}:${option.siteId ?? ""}`;
}

/**
 * The hospitals a reader can change to, as a listbox of rows with a check on
 * the current one (a ruling: a segmented control cannot hold hospital names
 * at phone width). Names are text only (owner Q6). Renders nothing when there
 * is no choice to make.
 *
 * The options are the listbox's direct children (review S6), with one tab
 * stop. Arrow keys, Home and End move focus; Space, Enter or a tap chooses.
 * It is a listbox rather than a radio group because moving must not choose:
 * the repo's radio groups select on arrow (segmented-control.tsx), and a choice
 * here reloads the page's numbers and closes the sheet the list sits in.
 */
export function OnCallHospitalChooser({
  handbook,
  onChosen,
  testId = "on-call-hospital-chooser",
}: {
  readonly handbook: HospitalHandbookState;
  /** Called after a choice, e.g. to close the sheet the list sits in. */
  readonly onChosen?: () => void;
  readonly testId?: string;
}) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const options = useRef(new Map<string, HTMLButtonElement>());
  if (handbook.hospitals.length < 2) return null;
  const keys = handbook.hospitals.map(optionKey);
  const tabStop = keys.includes(focusKey ?? "")
    ? focusKey
    : keys.includes(handbook.hospitalKey ?? "")
      ? handbook.hospitalKey
      : keys[0];

  const moveFocus = (from: string, key: string) => {
    const index = keys.indexOf(from);
    const last = keys.length - 1;
    const target =
      key === "ArrowDown" || key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : key === "ArrowUp" || key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : key === "Home"
            ? 0
            : key === "End"
              ? last
              : null;
    if (target === null) return false;
    const next = keys[target];
    if (next === undefined) return false;
    setFocusKey(next);
    options.current.get(next)?.focus();
    return true;
  };

  return (
    <div role="listbox" aria-label="Hospital" className={modeModuleSurface} data-testid={testId}>
      {handbook.hospitals.map((option) => {
        const key = optionKey(option);
        const selected = key === handbook.hospitalKey;
        const name = option.siteName ?? option.serviceName;
        const detail = option.siteName ? option.serviceName : null;
        return (
          <button
            key={key}
            ref={(node) => {
              if (node) options.current.set(key, node);
              else options.current.delete(key);
            }}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={key === tabStop ? 0 : -1}
            onFocus={() => setFocusKey(key)}
            onKeyDown={(event) => {
              if (moveFocus(key, event.key)) event.preventDefault();
            }}
            onClick={() => {
              handbook.changeHospital(option.serviceId, option.siteId);
              onChosen?.();
            }}
            className={cn(
              modeInsetHairline,
              focusRing,
              modePressable,
              detail ? modeRowHeight.double : modeRowHeight.single,
              "flex w-full min-w-0 items-center gap-3 px-3 text-left",
            )}
          >
            <span className="grid min-w-0 flex-1 content-center gap-0.5">
              <span className={cn(modeNameText, "break-words text-base-minus text-[color:var(--text-heading)]")}>
                {name}
              </span>
              {detail ? <span className={cn(modeSecondaryText, "break-words")}>{detail}</span> : null}
            </span>
            {selected ? (
              <Check
                aria-hidden="true"
                strokeWidth={2}
                className="size-icon-lg shrink-0 text-[color:var(--clinical-accent)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
