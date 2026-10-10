"use client";

import { ShieldCheck, UserMinus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

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
  useHospitalShortStaffed,
} from "@/components/work-screens/hospital/hospital-shared";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { isExampleRecord } from "@/lib/example-data/guards";
import { STAFFING_COUNTS_WORDS } from "@/lib/roster/staffing/team-staffing";
import {
  HOSPITAL_HUB_HREF,
  maySeeHospitalSick,
  pickHospital,
  sickHospitals,
  type ExampleHospitalHub,
  type HospitalRef,
} from "@/lib/work-roles/hospital-hub";
import {
  anyDayJudged,
  groupShortStaffedDays,
  noSafeNumberLine,
  notRosteredLine,
  shortStaffedKindWords,
  shortStaffedSummary,
  shortStaffedTeamHref,
  shortStaffedWords,
  type HospitalShortStaffedView,
} from "@/lib/work-roles/hospital-short-staffed-view";
import type { WorkRoleGrant } from "@/lib/work-roles/model";

const TITLE = "Short-staffed days";
const NO_HOSPITALS: readonly HospitalRef[] = [];
const COUNTS_ONLY = "Counts and team names only. Who is on leave, and why, is never shown here.";

/**
 * Short-staffed days (`/admin/hospital/short-staffed`): every day from today
 * through four weeks on which a team linked to the hospital has fewer people
 * on than its safe number. For Medical Workforce and the site administrator.
 * Read only. Grouped by day, the worst team first. A day the published roster
 * does not reach yet is "not rostered yet", never short, and teams with no safe
 * number are named, so silence is never read as fine. A team links to its
 * Cover view only for that team's own roster manager.
 */
export function AdminHospitalShortStaffedPage() {
  const state = useHospitalScreenState();
  const { roles } = state;
  const searchParams = useSearchParams();
  const wanted = searchParams.get("hospitalId");

  let body;
  if (state.showExample) body = <ShortExample wanted={wanted} />;
  else if (state.signedOut)
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see short-staffed days"
          onExample={state.turnOnExample}
          testId="admin-hospital-short-signed-out"
        />
      </>
    );
  else if (roles.status === "unavailable")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalRolesUnavailable online={state.online} testId="admin-hospital-short-roles-unavailable" />
      </>
    );
  else if (roles.status !== "ready")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSkeleton testId="admin-hospital-short-loading" />
      </>
    );
  // The same people as the hospital's sick calls: Medical Workforce and the site administrator.
  else if (!maySeeHospitalSick(roles.grants)) body = <NotForYou onExample={state.turnOnExample} />;
  else
    body = (
      <ShortLive
        grants={roles.grants}
        // An example hospital left in the address after example data was turned off is not a real one.
        wanted={wanted && !isExampleRecord(wanted) ? wanted : null}
        onExample={state.turnOnExample}
      />
    );

  return <WorkBody testId="admin-hospital-short">{body}</WorkBody>;
}

function NotForYou({ onExample }: { readonly onExample?: () => void }) {
  return (
    <>
      <HospitalHeading title={TITLE} />
      <HospitalNotForYou
        title="For Medical Workforce"
        body="Short-staffed days across the hospital are for Medical Workforce and site administrators. Your own team's cover is in Manage team."
        action={<BackToHospital testId="admin-hospital-short-not-for-you-back" />}
        onExample={onExample}
        testId="admin-hospital-short-not-for-you"
      />
    </>
  );
}

/** Picking a hospital changes the address, so Back and a shared link both keep it. */
function useHospitalPicker(): (hospitalId: string) => void {
  const router = useRouter();
  return (hospitalId: string) =>
    router.replace(`/admin/hospital/short-staffed?hospitalId=${encodeURIComponent(hospitalId)}`);
}

/* ------------------------------------------------------------------ live */

function ShortLive({
  grants,
  wanted,
  onExample,
}: {
  readonly grants: readonly WorkRoleGrant[];
  readonly wanted: string | null;
  readonly onExample: () => void;
}) {
  const administrator = grants.some((grant) => grant.role === "administrator");
  const list = useAdminHospitalList(administrator);
  const listed = list.status === "ok" ? list.hospitals : NO_HOSPITALS;
  const hospitals = useMemo(() => sickHospitals(grants, listed), [grants, listed]);
  const hospital = list.status === "loading" ? null : pickHospital(hospitals, wanted);
  const read = useHospitalShortStaffed(hospital?.id ?? null);
  const pick = useHospitalPicker();

  if (list.status === "not-ready" || read.status === "not-ready")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalNotReady onExample={onExample} testId="admin-hospital-short-not-ready" />
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
          testId="admin-hospital-short-list-error"
        />
      </>
    );
  if (list.status !== "loading" && !hospital)
    return (
      <>
        <HospitalHeading title={TITLE} />
        <WorkCard>
          <WorkEmpty
            icon={UserMinus}
            title="No hospital yet"
            body={
              administrator
                ? "Add a hospital and link its teams in People and roles, then its short-staffed days show here."
                : "You haven't been given a hospital yet. Ask a site administrator."
            }
            action={<BackToHospital testId="admin-hospital-short-no-hospital-back" />}
            testId="admin-hospital-short-no-hospital"
          />
        </WorkCard>
      </>
    );
  if (read.status === "forbidden") return <NotForYou />;
  if (read.status === "signed-out")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see short-staffed days"
          onExample={onExample}
          testId="admin-hospital-short-signed-out"
        />
      </>
    );
  if (read.status === "offline" || read.status === "error")
    return (
      <>
        <HospitalHeading title={TITLE} eyebrow={hospital?.name} />
        <Picker hospitals={hospitals} current={hospital?.id ?? null} onPick={pick} />
        <HospitalLoadFailed
          offline={read.status === "offline"}
          what="Short-staffed days"
          message={read.status === "error" ? read.message : null}
          onRetry={read.retry}
          testId="admin-hospital-short-error"
        />
      </>
    );
  if (read.status !== "ok")
    return (
      <>
        <HospitalHeading title={TITLE} eyebrow={hospital?.name} />
        <Picker hospitals={hospitals} current={hospital?.id ?? null} onPick={pick} />
        <HospitalSkeleton testId="admin-hospital-short-loading" />
      </>
    );
  return (
    <ShortView
      key={read.data.hospital.id}
      view={read.data}
      hospitals={hospitals}
      grants={grants}
      onPick={pick}
      example={false}
    />
  );
}

/* --------------------------------------------------------------- example */

function ShortExample({ wanted }: { readonly wanted: string | null }) {
  const read = useRegistryDataset("admin.hospital", true);
  if (read.status === "ready") return <ShortExampleView data={read.data} wanted={wanted} />;
  return (
    <>
      <HospitalHeading title={TITLE} />
      {read.status === "error" ? (
        <HospitalExampleFailed onRetry={read.retry} testId="admin-hospital-short-example-error" />
      ) : (
        <HospitalSkeleton testId="admin-hospital-short-loading" />
      )}
    </>
  );
}

function ShortExampleView({ data, wanted }: { readonly data: ExampleHospitalHub; readonly wanted: string | null }) {
  const hospitals = useMemo(() => data.shortStaffed.map((view) => view.hospital), [data]);
  const pick = useHospitalPicker();
  const hospital = pickHospital(hospitals, wanted);
  const view = data.shortStaffed.find((entry) => entry.hospital.id === hospital?.id) ?? data.shortStaffed[0]!;
  return (
    <ShortView key={view.hospital.id} view={view} hospitals={hospitals} grants={data.grants} onPick={pick} example />
  );
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
          testId="admin-hospital-short-pick"
        >
          {entry.name}
        </WorkChip>
      ))}
    </WorkChips>
  );
}

function ShortView({
  view,
  hospitals,
  grants,
  onPick,
  example,
}: {
  readonly view: HospitalShortStaffedView;
  readonly hospitals: readonly HospitalRef[];
  readonly grants: readonly WorkRoleGrant[];
  readonly onPick: (hospitalId: string) => void;
  readonly example: boolean;
}) {
  // The server judged the window in Perth time, so its first day is "today" here too.
  const today = view.window.from;
  const dates = useMemo(() => groupShortStaffedDays(view.days, today), [view.days, today]);
  const summary = shortStaffedSummary(view);
  const noSafeNumber = noSafeNumberLine(view);
  const notRostered = notRosteredLine(view);
  const judged = anyDayJudged(view);

  return (
    <>
      <HospitalHeading title={TITLE} eyebrow={view.hospital.name} />

      <Picker hospitals={hospitals} current={view.hospital.id} onPick={onPick} />

      {summary || example ? (
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
          {example ? <ExampleTag /> : null}
          {summary ? <span data-testid="admin-hospital-short-summary">{summary}</span> : null}
        </p>
      ) : null}

      {view.teams.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={UserMinus}
            title="No teams linked yet"
            body="No teams are linked to this hospital yet. A site administrator links them in People and roles."
            action={
              <WorkButton variant="quiet" href={HOSPITAL_HUB_HREF} testId="admin-hospital-short-no-teams-back">
                Back to Hospital
              </WorkButton>
            }
            testId="admin-hospital-short-no-teams"
          />
        </WorkCard>
      ) : dates.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={judged ? ShieldCheck : UserMinus}
            title={judged ? "No team is below its safe number in the next 4 weeks" : "Nothing could be checked yet"}
            body={
              judged
                ? "Only days on a published roster, for teams with a safe number, are checked. The lines below say what wasn't."
                : "No team here has both a safe number and a published roster for the next 4 weeks, so no day could be judged."
            }
            action={
              <WorkButton variant="quiet" href={HOSPITAL_HUB_HREF} testId="admin-hospital-short-empty-back">
                Back to Hospital
              </WorkButton>
            }
            testId={judged ? "admin-hospital-short-none" : "admin-hospital-short-unchecked"}
          />
        </WorkCard>
      ) : (
        <>
          {dates.map((date) => {
            const labelId = `admin-hospital-short-day-${date.date}`;
            return (
              <section key={date.date} aria-labelledby={labelId} className="contents">
                <WorkSectionLabel
                  id={labelId}
                  count={`${date.rows.length} ${date.rows.length === 1 ? "team" : "teams"} short`}
                >
                  {date.label}
                </WorkSectionLabel>
                <WorkCard testId="admin-hospital-short-day">
                  {date.rows.map((row) => {
                    const href = shortStaffedTeamHref(row.serviceId, grants);
                    const props = {
                      icon: UserMinus,
                      tone: "red" as const,
                      title: row.teamName,
                      sub: shortStaffedWords(row),
                      end: <WorkTag tone="red">{shortStaffedKindWords(row)}</WorkTag>,
                      testId: "admin-hospital-short-team",
                    };
                    return href ? (
                      <WorkIconRow key={row.serviceId} {...props} href={href} />
                    ) : (
                      <WorkIconRow key={row.serviceId} {...props} />
                    );
                  })}
                </WorkCard>
              </section>
            );
          })}
          <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="admin-hospital-short-manager-note">
            Each team&apos;s roster manager decides cover. A team you manage opens its Cover view.
          </p>
        </>
      )}

      {noSafeNumber ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="admin-hospital-short-no-safe-number">
          {noSafeNumber}
        </p>
      ) : null}
      {notRostered ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="admin-hospital-short-not-rostered">
          {notRostered}
        </p>
      ) : null}

      <PaperworkFootNote testId="admin-hospital-short-footnote">
        {`${example ? "These are example records. " : ""}${STAFFING_COUNTS_WORDS} Needs for one grade or one site aren't judged here. ${COUNTS_ONLY}`}
      </PaperworkFootNote>
    </>
  );
}
