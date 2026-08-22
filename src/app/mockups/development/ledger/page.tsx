import type { Metadata } from "next";

import { LEDGER_DETAIL_CLASS, LEDGER_DISCLOSURE_CLASS, LedgerItem } from "@/components/developer-area/hub/ledger-item";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import {
  loadLedgerSnapshot,
  openItemsByPriority,
  resolveFreshness,
  type LedgerOpenItem,
  type LedgerPriority,
} from "@/lib/developer-area/ledger-snapshot";

export const metadata: Metadata = {
  title: "Task ledger · Developer · Clinical KB",
  description: "Every outstanding task, recommendation and issue, read from the committed ledger snapshot.",
};

const PRIORITY_GROUPS: { priority: LedgerPriority; heading: string; note: string }[] = [
  { priority: "P1", heading: "P1 — blocking", note: "Something is broken or unsafe until this lands." },
  { priority: "P2", heading: "P2 — important", note: "Real work that is not holding anything else up." },
  { priority: "P3", heading: "P3 — background", note: "Worth doing when there is room." },
];

/**
 * Acuity answers "how soon do I start this", which is not what priority
 * answers. The descriptor is spelled out so the two scales cannot be read as
 * one, and an acuity value this map has never seen falls through to its own raw
 * text rather than being dropped or coerced into the nearest known band.
 */
const ACUITY_NOTE: Record<string, string> = {
  A1: "start now",
  A2: "start soon",
  A3: "start when there is room",
};

const TILE_CLASS = "grid gap-1 rounded-xl border border-[color:var(--border)] p-4";
const TILE_NUMBER_CLASS = "text-2xl font-extrabold text-[color:var(--text-heading)]";
const TILE_LABEL_CLASS = "text-xs text-[color:var(--text-muted)]";
const SECTION_HEADING_CLASS = "text-lg font-extrabold text-[color:var(--text-heading)]";
const META_CLASS = "text-xs text-[color:var(--text-muted)]";

/**
 * The number gets its own test id so an assertion can read it on its own. The
 * tile's label is prose and may contain digits of its own — "blocking, priority
 * P1" carries a `1` — which would make a `toHaveTextContent` check on the whole
 * tile pass against any value whenever the real count happened to be 1.
 */
function CountTile({ id, value, label }: { id: string; value: number; label: string }) {
  return (
    <div data-testid={`developer-ledger-count-${id}`} className={TILE_CLASS}>
      <span data-testid={`developer-ledger-count-${id}-value`} className={TILE_NUMBER_CLASS}>
        {value}
      </span>
      <span className={TILE_LABEL_CLASS}>{label}</span>
    </div>
  );
}

export default function DeveloperLedgerPage() {
  const snapshot = loadLedgerSnapshot();
  const freshness = resolveFreshness(snapshot, new Date());
  const grouped = openItemsByPriority(snapshot);

  // `openItemsByPriority` only recognises P1-P3, and `LedgerOpenItem.priority`
  // is typed `string` — so the discard is reachable, not hypothetical. A
  // dropped row would vanish from the list while still being counted in
  // `counts.open`: a page quietly under-reporting outstanding work, which is
  // the exact `#338` failure this feature exists to prevent. The remainder is
  // rendered under its own heading instead.
  //
  // Keyed on object identity, not on `id`: `openItemsByPriority` pushes the
  // very same object references this filter reads, so identity is exact, while
  // an id-keyed set would swallow a second row that shared an id.
  const recognised = new Set<LedgerOpenItem>([...grouped.P1, ...grouped.P2, ...grouped.P3]);
  const unrecognised: LedgerOpenItem[] = snapshot.open.filter((item) => !recognised.has(item));

  return (
    <PanelPageShell testId="developer-ledger" title="Task ledger" freshness={freshness}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile id="open" value={snapshot.counts.open} label="open items" />
        <CountTile id="p1" value={snapshot.counts.p1} label="blocking, priority P1" />
        <CountTile id="queued" value={snapshot.counts.queued} label="in the running order" />
        <CountTile id="pending" value={snapshot.counts.pending} label="requests not yet applied" />
      </div>

      {grouped.P1.length > 0 ? (
        <section
          data-testid="developer-ledger-blockers"
          aria-labelledby="developer-ledger-blockers-heading"
          className="grid gap-2 rounded-xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] px-4 py-3"
        >
          <h2 id="developer-ledger-blockers-heading" className={SECTION_HEADING_CLASS}>
            Blocking now
          </h2>
          <ul className="grid gap-2">
            {grouped.P1.map((item) => (
              <li key={item.id} className="text-sm leading-6 text-[color:var(--text-heading)]">
                <span className="font-mono text-xs text-[color:var(--text-muted)]">{item.id}</span> {item.summary}
              </li>
            ))}
          </ul>
          <p className={META_CLASS}>Full detail for each of these is in the open items list below.</p>
        </section>
      ) : null}

      <section aria-labelledby="developer-ledger-queue-heading" className="grid gap-3">
        <h2 id="developer-ledger-queue-heading" className={SECTION_HEADING_CLASS}>
          Recommended running order
        </h2>
        <p data-testid="developer-ledger-queue-caption" className={META_CLASS}>
          Ordered by acuity — urgency, not priority. Acuity says how soon to start something; the priority badges
          further down say how much an item matters. They are separate scales kept on separate tables, and neither is
          derived from the other.
        </p>
        <ol data-testid="developer-ledger-queue" className="grid gap-3">
          {snapshot.queue.map((entry) => {
            const note = ACUITY_NOTE[entry.acuity];
            return (
              <li
                key={`${entry.order}-${entry.ids.join("-")}`}
                data-testid={`developer-ledger-queue-entry-${entry.order}`}
                className="grid gap-2 rounded-xl border border-[color:var(--border)] p-4"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`${META_CLASS} font-bold`}>{entry.order}.</span>
                  {entry.ids.map((id) => (
                    <span key={id} className="font-mono text-xs text-[color:var(--text-muted)]">
                      {id}
                    </span>
                  ))}
                  {/*
                   * Outlined and pill-shaped against the priority badge's
                   * filled rectangle, and carrying its own plain-English
                   * descriptor, so the two scales cannot be mistaken for one.
                   */}
                  <span
                    data-testid={`developer-ledger-acuity-${entry.order}`}
                    className="inline-flex items-center gap-1 rounded-full border-2 border-[color:var(--border)] px-2 py-0.5 text-xs font-bold text-[color:var(--text-heading)]"
                  >
                    {entry.acuity}
                    {note ? <span className={`${META_CLASS} font-normal`}>· {note}</span> : null}
                  </span>
                </div>
                <p className={META_CLASS}>
                  {entry.capability} · {entry.timing} · {entry.estimate}
                </p>
                <details>
                  <summary className={LEDGER_DISCLOSURE_CLASS}>Outcome and stopping condition</summary>
                  <p className={`mt-2 ${LEDGER_DETAIL_CLASS}`}>{entry.detail}</p>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="developer-ledger-open-heading" className="grid gap-3">
        <h2 id="developer-ledger-open-heading" className={SECTION_HEADING_CLASS}>
          Open items
        </h2>
        {/*
         * A wrapper rather than one `<ul>`: each priority group needs its own
         * heading, and a heading between `<li>` siblings is not valid list
         * markup. Every open item still sits under this single test id, in
         * P1 -> P2 -> P3 order.
         */}
        <div data-testid="developer-ledger-open" className="grid gap-6">
          {PRIORITY_GROUPS.map((group) => {
            const items = grouped[group.priority];
            if (items.length === 0) return null;
            const headingId = `developer-ledger-open-${group.priority}`;
            return (
              <section key={group.priority} aria-labelledby={headingId} className="grid gap-2">
                <h3 id={headingId} className="text-sm font-extrabold text-[color:var(--text-heading)]">
                  {group.heading} · {items.length}
                </h3>
                <p className={META_CLASS}>{group.note}</p>
                <ul className="grid gap-3">
                  {items.map((item) => (
                    <LedgerItem key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            );
          })}

          {unrecognised.length > 0 ? (
            <section aria-labelledby="developer-ledger-open-other" className="grid gap-2">
              <h3 id="developer-ledger-open-other" className="text-sm font-extrabold text-[color:var(--text-heading)]">
                Other · {unrecognised.length}
              </h3>
              <p className={META_CLASS}>
                These rows carry a priority this page does not recognise. They are shown as they are rather than
                dropped, so the list still adds up to the {snapshot.counts.open} open items counted above.
              </p>
              <ul className="grid gap-3">
                {unrecognised.map((item) => (
                  <LedgerItem key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="developer-ledger-pending-heading" className="grid gap-3">
        <h2 id="developer-ledger-pending-heading" className={SECTION_HEADING_CLASS}>
          Requests not yet applied
        </h2>
        <p className={META_CLASS}>
          Inbox records waiting on the next reconcile. They are not in the open items above yet, so the two lists do not
          overlap.
        </p>
        {snapshot.pending.length > 0 ? (
          <ul data-testid="developer-ledger-pending" className="grid gap-3">
            {snapshot.pending.map((request) => (
              <li
                key={request.request_id}
                data-testid={`developer-ledger-pending-${request.request_id}`}
                className="grid gap-1 rounded-xl border border-[color:var(--border)] p-4"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded-lg border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--text-muted)]">
                    {request.action}
                  </span>
                  <span className={`${META_CLASS} font-mono`}>{request.request_id}</span>
                </div>
                <p className="text-sm leading-6 text-[color:var(--text-heading)]">{request.summary}</p>
                <p className={META_CLASS}>{request.created_at ?? "no creation date recorded"}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="developer-ledger-pending" className={META_CLASS}>
            No requests are waiting.
          </p>
        )}
      </section>
    </PanelPageShell>
  );
}
