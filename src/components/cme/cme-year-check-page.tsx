import { Award, BookOpen, CalendarDays, FileText, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeDomainsRing, isActivityCountRequirement } from "@/components/cme/cme-domains-ring";
import { formatSourceMonth } from "@/components/cme/cme-plan-goal-split";
import { CmeFlatList, CmeFlatRow, CmeGroup, CmeRowMark, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CmeBandHeading } from "@/components/cme/cme-work-kit";
import { WorkBody } from "@/components/mode-kit/work";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { cn } from "@/components/ui-primitives";
import {
  formatCalendarDateLong,
  formatCalendarDateShort,
  daysRemainingInCpdYear,
  formatCmeRowDate,
  perthCalendarDate,
} from "@/lib/cme/cpd-year";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
import { activeCmeYearEntries } from "@/lib/cme/export";
import { readCpdHome } from "@/lib/cme/home-choice";
import { CME_PRESET_SOURCES } from "@/lib/cme/presets";
import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import { CPD_STANDARD_RULE_TEXT, cpdRuleFromTraining, type CpdRuleLane } from "@/lib/cme/cpd-rule";
import type { TrainingPosition } from "@/lib/cme/training-timeline";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { buildCmeYearCheck, type CmeYearCheckRow } from "@/lib/cme/year-check";
import { canCloseCmeYear, CME_CLOSE_WINDOW_DAYS } from "@/lib/cme/year-close";
import { CmeExampleCsvButton } from "@/components/cme/cme-example-csv-button";

/**
 * Where the CPD rule summaries come from: the same captured, fingerprinted Medical Board registration
 * standard the Training page cites (linked through the Board page that lists it), so the two pages show one source and one checked date.
 */
const MEDICAL_BOARD_CPD_URL = CPD_CATEGORY_RULE_SET.source.listedOn;
/** The RANZCP CPD page the starting set's practice domains come from. No checked date is recorded for it. */
const RANZCP_CPD_URL = CME_PRESET_SOURCES[1].url;
const MEDICAL_BOARD_CHECKED = `checked ${formatSourceMonth(CPD_CATEGORY_RULE_SET.source.checkedOn)}`;

/** Targets in the order the report reads them; anything else follows in the order the check built it. */
const TARGET_ORDER = [
  "total",
  "requirement-educational",
  "requirement-combined",
  "requirement-peer-review",
  "requirement-domains",
  "requirement-self-evaluation",
  "requirement-plan",
];

const leadIcon = { "aria-hidden": true, strokeWidth: 1.6 } as const;

function activities(count: number): string {
  return `${count} ${count === 1 ? "activity" : "activities"}`;
}

/** Open rows first, each group otherwise in its reading order. */
function reportOrder(rows: readonly CmeYearCheckRow[]): CmeYearCheckRow[] {
  const rank = (row: CmeYearCheckRow) => {
    const index = TARGET_ORDER.indexOf(row.id);
    return index === -1 ? TARGET_ORDER.length : index;
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Number(a.row.ready) - Number(b.row.ready) || rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row);
}

/** The second line of a row: the check's own wording, with a target's condition beside an open figure. */
function reportSummary(row: CmeYearCheckRow): string {
  return row.condition && !row.ready && !row.summary.includes("·") ? `${row.summary}, ${row.condition}` : row.summary;
}

/** The quiet text action at the end of an open row, named for the row so a screen reader hears which one. */
function rowAction(row: CmeYearCheckRow, set: CmeRequirementSet): { label: string; href: string } | null {
  if (row.ready || !row.action) return null;
  if (row.id === "evidence" || row.id === "reflection") return { label: "Show", href: row.action.href };
  if (row.id === "copied") return { label: "Copy", href: row.action.href };
  const requirement = set.requirements.find((candidate) => `requirement-${candidate.id}` === row.id);
  const shape = requirement?.spec.shape;
  if (shape === "activity-count") return { label: "Tag one", href: row.action.href };
  if (shape === "task") {
    return requirement?.id === "plan"
      ? { label: "Open plan", href: row.action.href }
      : { label: "Mark done", href: row.action.href };
  }
  return { label: "Log", href: row.action.href };
}

/** The confirmed set named as the owner chose it: "RANZCP starting set", "National baseline", or their own. */
function confirmedSetName(set: CmeRequirementSet): string {
  const home = readCpdHome(set.confirmedSource);
  if (home.kind === "ranzcp") return "RANZCP starting set";
  if (home.kind === "national") return "National baseline";
  return home.name ? `${home.name} targets` : "your own targets";
}

function CheckRow({ row, set }: { row: CmeYearCheckRow; set: CmeRequirementSet }) {
  const action = rowAction(row, set);
  const actionLink = (href: string) =>
    action ? (
      <Link
        href={href}
        data-testid={`cme-check-action-${row.id}`}
        className="work-button min-h-tap shrink-0"
        data-variant="tinted"
      >
        {action.label}
        <span className="sr-only">: {row.label}</span>
      </Link>
    ) : null;
  return (
    <CmeFlatRow
      testId={`cme-check-row-${row.id}`}
      lead={<CmeRowMark state={row.ready ? "done" : "open"} />}
      title={
        <>
          {row.label}
          <span className="sr-only">{row.notChecked ? " — not checked" : row.ready ? " — done" : " — to do"}</span>
        </>
      }
      subtitle={reportSummary(row)}
      end={
        action ? (
          row.id === "evidence" ? (
            // The new work mode has a page for the certificates still to add.
            <NewWorkModeOnly fallback={actionLink(action.href)}>
              {actionLink(`/cme/evidence?year=${set.year}`)}
            </NewWorkModeOnly>
          ) : (
            actionLink(action.href)
          )
        ) : row.ready && row.group === "targets" ? (
          <span className="work-tag" data-tone="neutral">
            Reached
          </span>
        ) : undefined
      }
    />
  );
}

/** A small source line for a group label: grey book icon, who said it and when it was checked. */
function SourceLink({ href = MEDICAL_BOARD_CPD_URL, children }: { href?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        focusRing,
        "inline-flex min-h-12 items-center gap-1 whitespace-nowrap text-xs font-normal text-[color:var(--text-muted)] underline-offset-2 hover:underline",
      )}
    >
      <BookOpen {...leadIcon} className="size-3.5" />
      {children}
    </a>
  );
}

const RULE_LANES: readonly { id: CpdRuleLane | "intern"; title: string; subtitle: string }[] = [
  { id: "intern", title: "Intern, or PGY2 in an accredited programme", subtitle: "Covered by your training" },
  { id: "trainee", title: "Trainee in an accredited college programme", subtitle: "Covered by your training" },
  { id: "everyone", title: "Everyone else", subtitle: CPD_STANDARD_RULE_TEXT },
];

/**
 * REPORT — the year as an audit would read it, then what the owner hands over.
 *
 * A thin part-per-check line under the count; the targets the owner confirmed
 * and the record-keeping checks, each open row with a quiet text action at its
 * end and each done row with a grey tick; the domains ring;
 * the annual summary and its two exports; the CPD rule the training record
 * suggests (ticked, read-only; nothing ticked when it cannot be worked out), with its source; then closing the year and the settings that shape it.
 *
 * Done and open are carried by a tick or an open circle plus the words, never
 * by colour: this mode does not use red, amber or green for progress.
 */
export function CmeYearCheckPage({
  set,
  entries,
  now = new Date(),
  goalCount = null,
  trainingPosition = null,
  demoMode = false,
}: {
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  /** The instant the close window is judged against; the route passes its own clock. */
  now?: Date;
  /** The year's plan goals, or null when they were not read. */
  goalCount?: number | null;
  /** The owner's place in their training record, when it was read. */
  trainingPosition?: TrainingPosition | null;
  /** Example (or demo) records: the export route reads the account, so its CSV is never offered over them. */
  demoMode?: boolean;
}) {
  const check = buildCmeYearCheck(set, entries);
  const targets = reportOrder(check.rows.filter((row) => row.group === "targets"));
  const records = reportOrder(check.rows.filter((row) => row.group === "records"));
  const domainRequirements = set.requirements.filter(isActivityCountRequirement);
  const yearEntries = activeCmeYearEntries(entries, set.year);
  const yearHours = totalAllocatedHours(yearEntries);
  const home = readCpdHome(set.confirmedSource);
  const homeName = home.kind === "ranzcp" ? "MyCPD" : home.kind === "other" && home.name ? home.name : "your CPD home";
  const today = perthCalendarDate(now);
  const closableFrom = `${set.year}-12-${String(31 - CME_CLOSE_WINDOW_DAYS).padStart(2, "0")}`;
  const closable = canCloseCmeYear(now, set.year);
  const closed = Boolean(set.closedAt);
  const closeHref = `/cme/summary?year=${set.year}#cme-year-close-heading`;
  const summaryHref = `/cme/summary?year=${set.year}`;
  const rule = cpdRuleFromTraining(trainingPosition, { forYear: set.year, now });
  const lane = rule.lane;
  const confirmedShort = formatCalendarDateShort(set.confirmedOn);

  const openTargets = targets.filter((row) => !row.ready).length;
  const openRecords = records.filter((row) => !row.ready).length;
  const weeksLeft = Math.max(0, Math.ceil(daysRemainingInCpdYear(now, set.year) / 7));
  const weeksLabel = closed
    ? "Closed"
    : weeksLeft === 0
      ? "Year over"
      : `${weeksLeft} ${weeksLeft === 1 ? "week" : "weeks"} left`;
  const openSummary =
    openTargets + openRecords === 0
      ? "Every target and record check is done"
      : `${openTargets} ${openTargets === 1 ? "target" : "targets"} and ${openRecords} record ${
          openRecords === 1 ? "check" : "checks"
        } open`;

  return (
    <main data-testid="cme-year-check" data-mode-identity="cme" className="w-full">
      <CmeBandHeading eyebrow={`Year check · ${weeksLabel}`} title="Report" />
      <WorkBody>
        <section aria-labelledby="cme-check-heading" className="work-hero">
          <h1 id="cme-check-heading" className="work-hero__eyebrow m-0">
            Year check for {set.year} · {weeksLabel}
          </h1>
          <p data-testid="cme-check-count" className="work-hero__title nums m-0 mt-0.5">
            {check.readyCount} of {check.rows.length} checks done
          </p>
          <p className="work-hero__sub m-0" data-testid="cme-check-open-summary">
            {openSummary}
          </p>
          <div aria-hidden="true" data-testid="cme-check-progress" className="cpd-dots work-hero__foot">
            {check.rows.map((row, index) => (
              <i key={row.id} data-done={index < check.readyCount ? "true" : "false"} />
            ))}
          </div>
        </section>

        <div className="grid gap-5">
          <div className="grid gap-3.5">
            <CmeGroup
              testId="cme-check-targets"
              label={`Targets you confirmed · ${confirmedSetName(set)}, ${confirmedShort}`}
            >
              <CmeFlatList>
                {targets.map((row) => (
                  <CheckRow key={row.id} row={row} set={set} />
                ))}
              </CmeFlatList>
            </CmeGroup>

            <CmeGroup testId="cme-check-records" label="Your own record-keeping checks">
              <CmeFlatList>
                {records.map((row) => (
                  <CheckRow key={row.id} row={row} set={set} />
                ))}
              </CmeFlatList>
              <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-check-note">
                Short of something? A note can explain it, but it does not reduce the requirement.{" "}
                {closable && !closed ? (
                  <CmeTextLink href={closeHref} className="min-h-0">
                    Add a note
                  </CmeTextLink>
                ) : closed ? (
                  "Notes go on the closed year's record."
                ) : (
                  `You can add one when you close the year, from ${formatCmeRowDate(closableFrom, today)}.`
                )}
              </p>
            </CmeGroup>
          </div>

          {domainRequirements.map((requirement) => (
            <CmeDomainsRing
              key={requirement.id}
              requirement={requirement}
              entries={entries}
              year={set.year}
              source={
                requirement.id === "domains" && readCpdHome(set.confirmedSource).kind === "ranzcp" ? (
                  <SourceLink href={RANZCP_CPD_URL}>RANZCP</SourceLink>
                ) : undefined
              }
            />
          ))}

          <CmeGroup testId="cme-check-summary" label="Annual summary">
            <CmeFlatList>
              <CmeFlatRow
                lead={<FileText {...leadIcon} />}
                title={`${activities(yearEntries.length)} · ${yearHours} h${
                  goalCount === null ? "" : ` · ${goalCount} ${goalCount === 1 ? "goal" : "goals"}`
                }`}
                subtitle="A personal record, not proof you meet the standard. Your CPD home reports that."
              />
            </CmeFlatList>
            <div className="flex flex-wrap gap-x-5 pl-7">
              <CmeTextLink href={summaryHref} testId="cme-check-save-pdf">
                Save as PDF
              </CmeTextLink>
              {demoMode ? (
                // The export route reads the account, so on an example page it would hand over REAL records.
                <CmeExampleCsvButton
                  testId="cme-check-csv"
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 items-center whitespace-nowrap text-sm-minus font-medium text-[color:var(--clinical-accent)] no-underline hover:underline",
                  )}
                >
                  Download CSV
                </CmeExampleCsvButton>
              ) : (
                <a
                  href={`/api/cme/export?year=${set.year}`}
                  download
                  data-testid="cme-check-csv"
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 items-center whitespace-nowrap text-sm-minus font-medium text-[color:var(--clinical-accent)] no-underline hover:underline",
                  )}
                >
                  Download CSV
                </a>
              )}
              <NewWorkModeOnly>
                <CmeTextLink href={`/cme/export?year=${set.year}`} testId="cme-check-export">
                  All export options
                </CmeTextLink>
              </NewWorkModeOnly>
            </div>
          </CmeGroup>

          <CmeGroup
            testId="cme-check-rule"
            label="Your CPD rule"
            end={<SourceLink>Medical Board · {MEDICAL_BOARD_CHECKED}</SourceLink>}
          >
            <CmeFlatList>
              {RULE_LANES.map((option) => {
                const chosen = option.id === lane;
                return (
                  <CmeFlatRow
                    key={option.id}
                    testId={`cme-check-rule-${option.id}`}
                    muted={!chosen}
                    lead={<CmeRowMark state={chosen ? "done" : "none"} />}
                    title={
                      <>
                        {option.title}
                        {chosen ? <span className="sr-only"> — your rule</span> : null}
                      </>
                    }
                    subtitle={option.subtitle}
                  />
                );
              })}
              <CmeFlatRow
                testId="cme-check-renewal"
                href="/admin/renewals"
                lead={<ShieldCheck {...leadIcon} />}
                title={`Your next renewal asks which CPD home you used in ${set.year}`}
                subtitle="Renewals are in Admin"
              />
            </CmeFlatList>
            <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-check-rule-note">
              Not signed off: a plain summary of the Medical Board standard, {MEDICAL_BOARD_CHECKED}. {rule.basis}{" "}
              <CmeTextLink href="/cme/training" className="min-h-0">
                Check your training record
              </CmeTextLink>
            </p>
          </CmeGroup>

          <CmeGroup testId="cme-check-settings" label="Year end and settings">
            <CmeFlatList>
              <CmeFlatRow
                testId="cme-check-close"
                lead={<CalendarDays {...leadIcon} />}
                title="Close the year"
                subtitle={
                  closed
                    ? `Closed on ${formatCalendarDateLong(perthCalendarDate(new Date(set.closedAt!)))}. Closed in PsychSift only, not in ${homeName}.`
                    : closable
                      ? `Closes the year in PsychSift only, not in ${homeName}.`
                      : `From ${formatCmeRowDate(closableFrom, today)}. Closes the year in PsychSift only, not in ${homeName}.`
                }
                end={
                  closed ? (
                    <CmeTextLink href={summaryHref}>View</CmeTextLink>
                  ) : closable ? (
                    <CmeTextLink href={closeHref}>Close</CmeTextLink>
                  ) : undefined
                }
              />
              <CmeFlatRow
                testId="cme-check-setup"
                href={`/cme/setup?year=${set.year}`}
                lead={<Award {...leadIcon} />}
                title="Set up your year"
                subtitle={`${set.totalHours} h total · ${confirmedSetName(set)}, confirmed ${confirmedShort}`}
              />
              <CmeFlatRow
                testId="cme-check-customise"
                href="/cme/customise"
                lead={<SlidersHorizontal {...leadIcon} />}
                title="Customise the Year page"
                subtitle="Reorder or hide its sections"
              />
            </CmeFlatList>
          </CmeGroup>
        </div>
      </WorkBody>
    </main>
  );
}
