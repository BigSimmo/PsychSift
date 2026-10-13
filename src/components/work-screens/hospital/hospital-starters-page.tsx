"use client";

import { UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  useHospitalReadKey,
  useHospitalScreenState,
} from "@/components/work-screens/hospital/hospital-shared";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { isExampleRecord } from "@/lib/example-data/guards";
import { fetchHospitalStarters, type HospitalStartersOutcome } from "@/lib/work-roles/hospital-starters-client";
import {
  HOSPITAL_HUB_HREF,
  maySeeHospitalSick,
  pickHospital,
  sickHospitals,
  type HospitalRef,
} from "@/lib/work-roles/hospital-hub";
import {
  groupHospitalStarters,
  starterLine,
  starterProgressLine,
  startersSummaryLine,
  type ExampleHospitalStarters,
  type HospitalStarter,
  type HospitalStartersView,
} from "@/lib/work-roles/hospital-starters-model";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { zonedToday } from "@/lib/work-time/format";

const TITLE = "New starters";
const NO_HOSPITALS: readonly HospitalRef[] = [];
const ONLY_SHARED =
  "Only doctors who chose to share from their New job page show here. Personal items are never shared.";
const HOW_TO_SHARE =
  "Doctors choose to share from their own New job page, with Share my progress with Medical Workforce. Once one does, they show here.";

/**
 * New starters (`/admin/hospital/starters`): doctors in one hospital's teams
 * who chose to share their New job progress, for Medical Workforce and the site
 * administrator (`starters.view`, the same people who see the hospital's sick
 * calls). Nearest start date first. Starters who began more than four weeks
 * ago are folded away. Nothing here is kept on the device.
 */
export function AdminHospitalStartersPage() {
  const state = useHospitalScreenState();
  const { roles } = state;
  const searchParams = useSearchParams();
  const wanted = searchParams.get("hospitalId");

  let body;
  if (state.showExample) body = <StartersExample wanted={wanted} />;
  else if (state.signedOut)
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see new starters"
          onExample={state.turnOnExample}
          testId="admin-hospital-starters-signed-out"
        />
      </>
    );
  else if (roles.status === "unavailable")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalRolesUnavailable online={state.online} testId="admin-hospital-starters-roles-unavailable" />
      </>
    );
  else if (roles.status !== "ready")
    body = (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSkeleton testId="admin-hospital-starters-loading" />
      </>
    );
  // `starters.view` is held by exactly the people who see sick calls: Medical Workforce and the administrator.
  else if (!maySeeHospitalSick(roles.grants)) body = <NotForYou onExample={state.turnOnExample} />;
  else
    body = (
      <StartersLive
        grants={roles.grants}
        // An example hospital left in the address after example data was turned off is not a real one.
        wanted={wanted && !isExampleRecord(wanted) ? wanted : null}
        onExample={state.turnOnExample}
      />
    );

  return <WorkBody testId="admin-hospital-starters">{body}</WorkBody>;
}

function NotForYou({ onExample }: { readonly onExample?: () => void }) {
  return (
    <>
      <HospitalHeading title={TITLE} />
      <HospitalNotForYou
        title="For Medical Workforce"
        body="New starters across the hospital are for Medical Workforce and site administrators. Your own New job list is in Admin."
        action={<BackToHospital testId="admin-hospital-starters-not-for-you-back" />}
        onExample={onExample}
        testId="admin-hospital-starters-not-for-you"
      />
    </>
  );
}

/** Picking a hospital changes the address, so Back and a shared link both keep it. */
function useHospitalPicker(): (hospitalId: string) => void {
  const router = useRouter();
  return (hospitalId: string) =>
    router.replace(`/admin/hospital/starters?hospitalId=${encodeURIComponent(hospitalId)}`);
}

type StartersRead =
  | { readonly status: "off" | "loading"; readonly retry: () => void }
  | (HospitalStartersOutcome & { readonly retry: () => void });

/** One hospital's starters who share. Read fresh each time, never kept on the device. */
function useHospitalStarters(hospitalId: string | null): StartersRead {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ readonly key: string; readonly outcome: HospitalStartersOutcome } | null>(null);
  const key = useHospitalReadKey(hospitalId, attempt);
  useEffect(() => {
    if (!hospitalId) return;
    const controller = new AbortController();
    fetchHospitalStarters(hospitalId, { signal: controller.signal }).then(
      (outcome) => setRead({ key, outcome }),
      () => {
        // Aborted: a newer read replaced this one.
      },
    );
    return () => controller.abort();
  }, [hospitalId, key]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!hospitalId) return { status: "off", retry };
  if (read?.key !== key) return { status: "loading", retry };
  return { ...read.outcome, retry };
}

/* ------------------------------------------------------------------ live */

function StartersLive({
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
  const starters = useHospitalStarters(hospital?.id ?? null);
  const pick = useHospitalPicker();

  if (list.status === "not-ready" || starters.status === "not-ready")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalNotReady onExample={onExample} testId="admin-hospital-starters-not-ready" />
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
          testId="admin-hospital-starters-list-error"
        />
      </>
    );
  if (list.status !== "loading" && !hospital)
    return (
      <>
        <HospitalHeading title={TITLE} />
        <WorkCard>
          <WorkEmpty
            icon={UserPlus}
            title="No hospital yet"
            body={
              administrator
                ? "Add a hospital and link its teams in People and roles, then its new starters show here."
                : "You haven't been given a hospital yet. Ask a site administrator."
            }
            action={<BackToHospital testId="admin-hospital-starters-no-hospital-back" />}
            testId="admin-hospital-starters-no-hospital"
          />
        </WorkCard>
      </>
    );
  if (starters.status === "forbidden") return <NotForYou />;
  if (starters.status === "signed-out")
    return (
      <>
        <HospitalHeading title={TITLE} />
        <HospitalSignedOut
          title="Sign in to see new starters"
          onExample={onExample}
          testId="admin-hospital-starters-signed-out"
        />
      </>
    );
  if (starters.status === "offline" || starters.status === "error")
    return (
      <>
        <HospitalHeading title={TITLE} eyebrow={hospital?.name} />
        <Picker hospitals={hospitals} current={hospital?.id ?? null} onPick={pick} />
        <HospitalLoadFailed
          offline={starters.status === "offline"}
          what="New starters"
          message={starters.status === "error" ? starters.message : null}
          onRetry={starters.retry}
          testId="admin-hospital-starters-error"
        />
      </>
    );
  if (starters.status !== "ok")
    return (
      <>
        <HospitalHeading title={TITLE} eyebrow={hospital?.name} />
        <Picker hospitals={hospitals} current={hospital?.id ?? null} onPick={pick} />
        <HospitalSkeleton testId="admin-hospital-starters-loading" />
      </>
    );
  return (
    <StartersView
      key={starters.data.hospital.id}
      view={starters.data}
      hospitals={hospitals}
      onPick={pick}
      example={false}
    />
  );
}

/* --------------------------------------------------------------- example */

function StartersExample({ wanted }: { readonly wanted: string | null }) {
  const read = useRegistryDataset("admin.hospitalStarters", true);
  if (read.status === "ready") return <StartersExampleView data={read.data} wanted={wanted} />;
  return (
    <>
      <HospitalHeading title={TITLE} />
      {read.status === "error" ? (
        <HospitalExampleFailed onRetry={read.retry} testId="admin-hospital-starters-example-error" />
      ) : (
        <HospitalSkeleton testId="admin-hospital-starters-loading" />
      )}
    </>
  );
}

function StartersExampleView({
  data,
  wanted,
}: {
  readonly data: ExampleHospitalStarters;
  readonly wanted: string | null;
}) {
  const hospitals = useMemo(() => data.hospitals.map((view) => view.hospital), [data]);
  const pick = useHospitalPicker();
  const hospital = pickHospital(hospitals, wanted);
  const view = data.hospitals.find((entry) => entry.hospital.id === hospital?.id) ?? data.hospitals[0]!;
  return <StartersView key={view.hospital.id} view={view} hospitals={hospitals} onPick={pick} example />;
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
          testId="admin-hospital-starters-pick"
        >
          {entry.name}
        </WorkChip>
      ))}
    </WorkChips>
  );
}

function StarterRow({ starter, today }: { readonly starter: HospitalStarter; readonly today: string }) {
  const complete = starter.total > 0 && starter.done === starter.total;
  return (
    <li data-testid="admin-hospital-starters-row">
      <WorkIconRow
        icon={UserPlus}
        tone={complete ? "green" : "mode"}
        title={starter.name}
        sub={
          <>
            <span className="block">{starterLine(starter, today)}</span>
            {starter.toDo.length ? (
              <span className="block" data-testid="admin-hospital-starters-to-do">
                {`Still to do: ${starter.toDo.join(", ")}`}
              </span>
            ) : null}
          </>
        }
        end={<WorkTag tone={complete ? "green" : "neutral"}>{starterProgressLine(starter)}</WorkTag>}
      />
    </li>
  );
}

function StarterGroup({
  id,
  label,
  starters,
  today,
}: {
  readonly id: string;
  readonly label: string;
  readonly starters: readonly HospitalStarter[];
  readonly today: string;
}) {
  if (!starters.length) return null;
  const labelId = `admin-hospital-starters-${id}`;
  return (
    <section aria-labelledby={labelId} className="contents">
      <WorkSectionLabel id={labelId} count={starters.length}>
        {label}
      </WorkSectionLabel>
      <WorkCard as="ul" testId={`admin-hospital-starters-group-${id}`}>
        {starters.map((starter) => (
          <StarterRow key={starter.id} starter={starter} today={today} />
        ))}
      </WorkCard>
    </section>
  );
}

function StartersView({
  view,
  hospitals,
  onPick,
  example,
}: {
  readonly view: HospitalStartersView;
  readonly hospitals: readonly HospitalRef[];
  readonly onPick: (hospitalId: string) => void;
  readonly example: boolean;
}) {
  const { zone } = useWorkTimeZone();
  const today = zonedToday(zone);
  const groups = useMemo(() => groupHospitalStarters(view.starters, today), [view.starters, today]);
  const [showPast, setShowPast] = useState(false);
  const pastId = "admin-hospital-starters-past-list";

  return (
    <>
      <HospitalHeading title={TITLE} eyebrow={view.hospital.name} />

      <Picker hospitals={hospitals} current={view.hospital.id} onPick={onPick} />

      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <span data-testid="admin-hospital-starters-summary">{startersSummaryLine(view.starters)}</span>
      </p>

      {view.teams.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={UserPlus}
            title="No teams linked yet"
            body="No teams are linked to this hospital yet. A site administrator links them in People and roles."
            action={
              <WorkButton variant="quiet" href={HOSPITAL_HUB_HREF} testId="admin-hospital-starters-no-teams-back">
                Back to Hospital
              </WorkButton>
            }
            testId="admin-hospital-starters-no-teams"
          />
        </WorkCard>
      ) : view.starters.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={UserPlus}
            title="Nobody is sharing yet"
            body={HOW_TO_SHARE}
            action={
              <WorkButton variant="quiet" href={HOSPITAL_HUB_HREF} testId="admin-hospital-starters-empty-back">
                Back to Hospital
              </WorkButton>
            }
            testId="admin-hospital-starters-empty"
          />
        </WorkCard>
      ) : (
        <>
          <StarterGroup id="upcoming" label="Starting soon" starters={groups.upcoming} today={today} />
          <StarterGroup id="recent" label="Started in the last 4 weeks" starters={groups.recent} today={today} />
          <StarterGroup id="undated" label="No start date set" starters={groups.undated} today={today} />
          {groups.past.length ? (
            <section aria-labelledby="admin-hospital-starters-past" className="contents">
              <WorkSectionLabel id="admin-hospital-starters-past" count={groups.past.length}>
                Started more than 4 weeks ago
              </WorkSectionLabel>
              <div className="grid grid-cols-1">
                <button
                  type="button"
                  className="work-button"
                  data-variant="secondary"
                  aria-expanded={showPast}
                  aria-controls={pastId}
                  onClick={() => setShowPast((open) => !open)}
                  data-testid="admin-hospital-starters-past-toggle"
                >
                  {showPast ? "Hide earlier starters" : `Show ${groups.past.length} earlier`}
                </button>
              </div>
              <div id={pastId} hidden={!showPast}>
                {showPast ? (
                  <WorkCard as="ul" testId="admin-hospital-starters-group-past">
                    {groups.past.map((starter) => (
                      <StarterRow key={starter.id} starter={starter} today={today} />
                    ))}
                  </WorkCard>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}

      <PaperworkFootNote testId="admin-hospital-starters-footnote">
        {example ? `These are example records. ${ONLY_SHARED}` : ONLY_SHARED}
      </PaperworkFootNote>
    </>
  );
}
