import Link from "next/link";

import type { OwnerToday } from "@/lib/developer-area/owner-today";
import {
  loadSignOffLedger,
  type SignOffDomainId,
  type SignOffDomainSummary,
} from "@/lib/developer-area/sign-off-queue";
import type { SignOffToday } from "@/lib/developer-area/sign-off-today";

const LINK_CLASS =
  "flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const LIST_HEADING_CLASS = "text-sm font-semibold text-[color:var(--text-heading)]";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function formatReviewBy(date: string | null) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Perth",
  });
}

function formatSignedBySummary(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "None signed yet";
  return entries.map(([name, count]) => `${name} (${count})`).join(", ");
}

function formatShortDate(iso: string | null): string | null {
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

/**
 * A few records to sign off today, each with the one command that opens it in
 * the local sign-off tool. Read-only: nothing here signs, and the tool itself
 * refuses to write unless the owner is typing at a real terminal.
 */
function SignOffTodayList({ signOff }: { signOff: SignOffToday }) {
  return (
    <section
      aria-labelledby="owner-panel-sign-off-today"
      className="grid gap-2"
      data-testid="owner-panel-sign-off-today"
    >
      <h3 id="owner-panel-sign-off-today" className={LIST_HEADING_CLASS}>
        Sign off today
      </h3>
      {signOff.rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">
          No record the sign-off tools can sign is waiting. Anything still on the full queue has no tool yet.
        </p>
      ) : (
        <>
          <p className="text-sm text-[color:var(--text-muted)]">
            {plural(signOff.rows.length, "record", "records")} for one sitting, highest priority first: Mental Health
            Act forms, then the locally written differential notes, Formulation, Therapy, dictionary rewrites and
            candidate sources. Content about Aboriginal and Torres Strait Islander people is never listed: it needs
            Aboriginal governance review, not a clinician sign-off.
          </p>
          <ol className="grid gap-2" data-testid="owner-panel-sign-off-today-list">
            {signOff.rows.map((row) => (
              <li
                key={row.key}
                className="grid gap-1 rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm"
                data-testid={`owner-panel-sign-off-today-${row.key}`}
              >
                <span className="text-[color:var(--text)]">
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
                </span>
                <span className="text-xs text-[color:var(--text-muted)]">
                  {row.familyName} · recorded as {row.nativeStatus}
                </span>
                <code className="break-all rounded-lg bg-[color:var(--surface-subtle)] px-2 py-1 font-mono text-xs text-[color:var(--text)]">
                  {row.command}
                </code>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="text-xs text-[color:var(--text-muted)]">
        Run each command in a terminal in your own copy of the project, typing your public name in quotes after
        --reviewed-by. The tool shows the record&apos;s full text and asks its checklist before it records your name and
        today&apos;s date; nothing on this page signs anything. The list moves on once a signed record reaches the live
        site. Step by step: docs/clinical-sign-off-how-to.md. Of <span className="nums">{signOff.waiting}</span> records
        waiting, <span className="nums">{signOff.signable}</span> can be signed with a tool today; the rest are on the
        full queue.
      </p>
    </section>
  );
}

function DomainLedgerCard({ domain }: { domain: SignOffDomainSummary }) {
  const latestDate = formatShortDate(domain.latestSignedAt);
  const fullySigned = domain.waitingCount === 0;
  return (
    <li
      className="grid gap-1.5 rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm"
      data-testid={`owner-panel-sign-off-domain-${domain.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/mockups/development/clinical-sign-off?domain=${domain.id}`}
          className="font-semibold text-[color:var(--text-heading)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          {domain.name}
        </Link>
        <span className="nums text-xs font-semibold text-[color:var(--text-muted)]">
          {domain.signedCount} / {domain.total} signed
          {fullySigned ? " · complete" : ` · ${domain.waitingCount} remaining`}
        </span>
      </div>
      <p className="text-xs text-[color:var(--text)]">
        <span className="font-semibold text-[color:var(--text-heading)]">What it is for: </span>
        {domain.whatFor}
      </p>
      <p className="text-xs text-[color:var(--text-muted)]">
        <span className="font-semibold text-[color:var(--text)]">Signed off by: </span>
        {formatSignedBySummary(domain.signedByCounts)}
        {latestDate ? ` · latest ${latestDate}` : ""}
      </p>
      <p className="text-xs text-[color:var(--text-muted)]">
        <span className="font-semibold text-[color:var(--text)]">Needs signing off: </span>
        {domain.needsSigning.summary}
      </p>
    </li>
  );
}

function SignOffLedgerOverview() {
  const ledger = loadSignOffLedger();
  const signerSummary = formatSignedBySummary(ledger.signedByTotals);
  const waitingIn = (id: SignOffDomainId, category: "awaitingPrerequisites" | "awaitingTool") =>
    ledger.domains.find((domain) => domain.id === id)?.needsSigning[category] ?? 0;

  return (
    <section
      aria-labelledby="owner-panel-sign-off-ledger-heading"
      className="grid gap-3"
      data-testid="owner-panel-sign-off-ledger"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="owner-panel-sign-off-ledger-heading" className={LIST_HEADING_CLASS}>
          Clinical &amp; rule sign-off register (signed off vs needs signing off)
        </h3>
        <Link
          href="/mockups/development/clinical-sign-off"
          className="text-xs font-semibold text-[color:var(--text-heading)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          Inspect every signed &amp; waiting record ›
        </Link>
      </div>

      <p className="text-sm text-[color:var(--text-muted)]" data-testid="owner-panel-sign-off-ledger-summary">
        <span className="nums font-semibold text-[color:var(--text-heading)]">{ledger.totalSigned}</span> items signed
        off across <span className="nums">{ledger.domains.length}</span> governed domains ({signerSummary}) ·{" "}
        <span className="nums font-semibold text-[color:var(--text-heading)]">
          {ledger.waitingByCategory.signableNow}
        </span>{" "}
        ready to sign with a local tool today · <span className="nums">{ledger.waitingByCategory.indigenousHold}</span>{" "}
        held for Aboriginal &amp; Torres Strait Islander governance review ·{" "}
        <span className="nums">{ledger.waitingByCategory.awaitingPrerequisites}</span> awaiting source references,
        written text, or a structured attestation ·{" "}
        <span className="nums">{ledger.waitingByCategory.awaitingTool}</span> unverified exports &amp; unpublished
        drafts with no sign-off tool yet.
      </p>

      <div
        className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-xs"
        data-testid="owner-panel-needs-signing-breakdown"
      >
        <p className="font-semibold text-[color:var(--text-heading)]">
          What still needs signing off ({ledger.totalWaiting} items across all {ledger.domains.length} domains, grouped
          by why):
        </p>
        <ul className="grid gap-1.5 text-[color:var(--text-muted)]">
          <li>
            <span className="nums font-semibold text-[color:var(--text)]">
              1. Ready to sign now with a local tool ({ledger.waitingByCategory.signableNow}):
            </span>{" "}
            {ledger.waitingByCategory.signableNow === 0
              ? `Everything currently signable is signed off across ${ledger.domains.length} domains.`
              : `${ledger.waitingByCategory.signableNow} records are ready to sign in ${ledger.domains.filter((domain) => domain.needsSigning.signableNow > 0).length} domains.`}
          </li>
          <li>
            <span className="nums font-semibold text-[color:var(--text)]">
              2. Held for Aboriginal &amp; Torres Strait Islander governance review (
              {ledger.waitingByCategory.indigenousHold}):
            </span>{" "}
            1 Chief Psychiatrist standard (<code className="font-mono">cp-standard-aboriginal-practice</code>), 9 MHA
            cultural &amp; interpreter notes (8 <code className="font-mono">aboriginal-liaison</code> +{" "}
            <code className="font-mono">1A-interpreter-3</code>), 6 Formulation cultural/SEWB records, 6 Indigenous
            health source acquisitions, and 4 Aboriginal service records (Thirrili, StandBy WA, Kimberley CADS Youth,
            Legal Yarn). Both sign-off tools refuse these by rule until Aboriginal governance review is recorded.
          </li>
          <li>
            <span className="nums font-semibold text-[color:var(--text)]">
              3. Awaiting source references, written clinical text, or a structured attestation (
              {ledger.waitingByCategory.awaitingPrerequisites}):
            </span>{" "}
            {waitingIn("therapy", "awaitingPrerequisites")} Therapy Compass records with empty{" "}
            <code className="font-mono">references: []</code> arrays, {waitingIn("specifiers", "awaitingPrerequisites")}{" "}
            DSM-5-TR specifier catalog placeholders with <code className="font-mono">definition: null</code>,{" "}
            {waitingIn("dictionary", "awaitingPrerequisites")} Dictionary definition verdicts with{" "}
            <code className="font-mono">proposedWording: null</code>, and{" "}
            {waitingIn("sources", "awaitingPrerequisites")} source acquisitions reviewed only in prose (no structured
            attestation).
          </li>
          <li>
            <span className="nums font-semibold text-[color:var(--text)]">
              4. Unverified exports &amp; unpublished drafts with no sign-off tool yet (
              {ledger.waitingByCategory.awaitingTool}):
            </span>{" "}
            {waitingIn("differentials", "awaitingTool")} exported differential snapshot records (diagnoses and
            presentation workflows in <code className="font-mono">data/differentials-snapshot.json</code>) and{" "}
            {waitingIn("dictionary", "awaitingTool")} unpublished dictionary sense drafts (
            <code className="font-mono">src/data/dictionary-sense-drafts.json</code>).
          </li>
        </ul>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2" data-testid="owner-panel-signed-domains">
        {ledger.domains.map((domain) => (
          <DomainLedgerCard key={domain.id} domain={domain} />
        ))}
      </ul>
    </section>
  );
}

/**
 * What is waiting on the owner, first on the page. Every figure comes from a
 * committed file, so it is as current as the deployed build and never implies a
 * live read it did not make.
 */
export function OwnerTodaySection({ today }: { today: OwnerToday }) {
  const { decisions, privacy, uncontrolledHazards, signOff } = today;

  return (
    <div className="grid gap-4" data-testid="owner-panel-today">
      <p className="text-sm text-[color:var(--text-muted)]" data-testid="owner-panel-today-summary">
        <span className="nums">{plural(decisions.length, "decision", "decisions")}</span> waiting on you ·{" "}
        <span className="nums">{plural(privacy.length, "privacy item", "privacy items")}</span> not yet verified ·{" "}
        <span className="nums">{plural(uncontrolledHazards, "clinical risk", "clinical risks")}</span> with no control ·{" "}
        <span className="nums">{plural(signOff.waiting, "record", "records")}</span> awaiting sign-off
      </p>

      <SignOffTodayList signOff={signOff} />

      <SignOffLedgerOverview />

      <section aria-labelledby="owner-panel-decisions" className="grid gap-2">
        <h3 id="owner-panel-decisions" className={LIST_HEADING_CLASS}>
          Decisions for you
        </h3>
        {decisions.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">No task list item is marked as waiting on you.</p>
        ) : (
          <ul className="grid gap-2">
            {decisions.map((item) => (
              <li key={item.id}>
                <Link
                  href="/mockups/development/ledger"
                  className={LINK_CLASS}
                  data-testid={`owner-panel-decision-${item.id}`}
                >
                  <span className="text-[color:var(--text)]">{item.summary}</span>
                  <span className="nums shrink-0 text-xs text-[color:var(--text-muted)]">
                    {item.priority} · {item.id}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[color:var(--text-muted)]">
          Picked from task list items whose title says they wait on the owner. An item worded differently will not
          appear here.
        </p>
      </section>

      <section aria-labelledby="owner-panel-privacy" className="grid gap-2">
        <h3 id="owner-panel-privacy" className={LIST_HEADING_CLASS}>
          Privacy items not yet verified
        </h3>
        {privacy.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">Every privacy register item is verified.</p>
        ) : (
          <ul className="grid gap-1" data-testid="owner-panel-privacy-list">
            {privacy.map((item) => {
              const reviewBy = formatReviewBy(item.reviewBy);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-[color:var(--border)] py-2 text-sm last:border-b-0"
                >
                  <span className="text-[color:var(--text)]">{item.label}</span>
                  <span className="nums text-xs text-[color:var(--text-muted)]">
                    {item.status === "partial" ? "Partly done" : "Pending"}
                    {reviewBy ? ` · review by ${reviewBy}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/mockups/development/hazards" className={LINK_CLASS} data-testid="owner-panel-hazards-link">
          <span className="text-[color:var(--text)]">Clinical risks with no control</span>
          <span className="nums text-[color:var(--text-muted)]">{uncontrolledHazards}</span>
        </Link>
        <Link
          href="/mockups/development/clinical-sign-off"
          className={LINK_CLASS}
          data-testid="owner-panel-sign-off-link"
        >
          <span className="text-[color:var(--text)]">Records waiting for your sign-off</span>
          <span aria-hidden="true" className="text-[color:var(--text-muted)]">
            ›
          </span>
        </Link>
        <Link href="/mockups/development/ingestion" className={LINK_CLASS} data-testid="owner-panel-uploads-link">
          <span className="text-[color:var(--text)]">Uploads and indexing</span>
          <span aria-hidden="true" className="text-[color:var(--text-muted)]">
            ›
          </span>
        </Link>
        <Link href="/mockups/development/settings" className={LINK_CLASS} data-testid="owner-panel-settings-link">
          <span className="text-[color:var(--text)]">Settings check</span>
          <span aria-hidden="true" className="text-[color:var(--text-muted)]">
            ›
          </span>
        </Link>
      </div>
    </div>
  );
}
