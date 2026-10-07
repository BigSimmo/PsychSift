import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AdminRow, AdminRowButton } from "@/components/admin/admin-kit";

/**
 * A checklist row that opens the item's sheet (work-mode redesign, owner
 * request 6 Oct 2026): the mockup's row, with a round status circle, the
 * name, a mono date line, small tags under it, and either a status at the end
 * or a real control beside it.
 *
 * Two trailing slots, because the design uses trailing space two ways:
 *  - `statusTrailing` is a status read as part of the row; tapping it still
 *    opens the sheet.
 *  - `actionTrailing` is a real control ("Add", "Move back"). It renders as a
 *    SIBLING of the pressable row, never nested inside it, and drops the chevron.
 */
export function ChecklistPressableRow({
  title,
  subtitle,
  meta,
  lead,
  statusTrailing,
  actionTrailing,
  onOpen,
  anchorId,
  testId,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly meta?: ReactNode;
  /** The round status circle at the row's start. */
  readonly lead?: ReactNode;
  readonly statusTrailing?: ReactNode;
  readonly actionTrailing?: ReactNode;
  readonly onOpen: () => void;
  /** The entry's `onCallEntryAnchorId`, when the row has an entry, so a link to that entry lands here. */
  readonly anchorId?: string;
  readonly testId?: string;
}) {
  return (
    <AdminRow
      lead={lead}
      title={title}
      sub={subtitle}
      tags={meta ?? undefined}
      end={statusTrailing}
      action={actionTrailing}
      onClick={onOpen}
      anchorId={anchorId}
      testId={testId}
    />
  );
}

/**
 * The row action ("Add", "Move back"): a 34px pill inside a 48px tap area,
 * rendered straight into the row with no wrapper of its own.
 */
export function ChecklistRowActionButton({
  label,
  onClick,
  icon,
  accessibleLabel,
  testId,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: LucideIcon;
  readonly accessibleLabel?: string;
  readonly testId?: string;
}) {
  return (
    <AdminRowButton label={label} icon={icon} onClick={onClick} accessibleLabel={accessibleLabel} testId={testId} />
  );
}
