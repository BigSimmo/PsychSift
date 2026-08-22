### Task 7: Moving a contact within its day, and changing its date

Coordination design spec §5: "A coordinator may move a contact only within its scheduled day; a date change needs a reason and team-lead approval." Both are granted action names (`moveContactWithinDay`, `changeContactDate`) with no rules behind them. Spec §8 also requires that nothing sends outside 09:00–18:00 AWST and that the calendar never rebases.

**Files:**

- Create: `src/lib/caring-contacts/contact-rescheduling.ts`
- Test: `tests/caring-contacts-contact-rescheduling.test.ts` (new)

**Interfaces:**

- Consumes: `PlannedContact` from `./schedule`; `isWithinApprovedSendWindow`, `APPROVED_SEND_WINDOW` from `./schedule`; `awstCalendarDay`, `awstWallTimeToInstant`, `Clock` from `./clock`.
- Produces:

```ts
export type ContactMoveRequest = { contact: PlannedContact; toHour: number; toMinute: number };
export type ContactDateChangeRequest = {
  contact: PlannedContact;
  toCalendarDay: string;
  reason: string;
  teamLeadApprovalActorId: ActorId | null;
};

export function moveContactWithinDay(request: ContactMoveRequest): TransitionResult<PlannedContact>;
export function changeContactDate(request: ContactDateChangeRequest, clock: Clock): TransitionResult<PlannedContact>;
```

**Rules:** `moveContactWithinDay` refuses `contact-move-leaves-scheduled-day` when the resulting instant's AWST calendar day differs from the contact's `calendarDay`, and `contact-move-outside-approved-window` when the new time is outside 09:00–18:00. `changeContactDate` refuses `contact-date-change-reason-required` on a blank reason, `contact-date-change-approval-required` when `teamLeadApprovalActorId` is null, and `contact-date-change-in-the-past` when the target day is before the clock's AWST day. Neither function may touch `sequence`, `cadenceLabel`, `messageType` or `suppressed` — the calendar identity is fixed even when the instant moves.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { awstWallTimeToInstant, fixedClock } from "@/lib/caring-contacts/clock";
import { actorId } from "@/lib/caring-contacts/ids";
import { changeContactDate, moveContactWithinDay } from "@/lib/caring-contacts/contact-rescheduling";
import type { PlannedContact } from "@/lib/caring-contacts/schedule";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const contact: PlannedContact = {
  sequence: 3,
  cadenceLabel: "Month 1",
  calendarDay: "2026-09-15",
  sendAt: awstWallTimeToInstant("2026-09-15", 10),
  messageType: "standard",
};

describe("rescheduling a contact", () => {
  it("moves a contact inside its own day and keeps its calendar identity", () => {
    const result = moveContactWithinDay({ contact, toHour: 14, toMinute: 0 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.sendAt).toEqual(awstWallTimeToInstant("2026-09-15", 14));
    expect(result.value.sequence).toBe(3);
    expect(result.value.cadenceLabel).toBe("Month 1");
    expect(result.value.calendarDay).toBe("2026-09-15");
  });

  it("refuses a move outside the approved send window", () => {
    expect(moveContactWithinDay({ contact, toHour: 20, toMinute: 0 })).toEqual({
      ok: false,
      reason: "contact-move-outside-approved-window",
    });
  });

  it("refuses a date change with no reason and no team-lead approval", () => {
    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-09-16", reason: " ", teamLeadApprovalActorId: actorId("LEAD") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-reason-required" });

    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-09-16", reason: "ward transfer", teamLeadApprovalActorId: null },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-approval-required" });
  });

  it("refuses a date change into the past", () => {
    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-08-01", reason: "ward transfer", teamLeadApprovalActorId: actorId("LEAD") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-in-the-past" });
  });

  it("changes the date without rebasing the cadence label", () => {
    const result = changeContactDate(
      { contact, toCalendarDay: "2026-09-16", reason: "ward transfer", teamLeadApprovalActorId: actorId("LEAD") },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.calendarDay).toBe("2026-09-16");
    expect(result.value.cadenceLabel).toBe("Month 1");
    expect(result.value.sequence).toBe(3);
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `contact-rescheduling.ts`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Drop the approved-window check → the 20:00 test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/contact-rescheduling.ts tests/caring-contacts-contact-rescheduling.test.ts
git commit -m "feat(caring-contacts): within-day contact moves and approved date changes"
```

---
