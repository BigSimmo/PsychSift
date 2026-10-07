"use client";

import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { onCallEntryHref, onCallViewForEntry } from "@/components/on-call/on-call-entry-view";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { ON_CALL_VIEW_TITLES } from "@/components/on-call/on-call-section-identity";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cn, eyebrowText, floatingControl, textMuted } from "@/components/ui-primitives";
import { formatClinicalDate } from "@/lib/source-metadata";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { msUntilNextOnCallLocalDay } from "@/lib/on-call/local-date";
import { buildOnCallReviewQueue, type OnCallReviewItem } from "@/lib/on-call/review-queue";

/**
 * CHECK THESE — every entry of yours that is due for a check, soonest first.
 *
 * A wrong number at 3 am is the failure this mode most needs to prevent, and
 * numbers go stale quietly. So this page lists what has never been checked,
 * what is past its twelve months, and what reaches twelve months in the next
 * thirty days, each with "Still correct" (stamps today's date) and a link to
 * edit it where it lives.
 */
export function OnCallCheckPage({ now: nowProp }: { now?: Date } = {}) {
  const { entries, loading, isOffline, loadError, retry, cachedAt, signedOut, demoMode } = useOnCallEntries();
  const [tick, setTick] = useState(() => new Date());
  const now = nowProp ?? tick;
  useEffect(() => {
    if (nowProp) return;
    const timer = setTimeout(() => setTick(new Date()), msUntilNextOnCallLocalDay(now));
    return () => clearTimeout(timer);
  }, [nowProp, now]);
  const queue = useMemo(() => buildOnCallReviewQueue(entries, now), [entries, now]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(entry: OnCallEntry) {
    setPending(entry.id);
    setError(null);
    try {
      const response = await fetch(`/api/on-call/entries/${entry.id}/verify`, { method: "POST" });
      if (!response.ok) throw new Error(`Could not confirm ${entry.title}. Try again.`);
      const payload: unknown = await response.json();
      const updated = (payload as { entry?: OnCallEntry } | null)?.entry;
      if (updated) cacheOnCallEntries(entries.map((existing) => (existing.id === updated.id ? updated : existing)));
    } catch (failure) {
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      const isFetchError = failure instanceof TypeError && failure.message.toLowerCase().includes("fetch");
      setError(
        isOffline || isFetchError
          ? "You are offline. Connect to confirm this entry."
          : failure instanceof Error
            ? failure.message
            : "Could not confirm this entry.",
      );
    } finally {
      setPending(null);
    }
  }

  const groups: { id: string; title: string; items: readonly OnCallReviewItem[] }[] = [
    { id: "never", title: "Never checked", items: queue.neverChecked },
    { id: "overdue", title: "Overdue", items: queue.overdue },
    { id: "soon", title: "Due in the next 30 days", items: queue.dueSoon },
  ];

  return (
    <>
      <OnCallToolNavHeader title="Check these" testIdPrefix="on-call-check" />
      <InformationPageShell testId="on-call-check-main" width="narrow">
        <h1 className="sr-only">Check these</h1>
        <p className={cn(textMuted, "text-sm")}>
          Each entry needs checking every twelve months. Ring or look it up, then tap Still correct, or open it to fix
          it.
        </p>

        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}
        {demoMode ? (
          <p className={cn(textMuted, "mt-2 text-sm")}>Demo entries cannot be confirmed; sign in to check your own.</p>
        ) : null}
        <p role="status" className="mt-2 text-sm font-semibold text-[color:var(--text)]">
          {error}
        </p>

        {loading && entries.length === 0 ? (
          <OnCallEmptyState
            icon={CalendarCheck}
            title="Loading your entries"
            body="Fetching what needs checking."
            testId="on-call-check-loading"
          />
        ) : isOffline && entries.length === 0 ? (
          <OnCallLoadFailed reason={loadError} onRetry={retry} />
        ) : entries.length === 0 ? (
          // No entries is not the same as nothing due: there was nothing to
          // assess, so this must never read as though a check happened.
          <OnCallEmptyState
            icon={CalendarCheck}
            title={signedOut ? "Sign in to see your checks" : "No entries yet"}
            body={
              signedOut
                ? "Your own contacts and entries, and when each was last checked, show here once you sign in."
                : "Add contacts and other entries to On Call. Anything due for a check will then be listed here."
            }
            testId="on-call-check-no-entries"
          />
        ) : queue.assessed === 0 ? (
          <OnCallEmptyState
            icon={CalendarCheck}
            title="Nothing here for you to check"
            body="None of these entries is one you can confirm. Compliance records are kept on Compliance instead."
            testId="on-call-check-none-assessed"
          />
        ) : queue.total === 0 ? (
          <OnCallEmptyState
            icon={CalendarCheck}
            title="Nothing due for a check"
            body={`${queue.assessed === 1 ? "Your one entry was" : `All ${queue.assessed} of your entries were`} checked in the last twelve months, and none comes due in the next 30 days.`}
            testId="on-call-check-empty"
          />
        ) : (
          <div className="mt-2 flex flex-col gap-6">
            {groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <section key={group.id} aria-labelledby={`on-call-check-${group.id}`}>
                  <h2 id={`on-call-check-${group.id}`} className={cn(eyebrowText, "mb-2")}>
                    {group.title} · {group.items.length}
                  </h2>
                  <ul className="flex flex-col gap-2" data-testid={`on-call-check-group-${group.id}`}>
                    {group.items.map(({ entry, dueAt }) => (
                      <li key={entry.id} className={cn(cardSurface, "flex flex-col gap-2 p-3")}>
                        <div className="min-w-0">
                          <p className={eyebrowText}>{ON_CALL_VIEW_TITLES[onCallViewForEntry(entry)]}</p>
                          <p className="text-sm font-semibold text-[color:var(--text)]">{entry.title}</p>
                          <p className={cn(textMuted, "text-xs")}>
                            {entry.lastVerifiedAt
                              ? `Checked ${formatClinicalDate(entry.lastVerifiedAt)}${
                                  dueAt ? ` · due ${formatClinicalDate(dueAt.toISOString())}` : ""
                                }`
                              : "Never checked"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={floatingControl}
                            disabled={demoMode || pending !== null}
                            onClick={() => void confirm(entry)}
                            data-testid={`on-call-check-confirm-${entry.slug}`}
                          >
                            {pending === entry.id ? "Saving…" : "Still correct"}
                          </button>
                          <Link
                            href={onCallEntryHref(entry)}
                            className="inline-flex min-h-tap items-center px-2 text-sm font-semibold text-[color:var(--clinical-accent)]"
                          >
                            Open to edit
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </InformationPageShell>
    </>
  );
}
