import { describe, expect, it, vi } from "vitest";

import { PublicApiError } from "@/lib/http";
import { rosterActionSchema } from "@/lib/roster/team/model";
import { rosterCommand } from "@/lib/roster/team/repository";

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const REQUESTER_ID = "33333333-3333-4333-8333-333333333333";
const COUNTERPARTY_ID = "44444444-4444-4444-8444-444444444444";
const SWAP_ID = "55555555-5555-4555-8555-555555555555";
const GIVE_ID = "66666666-6666-4666-8666-666666666666";
const PRIOR_ID = "77777777-7777-4777-8777-777777777777";

const NON_MANAGER_ID = "88888888-8888-4888-8888-888888888888";

function createMockRosterClient({
  rules,
  assignments,
  swapOverrides = {},
  memberRole = { role: "manager", confirmed_at: "2026-01-01T00:00:00Z", revoked_at: null },
}: {
  rules: Record<string, unknown>;
  assignments: Array<Record<string, unknown>>;
  swapOverrides?: Record<string, unknown>;
  memberRole?: Record<string, unknown> | null;
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: { swapId: SWAP_ID, status: "approved", autoApproved: false },
    error: null,
  });

  const from = vi.fn((table: string) => {
    if (table === "roster_swaps") {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: SWAP_ID,
            service_id: SERVICE_ID,
            status: "accepted",
            requester_id: REQUESTER_ID,
            counterparty_id: COUNTERPARTY_ID,
            give_assignment_id: GIVE_ID,
            take_assignment_id: null,
            ...swapOverrides,
          },
          error: null,
        }),
      };
      return chain;
    }
    if (table === "roster_member_roles") {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: memberRole,
          error: null,
        }),
      };
      return chain;
    }
    if (table === "roster_team_settings") {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { rules },
          error: null,
        }),
      };
      return chain;
    }
    if (table === "roster_assignments") {
      const resultPromise = Promise.resolve({ data: assignments, error: null });
      const chain = Object.assign(resultPromise, {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
      });
      return chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: { from, rpc } as unknown as Parameters<typeof rosterCommand>[0],
    rpc,
    from,
  };
}

describe("rosterCommand swap.approve server-side rule validation", () => {
  const violatingAssignments = [
    {
      id: PRIOR_ID,
      user_id: COUNTERPARTY_ID,
      roster_name: "Dr Counterparty",
      grade: "registrar",
      starts_at: "2026-10-15T14:00:00+08:00",
      ends_at: "2026-10-15T22:30:00+08:00",
      shift_code: "E",
      kind: "evening",
    },
    {
      id: GIVE_ID,
      user_id: REQUESTER_ID,
      roster_name: "Dr Requester",
      grade: "registrar",
      starts_at: "2026-10-16T06:00:00+08:00",
      ends_at: "2026-10-16T14:30:00+08:00",
      shift_code: "D",
      kind: "day",
    },
  ];

  it("rejects an unacknowledged swap that introduces a roster rule warning with 409 roster_swap_rule_warning", async () => {
    const { client, rpc } = createMockRosterClient({
      rules: { minBreakHours: 10 },
      assignments: violatingAssignments,
    });

    const parsed = rosterActionSchema.parse({
      action: "swap.approve",
      swapId: SWAP_ID,
    });

    await expect(rosterCommand(client, MANAGER_ID, SERVICE_ID, parsed)).rejects.toMatchObject({
      status: 409,
      details: { code: "roster_swap_rule_warning" },
    } satisfies Partial<PublicApiError>);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows a rule-violating swap when acknowledgeRuleWarnings is true", async () => {
    const { client, rpc } = createMockRosterClient({
      rules: { minBreakHours: 10 },
      assignments: violatingAssignments,
    });

    const parsed = rosterActionSchema.parse({
      action: "swap.approve",
      swapId: SWAP_ID,
      acknowledgeRuleWarnings: true,
    });

    await expect(rosterCommand(client, MANAGER_ID, SERVICE_ID, parsed)).resolves.toMatchObject({
      swapId: SWAP_ID,
      status: "approved",
    });

    expect(rpc).toHaveBeenCalledOnce();
  });

  it("allows an unacknowledged swap when no rule warnings are introduced", async () => {
    const { client, rpc } = createMockRosterClient({
      rules: { minBreakHours: 6 },
      assignments: violatingAssignments,
    });

    const parsed = rosterActionSchema.parse({
      action: "swap.approve",
      swapId: SWAP_ID,
    });

    await expect(rosterCommand(client, MANAGER_ID, SERVICE_ID, parsed)).resolves.toMatchObject({
      swapId: SWAP_ID,
      status: "approved",
    });

    expect(rpc).toHaveBeenCalledOnce();
  });

  it("bypasses roster_swap_rule_warning and reaches roster_command for expired swaps", async () => {
    const { client, rpc } = createMockRosterClient({
      rules: { minBreakHours: 10 },
      assignments: violatingAssignments,
      swapOverrides: { expires_at: "2020-01-01T00:00:00Z" },
    });

    const parsed = rosterActionSchema.parse({
      action: "swap.approve",
      swapId: SWAP_ID,
    });

    await expect(rosterCommand(client, MANAGER_ID, SERVICE_ID, parsed)).resolves.toMatchObject({
      swapId: SWAP_ID,
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("bypasses roster_swap_rule_warning and reaches roster_command when actor is a party to the swap (requester_id)", async () => {
    const { client, rpc } = createMockRosterClient({
      rules: { minBreakHours: 10 },
      assignments: violatingAssignments,
    });

    const parsed = rosterActionSchema.parse({
      action: "swap.approve",
      swapId: SWAP_ID,
    });

    await expect(rosterCommand(client, REQUESTER_ID, SERVICE_ID, parsed)).resolves.toMatchObject({
      swapId: SWAP_ID,
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("bypasses roster_swap_rule_warning and reaches roster_command when actor is not a manager", async () => {
    const { client, rpc } = createMockRosterClient({
      rules: { minBreakHours: 10 },
      assignments: violatingAssignments,
      memberRole: null,
    });

    const parsed = rosterActionSchema.parse({
      action: "swap.approve",
      swapId: SWAP_ID,
    });

    await expect(rosterCommand(client, NON_MANAGER_ID, SERVICE_ID, parsed)).resolves.toMatchObject({
      swapId: SWAP_ID,
    });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
