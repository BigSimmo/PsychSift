import Link from "next/link";
import type { ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { Chip } from "@/components/ui/chip";
import type { ChipStatusTone } from "@/components/ui/chip";
import { cn, eyebrowText } from "@/components/ui-primitives";
import type { ClinicalSourceClientEntry } from "@/lib/sources/catalogue-types";
import { projectSourceCatalogueForClient } from "@/lib/sources/catalogue-view";
import {
  CURRENCY_CHECK_MONTHS,
  SOURCE_CURRENCY_STATUS_LABELS,
  SOURCE_CURRENCY_STATUS_ORDER,
  deriveSourceCurrencyCheck,
  type SourceCurrencyCheck,
  type SourceCurrencyStatus,
  type UpcomingSourceDate,
} from "@/lib/sources/currency-check";
import { loadSourceCatalogue } from "@/lib/sources/load-source-catalogue";

/**
 * Documents · Currency check: is my copy still the latest?
 *
 * A server-rendered page with no client code of its own, so it adds nothing to
 * any other page's download. Green, amber and red mean source status only, as
 * on every clinical page. Everything shown is read from dates the catalogue
 * already records; nothing contacts a publisher.
 */

const LIST_LIMIT = 12;

const STATUS_TONE: Record<SourceCurrencyStatus, ChipStatusTone> = {
  current: "success",
  review_due: "warning",
  outdated: "danger",
  unknown: "neutral",
};

const STATUS_STROKE: Record<SourceCurrencyStatus, string> = {
  current: "var(--success)",
  review_due: "var(--warning)",
  outdated: "var(--danger)",
  unknown: "var(--border-strong, var(--border))",
};

const STATUS_DOT: Record<SourceCurrencyStatus, string> = {
  current: "bg-[color:var(--success)]",
  review_due: "bg-[color:var(--warning)]",
  outdated: "bg-[color:var(--danger)]",
  unknown: "bg-[color:var(--text-muted)]",
};

const SHORT_DATE = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG_DATE = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string, format: Intl.DateTimeFormat = SHORT_DATE) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : format.format(date);
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function catalogueHref(statuses: readonly SourceCurrencyStatus[]) {
  const params = new URLSearchParams();
  for (const status of statuses) params.append("status", status);
  params.set("sort", "currency");
  return `/sources/search?${params.toString()}`;
}

const cardClass = "grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4";

function SectionTitle({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 id={id} className="text-base font-extrabold text-[color:var(--text-heading)]">
        {title}
        {count !== undefined ? <span className="font-semibold text-[color:var(--text-muted)]"> · {count}</span> : null}
      </h2>
    </div>
  );
}

/** A segmented ring against the real total, one arc per source status. */
function CurrencyRing({ check }: { check: SourceCurrencyCheck }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const present = SOURCE_CURRENCY_STATUS_ORDER.filter((status) => check.counts[status] > 0);
  const lengthOf = (status: SourceCurrencyStatus) =>
    check.total ? (check.counts[status] / check.total) * circumference : 0;
  const arcs = present.map((status, index) => ({
    status,
    length: lengthOf(status),
    offset: present.slice(0, index).reduce((sum, previous) => sum + lengthOf(previous), 0),
  }));
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 100 100" className="size-28 -rotate-90" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-subtle)" strokeWidth="10" />
        {arcs.map((arc) => (
          <circle
            key={arc.status}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={STATUS_STROKE[arc.status]}
            strokeWidth="10"
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>
      <span className="absolute inset-0 grid place-content-center text-center">
        <span className="text-2xl font-extrabold leading-none text-[color:var(--text-heading)]">{check.total}</span>
        <span className="text-2xs font-semibold text-[color:var(--text-muted)]">sources</span>
      </span>
    </div>
  );
}

function SummaryCard({ check }: { check: SourceCurrencyCheck }) {
  return (
    <section aria-labelledby="currency-summary-heading" className={cardClass} data-testid="currency-summary">
      <SectionTitle id="currency-summary-heading" title="Is my copy still the latest?" />
      <div className="flex items-center gap-4">
        <CurrencyRing check={check} />
        <ul className="grid flex-1 gap-0.5">
          {SOURCE_CURRENCY_STATUS_ORDER.map((status) => (
            <li key={status}>
              <Link
                href={catalogueHref([status])}
                className="flex min-h-12 items-center gap-2 rounded-lg px-2 transition hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none"
              >
                <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT[status])} />
                <span className="flex-1 text-sm font-semibold text-[color:var(--text-heading)]">
                  {SOURCE_CURRENCY_STATUS_LABELS[status]}
                </span>
                <span className="text-sm font-extrabold tabular-nums text-[color:var(--text-heading)]">
                  {check.counts[status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SourceRow({ entry, children }: { entry: ClinicalSourceClientEntry; children?: ReactNode }) {
  return (
    <li>
      <Link
        href={`/sources/${entry.id}`}
        className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="line-clamp-2 text-sm font-semibold text-[color:var(--primary)]">{entry.title}</span>
          {entry.publisher ? (
            <span className="truncate text-2xs font-medium text-[color:var(--text-muted)]">{entry.publisher}</span>
          ) : null}
        </span>
        {children}
      </Link>
    </li>
  );
}

function StatusChip({ status }: { status: SourceCurrencyStatus }) {
  return (
    <Chip appearance={{ kind: "status", tone: STATUS_TONE[status] }} size="compact">
      {SOURCE_CURRENCY_STATUS_LABELS[status]}
    </Chip>
  );
}

function UpcomingTimeline({ check }: { check: SourceCurrencyCheck }) {
  const shown = check.upcoming.slice(0, LIST_LIMIT);
  return (
    <section aria-labelledby="currency-upcoming-heading" className={cardClass} data-testid="currency-upcoming">
      <SectionTitle id="currency-upcoming-heading" title="Reviews coming up" count={check.upcoming.length} />
      <ol
        aria-label={`Next ${CURRENCY_CHECK_MONTHS} months`}
        className="grid grid-cols-6 gap-1 rounded-xl bg-[color:var(--surface-subtle)] p-2"
      >
        {check.months.map((month) => (
          <li key={month.key} className="grid min-h-16 content-start justify-items-center gap-1.5">
            <span className={cn(eyebrowText, "text-2xs")}>{month.label}</span>
            <span className="flex flex-wrap justify-center gap-1" aria-hidden="true">
              {month.items.slice(0, 6).map((item) => (
                <span
                  key={`${item.entry.id}-${item.date}`}
                  className={cn("size-2 rounded-full", STATUS_DOT[item.entry.documentStatus])}
                />
              ))}
            </span>
            {month.items.length > 6 ? (
              <span className="text-2xs font-semibold text-[color:var(--text-muted)]">+{month.items.length - 6}</span>
            ) : null}
            <span className="sr-only">{plural(month.items.length, "date", "dates")}</span>
          </li>
        ))}
      </ol>
      {shown.length ? (
        <ul className="grid gap-0.5">
          {shown.map((item: UpcomingSourceDate) => (
            <SourceRow key={`${item.entry.id}-${item.date}`} entry={item.entry}>
              <span className="grid shrink-0 justify-items-end gap-0.5 text-right">
                <span className="text-xs font-extrabold tabular-nums text-[color:var(--text-heading)]">
                  {formatDate(item.date)}
                </span>
                <span className="text-2xs font-medium text-[color:var(--text-muted)]">
                  {item.kind === "expires" ? "Expires" : "Review date"}
                </span>
              </span>
            </SourceRow>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[color:var(--text-muted)]">
          No recorded review or expiry date falls in the next six months. Many sources do not record one yet.
        </p>
      )}
      {check.upcoming.length > shown.length ? (
        <p className="text-xs font-semibold text-[color:var(--text-muted)]">
          Showing the first {shown.length} of {check.upcoming.length}.
        </p>
      ) : null}
    </section>
  );
}

function ReplacedCard({ check }: { check: SourceCurrencyCheck }) {
  if (!check.replaced.length) return null;
  const shown = check.replaced.slice(0, LIST_LIMIT);
  return (
    <section aria-labelledby="currency-replaced-heading" className={cardClass} data-testid="currency-replaced">
      <SectionTitle id="currency-replaced-heading" title="Newer version recorded" count={check.replaced.length} />
      <ul className="grid gap-0.5">
        {shown.map((entry) => (
          <SourceRow key={entry.id} entry={entry}>
            <Chip appearance={{ kind: "status", tone: "danger" }} size="compact">
              Superseded
            </Chip>
          </SourceRow>
        ))}
      </ul>
      {check.replaced.length > shown.length ? (
        <p className="text-xs font-semibold text-[color:var(--text-muted)]">
          Showing the first {shown.length} of {check.replaced.length}.
        </p>
      ) : null}
    </section>
  );
}

function NeedsReviewCard({ check }: { check: SourceCurrencyCheck }) {
  const shown = check.needsReview.slice(0, LIST_LIMIT);
  return (
    <section aria-labelledby="currency-needs-review-heading" className={cardClass} data-testid="currency-needs-review">
      <SectionTitle id="currency-needs-review-heading" title="Needs review first" count={check.needsReview.length} />
      {shown.length ? (
        <ul className="grid gap-0.5">
          {shown.map((entry) => (
            <SourceRow key={entry.id} entry={entry}>
              <span className="grid shrink-0 justify-items-end gap-0.5 text-right">
                <StatusChip status={entry.documentStatus} />
                {entry.reviewDate ? (
                  <span className="text-2xs font-medium text-[color:var(--text-muted)]">
                    Reviewed {formatDate(entry.reviewDate, LONG_DATE)}
                  </span>
                ) : null}
              </span>
            </SourceRow>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[color:var(--text-muted)]">No source is marked review due or outdated.</p>
      )}
      {check.needsReview.length > shown.length ? (
        <Link
          href={catalogueHref(["outdated", "review_due"])}
          className="inline-flex min-h-12 items-center text-sm font-semibold text-[color:var(--primary)]"
        >
          See all {check.needsReview.length} in the catalogue
        </Link>
      ) : null}
    </section>
  );
}

export function SourcesCurrencyContent({
  check,
  hostedDocuments,
}: {
  check: SourceCurrencyCheck;
  hostedDocuments: "available" | "unavailable";
}): ReactNode {
  return (
    <InformationPageShell testId="sources-currency-main" width="narrow">
      {/* Reached through the Sources navigation, which already names the tab. */}
      <h1 className="sr-only">Currency check</h1>
      {hostedDocuments === "unavailable" ? (
        <p
          role="note"
          data-testid="sources-partial-catalogue-note"
          className="text-xs font-semibold text-[color:var(--warning-text,var(--text-muted))]"
        >
          Uploaded document sources cannot be reached, so these counts are incomplete.
        </p>
      ) : null}
      <SummaryCard check={check} />
      <UpcomingTimeline check={check} />
      <ReplacedCard check={check} />
      <NeedsReviewCard check={check} />
      <p className="rounded-2xl bg-[color:var(--surface-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
        <strong className="font-extrabold text-[color:var(--text-heading)]">Review due is not withdrawn.</strong> WA
        Health mandatory policies stay in effect after their review date until they are replaced.
      </p>
    </InformationPageShell>
  );
}

export async function SourcesCurrencyPage(): Promise<ReactNode> {
  const { entries, hostedDocuments } = await loadSourceCatalogue();
  return (
    <SourcesCurrencyContent
      check={deriveSourceCurrencyCheck(projectSourceCatalogueForClient(entries))}
      hostedDocuments={hostedDocuments}
    />
  );
}
