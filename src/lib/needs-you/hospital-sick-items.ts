import { isExampleRecord, withoutExampleRecords } from "@/lib/example-data/guards";
import type { NotificationItem } from "@/lib/needs-you/feed";
import { hospitalSickHref, sickSummaryLine, type HospitalSickView } from "@/lib/work-roles/hospital-hub";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { zonedDateOf } from "@/lib/work-time/format";

/**
 * The Notification centre's Sick calls item, for Medical Workforce and the
 * site administrator: one line per hospital saying how many sick calls still
 * need cover from today through the next six days, the same count and words
 * the Sick calls screen shows ("2 need cover this week"). A tap opens that
 * hospital's Sick calls screen.
 *
 * A team the reader is roster manager of is left out of the count, because
 * Roster already tells them about it ("N waiting in Manage"), so nobody is
 * told twice. Only the count is shown, never a name, a shift or a reason.
 */

const DAY_MS = 86_400_000;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Stable per hospital, so a snooze holds while calls come and go. */
export function hospitalSickItemId(hospitalId: string): string {
  return `my-work:hospital-sick:${hospitalId}`;
}

/** Teams the reader is roster manager of. */
export function managedTeams(grants: readonly WorkRoleGrant[]): ReadonlySet<string> {
  return new Set(grants.flatMap((grant) => (grant.role === "manager" && grant.serviceId ? [grant.serviceId] : [])));
}

/**
 * One item per hospital with a call still needing cover this week, outside the
 * teams the reader manages. Nothing for a hospital with none. Due is the day
 * of the soonest such call, so the item sits under Today or This week.
 */
export function hospitalSickNotificationItems(
  views: readonly HospitalSickView[],
  grants: readonly WorkRoleGrant[],
  now: Date,
  zone: string,
): NotificationItem[] {
  const today = zonedDateOf(now, zone);
  const last = addDays(today, 6);
  const managed = managedTeams(grants);
  const items: NotificationItem[] = [];
  const seen = new Set<string>();
  for (const view of views) {
    const hospitalId = view.hospital.id;
    if (seen.has(hospitalId) || isExampleRecord(hospitalId)) continue;
    seen.add(hospitalId);
    const calls = withoutExampleRecords(view.calls).filter((call) => !managed.has(call.serviceId));
    const waiting = calls
      .filter((call) => call.status === "needs-cover")
      .map((call) => zonedDateOf(call.startsAt, zone))
      .filter((date) => date >= today && date <= last)
      .sort();
    const soonest = waiting[0];
    if (!soonest) continue;
    items.push({
      id: hospitalSickItemId(hospitalId),
      title: `Sick calls at ${view.hospital.name}`,
      detail: sickSummaryLine(calls, today, zone),
      due: soonest,
      area: "my-work",
      href: hospitalSickHref(hospitalId),
      // Each team's roster manager decides cover, so Medical Workforce is told rather than asked.
      kind: "update",
    });
  }
  return items;
}
