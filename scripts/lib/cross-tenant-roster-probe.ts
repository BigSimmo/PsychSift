/**
 * Roster isolation on an already registered disposable On Call service.
 * The caller verifies it, appoints A as manager, issues B a one-use invite,
 * and registers the service for cleanup before this probe starts. No real
 * service or person is modified by this module: `seedRosterFixtures` writes
 * only into that disposable service, and deleting the service removes every
 * row it wrote (each roster table cascades from on_call_services).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { addDaysToDate, perthDateOf } from "../../src/lib/roster/shifts/perth-time";
import { ROSTER_ALL_READS, ROSTER_WINDOWED_READS, type RosterAction } from "../../src/lib/roster/team/model";
import type { Database } from "../../src/lib/supabase/database.types";
import type { WriteProbeRequest } from "./cross-tenant-write-probe";

/** Rows owned by A in the disposable team, so B's refusals are tested against real targets. */
export type RosterFixtureIds = {
  assignmentId: string;
  /** A asked B; B has not answered. Only A may cancel it. */
  requestedSwapId: string;
  /** B accepted and it waits for a manager. A manages the team but is a party, so A may not approve it. */
  acceptedSwapId: string;
  /** A posted it. Only A or a manager may cancel it. */
  openShiftId: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Seeds one publication, two of A's future shifts, a requested and an accepted swap from A to B,
 * and an open gap A posted. Rows go straight in with the service role, as the roster functions
 * would leave them; the refusals under test all happen before any of these rows could change.
 */
export async function seedRosterFixtures(
  admin: SupabaseClient<Database>,
  args: { serviceId: string; userIdA: string; userIdB: string; now?: Date },
): Promise<RosterFixtureIds> {
  const now = args.now ?? new Date();
  const start = (days: number) => new Date(now.getTime() + days * DAY);
  const iso = (value: Date) => value.toISOString();
  const single = async <T extends { id: string }>(
    what: string,
    query: PromiseLike<{ data: T | null; error: { code?: string } | null }>,
  ) => {
    const { data, error } = await query;
    if (error || !data) throw new Error(`Roster fixture setup failed at ${what}: ${error?.code ?? "no row"}.`);
    return data.id;
  };
  const periodStart = perthDateOf(start(10));
  const publicationId = await single(
    "publication",
    admin
      .from("roster_publications")
      .insert({
        service_id: args.serviceId,
        version: 1,
        period_start: periodStart,
        period_end: addDaysToDate(periodStart, 6),
        published_by: args.userIdA,
      })
      .select("id")
      .single(),
  );
  const shift = (days: number) => ({
    service_id: args.serviceId,
    publication_id: publicationId,
    user_id: args.userIdA,
    starts_at: iso(start(days)),
    ends_at: iso(new Date(start(days).getTime() + 8 * HOUR)),
    shift_code: "D",
    kind: "day",
  });
  const assignmentId = await single(
    "first assignment",
    admin.from("roster_assignments").insert(shift(10)).select("id").single(),
  );
  const secondAssignmentId = await single(
    "second assignment",
    admin.from("roster_assignments").insert(shift(12)).select("id").single(),
  );
  const swap = (giveAssignmentId: string, status: "requested" | "accepted") => ({
    service_id: args.serviceId,
    requester_id: args.userIdA,
    counterparty_id: args.userIdB,
    give_assignment_id: giveAssignmentId,
    status,
    needs_manager_because: status === "accepted" ? "team_setting" : null,
    expires_at: iso(start(5)),
    accepted_at: status === "accepted" ? iso(now) : null,
  });
  const requestedSwapId = await single(
    "requested swap",
    admin.from("roster_swaps").insert(swap(assignmentId, "requested")).select("id").single(),
  );
  const acceptedSwapId = await single(
    "accepted swap",
    admin.from("roster_swaps").insert(swap(secondAssignmentId, "accepted")).select("id").single(),
  );
  const openShiftId = await single(
    "open shift",
    admin
      .from("roster_open_shifts")
      .insert({
        service_id: args.serviceId,
        starts_at: iso(start(14)),
        ends_at: iso(new Date(start(14).getTime() + 8 * HOUR)),
        shift_code: "D",
        kind: "day",
        status: "open",
        posted_by: args.userIdA,
      })
      .select("id")
      .single(),
  );
  return { assignmentId, requestedSwapId, acceptedSwapId, openShiftId };
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context}: expected an object.`);
  return value as JsonObject;
}

function teams(value: unknown, context: string): JsonObject[] {
  const rows = object(value, context).teams;
  if (!Array.isArray(rows)) throw new Error(`${context}: missing teams array.`);
  return rows.map((row) => object(row, context));
}

/**
 * Every action gets a schema-valid body; missing target rows do not excuse a membership bypass.
 * With fixtures, swap and open-shift actions target A's real rows instead of an id that matches nothing.
 */
function actionSamples(id: string, userId: string, date: string, fixtures?: RosterFixtureIds): RosterAction[] {
  const assignmentId = fixtures?.assignmentId ?? id;
  const swapId = (action: string) =>
    fixtures ? (action === "swap.approve" ? fixtures.acceptedSwapId : fixtures.requestedSwapId) : id;
  const openShiftId = fixtures?.openShiftId ?? id;
  return [
    { action: "role.set", userId, grade: "resident" },
    { action: "member.remove", userId },
    { action: "settings.set", swapApproval: "manager", rules: {}, rulesSource: null, payFortnightAnchor: null },
    { action: "unavailability.set", set: [{ date, kind: "cant" }], clear: [] },
    { action: "swap.create", giveAssignmentId: assignmentId, counterpartyId: userId },
    ...(["swap.accept", "swap.approve", "swap.decline", "swap.cancel", "swap.undo"] as const).map((action) => ({
      action,
      swapId: swapId(action),
    })),
    { action: "open.post", assignmentId },
    { action: "open.post", assignmentId, postKey: id },
    { action: "open.report", assignmentId },
    ...(["open.claim", "open.approve", "open.decline", "open.cancel", "open.withdraw"] as const).map((action) => ({
      action,
      openShiftId,
    })),
    { action: "open.release", openShiftId },
    { action: "seen.mark", publicationId: id },
    {
      action: "needs.set",
      expectedIds: [],
      needs: [{ weekday: 1, date: null, kind: "day", grade: null, siteId: null, needed: 1 }],
    },
  ];
}

export async function probeRosterIsolation(args: {
  request: WriteProbeRequest;
  tokenA: string;
  tokenB: string;
  serviceIdA: string;
  userIdB: string;
  /** A new, unused one-use invitation for B, issued by the disposable team's manager. */
  inviteCodeForB: string;
  /** A's rows from `seedRosterFixtures`; without them the swap and open-shift checks are reported as not exercised. */
  fixtures?: RosterFixtureIds;
}): Promise<{ checkpoints: string[]; skipped: string[] }> {
  const { request, tokenA, tokenB, serviceIdA, userIdB, inviteCodeForB, fixtures } = args;
  const path = `/api/roster/team/${encodeURIComponent(serviceIdA)}`;
  const today = perthDateOf(new Date());
  const to = addDaysToDate(today, 7);
  const checkpoints: string[] = [];
  const skipped: string[] = [];
  const listedA = teams(await request(tokenA, "/api/roster/team", {}, [200]), "A's roster list");
  if (!listedA.some((row) => row.serviceId === serviceIdA && row.enabled === true && row.role === "manager")) {
    return {
      checkpoints,
      skipped: [
        "Roster isolation: disposable service is not an enabled team managed by A; no Roster verdict was produced.",
      ],
    };
  }
  const listedB = teams(await request(tokenB, "/api/roster/team", {}, [200]), "B's roster list before join");
  if (listedB.some((row) => row.serviceId === serviceIdA))
    throw new Error("Roster precondition failed: B already sees A's disposable team before the invite.");
  if (!/^[a-f\d]{64}$/i.test(inviteCodeForB))
    return {
      checkpoints,
      skipped: ["Roster isolation: no unused invitation code for B; join and revocation were not exercised."],
    };

  const readPath = (what: string) => {
    const params = new URLSearchParams({ what });
    if ((ROSTER_WINDOWED_READS as readonly string[]).includes(what)) {
      params.set("from", today);
      params.set("to", to);
    }
    return `${path}?${params}`;
  };
  // Publishing takes a full JSON roster. This one is schema-valid and empty, with a stale token, so
  // a caller who got past the manager check would see 409 rather than replace anything.
  const publishBody = {
    expectedToken: "cross-tenant-probe",
    roles: [],
    codes: [],
    publication: { kind: "full", periodStart: today, periodEnd: to, sourceName: null, assignments: [] },
    openShifts: [],
    overrideChanges: [],
  };
  const publishDenied = async () => {
    await request(tokenB, `${path}/publish?from=${today}&to=${to}`, {}, [403]);
    await request(tokenB, `${path}/publish`, { method: "POST", body: publishBody }, [403]);
  };

  await request(tokenA, readPath("overview"), {}, [200]);
  for (const what of ROSTER_ALL_READS) await request(tokenB, readPath(what), {}, [403]);
  for (const body of actionSamples(serviceIdA, userIdB, to, fixtures))
    await request(tokenB, path, { method: "POST", body }, [403]);
  await publishDenied();
  await request(
    tokenB,
    `${path}/invite`,
    { method: "POST", body: { invitedEmail: "roster-probe@example.org", expiresInDays: 1 } },
    [403],
  );
  await request(tokenB, `${path}/export?from=${today}&to=${to}`, {}, [403]);
  await request(tokenB, `${path}/remind`, { method: "POST", body: {} }, [403]);
  checkpoints.push("roster-nonmember-read-and-write-isolation");

  const joined = object(
    await request(tokenB, "/api/on-call/services/join", { method: "POST", body: { code: inviteCodeForB } }, [200]),
    "Roster invite join",
  );
  if (joined.serviceId !== serviceIdA) throw new Error("Roster invitation joined a different service.");
  const afterJoin = teams(await request(tokenB, "/api/roster/team", {}, [200]), "B's roster list after join");
  if (!afterJoin.some((row) => row.serviceId === serviceIdA && row.enabled === true))
    throw new Error("B joined but cannot read the disposable roster team.");
  for (const what of ["overview", "assignments", "requests"] as const) await request(tokenB, readPath(what), {}, [200]);
  for (const what of ["manage", "people", "publications", "maker"] as const)
    await request(tokenB, readPath(what), {}, [403]);
  for (const body of actionSamples(serviceIdA, userIdB, to).filter((sample) =>
    ["role.set", "member.remove", "settings.set", "needs.set", "swap.approve", "open.approve"].includes(sample.action),
  )) {
    await request(tokenB, path, { method: "POST", body }, [403]);
  }
  await request(
    tokenB,
    `${path}/invite`,
    { method: "POST", body: { invitedEmail: "roster-probe@example.org", expiresInDays: 1 } },
    [403],
  );
  await request(tokenB, `${path}/export?from=${today}&to=${to}`, {}, [403]);
  await request(tokenB, `${path}/remind`, { method: "POST", body: {} }, [403]);
  checkpoints.push("roster-member-manager-denial");
  await publishDenied();
  checkpoints.push("roster-member-publish-denial");
  if (fixtures) {
    // B is named on both swaps but asked for neither, and is not a manager.
    await request(
      tokenB,
      path,
      { method: "POST", body: { action: "swap.cancel", swapId: fixtures.requestedSwapId } },
      [403],
    );
    await request(
      tokenB,
      path,
      { method: "POST", body: { action: "swap.cancel", swapId: fixtures.acceptedSwapId } },
      [403],
    );
    checkpoints.push("roster-pending-swap-cancel-by-other-denied");
    await request(
      tokenB,
      path,
      {
        method: "POST",
        body: { action: "swap.approve", swapId: fixtures.acceptedSwapId, acknowledgeRuleWarnings: true },
      },
      [403],
    );
    // A manages the team, but a manager never approves a swap they are part of.
    await request(
      tokenA,
      path,
      {
        method: "POST",
        body: { action: "swap.approve", swapId: fixtures.acceptedSwapId, acknowledgeRuleWarnings: true },
      },
      [403],
    );
    checkpoints.push("roster-swap-self-approval-denied");
    for (const action of ["open.cancel", "open.approve", "open.decline", "open.release"] as const)
      await request(tokenB, path, { method: "POST", body: { action, openShiftId: fixtures.openShiftId } }, [403]);
    checkpoints.push("roster-open-shift-other-poster-denied");
  } else {
    skipped.push(
      "Roster self-approval, pending-swap cancellation and open-shift checks were not exercised: no swap or open-shift fixture was seeded.",
    );
  }

  await request(tokenA, path, { method: "POST", body: { action: "member.remove", userId: userIdB } }, [200]);
  const afterRemoval = teams(await request(tokenB, "/api/roster/team", {}, [200]), "B's roster list after removal");
  if (afterRemoval.some((row) => row.serviceId === serviceIdA))
    throw new Error("B still lists A's roster team after removal.");
  for (const what of ROSTER_ALL_READS) await request(tokenB, readPath(what), {}, [403]);
  if (fixtures) {
    // Still named on A's swap and able to see the open shift id, but no longer in the team.
    await request(
      tokenB,
      path,
      { method: "POST", body: { action: "swap.accept", swapId: fixtures.requestedSwapId } },
      [403],
    );
    await request(
      tokenB,
      path,
      { method: "POST", body: { action: "open.claim", openShiftId: fixtures.openShiftId } },
      [403],
    );
  }
  await publishDenied();
  checkpoints.push("roster-member-removal-revokes-reads");
  return { checkpoints, skipped };
}
