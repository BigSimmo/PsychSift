import { cn, textMuted } from "@/components/ui-primitives";
import { LEAVE_CASUAL_NOTE, LEAVE_ENTITLEMENTS, LEAVE_SIGN_OFF } from "@/lib/admin/leave-entitlements";
import type { LeaveTypeId } from "@/lib/admin/leave-types";
import { formatDateEcho } from "@/lib/admin/renewal-dates";

/**
 * The signed-off lines for one leave card, each with its clause, then the casual
 * doctors line and the sign-off line. Shared by the Leave wallet card and Roster's
 * leave sheet, so both always show the same figures.
 */
export function LeaveEntitlementList({ card, testIdPrefix }: { card: LeaveTypeId; testIdPrefix: string }) {
  return (
    <>
      {LEAVE_ENTITLEMENTS[card].map((group) => (
        <div key={group.heading ?? "all"} className="grid gap-1">
          {group.heading ? (
            <p className="text-xs font-semibold text-[color:var(--text-heading)]">{group.heading}</p>
          ) : null}
          <ul className="grid gap-1.5">
            {group.lines.map((line) => (
              <li key={line.text} className="grid gap-0.5 text-sm text-[color:var(--text)]">
                <span>{line.text}</span>
                <span className={cn(textMuted, "text-xs")}>Clause {line.clause}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="grid gap-0.5 text-sm text-[color:var(--text)]" data-testid={`${testIdPrefix}-casual`}>
        <span>{LEAVE_CASUAL_NOTE.text}</span>
        <span className={cn(textMuted, "text-xs")}>Clause {LEAVE_CASUAL_NOTE.clause}</span>
      </p>
      <p className={cn(textMuted, "text-xs")}>
        From the AMA Industrial Agreement 2024, checked and signed off {formatDateEcho(LEAVE_SIGN_OFF.signedOn)}. Your
        health service confirms what applies to you.
      </p>
    </>
  );
}
