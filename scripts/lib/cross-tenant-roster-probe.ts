/**
 * Roster isolation on an already registered disposable On Call service.
 * The caller verifies it, appoints A as manager, issues B a one-use invite,
 * and registers the service for cleanup before this probe starts. No real
 * service or person is modified by this module.
 */
import { addDaysToDate, perthDateOf } from "../../src/lib/roster/shifts/perth-time";
import { ROSTER_ALL_READS, ROSTER_WINDOWED_READS, type RosterAction } from "../../src/lib/roster/team/model";
import type { WriteProbeRequest } from "./cross-tenant-write-probe";

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

/** Every action gets a schema-valid body; missing target rows do not excuse a membership bypass. */
function actionSamples(id: string, userId: string, date: string): RosterAction[] {
  return [
    { action: "role.set", userId, grade: "resident" },
    { action: "member.remove", userId },
    { action: "settings.set", swapApproval: "manager", rules: {}, rulesSource: null, payFortnightAnchor: null },
    { action: "unavailability.set", set: [{ date, kind: "cant" }], clear: [] },
    { action: "swap.create", giveAssignmentId: id, counterpartyId: userId },
    ...(["swap.accept", "swap.approve", "swap.decline", "swap.cancel", "swap.undo"] as const).map((action) => ({
      action,
      swapId: id,
    })),
    { action: "open.post", assignmentId: id },
    { action: "open.report", assignmentId: id },
    ...(["open.claim", "open.approve", "open.decline", "open.cancel"] as const).map((action) => ({
      action,
      openShiftId: id,
    })),
    { action: "open.release", openShiftId: id },
    { action: "seen.mark", publicationId: id },
    { action: "needs.set", needs: [{ weekday: 1, date: null, kind: "day", grade: null, siteId: null, needed: 1 }] },
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
}): Promise<{ checkpoints: string[]; skipped: string[] }> {
  const { request, tokenA, tokenB, serviceIdA, userIdB, inviteCodeForB } = args;
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
  await request(tokenA, readPath("overview"), {}, [200]);
  for (const what of ROSTER_ALL_READS) await request(tokenB, readPath(what), {}, [403]);
  for (const body of actionSamples(serviceIdA, userIdB, to))
    await request(tokenB, path, { method: "POST", body }, [403]);
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
  skipped.push(
    "Roster self-approval and pending-swap cancellation were not exercised: the disposable service has no published assignments or swap fixture.",
  );
  skipped.push(
    "Roster publish denial was not exercised: the JSON request harness has no valid multipart upload fixture.",
  );

  await request(tokenA, path, { method: "POST", body: { action: "member.remove", userId: userIdB } }, [200]);
  const afterRemoval = teams(await request(tokenB, "/api/roster/team", {}, [200]), "B's roster list after removal");
  if (afterRemoval.some((row) => row.serviceId === serviceIdA))
    throw new Error("B still lists A's roster team after removal.");
  for (const what of ROSTER_ALL_READS) await request(tokenB, readPath(what), {}, [403]);
  checkpoints.push("roster-member-removal-revokes-reads");
  return { checkpoints, skipped };
}
