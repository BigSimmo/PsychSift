"use client";

import { UserX } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { ExampleTag } from "@/components/example-data/example-tag";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { PaperworkFootNote } from "@/components/work-screens/admin/paperwork-shared";
import {
  BackToHospital,
  HospitalExampleFailed,
  HospitalHeading,
  HospitalLoadFailed,
  HospitalNotForYou,
  HospitalNotReady,
  HospitalRolesUnavailable,
  HospitalSignedOut,
  HospitalSkeleton,
  useAdminHospitalList,
  useHospitalScreenState,
  useHospitalSick,
} from "@/components/work-screens/hospital/hospital-shared";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { isExampleRecord } from "@/lib/example-data/guards";
import {
  filterSickCalls,
  groupSickCallsByDay,
  HOSPITAL_HUB_HREF,
  HOSPITAL_SICK_STATUS_TONE,
  HOSPITAL_SICK_STATUS_WORDS,
  maySeeHospitalSick,
  peopleAndRolesHref,
  pickHospital,
  sickCallHref,
  sickCallLine,
  sickCallsPerTeam,
  sickHospitals,
  sickSummaryLine,
  type ExampleHospitalHub,
  type HospitalRef,
  type HospitalSickView,
} from "@/lib/work-roles/hospital-hub";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { zonedToday } from "@/lib/work-time/format";

const TITLE = "Sick calls";
const NO_HOSPITALS: readonly HospitalRef[] = [];
const NO_DETAIL = "No reason or health detail is asked for or kept.";

/**
 * Sick calls (`/admin/hospital/sick`): every shift a doctor said they can't
 * make, across one hospital's teams, from yesterday to a week ahead. For
 * Medical Workforce and the site administrator. Grouped by day in the work
 * time zone, calls needing cover first. Each call opens that team's own
 * Manage team inbox, because the team's roster manager decides cover. No
 * reason or health detail is asked for or kept.
 */
export function AdminHospitalSickPage() {
  const state = useHospitalScreenState();
  const { roles } = state;
  const searchParams = useSearchParams();
  const wanted = searchParams.get("hospitalId");

  let body;
  if (state.showExample) body = <SickExample wanted={wanted} />;
  else if (state.signedOut)
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see sick calls"
          onExample={state.turnOnExample}
          testId="admin-hospital-sick-signed-out"
        />
      </>
    );
  else if (roles.status === "unavailable")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalRolesUnavailable online={state.online} testId="admin-hospital-sick-roles-unavailable" />
      </>
    );
  else if (roles.status !== "ready")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSkeleton testId="admin-hospital-sick-loading" />
      </>
    );
  else if (!maySeeHospitalSick(roles.grants)) body = <NotForYou onExample={state.turnOnExample} />;
  else
    body = (
      <SickLive
        grants={roles.grants}
        // An example hospital left in the address after example data was turned off is not a real one.
        wanted={wanted && !isExampleRecord(wanted) ? wanted : null}
        onExample={state.turnOnExample}
      />
    );

  return <WorkBody testId="admin-hospital-sick">{body}</WorkBody>;
}

function NotForYou({ onExample }: { readonly onExample?: () => void }) {
  return (
    <>
      <HospitalHeading title={TITLE} />
      <HospitalNotForYou
        title="For Medical Workforce"
        body="Sick calls across the hospital are for Medical Workforce and site administrators. Your own team's sick calls are in Manage team."
        action={<BackToHospital testId="admin-hospital-sick-not-for-you-back" />}
        onExample={onExample}
        testId="admin-hospital-sick-not-for-you"
      />
    </>
  );
}

/** Picking a hospital changes the address, so Back and a shared link both keep it. */
function useHospitalPicker(): (hospitalId: string) => void {
  const router = useRouter();
  return (hospitalId: string) => router.replace(`/admin/hospital/sick?hospitalId=${encodeURIComponent(hospitalId)}`);
}

/* ------------------------------------------------------------------ live */

function SickLive({
  grants,
  wanted,
  onExample,
}: {
  readonly grants: readonly WorkRoleGrant[];
  readonly wanted: string | null;
  readonly onExample: () => void;
}) {
  const administrator = grants.some((grant) => grant.role === "administrator");
  // Only a team's own roster manager can open its inbox, so only their rows link there.
  const managed = useMemo(
    () => new Set(grants.flatMap((grant) => (grant.role === "manager" ? [grant.serviceId] : []))),
    [grants],
  );
  const list = useAdminHospitalList(administrator);
  const listed = list.status === "ok" ? list.hospitals : NO_HOSPITALS;
  const hospitals = useMemo(() => sickHospitals(grants, listed), [grants, listed]);
  const hospital = list.status === "loading" ? null : pickHospital(hospitals, wanted);
  const sick = useHospitalSick(hospital?.id ?? null, true);
  const pick = useHospitalPicker();

  if (list.status === "not-ready" || sick.status === "not-ready")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalNotReady onExample={onExample} testId="admin-hospital-sick-not-ready" />
      </>
    );
  if (list.status === "offline" || list.status === "error" || list.status === "signed-out")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalLoadFailed
          offline={list.status === "offline"}
          what="Your hospitals"
          message={list.status === "error" ? list.message : null}
          onRetry={list.retry}
          testId="admin-hospital-sick-list-error"
        />
      </>
    );
  if (list.status !== "loading" && !hospital)
    return (
      <>
        <HospitalHeading title={TITLE} />
        <WorkCard>
          <WorkEmpty
            icon={UserX}
            title="No hospital yet"
            body={
              administrator
                ? "Add a hospital and link its teams in People and roles, then its sick calls show here."
                : "You haven't been given a hospital yet. Ask a site administrator."
            }
            action={
              administrator ? (
                <WorkButton href={peopleAndRolesHref(null)} testId="admin-hospital-sick-no-hospital-people">
                  Open People and roles
                </WorkButton>
              ) : (
                <BackToHospital testId="admin-hospital-sick-no-hospital-back" />
              )
            }
            testId="admin-hospital-sick-no-hospital"
          />
        </WorkCard>
      </>
    );
  if (sick.status === "forbidden") return <NotForYou />;
  if (sick.status === "signed-out")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see sick calls"
          onExample={onExample}
          testId="admin-hospital-sick-signed-out"
        />
      </>
    );
  if (sick.status === "offline" || sick.status === "error")
    return (
      <>
        <HospitalHeading title={TITLE} eyebrow={hospital?.name} />
        <Picker hospitals={hospitals} current={hospital?.id ?? null} onPick={pick} />
        <HospitalLoadFailed
          offline={sick.status === "offline"}
          what="Sick calls"
          message={sick.status === "error" ? sick.message : null}
          onRetry={sick.retry}
          testId="admin-hospital-sick-error"
        />
      </>
    );
  if (sick.status !== "ok")
    return (
      <>
        <HospitalHeading title={TITLE} eyebrow={hospital?.name} />
        <Picker hospitals={hospitals} current={hospital?.id ?? null} onPick={pick} />
        <HospitalSkeleton testId="admin-hospital-sick-loading" />
      </>
    );
  return (
    <SickView
      key={sick.data.hospital.id}
      view={sick.data}
      hospitals={hospitals}
      onPick={pick}
      example={false}
      managed={managed}
    />
  );
}

/* --------------------------------------------------------------- example */

function SickExample({ wanted }: { readonly wanted: string | null }) {
  const read = useRegistryDataset("admin.hospital", true);
  if (read.status === "ready") return <SickExampleView data={read.data} wanted={wanted} />;
  return (
    <>
      <HospitalHeading title={TITLE} />
      {read.status === "error" ? (
        <HospitalExampleFailed onRetry={read.retry} testId="admin-hospital-sick-example-error" />
      ) : (
        <HospitalSkeleton testId="admin-hospital-sick-loading" />
      )}
    </>
  );
}

function SickExampleView({ data, wanted }: { readonly data: ExampleHospitalHub; readonly wanted: string | null }) {
  const hospitals = useMemo(() => data.hospitals.map((view) => view.hospital), [data]);
  const pick = useHospitalPicker();
  const hospital = pickHospital(hospitals, wanted);
  const view = data.hospitals.find((entry) => entry.hospital.id === hospital?.id) ?? data.hospitals[0]!;
  return <SickView key={view.hospital.id} view={view} hospitals={hospitals} onPick={pick} example managed={null} />;
}

/* ------------------------------------------------------------------ view */

function Picker({
  hospitals,
  current,
  onPick,
}: {
  readonly hospitals: readonly HospitalRef[];
  readonly current: string | null;
  readonly onPick: (hospitalId: string) => void;
}) {
  if (hospitals.length < 2) return null;
  return (
    <WorkChips label="Hospital" scroll>
      {hospitals.map((entry) => (
        <WorkChip
          key={entry.id}
          selected={entry.id === current}
          onClick={() => {
            if (entry.id !== current) onPick(entry.id);
          }}
          testId="admin-hospital-sick-pick"
        >
          {entry.name}
        </WorkChip>
      ))}
    </WorkChips>
  );
}

function SickView({
  view,
  hospitals,
  onPick,
  example,
  managed,
}: {
  readonly view: HospitalSickView;
  readonly hospitals: readonly HospitalRef[];
  readonly onPick: (hospitalId: string) => void;
  readonly example: boolean;
  /** Teams the reader is roster manager of. Null for the example, where calls are illustrative only. */
  readonly managed: ReadonlySet<string> | null;
}) {
  const tapFor = (
    call: HospitalSickView["calls"][number],
  ): { readonly href: string } | { readonly href?: undefined } =>
    !example && managed?.has(call.serviceId) ? { href: sickCallHref(call) } : {};
  const { zone } = useWorkTimeZone();
  const today = zonedToday(zone);
  const [team, setTeam] = useState<string | null>(null);
  const perTeam = useMemo(() => sickCallsPerTeam(view.calls), [view.calls]);
  const shown = filterSickCalls(view.calls, team);
  const days = useMemo(() => groupSickCallsByDay(shown, today, zone), [shown, today, zone]);
  const teamName = view.teams.find((entry) => entry.serviceId === team)?.name ?? null;

  return (
    <>
      <HospitalHeading title={TITLE} eyebrow={view.hospital.name} />

      <Picker hospitals={hospitals} current={view.hospital.id} onPick={onPick} />

      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        {example ? <ExampleTag /> : null}
        <span data-testid="admin-hospital-sick-summary">{sickSummaryLine(shown, today, zone)}</span>
      </p>

      {view.teams.length > 1 ? (
        <WorkChips label="Team" scroll>
          <WorkChip
            selected={team === null}
            onClick={() => setTeam(null)}
            count={view.calls.length}
            testId="admin-hospital-sick-team-all"
          >
            All teams
          </WorkChip>
          {view.teams.map((entry) => (
            <WorkChip
              key={entry.serviceId}
              selected={team === entry.serviceId}
              onClick={() => setTeam(entry.serviceId)}
              count={perTeam.get(entry.serviceId) ?? 0}
              testId="admin-hospital-sick-team"
            >
              {entry.name}
            </WorkChip>
          ))}
        </WorkChips>
      ) : null}

      {days.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={UserX}
            title={teamName ? `No sick calls for ${teamName}` : "No sick calls"}
            body={
              view.teams.length === 0
                ? "No teams are linked to this hospital yet. A site administrator links them in People and roles."
                : "Nobody has called in sick from yesterday to a week ahead."
            }
            action={
              teamName ? (
                <WorkButton variant="secondary" onClick={() => setTeam(null)} testId="admin-hospital-sick-clear">
                  Show all teams
                </WorkButton>
              ) : (
                <WorkButton variant="quiet" href={HOSPITAL_HUB_HREF} testId="admin-hospital-sick-empty-back">
                  Back to Hospital
                </WorkButton>
              )
            }
            testId="admin-hospital-sick-empty"
          />
        </WorkCard>
      ) : (
        <>
          {days.map((day) => {
            const labelId = `admin-hospital-sick-day-${day.date}`;
            return (
              <section key={day.date} aria-labelledby={labelId} className="contents">
                <WorkSectionLabel
                  id={labelId}
                  count={
                    day.needsCover > 0
                      ? `${day.needsCover} need${day.needsCover === 1 ? "s" : ""} cover`
                      : `${day.calls.length} ${day.calls.length === 1 ? "call" : "calls"}`
                  }
                >
                  {day.label}
                </WorkSectionLabel>
                <WorkCard testId="admin-hospital-sick-day">
                  {day.calls.map((call) => (
                    <WorkIconRow
                      key={call.id}
                      icon={UserX}
                      tone={HOSPITAL_SICK_STATUS_TONE[call.status]}
                      title={call.name}
                      sub={sickCallLine(call, zone)}
                      end={
                        <WorkTag tone={HOSPITAL_SICK_STATUS_TONE[call.status]}>
                          {HOSPITAL_SICK_STATUS_WORDS[call.status]}
                        </WorkTag>
                      }
                      {...tapFor(call)}
                      testId="admin-hospital-sick-call"
                    />
                  ))}
                </WorkCard>
              </section>
            );
          })}
          <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="admin-hospital-sick-manager-note">
            Each team&apos;s roster manager decides cover.
            {managed === null
              ? " Example calls are illustrative; live calls open that team's inbox."
              : managed.size > 0
                ? " Tap a call for a team you manage to open its inbox."
                : null}
          </p>
        </>
      )}

      <PaperworkFootNote testId="admin-hospital-sick-footnote">
        {example ? `These are example records. ${NO_DETAIL}` : NO_DETAIL}
      </PaperworkFootNote>
    </>
  );
}
