"use client";

import {
  Bell,
  Check,
  Cloud,
  GraduationCap,
  Info,
  MapPin,
  Plus,
  Route,
  Scale,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import {
  WorkProfileFoot,
  WorkProfileNote,
  WorkProfileRow,
  WorkProfileSection,
} from "@/components/work-profile/work-profile-list";
import type { WorkProfileData } from "@/components/work-profile/use-work-profile-data";
import { JURISDICTION_OPTIONS, workStageLabel } from "@/lib/account-preferences";
import { clearRecentQueries, countRecentQueries } from "@/lib/recent-query-storage";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { ROSTER_GRADES } from "@/lib/roster/team/model";
import { useAuthSession } from "@/lib/supabase/client";
import {
  adminArea,
  cpdArea,
  onCallArea,
  payFortnightWeekday,
  restRules,
  restRulesProvenance,
  rosterArea,
  teachingArea,
  type AreaRow,
} from "@/lib/work-profile/model";

const AREA_HREF: Record<AreaRow["id"], string> = {
  roster: "/roster/settings",
  teaching: "/teaching/organise",
  cpd: "/cme/setup",
  admin: "/admin/renewals",
  "on-call": "/on-call/call",
};

const AREA_MODE: Record<AreaRow["id"], string> = {
  roster: "roster",
  teaching: "teaching",
  cpd: "cme",
  admin: "admin",
  "on-call": "on-call",
};

function AreaTrailing({ row }: { readonly row: AreaRow }) {
  if (row.state === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-[color:var(--text-muted)]">
        <Check aria-hidden="true" className="size-icon-sm" />
        {row.label}
      </span>
    );
  }
  if (row.state === "start") return <span className="text-[color:var(--clinical-accent)]">{row.label}</span>;
  return <span className="text-[color:var(--text-muted)]">{row.label}</span>;
}

function gradeLabel(grade: string | null | undefined): string | null {
  if (!grade) return null;
  return ROSTER_GRADES.includes(grade as (typeof ROSTER_GRADES)[number])
    ? grade.charAt(0).toUpperCase() + grade.slice(1)
    : null;
}

export function ProfileIdentity({ name, email }: { readonly name: string; readonly email: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <div className="flex min-w-0 items-center gap-3.5" data-testid="work-profile-identity">
      <span
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-inset)] text-base font-semibold text-[color:var(--text-heading)]"
      >
        {initials || "?"}
      </span>
      <div className="grid min-w-0">
        <p className="break-words text-base font-semibold text-[color:var(--text-heading)]">{name}</p>
        <p className="break-all text-sm text-[color:var(--text-muted)]">{email}</p>
      </div>
    </div>
  );
}

export function ProfilePanel({
  data,
  identity,
  onChooseStage,
  layout,
  offline = false,
}: {
  readonly data: WorkProfileData;
  readonly identity: { name: string; email: string };
  readonly onChooseStage: () => void;
  /** "split" puts the areas in a second column on a wide screen. */
  readonly layout: "single" | "split";
  /** Offline nothing can be changed, so rows are read-only and the add/start actions are hidden. */
  readonly offline?: boolean;
}) {
  const { preferences } = useAppPreferences();
  const stage = workStageLabel(preferences.workStage, preferences.ranzcpStage);
  const jurisdiction =
    JURISDICTION_OPTIONS.find((option) => option.value === preferences.jurisdiction)?.label ?? "Western Australia";
  const teams = data.teams.status === "ready" ? data.teams.value : [];
  const grades = [...new Set(teams.map((team) => gradeLabel(team.grade)).filter(Boolean))] as string[];
  const admin = data.admin.status === "ready" ? data.admin.value : null;
  const showMissing = admin !== null && !admin.partial && admin.recorded > 0 && admin.missing.length > 0;
  const areas = [
    rosterArea(data.roster),
    teachingArea(data.teaching),
    cpdArea(data.cpd, preferences.workStage),
    adminArea(data.admin),
    onCallArea(data.hospitalPhone),
  ];

  const about = (
    <WorkProfileSection label="About you" testId="work-profile-about">
      <WorkProfileRow
        title="Stage"
        subtitle={
          stage ? (
            `${stage} · you chose this`
          ) : (
            <span className="text-[color:var(--clinical-accent)]">Choose your stage</span>
          )
        }
        onSelect={offline ? undefined : onChooseStage}
        testId="work-profile-stage"
      />
      <WorkProfileRow title="Guidelines for" subtitle={jurisdiction} />
      {grades.length === 1 ? (
        <WorkProfileRow
          title="Roster grade"
          subtitle={`${grades[0]} · set by ${teams.length === 1 ? `the ${teams[0]!.name} team` : "your roster teams"}`}
        />
      ) : grades.length > 1 ? (
        <WorkProfileRow
          title="Roster grades"
          subtitle="Your teams list different grades"
          trailing={<span className="nums text-[color:var(--text-muted)]">{`${teams.length} teams`}</span>}
        />
      ) : null}
    </WorkProfileSection>
  );

  const training =
    preferences.workStage === "registrar" && preferences.ranzcpStage ? (
      <WorkProfileSection label="Your training">
        <WorkProfileRow
          icon={GraduationCap}
          title={`RANZCP Stage ${preferences.ranzcpStage}`}
          subtitle="Assessments stay in InTrain"
        />
      </WorkProfileSection>
    ) : null;

  const missingNote = showMissing ? (
    <WorkProfileNote
      icon={Info}
      title={admin.missing.length === 1 ? "One date not recorded" : `${admin.missing.length} dates not recorded`}
      action={<AddLink href="/admin/renewals" />}
      testId="work-profile-missing-note"
    >
      {admin.missing.join(", ")}
    </WorkProfileNote>
  ) : null;

  const workplaces = (
    <WorkProfileSection label="Where you work" testId="work-profile-workplaces">
      {data.workplaces.status === "ready" ? (
        data.workplaces.value.map((name) => (
          <WorkProfileRow
            key={name}
            icon={MapPin}
            title={name}
            subtitle="From your roster"
            href={offline ? undefined : "/roster/settings"}
          />
        ))
      ) : data.workplaces.status === "failed" ? (
        <WorkProfileRow icon={MapPin} title="Couldn’t load your workplaces" subtitle="Not checked" />
      ) : null}
      {offline ? null : (
        <WorkProfileRow
          icon={Plus}
          title="Add a workplace"
          tone="link"
          href="/roster/settings"
          testId="work-profile-add-workplace"
        />
      )}
    </WorkProfileSection>
  );

  const areaList = (
    <WorkProfileSection label="Set up each area" testId="work-profile-areas">
      {areas.map((row) => (
        <WorkProfileRow
          key={row.id}
          dot={AREA_MODE[row.id]}
          title={row.title}
          subtitle={row.subtitle}
          trailing={<AreaTrailing row={row} />}
          href={offline || row.state === "not-checked" ? undefined : AREA_HREF[row.id]}
          testId={`work-profile-area-${row.id}`}
        />
      ))}
    </WorkProfileSection>
  );

  const newJob = offline ? null : (
    <WorkProfileSection>
      <WorkProfileRow
        icon={Route}
        title="Starting a new job or rotation"
        subtitle="Opens Admin’s New job steps"
        href="/admin/new-job"
      />
    </WorkProfileSection>
  );

  const identityBlock = <ProfileIdentity name={identity.name} email={identity.email} />;

  if (layout === "split") {
    return (
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-6">
          {identityBlock}
          {about}
          {training}
          {missingNote}
          {workplaces}
        </div>
        <div className="grid min-w-0 content-start gap-6">
          {areaList}
          {newJob}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      {identityBlock}
      {about}
      {training}
      {missingNote}
      {workplaces}
      {areaList}
      {newJob}
    </div>
  );
}

function AddLink({ href }: { readonly href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-tap min-w-tap items-center justify-center text-sm font-medium text-[color:var(--clinical-accent)] no-underline"
    >
      Add
    </Link>
  );
}

export function WorkPanel({ data }: { readonly data: WorkProfileData }) {
  const weekday =
    data.payFortnightAnchor.status === "ready" ? payFortnightWeekday(data.payFortnightAnchor.value) : null;
  return (
    <div className="grid gap-6">
      <WorkProfileSection label="Your agreement" testId="work-profile-agreement">
        <WorkProfileRow
          icon={Scale}
          title={FATIGUE_RULE_SET.source.title.replace("WA Health System – Medical Practitioners – ", "WA Health ")}
          subtitle="WA public hospitals · open the agreement"
          href={FATIGUE_RULE_SET.source.url}
          external
        />
        {weekday ? (
          <WorkProfileRow
            title="Pay fortnight starts"
            subtitle="Set by your roster team"
            trailing={<span className="text-[color:var(--text-muted)]">{weekday}</span>}
          />
        ) : null}
      </WorkProfileSection>
      <WorkProfileFoot>Private work follows your own contract, not this agreement.</WorkProfileFoot>
      <WorkProfileSection label="Rest rules from the agreement" testId="work-profile-rest-rules">
        {restRules().map((rule) => (
          <WorkProfileRow
            key={rule.label}
            title={rule.label}
            subtitle={`Clause ${rule.clause}`}
            trailing={<span className="nums text-[color:var(--text-muted)]">{rule.value}</span>}
          />
        ))}
        <WorkProfileRow
          title="Check my next 14 days"
          subtitle="Roster’s Hours check uses these limits"
          href="/roster/shifts"
        />
      </WorkProfileSection>
      <WorkProfileFoot>{restRulesProvenance()}</WorkProfileFoot>
    </div>
  );
}

export function AlertsPanel() {
  return (
    <div className="grid gap-6">
      <WorkProfileSection label="Alerts and calendar" testId="work-profile-alerts">
        <WorkProfileRow
          icon={Bell}
          title="Alerts"
          subtitle="Reminders, your calendar link and phone alerts, by area"
          href="/my-day/alerts"
          testId="work-profile-alerts-link"
        />
      </WorkProfileSection>
    </div>
  );
}

function PrivacyToggleRow({
  title,
  subtitle,
  enabled,
  onToggle,
  icon,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly enabled: boolean;
  readonly onToggle: () => void;
  readonly icon: typeof Search;
}) {
  return (
    <WorkProfileRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      trailing={<ToggleSwitch enabled={enabled} onToggle={onToggle} aria-label={title} />}
    />
  );
}

export function PrivacyPanel({ data }: { readonly data: WorkProfileData }) {
  const { preferences, setPreference } = useAppPreferences();
  const { signOut } = useAuthSession();
  const [cleared, setCleared] = useState<string | null>(null);
  const teams = data.teams.status === "ready" ? data.teams.value : [];

  const clearSearches = () => {
    const count = countRecentQueries();
    clearRecentQueries();
    setCleared(count > 0 ? "Recent searches cleared" : "No recent searches to clear");
  };

  return (
    <div className="grid gap-6">
      <WorkProfileSection label="Where your work is kept" testId="work-profile-kept">
        <WorkProfileRow icon={Cloud} title="Your account" subtitle="Roster, CPD, teaching, reminders, renewal dates" />
        <WorkProfileRow
          icon={Smartphone}
          title="Only this phone"
          subtitle="Credential numbers, On Call lists, My Day note, pins and recent pages"
        />
      </WorkProfileSection>
      <WorkProfileNote icon={ShieldCheck} title="Patient labels stay on this phone" testId="work-profile-label-rule">
        Cleared at the end of your rostered shift (or 12 hours after the first one), when you sign out or your session
        ends, and before anyone else signs in here.
      </WorkProfileNote>
      <WorkProfileSection label="Searches">
        <PrivacyToggleRow
          icon={Search}
          title="Save recent searches"
          subtitle="Kept only in this browser tab, never on your account"
          enabled={preferences.saveRecentSearches}
          onToggle={() => setPreference("saveRecentSearches", !preferences.saveRecentSearches)}
        />
        <WorkProfileRow
          title="Clear recent searches"
          subtitle={cleared ?? undefined}
          onSelect={clearSearches}
          testId="work-profile-clear-searches"
        />
      </WorkProfileSection>
      {teams.length > 0 ? (
        <WorkProfileSection label="Your teams">
          {teams.map((team) => (
            <WorkProfileRow
              key={team.serviceId}
              icon={Users}
              title={team.name}
              subtitle={team.enabled ? "Roster" : "Roster · switched off"}
              href="/roster"
            />
          ))}
        </WorkProfileSection>
      ) : null}
      <WorkProfileSection label="Remove" testId="work-profile-remove">
        <WorkProfileRow
          icon={Trash2}
          tone="danger"
          title="Remove a workplace"
          subtitle="In Roster settings. Deletes its imported shifts and shift codes. Asks first."
          href="/roster/settings"
        />
        <WorkProfileRow
          icon={Trash2}
          tone="danger"
          title="Delete my roster data"
          subtitle="In Roster settings. Waits 30 seconds so you can undo."
          href="/roster/settings"
        />
      </WorkProfileSection>
      <SignOutBlock onSignOut={() => void signOut()} />
    </div>
  );
}

function SignOutBlock({ onSignOut }: { readonly onSignOut: () => void }): ReactNode {
  return (
    <div className="grid gap-1 border-t border-[color:var(--border)] pt-1">
      <button
        type="button"
        onClick={onSignOut}
        data-testid="work-profile-sign-out"
        className="flex min-h-tap items-center gap-3 text-left text-base-minus font-medium text-[color:var(--danger-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        Sign out
      </button>
      <WorkProfileFoot>
        Clears everything kept on this phone for your account, including patient labels. Display settings stay.
      </WorkProfileFoot>
    </div>
  );
}
