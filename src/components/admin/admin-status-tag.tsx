import { cn } from "@/components/ui-primitives";
import { COMPLIANCE_BUCKET_LABELS, type ComplianceBucket } from "@/lib/admin/compliance-overview";

import styles from "./admin-status.module.css";

/**
 * Admin's ONE status mark (work-mode redesign, owner request 6 Oct 2026).
 *
 * Every status Admin draws goes through this file: the tag (shape and word on
 * a flat tint), the round circle that leads a row, and the bare shape for
 * counts, legends and the timeline. Red means the recorded date has passed and
 * amber means it is time to start renewing; every other status is grey. The
 * shape and the word always travel with the colour, so nothing depends on
 * colour alone. The colours live in `admin-status.module.css`, the only Admin
 * file `tests/admin-design-contract.test.ts` lets name them.
 *
 * Words are the live app's only: Recorded, Start renewing, Date passed, Not
 * recorded yet and Not for this job. Never a verdict.
 */
export type AdminStatus = ComplianceBucket | "not-for-job" | "plain";

const STATUS_WORDS: Record<AdminStatus, string> = {
  ...COMPLIANCE_BUCKET_LABELS,
  "not-for-job": "Not for this job",
  plain: "",
};

/** The mockup's shapes, drawn on a 10px grid: a diamond, a triangle, a dashed ring, a dot. */
export function AdminStatusMark({ status }: { readonly status: AdminStatus }) {
  if (status === "date-passed") {
    return (
      <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.mark} data-mark="diamond">
        <path d="M5 .6 9.4 5 5 9.4.6 5z" />
      </svg>
    );
  }
  if (status === "start-renewing") {
    return (
      <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.mark} data-mark="triangle">
        <path d="M5 .8 9.4 9H.6z" />
      </svg>
    );
  }
  if (status === "not-recorded" || status === "not-for-job") {
    return (
      <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.mark} data-mark="ring" data-open="">
        <circle cx="5" cy="5" r="3.9" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 1.6" />
      </svg>
    );
  }
  if (status === "recorded") {
    return (
      <svg viewBox="0 0 10 10" aria-hidden="true" className={styles.mark} data-mark="dot">
        <circle cx="5" cy="5" r="3.2" />
      </svg>
    );
  }
  return null;
}

/** The status tag: shape, then the word in small caps, on a flat tint. */
export function AdminStatusTag({
  status,
  label,
  testId,
  className,
}: {
  readonly status: AdminStatus;
  /** Overrides the word, for example "Due" or "Start 10 Jan". */
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  return (
    <span data-admin-status={status} data-testid={testId} className={cn(styles.tag, className)}>
      <AdminStatusMark status={status} />
      {label ?? STATUS_WORDS[status]}
    </span>
  );
}

/** The round circle that leads a row, tinted by status. Decorative: the row says the word. */
export function AdminStatusIcon({ status }: { readonly status: AdminStatus }) {
  return (
    <span aria-hidden="true" data-admin-status={status} className={styles.icon}>
      <AdminStatusMark status={status} />
    </span>
  );
}

/** The bare shape in its status colour, for counts, legends and the timeline. */
export function AdminStatusShape({ status, className }: { readonly status: AdminStatus; readonly className?: string }) {
  return (
    <span aria-hidden="true" data-admin-status={status} className={cn(styles.shape, className)}>
      <AdminStatusMark status={status} />
    </span>
  );
}

/** Colours an element (for example an SVG mark) by status, for drawings that cannot hold a span. */
export function adminStatusColour(status: AdminStatus): { className: string; "data-admin-status": AdminStatus } {
  return { className: styles.shape, "data-admin-status": status };
}

/** The dashed "Rule to confirm" tag: the catalogue could not confirm this rule from its source. */
export function AdminRuleToConfirm({ label = "Rule to confirm" }: { readonly label?: string }) {
  return <span className={styles.rule}>{label}</span>;
}

/** The status a row's urgency word names, so callers holding only the word draw the same tag. */
export function adminStatusForWord(word: string): AdminStatus {
  if (word === "Date passed") return "date-passed";
  if (word === "Start renewing") return "start-renewing";
  if (word === "Not recorded yet") return "not-recorded";
  if (word === "Not for this job") return "not-for-job";
  if (word === "Recorded") return "recorded";
  return "plain";
}
