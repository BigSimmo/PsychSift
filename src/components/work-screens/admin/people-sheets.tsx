"use client";

import { Building2, Check, Link2, Search, UserMinus, UserPlus, Users } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { WorkButton, WorkCard, WorkEmpty, WorkSectionLabel } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn, fieldControlWithIcon, fieldIcon } from "@/components/ui-primitives";
import { PaperworkField } from "@/components/work-screens/admin/paperwork-shared";
import {
  isGrantableWorkRole,
  WORK_ROLE_LABEL,
  WORK_ROLE_SHORT_LABEL,
  type GrantableWorkRole,
} from "@/lib/work-roles/model";
import {
  EMAIL_MAX,
  EMPTY_GRANT_DRAFT,
  grantCoverLabel,
  grantDraftProblem,
  grantedLine,
  grantRequest,
  HOSPITAL_NAME_MAX,
  hospitalNameProblem,
  pickablePeople,
  roleSentence,
  type GrantDraft,
  type LinkableTeam,
  type PeopleGrant,
  type PeopleHospital,
  type PeopleHospitalRef,
  type WorkPeopleAction,
} from "@/lib/work-roles/people-model";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

/** Sends one change and answers with a problem in words, or null when it went through. */
export type PeopleRun = (action: WorkPeopleAction, success: string) => Promise<string | null>;

/** Above this many people, the person picker gets a search field. */
const SEARCH_FROM = 8;

/** A radio or checkbox row with a 48 px tap target, drawn as a work row. */
function ChoiceRow({
  kind,
  checked,
  title,
  sub,
  onToggle,
  testId,
}: {
  readonly kind: "radio" | "checkbox";
  readonly checked: boolean;
  readonly title: string;
  readonly sub?: string;
  readonly onToggle: () => void;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={checked}
      onClick={onToggle}
      className={cn(focusRing, "work-row w-full text-left")}
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 shrink-0 place-items-center border",
          kind === "radio" ? "rounded-full" : "rounded-md",
          checked
            ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] text-[color:var(--surface-raised)]"
            : "border-[color:var(--border-strong)]",
        )}
      >
        {checked ? <Check aria-hidden="true" className="size-icon-xs" strokeWidth={3} /> : null}
      </span>
      <span className="work-row__text">
        <span className="work-row__title">{title}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
    </button>
  );
}

function ChoiceList({
  label,
  kind,
  children,
  testId,
}: {
  readonly label: string;
  readonly kind: "radio" | "checkbox";
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <WorkCard>
      <div role={kind === "radio" ? "radiogroup" : "group"} aria-label={label} data-testid={testId}>
        {children}
      </div>
    </WorkCard>
  );
}

function Problem({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <p role="alert" className="text-sm text-[color:var(--text)]" data-testid={testId}>
      {children}
    </p>
  );
}

function OfflineLine() {
  return (
    <p role="status" className="text-sm text-[color:var(--text-muted)]">
      You&apos;re offline. Changes can be sent once you&apos;re back online.
    </p>
  );
}

/* ------------------------------------------------------------ role detail */

/**
 * One person's role in this hospital (several rows for a supervisor), with who
 * gave it and when, and Remove behind an in-page confirm step.
 */
export function GrantDetailSheet({
  name,
  role,
  grants,
  hospitalName,
  zone,
  canRemove,
  blockedReason,
  online,
  run,
  onClose,
}: {
  readonly name: string;
  readonly role: GrantableWorkRole;
  readonly grants: readonly PeopleGrant[];
  readonly hospitalName: string;
  readonly zone: string;
  readonly canRemove: (grant: PeopleGrant) => boolean;
  readonly blockedReason: (grant: PeopleGrant) => string;
  readonly online: boolean;
  readonly run: PeopleRun;
  readonly onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  async function remove(grant: PeopleGrant) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const failed = await run({ action: "revoke", grantId: grant.id }, `Role removed from ${grant.name}`);
    setBusy(false);
    if (failed) return setProblem(failed);
    setConfirming(null);
    // The last of this person's grants closes the sheet: there is nothing left to show.
    if (grants.length <= 1) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={name} description={WORK_ROLE_LABEL[role]} testId="admin-people-detail-sheet">
      <div className="grid gap-3">
        {grants.map((grant) => (
          <WorkCard key={grant.id} padded testId="admin-people-detail-grant">
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt>Covers</dt>
                <dd className="text-right font-semibold">{grantCoverLabel(grant, hospitalName)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Given</dt>
                <dd className="text-right font-semibold">{grantedLine(grant, zone)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-sm">
              {roleSentence(grant.role, {
                hospitalName,
                teamName: grant.subjectUserId ? null : grant.serviceName,
                traineeNames: grant.subjectName ? [grant.subjectName] : [],
              })}
            </p>
            <div className="mt-3 grid gap-2">
              {!canRemove(grant) ? (
                <p className="text-sm text-[color:var(--text-muted)]">{blockedReason(grant)}</p>
              ) : confirming === grant.id ? (
                <div
                  ref={confirmRef}
                  tabIndex={-1}
                  role="group"
                  aria-label="Confirm removing this role"
                  className="grid gap-2 outline-none"
                  data-testid="admin-people-remove-confirm"
                >
                  <p className="text-sm font-semibold text-[color:var(--text-heading)]">
                    {`Remove this role from ${grant.name}? They lose what it lets them see straight away.`}
                  </p>
                  <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                    <WorkButton
                      variant="amber"
                      icon={UserMinus}
                      disabled={busy || !online}
                      onClick={() => void remove(grant)}
                      testId="admin-people-remove-yes"
                    >
                      {busy ? "Removing" : "Remove"}
                    </WorkButton>
                    <WorkButton
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(null);
                        setProblem(null);
                      }}
                      testId="admin-people-remove-no"
                    >
                      Keep it
                    </WorkButton>
                  </div>
                </div>
              ) : (
                <WorkButton
                  variant="secondary"
                  icon={UserMinus}
                  disabled={!online || (confirming !== null && busy)}
                  onClick={() => {
                    setConfirming(grant.id);
                    setProblem(null);
                  }}
                  testId="admin-people-remove"
                >
                  Remove role
                </WorkButton>
              )}
              {confirming === grant.id && problem ? (
                <Problem testId="admin-people-remove-problem">{problem}</Problem>
              ) : null}
            </div>
          </WorkCard>
        ))}
        {!online ? <OfflineLine /> : null}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ give a role */

export function GiveRoleSheet({
  hospital,
  viewerId,
  viewerEmail,
  roles,
  administrator,
  online,
  run,
  onClose,
}: {
  readonly hospital: PeopleHospital;
  readonly viewerId: string;
  readonly viewerEmail: string | null;
  /** The roles this viewer may give here, never empty. */
  readonly roles: readonly GrantableWorkRole[];
  readonly administrator: boolean;
  readonly online: boolean;
  readonly run: PeopleRun;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState<GrantDraft>(() => ({
    ...EMPTY_GRANT_DRAFT,
    role: roles.length === 1 ? roles[0]! : null,
  }));
  const [query, setQuery] = useState("");
  const [changingPerson, setChangingPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const searchId = useId();

  const people = useMemo(() => pickablePeople(hospital.people, viewerId), [hospital.people, viewerId]);
  const shown = query.trim()
    ? people.filter((person) =>
        person.name.toLocaleLowerCase("en-AU").includes(query.trim().toLocaleLowerCase("en-AU")),
      )
    : people;
  const chosen = people.find((person) => person.userId === draft.userId) ?? null;
  // Nobody picks themselves, as the person or as a trainee.
  const trainees = hospital.people
    .filter((person) => person.userId !== draft.userId && person.userId !== viewerId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
  const teams = hospital.teams.slice().sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
  const problem = grantDraftProblem(draft, viewerId, { viewerEmail });
  const update = (change: Partial<GrantDraft>) => {
    setFailure(null);
    setDraft((current) => ({ ...current, ...change }));
  };
  const personLabel = chosen?.name ?? (draft.email.trim() ? draft.email.trim() : "them");

  const sentence =
    draft.role === null
      ? null
      : roleSentence(draft.role, {
          hospitalName: hospital.name,
          teamName:
            draft.role === "supervisor" && draft.cover === "team"
              ? (teams.find((team) => team.serviceId === draft.serviceId)?.name ?? null)
              : null,
          traineeNames: trainees
            .filter((person) => draft.subjectUserIds.includes(person.userId))
            .map((person) => person.name),
        });

  async function submit() {
    const request = problem ? null : grantRequest(draft, hospital.id);
    if (!request || busy) return;
    setBusy(true);
    setFailure(null);
    const failed = await run(
      request,
      `${draft.role ? WORK_ROLE_SHORT_LABEL[draft.role] : "Role"} role given to ${personLabel}`,
    );
    setBusy(false);
    if (failed) return setFailure(failed);
    onClose();
  }

  const listOpen = !chosen || changingPerson;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Give a role"
      description={hospital.name}
      testId="admin-people-give-sheet"
      footer={
        <div className="grid gap-2">
          {failure ? <Problem testId="admin-people-give-problem">{failure}</Problem> : null}
          {!failure && problem ? (
            <p aria-live="polite" className="text-sm text-[color:var(--text-muted)]">
              {problem}
            </p>
          ) : null}
          <WorkButton
            size="wide"
            icon={UserPlus}
            disabled={Boolean(problem) || busy || !online}
            onClick={() => void submit()}
            testId="admin-people-give-send"
          >
            {busy ? "Giving role" : "Give role"}
          </WorkButton>
        </div>
      }
    >
      <div className="grid gap-3">
        <WorkSectionLabel as="h3">Person</WorkSectionLabel>
        {people.length === 0 ? (
          <WorkCard>
            <WorkEmpty
              icon={Users}
              title="Nobody else is in this hospital yet"
              body={
                administrator
                  ? "People show here once they join one of its teams. You can add someone by email below."
                  : "People show here once they join one of its teams."
              }
              testId="admin-people-give-nobody"
            />
          </WorkCard>
        ) : !listOpen && chosen ? (
          <WorkCard>
            <ChoiceRow
              kind="radio"
              checked
              title={chosen.name}
              sub="Tap to pick someone else"
              onToggle={() => setChangingPerson(true)}
              testId="admin-people-give-chosen"
            />
          </WorkCard>
        ) : (
          <>
            {people.length > SEARCH_FROM ? (
              <div className="relative">
                <label htmlFor={searchId} className="sr-only">
                  Search people
                </label>
                <Search aria-hidden="true" className={fieldIcon} />
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people"
                  className={cn(fieldControlWithIcon, "min-h-12")}
                  data-testid="admin-people-give-search"
                />
              </div>
            ) : null}
            {shown.length === 0 ? (
              <p className="text-sm text-[color:var(--text-muted)]">Nobody matches. Check the spelling.</p>
            ) : (
              <ChoiceList label="Person" kind="radio" testId="admin-people-give-people">
                {shown.map((person) => (
                  <ChoiceRow
                    key={person.userId}
                    kind="radio"
                    checked={draft.userId === person.userId}
                    title={person.name}
                    onToggle={() => {
                      update({
                        userId: person.userId,
                        email: "",
                        subjectUserIds: draft.subjectUserIds.filter((id) => id !== person.userId),
                      });
                      setChangingPerson(false);
                      setQuery("");
                    }}
                    testId="admin-people-give-person"
                  />
                ))}
              </ChoiceList>
            )}
          </>
        )}
        {administrator ? (
          <PaperworkField
            label="Or by email"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={EMAIL_MAX}
            value={draft.email}
            onChange={(email) => {
              update({ email, userId: email.trim() ? null : draft.userId });
              if (email.trim()) setChangingPerson(false);
            }}
            hint="For someone in no team yet, like Medical Workforce. It is sent once and not kept on this phone."
            testId="admin-people-give-email"
          />
        ) : null}

        <WorkSectionLabel as="h3">Role</WorkSectionLabel>
        <SegmentedControl<string>
          label="Role"
          layout="equal"
          value={draft.role ?? ""}
          onChange={(value) => {
            if (isGrantableWorkRole(value)) update({ role: value });
          }}
          options={roles.map((role) => ({ value: role, label: WORK_ROLE_SHORT_LABEL[role] }))}
        />

        {draft.role === "supervisor" ? (
          <>
            <WorkSectionLabel as="h3">Supervises</WorkSectionLabel>
            <SegmentedControl<string>
              label="Supervises"
              layout="equal"
              value={draft.cover}
              onChange={(value) => update({ cover: value === "team" ? "team" : "trainees" })}
              options={[
                { value: "trainees", label: "Trainees" },
                { value: "team", label: "Whole team" },
              ]}
            />
            {draft.cover === "trainees" ? (
              trainees.length === 0 ? (
                <p className="text-sm text-[color:var(--text-muted)]">Nobody else to supervise here yet.</p>
              ) : (
                <ChoiceList label="Trainees" kind="checkbox" testId="admin-people-give-trainees">
                  {trainees.map((person) => {
                    const on = draft.subjectUserIds.includes(person.userId);
                    return (
                      <ChoiceRow
                        key={person.userId}
                        kind="checkbox"
                        checked={on}
                        title={person.name}
                        onToggle={() =>
                          update({
                            subjectUserIds: on
                              ? draft.subjectUserIds.filter((id) => id !== person.userId)
                              : [...draft.subjectUserIds, person.userId],
                          })
                        }
                        testId="admin-people-give-trainee"
                      />
                    );
                  })}
                </ChoiceList>
              )
            ) : teams.length === 0 ? (
              <p className="text-sm text-[color:var(--text-muted)]">
                {administrator ? "No teams linked yet. Link one first." : "No teams linked yet."}
              </p>
            ) : (
              <ChoiceList label="Team" kind="radio" testId="admin-people-give-teams">
                {teams.map((team) => (
                  <ChoiceRow
                    key={team.serviceId}
                    kind="radio"
                    checked={draft.serviceId === team.serviceId}
                    title={team.name}
                    onToggle={() => update({ serviceId: team.serviceId })}
                    testId="admin-people-give-team"
                  />
                ))}
              </ChoiceList>
            )}
          </>
        ) : null}

        {sentence ? (
          <>
            <WorkSectionLabel as="h3">What this lets them see</WorkSectionLabel>
            <WorkCard padded testId="admin-people-give-sentence">
              <p className="text-sm">{sentence}</p>
            </WorkCard>
          </>
        ) : null}
        {!online ? <OfflineLine /> : null}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ link a team */

export function LinkTeamSheet({
  hospital,
  teams,
  online,
  run,
  onClose,
}: {
  readonly hospital: PeopleHospital;
  readonly teams: readonly LinkableTeam[];
  readonly online: boolean;
  readonly run: PeopleRun;
  readonly onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const team = teams.find((entry) => entry.serviceId === picked) ?? null;

  async function submit() {
    if (!team || busy) return;
    setBusy(true);
    setFailure(null);
    const failed = await run(
      { action: "link-team", hospitalId: hospital.id, serviceId: team.serviceId },
      `${team.name} linked to ${hospital.name}`,
    );
    setBusy(false);
    if (failed) return setFailure(failed);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Link a team"
      description={hospital.name}
      testId="admin-people-link-sheet"
      footer={
        teams.length > 0 ? (
          <div className="grid gap-2">
            {failure ? <Problem testId="admin-people-link-problem">{failure}</Problem> : null}
            <WorkButton
              size="wide"
              icon={Link2}
              disabled={!team || busy || !online}
              onClick={() => void submit()}
              testId="admin-people-link-send"
            >
              {busy ? "Linking" : "Link team"}
            </WorkButton>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3">
        {teams.length === 0 ? (
          <WorkCard>
            <WorkEmpty
              icon={Link2}
              title="No teams to link"
              body="Every team is already linked to a hospital."
              action={
                <WorkButton variant="secondary" onClick={onClose} testId="admin-people-link-close">
                  Close
                </WorkButton>
              }
              testId="admin-people-link-empty"
            />
          </WorkCard>
        ) : (
          <>
            <p className="text-sm">
              {`A linked team's roster managers, Medical Workforce and the DCT at ${hospital.name} can then see it.`}
            </p>
            <ChoiceList label="Teams not linked yet" kind="radio" testId="admin-people-link-teams">
              {teams.map((entry) => (
                <ChoiceRow
                  key={entry.serviceId}
                  kind="radio"
                  checked={picked === entry.serviceId}
                  title={entry.name}
                  onToggle={() => {
                    setPicked(entry.serviceId);
                    setFailure(null);
                  }}
                  testId="admin-people-link-team"
                />
              ))}
            </ChoiceList>
          </>
        )}
        {!online ? <OfflineLine /> : null}
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------- add a hospital */

export function AddHospitalSheet({
  hospitals,
  online,
  run,
  onClose,
}: {
  readonly hospitals: readonly PeopleHospitalRef[];
  readonly online: boolean;
  readonly run: PeopleRun;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const problem = hospitalNameProblem(name, hospitals);
  // The field draws its own patient-detail warning, so the error line leaves that one to it.
  const patient = checkPatientDetail(name.trim(), { allowCapitals: true });
  const error = name.trim() && problem && !patient ? problem : null;

  async function submit() {
    if (problem || busy) return;
    setBusy(true);
    setFailure(null);
    const failed = await run({ action: "create-hospital", name: name.trim() }, `${name.trim()} added`);
    setBusy(false);
    if (failed) return setFailure(failed);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a hospital"
      description="Then link its teams and give its roles"
      testId="admin-people-hospital-sheet"
      footer={
        <div className="grid gap-2">
          {failure ? <Problem testId="admin-people-hospital-problem">{failure}</Problem> : null}
          <WorkButton
            size="wide"
            icon={Building2}
            disabled={Boolean(problem) || busy || !online}
            onClick={() => void submit()}
            testId="admin-people-hospital-send"
          >
            {busy ? "Adding" : "Add hospital"}
          </WorkButton>
        </div>
      }
    >
      <div className="grid gap-3">
        <PaperworkField
          label="Hospital name"
          value={name}
          onChange={(value) => {
            setName(value);
            setFailure(null);
          }}
          maxLength={HOSPITAL_NAME_MAX}
          checkPatient={{ allowCapitals: true }}
          hint="The name staff know it by."
          error={error}
          testId="admin-people-hospital-name"
        />
        {!online ? <OfflineLine /> : null}
      </div>
    </Sheet>
  );
}
