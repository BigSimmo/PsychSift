"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { BrowseFilters, BrowseSummary } from "@/lib/open-shifts/browse";
import { DEFAULT_FILTERS } from "@/lib/open-shifts/browse";
import { TIME_OF_DAY, TIME_OF_DAY_LABEL, gradeLabel, type TimeOfDay } from "@/lib/open-shifts/model";
import type { RosterGrade } from "@/lib/roster/team/model";

import { Switch } from "./open-shifts-ui";

/**
 * The one Filters sheet. Smallest control for each job, defaults from the
 * reader's profile, and a count beside every choice, so nothing is chosen
 * blind. The footer button says how many shifts the choices leave.
 */
export function OpenShiftsFiltersSheet({
  open,
  onClose,
  filters,
  onChange,
  summary,
  matchingCount,
  myGrade,
  rosterAsOf,
}: {
  open: boolean;
  onClose: () => void;
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
  summary: BrowseSummary;
  matchingCount: number;
  myGrade: RosterGrade | null;
  rosterAsOf: string | null;
}) {
  const toggleSite = (id: string) =>
    onChange({
      ...filters,
      siteIds: filters.siteIds.includes(id) ? filters.siteIds.filter((site) => site !== id) : [...filters.siteIds, id],
    });
  const toggleStart = (band: TimeOfDay) =>
    onChange({
      ...filters,
      starts: filters.starts.includes(band)
        ? filters.starts.filter((value) => value !== band)
        : [...filters.starts, band],
    });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      description={`${summary.matching.length} of ${summary.total} open shifts match · next 14 days`}
      testId="open-shifts-filters"
      footer={
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => onChange(DEFAULT_FILTERS)}>
            Reset
          </Button>
          <Button variant="primary" block onClick={onClose}>
            {`Show ${matchingCount} ${matchingCount === 1 ? "shift" : "shifts"}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">Hide roster clashes</p>
            <p id="os-clash-help" className="text-sm text-[color:var(--text-muted)]">
              {`Shifts that overlap your roster${rosterAsOf ? ` as of ${rosterAsOf}` : ""} (${summary.hidden.clash} hidden). Roster flags still show.`}
            </p>
          </div>
          <Switch
            checked={filters.hideClashes}
            onChange={(next) => onChange({ ...filters, hideClashes: next })}
            label="Hide roster clashes"
            describedBy="os-clash-help"
          />
        </div>

        {summary.sites.length > 0 ? (
          <fieldset className="border-t border-[color:var(--border)] pt-3">
            <legend className="flex w-full items-baseline justify-between pt-3 text-sm font-semibold text-[color:var(--text-heading)]">
              <span>Sites</span>
              <span className="text-xs font-normal text-[color:var(--text-muted)]">
                {filters.siteIds.length === 0
                  ? "All sites"
                  : `${filters.siteIds.length} of ${summary.sites.length} chosen`}
              </span>
            </legend>
            <ul className="mt-1 flex flex-col">
              {summary.sites.map((site) => {
                const checked = filters.siteIds.includes(site.id);
                const id = `os-site-${site.id}`;
                return (
                  <li
                    key={site.id}
                    className="flex min-h-12 items-center gap-3 border-t border-[color:var(--border)] first:border-t-0"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSite(site.id)}
                      className="size-5 shrink-0 accent-[color:var(--command)]"
                    />
                    <label
                      htmlFor={id}
                      className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col justify-center py-2"
                    >
                      <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{site.name}</span>
                      <span className="text-xs text-[color:var(--text-muted)]">{site.teamName}</span>
                    </label>
                    <span className="nums text-sm text-[color:var(--text-muted)]" aria-label={`${site.count} open`}>
                      {site.count}
                    </span>
                  </li>
                );
              })}
            </ul>
            {filters.siteIds.length === 0 ? (
              <p className="pt-1 text-xs text-[color:var(--text-muted)]">Nothing ticked shows every site.</p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="border-t border-[color:var(--border)]">
          <legend className="flex w-full items-baseline justify-between pt-3 text-sm font-semibold text-[color:var(--text-heading)]">
            <span>Level</span>
            <span className="text-xs font-normal text-[color:var(--text-muted)]">{`Yours: ${gradeLabel(myGrade)}`}</span>
          </legend>
          <div className="mt-2 grid grid-cols-2 rounded-md bg-[color:var(--surface-subtle)] p-0.5">
            {[
              { value: false, label: `${gradeLabel(myGrade)} only`, sub: null },
              { value: true, label: "Also lower levels", sub: `+${summary.lowerLevelCount}` },
            ].map((option) => {
              const selected = filters.includeLowerLevels === option.value;
              return (
                <label
                  key={option.label}
                  className={`flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-[0.4rem] px-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--command)] ${
                    selected
                      ? "border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-heading)] shadow-[var(--e1)] forced-colors:border-2 forced-colors:border-[Highlight]"
                      : "font-medium text-[color:var(--text-muted)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="os-level"
                    className="sr-only"
                    checked={selected}
                    onChange={() => onChange({ ...filters, includeLowerLevels: option.value })}
                  />
                  <span>{option.label}</span>
                  {option.sub ? <span className="text-2xs nums">{option.sub}</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-t border-[color:var(--border)]">
          <legend className="flex w-full items-baseline justify-between pt-3 text-sm font-semibold text-[color:var(--text-heading)]">
            <span>Starts</span>
            <span className="text-xs font-normal text-[color:var(--text-muted)]">
              {filters.starts.length === 0 ? "Any time" : `${filters.starts.length} chosen`}
            </span>
          </legend>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {TIME_OF_DAY.map((band) => {
              const pressed = filters.starts.includes(band);
              return (
                <button
                  key={band}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => toggleStart(band)}
                  className={`flex min-h-12 flex-col items-center justify-center rounded-md border px-1 text-sm ${
                    pressed
                      ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] font-semibold text-[color:var(--text-heading)]"
                      : "border-[color:var(--border-strong)] font-medium text-[color:var(--text-heading)]"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {pressed ? <Check aria-hidden="true" strokeWidth={1.6} className="size-icon-xs" /> : null}
                    {TIME_OF_DAY_LABEL[band].label}
                  </span>
                  <span className="text-2xs font-normal nums text-[color:var(--text-muted)]">
                    {`${TIME_OF_DAY_LABEL[band].range} · ${summary.startCounts[band]}`}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}
