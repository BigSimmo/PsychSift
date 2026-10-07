"use client";

import { CheckCircle2, FileText, Lock, Paperclip, Plus, WifiOff } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDateRow,
  WorkDock,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { cn, textMuted } from "@/components/ui-primitives";
import type { CmeEntry } from "@/lib/cme/types";
import { useOnlineStatus } from "@/lib/use-online-status";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import {
  EVIDENCE_CATEGORY_FILTERS,
  EVIDENCE_STATUS_FILTERS,
  attachTarget,
  dateTile,
  evidenceHref,
  evidenceRowLine,
  evidenceView,
  fileCountWords,
  type EvidenceCategoryFilter,
  type EvidenceOrder,
  type EvidenceRow,
  type EvidenceStatusFilter,
} from "@/lib/work-screens/cpd/evidence";

/** Rows shown in "Has evidence" before "Show all". */
export const ATTACHED_PREVIEW = 8;

export type CpdEvidencePageProps = {
  readonly entries: readonly CmeEntry[];
  readonly year: number;
  /** The years the owner has, newest first, for the year chips. */
  readonly years: readonly number[];
  readonly demoMode: boolean;
  /** "unconfigured": the year has no confirmed targets, so it holds no activities yet. */
  readonly unconfigured?: boolean;
  readonly initialCategory?: EvidenceCategoryFilter;
  readonly initialStatus?: EvidenceStatusFilter;
};

function CountTile({ value, label, testId }: { value: number; label: string; testId: string }) {
  return (
    <WorkCard padded testId={testId} className="grid min-w-0 gap-0.5 text-center">
      <b className="nums text-2xl font-semibold leading-none text-[color:var(--text-heading)]">{value}</b>
      <span className={cn(textMuted, "text-xs")}>{label}</span>
    </WorkCard>
  );
}

function rowFor(row: EvidenceRow, offline: boolean) {
  const tile = dateTile(row.date);
  const end =
    row.state === "missing" ? (
      offline ? (
        <WorkTag tone="neutral">Offline</WorkTag>
      ) : (
        <WorkTag tone="amber">Attach</WorkTag>
      )
    ) : row.state === "attached" ? (
      <WorkTag tone="green">{fileCountWords(row.files)}</WorkTag>
    ) : (
      <WorkTag tone="neutral">Not counted</WorkTag>
    );
  return (
    <li key={row.id} className="min-w-0">
      <WorkDateRow
        month={tile.month}
        day={tile.day}
        title={row.title}
        sub={evidenceRowLine(row)}
        end={end}
        href={row.href}
        testId={`cpd-evidence-row-${row.id}`}
      />
    </li>
  );
}

/**
 * CPD Evidence, `/cme/evidence` (mock-up cpd_evidence). Counts for the year, the activities that still
 * need a certificate (each opens the activity at its evidence section, where files are added under the
 * existing upload rules), and the ones that already have files. Filters for type and year; the filter
 * sits in the address so Back and a shared link keep it. Reads only what the CPD loader already holds.
 */
export function CpdEvidencePage({
  entries,
  year,
  years,
  demoMode,
  unconfigured = false,
  initialCategory = "all",
  initialStatus = "all",
}: CpdEvidencePageProps) {
  const online = useOnlineStatus();
  const offline = !online;
  const [category, setCategory] = useState<EvidenceCategoryFilter>(initialCategory);
  const [status, setStatus] = useState<EvidenceStatusFilter>(initialStatus);
  const [order, setOrder] = useState<EvidenceOrder>("newest");
  const [showAll, setShowAll] = useState(false);
  const needsRef = useRef<HTMLElement>(null);
  const view = useMemo(
    () => evidenceView(entries, year, { category, status, order }),
    [entries, year, category, status, order],
  );
  useModeBandHeading({
    eyebrow: view.total ? `${view.attached} of ${view.total} activities` : `Year ${year}`,
    title: "Evidence",
  });

  const remember = useCallback(
    (next: { category?: EvidenceCategoryFilter; status?: EvidenceStatusFilter }) => {
      const href = evidenceHref({ year, category: next.category ?? category, status: next.status ?? status });
      try {
        window.history.replaceState(window.history.state, "", href);
      } catch {
        // The address is a convenience; the filter still applies on the page.
      }
    },
    [category, status, year],
  );

  const target = attachTarget(view);
  const attachedShown = showAll ? view.has : view.has.slice(0, ATTACHED_PREVIEW);
  const yearChips = [...new Set([year, ...years])].sort((a, b) => b - a);
  const filtered = category !== "all" || status !== "all";

  return (
    <main className="min-w-0" data-testid="cpd-evidence-page">
      <WorkBody>
        <h1 className="sr-only">Evidence for {year}</h1>
        {demoMode ? (
          <p className={cn(textMuted, "text-sm")} data-testid="cpd-evidence-demo">
            Synthetic demonstration. Evidence is not stored or counted in the demo.
          </p>
        ) : null}
        {offline ? (
          <WorkCard padded testId="cpd-evidence-offline">
            <p className="flex items-start gap-2 text-sm text-[color:var(--text)]">
              <WifiOff aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" strokeWidth={1.8} />
              <span>You&apos;re offline. This is the list as it last loaded. Attaching a file needs a connection.</span>
            </p>
          </WorkCard>
        ) : null}

        {yearChips.length > 1 ? (
          <WorkChips scroll label="Year">
            {yearChips.map((y) => (
              <WorkChip key={y} href={evidenceHref({ year: y, category, status })} current={y === year}>
                {String(y)}
              </WorkChip>
            ))}
          </WorkChips>
        ) : null}

        {unconfigured || view.total === 0 ? (
          <WorkEmpty
            icon={FileText}
            title={`No activities logged in ${year}`}
            body="Evidence is added to an activity. Log one first, then attach its certificate."
            action={
              unconfigured ? (
                <WorkButton href={`/cme/setup?year=${year}`} testId="cpd-evidence-setup">
                  Set up your year
                </WorkButton>
              ) : demoMode ? null : (
                <WorkButton href="/cme/new" icon={Plus} testId="cpd-evidence-log">
                  Log an activity
                </WorkButton>
              )
            }
            testId="cpd-evidence-empty"
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2" data-testid="cpd-evidence-counts">
              <CountTile value={view.total} label="Activities" testId="cpd-evidence-count-total" />
              <CountTile value={view.attached} label="With evidence" testId="cpd-evidence-count-attached" />
              <CountTile value={view.missing} label="Missing" testId="cpd-evidence-count-missing" />
            </div>

            <WorkChips scroll label="Type">
              {EVIDENCE_CATEGORY_FILTERS.map((f) => (
                <WorkChip
                  key={f.id}
                  selected={category === f.id}
                  onClick={() => {
                    setCategory(f.id);
                    setShowAll(false);
                    remember({ category: f.id });
                  }}
                  testId={`cpd-evidence-type-${f.id}`}
                >
                  {f.label}
                </WorkChip>
              ))}
            </WorkChips>
            <WorkChips scroll label="Show">
              {EVIDENCE_STATUS_FILTERS.map((f) => (
                <WorkChip
                  key={f.id}
                  selected={status === f.id}
                  count={view.typeCounts[f.id]}
                  onClick={() => {
                    setStatus(f.id);
                    remember({ status: f.id });
                  }}
                  testId={`cpd-evidence-show-${f.id}`}
                >
                  {f.label}
                </WorkChip>
              ))}
              <WorkChip
                selected={order === "oldest"}
                onClick={() => setOrder(order === "oldest" ? "newest" : "oldest")}
                testId="cpd-evidence-order"
              >
                Oldest first
              </WorkChip>
            </WorkChips>

            {status !== "attached" ? (
              <section
                ref={needsRef}
                tabIndex={-1}
                className="grid min-w-0 gap-1.5 outline-none"
                aria-labelledby="cpd-evidence-needs"
              >
                <WorkSectionLabel id="cpd-evidence-needs" count={view.needs.length}>
                  Needs evidence
                </WorkSectionLabel>
                {view.needs.length ? (
                  <WorkCard as="ul" testId="cpd-evidence-needs-list">
                    {view.needs.map((row) => rowFor(row, offline))}
                  </WorkCard>
                ) : (
                  <WorkEmpty
                    icon={CheckCircle2}
                    title={filtered ? "Nothing here needs evidence" : "Every activity has evidence"}
                    body={filtered ? "Try another type to see the rest." : undefined}
                    testId="cpd-evidence-all-done"
                  />
                )}
              </section>
            ) : null}

            {status !== "missing" && view.has.length ? (
              <section className="grid min-w-0 gap-1.5" aria-labelledby="cpd-evidence-has">
                <WorkSectionLabel
                  id="cpd-evidence-has"
                  count={view.has.length}
                  action={
                    view.has.length > ATTACHED_PREVIEW
                      ? {
                          label: showAll ? "Show fewer" : `All ${view.has.length}`,
                          onClick: () => setShowAll(!showAll),
                        }
                      : undefined
                  }
                >
                  Has evidence
                </WorkSectionLabel>
                <WorkCard as="ul" testId="cpd-evidence-has-list">
                  {attachedShown.map((row) => rowFor(row, offline))}
                </WorkCard>
              </section>
            ) : null}

            {view.notCounted.length ? (
              <section className="grid min-w-0 gap-1.5" aria-labelledby="cpd-evidence-unknown">
                <WorkSectionLabel id="cpd-evidence-unknown" count={view.notCounted.length}>
                  Evidence not counted
                </WorkSectionLabel>
                <WorkCard as="ul" testId="cpd-evidence-unknown-list">
                  {view.notCounted.map((row) => rowFor(row, offline))}
                </WorkCard>
              </section>
            ) : null}

            <WorkCard as="ul">
              <li className="min-w-0">
                <WorkIconRow
                  icon={Paperclip}
                  title="See them in the log"
                  sub="The log filtered to activities with no evidence"
                  href={`/cme/log?fix=evidence&year=${year}`}
                />
              </li>
              <li className="min-w-0">
                <WorkIconRow icon={FileText} title="Year check" sub="Every target and record check" href="/cme/check" />
              </li>
            </WorkCard>
          </>
        )}

        <p className={cn(textMuted, "flex items-center justify-center gap-1.5 text-center text-xs")}>
          <Lock aria-hidden="true" className="size-icon-xs shrink-0" strokeWidth={1.8} />
          Check every file is free of patient details first
        </p>
        <p className={cn(textMuted, "text-center text-xs")}>
          A certificate counts as evidence here. Files stay on their own activity. A link is not evidence of attendance.
        </p>

        {target && !offline && !demoMode ? (
          <WorkDock aria-label="Evidence actions">
            {target.kind === "entry" ? (
              <WorkButton href={target.href} icon={Paperclip} testId="cpd-evidence-attach">
                Attach evidence
              </WorkButton>
            ) : (
              <WorkButton
                icon={Paperclip}
                onClick={() => {
                  if (status === "attached") {
                    setStatus("all");
                    remember({ status: "all" });
                  }
                  window.requestAnimationFrame(() => {
                    needsRef.current?.scrollIntoView({ block: "start", behavior: resolveScrollBehavior() });
                    needsRef.current?.focus({ preventScroll: true });
                  });
                }}
                testId="cpd-evidence-attach"
              >
                Attach evidence
              </WorkButton>
            )}
          </WorkDock>
        ) : null}
      </WorkBody>
    </main>
  );
}
