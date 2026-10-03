import Link from "next/link";

import type { OwnerToday } from "@/lib/developer-area/owner-today";
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
