import type { Metadata } from "next";

import { CARD_CLASS, CountTile, META_CLASS, PanelSection } from "@/components/developer-area/hub/panel-primitives";
import { LedgerFilter, type LedgerFilterGroup } from "@/components/developer-area/hub/ledger-filter";
import { LEDGER_DETAIL_CLASS, LEDGER_DISCLOSURE_CLASS } from "@/components/developer-area/hub/ledger-item";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import {
  loadLedgerSnapshot,
  openItemsByPriority,
  resolveFreshness,
  type LedgerOpenItem,
  type LedgerPriority,
} from "@/lib/developer-area/ledger-snapshot";

export const metadata: Metadata = {
  title: "Task ledger · Developer · PsychSift",
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

  const openGroups: LedgerFilterGroup[] = PRIORITY_GROUPS.map((group) => ({
    key: group.priority,
    heading: group.heading,
    note: group.note,
    items: grouped[group.priority],
  }));
  if (unrecognised.length > 0) {
    openGroups.push({
      key: "other",
      heading: "Other",
      note: `These rows carry a priority this page does not recognise. They are shown as they are rather than dropped, so the list still adds up to the ${snapshot.counts.open} open items counted above.`,
      items: unrecognised,
    });
  }

  return (
    <PanelPageShell testId="developer-ledger" title="Task ledger" freshness={freshness} freshnessLabel="Ledger">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile testId="developer-ledger-count-open" value={snapshot.counts.open} label="open items" />
        <CountTile testId="developer-ledger-count-p1" value={snapshot.counts.p1} label="blocking, priority P1" />
        <CountTile testId="developer-ledger-count-queued" value={snapshot.counts.queued} label="in the running order" />
        <CountTile
          testId="developer-ledger-count-pending"
          value={snapshot.counts.pending}
          label="requests not yet applied"
        />
      </div>

      {grouped.P1.length > 0 ? (
        <PanelSection
          testId="developer-ledger-blockers"
          headingId="developer-ledger-blockers-heading"
          heading="Blocking now"
          className="grid gap-2 rounded-xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] px-4 py-3"
        >
          <ul className="grid gap-2">
            {grouped.P1.map((item) => (
              <li key={item.id} className="text-sm leading-6 text-[color:var(--text-heading)]">
                <span className="font-mono text-xs text-[color:var(--text-muted)]">{item.id}</span> {item.summary}
              </li>
            ))}
          </ul>
          <p className={META_CLASS}>Full detail for each of these is in the open items list below.</p>
        </PanelSection>
      ) : null}

      <PanelSection headingId="developer-ledger-queue-heading" heading="Recommended running order">
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
      </PanelSection>

      <PanelSection headingId="developer-ledger-open-heading" heading="Open items">
        {/*
         * Search and filter run client-side over the groups built here, so the
         * P1 -> P2 -> P3 -> other ordering stays decided in one place. The
         * blocking list and the running order above stay unfiltered.
         */}
        <LedgerFilter groups={openGroups} />
      </PanelSection>

      <PanelSection headingId="developer-ledger-pending-heading" heading="Requests not yet applied">
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
                className={CARD_CLASS}
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
      </PanelSection>
    </PanelPageShell>
  );
}
