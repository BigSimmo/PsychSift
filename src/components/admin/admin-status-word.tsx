import { CircleDashed, Diamond, Triangle, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { COMPLIANCE_BUCKET_LABELS, type ComplianceBucket } from "@/lib/admin/compliance-overview";

/** The same grey shapes Renewals draws: shape and word, never colour alone (Admin design contract). */
const ADMIN_STATUS_SHAPES: Record<ComplianceBucket, LucideIcon | null> = {
  recorded: null,
  "start-renewing": Triangle,
  "date-passed": Diamond,
  "not-recorded": CircleDashed,
};

/**
 * One status, as the 5 Oct mock-up v2 sets it on Renewals and Compliance rows:
 * the shape, then the word at name weight, so the status is the first thing
 * read on the line. Grey by the Admin design contract (`tests/admin-design-contract.test.ts`).
 */
export function AdminStatusWord({
  bucket,
  label,
  testId,
  className,
}: {
  readonly bucket: ComplianceBucket;
  /** Overrides the word, e.g. "Not for this job". */
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  const Shape = ADMIN_STATUS_SHAPES[bucket];
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium text-[color:var(--text-heading)]",
        className,
      )}
    >
      {Shape ? <Shape aria-hidden="true" strokeWidth={1.75} className="size-icon-xs shrink-0" /> : null}
      {label ?? COMPLIANCE_BUCKET_LABELS[bucket]}
    </span>
  );
}

/** The dashed "Rule to confirm" mark: the catalogue could not confirm this rule from its source. */
export function AdminRuleToConfirm({ label = "Rule to confirm" }: { readonly label?: string }) {
  return (
    <span className="inline-flex w-fit items-center rounded-md border border-dashed border-[color:var(--text-muted)] px-1.5 text-xs leading-5 text-[color:var(--text-muted)]">
      {label}
    </span>
  );
}
