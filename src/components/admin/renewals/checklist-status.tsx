import { AdminStatusTag, adminStatusForWord } from "@/components/admin/admin-status-tag";
import type { RowUrgency } from "@/components/admin/renewals/urgency";

/**
 * A checklist row's status word: the shared status tag (`admin-status-tag.tsx`).
 * Date passed is red, Start renewing amber, everything else grey, always with
 * its shape and word. A future start date ("Start 10 Jan") is a plain tag.
 */
export function ChecklistStatus({ urgency, testId }: { readonly urgency: RowUrgency; readonly testId?: string }) {
  return <AdminStatusTag status={adminStatusForWord(urgency.word)} label={urgency.word} testId={testId} />;
}
