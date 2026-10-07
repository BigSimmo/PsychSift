"use client";

import {
  Award,
  Bell,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  CalendarSync,
  CircleCheck,
  Clock3,
  CloudOff,
  GraduationCap,
  LayoutGrid,
  Phone,
  QrCode,
  FileUp,
  Route,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { WorkCard, WorkIconRow, WorkSectionLabel, WorkTag } from "@/components/mode-kit/work";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { Checkbox, RadioGroup } from "@/components/ui/choice";
import { SetupAreaStatus, SetupAreaTrailing } from "@/components/work-setup/work-setup-area-status";
import { WORK_SETUP_AREA_COPY, WORK_SETUP_COVERS, WORK_SETUP_STEP_COPY } from "@/components/work-setup/work-setup-copy";
import { setupZoneLabel, type SetupExampleData, type SetupTimeZone } from "@/components/work-setup/shared-settings";
import {
  RANZCP_STAGE_OPTIONS,
  WORK_STAGE_OPTIONS,
  type RanzcpStagePreference,
  type WorkStagePreference,
} from "@/lib/account-preferences";
import type { AppModeId } from "@/lib/app-modes";
import type { AreaRow } from "@/lib/work-profile/model";
import {
  countedWorkSetupSteps,
  WORK_SETUP_AREAS,
  type WorkSetupAreaId,
  type WorkSetupProgress,
  type WorkSetupStepId,
} from "@/lib/work-setup/progress";

/** What every step body may need. */
export type WorkSetupStepContext = {
  readonly progress: WorkSetupProgress;
  readonly signedIn: boolean;
  readonly online: boolean;
  readonly exampleData: SetupExampleData;
  readonly timeZone: SetupTimeZone;
  readonly onAreas: (areas: readonly WorkSetupAreaId[]) => void;
  readonly onGoTo: (step: WorkSetupStepId) => void;
};

/* ------------------------------------------------------------- shared bits */

/** A row that opens a page elsewhere. Offline it stays readable but goes nowhere, and says why once above. */
function LinkRow({
  icon,
  title,
  sub,
  href,
  online,
  leadsTo,
  end,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly sub: string;
  readonly href: string;
  readonly online: boolean;
  readonly leadsTo?: AppModeId;
  readonly end?: React.ReactNode;
  readonly testId?: string;
}) {
  if (!online) {
    return <WorkIconRow icon={icon} title={title} sub={sub} leadsTo={leadsTo} end={end ?? null} testId={testId} />;
  }
  return <WorkIconRow icon={icon} title={title} sub={sub} href={href} leadsTo={leadsTo} end={end} testId={testId} />;
}

/** Always mounted, so a screen reader hears it when the phone drops offline. */
function OfflineNote({ online }: { readonly online: boolean }) {
  return (
    <div role="status" className="contents">
      {online ? null : (
        <p className="work-setup__note" data-testid="work-setup-offline">
          <CloudOff aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
          {"You're offline. These open when you're back online."}
        </p>
      )}
    </div>
  );
}

function LeavesNote() {
  return <p className="work-setup__hint">{"Each opens in its own area. Come back here with Back when you're done."}</p>;
}

const AREA_ICON: Record<AreaRow["id"], LucideIcon> = {
  roster: CalendarDays,
  teaching: GraduationCap,
  cpd: Award,
  admin: BriefcaseBusiness,
  "on-call": Phone,
};

const AREA_HREF: Record<AreaRow["id"], string> = {
  roster: "/roster/settings",
  teaching: "/teaching/week",
  cpd: "/cme/setup",
  admin: "/admin/renewals",
  "on-call": "/on-call/call",
};

const AREA_MODE: Record<AreaRow["id"], AppModeId> = {
  roster: "roster",
  teaching: "teaching",
  cpd: "cme",
  admin: "my-work",
  "on-call": "on-call",
};

/** An area's set-up row: its state at the end, and a link whenever the phone is online. */
function AreaStatusRow({ row, online }: { readonly row: AreaRow; readonly online: boolean }) {
  return (
    <LinkRow
      icon={AREA_ICON[row.id]}
      title={row.title}
      sub={row.subtitle}
      href={AREA_HREF[row.id]}
      online={online}
      leadsTo={AREA_MODE[row.id]}
      end={<SetupAreaTrailing row={row} />}
      testId={`work-setup-area-${row.id}`}
    />
  );
}

/* ------------------------------------------------------------------- steps */

const COVER_ICON: Partial<Record<WorkSetupStepId, LucideIcon>> = {
  stage: UserRound,
  areas: LayoutGrid,
  "time-zone": Clock3,
  roster: CalendarDays,
  alerts: Bell,
};

export function WelcomeStep({ exampleData }: WorkSetupStepContext) {
  return (
    <div className="grid gap-4">
      <WorkCard as="ul" aria-label="What setup covers">
        {WORK_SETUP_COVERS.map((item) => (
          <li key={item.step}>
            <WorkIconRow icon={COVER_ICON[item.step] ?? Sparkles} title={item.label} sub={item.sub} />
          </li>
        ))}
      </WorkCard>
      {exampleData.available ? (
        <WorkCard testId="work-setup-example-data">
          <WorkIconRow
            icon={Sparkles}
            title="Look around with example data"
            sub="Shows a filled-in example in every area. Turn it off any time."
            end={
              <ExampleSwitch
                on={exampleData.on}
                onChange={(next) => (next ? exampleData.turnOn() : exampleData.turnOff())}
              />
            }
          />
        </WorkCard>
      ) : null}
    </div>
  );
}

/** The example data switch, drawn inline. Applies at once, so it is a switch, not a checkbox. */
export function ExampleSwitch({ on, onChange }: { readonly on: boolean; readonly onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Example data"
      className="work-setup__switch"
      onClick={() => onChange(!on)}
      data-testid="work-setup-example-switch"
    >
      <span aria-hidden="true" className="work-setup__switch-knob" />
    </button>
  );
}

export function StageStep() {
  const { preferences, setPreference, syncState } = useAppPreferences();
  const chose = Boolean(preferences.workStage);
  return (
    <div className="grid gap-5" data-testid="work-setup-stage">
      <WorkCard padded>
        <RadioGroup
          label="Your stage"
          hideLabel
          name="work-setup-stage"
          value={preferences.workStage ?? ""}
          onChange={(value) => setPreference("workStage", value as WorkStagePreference)}
          options={WORK_STAGE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description || undefined,
          }))}
        />
      </WorkCard>
      {preferences.workStage === "registrar" ? (
        <WorkCard padded testId="work-setup-ranzcp">
          <RadioGroup
            label="RANZCP stage"
            name="work-setup-ranzcp"
            value={preferences.ranzcpStage ? String(preferences.ranzcpStage) : ""}
            onChange={(value) => setPreference("ranzcpStage", Number(value) as RanzcpStagePreference)}
            options={RANZCP_STAGE_OPTIONS.map((stage) => ({ value: String(stage), label: `Stage ${stage}` }))}
          />
        </WorkCard>
      ) : null}
      <p className="work-setup__hint" role="status" data-testid="work-setup-stage-saved">
        {!chose
          ? ""
          : syncState === "local-only"
            ? "Saved on this phone only. Sign in to keep it with your account."
            : syncState === "error"
              ? "Couldn't save to your account just now. It's kept on this phone for now."
              : syncState === "syncing"
                ? "Saving to your account."
                : "Saved to your account."}
      </p>
    </div>
  );
}

export function AreasStep({ progress, onAreas }: WorkSetupStepContext) {
  const chosen = new Set(progress.areas);
  const toggle = (area: WorkSetupAreaId, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(area);
    else next.delete(area);
    onAreas(WORK_SETUP_AREAS.filter((item) => next.has(item)));
  };
  const steps = countedWorkSetupSteps(progress.areas).length;
  return (
    <div className="grid gap-3" data-testid="work-setup-areas">
      <WorkCard as="ul" aria-label="Areas you use">
        <li className="work-setup__area" data-mode-identity="my-day">
          <Checkbox
            label={
              <span className="work-setup__area-label">
                <span aria-hidden="true" className="work-setup__dot" />
                My Day
              </span>
            }
            description="Always on. Your day across every area."
            checked
            disabled
            readOnly
            data-testid="work-setup-area-toggle-day"
          />
        </li>
        {WORK_SETUP_AREAS.map((area) => {
          const copy = WORK_SETUP_AREA_COPY[area];
          return (
            <li key={area} className="work-setup__area" data-mode-identity={copy.identity}>
              <Checkbox
                label={
                  <span className="work-setup__area-label">
                    <span aria-hidden="true" className="work-setup__dot" />
                    {copy.name}
                  </span>
                }
                description={copy.sub}
                checked={chosen.has(area)}
                onChange={(event) => toggle(area, event.currentTarget.checked)}
                data-testid={`work-setup-area-toggle-${area}`}
              />
            </li>
          );
        })}
      </WorkCard>
      <p className="work-setup__hint" aria-live="polite" data-testid="work-setup-areas-count">
        Setup has {steps} {steps === 1 ? "step" : "steps"} for these.
      </p>
    </div>
  );
}

function zoneTime(zone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(now);
  } catch {
    return "";
  }
}

export function TimeZoneStep({ timeZone }: WorkSetupStepContext) {
  const now = new Date();
  const deviceLabel = timeZone.deviceZone ? setupZoneLabel(timeZone.zones, timeZone.deviceZone) : null;
  return (
    <div className="grid gap-3" data-testid="work-setup-time-zone">
      {timeZone.available ? (
        <WorkCard padded>
          <RadioGroup
            label="Time zone"
            hideLabel
            name="work-setup-zone"
            value={timeZone.zone}
            onChange={(value) => timeZone.setZone(value)}
            options={timeZone.zones.map((zone) => ({
              value: zone.id,
              label: zone.id === "Australia/Perth" ? `${zone.label} (default)` : zone.label,
              description: `${zone.short}, now ${zoneTime(zone.id, now)}`,
            }))}
          />
        </WorkCard>
      ) : (
        <WorkCard as="ul" aria-label="Time zone">
          <li>
            <WorkIconRow
              icon={Clock3}
              title={setupZoneLabel(timeZone.zones, timeZone.zone)}
              sub={`Times show in ${setupZoneLabel(timeZone.zones, timeZone.zone)} time, now ${zoneTime(timeZone.zone, now)}`}
              end={<WorkTag tone="neutral">Default</WorkTag>}
              testId="work-setup-zone-current"
            />
          </li>
        </WorkCard>
      )}
      {deviceLabel ? (
        <p className="work-setup__hint" data-testid="work-setup-device-zone">
          {timeZone.differsFromDevice
            ? `Your phone is set to ${deviceLabel}. Shifts still show in the zone above.`
            : `Your phone is set to ${deviceLabel} too.`}
        </p>
      ) : null}
    </div>
  );
}

export function RosterStep({ signedIn, online }: WorkSetupStepContext) {
  return (
    <div className="grid gap-4" data-testid="work-setup-roster">
      <OfflineNote online={online} />
      <SetupAreaStatus signedIn={signedIn}>
        {(rows) => (
          <WorkCard as="ul" aria-label="Roster now">
            <li>
              <AreaStatusRow row={rows.roster} online={online} />
            </li>
          </WorkCard>
        )}
      </SetupAreaStatus>
      <div className="grid gap-2">
        <WorkSectionLabel>Ways to set it up</WorkSectionLabel>
        <WorkCard as="ul" aria-label="Ways to set up your roster">
          <li>
            <LinkRow
              icon={QrCode}
              title="Join your team"
              sub="Use the invite code from your roster manager"
              href="/roster/join"
              online={online}
              leadsTo="roster"
              testId="work-setup-roster-join"
            />
          </li>
          <li>
            <LinkRow
              icon={FileUp}
              title="Import a roster file"
              sub="From the Month page, or add shifts one by one"
              href="/roster"
              online={online}
              leadsTo="roster"
              testId="work-setup-roster-import"
            />
          </li>
          <li>
            <LinkRow
              icon={CalendarSync}
              title="Calendar link and workplaces"
              sub="Put your shifts on your phone calendar"
              href="/roster/settings"
              online={online}
              leadsTo="roster"
              testId="work-setup-roster-settings"
            />
          </li>
        </WorkCard>
      </div>
      <LeavesNote />
    </div>
  );
}

export function RotationStep({ progress, signedIn, online }: WorkSetupStepContext) {
  const teaching = progress.areas.includes("teach");
  return (
    <div className="grid gap-4" data-testid="work-setup-rotation">
      <OfflineNote online={online} />
      <WorkCard as="ul" aria-label="Starting a rotation">
        {teaching ? (
          <li>
            <LinkRow
              icon={CalendarDays}
              title="Term dates and goals"
              sub="Your term, due dates and goals"
              href="/teaching/term"
              online={online}
              leadsTo="teaching"
              testId="work-setup-rotation-term"
            />
          </li>
        ) : null}
        <li>
          <LinkRow
            icon={Route}
            title="New job checklist"
            sub="What to sort before you start"
            href="/admin/new-job"
            online={online}
            leadsTo="my-work"
            testId="work-setup-rotation-new-job"
          />
        </li>
      </WorkCard>
      {teaching ? (
        <div className="grid gap-2">
          <WorkSectionLabel>Teaching now</WorkSectionLabel>
          <SetupAreaStatus signedIn={signedIn}>
            {(rows) => (
              <WorkCard as="ul" aria-label="Teaching now">
                <li>
                  <AreaStatusRow row={rows.teaching} online={online} />
                </li>
              </WorkCard>
            )}
          </SetupAreaStatus>
        </div>
      ) : null}
      <LeavesNote />
    </div>
  );
}

export function OtherAreasStep({ progress, signedIn, online }: WorkSetupStepContext) {
  const ids = (
    [
      ["cpd", "cpd"],
      ["admin", "admin"],
      ["call", "on-call"],
    ] as const
  ).filter(([area]) => progress.areas.includes(area));
  return (
    <div className="grid gap-4" data-testid="work-setup-other-areas">
      <OfflineNote online={online} />
      <SetupAreaStatus signedIn={signedIn}>
        {(rows) => (
          <WorkCard as="ul" aria-label="Your other areas">
            {ids.map(([, rowId]) => (
              <li key={rowId}>
                <AreaStatusRow row={rows[rowId]} online={online} />
              </li>
            ))}
          </WorkCard>
        )}
      </SetupAreaStatus>
      <LeavesNote />
    </div>
  );
}

export function AlertsStep({ progress, online }: WorkSetupStepContext) {
  const roster = progress.areas.includes("rost");
  return (
    <div className="grid gap-4" data-testid="work-setup-alerts">
      <OfflineNote online={online} />
      <WorkCard as="ul" aria-label="Alerts">
        <li>
          <LinkRow
            icon={Bell}
            title="Brief and quiet hours"
            sub="Reminder types, calendar alerts, quiet hours"
            href="/my-day/alerts"
            online={online}
            testId="work-setup-alerts-my-day"
          />
        </li>
        {roster ? (
          <li>
            <LinkRow
              icon={BellRing}
              title="Open shift alerts"
              sub="When shifts you might want appear"
              href="/open-shifts/alerts"
              online={online}
              leadsTo="open-shifts"
              testId="work-setup-alerts-open-shifts"
            />
          </li>
        ) : null}
      </WorkCard>
      <p className="work-setup__hint">
        Calendar alarms reach your phone only through your own calendar link or a file you download.
      </p>
    </div>
  );
}

const SUMMARY_ICON: Partial<Record<WorkSetupStepId, LucideIcon>> = {
  stage: UserRound,
  areas: LayoutGrid,
  "time-zone": Clock3,
  roster: CalendarDays,
  rotation: Route,
  "other-areas": Award,
  alerts: Bell,
};

export function DoneStep({ progress, onGoTo }: WorkSetupStepContext) {
  const steps = countedWorkSetupSteps(progress.areas);
  return (
    <WorkCard as="ul" aria-label="Your setup" testId="work-setup-summary">
      {steps.map((step) => {
        const done = progress.completed.includes(step);
        const skipped = progress.skipped.includes(step);
        const end = done ? (
          <span className="work-setup__ready">
            <CircleCheck aria-hidden="true" className="size-icon-sm" strokeWidth={2.2} />
            Done
          </span>
        ) : skipped ? (
          <WorkTag tone="neutral">Skipped</WorkTag>
        ) : (
          <WorkTag tone="amber">To do</WorkTag>
        );
        return (
          <li key={step}>
            <WorkIconRow
              icon={SUMMARY_ICON[step] ?? Sparkles}
              title={WORK_SETUP_STEP_COPY[step].short}
              sub={done ? "Change it" : "Open this step"}
              end={end}
              onClick={() => onGoTo(step)}
              testId={`work-setup-summary-${step}`}
            />
          </li>
        );
      })}
    </WorkCard>
  );
}

export const WORK_SETUP_STEP_BODY: Record<WorkSetupStepId, (context: WorkSetupStepContext) => React.ReactNode> = {
  welcome: WelcomeStep,
  stage: StageStep,
  areas: AreasStep,
  "time-zone": TimeZoneStep,
  roster: RosterStep,
  rotation: RotationStep,
  "other-areas": OtherAreasStep,
  alerts: AlertsStep,
  done: DoneStep,
};
