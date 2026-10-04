"use client";

import { Info } from "lucide-react";
import { useMemo, useState } from "react";

import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import { cn, textMuted } from "@/components/ui-primitives";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import { onCallDetailsSchemaFor, type OnCallEntry } from "@/lib/on-call/entry-model";
import {
  coverageRank,
  matchReferralCoverage,
  type CoverageVerdict,
  type ReferralCoverageFacts,
} from "@/lib/on-call/referral-coverage";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";
import { toAwstParts } from "@/lib/caring-contacts/clock";

const VERDICT_LABEL: Record<CoverageVerdict, string> = {
  takes: "Takes",
  excludes: "Excluded",
  closed: "Closed now",
  unclear: "Check",
};

const VERDICT_CLASS: Record<CoverageVerdict, string> = {
  takes: "border-[color:var(--success)] bg-[color:var(--success-soft)] text-[color:var(--success-text)]",
  excludes: "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  closed: "border-[color:var(--warning)] bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]",
  unclear: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text)]",
};

function factsOf(entry: OnCallEntry): ReferralCoverageFacts | null {
  const parsed = onCallDetailsSchemaFor("referrals").safeParse(entry.details);
  if (!parsed.success) return null;
  const details = parsed.data as ReferralCoverageFacts;
  return {
    accepts: details.accepts ?? [],
    exclusions: details.exclusions ?? [],
    catchment: details.catchment,
    hours: details.hours,
    phone: details.phone,
  };
}

/**
 * Age / suburb / time asked against the referral facts already on each service.
 * Empty age and suburb leaves the ordinary referrals list unchanged.
 */
export function WhoCoversThis({
  entries,
  now = new Date(),
}: {
  readonly entries: readonly OnCallEntry[];
  readonly now?: Date;
}) {
  const [ageText, setAgeText] = useState("");
  const [suburb, setSuburb] = useState("");
  const age = ageText.trim() === "" ? null : Number(ageText);
  const ageValid = age === null || (Number.isInteger(age) && age >= 0 && age <= 120);
  const parts = toAwstParts(now);
  const minutesNow = parts.hour * 60 + parts.minute;
  const active = ageValid && (age !== null || suburb.trim().length > 0);

  const ranked = useMemo(() => {
    if (!active) return [];
    return entries
      .filter((entry) => entry.section === "referrals")
      .map((entry) => {
        const facts = factsOf(entry);
        const match = facts
          ? matchReferralCoverage(facts, {
              age: ageValid ? age : null,
              suburb,
              minutesNow,
            })
          : { verdict: "unclear" as const, why: "Referral facts could not be read for this service." };
        return { entry, facts, match };
      })
      .sort(
        (a, b) =>
          coverageRank(a.match.verdict) - coverageRank(b.match.verdict) ||
          a.entry.sortOrder - b.entry.sortOrder ||
          a.entry.title.localeCompare(b.entry.title),
      );
  }, [active, age, ageValid, entries, minutesNow, suburb]);

  return (
    <section
      aria-labelledby="on-call-who-covers-heading"
      data-testid="on-call-who-covers"
      className="grid gap-3 rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] p-3 shadow-[var(--e2)]"
    >
      <div className="grid gap-0.5">
        <h2 id="on-call-who-covers-heading" className="text-sm font-bold text-[color:var(--text-heading)]">
          Who covers this?
        </h2>
        <p className={cn(textMuted, "text-xs")}>
          Matched against the catchment, age range, exclusions and hours you typed. Not triage — confirm with the
          service before referring.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-0.5">
          <span className="text-3xs font-bold uppercase tracking-kicker text-[color:var(--text-muted)]">Age</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            value={ageText}
            onChange={(event) => setAgeText(event.target.value)}
            placeholder="e.g. 70"
            className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-sm font-bold text-[color:var(--text-heading)]"
            data-testid="on-call-who-covers-age"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-3xs font-bold uppercase tracking-kicker text-[color:var(--text-muted)]">Suburb</span>
          <input
            type="text"
            value={suburb}
            onChange={(event) => setSuburb(event.target.value)}
            placeholder="e.g. Demo Bay"
            autoComplete="off"
            className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-sm font-bold text-[color:var(--text-heading)]"
            data-testid="on-call-who-covers-suburb"
          />
        </label>
      </div>
      <p className={cn(textMuted, "nums text-xs")} data-testid="on-call-who-covers-time">
        Time · Now ·{" "}
        {`${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`} Perth
      </p>
      {!ageValid ? (
        <p role="status" className="text-sm text-[color:var(--warning-text)]">
          Enter an age between 0 and 120, or leave age blank.
        </p>
      ) : null}
      {active ? (
        <div className="grid gap-1.5" data-testid="on-call-who-covers-results">
          <p className={cn(textMuted, "text-xs")}>
            {ranked.length} service{ranked.length === 1 ? "" : "s"} considered — excluded services stay listed.
          </p>
          {ranked.map(({ entry, facts, match }) => (
            <div
              key={entry.id}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-2.5 shadow-[var(--e1)]"
              data-testid={`on-call-who-covers-row-${entry.slug}`}
              data-verdict={match.verdict}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-bold leading-5 text-[color:var(--text-heading)]">{entry.title}</p>
                <span
                  className={cn(
                    "shrink-0 rounded-sm border px-1.5 py-0.5 text-3xs font-bold uppercase tracking-kicker",
                    VERDICT_CLASS[match.verdict],
                  )}
                >
                  {VERDICT_LABEL[match.verdict]}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-[color:var(--text)]">{match.why}</p>
              {facts?.phone ? (
                <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                  <span className="nums text-xs font-bold text-[color:var(--text-muted)]">
                    {facts.phone}
                    {facts.hours ? ` · ${facts.hours}` : ""}
                  </span>
                  {match.verdict === "takes" && onCallTelHref(facts.phone) ? (
                    <div className="flex items-center gap-1">
                      <a
                        href={onCallTelHref(facts.phone)}
                        onClick={() => recordOnCallRecent({ id: entry.id, title: entry.title })}
                        className="inline-flex min-h-tap items-center gap-1 rounded-sm bg-[color:var(--command)] px-2.5 text-2xs font-bold text-[color:var(--command-contrast)]"
                        data-testid={`on-call-who-covers-call-${entry.slug}`}
                      >
                        Call
                      </a>
                      <OnCallCopyNumber value={facts.phone} label={`Copy number for ${entry.title}`} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          <p className="mt-1 flex items-start gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2.5 text-2xs leading-4 text-[color:var(--text-muted)]">
            <Info aria-hidden="true" className="mt-px size-icon-sm shrink-0" />
            <span>
              Age and suburb stay on this phone. They are matched only against the facts you typed into each service.
            </span>
          </p>
        </div>
      ) : null}
    </section>
  );
}
