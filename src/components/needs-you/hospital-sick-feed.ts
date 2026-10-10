import type { AdminNotificationRead } from "@/components/needs-you/use-admin-notification-sources";
import { hospitalSickNotificationItems } from "@/lib/needs-you/hospital-sick-items";
import { fetchHospitalSick } from "@/lib/work-roles/hospital-client";
import {
  maySeeHospitalSick,
  sickHospitals,
  type HospitalRef,
  type HospitalSickView,
} from "@/lib/work-roles/hospital-hub";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { fetchWorkPeople } from "@/lib/work-roles/people-client";
import { watchWorkRoleGrants } from "@/lib/work-roles/use-work-roles";

/*
 * The Sick calls source's reads, loaded only for a reader who holds Medical
 * Workforce or the site administrator role, so the bell carries none of the
 * role rules for anyone else. It reads the reader's roles, the administrator's
 * hospital list, then each hospital's sick calls (`/api/work/hospital/sick`,
 * the read the Sick calls screen makes). It never writes.
 */

/** At most this many hospitals are read at once, so a site administrator's bell stays one quick check. */
export const HOSPITAL_SICK_READ_LIMIT = 8;

const LOADING: AdminNotificationRead = { status: "loading", items: [] };
const FAILED: AdminNotificationRead = { status: "failed", items: [] };
const SIGNED_OUT: AdminNotificationRead = { status: "signed-out", items: [] };
const UNAVAILABLE: AdminNotificationRead = { status: "unavailable", items: [] };
const NOTHING: AdminNotificationRead = { status: "ready", items: [] };

async function readSickCalls(
  grants: readonly WorkRoleGrant[],
  signal: AbortSignal,
  now: Date,
  zone: string,
): Promise<AdminNotificationRead> {
  let listed: readonly HospitalRef[] = [];
  let listNotReady = false;
  if (grants.some((grant) => grant.role === "administrator")) {
    const people = await fetchWorkPeople(null, { signal });
    if (people.status === "signed-out") return SIGNED_OUT;
    if (people.status === "ok") listed = people.data.hospitals;
    else if (people.status === "not-ready") listNotReady = true;
    else return FAILED;
  }
  const hospitals = sickHospitals(grants, listed).slice(0, HOSPITAL_SICK_READ_LIMIT);
  if (!hospitals.length) return listNotReady ? UNAVAILABLE : NOTHING;
  const outcomes = await Promise.all(hospitals.map((hospital) => fetchHospitalSick(hospital.id, { signal })));
  const views: HospitalSickView[] = [];
  let notReady = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "ok") views.push(outcome.data);
    else if (outcome.status === "signed-out") return SIGNED_OUT;
    else if (outcome.status === "offline" || outcome.status === "error") return FAILED;
    // Not allowed there (a role removed since), or the role tables are not built yet: nothing to say.
    else if (outcome.status === "not-ready") notReady += 1;
  }
  if (notReady === outcomes.length) return UNAVAILABLE;
  return { status: "ready", items: hospitalSickNotificationItems(views, grants, now, zone) };
}

/** Watch the reader's roles and read their hospitals' sick calls. Calls `onRead` with each read; returns a stop function. */
export function watchHospitalSickNeedsYou(
  input: { readonly userId: string; readonly now: Date; readonly zone: string },
  onRead: (read: AdminNotificationRead) => void,
): () => void {
  let live = true;
  let controller: AbortController | null = null;
  let lastGrants = "";
  const send = (read: AdminNotificationRead) => {
    if (live) onRead(read);
  };
  const stopWatching = watchWorkRoleGrants(input.userId, (view) => {
    if (view.status !== "ready" || !maySeeHospitalSick(view.grants)) {
      lastGrants = "";
      controller?.abort();
      controller = null;
      send(
        view.status === "loading"
          ? LOADING
          : view.status === "signed-out"
            ? SIGNED_OUT
            : view.status === "unavailable"
              ? UNAVAILABLE
              : NOTHING,
      );
      return;
    }
    // The same roles read again (another screen's reset) need no second read of the sick calls.
    const signature = JSON.stringify(view.grants);
    if (signature === lastGrants) return;
    lastGrants = signature;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    send(LOADING);
    readSickCalls(view.grants, mine.signal, input.now, input.zone).then(
      (read) => {
        if (!mine.signal.aborted) send(read);
      },
      () => {
        // Aborted: a newer read replaced this one, or the source stopped. Anything else is a failed check.
        if (!mine.signal.aborted) send(FAILED);
      },
    );
  });
  return () => {
    live = false;
    controller?.abort();
    stopWatching();
  };
}
