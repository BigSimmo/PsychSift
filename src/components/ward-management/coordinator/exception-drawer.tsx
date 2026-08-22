"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { formatInstant } from "@/components/ward-management/ward-clock";
import type { InboxItem } from "@/components/ward-management/ward-derivations";
import type { Rejection } from "@/components/ward-management/ward-model";

import styles from "./coordinator.module.css";

type ExceptionDrawerProps = {
  items: InboxItem[];
  /** Transitions the reducer refused (`ward-flow-reducer.ts`'s `reject`), newest first. A
   * refusal is otherwise silent — the reducer returns state with the rejection appended rather
   * than throwing — so this is the one surface that makes a wrong role or a stale action visible
   * to a coordinator instead of swallowing it (Task 5). Rendered even when empty: an empty list
   * still tells a coordinator where to look, rather than leaving the section absent until the
   * first refusal ever happens. */
  rejections: Rejection[];
  open: boolean;
  onToggle: () => void;
  onSelectMovement: (movementId: string) => void;
};

/**
 * Task 8: the coordinator's work list, not a report — every item `buildActionInbox` returns
 * renders as its own row, and selecting one drives the same movement selection the priority
 * queue drives (`onSelectMovement` is the same setter passed to `PriorityQueue`'s `onSelect`),
 * so the explainable shortlist follows.
 *
 * Ruling 2: this renders exactly what `buildActionInbox` returns — never an invented category.
 * Spec §6 names six exception categories; the model only computes three (breached legal timing,
 * exhausted parallel referrals, transport accepted but not departed). The other three need new
 * derivations over capacity freshness and holds that this task does not own; inventing them here
 * would put computation in a component. See the task report for that gap.
 *
 * Ruling 3: the toggle's count is `items.length` — the exact same array the rows below are
 * mapped from, never a number computed independently of what actually renders (the "48 open
 * movements" defect in miniature is a header count that disagrees with the rows beneath it).
 */
export function ExceptionDrawer({ items, rejections, open, onToggle, onSelectMovement }: ExceptionDrawerProps) {
  // Newest first: `rejections` is appended to in raise order, so the array itself reads oldest
  // first — a coordinator wants to see what just got refused, not what got refused first today.
  const refusalsNewestFirst = [...rejections].reverse();
  return (
    <div className={styles.exceptionsDrawer} data-open={open}>
      <button type="button" className={styles.exceptionsToggle} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
        <span>Exceptions</span>
        <span className={styles.exceptionsToggleCount}>{items.length}</span>
      </button>
      {open ? (
        <section className={styles.exceptionsPanel} aria-label="Exceptions">
          {items.length === 0 ? (
            <p className={styles.placeholder}>No exceptions right now.</p>
          ) : (
            <ul className={styles.exceptionsList}>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-testid={`ward-exception-${item.id}`}
                      data-tone={item.tone}
                      className={styles.exceptionRow}
                      onClick={() => onSelectMovement(item.movementId)}
                    >
                      <Icon
                        aria-hidden="true"
                        className={item.tone === "danger" ? styles.exceptionIconDanger : styles.exceptionIconWarning}
                      />
                      <span className={styles.exceptionRowBody}>
                        <span className={styles.exceptionTitle}>{item.title}</span>
                        <span className={styles.exceptionDetail}>{item.detail}</span>
                        <span className={styles.exceptionOwner}>{item.owner}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Task 5: a transition the reducer refused is otherwise silent — `wardFlowReducer`
              returns state with a `Rejection` appended rather than throwing, so nothing forces
              a wrong-role or out-of-stage action onto anyone's screen unless a surface renders
              it. This list is present even with zero rows, so a coordinator learns where a
              refusal would show up before the first one ever happens. */}
          <div className={styles.refusalsSection} data-testid="ward-refusals">
            <h3 className={styles.refusalsHeading}>Refused actions</h3>
            {refusalsNewestFirst.length === 0 ? (
              <p className={styles.placeholder}>No refused actions recorded yet.</p>
            ) : (
              <ul className={styles.refusalsList}>
                {refusalsNewestFirst.map((rejection) => (
                  <li key={rejection.id} data-testid={`ward-refusal-${rejection.id}`} className={styles.refusalRow}>
                    <span className={styles.refusalAttempt}>{rejection.attempted}</span>
                    <span className={styles.refusalReason}>{rejection.reason}</span>
                    <span className={styles.refusalAt}>{formatInstant(rejection.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
