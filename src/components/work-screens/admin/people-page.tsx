"use client";

import {
  Briefcase,
  Building2,
  CloudOff,
  GraduationCap,
  Link2,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { useSignedOut } from "@/components/mode-kit/use-signed-out-sample";
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
import {
  PaperworkFootNote,
  PaperworkOfflineNote,
  usePaperworkHeading,
  usePaperworkSay,
} from "@/components/work-screens/admin/paperwork-shared";
import {
  AddHospitalSheet,
  GiveRoleSheet,
  GrantDetailSheet,
  LinkTeamSheet,
  type PeopleRun,
} from "@/components/work-screens/admin/people-sheets";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { useAuthIfAvailable, useExampleData } from "@/lib/example-data/store";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { GrantableWorkRole, WorkRoleGrant } from "@/lib/work-roles/model";
import {
  fetchWorkPeople,
  PERSON_NOT_FOUND_MESSAGE,
  postWorkPeople,
  type WorkPeopleOutcome,
} from "@/lib/work-roles/people-client";
import {
  applyExampleAction,
  exampleResponse,
  exampleViewerGrants,
  grantedLine,
  mayRemoveGrant,
  peopleScreenAllowed,
  peopleSections,
  removeBlockedReason,
  rolesViewerMayGive,
  viewerGrants,
  type ExampleWorkPeople,
  type WorkPeopleAction,
  type WorkPeopleResponse,
} from "@/lib/work-roles/people-model";
import { resetWorkRoles, useWorkRoles } from "@/lib/work-roles/use-work-roles";

const TITLE = "People and roles";
const EXAMPLE_SAID = "Example only, nothing was saved";

/** The band's title, with the hospital's name as the line above it. */
function PeopleHeading({ hospitalName }: { readonly hospitalName?: string | null }) {
  usePaperworkHeading(TITLE, hospitalName ?? undefined);
  return (
    <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">{TITLE}</PageTitleUnderBand>
  );
}

function BackToAdmin({ variant = "secondary" }: { readonly variant?: "secondary" | "quiet" }) {
  return (
    <WorkButton variant={variant} href={ADMIN_PAGE_HREFS.today} testId="admin-people-back">
      Back to Admin
    </WorkButton>
  );
}

/**
 * Admin · People and roles (`/admin/people`): who holds Medical Workforce, the
 * DCT and supervisor roles in a hospital, which teams it covers, and the place
 * to give or remove those roles. For the site administrator, Medical
 * Workforce and the DCT. Nothing here is a permission: the server checks every
 * write again. With Admin's example data on (explicitly, or signed out) it
 * shows invented records and every change stays in page memory.
 */
export function AdminPeoplePage() {
  const roles = useWorkRoles();
  const userId = useAuthIfAvailable()?.session?.user?.id ?? null;
  const authSignedOut = useSignedOut();
  const example = useExampleData("admin");
  const online = useOnlineStatus();
  // The last answer for this account, kept while the roles are read again after a grant, so the
  // page never drops to a skeleton. Another account's answer is never reused.
  const [kept, setKept] = useState<{ userId: string | null; grants: readonly WorkRoleGrant[] } | null>(null);
  if (roles.status === "ready" && (kept?.grants !== roles.grants || kept.userId !== userId))
    setKept({ userId, grants: roles.grants });

  const signedOut = authSignedOut || roles.status === "signed-out";
  const showExample = example.active && (example.mode === "on" || signedOut);
  const keptGrants = kept && kept.userId === userId ? kept.grants : null;
  const grants = roles.status === "ready" ? roles.grants : roles.status === "loading" ? keptGrants : null;

  let body;
  if (showExample) body = <PeopleExample realGrants={signedOut ? null : grants} />;
  else if (signedOut) body = <SignedOutState onExample={example.turnOn} />;
  else if (roles.status === "unavailable") body = <RolesUnavailable online={online} />;
  else if (!grants) body = <PeopleSkeleton />;
  else if (!peopleScreenAllowed(grants)) body = <NotForYou />;
  else body = <PeopleLive grants={grants} online={online} onExample={example.turnOn} />;

  return <WorkBody testId="admin-people">{body}</WorkBody>;
}

/* ------------------------------------------------------------- states */

function PeopleSkeleton() {
  return (
    <>
      <PeopleHeading />
      <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-people-loading" />
    </>
  );
}

function SignedOutState({ onExample }: { readonly onExample: () => void }) {
  return (
    <>
      <PeopleHeading />
      <SignedOutSampleNotice title="Sign in to manage people and roles" testId="admin-people-signed-out">
        Medical Workforce, the DCT and site administrators give hospital roles here. You can also look around with
        example records, and nothing is saved.
      </SignedOutSampleNotice>
      <div className="grid grid-cols-1">
        <WorkButton variant="secondary" onClick={onExample} testId="admin-people-signed-out-example">
          Look around with example records
        </WorkButton>
      </div>
    </>
  );
}

function NotForYou() {
  return (
    <>
      <PeopleHeading />
      <WorkCard>
        <WorkEmpty
          icon={ShieldCheck}
          title={
            <span role="heading" aria-level={2}>
              For Medical Workforce and administrators
            </span>
          }
          body="Medical Workforce, the DCT and site administrators give hospital roles here. If you need a role, ask Medical Workforce at your hospital."
          action={<BackToAdmin />}
          testId="admin-people-not-for-you"
        />
      </WorkCard>
    </>
  );
}

function RolesUnavailable({ online }: { readonly online: boolean }) {
  return (
    <>
      <PeopleHeading />
      <WorkCard>
        <WorkEmpty
          icon={online ? RotateCcw : CloudOff}
          title={online ? "Your roles couldn't be checked" : "You're offline"}
          body={online ? "Something went wrong on our side. Try again shortly." : "People and roles need a connection."}
          action={
            <WorkButton variant="secondary" icon={RotateCcw} onClick={resetWorkRoles} testId="admin-people-roles-retry">
              Try again
            </WorkButton>
          }
          testId="admin-people-roles-unavailable"
        />
      </WorkCard>
    </>
  );
}

function NotReady({ onExample }: { readonly onExample: () => void }) {
  return (
    <>
      <PeopleHeading />
      <WorkCard>
        <WorkEmpty
          icon={Building2}
          title={
            <span role="heading" aria-level={2}>
              Roles can&apos;t be kept in PsychSift yet
            </span>
          }
          body="The place to keep them is still being set up. You can try every control with example records, and nothing is saved."
          action={
            <div className="grid w-full gap-2">
              <WorkButton size="wide" onClick={onExample} testId="admin-people-not-ready-example">
                Try it with example records
              </WorkButton>
              <BackToAdmin variant="quiet" />
            </div>
          }
          testId="admin-people-not-ready"
        />
      </WorkCard>
    </>
  );
}

function LoadFailed({ outcome, onRetry }: { readonly outcome: WorkPeopleOutcome; readonly onRetry: () => void }) {
  const offline = outcome.status === "offline";
  return (
    <>
      <PeopleHeading />
      <WorkCard>
        <WorkEmpty
          icon={offline ? CloudOff : RotateCcw}
          title={offline ? "You're offline" : "People and roles didn't load"}
          body={
            offline
              ? "People and roles need a connection. Try again when you're back online."
              : ((outcome.status === "error" ? outcome.message : null) ?? "Something went wrong. Try again shortly.")
          }
          action={
            <WorkButton variant="secondary" icon={RotateCcw} onClick={onRetry} testId="admin-people-retry">
              Try again
            </WorkButton>
          }
          testId={offline ? "admin-people-offline" : "admin-people-error"}
        />
      </WorkCard>
    </>
  );
}

/** A write that did not go through, in words. */
function writeProblem(outcome: Exclude<WorkPeopleOutcome, { status: "ok" }>): string {
  switch (outcome.status) {
    case "person-not-found":
      return PERSON_NOT_FOUND_MESSAGE;
    case "offline":
      return "You're offline, so nothing was changed. Try again when you're back online.";
    case "signed-out":
      return "Your session ended, so nothing was changed. Sign in again, then try.";
    case "forbidden":
      return "You don't have the role needed for this, so nothing was changed.";
    case "not-ready":
      return "Roles can't be kept in PsychSift yet, so nothing was changed.";
    case "error":
      return outcome.message ?? "That didn't go through. Try again.";
  }
}

/* --------------------------------------------------------------- live */

/** The hospital a Hospital screen link opened (`?hospitalId=`). The server still checks the reader may see it. */
function hospitalFromAddress(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("hospitalId");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function PeopleLive({
  grants,
  online,
  onExample,
}: {
  readonly grants: readonly WorkRoleGrant[];
  readonly online: boolean;
  readonly onExample: () => void;
}) {
  const [hospitalId, setHospitalId] = useState<string | null>(hospitalFromAddress);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ readonly key: string; readonly outcome: WorkPeopleOutcome } | null>(null);
  const [data, setData] = useState<WorkPeopleResponse | null>(null);
  const key = `${hospitalId ?? ""}:${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchWorkPeople(hospitalId, { signal: controller.signal }).then(
      (outcome) => {
        setRead({ key, outcome });
        if (outcome.status === "ok") setData(outcome.data);
      },
      () => {
        // Aborted: a newer read replaced this one.
      },
    );
    return () => controller.abort();
  }, [hospitalId, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const loading = read?.key !== key;

  const act = useCallback(
    async (action: WorkPeopleAction): Promise<string | null> => {
      const outcome = await postWorkPeople(action);
      if (outcome.status !== "ok") return writeProblem(outcome);
      setData(outcome.data);
      const nextId = outcome.data.hospital?.id ?? null;
      // The answer is that hospital read fresh, so it counts as this read too.
      setRead({ key: `${nextId ?? ""}:${attempt}`, outcome });
      setHospitalId(nextId);
      if (action.action === "grant" || action.action === "revoke") resetWorkRoles();
      return null;
    },
    [attempt],
  );

  const outcome = loading ? null : read!.outcome;
  if (outcome && outcome.status === "not-ready") return <NotReady onExample={onExample} />;
  if (outcome && outcome.status === "signed-out") return <SignedOutState onExample={onExample} />;
  if (outcome && outcome.status === "forbidden") return <NotForYou />;
  if (outcome && outcome.status !== "ok") return <LoadFailed outcome={outcome} onRetry={retry} />;
  if (!data) return <PeopleSkeleton />;
  return (
    <PeopleView
      data={data}
      grants={grants}
      example={false}
      online={online}
      switchingTo={loading && hospitalId !== data.hospital?.id ? hospitalId : null}
      onPickHospital={setHospitalId}
      act={act}
    />
  );
}

/* ------------------------------------------------------------ example */

function PeopleExample({ realGrants }: { readonly realGrants: readonly WorkRoleGrant[] | null }) {
  const read = useRegistryDataset("admin.people", true);
  if (read.status === "ready") return <PeopleExampleView initial={read.data} realGrants={realGrants} />;
  if (read.status === "error")
    return (
      <>
        <PeopleHeading />
        <WorkCard>
          <WorkEmpty
            icon={RotateCcw}
            title="The example didn't load"
            body="Check your connection, then try again."
            action={
              <WorkButton variant="secondary" icon={RotateCcw} onClick={read.retry} testId="admin-people-example-retry">
                Try again
              </WorkButton>
            }
            testId="admin-people-example-error"
          />
        </WorkCard>
      </>
    );
  return <PeopleSkeleton />;
}

function PeopleExampleView({
  initial,
  realGrants,
}: {
  readonly initial: ExampleWorkPeople;
  readonly realGrants: readonly WorkRoleGrant[] | null;
}) {
  // The example reader holds the same kind of role as the real one, so it shows only what they could do.
  const [who] = useState(() => exampleViewerGrants(initial, realGrants));
  const [records, setRecords] = useState<ExampleWorkPeople>(() => ({
    ...initial,
    viewer: { ...initial.viewer, administrator: who.administrator },
  }));
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const counter = useRef(0);
  const data = useMemo(() => exampleResponse(records, hospitalId), [records, hospitalId]);

  const act = useCallback(
    async (action: WorkPeopleAction): Promise<string | null> => {
      const result = applyExampleAction(records, action, {
        now: new Date().toISOString(),
        newId: (kind) => {
          counter.current += 1;
          return `example:${kind}-added-${counter.current}`;
        },
      });
      if (!result.ok) return result.problem;
      setRecords(result.state);
      setHospitalId(result.hospitalId);
      return null;
    },
    [records],
  );

  return (
    <PeopleView
      data={data}
      grants={who.grants}
      example
      online
      switchingTo={null}
      onPickHospital={setHospitalId}
      act={act}
    />
  );
}

/* --------------------------------------------------------------- view */

type OpenSheet =
  | { readonly kind: "detail"; readonly userId: string; readonly role: GrantableWorkRole }
  | { readonly kind: "give" }
  | { readonly kind: "link" }
  | { readonly kind: "hospital" };

const ROLE_ICON = { workforce: Briefcase, dct: GraduationCap, supervisor: UserCheck } as const;

function PeopleView({
  data,
  grants,
  example,
  online,
  switchingTo,
  onPickHospital,
  act,
}: {
  readonly data: WorkPeopleResponse;
  /** The viewer's own grants (real, or the example persona's). */
  readonly grants: readonly WorkRoleGrant[];
  readonly example: boolean;
  readonly online: boolean;
  /** A hospital being read, while the last one still shows. */
  readonly switchingTo: string | null;
  readonly onPickHospital: (hospitalId: string) => void;
  readonly act: (action: WorkPeopleAction) => Promise<string | null>;
}) {
  const { zone } = useWorkTimeZone();
  const auth = useAuthIfAvailable();
  const viewerEmail = example ? null : (auth?.session?.user?.email ?? null);
  const say = usePaperworkSay();
  const [sheet, setSheet] = useState<OpenSheet | null>(null);

  const { viewer, hospital } = data;
  const administrator = viewer.administrator;
  const modelGrants = useMemo(() => viewerGrants(viewer, grants), [viewer, grants]);
  const mayGive = hospital ? rolesViewerMayGive(modelGrants, viewer.userId, hospital.id, viewer.canGrant) : [];
  const sections = useMemo(() => (hospital ? peopleSections(hospital) : null), [hospital]);
  const canWrite = example || online;

  const run: PeopleRun = useCallback(
    async (action, success) => {
      const problem = await act(action);
      if (!problem) say(example ? `${success}. ${EXAMPLE_SAID}` : success);
      return problem;
    },
    [act, example, say],
  );

  const pickedHospital = switchingTo ?? hospital?.id ?? null;
  const detailGrants =
    sheet?.kind === "detail" && hospital
      ? hospital.grants.filter((grant) => grant.userId === sheet.userId && grant.role === sheet.role)
      : [];

  return (
    <>
      <PeopleHeading hospitalName={hospital?.name} />

      {!canWrite ? (
        <PaperworkOfflineNote testId="admin-people-offline-note">
          You&apos;re offline. You can look, and changes can be made once you&apos;re back online.
        </PaperworkOfflineNote>
      ) : null}

      {data.hospitals.length > 1 ? (
        <WorkChips label="Hospital" scroll>
          {data.hospitals.map((entry) => (
            <WorkChip
              key={entry.id}
              selected={entry.id === pickedHospital}
              onClick={() => {
                if (entry.id !== pickedHospital) onPickHospital(entry.id);
              }}
              testId="admin-people-hospital"
            >
              {entry.name}
            </WorkChip>
          ))}
        </WorkChips>
      ) : null}

      {!hospital ? (
        <WorkCard>
          <WorkEmpty
            icon={Building2}
            title="No hospital yet"
            body={
              administrator
                ? "Add your first hospital, then link its teams and give its roles."
                : "You haven't been given a hospital yet. Ask a site administrator."
            }
            action={
              administrator ? (
                <WorkButton
                  icon={Building2}
                  disabled={!canWrite}
                  onClick={() => setSheet({ kind: "hospital" })}
                  testId="admin-people-add-hospital-empty"
                >
                  Add a hospital
                </WorkButton>
              ) : (
                <BackToAdmin />
              )
            }
            testId="admin-people-no-hospital"
          />
        </WorkCard>
      ) : switchingTo || !sections ? (
        <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-people-switching" />
      ) : (
        <>
          {mayGive.length > 0 ? (
            <div className="grid grid-cols-1">
              <WorkButton
                size="wide"
                icon={UserPlus}
                disabled={!canWrite}
                onClick={() => setSheet({ kind: "give" })}
                testId="admin-people-give"
              >
                Give a role
              </WorkButton>
            </div>
          ) : null}

          <WorkSectionLabel count={sections.workforce.length}>Medical Workforce</WorkSectionLabel>
          <WorkCard testId="admin-people-workforce">
            {sections.workforce.length === 0 ? (
              <WorkIconRow
                icon={Briefcase}
                tone="neutral"
                title="Nobody yet"
                sub="A site administrator gives this role"
              />
            ) : (
              sections.workforce.map((grant) => (
                <WorkIconRow
                  key={grant.id}
                  icon={ROLE_ICON.workforce}
                  title={grant.name}
                  sub={grantedLine(grant, zone)}
                  onClick={() => setSheet({ kind: "detail", userId: grant.userId, role: "workforce" })}
                  testId="admin-people-row"
                />
              ))
            )}
          </WorkCard>

          <WorkSectionLabel count={sections.dct.length}>DCT</WorkSectionLabel>
          <WorkCard testId="admin-people-dct">
            {sections.dct.length === 0 ? (
              <WorkIconRow
                icon={GraduationCap}
                tone="neutral"
                title="No Director of Clinical Training yet"
                sub="Medical Workforce or a site administrator gives this role"
              />
            ) : (
              sections.dct.map((grant) => (
                <WorkIconRow
                  key={grant.id}
                  icon={ROLE_ICON.dct}
                  title={grant.name}
                  sub={`Director of Clinical Training · ${grantedLine(grant, zone)}`}
                  onClick={() => setSheet({ kind: "detail", userId: grant.userId, role: "dct" })}
                  testId="admin-people-row"
                />
              ))
            )}
          </WorkCard>

          <WorkSectionLabel count={sections.supervisors.length}>Supervisors</WorkSectionLabel>
          <WorkCard testId="admin-people-supervisors">
            {sections.supervisors.length === 0 ? (
              <WorkIconRow
                icon={UserCheck}
                tone="neutral"
                title="No supervisors yet"
                sub="A supervisor covers named trainees or a whole team"
              />
            ) : (
              sections.supervisors.map((row) => (
                <WorkIconRow
                  key={row.userId}
                  icon={ROLE_ICON.supervisor}
                  title={row.name}
                  sub={row.cover}
                  onClick={() => setSheet({ kind: "detail", userId: row.userId, role: "supervisor" })}
                  testId="admin-people-row"
                />
              ))
            )}
          </WorkCard>

          <WorkSectionLabel count={sections.teams.length}>Teams in this hospital</WorkSectionLabel>
          <WorkCard testId="admin-people-teams">
            {sections.teams.length === 0 ? (
              <WorkIconRow
                icon={Users}
                tone="neutral"
                title="No teams linked yet"
                sub={administrator ? "Link a team below" : "A site administrator links teams"}
              />
            ) : (
              sections.teams.map((team) => (
                <WorkIconRow
                  key={team.serviceId}
                  icon={Users}
                  tone="neutral"
                  title={team.name}
                  sub={
                    team.needsManager
                      ? "No roster manager"
                      : `Roster ${team.managers.length === 1 ? "manager" : "managers"} ${team.managers.join(", ")}`
                  }
                  end={team.needsManager ? <WorkTag tone="amber">Needs one</WorkTag> : undefined}
                  testId="admin-people-team"
                />
              ))
            )}
          </WorkCard>

          {administrator ? (
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <WorkButton
                variant="secondary"
                icon={Link2}
                disabled={!canWrite}
                onClick={() => setSheet({ kind: "link" })}
                testId="admin-people-link"
              >
                Link a team
              </WorkButton>
              <WorkButton
                variant="secondary"
                icon={Building2}
                disabled={!canWrite}
                onClick={() => setSheet({ kind: "hospital" })}
                testId="admin-people-add-hospital"
              >
                Add a hospital
              </WorkButton>
            </div>
          ) : null}

          <PaperworkFootNote testId="admin-people-footnote">
            {example
              ? "These are example records. Changes stay on this page and nothing is saved."
              : "Nobody can give themselves a role. Every role shows who gave it and when."}
          </PaperworkFootNote>
        </>
      )}

      {sheet?.kind === "detail" && hospital && detailGrants.length > 0 ? (
        <GrantDetailSheet
          name={detailGrants[0]!.name}
          role={sheet.role}
          grants={detailGrants}
          hospitalName={hospital.name}
          zone={zone}
          canRemove={(grant) => mayRemoveGrant(modelGrants, viewer.userId, hospital.id, grant)}
          blockedReason={(grant) => removeBlockedReason(grant, viewer.userId)}
          online={canWrite}
          run={run}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === "give" && hospital && mayGive.length > 0 ? (
        <GiveRoleSheet
          hospital={hospital}
          viewerId={viewer.userId}
          viewerEmail={viewerEmail}
          roles={mayGive}
          administrator={administrator}
          online={canWrite}
          run={run}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === "link" && hospital && administrator ? (
        <LinkTeamSheet
          hospital={hospital}
          teams={data.unlinkedTeams}
          online={canWrite}
          run={run}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === "hospital" && administrator ? (
        <AddHospitalSheet hospitals={data.hospitals} online={canWrite} run={run} onClose={() => setSheet(null)} />
      ) : null}
    </>
  );
}
