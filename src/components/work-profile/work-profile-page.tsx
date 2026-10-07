"use client";

import {
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  Cloud,
  CloudOff,
  FileText,
  Lock,
  MapPin,
  Search,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { deriveSidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { InformationPageShell } from "@/components/information-page-shell";
import { MyDayMoreActions } from "@/components/my-day/my-day-more-actions";
import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
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

/** The work-mode page body: a wash background, a 12px gutter and close card spacing. */
const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-3 pt-3 pb-8 lg:max-w-5xl";

/** The status line in plain words, for the band's small line over the title. */
function statusWords(status: HeaderStatus): string {
  switch (status.kind) {
    case "saved":
      return status.at ? `Saved to your account ${formatModeTime(status.at)}` : "Saved to your account";
    case "saving":
      return "Saving";
    case "checking":
      return "Checking your saved settings";
    case "failed":
      return "Not saved";
    case "read-failed":
      return "Couldn’t load your saved settings";
    case "offline":
      return "Offline";
    case "signed-out":
      return "Signed out · nothing saved here";
    case "none":
      return "Nothing set up yet";
  }
}

/** Lets the body tell the frame what the band's small line should say. */
const BandLineContext = createContext<(line: string) => void>(() => undefined);

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
  const setBandLine = useContext(BandLineContext);
  const words = statusWords(status);
  useEffect(() => setBandLine(words), [setBandLine, words]);
  const bandShown = useModeBandShown();
  // Under the band the line is the band's own small line; here it stays for screen readers.
  const base = bandShown ? "sr-only" : "-mt-4 flex min-h-5 items-center gap-1.5 text-xs text-[color:var(--text-muted)]";
  if (status.kind === "failed" || status.kind === "read-failed") {
    // The whole line is the retry button; its 48px tap area must not push the tabs down.
    return (
      <div role="alert" className={bandShown ? undefined : "-mt-4"}>
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

/** The mock-up's made-up doctor, shown read-only so a signed-out visitor sees what the page holds. */
const EXAMPLE_AREAS = [
  { id: "roster", mode: "roster", title: "Roster", subtitle: "2 workplaces · your line EXAMPLE A", label: "Ready" },
  { id: "teaching", mode: "teaching", title: "Teaching", subtitle: "2 teams followed", label: "Ready" },
  { id: "cpd", mode: "cme", title: "CPD", subtitle: "2026 plan and 3 routines", label: "Ready" },
  {
    id: "admin",
    mode: "admin",
    title: "Admin",
    subtitle: "Dates you entered. Not checked with Ahpra",
    label: "1 not recorded",
  },
  { id: "on-call", mode: "on-call", title: "On Call", subtitle: "Hospital phone off", label: "Ready" },
] as const;

function SignedOutBody() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-6" data-testid="work-profile-signed-out">
      <WorkProfileNote
        icon={Lock}
        title="Made-up example. Sign in to set up your own"
        action={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Sign in
          </Button>
        }
      >
        Your workplaces, alerts and roster settings are saved to your account, so most of them follow you to any device.
        A few stay on this phone.
      </WorkProfileNote>
      <div className="flex min-w-0 items-center gap-3.5" data-testid="work-profile-example-identity">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-inset)] text-base font-semibold text-[color:var(--text-heading)]"
        >
          AE
        </span>
        <div className="grid min-w-0">
          <p className="break-words text-base font-semibold text-[color:var(--text-heading)]">Dr Alex Example</p>
          <p className="break-all text-sm text-[color:var(--text-muted)]">alex@example.health</p>
        </div>
      </div>
      <WorkProfileSection label="About you">
        <WorkProfileRow icon={UserRound} title="Stage" subtitle="Consultant psychiatrist · you chose this" />
        <WorkProfileRow title="Guidelines for" subtitle="Western Australia" />
        <WorkProfileRow title="Roster grade" subtitle="Consultant · set by the Gen Psych 2 team" />
      </WorkProfileSection>
      <WorkProfileSection label="Where you work">
        <WorkProfileRow
          icon={MapPin}
          title="Example Hospital"
          subtitle="Main workplace · Gen Psych 2 · roster linked"
        />
        <WorkProfileRow
          icon={BriefcaseBusiness}
          title="Example Private Clinic"
          subtitle="Sessional · your own indemnity · roster linked"
        />
      </WorkProfileSection>
      <WorkProfileSection label="Set up each area" testId="work-profile-example-areas">
        {EXAMPLE_AREAS.map((row) => (
          <WorkProfileRow
            key={row.id}
            dot={row.mode}
            title={row.title}
            subtitle={row.subtitle}
            trailing={
              row.label === "Ready" ? (
                <span className="inline-flex items-center gap-1 text-[color:var(--text-muted)]">
                  <Check aria-hidden="true" className="size-icon-sm" />
                  {row.label}
                </span>
              ) : (
                <span className="text-[color:var(--text-muted)]">{row.label}</span>
              )
            }
          />
        ))}
      </WorkProfileSection>
      <AccountSetupDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/**
 * Privacy for a signed-out visitor (More's "Privacy" link): what is kept where, read-only, so the link is
 * never a dead end before signing in. The same facts as the signed-in Privacy tab, without its switches.
 */
function SignedOutPrivacy() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-6" data-testid="work-profile-signed-out-privacy">
      <WorkProfileNote
        icon={Lock}
        title="Signed out. Nothing is saved for you yet"
        action={
          <Button variant="primary" onClick={() => setOpen(true)}>
            Sign in
          </Button>
        }
      >
        Once you sign in, this is where you choose what is kept and clear it.
      </WorkProfileNote>
      <WorkProfileSection label="Where your work is kept">
        <WorkProfileRow
          icon={Cloud}
          title="Your account"
          subtitle="Your stage, roster, CPD, teaching, reminders, renewal dates"
        />
        <WorkProfileRow
          icon={Smartphone}
          title="Only this phone"
          subtitle="Credential numbers, On Call checklist ticks, My Day note, pins and recent pages"
        />
      </WorkProfileSection>
      <WorkProfileNote icon={ShieldCheck} title="Patient labels stay on this phone">
        Cleared 12 hours after the first label of the shift, when you sign out or your session ends, and before anyone
        else signs in here.
      </WorkProfileNote>
      <WorkProfileSection label="Searches">
        <WorkProfileRow
          icon={Search}
          title="Recent searches"
          subtitle="Kept only in this browser tab, never on your account. Anything that looks like a patient detail is never kept."
        />
      </WorkProfileSection>
      <WorkProfileSection label="More">
        <WorkProfileRow
          icon={FileText}
          title="Privacy policy"
          subtitle="How PsychSift handles your data"
          href="/privacy"
        />
      </WorkProfileSection>
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
        <div
          className="scroll-mt-4 pt-4"
          id={tab === "privacy" ? "privacy" : tab === "work" ? "work-and-leave" : undefined}
          data-testid={`work-profile-panel-${tab}`}
        >
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

/**
 * The page frame, shared by every state. Under the band (work-mode redesign,
 * owner request 6 Oct 2026) the band carries the title, the status line and
 * the back button; without it, the back link and title are drawn here.
 */
export function WorkProfileFrame({ children }: { readonly children: ReactNode }) {
  const bandShown = useModeBandShown();
  const [line, setLine] = useState("Stage, workplaces and settings");
  useModeBandHeading({ eyebrow: line, title: "Work profile" });
  return (
    <BandLineContext.Provider value={setLine}>
      <InformationPageShell testId="work-profile-main" width="bleed" className="bg-[color:var(--work-wash)]">
        <div className={PAGE_WIDTH}>
          <header className={bandShown ? "sr-only" : "grid gap-1"} data-testid="work-profile-header">
            {bandShown ? null : (
              <ContextualBackLink
                fallbackHref="/my-day"
                className="-ml-1 inline-flex min-h-tap w-fit items-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline"
              >
                <ChevronLeft aria-hidden="true" className="size-icon-sm" />
                My Day
              </ContextualBackLink>
            )}
            <PageTitleUnderBand className="text-2xl font-bold leading-tight tracking-tight text-[color:var(--work-ink)]">
              Work profile
            </PageTitleUnderBand>
          </header>
          {children}
        </div>
      </InformationPageShell>
    </BandLineContext.Provider>
  );
}

/** My Day's More actions, with the minute clock the reminder sheets need. */
function ProfileMoreActions() {
  return <MyDayMoreActions now={useNow()} />;
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

  // More's Privacy link (and an old Work and leave link) arrive as a #hash: open that part.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const fromHash = hash === "privacy" ? "privacy" : hash === "work-and-leave" ? "work" : null;
    if (!fromHash || fromHash === tab) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", fromHash);
    router.replace(`${pathname}?${params.toString()}#${hash}`, { scroll: false });
  }, [pathname, router, tab]);

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
          {tab === "privacy" ? <SignedOutPrivacy /> : <SignedOutBody />}
        </>
      ) : null}

      {authStatus === "authenticated" ? <SignedInBody tab={tab} onTab={setTab} email={email} /> : null}
      {authStatus === "authenticated" ? <ProfileMoreActions /> : null}
    </WorkProfileFrame>
  );
}
