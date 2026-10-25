import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  CARD_CLASS,
  CountTile,
  META_CLASS,
  MONO_CLASS,
  PanelSection,
} from "@/components/developer-area/hub/panel-primitives";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveLiveFreshness } from "@/lib/developer-area/freshness";
import {
  loadSignOffLedger,
  loadSignOffQueue,
  type SignedRecordRow,
  type SignOffDomainId,
  type SignOffDomainSummary,
  type SignOffFamily,
  type SignOffFamilyId,
  type SignOffRow,
} from "@/lib/developer-area/sign-off-queue";

/**
 * The clinical sign-off queue and complete sign-off ledger.
 *
 * Four rules shape this page, and the first three come from what the underlying
 * files actually say rather than from a preference about layout.
 *
 * **It groups, and never merges.** Seven unsigned queue families and thirteen
 * governed sign-off domains, read from the files that already hold them. Each
 * section states the file it was read from and the native field its status
 * comes from, and each unsigned row prints that source's own word before any
 * label this page invented.
 *
 * **It reads, and never signs.** No control on this page publishes, approves or
 * unhides anything. The dictionary drafts stay unpublished; this list is the
 * only place in the running app where they are readable at all, which is the
 * point of including them.
 *
 * **It links only where a record exists to open.** A row with no route carries
 * no link rather than one that 404s, and the section says so.
 *
 * **One family and one signed domain page at a time, sliced on the server.**
 * Both the unsigned family rows (`?family=&page=`) and the signed domain
 * inspector (`?domain=&signedPage=`) slice at 50 rows on the server so the
 * response stays compact while every domain's and every family's full totals
 * remain visible on screen.
 */
export const SIGN_OFF_PAGE_SIZE = 50;

const PAGER_LINK_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const PAGER_DISABLED_CLASS =
  "inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text-heading)] opacity-40";

const FAMILY_LINK_CLASS =
  "inline-flex min-h-12 w-full items-center gap-2 rounded-lg border border-[color:var(--border)] px-3 py-2 text-sm leading-6 text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const FAMILY_LINK_ACTIVE_CLASS =
  "inline-flex min-h-12 w-full items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-3 py-2 text-sm leading-6 text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * The other section's selection, carried on every link so paging one section
 * does not reset the other. Each id is set only when the reader chose it, so a
 * page opened bare keeps its short links.
 */
type KeptDomain = { domain?: SignOffDomainId; signedPage: number };
type KeptFamily = { family?: SignOffFamilyId; page: number };

function familyParams({ family, page }: KeptFamily): string[] {
  if (!family) return [];
  return page <= 1 ? [`family=${family}`] : [`family=${family}`, `page=${page}`];
}

function domainParams({ domain, signedPage }: KeptDomain): string[] {
  if (!domain) return [];
  return signedPage <= 1 ? [`domain=${domain}`] : [`domain=${domain}`, `signedPage=${signedPage}`];
}

/** `?family=…&page=…`. Page 1 is left implicit so the shortest link is the common one. */
function queueHref(family: SignOffFamilyId, page: number, kept: KeptDomain = { signedPage: 1 }): string {
  return `?${[...familyParams({ family, page }), ...domainParams(kept)].join("&")}`;
}

/** `?domain=…&signedPage=…`. Page 1 is left implicit. */
function domainSignedHref(domain: SignOffDomainId, signedPage: number, kept: KeptFamily = { page: 1 }): string {
  return `?${[...familyParams(kept), ...domainParams({ domain, signedPage })].join("&")}`;
}

function formatSignedBySummary(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "None signed yet";
  return entries.map(([name, count]) => `${name} (${count})`).join(", ");
}

function formatSignedDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso.includes("T") ? iso : `${iso}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Perth",
  });
}

function QueueRow({ row }: { row: SignOffRow }) {
  return (
    <li className={CARD_CLASS}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={MONO_CLASS}>{row.id}</span>
        <span className="rounded-full border border-[color:var(--border-strong)] px-2 py-0.5 text-xs font-bold text-[color:var(--text-muted)]">
          {row.statusLabel}
        </span>
      </div>
      <p className="text-sm font-bold leading-6 text-[color:var(--text-heading)]">
        {row.href ? (
          <Link
            href={row.href}
            className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            {row.title}
          </Link>
        ) : (
          row.title
        )}
      </p>
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-bold">To sign off: </span>
        {row.requires}
      </p>
      {/*
       * The source's own status word, printed verbatim under every row. This is
       * what stops the display label above from becoming the only vocabulary a
       * reader ever sees, which is how five distinct review states quietly
       * become one.
       */}
      <p className={META_CLASS}>Recorded as: {row.nativeStatus}</p>
    </li>
  );
}

function SignedRowItem({ row }: { row: SignedRecordRow }) {
  const dateLabel = formatSignedDate(row.signedAt);
  return (
    <li className={CARD_CLASS}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={MONO_CLASS}>{row.id}</span>
          <span className="rounded-full border border-[color:var(--border-strong)] px-2 py-0.5 text-xs font-bold text-[color:var(--text-heading)]">
            Signed off by {row.signedBy}
          </span>
        </div>
        {dateLabel ? <span className={META_CLASS}>Signed {dateLabel} (AWST)</span> : null}
      </div>
      <p className="text-sm font-bold leading-6 text-[color:var(--text-heading)]">
        {row.href ? (
          <Link
            href={row.href}
            className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            {row.title}
          </Link>
        ) : (
          row.title
        )}
      </p>
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-bold">What it is for: </span>
        {row.whatFor}
      </p>
    </li>
  );
}

function Pager({
  family,
  page,
  totalPages,
  ariaLabel,
  kept,
}: {
  family: SignOffFamilyId;
  page: number;
  totalPages: number;
  ariaLabel: string;
  kept: KeptDomain;
}) {
  return (
    <div className="flex items-center gap-2" role="navigation" aria-label={ariaLabel}>
      {page > 1 ? (
        <Link href={queueHref(family, page - 1, kept)} aria-label="Previous page" className={PAGER_LINK_CLASS}>
          <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          Previous
        </Link>
      ) : (
        <span aria-label="Previous page" aria-disabled="true" className={PAGER_DISABLED_CLASS}>
          <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          Previous
        </span>
      )}
      <span className="px-2 text-xs font-bold text-[color:var(--text-heading)]">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={queueHref(family, page + 1, kept)} aria-label="Next page" className={PAGER_LINK_CLASS}>
          Next
          <ChevronRight aria-hidden="true" className="size-icon-sm" />
        </Link>
      ) : (
        <span aria-label="Next page" aria-disabled="true" className={PAGER_DISABLED_CLASS}>
          Next
          <ChevronRight aria-hidden="true" className="size-icon-sm" />
        </span>
      )}
    </div>
  );
}

function SignedDomainPager({
  domain,
  page,
  totalPages,
  ariaLabel,
  kept,
}: {
  domain: SignOffDomainId;
  page: number;
  totalPages: number;
  ariaLabel: string;
  kept: KeptFamily;
}) {
  return (
    <div className="flex items-center gap-2" role="navigation" aria-label={ariaLabel}>
      {page > 1 ? (
        <Link
          href={domainSignedHref(domain, page - 1, kept)}
          aria-label="Previous signed records page"
          className={PAGER_LINK_CLASS}
        >
          <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          Previous
        </Link>
      ) : (
        <span aria-label="Previous signed records page" aria-disabled="true" className={PAGER_DISABLED_CLASS}>
          <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          Previous
        </span>
      )}
      <span className="px-2 text-xs font-bold text-[color:var(--text-heading)]">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          href={domainSignedHref(domain, page + 1, kept)}
          aria-label="Next signed records page"
          className={PAGER_LINK_CLASS}
        >
          Next
          <ChevronRight aria-hidden="true" className="size-icon-sm" />
        </Link>
      ) : (
        <span aria-label="Next signed records page" aria-disabled="true" className={PAGER_DISABLED_CLASS}>
          Next
          <ChevronRight aria-hidden="true" className="size-icon-sm" />
        </span>
      )}
    </div>
  );
}

function SignedRecordsInspector({
  domain,
  requestedSignedPage,
  kept,
}: {
  domain: SignOffDomainSummary;
  requestedSignedPage: number;
  kept: KeptFamily;
}) {
  const totalPages = Math.max(1, Math.ceil(domain.signedRows.length / SIGN_OFF_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedSignedPage), totalPages);
  const startIndex = (page - 1) * SIGN_OFF_PAGE_SIZE;
  const pageRows = domain.signedRows.slice(startIndex, startIndex + SIGN_OFF_PAGE_SIZE);

  return (
    <PanelSection
      testId="developer-sign-off-signed-records"
      headingId="developer-sign-off-signed-records-heading"
      heading={`Signed-off records in ${domain.name} — ${domain.signedCount} of ${domain.total} signed`}
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-bold text-[color:var(--text-heading)]">What this domain is for: </span>
        {domain.whatFor}
      </p>
      <p className={META_CLASS}>
        Signed off by: {formatSignedBySummary(domain.signedByCounts)}. Read from {domain.source}. Signing tool:{" "}
        <code className="font-mono">{domain.toolHint}</code>.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="developer-sign-off-signed-pagination-summary" className={META_CLASS}>
          Showing {domain.signedRows.length === 0 ? 0 : startIndex + 1}–{startIndex + pageRows.length} of{" "}
          {domain.signedRows.length} signed-off records in this domain (page {page} of {totalPages}).
        </p>
        {totalPages > 1 ? (
          <SignedDomainPager
            domain={domain.id}
            page={page}
            totalPages={totalPages}
            ariaLabel={`${domain.name} signed records pagination`}
            kept={kept}
          />
        ) : null}
      </div>

      <ul data-testid={`developer-sign-off-signed-rows-${domain.id}`} className="grid gap-2">
        {pageRows.map((row) => (
          <SignedRowItem key={row.key} row={row} />
        ))}
      </ul>

      {totalPages > 1 ? (
        <div className="flex justify-end pt-2">
          <SignedDomainPager
            domain={domain.id}
            page={page}
            totalPages={totalPages}
            ariaLabel={`${domain.name} signed records pagination bottom`}
            kept={kept}
          />
        </div>
      ) : null}
    </PanelSection>
  );
}

function FamilySection({
  family,
  requestedPage,
  kept,
}: {
  family: SignOffFamily;
  requestedPage: number;
  kept: KeptDomain;
}) {
  const totalPages = Math.max(1, Math.ceil(family.rows.length / SIGN_OFF_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const startIndex = (page - 1) * SIGN_OFF_PAGE_SIZE;
  const pageRows = family.rows.slice(startIndex, startIndex + SIGN_OFF_PAGE_SIZE);

  return (
    <PanelSection
      testId={`developer-sign-off-family-${family.id}`}
      headingId={`developer-sign-off-family-${family.id}-heading`}
      heading={`${family.name} — ${family.rows.length} waiting`}
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">{family.note}</p>
      <p className={META_CLASS}>
        Read from {family.source}. Status field: {family.nativeField}.
        {family.unrouted ? " Some of these records have no route in this app; those rows carry no link." : ""}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="developer-sign-off-pagination-summary" className={META_CLASS}>
          Showing {family.rows.length === 0 ? 0 : startIndex + 1}–{startIndex + pageRows.length} of {family.rows.length}{" "}
          records in this family (page {page} of {totalPages}). The family totals above are unaffected by this slice.
        </p>
        {totalPages > 1 ? (
          <Pager
            family={family.id}
            page={page}
            totalPages={totalPages}
            ariaLabel={`${family.name} pagination`}
            kept={kept}
          />
        ) : null}
      </div>

      <ul data-testid={`developer-sign-off-rows-${family.id}`} className="grid gap-2">
        {pageRows.map((row) => (
          <QueueRow key={row.key} row={row} />
        ))}
      </ul>

      {totalPages > 1 ? (
        <div className="flex justify-end pt-2">
          <Pager
            family={family.id}
            page={page}
            totalPages={totalPages}
            ariaLabel={`${family.name} pagination bottom`}
            kept={kept}
          />
        </div>
      ) : null}
    </PanelSection>
  );
}

export function SignOffQueuePageContent({
  requestedFamily,
  requestedPage = 1,
  requestedDomain,
  requestedSignedPage = 1,
}: {
  requestedFamily?: string;
  requestedPage?: number;
  requestedDomain?: string;
  requestedSignedPage?: number;
}) {
  const queue = loadSignOffQueue();
  const ledger = loadSignOffLedger();
  // Live, not snapshot-backed: every count is derived at read time from files
  // committed in this repository, so there is no capture date to report and no
  // generated snapshot that can go stale behind the page.
  const freshness = resolveLiveFreshness(null, new Date());
  // An unrecognised `?family=` falls back to the first family rather than 404ing.
  // A developer who hand-edits the query string should land on the queue, not on
  // an error page that reads as though the data is gone.
  const selected = queue.families.find((family) => family.id === requestedFamily) ?? queue.families[0]!;
  const selectedDomain =
    ledger.domains.find((domain) => domain.id === requestedDomain) ??
    ledger.domains.find((domain) => domain.id === "wa-mha-forms") ??
    ledger.domains[0]!;
  // Each section's links carry the other's explicit choice, so paging one does
  // not send the other back to its default.
  const keptFamily: KeptFamily = {
    family: selected.id === requestedFamily ? selected.id : undefined,
    page: requestedPage,
  };
  const keptDomain: KeptDomain = {
    domain: selectedDomain.id === requestedDomain ? selectedDomain.id : undefined,
    signedPage: requestedSignedPage,
  };
  // Counted per row, not per family: the dictionary family is flagged unrouted
  // because its 333 sense drafts have nowhere to go, but its 96 definition
  // reviews do point at a live entry. Counting the family whole would report 429
  // unreachable records, which is wrong by 96.
  const unlinked = queue.families.reduce(
    (sum, family) => sum + family.rows.filter((row) => row.href === null).length,
    0,
  );
  const allIndigenousHolds = ledger.domains.flatMap((domain) => domain.needsSigning.indigenousHoldRows);
  const therapyPrerequisiteRows =
    ledger.domains.find((domain) => domain.id === "therapy")?.needsSigning.prerequisiteRows ?? [];
  // Every count in the category text comes from the ledger, so a new sign-off or a
  // new record cannot leave fixed prose contradicting the live heading beside it.
  const domainById = new Map(ledger.domains.map((domain) => [domain.id, domain]));
  const waitingIn = (id: SignOffDomainId, category: "awaitingPrerequisites" | "awaitingTool") =>
    domainById.get(id)?.needsSigning[category] ?? 0;
  const signedIn = (id: SignOffDomainId) => domainById.get(id)?.signedCount ?? 0;
  const sourcePrerequisiteRows = domainById.get("sources")?.needsSigning.prerequisiteRows ?? [];
  const signerNames = Object.keys(ledger.signedByTotals)
    .sort()
    .map((name) => `\`${name}\``)
    .join(", ");

  return (
    <PanelPageShell
      testId="developer-clinical-sign-off"
      title="Clinical sign-off queue"
      freshness={freshness}
      freshnessLabel="Sign-off queue"
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        Complete sign-off register and waiting queue across all {ledger.domains.length} governed clinical and rule
        domains in this repository. Everything below is read directly from the committed review registers on disk: what
        has been signed off, who signed it ({signerNames}), when it was signed, what it is for, and what still needs
        signing off (grouped by whether it is ready for a local tool today, held for Aboriginal and Torres Strait
        Islander governance review, awaiting source references or written clinical text, or awaiting a sign-off tool).
        This page is read-only: nothing on it publishes, approves or unhides a record.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="developer-sign-off-ledger-tiles">
        <CountTile
          testId="developer-sign-off-count-signed"
          value={ledger.totalSigned}
          label={`items signed off across ${ledger.domains.length} domains`}
        />
        <CountTile
          testId="developer-sign-off-count-signable-now"
          value={ledger.waitingByCategory.signableNow}
          label="ready to sign with a tool now"
        />
        <CountTile
          testId="developer-sign-off-count-indigenous-hold"
          value={ledger.waitingByCategory.indigenousHold}
          label="held for Aboriginal governance review"
        />
        <CountTile
          testId="developer-sign-off-count-prerequisites"
          value={ledger.waitingByCategory.awaitingPrerequisites}
          label="awaiting references or written text"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile testId="developer-sign-off-count-total" value={queue.total} label="records awaiting sign-off" />
        <CountTile testId="developer-sign-off-count-families" value={queue.families.length} label="record families" />
        <CountTile testId="developer-sign-off-count-unrouted" value={unlinked} label="records no page renders" />
        <CountTile
          testId="developer-sign-off-count-linked"
          value={queue.total - unlinked}
          label="records with a page to open"
        />
      </div>

      <PanelSection
        testId="developer-sign-off-ledger-domains"
        headingId="developer-sign-off-ledger-domains-heading"
        heading={`Everything signed off & remaining by domain (${ledger.totalSigned} signed · ${ledger.totalWaiting} waiting)`}
      >
        <p className={META_CLASS}>
          All {ledger.domains.length} governed sign-off domains across the repository. Total signed:{" "}
          <span className="font-bold text-[color:var(--text-heading)]">{ledger.totalSigned}</span> (
          {formatSignedBySummary(ledger.signedByTotals)}). Select any domain below to inspect every signed record in it,{" "}
          {SIGN_OFF_PAGE_SIZE} at a time.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ledger.domains.map((domain) => {
            const active = domain.id === selectedDomain.id;
            const latestDate = formatSignedDate(domain.latestSignedAt);
            return (
              <li key={domain.id} className={CARD_CLASS} data-testid={`developer-sign-off-ledger-domain-${domain.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={domainSignedHref(domain.id, 1, keptFamily)}
                    aria-current={active ? "true" : undefined}
                    className="text-sm font-bold text-[color:var(--text-heading)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  >
                    {domain.name}
                  </Link>
                  <span className="nums rounded-full border border-[color:var(--border-strong)] px-2 py-0.5 text-xs font-bold text-[color:var(--text-heading)]">
                    {domain.signedCount} / {domain.total} signed
                  </span>
                </div>
                <p className="text-xs leading-5 text-[color:var(--text)]">
                  <span className="font-bold text-[color:var(--text-heading)]">What it is for: </span>
                  {domain.whatFor}
                </p>
                <p className="text-xs leading-5 text-[color:var(--text-muted)]">
                  <span className="font-bold text-[color:var(--text)]">Signed off by: </span>
                  {formatSignedBySummary(domain.signedByCounts)}
                  {latestDate ? ` · latest ${latestDate}` : ""}
                </p>
                <p className="text-xs leading-5 text-[color:var(--text-muted)]">
                  <span className="font-bold text-[color:var(--text)]">Needs signing off: </span>
                  {domain.needsSigning.summary}
                </p>
                <p className={META_CLASS}>Source: {domain.source}</p>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      <SignedRecordsInspector domain={selectedDomain} requestedSignedPage={requestedSignedPage} kept={keptFamily} />

      <PanelSection
        testId="developer-sign-off-needs-signing-breakdown"
        headingId="developer-sign-off-needs-signing-breakdown-heading"
        heading={`What still needs signing off — organized by why (${ledger.totalWaiting} items)`}
      >
        <div className="grid gap-3">
          <div className={CARD_CLASS} data-testid="developer-sign-off-category-signable-now">
            <p className="text-sm font-bold text-[color:var(--text-heading)]">
              1. Ready to sign now with a local tool ({ledger.waitingByCategory.signableNow})
            </p>
            <p className="text-sm leading-6 text-[color:var(--text-muted)]">
              {ledger.waitingByCategory.signableNow === 0
                ? `Everything that can currently be signed is signed off across ${ledger.domains.length} domains.`
                : `These ${ledger.waitingByCategory.signableNow} records are ready to sign in ${ledger.domains.filter((domain) => domain.needsSigning.signableNow > 0).length} domains: ${ledger.domains
                    .filter((domain) => domain.needsSigning.signableNow > 0)
                    .map((domain) => domain.name)
                    .join(", ")}.`}
            </p>
          </div>

          <div className={CARD_CLASS} data-testid="developer-sign-off-category-indigenous-hold">
            <p className="text-sm font-bold text-[color:var(--text-heading)]">
              2. Held for Aboriginal &amp; Torres Strait Islander governance review (
              {ledger.waitingByCategory.indigenousHold} records across{" "}
              {ledger.domains.filter((domain) => domain.needsSigning.indigenousHold > 0).length} domains)
            </p>
            <p className="text-sm leading-6 text-[color:var(--text-muted)]">
              Owner rule (2026-09-26): content specific to Aboriginal and Torres Strait Islander peoples requires
              Aboriginal governance review rather than a clinician sign-off, and both local sign-off tools refuse to
              sign these records until that governance pathway is completed.
            </p>
            <ul className="grid gap-1.5 pt-1 text-xs" data-testid="developer-sign-off-indigenous-hold-list">
              {allIndigenousHolds.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[color:var(--border)] py-1.5 last:border-b-0"
                >
                  <span className="text-[color:var(--text)]">
                    <span className={MONO_CLASS}>{item.id}</span> ·{" "}
                    {item.href ? (
                      <Link href={item.href} className="underline underline-offset-2">
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </span>
                  <span className="text-[color:var(--text-muted)]">{item.domainName}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className={CARD_CLASS} data-testid="developer-sign-off-category-prerequisites">
            <p className="text-sm font-bold text-[color:var(--text-heading)]">
              3. Awaiting source references, written clinical text, or a structured attestation (
              {ledger.waitingByCategory.awaitingPrerequisites} items across{" "}
              {ledger.domains.filter((domain) => domain.needsSigning.awaitingPrerequisites > 0).length} domains)
            </p>
            <p className="text-sm leading-6 text-[color:var(--text-muted)]">
              These items belong to domains that have a local sign-off tool, but the tool refuses to sign them until
              their missing clinical text, guideline reference, or structured attestation is recorded:
            </p>
            <ul className="grid gap-1.5 text-xs text-[color:var(--text-muted)]">
              <li>
                <span className="font-bold text-[color:var(--text)]">
                  {therapyPrerequisiteRows.length} Therapy Compass records (
                  <Link href={queueHref("therapy", 1, keptDomain)} className="underline">
                    open in queue
                  </Link>
                  ):
                </span>{" "}
                Currently have <code className="font-mono">references: []</code> in{" "}
                <code className="font-mono">src/data/therapies-source.json</code>:{" "}
                <span data-testid="developer-sign-off-therapy-prereq-list">
                  {therapyPrerequisiteRows.map((row) => row.id).join(", ")}
                </span>
                .
              </li>
              <li>
                <span className="font-bold text-[color:var(--text)]">
                  {waitingIn("specifiers", "awaitingPrerequisites")} DSM-5-TR specifier catalog placeholders (
                  <Link href={queueHref("specifiers", 1, keptDomain)} className="underline">
                    open in queue
                  </Link>
                  ):
                </span>{" "}
                Carry <code className="font-mono">definition: null</code> in{" "}
                <code className="font-mono">data/specifiers-content.json</code>; all {signedIn("specifiers")} specifiers
                that have written definitions are already signed off.
              </li>
              <li>
                <span className="font-bold text-[color:var(--text)]">
                  {waitingIn("dictionary", "awaitingPrerequisites")} Dictionary definition verdicts (
                  <Link href={queueHref("dictionary", 1, keptDomain)} className="underline">
                    open in queue
                  </Link>
                  ):
                </span>{" "}
                Record an editorial verdict with <code className="font-mono">proposedWording: null</code> in{" "}
                <code className="font-mono">src/data/dictionary-definition-reviews.json</code>; all{" "}
                {signedIn("dictionary")} reviews that propose a rewrite are already signed off.
              </li>
              {sourcePrerequisiteRows.length > 0 ? (
                <li>
                  <span className="font-bold text-[color:var(--text)]">
                    {sourcePrerequisiteRows.length} governed source acquisitions:
                  </span>{" "}
                  Marked reviewed in <code className="font-mono">src/data/source-acquisitions.json</code> without a
                  structured attestation (<code className="font-mono">attestedBy</code>,{" "}
                  <code className="font-mono">attestedAt</code>,{" "}
                  <code className="font-mono">attestedAgainstSha256</code>), so they are not counted as signed:{" "}
                  <span data-testid="developer-sign-off-source-prereq-list">
                    {sourcePrerequisiteRows.map((row) => row.id).join(", ")}
                  </span>
                  .
                </li>
              ) : null}
            </ul>
          </div>

          <div className={CARD_CLASS} data-testid="developer-sign-off-category-awaiting-tool">
            <p className="text-sm font-bold text-[color:var(--text-heading)]">
              4. Unverified exports &amp; unpublished drafts with no sign-off tool yet (
              {ledger.waitingByCategory.awaitingTool} items across{" "}
              {ledger.domains.filter((domain) => domain.needsSigning.awaitingTool > 0).length} domains)
            </p>
            <ul className="grid gap-1.5 text-xs text-[color:var(--text-muted)]">
              <li>
                <span className="font-bold text-[color:var(--text)]">
                  {waitingIn("differentials", "awaitingTool")} exported differential snapshot records (
                  <Link href={queueHref("differentials", 1, keptDomain)} className="underline">
                    open in queue
                  </Link>
                  ):
                </span>{" "}
                Diagnosis exports and presentation workflows in{" "}
                <code className="font-mono">data/differentials-snapshot.json</code> derive{" "}
                <code className="font-mono">validation_status: unverified</code> from the snapshot governance header
                (while all {signedIn("differentials")} locally authored bedside clinical overlays layered on top of them
                are signed off).
              </li>
              <li>
                <span className="font-bold text-[color:var(--text)]">
                  {waitingIn("dictionary", "awaitingTool")} unpublished dictionary sense drafts (
                  <Link href={queueHref("dictionary", 1, keptDomain)} className="underline">
                    open in queue
                  </Link>
                  ):
                </span>{" "}
                Held unpublished in <code className="font-mono">src/data/dictionary-sense-drafts.json</code> with{" "}
                <code className="font-mono">publicationAllowed: false</code>; no route renders them and no CLI tool
                signs them yet.
              </li>
            </ul>
          </div>
        </div>
      </PanelSection>

      {/*
       * Every family's total, on every page. This list is what makes the
       * pagination honest: only one family's rows are rendered at a time, so
       * without it a reader could mistake the visible section for the whole
       * queue. It doubles as the navigation between families.
       */}
      <PanelSection
        testId="developer-sign-off-summary"
        headingId="developer-sign-off-summary-heading"
        heading="Counts by family"
      >
        <p className={META_CLASS}>
          Every family&rsquo;s full total, whichever one is open below. Choose a family to read its records,{" "}
          {SIGN_OFF_PAGE_SIZE} at a time.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {queue.families.map((family) => {
            const active = family.id === selected.id;
            return (
              <li key={family.id}>
                <Link
                  href={queueHref(family.id, 1, keptDomain)}
                  aria-current={active ? "page" : undefined}
                  className={active ? FAMILY_LINK_ACTIVE_CLASS : FAMILY_LINK_CLASS}
                >
                  <span className="font-bold text-[color:var(--text-heading)]">{family.rows.length}</span>
                  {family.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      <FamilySection family={selected} requestedPage={requestedPage} kept={keptDomain} />
    </PanelPageShell>
  );
}
