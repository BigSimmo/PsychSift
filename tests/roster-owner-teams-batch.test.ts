import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listOwnerTeams } from "@/lib/roster/owner/teams";

describe("listOwnerTeams batched query performance", () => {
  it("executes at most 3 queries for 50 services and aggregates activeMembers and managers per service", async () => {
    const services = Array.from({ length: 50 }, (_, index) => ({
      id: `5e000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Service ${index + 1}`,
      created_at: "2026-10-01T00:00:00Z",
      verified_at: index % 2 === 0 ? "2026-10-02T00:00:00Z" : null,
      is_demo: false,
    }));

    const service0 = services[0]!.id;
    const service1 = services[1]!.id;

    const fromCalls: string[] = [];
    const inArgs: Array<{ table: string; column: string; values: unknown[] }> = [];

    const client = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        const chain = {
          select: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          range: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          in: vi.fn((column: string, values: unknown[]) => {
            inArgs.push({ table, column, values });
            return chain;
          }),
          then: (resolve: (value: unknown) => unknown) => {
            if (table === "on_call_services") {
              return resolve({ data: services, error: null });
            }
            if (table === "on_call_service_members") {
              return resolve({
                data: [
                  { service_id: service0, user_id: "u1" },
                  { service_id: service0, user_id: "u2" },
                  { service_id: service0, user_id: "u3" },
                  { service_id: service1, user_id: "u4" },
                ],
                error: null,
              });
            }
            if (table === "roster_member_roles") {
              return resolve({
                data: [
                  { service_id: service0, user_id: "u1" },
                  { service_id: service0, user_id: "u2" },
                ],
                error: null,
              });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      }),
    };

    const result = await listOwnerTeams(client as unknown as Parameters<typeof listOwnerTeams>[0]);

    expect(fromCalls).toEqual(["on_call_services", "on_call_service_members", "roster_member_roles"]);
    expect(fromCalls.length).toBeLessThanOrEqual(3);
    expect(inArgs).toHaveLength(2);
    expect(inArgs[0]?.values).toHaveLength(50);
    expect(inArgs[1]?.values).toHaveLength(50);

    expect(result.teams).toHaveLength(50);
    expect(result.teams[0]).toMatchObject({
      serviceId: service0,
      activeMembers: 3,
      managers: 2,
    });
    expect(result.teams[1]).toMatchObject({
      serviceId: service1,
      activeMembers: 1,
      managers: 0,
    });
    expect(result.teams[2]).toMatchObject({
      serviceId: services[2]!.id,
      activeMembers: 0,
      managers: 0,
    });
  });

  it("returns empty teams immediately without querying members or roles when no services exist", async () => {
    const fromCalls: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        const chain = {
          select: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
        };
        return chain;
      }),
    };

    const result = await listOwnerTeams(client as unknown as Parameters<typeof listOwnerTeams>[0]);
    expect(result).toEqual({ teams: [] });
    expect(fromCalls).toEqual(["on_call_services"]);
  });

  it("pages through every membership so counts stay exact beyond one page", async () => {
    const serviceId = "5e000000-0000-4000-8000-000000000001";
    const services = [
      { id: serviceId, name: "Service", created_at: "2026-10-01T00:00:00Z", verified_at: null, is_demo: false },
    ];
    const memberRows = Array.from({ length: 1005 }, (_, index) => ({ service_id: serviceId, user_id: `u${index}` }));
    const client = {
      from: vi.fn((table: string) => {
        let from = 0;
        let to = 0;
        const chain = {
          select: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          in: vi.fn(() => chain),
          range: vi.fn((start: number, end: number) => {
            from = start;
            to = end;
            return chain;
          }),
          then: (resolve: (value: unknown) => unknown) => {
            if (table === "on_call_services") return resolve({ data: services, error: null });
            if (table === "on_call_service_members") {
              return resolve({ data: memberRows.slice(from, to + 1), error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      }),
    };

    const result = await listOwnerTeams(client as unknown as Parameters<typeof listOwnerTeams>[0]);
    expect(result.teams[0]).toMatchObject({ serviceId, activeMembers: 1005, managers: 0 });
  });
});
