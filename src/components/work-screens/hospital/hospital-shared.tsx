"use client";

import { Building2, CloudOff, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { useSignedOut } from "@/components/mode-kit/use-signed-out-sample";
import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { usePaperworkHeading } from "@/components/work-screens/admin/paperwork-shared";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { useExampleData } from "@/lib/example-data/store";
import { useOnlineStatus } from "@/lib/use-online-status";
import { fetchHospitalSick, type HospitalSickOutcome } from "@/lib/work-roles/hospital-client";
import { HOSPITAL_HUB_HREF, type HospitalRef } from "@/lib/work-roles/hospital-hub";
import { fetchWorkPeople } from "@/lib/work-roles/people-client";
import { resetWorkRoles, useWorkRoles, type WorkRolesView } from "@/lib/work-roles/use-work-roles";

/**
 * What the Hospital screens share: the band heading, the example data choice,
 * the reads (the administrator's hospital list, one hospital's sick calls) and
 * the states every screen draws the same way.
 */

/** The band's title with the hospital's name above it, and the page's own heading for readers without a band. */
export function HospitalHeading({ title, eyebrow }: { readonly title: string; readonly eyebrow?: string | null }) {
  usePaperworkHeading(title, eyebrow ?? undefined);
  return (
    <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">{title}</PageTitleUnderBand>
  );
}

export type HospitalScreenState = {
  readonly roles: WorkRolesView;
  readonly signedOut: boolean;
  /** Admin's example data is on (explicitly, or signed out in auto mode), so the screen shows example records. */
  readonly showExample: boolean;
  readonly turnOnExample: () => void;
  readonly online: boolean;
};

/** The choice every Hospital screen makes first: example records, signed out, or the person's own roles. */
export function useHospitalScreenState(): HospitalScreenState {
  const roles = useWorkRoles();
  const authSignedOut = useSignedOut();
  const example = useExampleData("admin");
  const online = useOnlineStatus();
  const signedOut = authSignedOut || roles.status === "signed-out";
  return {
    roles,
    signedOut,
    showExample: example.active && (example.mode === "on" || signedOut),
    turnOnExample: example.turnOn,
    online,
  };
}

/* ----------------------------------------------------------------- reads */

export type AdminHospitalList =
  | { readonly status: "off" | "loading" }
  | { readonly status: "ok"; readonly hospitals: readonly HospitalRef[] }
  | { readonly status: "not-ready" | "offline" | "signed-out" }
  | { readonly status: "error"; readonly message: string | null };

/** Every hospital, for the site administrator, from the people API. Off for everyone else. */
export function useAdminHospitalList(enabled: boolean): AdminHospitalList & { readonly retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ readonly key: number; readonly list: AdminHospitalList } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchWorkPeople(null, { signal: controller.signal }).then(
      (outcome) => {
        const list: AdminHospitalList =
          outcome.status === "ok"
            ? { status: "ok", hospitals: outcome.data.hospitals }
            : outcome.status === "not-ready" || outcome.status === "offline" || outcome.status === "signed-out"
              ? { status: outcome.status }
              : // Forbidden or failed: an administrator always may, so either is a failure to retry.
                { status: "error", message: outcome.status === "error" ? outcome.message : null };
        setRead({ key: attempt, list });
      },
      () => {
        // Aborted: a newer read replaced this one.
      },
    );
    return () => controller.abort();
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!enabled) return { status: "off", retry };
  if (read?.key !== attempt) return { status: "loading", retry };
  return { ...read.list, retry };
}

export type HospitalSickRead =
  | { readonly status: "off" | "loading"; readonly retry: () => void }
  | (HospitalSickOutcome & { readonly retry: () => void });

/** One hospital's sick calls. Off without a hospital or when the screen does not need them. */
export function useHospitalSick(hospitalId: string | null, enabled: boolean): HospitalSickRead {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ readonly key: string; readonly outcome: HospitalSickOutcome } | null>(null);
  const key = `${hospitalId ?? ""}:${attempt}`;
  const active = enabled && Boolean(hospitalId);
  useEffect(() => {
    if (!active || !hospitalId) return;
    const controller = new AbortController();
    fetchHospitalSick(hospitalId, { signal: controller.signal }).then(
      (outcome) => setRead({ key, outcome }),
      () => {
        // Aborted: a newer read replaced this one.
      },
    );
    return () => controller.abort();
  }, [active, hospitalId, key]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!active) return { status: "off", retry };
  if (read?.key !== key) return { status: "loading", retry };
  return { ...read.outcome, retry };
}

/* ---------------------------------------------------------------- states */

export function HospitalSkeleton({ testId }: { readonly testId: string }) {
  return (
    <>
      <p role="status" className="sr-only">
        Loading
      </p>
      <ModeModuleSkeleton rows={4} twoLine eyebrow testId={testId} />
    </>
  );
}

function BackButton({
  href,
  label,
  testId,
}: {
  readonly href: string;
  readonly label: string;
  readonly testId: string;
}) {
  return (
    <WorkButton variant="quiet" href={href} testId={testId}>
      {label}
    </WorkButton>
  );
}

export function BackToAdmin({ testId }: { readonly testId: string }) {
  return <BackButton href={ADMIN_PAGE_HREFS.today} label="Back to Admin" testId={testId} />;
}

export function BackToHospital({ testId }: { readonly testId: string }) {
  return <BackButton href={HOSPITAL_HUB_HREF} label="Back to Hospital" testId={testId} />;
}

export function HospitalSignedOut({
  title,
  onExample,
  testId,
}: {
  readonly title: string;
  readonly onExample: () => void;
  readonly testId: string;
}) {
  return (
    <>
      <SignedOutSampleNotice title={title} testId={testId}>
        These screens are for Medical Workforce, the DCT, supervisors and roster managers. You can also look around with
        example records, and nothing is saved.
      </SignedOutSampleNotice>
      <div className="grid grid-cols-1">
        <WorkButton variant="secondary" onClick={onExample} testId={`${testId}-example`}>
          Look around with example records
        </WorkButton>
      </div>
    </>
  );
}

/** The roles answer itself failed (or the phone is offline), with Try again. */
export function HospitalRolesUnavailable({ online, testId }: { readonly online: boolean; readonly testId: string }) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={online ? RotateCcw : CloudOff}
        title={online ? "Your roles couldn't be checked" : "You're offline"}
        body={online ? "Something went wrong on our side. Try again shortly." : "Hospital screens need a connection."}
        action={
          <WorkButton variant="secondary" icon={RotateCcw} onClick={resetWorkRoles} testId={`${testId}-retry`}>
            Try again
          </WorkButton>
        }
        testId={testId}
      />
    </WorkCard>
  );
}

/** 503 `work_roles_not_ready`: the role tables are not in this database yet. */
export function HospitalNotReady({ onExample, testId }: { readonly onExample: () => void; readonly testId: string }) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={Building2}
        title={
          <span role="heading" aria-level={2}>
            Hospital roles can&apos;t be kept in PsychSift yet
          </span>
        }
        body="The place to keep them is still being set up. You can try every screen with example records, and nothing is saved."
        action={
          <div className="grid w-full gap-2">
            <WorkButton size="wide" onClick={onExample} testId={`${testId}-example`}>
              Try it with example records
            </WorkButton>
            <BackToAdmin testId={`${testId}-back`} />
          </div>
        }
        testId={testId}
      />
    </WorkCard>
  );
}

/** A read that failed, or the phone is offline, with Try again. */
export function HospitalLoadFailed({
  offline,
  what,
  message,
  onRetry,
  testId,
}: {
  readonly offline: boolean;
  /** "Sick calls", "Your hospitals". */
  readonly what: string;
  readonly message?: string | null;
  readonly onRetry: () => void;
  readonly testId: string;
}) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={offline ? CloudOff : RotateCcw}
        title={offline ? "You're offline" : `${what} didn't load`}
        body={
          offline
            ? `${what} need a connection. Try again when you're back online.`
            : (message ?? "Something went wrong. Try again shortly.")
        }
        action={
          <WorkButton variant="secondary" icon={RotateCcw} onClick={onRetry} testId={`${testId}-retry`}>
            Try again
          </WorkButton>
        }
        testId={testId}
      />
    </WorkCard>
  );
}

/** A friendly stop for someone without the role a screen needs. */
export function HospitalNotForYou({
  title,
  body,
  action,
  onExample,
  testId,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: ReactNode;
  readonly onExample?: () => void;
  readonly testId: string;
}) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={ShieldCheck}
        title={
          <span role="heading" aria-level={2}>
            {title}
          </span>
        }
        body={body}
        action={
          <div className="grid w-full gap-2">
            {action}
            {onExample ? (
              <WorkButton variant="quiet" onClick={onExample} testId={`${testId}-example`}>
                See it with example records
              </WorkButton>
            ) : null}
          </div>
        }
        testId={testId}
      />
    </WorkCard>
  );
}

/** The registry's example records didn't load (a file not downloaded while offline). */
export function HospitalExampleFailed({ onRetry, testId }: { readonly onRetry: () => void; readonly testId: string }) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={RotateCcw}
        title="The example didn't load"
        body="Check your connection, then try again."
        action={
          <WorkButton variant="secondary" icon={RotateCcw} onClick={onRetry} testId={`${testId}-retry`}>
            Try again
          </WorkButton>
        }
        testId={testId}
      />
    </WorkCard>
  );
}
