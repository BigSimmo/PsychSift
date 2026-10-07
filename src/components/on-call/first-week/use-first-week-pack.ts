"use client";

import { useCallback, useMemo } from "react";

import { useHospitalHandbook, type HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { selectNewJobRows } from "@/lib/admin/help-items";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import {
  buildFirstWeekSections,
  firstWeekPhase,
  firstWeekProgress,
  restoreFirstWeekMarks,
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
};

const NO_MARKS: Marks = {};

/**
 * Everything "Your first week" reads, in one place, so the page and a Today
 * card cannot disagree: the hospital handbook (published only), the doctor's
 * own New job start date and logins, and this device's read marks.
 */
export function useFirstWeekPack(now: Date): FirstWeekPack {
  const handbook = useHospitalHandbook();
  const entries = useOnCallEntries();
  const loadState = adminLoadState(entries);
  const startState: FirstWeekLoginsState = loadState;

  const own = useMemo(() => selectAdminOwnEntries(entries), [entries]);
  const shared = useMemo(() => selectAdminSharedEntries(entries), [entries]);
  const rows = useMemo(() => selectNewJobRows({ own, shared }), [own, shared]);
  const startsOn = loadState === "ready" ? (selectNewJobStart({ own, shared })?.startsOn ?? null) : null;

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
      }),
    [handbook.items, handbook.siteId, logins, ready, startState],
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
  };
}
