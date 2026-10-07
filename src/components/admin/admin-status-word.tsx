import { AdminRuleToConfirm, AdminStatusTag } from "@/components/admin/admin-status-tag";
import type { ComplianceBucket } from "@/lib/admin/compliance-overview";

export { AdminRuleToConfirm };

/**
 * One status on a Renewals or Compliance row: the shared status tag
 * (`admin-status-tag.tsx`), kept under its old name so callers read the same.
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
  return <AdminStatusTag status={bucket} label={label} testId={testId} className={className} />;
}
