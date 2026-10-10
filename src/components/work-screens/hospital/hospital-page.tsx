"use client";

import { useMemo, useState } from "react";

import { ExampleTag } from "@/components/example-data/example-tag";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { useRosterTeams } from "@/components/roster/use-roster-team";
import { PaperworkFootNote } from "@/components/work-screens/admin/paperwork-shared";
import { HOSPITAL_LINK_ICON } from "@/components/work-screens/hospital/hospital-icons";
import {
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
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import {
  exampleTeamNames,
  hospitalSections,
  hospitalsCovered,
  pickHospital,
  sickSummaryLine,
  type ExampleHospitalHub,
  type HospitalRef,
  type HospitalPreviews,
  type HospitalSection,
} from "@/lib/work-roles/hospital-hub";
import { heldWorkRoles, WORK_ROLE_LABEL, WORK_ROLE_SHORT_LABEL, type WorkRoleGrant } from "@/lib/work-roles/model";
import { zonedToday } from "@/lib/work-time/format";

const TITLE = "Hospital";
const NO_HOSPITALS: readonly HospitalRef[] = [];

/** Rotation rounds and courses are on for everyone. Each row still shows only to a role that may use it. */
const HOSPITAL_PREVIEWS: HospitalPreviews = { rotationRounds: true, courses: true };

/**
 * Hospital (`/admin/hospital`): the one way in for people who hold a hospital
 * role. It names the roles held, lets someone covering several hospitals pick
 * one, and lists each role's screens: Medical Workforce (or the site
 * administrator), the DCT, supervisors and roster managers. Nothing here is a
 * permission: each screen it opens checks the role again on the server. With
 * Admin's example data on it shows an example reader holding every role.
 */
export function AdminHospitalPage() {
  const state = useHospitalScreenState();
  const { roles } = state;

  let body;
  if (state.showExample) body = <HubExample />;
  else if (state.signedOut)
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see your hospital screens"
          onExample={state.turnOnExample}
          testId="admin-hospital-signed-out"
        />
      </>
    );
  else if (roles.status === "unavailable")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalRolesUnavailable online={state.online} testId="admin-hospital-roles-unavailable" />
      </>
    );
  else if (roles.status !== "ready")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSkeleton testId="admin-hospital-loading" />
      </>
    );
  else if (roles.roles.length === 0)
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalNotForYou
          title="For people with a hospital role"
          body="Medical Workforce, the DCT, supervisors and roster managers find their screens here. If you need a role, ask Medical Workforce at your hospital."
          action={
            <WorkButton variant="secondary" href={ADMIN_PAGE_HREFS.today} testId="admin-hospital-no-role-back">
              Back to Admin
            </WorkButton>
          }
          onExample={state.turnOnExample}
          testId="admin-hospital-no-role"
        />
      </>
    );
  else body = <HubLive grants={roles.grants} onExample={state.turnOnExample} />;

  return <WorkBody testId="admin-hospital">{body}</WorkBody>;
}

/* ------------------------------------------------------------------ live */

function HubLive({ grants, onExample }: { readonly grants: readonly WorkRoleGrant[]; readonly onExample: () => void }) {
  const { zone } = useWorkTimeZone();
  const administrator = grants.some((grant) => grant.role === "administrator");
  const list = useAdminHospitalList(administrator);
  const listed = list.status === "ok" ? list.hospitals : NO_HOSPITALS;
  const hospitals = useMemo(() => hospitalsCovered(grants, listed), [grants, listed]);
  const [picked, setPicked] = useState<string | null>(null);
  // Wait for the administrator's list, so the sick calls are read once, for the hospital that shows.
  const hospital = list.status === "loading" ? null : pickHospital(hospitals, picked);
  const showsWorkforce = hospitalSections(grants, hospital?.id ?? null).some((section) => section.id === "workforce");
  const sick = useHospitalSick(hospital?.id ?? null, showsWorkforce);

  if (list.status === "not-ready" || sick.status === "not-ready")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalNotReady onExample={onExample} testId="admin-hospital-not-ready" />
      </>
    );
  if (list.status === "loading")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSkeleton testId="admin-hospital-loading" />
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
          testId="admin-hospital-list-error"
        />
      </>
    );

  const sickSummary =
    sick.status === "ok"
      ? sickSummaryLine(sick.data.calls, zonedToday(zone), zone)
      : sick.status === "loading"
        ? "Checking sick calls"
        : sick.status === "offline"
          ? "Needs a connection to check"
          : sick.status === "off"
            ? null
            : "Couldn't check just now";

  return (
    <HubView
      grants={grants}
      hospitals={hospitals}
      hospital={hospital}
      onPick={setPicked}
      sickSummary={sickSummary}
      example={false}
      teamNames={null}
    />
  );
}

/* --------------------------------------------------------------- example */

function HubExample() {
  const read = useRegistryDataset("admin.hospital", true);
  if (read.status === "ready") return <HubExampleView data={read.data} />;
  return (
    <>
      <HospitalHeading title={TITLE} />
      {read.status === "error" ? (
        <HospitalExampleFailed onRetry={read.retry} testId="admin-hospital-example-error" />
      ) : (
        <HospitalSkeleton testId="admin-hospital-loading" />
      )}
    </>
  );
}

function HubExampleView({ data }: { readonly data: ExampleHospitalHub }) {
  const { zone } = useWorkTimeZone();
  const hospitals = useMemo(() => data.hospitals.map((view) => view.hospital), [data]);
  const teamNames = useMemo(() => exampleTeamNames(data), [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const hospital = pickHospital(hospitals, picked);
  const calls = data.hospitals.find((view) => view.hospital.id === hospital?.id)?.calls ?? [];
  return (
    <HubView
      grants={data.grants}
      hospitals={hospitals}
      hospital={hospital}
      onPick={setPicked}
      sickSummary={sickSummaryLine(calls, zonedToday(zone), zone)}
      example
      teamNames={teamNames}
    />
  );
}

/* ------------------------------------------------------------------ view */

function HubView({
  grants,
  hospitals,
  hospital,
  onPick,
  sickSummary,
  example,
  teamNames,
}: {
  readonly grants: readonly WorkRoleGrant[];
  readonly hospitals: readonly HospitalRef[];
  readonly hospital: HospitalRef | null;
  readonly onPick: (hospitalId: string) => void;
  readonly sickSummary: string | null;
  readonly example: boolean;
  /** Team names for roster manager rows. Null reads them from Roster, which only a manager needs. */
  readonly teamNames: ReadonlyMap<string, string> | null;
}) {
  const roles = heldWorkRoles(grants);
  const previews = HOSPITAL_PREVIEWS;
  const sections = hospitalSections(grants, hospital?.id ?? null, {
    sickSummary,
    teamNames: teamNames ?? undefined,
    previews,
  });
  const hospitalWide = sections.filter((section) => section.id !== "manager");
  const managed = sections.some((section) => section.id === "manager");

  return (
    <>
      <HospitalHeading title={TITLE} eyebrow={hospital?.name} />

      <div className="flex flex-wrap items-center gap-1.5" data-testid="admin-hospital-roles">
        {example ? <ExampleTag /> : null}
        <ul className="contents" aria-label="Your roles">
          {roles.map((role) => (
            <li key={role} className="inline-flex">
              <WorkTag tone="mode">
                <span aria-hidden="true">{WORK_ROLE_SHORT_LABEL[role]}</span>
                <span className="sr-only">{WORK_ROLE_LABEL[role]}</span>
              </WorkTag>
            </li>
          ))}
        </ul>
      </div>

      {hospitals.length > 1 ? (
        <WorkChips label="Hospital" scroll>
          {hospitals.map((entry) => (
            <WorkChip
              key={entry.id}
              selected={entry.id === hospital?.id}
              onClick={() => onPick(entry.id)}
              testId="admin-hospital-pick"
            >
              {entry.name}
            </WorkChip>
          ))}
        </WorkChips>
      ) : null}

      <SectionList sections={hospitalWide} />

      {managed ? (
        teamNames ? (
          <SectionList sections={sections.filter((section) => section.id === "manager")} />
        ) : (
          <LiveManagerSections grants={grants} hospitalId={hospital?.id ?? null} previews={previews} />
        )
      ) : null}

      <PaperworkFootNote testId="admin-hospital-footnote">
        {example
          ? "These are example records. Nothing here is real, and nothing is saved."
          : "Each screen checks your role again before it shows anything."}
      </PaperworkFootNote>
    </>
  );
}

/** Roster manager rows with each team's name, read from Roster. Only mounted for a roster manager. */
function LiveManagerSections({
  grants,
  hospitalId,
  previews,
}: {
  readonly grants: readonly WorkRoleGrant[];
  readonly hospitalId: string | null;
  readonly previews: HospitalPreviews;
}) {
  const teams = useRosterTeams();
  const teamNames = useMemo(
    () => new Map((teams.data?.teams ?? []).map((team) => [team.serviceId, team.name] as const)),
    [teams.data],
  );
  const sections = hospitalSections(grants, hospitalId, { teamNames, previews }).filter(
    (section) => section.id === "manager",
  );
  return <SectionList sections={sections} />;
}

function SectionList({ sections }: { readonly sections: readonly HospitalSection[] }) {
  return (
    <>
      {sections.map((section) => {
        const labelId = `admin-hospital-section-${section.key.replace(/[^a-z0-9-]/gi, "-")}`;
        return (
          <section key={section.key} aria-labelledby={labelId} className="contents">
            <WorkSectionLabel id={labelId} count={section.note ?? undefined}>
              {section.title}
            </WorkSectionLabel>
            <WorkCard testId={`admin-hospital-${section.id}`}>
              {section.links.map((link) => (
                <WorkIconRow
                  key={link.id}
                  icon={HOSPITAL_LINK_ICON[link.icon]}
                  title={link.label}
                  sub={link.sub}
                  href={link.href}
                  testId={`admin-hospital-link-${link.icon}`}
                />
              ))}
            </WorkCard>
          </section>
        );
      })}
    </>
  );
}
