"use client";

import { ArrowLeftRight, Briefcase, CalendarClock, RotateCcw, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { ExampleOnlyGate } from "@/components/example-data/example-only-gate";
import { ExampleTag } from "@/components/example-data/example-tag";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
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
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldControlWithIcon, fieldIcon } from "@/components/ui-primitives";
import {
  PaperworkField,
  PaperworkFootNote,
  usePaperworkHeading,
  usePaperworkSay,
} from "@/components/work-screens/admin/paperwork-shared";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import type { ExampleWorkforce } from "@/lib/example-data/datasets/admin-workforce";
import { useExampleData } from "@/lib/example-data/store";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import {
  decideExtension,
  doctorNeedsAction,
  filterCount,
  filterDoctors,
  recordedCount,
  WORKFORCE_SAMPLE_LABEL,
  WORKFORCE_STATUS_WORDS,
  workforceCohort,
  type WorkforceDoctor,
  type WorkforceExtension,
  type WorkforceFilter,
} from "@/lib/work-screens/admin/workforce-sample";

type View = "cohort" | "doctors" | "extensions";

const FILTERS: readonly { id: WorkforceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "date-passed", label: "Date passed" },
  { id: "start-renewing", label: "Start renewing" },
  { id: "extension", label: "Extension" },
];

/**
 * Admin · Workforce (`/admin/workforce`, mockup `admin_hs*`): the health
 * service's side, for Medical Workforce staff. No workforce role or store
 * exists, so the page explains itself with a link back, and the view itself
 * is example data from the shared registry behind the example-only gate,
 * labelled on every view. Decisions made here change only this page's memory.
 */
export function AdminWorkforcePage() {
  usePaperworkHeading("Workforce", "The health service's view");
  const { active } = useExampleData("admin");
  return (
    <WorkBody testId="admin-workforce">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Workforce
      </PageTitleUnderBand>

      <WorkCard padded testId="admin-workforce-gate">
        <p className="text-sm font-semibold text-[color:var(--text-heading)]">This is the health service&apos;s side</p>
        <p className="mt-1 text-sm">
          It is for Medical Workforce staff, to see the starters, contract ends, requests and readiness doctors share
          with them. It is not live. PsychSift has no workforce accounts yet, so you are seeing it as a doctor.
        </p>
        <div className="mt-3 grid grid-cols-1">
          <WorkButton variant="secondary" href={ADMIN_PAGE_HREFS.today} testId="admin-workforce-back">
            Back to your Admin
          </WorkButton>
        </div>
      </WorkCard>

      <ExampleOnlyGate area="admin" what="Workforce">
        <WorkforceExample />
      </ExampleOnlyGate>

      {!active ? (
        <WorkCard>
          <WorkIconRow
            icon={ArrowLeftRight}
            title="What you would share"
            sub="Your side, in Sharing"
            href={ADMIN_WORK_SCREEN_HREFS.sharing}
          />
          <WorkIconRow
            icon={CalendarClock}
            title="Your requests"
            sub="Asks you send and track"
            href={ADMIN_WORK_SCREEN_HREFS.requests}
          />
        </WorkCard>
      ) : null}
    </WorkBody>
  );
}

/** The example Workforce data, read from the shared registry only while Admin's example data is on. */
function WorkforceExample() {
  const read = useRegistryDataset("admin.workforce", true);
  if (read.status === "ready") return <WorkforceExampleView data={read.data} />;
  if (read.status === "error")
    return (
      <WorkCard>
        <WorkEmpty
          icon={RotateCcw}
          title="The example didn't load"
          body="Check your connection, then try again."
          action={
            <WorkButton variant="secondary" onClick={read.retry} testId="admin-workforce-retry">
              Try again
            </WorkButton>
          }
          testId="admin-workforce-load-error"
        />
      </WorkCard>
    );
  return <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-workforce-loading" />;
}

/** The example Workforce view, with its decisions in this page's memory only. */
function WorkforceExampleView({ data }: { readonly data: ExampleWorkforce }) {
  const [view, setView] = useState<View>("cohort");
  const [filter, setFilter] = useState<WorkforceFilter>("all");
  const [query, setQuery] = useState("");
  const [extensions, setExtensions] = useState<readonly WorkforceExtension[]>(data.extensions);
  const [doctor, setDoctor] = useState<WorkforceDoctor | null>(null);
  const [nearer, setNearer] = useState<WorkforceExtension | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const say = usePaperworkSay();

  const doctors = data.doctors;
  const cohort = useMemo(() => workforceCohort(doctors, extensions), [doctors, extensions]);
  const shown = filterDoctors(doctors, filter, query);
  const nameOf = (id: string) => doctors.find((candidate) => candidate.id === id)?.name ?? "A doctor";

  function decide(extension: WorkforceExtension, decision: WorkforceExtension["decision"], to?: string) {
    setExtensions((current) => decideExtension(current, extension.id, decision, to));
    const words =
      decision === "granted"
        ? `Granted to ${formatRecordedDate(to ?? extension.askedFor)}`
        : decision === "nearer"
          ? `Offered ${formatRecordedDate(to!)}`
          : "Not granted";
    // Undo puts back this one request only, never another decision made since.
    say(`${words}. Sample only, nothing was sent`, () =>
      setExtensions((current) => current.map((entry) => (entry.id === extension.id ? extension : entry))),
    );
  }

  return (
    <>
      <div role="note" className="work-card work-card--pad grid gap-1" data-testid="admin-workforce-sample-label">
        <p>
          <ExampleTag />
        </p>
        <p className="text-sm font-semibold text-[color:var(--text-heading)]">{WORKFORCE_SAMPLE_LABEL}</p>
        <p className="text-sm">
          Every name and date below is invented. Going live needs Josh&apos;s approval for workforce accounts, a
          database change to hold shares and requests, and the doctor&apos;s sharing switch.
        </p>
      </div>

      <WorkChips label="Workforce view">
        <WorkChip selected={view === "cohort"} onClick={() => setView("cohort")} testId="admin-workforce-view-cohort">
          Cohort
        </WorkChip>
        <WorkChip
          selected={view === "doctors"}
          onClick={() => setView("doctors")}
          count={doctors.length}
          testId="admin-workforce-view-doctors"
        >
          Doctors
        </WorkChip>
        <WorkChip
          selected={view === "extensions"}
          onClick={() => setView("extensions")}
          count={cohort.extensionsWaiting}
          testId="admin-workforce-view-extensions"
        >
          Extensions
        </WorkChip>
      </WorkChips>

      {view === "cohort" ? (
        <>
          <WorkSectionLabel count={`${cohort.doctors} doctors`}>Readiness</WorkSectionLabel>
          <WorkCard testId="admin-workforce-cohort">
            <CountRow
              label="Date passed"
              sub={`${cohort.extensionsWaiting} with an extension asked`}
              value={cohort.datePassed}
              onClick={() => {
                setView("doctors");
                setFilter("date-passed");
              }}
            />
            <CountRow
              label="Start renewing"
              sub="Next 60 days"
              value={cohort.startRenewing}
              onClick={() => {
                setView("doctors");
                setFilter("start-renewing");
              }}
            />
            <CountRow label="Requested" sub="Asked by Medical Workforce" value={cohort.requested} />
            <CountRow label="Not shared" sub="No date shown" value={cohort.notShared} />
          </WorkCard>

          <WorkSectionLabel count={data.starters.length}>Starters</WorkSectionLabel>
          <WorkCard>
            {data.starters.map((starter) => (
              <WorkIconRow
                key={starter.id}
                icon={Briefcase}
                title={`${starter.name} · ${starter.role}`}
                sub={`${starter.team} · starts ${formatRecordedDate(starter.startsOn)} · ${starter.ready} of ${starter.total} shared`}
              />
            ))}
          </WorkCard>

          <WorkSectionLabel count={data.contractEnds.length}>Contract ends</WorkSectionLabel>
          <WorkCard>
            {data.contractEnds.map((end) => (
              <WorkIconRow
                key={end.id}
                icon={CalendarClock}
                title={end.name}
                sub={`${end.team} · ends ${formatRecordedDate(end.endsOn)}`}
              />
            ))}
          </WorkCard>

          <p className="text-sm text-[color:var(--text-muted)]">
            Exporting stays off in the sample, because none of it is real.
          </p>
        </>
      ) : null}

      {view === "doctors" ? (
        <>
          <div className="relative">
            <label htmlFor="admin-workforce-search" className="sr-only">
              Search name or team
            </label>
            <Search aria-hidden="true" className={fieldIcon} />
            <input
              id="admin-workforce-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or team"
              className={cn(fieldControlWithIcon, "min-h-12")}
              data-testid="admin-workforce-search"
            />
          </div>
          <WorkChips label="Filter" scroll>
            {FILTERS.map((option) => (
              <WorkChip
                key={option.id}
                selected={filter === option.id}
                onClick={() => setFilter(option.id)}
                count={filterCount(doctors, option.id)}
                testId={`admin-workforce-filter-${option.id}`}
              >
                {option.label}
              </WorkChip>
            ))}
          </WorkChips>
          <WorkSectionLabel count="Needs action first">Doctors</WorkSectionLabel>
          {shown.length === 0 ? (
            <WorkCard>
              <WorkEmpty
                icon={Users}
                title="No doctor matches"
                action={
                  <WorkButton
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear
                  </WorkButton>
                }
                testId="admin-workforce-no-match"
              />
            </WorkCard>
          ) : (
            <WorkCard testId="admin-workforce-doctors">
              {shown.map((entry) => (
                <WorkIconRow
                  key={entry.id}
                  icon={Users}
                  title={`${entry.name} · ${recordedCount(entry)} of ${entry.total}`}
                  sub={`${entry.role} · ${entry.team} · ${entry.cleared ? "cleared for start" : "clearance not yet"}${doctorNeedsAction(entry) ? ` · ${doctorNeedsAction(entry)} to act on` : " · all recorded"}`}
                  onClick={() => setDoctor(entry)}
                  testId="admin-workforce-doctor"
                />
              ))}
            </WorkCard>
          )}
        </>
      ) : null}

      {view === "extensions" ? (
        <>
          <WorkChips label="Extensions">
            <WorkChip
              selected={!showDecided}
              onClick={() => setShowDecided(false)}
              count={extensions.filter((entry) => entry.decision === "waiting").length}
            >
              Waiting
            </WorkChip>
            <WorkChip
              selected={showDecided}
              onClick={() => setShowDecided(true)}
              count={extensions.filter((entry) => entry.decision !== "waiting").length}
            >
              Decided
            </WorkChip>
          </WorkChips>
          {extensions.filter((entry) => (entry.decision === "waiting") !== showDecided).length === 0 ? (
            <WorkCard>
              <WorkEmpty
                icon={CalendarClock}
                title={showDecided ? "Nothing decided yet" : "No extensions waiting"}
                testId="admin-workforce-ext-empty"
              />
            </WorkCard>
          ) : (
            <ul className="grid gap-2" data-testid="admin-workforce-extensions">
              {extensions
                .filter((entry) => (entry.decision === "waiting") !== showDecided)
                .map((extension) => (
                  <li
                    key={extension.id}
                    className="work-card work-card--pad grid gap-2"
                    data-testid="admin-workforce-extension"
                  >
                    <p className="text-xs font-semibold text-[color:var(--text-muted)]">{nameOf(extension.doctorId)}</p>
                    <p className="text-base-minus font-semibold text-[color:var(--text-heading)]">{extension.item}</p>
                    <dl className="grid gap-1 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt>Due</dt>
                        <dd className="nums font-semibold">{formatRecordedDate(extension.dueOn)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Asked to</dt>
                        <dd className="nums font-semibold">{formatRecordedDate(extension.askedFor)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Reason</dt>
                        <dd className="font-semibold">{extension.reason}</dd>
                      </div>
                    </dl>
                    {extension.decision === "waiting" ? (
                      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
                        <WorkButton
                          onClick={() => decide(extension, "granted", extension.askedFor)}
                          testId="admin-workforce-grant"
                        >
                          Grant
                        </WorkButton>
                        <WorkButton
                          variant="secondary"
                          onClick={() => setNearer(extension)}
                          testId="admin-workforce-nearer"
                        >
                          Nearer date
                        </WorkButton>
                        <WorkButton
                          variant="quiet"
                          onClick={() => decide(extension, "declined")}
                          testId="admin-workforce-decline"
                        >
                          Do not grant
                        </WorkButton>
                      </div>
                    ) : (
                      <WorkTag tone="neutral">
                        {extension.decision === "granted"
                          ? `Granted to ${formatRecordedDate(extension.decidedTo ?? extension.askedFor)}`
                          : extension.decision === "nearer"
                            ? `Offered ${formatRecordedDate(extension.decidedTo!)}`
                            : "Not granted"}
                      </WorkTag>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </>
      ) : null}

      <PaperworkFootNote testId="admin-workforce-footnote">
        In the live version every view is logged and the doctor can see the log. Health reasons go to Staff Health and
        never show here.
      </PaperworkFootNote>

      {doctor ? (
        <Sheet
          open
          onClose={() => setDoctor(null)}
          title={doctor.name}
          description={`${doctor.role} · ${doctor.team} · ${WORKFORCE_SAMPLE_LABEL}`}
          testId="admin-workforce-doctor-sheet"
        >
          <div className="grid gap-3">
            <p className="text-sm">{`${recordedCount(doctor)} of ${doctor.total} recorded · ${doctor.cleared ? "cleared for start" : "clearance not yet"}`}</p>
            {doctor.items.length === 0 ? (
              <p className="text-sm">Everything recorded and shared.</p>
            ) : (
              <WorkCard>
                {doctor.items.map((entry) => (
                  <WorkIconRow
                    key={entry.title}
                    icon={CalendarClock}
                    tone="neutral"
                    title={entry.title}
                    sub={`${WORKFORCE_STATUS_WORDS[entry.status]}${entry.date ? ` · ${formatRecordedDate(entry.date)}` : ""} · ${entry.source}`}
                  />
                ))}
              </WorkCard>
            )}
          </div>
        </Sheet>
      ) : null}

      {nearer ? (
        <NearerSheet
          extension={nearer}
          onClose={() => setNearer(null)}
          onSave={(date) => {
            decide(nearer, "nearer", date);
            setNearer(null);
          }}
        />
      ) : null}
    </>
  );
}

function CountRow({
  label,
  sub,
  value,
  onClick,
}: {
  readonly label: string;
  readonly sub: string;
  readonly value: number;
  readonly onClick?: () => void;
}) {
  const end = <b className="nums text-base-minus">{value}</b>;
  return onClick ? (
    <WorkIconRow icon={CalendarClock} tone="neutral" title={label} sub={sub} end={end} onClick={onClick} />
  ) : (
    <WorkIconRow icon={CalendarClock} tone="neutral" title={label} sub={sub} end={end} />
  );
}

function NearerSheet({
  extension,
  onClose,
  onSave,
}: {
  readonly extension: WorkforceExtension;
  readonly onClose: () => void;
  readonly onSave: (date: string) => void;
}) {
  const [date, setDate] = useState("");
  const error = !date
    ? "Pick a date."
    : date >= extension.askedFor
      ? "Pick a date before the one asked for."
      : date <= extension.dueOn
        ? "Pick a date after it was due."
        : null;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Offer a nearer date"
      description={`${extension.item} · asked to ${formatRecordedDate(extension.askedFor)}`}
      testId="admin-workforce-nearer-sheet"
      footer={
        <WorkButton
          size="wide"
          disabled={Boolean(error)}
          onClick={() => {
            if (!error) onSave(date);
          }}
          testId="admin-workforce-nearer-save"
        >
          Offer this date
        </WorkButton>
      }
    >
      <PaperworkField
        label="New date"
        type="date"
        value={date}
        onChange={setDate}
        min={extension.dueOn}
        max={extension.askedFor}
        error={date ? error : null}
        testId="admin-workforce-nearer-date"
      />
    </Sheet>
  );
}
