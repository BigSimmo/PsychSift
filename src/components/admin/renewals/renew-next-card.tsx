import { Check } from "lucide-react";

import { AdminSection, adminStyles } from "@/components/admin/admin-kit";
import { requirementActionLine } from "@/components/admin/renewals/urgency";
import { WorkCard, WorkDateRow, WorkEmpty } from "@/components/mode-kit/work";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";
import { renewNextNothingDueLine, type RenewNext } from "@/lib/admin/renew-next";
import type { RequirementChecklistRow } from "@/lib/admin/requirements";

/** How many later dates "Coming later" lists. */
const COMING_LATER = 4;

/**
 * Renewals' top card when nothing is due (Josh's locked mockup, "Nothing
 * due"): a calm empty state that names the next date ahead and how many items
 * still have no date, so it never reads as all clear, then "Coming later" with
 * the soonest recorded dates. While something IS due, the Needs action list
 * leads the page instead and this renders nothing (Today's hero carries
 * "Renew next").
 */
export function RenewNextCard({
  next,
  notRecorded,
  rows,
  now,
  onOpen,
  onShowAll,
}: {
  readonly next: RenewNext;
  /** Items with no date recorded, said beside "Nothing to renew right now" so it never reads as all clear. */
  readonly notRecorded: number;
  /** The checklist's rows, for "Coming later". */
  readonly rows: readonly RequirementChecklistRow[];
  readonly now: Date;
  readonly onOpen: (row: RequirementChecklistRow) => void;
  /** "All N": takes the reader to the full list below. */
  readonly onShowAll: () => void;
}) {
  if (next.kind !== "nothing-due") return null;
  const later = rows
    .filter((row): row is RequirementChecklistRow & { expiresOn: string } => Boolean(row.expiresOn))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
    .slice(0, COMING_LATER);
  return (
    <>
      <WorkCard testId="admin-renew-next-nothing-due">
        <section aria-labelledby="admin-renew-next-heading">
          <WorkEmpty
            icon={Check}
            title={<span id="admin-renew-next-heading">Nothing to renew right now</span>}
            body={
              <>
                {next.next
                  ? renewNextNothingDueLine(next.next)
                  : "No renewal dates are recorded yet. Dates you record appear here."}
                {notRecorded > 0 ? (
                  <span className="mt-1 block" data-testid="admin-renew-next-not-recorded">
                    {`${notRecorded} ${notRecorded === 1 ? "item has" : "items have"} no date recorded yet.`}
                  </span>
                ) : null}
              </>
            }
          />
        </section>
      </WorkCard>
      {later.length > 0 ? (
        <AdminSection
          label="Coming later"
          action={{ label: `All ${rows.length}`, onClick: onShowAll }}
          testId="admin-renew-next-later"
        >
          <WorkCard as="ul">
            {later.map((row) => {
              const { day, month } = onCallTeachingDateParts(row.expiresOn);
              return (
                <li key={row.item.id}>
                  <WorkDateRow
                    month={month}
                    day={day}
                    title={row.item.title}
                    sub={<span className={adminStyles.mono}>{requirementActionLine(row, now)}</span>}
                    onClick={() => onOpen(row)}
                  />
                </li>
              );
            })}
          </WorkCard>
        </AdminSection>
      ) : null}
    </>
  );
}
