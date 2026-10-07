"use client";

import { useCallback, useMemo } from "react";

import { useHospitalHandbook, type HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { selectNewJobRows } from "@/lib/admin/help-items";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import {
  buildFirstWeekSections,
  firstWeekLandAlertOn,
  firstWeekPhase,
  firstWeekProgress,
  isFirstWeekHighlighted,
  restoreFirstWeekMarks,
  setFirstWeekLandAlert,
  setFirstWeekSectionRead,
  FIRST_WEEK_SECTION_IDS,
  type FirstWeekLogin,
  type FirstWeekLoginsState,
  type FirstWeekPhase,
  type FirstWeekSection,
  type FirstWeekSectionId,
} from "@/lib/on-call/first-week-pack";
import { useFirstWeekReadStore } from "@/lib/on-call/first-week-store";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

type Marks = Readonly<Partial<Record<FirstWeekSectionId, string>>>;

export type FirstWeekPack = {
  readonly handbook: HospitalHandbookState;
  /** The start date's own load state: New job is online only, so a failed read is never "no date". */
  readonly startState: FirstWeekLoginsState;
  readonly startsOn: string | null;
  readonly phase: FirstWeekPhase;
  readonly logins: readonly FirstWeekLogin[];
  readonly sections: readonly FirstWeekSection[];
  /** Null until this device's marks have been read. */
  readonly marks: Marks | null;
  readonly progress: { readonly read: number; readonly total: number; readonly changed: number };
  /** The marks are kept in memory only (the signed-out sample). */
  readonly sample: boolean;
  readonly retryEntries: () => void;
  /** Mark one section read (or, with `read` false, unread). Returns the previous mark, for Undo. */
  readonly markSection: (id: FirstWeekSectionId, read: boolean) => string | undefined;
  /** Mark every section that holds something read. Returns the previous marks, for Undo. */
  readonly markAll: () => Marks;
  /** Clear every mark for this hospital. Returns the previous marks, for Undo. */
  readonly clearAll: () => Marks;
  readonly restore: (marks: Marks) => void;
  /** Put one section's mark back to exactly what it was (Undo after Mark as read). */
  readonly restoreSection: (id: FirstWeekSectionId, previous: string | undefined) => void;
  /** "Tell me when it lands" (on by default); null until this device has been read. */
  readonly landAlert: boolean | null;
  readonly setLandAlert: (on: boolean) => void;
};

const NO_MARKS: Marks = {};

/**
 * Everything "Your first week" reads, in one place, so the page and a Today
 * card cannot disagree: the hospital handbook (published only), the doctor's
 * own New job start date and logins, and this device's read marks.
 *
 * `feed: true` is for a page that only surfaces the pack (the Notification centre, My Day Today): example
 * records are left out, and the handbook is read only while the pack is highlighted.
 */
export function useFirstWeekPack(now: Date, { feed = false }: { readonly feed?: boolean } = {}): FirstWeekPack {
  const entries = useOnCallEntries();
  const loadState = adminLoadState(entries);
  const startState: FirstWeekLoginsState = loadState;

  // A feed (the Notification centre, My Day Today) never takes a start date or a login from example records.
  const own = useMemo(() => {
    const all = selectAdminOwnEntries(entries);
    return feed ? withoutExampleRecords(all) : all;
  }, [entries, feed]);
  const shared = useMemo(() => {
    const all = selectAdminSharedEntries(entries);
    return feed ? withoutExampleRecords(all) : all;
  }, [entries, feed]);
  const rows = useMemo(() => selectNewJobRows({ own, shared }), [own, shared]);
  const startsOn = loadState === "ready" ? (selectNewJobStart({ own, shared })?.startsOn ?? null) : null;
  // A feed reads the hospital handbook only while the pack is highlighted, so other weeks cost no request.
  const handbook = useHospitalHandbook({
    enabled: !feed || isFirstWeekHighlighted(firstWeekPhase(startsOn, now)),
  });

  const logins = useMemo<FirstWeekLogin[]>(
    () =>
      loadState === "ready"
        ? rows.logins.map(({ entry, source }) => {
            const details =
              typeof entry.details === "object" && entry.details !== null
                ? (entry.details as Record<string, unknown>)
                : {};
            return {
              id: entry.id,
              title: entry.title,
              ready: source === "you" ? details.done === true : null,
              source,
            };
          })
        : [],
    [loadState, rows.logins],
  );

  const ready = handbook.status === "ready";
  const sections = useMemo(
    () =>
      buildFirstWeekSections({
        items: ready ? handbook.items : [],
        siteId: handbook.siteId,
        logins,
        loginsState: startState,
        startsOn,
      }),
    [handbook.items, handbook.siteId, logins, ready, startState, startsOn],
  );

  const sample = handbook.demo;
  const store = useFirstWeekReadStore(sample);
  const hospitalKey = handbook.hospitalKey ?? (sample ? "sample" : null);
  const marks: Marks | null =
    store.state === null ? null : hospitalKey ? (store.state.hospitals[hospitalKey] ?? NO_MARKS) : NO_MARKS;
  const progress = useMemo(() => firstWeekProgress(sections, marks ?? NO_MARKS), [marks, sections]);

  const { update } = store;
  const markSection = useCallback(
    (id: FirstWeekSectionId, read: boolean) => {
      if (!hospitalKey) return undefined;
      const previous = marks?.[id];
      update((state) => setFirstWeekSectionRead(state, hospitalKey, id, read ? new Date().toISOString() : null));
      return previous;
    },
    [hospitalKey, marks, update],
  );
  const markAll = useCallback(() => {
    const previous = { ...(marks ?? NO_MARKS) };
    if (!hospitalKey) return previous;
    const at = new Date().toISOString();
    update((state) => {
      let next = state;
      for (const section of sections) {
        if (section.count > 0) next = setFirstWeekSectionRead(next, hospitalKey, section.id, at);
      }
      return next;
    });
    return previous;
  }, [hospitalKey, marks, sections, update]);
  const clearAll = useCallback(() => {
    const previous = { ...(marks ?? NO_MARKS) };
    if (!hospitalKey) return previous;
    update((state) => {
      let next = state;
      for (const id of FIRST_WEEK_SECTION_IDS) next = setFirstWeekSectionRead(next, hospitalKey, id, null);
      return next;
    });
    return previous;
  }, [hospitalKey, marks, update]);
  const restore = useCallback(
    (previous: Marks) => {
      if (!hospitalKey) return;
      update((state) => restoreFirstWeekMarks(state, hospitalKey, previous));
    },
    [hospitalKey, update],
  );

  const restoreSection = useCallback(
    (id: FirstWeekSectionId, previous: string | undefined) => {
      if (!hospitalKey) return;
      update((state) => setFirstWeekSectionRead(state, hospitalKey, id, previous ?? null));
    },
    [hospitalKey, update],
  );

  const setLandAlert = useCallback((on: boolean) => update((state) => setFirstWeekLandAlert(state, on)), [update]);

  return {
    handbook,
    startState,
    startsOn,
    phase: firstWeekPhase(startsOn, now),
    logins,
    sections,
    marks,
    progress,
    sample,
    retryEntries: entries.retry,
    markSection,
    markAll,
    clearAll,
    restore,
    restoreSection,
    landAlert: store.state === null ? null : firstWeekLandAlertOn(store.state),
    setLandAlert,
  };
}
