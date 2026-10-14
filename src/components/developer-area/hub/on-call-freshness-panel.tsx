"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  CARD_CLASS,
  CountTile,
  META_CLASS,
  MONO_CLASS,
  ROW_CLASS,
  SECTION_HEADING_CLASS,
} from "@/components/developer-area/hub/panel-primitives";
import { ON_CALL_VIEW_TITLES } from "@/components/on-call/on-call-section-identity";
import { onCallEntryHref, onCallViewForEntry } from "@/components/on-call/on-call-entry-view";
import { summariseOnCallFreshness, type OnCallFreshnessSummary } from "@/lib/on-call/freshness-summary";
import { ON_CALL_REVIEW_INTERVAL_MONTHS, onCallEntrySchema } from "@/lib/on-call/entry-model";

/**
 * Which On Call entries are overdue for confirmation.
 *
 * This lives in the developer hub and **not** on the On Call home, by an owner
 * ruling on 2026-09-16. A strip naming overdue sections was built on the home
 * first and removed: someone opening On Call is mid-shift and looking for a
 * number, and an overdue count is a maintenance fact aimed at whoever keeps the
 * hub, not at whoever is using it. Individual rows still carry their own badge
 * inside each section, where confirming one is a single tap.
 *
 * Live, like the ingestion panel and unlike the build-time snapshot panels: it
 * reads `/api/on-call/entries` on mount. Staleness itself is never stored — it
 * is derived at read time from `lastVerifiedAt` — so this panel is always
 * answering about the hub as it stands right now.
 */

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: OnCallFreshnessSummary; signedOut: boolean; skipped: number };

/**
 * Parses only what this panel depends on, and refuses anything else.
 *
 * A 200 carrying the wrong shape degrades to the error state rather than an
 * empty summary. The distinction matters more here than in most panels: "no
 * overdue entries" and "the read failed" look identical once a bad response is
 * quietly treated as an empty list, and the first is the answer a maintainer
 * would act on by doing nothing at all.
 */
function parseEntriesPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.entries)) return null;
  const entries = [];
  let skipped = 0;
  for (const candidate of record.entries) {
    const parsed = onCallEntrySchema.safeParse(candidate);
    // A single unreadable row is dropped rather than failing the whole read: a
    // maintainer is better served by "these nine are overdue" than by nothing.
    // But the drop is counted and shown, because a silent drop undercounts, and
    // an undercount on this panel reads as reassurance.
    if (parsed.success) entries.push(parsed.data);
    else skipped += 1;
  }
  // Every row rejected while rows were sent is not an empty hub, it is a read
  // this panel could not perform — most likely a client/API schema skew. Calling
  // it "nothing overdue" would be the exact false all-clear the error state
  // exists to prevent. An genuinely empty list still parses to an empty list.
  if (record.entries.length > 0 && entries.length === 0) return null;
  return { entries, signedOut: record.signedOut === true, skipped };
}

/** "never confirmed", or how long ago it last was, in whole months. */
function lastConfirmedLabel(lastVerifiedAt: string | null, now: Date): string {
  if (!lastVerifiedAt) return "never confirmed";
  const then = Date.parse(lastVerifiedAt);
  if (Number.isNaN(then)) return "date unreadable";
  const months = Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 1) return "confirmed this month";
  return months === 1 ? "confirmed 1 month ago" : `confirmed ${months} months ago`;
}

export function OnCallFreshnessPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/on-call/entries");
        const payload: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setState({ kind: "error", message: `The entries API answered ${response.status}.` });
          return;
        }
        const parsed = parseEntriesPayload(payload);
        if (!parsed) {
          setState({ kind: "error", message: "The entries API answered in a shape this panel does not recognise." });
          return;
        }
        setState({
          kind: "ready",
          summary: summariseOnCallFreshness(parsed.entries, new Date()),
          signedOut: parsed.signedOut,
          skipped: parsed.skipped,
        });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "The entries API could not be reached." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <p data-testid="developer-on-call-freshness-loading" className={META_CLASS}>
        Reading the On Call hub.
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div data-testid="developer-on-call-freshness-error" className={CARD_CLASS}>
        <p className="text-sm font-extrabold text-[color:var(--text-heading)]">Could not read the hub</p>
        <p className={META_CLASS}>{state.message}</p>
        <p className={META_CLASS}>
          No count is shown, deliberately. A failed read and a hub with nothing overdue are different answers.
        </p>
      </div>
    );
  }

  const { summary, signedOut, skipped } = state;
  const now = new Date();

  return (
    <div className="grid gap-6">
      {skipped > 0 ? (
        <p data-testid="developer-on-call-freshness-skipped" className={META_CLASS}>
          {`${skipped} ${skipped === 1 ? "entry" : "entries"} could not be read and ${skipped === 1 ? "is" : "are"} not counted below. The count is therefore a floor, not a total.`}
        </p>
      ) : null}

      {signedOut ? (
        // Two things are missing from a signed-out read, not one, and the
        // second is the one a maintainer would never guess. Personal entries
        // are withheld because somebody flagged them; compliance requirements
        // are withheld whatever their flags say, by a rule on the raw row
        // (`rowMayBeComplianceRequirement` in `src/lib/on-call/repository.ts`)
        // that fails closed on any `logistics` row carrying a `kind` it cannot
        // read. That rule is right — a registration record belongs to one
        // person and nobody decided to publish it — but it means "3 overdue"
        // here is silently missing the rows whose lapse actually stops someone
        // working. Naming only the flag would leave a reader believing the
        // count was complete apart from a handful of private numbers.
        <p data-testid="developer-on-call-freshness-partial" className={META_CLASS}>
          Read without an account, so the counts below are a floor. Entries flagged personal are left out, and so is
          every compliance requirement — those are withheld from the shared read whatever their flags say, because a
          registration or indemnity record belongs to one person. Sign in for the whole hub.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <CountTile
          testId="developer-on-call-freshness-count-overdue"
          value={summary.staleCount}
          label={summary.staleCount === 1 ? "entry overdue" : "entries overdue"}
        />
        <CountTile
          testId="developer-on-call-freshness-count-never"
          value={summary.neverVerifiedCount}
          label={summary.neverVerifiedCount === 1 ? "never confirmed" : "never confirmed"}
        />
      </div>

      {summary.staleCount === 0 ? (
        <p data-testid="developer-on-call-freshness-clear" className={META_CLASS}>
          {`Nothing is overdue. Every entry has been confirmed within the last ${ON_CALL_REVIEW_INTERVAL_MONTHS} months.`}
        </p>
      ) : (
        <section className="grid gap-3">
          <h2 className={SECTION_HEADING_CLASS}>Overdue entries</h2>
          <p className={META_CLASS}>
            {`Worst first: never confirmed, then longest since confirmation. An entry is overdue after ${ON_CALL_REVIEW_INTERVAL_MONTHS} months.`}
          </p>
          <ul className="grid gap-2">
            {summary.stale.map(({ entry }) => (
              // By VIEW, not by stored section. Two of this mode's pages are
              // views over a section behind `details.kind` — Compliance over
              // `logistics`, Who's who over `contacts` — so naming the section
              // here labelled a registration "Admin" and linked to
              // `/on-call/logistics`, where the Admin page correctly refuses to
              // render it. That is a dead end on the single row this panel
              // exists to send you to: the one nobody has confirmed. The link
              // goes through `onCallEntryHref`, which also knows the rows Admin
              // received (Help or New job) and lands on the row's own anchor.
              <li key={entry.id} data-testid={`developer-on-call-freshness-row-${entry.id}`} className={ROW_CLASS}>
                <Link
                  href={onCallEntryHref(entry)}
                  className="text-sm font-bold text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  {entry.title}
                </Link>
                <span className={META_CLASS}>{ON_CALL_VIEW_TITLES[entry.view ?? onCallViewForEntry(entry)]}</span>
                <span className={MONO_CLASS}>{lastConfirmedLabel(entry.lastVerifiedAt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
