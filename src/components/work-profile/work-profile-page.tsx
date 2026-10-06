"use client";

import { Bell, Check, ChevronLeft, CloudOff, Lock, Shield, TriangleAlert, UserRound } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { InformationPageShell } from "@/components/information-page-shell";
import { formatModeTime } from "@/components/mode-kit/dates";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import {
  useWorkProfileData,
  type WorkProfileData,
  type WorkProfilePreferences,
} from "@/components/work-profile/use-work-profile-data";
import { WorkProfileNote, WorkProfileRow, WorkProfileSection } from "@/components/work-profile/work-profile-list";
import { AlertsPanel, PrivacyPanel, ProfilePanel, WorkPanel } from "@/components/work-profile/work-profile-panels";
import { useAuthSession } from "@/lib/supabase/client";
import { useOnlineStatus } from "@/lib/use-online-status";
import { WORK_PROFILE_TABS, profileTabCount, readWorkProfileTab, type WorkProfileTab } from "@/lib/work-profile/model";

// The sheet is opened rarely; it loads on first open, not with the page.
const WorkStageSheet = dynamic(() => import("@/components/work-profile/work-stage-sheet"), { ssr: false });

const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl gap-5 lg:max-w-5xl";

type HeaderStatus =
  | { kind: "saved"; at: Date | null }
  | { kind: "saving" }
  | { kind: "checking" }
  | { kind: "failed" }
  | { kind: "read-failed" }
  | { kind: "offline" }
  | { kind: "signed-out" }
  | { kind: "none" };

function StatusLine({ status, onRetry }: { readonly status: HeaderStatus; readonly onRetry: () => void }) {
  const base = "-mt-4 flex min-h-5 items-center gap-1.5 text-xs text-[color:var(--text-muted)]";
  if (status.kind === "failed" || status.kind === "read-failed") {
    // The whole line is the retry button; its 48px tap area must not push the tabs down.
    return (
      <div role="alert" className="-mt-4">
        <button
          type="button"
          onClick={onRetry}
          className="-my-3.5 inline-flex min-h-tap items-center gap-1.5 text-xs font-medium text-[color:var(--warning-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
          data-testid="work-profile-status-failed"
        >
          <TriangleAlert aria-hidden="true" className="size-icon-xs" />
          {status.kind === "failed" ? "Not saved · Try again" : "Couldn’t load your saved settings · Try again"}
        </button>
      </div>
    );
  }
  const content =
    status.kind === "saved" ? (
      <>
        <Check aria-hidden="true" className="size-icon-xs" />
        {status.at ? `Saved to your account ${formatModeTime(status.at)}` : "Saved to your account"}
      </>
    ) : status.kind === "saving" ? (
      "Saving…"
    ) : status.kind === "checking" ? (
      "Checking your saved settings…"
    ) : status.kind === "offline" ? (
      <>
        <CloudOff aria-hidden="true" className="size-icon-xs" />
        Offline · reopens when you’re back online
      </>
    ) : status.kind === "signed-out" ? (
      <>
        <Lock aria-hidden="true" className="size-icon-xs" />
        Signed out · nothing saved here
      </>
    ) : (
      "Nothing set up yet"
    );
  return (
    <p role="status" className={base} data-testid="work-profile-status">
      {content}
    </p>
  );
}

function SignedOutBody() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-6" data-testid="work-profile-signed-out">
      <WorkProfileNote icon={Lock} title="Sign in to set up your work profile">
        Your workplaces, alerts and roster settings are saved to your account, so most of them follow you to any device.
        A few stay on this phone.
      </WorkProfileNote>
      <WorkProfileSection label="What you can set up">
        <WorkProfileRow icon={UserRound} title="Your stage and workplaces" subtitle="Where you work and your roster" />
        <WorkProfileRow icon={Bell} title="Alerts and calendar" subtitle="One link for shifts, teaching and CPD" />
        <WorkProfileRow icon={Shield} title="Privacy" subtitle="See what stays on this phone" />
      </WorkProfileSection>
      <Button variant="primary" onClick={() => setOpen(true)} block>
        Sign in
      </Button>
      <AccountSetupDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * When a change made on this page last finished saving to the account. The
 * page-open read also passes through "syncing", so only a write stamps a time.
 */
function useSavedAt(syncState: string, wrote: boolean): Date | null {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const previous = useRef(syncState);
  useEffect(() => {
    if (wrote && previous.current === "syncing" && syncState === "synced") setSavedAt(new Date());
    previous.current = syncState;
  }, [syncState, wrote]);
  return savedAt;
}

function SignedInBody({
  tab,
  onTab,
  email,
}: {
  readonly tab: WorkProfileTab;
  readonly onTab: (tab: WorkProfileTab) => void;
  readonly email: string;
}) {
  const now = useNow();
  const data = useWorkProfileData(now);
  const { preferences, setPreference, syncState, retrySync } = useAppPreferences();
  const online = useOnlineStatus();
  const [wrote, setWrote] = useState(false);
  const savedAt = useSavedAt(syncState, wrote);
  const prefs = useMemo<WorkProfilePreferences>(
    () => ({
      preferences,
      setPreference: (key, value) => {
        setWrote(true);
        setPreference(key, value);
      },
    }),
    [preferences, setPreference],
  );
  return (
    <WorkProfileSignedInView
      tab={tab}
      onTab={onTab}
      email={email}
      data={data}
      online={online}
      syncState={syncState}
      wrote={wrote}
      savedAt={savedAt}
      onRetry={retrySync}
      prefs={prefs}
    />
  );
}

/**
 * The signed-in page from already-read values, with no reads of its own, so a
 * test or a screenshot can show any state without a live account.
 */
export function WorkProfileSignedInView({
  tab,
  onTab,
  email,
  data,
  online,
  syncState,
  wrote = false,
  savedAt,
  onRetry,
  prefs,
}: {
  readonly tab: WorkProfileTab;
  readonly onTab: (tab: WorkProfileTab) => void;
  readonly email: string;
  readonly data: WorkProfileData;
  readonly online: boolean;
  readonly syncState: string;
  /** A change was made on this page, so a failure is a failed save rather than a failed read. */
  readonly wrote?: boolean;
  readonly savedAt: Date | null;
  readonly onRetry: () => void;
  readonly prefs: WorkProfilePreferences;
}) {
  const [stageOpen, setStageOpen] = useState(false);
  const identity = deriveSidebarIdentity(email);

  // Nothing set up: no row below shows Ready or a recorded figure.
  const nothingSetUp =
    prefs.preferences.workStage === null &&
    data.roster.status === "ready" &&
    data.roster.value.workplaces === 0 &&
    !data.roster.value.rowName &&
    data.teaching.status === "ready" &&
    data.teaching.value.teams === 0 &&
    data.cpd.status === "ready" &&
    !data.cpd.value.configured &&
    data.admin.status === "ready" &&
    data.admin.value.recorded === 0;

  const status: HeaderStatus = !online
    ? { kind: "offline" }
    : syncState === "error"
      ? { kind: wrote ? "failed" : "read-failed" }
      : syncState === "syncing"
        ? { kind: wrote ? "saving" : "checking" }
        : nothingSetUp
          ? { kind: "none" }
          : { kind: "saved", at: savedAt };

  // Counts are hidden while offline: a figure from a partial read could be too low.
  const count = online ? profileTabCount(data.admin) : undefined;
  const items = WORK_PROFILE_TABS.map((item) => ({
    id: item.id,
    label: item.label,
    ...(item.id === "profile" && count ? { count } : {}),
  }));

  return (
    <>
      <StatusLine status={status} onRetry={onRetry} />
      <Tabs items={items} value={tab} onChange={(id) => onTab(readWorkProfileTab(id))} label="Work profile">
        <div className="pt-5" data-testid={`work-profile-panel-${tab}`}>
          {!online ? (
            <div className="pb-6">
              <WorkProfileNote icon={CloudOff} title="You’re offline" testId="work-profile-offline">
                Only what loaded is shown. Settings can’t be changed until you’re back online. Nothing was saved.
              </WorkProfileNote>
            </div>
          ) : null}
          {tab === "profile" ? (
            <ProfilePanel
              data={data}
              identity={{ name: identity.displayName, email }}
              prefs={prefs}
              onChooseStage={() => setStageOpen(true)}
              offline={!online}
            />
          ) : tab === "work" ? (
            <WorkPanel data={data} />
          ) : tab === "alerts" ? (
            <AlertsPanel />
          ) : (
            <PrivacyPanel data={data} prefs={prefs} />
          )}
        </div>
      </Tabs>
      {stageOpen ? <WorkStageSheet open={stageOpen} onClose={() => setStageOpen(false)} prefs={prefs} /> : null}
    </>
  );
}

/** The page frame: back link and title over the body, shared by every state. */
export function WorkProfileFrame({ children }: { readonly children: ReactNode }) {
  return (
    <InformationPageShell testId="work-profile-main">
      <div className={PAGE_WIDTH}>
        <header className="grid gap-1" data-testid="work-profile-header">
          <ContextualBackLink
            fallbackHref="/my-day"
            className="-ml-1 inline-flex min-h-tap w-fit items-center gap-1 text-sm font-medium text-[color:var(--clinical-accent)] no-underline"
          >
            <ChevronLeft aria-hidden="true" className="size-icon-sm" />
            My Day
          </ContextualBackLink>
          <h1 className="text-hero font-semibold leading-tight text-[color:var(--text-heading)]">Work profile</h1>
        </header>
        {children}
      </div>
    </InformationPageShell>
  );
}

/**
 * Work profile: the one page where a doctor sets up the Work side once — who
 * they are, where they work, the rules they work under, alerts, and what is
 * kept where. It never repeats My Day and never looks finished when it isn't.
 */
export function WorkProfilePage() {
  const { status: authStatus, session } = useAuthSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = readWorkProfileTab(searchParams.get("tab"));

  const setTab = useCallback(
    (next: WorkProfileTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "profile") params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const signedOut = authStatus === "signed_out" || authStatus === "expired" || authStatus === "unconfigured";
  const email = session?.user?.email ?? "";

  return (
    <WorkProfileFrame>
      {authStatus === "loading" ? (
        <>
          <span role="status" className="sr-only">
            Loading Work profile
          </span>
          <div className="grid gap-5" aria-hidden="true" data-testid="work-profile-loading">
            <ModeModuleSkeleton rows={3} twoLine eyebrow />
          </div>
        </>
      ) : null}

      {authStatus === "error" ? (
        <div className="grid gap-2" data-testid="work-profile-auth-error">
          <ModeNotice tone="warning">Couldn&apos;t check your sign-in. Try again.</ModeNotice>
          <div>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {signedOut ? (
        <>
          <StatusLine status={{ kind: "signed-out" }} onRetry={() => undefined} />
          <SignedOutBody />
        </>
      ) : null}

      {authStatus === "authenticated" ? <SignedInBody tab={tab} onTab={setTab} email={email} /> : null}
    </WorkProfileFrame>
  );
}
