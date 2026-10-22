import { describe, expect, it } from "vitest";

import { probeRosterIsolation, type RosterFixtureIds } from "../scripts/lib/cross-tenant-roster-probe";
import type { WriteProbeRequest } from "../scripts/lib/cross-tenant-write-probe";

const SERVICE = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const CODE = "a".repeat(64);
const FIXTURES: RosterFixtureIds = {
  assignmentId: "00000000-0000-4000-8000-0000000000a1",
  requestedSwapId: "00000000-0000-4000-8000-0000000000a2",
  acceptedSwapId: "00000000-0000-4000-8000-0000000000a3",
  openShiftId: "00000000-0000-4000-8000-0000000000a4",
};
/** A member who is not the requester, poster or a manager may do none of these to A's rows. */
const NOT_FOR_B = ["swap.cancel", "open.cancel", "open.decline", "open.release"];

type Leak = "none" | "nonmember-read" | "member-manage" | "revocation" | "self-approval" | "other-cancel";

function fakeRequest(leak: Leak = "none"): WriteProbeRequest {
  let joined = false;
  let removed = false;
  return async (token, path, init, expected) => {
    const method = init.method ?? "GET";
    const who = token === "a" ? "A" : "B";
    const member = who === "A" || (joined && (!removed || leak === "revocation"));
    let status = 200;
    let payload: unknown = {};
    if (path === "/api/roster/team")
      payload = {
        teams: member ? [{ serviceId: SERVICE, enabled: true, role: who === "A" ? "manager" : "member" }] : [],
      };
    else if (path === "/api/on-call/services/join") {
      if ((init.body as { code?: string }).code !== CODE) status = 400;
      else {
        joined = true;
        payload = { serviceId: SERVICE };
      }
    } else if (path.startsWith(`/api/roster/team/${SERVICE}`)) {
      const what = new URL(path, "https://example.invalid").searchParams.get("what");
      const managerOnly =
        ["manage", "people", "publications", "maker"].includes(what ?? "") ||
        path.includes("/export") ||
        path.includes("/remind") ||
        path.includes("/invite") ||
        path.includes("/publish") ||
        (method === "POST" &&
          ["role.set", "member.remove", "settings.set", "needs.set", "swap.approve", "open.approve"].includes(
            String((init.body as { action?: string } | undefined)?.action),
          ));
      const action = method === "POST" ? String((init.body as { action?: string } | undefined)?.action) : "";
      if (!member && leak !== "nonmember-read") status = 403;
      else if (who === "B" && managerOnly && leak !== "member-manage") status = 403;
      else if (who === "B" && NOT_FOR_B.includes(action) && leak !== "other-cancel") status = 403;
      else if (who === "A" && action === "swap.approve" && leak !== "self-approval") status = 403;
      else if (
        method === "POST" &&
        (init.body as { action?: string } | undefined)?.action === "member.remove" &&
        who === "A"
      )
        removed = true;
      if (what === "overview") payload = { me: { role: who === "A" ? "manager" : "member" } };
    } else throw new Error(`Unknown fake route: ${path}`);
    if (!expected.includes(status))
      throw new Error(`${method} ${path}: status ${status}, expected ${expected.join("/")}`);
    return payload;
  };
}

const run = (request: WriteProbeRequest, fixtures?: RosterFixtureIds) =>
  probeRosterIsolation({
    fixtures,
    request,
    tokenA: "a",
    tokenB: "b",
    serviceIdA: SERVICE,
    userIdB: USER_B,
    inviteCodeForB: CODE,
  });

describe("cross-tenant Roster probe", () => {
  it("checks non-member, member and removal boundaries without claiming missing swap proof", async () => {
    const result = await run(fakeRequest());
    expect(result.checkpoints).toEqual([
      "roster-nonmember-read-and-write-isolation",
      "roster-member-manager-denial",
      "roster-member-publish-denial",
      "roster-member-removal-revokes-reads",
    ]);
    expect(result.skipped.join(" ")).toMatch(/self-approval.*not exercised/i);
  });
  it("proves swap, publish and open-shift refusals against A's real rows when fixtures are seeded", async () => {
    const result = await run(fakeRequest(), FIXTURES);
    expect(result.checkpoints).toEqual([
      "roster-nonmember-read-and-write-isolation",
      "roster-member-manager-denial",
      "roster-member-publish-denial",
      "roster-pending-swap-cancel-by-other-denied",
      "roster-swap-self-approval-denied",
      "roster-open-shift-other-poster-denied",
      "roster-member-removal-revokes-reads",
    ]);
    expect(result.skipped).toEqual([]);
  });
  it.each(["self-approval", "other-cancel"] as const)("fails when %s is allowed", async (leak) => {
    await expect(run(fakeRequest(leak), FIXTURES)).rejects.toThrow(/status 200, expected 403/);
  });
  it.each(["nonmember-read", "member-manage", "revocation"] as const)("fails on %s leakage", async (leak) => {
    await expect(run(fakeRequest(leak))).rejects.toThrow(
      leak === "revocation" ? /still lists A's roster team after removal/ : /\/api\/roster\/team/,
    );
  });
  it("reports absent setup rather than giving a passing verdict", async () => {
    const request: WriteProbeRequest = async (_token, path) => (path === "/api/roster/team" ? { teams: [] } : {});
    const result = await run(request);
    expect(result.checkpoints).toEqual([]);
    expect(result.skipped[0]).toMatch(/no Roster verdict/i);
  });
});
