import { describe, expect, it, vi } from "vitest";

import { PublicApiError } from "@/lib/http";
import { hashTeachingSecret, teachingServiceMutation } from "@/lib/teaching/repository";

type MockDisplayLink = { id: string; created_by: string | null } | null;

function createMockClient({
  link,
  isOrganiser,
  roleGrantedAt = "2026-01-02T00:00:00Z",
  isActiveMember = true,
  memberJoinedAt = "2026-01-01T00:00:00Z",
}: {
  link: MockDisplayLink;
  isOrganiser: boolean;
  roleGrantedAt?: string;
  isActiveMember?: boolean;
  memberJoinedAt?: string;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  const from = vi.fn((table: string) => {
    if (table === "teaching_display_links") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: link, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "teaching_member_roles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: isOrganiser ? { role: "organiser", granted_at: roleGrantedAt } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "on_call_service_members") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: isActiveMember ? { joined_at: memberJoinedAt } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from, rpc } as unknown as Parameters<typeof teachingServiceMutation>[0], rpc, from };
}

describe("teachingServiceMutation display.revoke authorization", () => {
  const serviceId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const token = "a".repeat(64);

  it("rejects a non-organiser when display link created_by is null", async () => {
    const { client, rpc } = createMockClient({
      link: { id: "link-1", created_by: null },
      isOrganiser: false,
    });

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        token,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: { code: "teaching_role_denied" },
    } satisfies Partial<PublicApiError>);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an organiser whose service membership is revoked or missing", async () => {
    const { client, rpc } = createMockClient({
      link: { id: "link-1", created_by: null },
      isOrganiser: true,
      isActiveMember: false,
    });

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        token,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: { code: "teaching_access_denied" },
    } satisfies Partial<PublicApiError>);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a stale organiser role granted before the member rejoined", async () => {
    const { client, rpc } = createMockClient({
      link: { id: "link-1", created_by: null },
      isOrganiser: true,
      roleGrantedAt: "2026-01-01T00:00:00Z",
      memberJoinedAt: "2026-02-01T00:00:00Z",
    });

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        token,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: { code: "teaching_role_denied" },
    } satisfies Partial<PublicApiError>);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows an active organiser when display link created_by is null", async () => {
    const { client, rpc } = createMockClient({
      link: { id: "link-1", created_by: null },
      isOrganiser: true,
    });

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        token,
      }),
    ).resolves.toEqual({});

    expect(rpc).toHaveBeenCalledWith("teaching_command", {
      p_actor_id: actorId,
      p_service_id: serviceId,
      p_action: "display.revoke",
      p_payload: { linkHash: hashTeachingSecret(token) },
    });
  });

  it("refuses a revoke by occurrence when the client cannot look up display links", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = { rpc } as unknown as Parameters<typeof teachingServiceMutation>[0];

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        occurrenceId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({
      details: { code: "teaching_invalid_request" },
    } satisfies Partial<PublicApiError>);

    expect(rpc).not.toHaveBeenCalled();
  });

  function occurrenceClient(rows: Array<{ id: string; link_hash: string; created_by: string | null }>) {
    const base = createMockClient({ link: null, isOrganiser: false });
    const from = vi.fn((table: string) => {
      if (table !== "teaching_display_links") return base.from(table);
      const is = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn(() => ({ eq, is }));
      return { select: vi.fn(() => ({ eq })) };
    });
    const client = { from, rpc: base.rpc } as unknown as Parameters<typeof teachingServiceMutation>[0];
    return { client, rpc: base.rpc };
  }

  it("refuses a non-organiser's revoke by occurrence when someone else created one of the links", async () => {
    const { client, rpc } = occurrenceClient([
      { id: "link-own", link_hash: "b".repeat(64), created_by: actorId },
      { id: "link-other", link_hash: "c".repeat(64), created_by: "44444444-4444-4444-8444-444444444444" },
    ]);

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        occurrenceId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: { code: "teaching_role_denied" },
    } satisfies Partial<PublicApiError>);

    // Nothing is revoked, so the caller is never told a partial revoke succeeded.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a non-organiser revoke by occurrence when every active link is their own", async () => {
    const { client, rpc } = occurrenceClient([{ id: "link-own", link_hash: "b".repeat(64), created_by: actorId }]);

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        occurrenceId: "33333333-3333-4333-8333-333333333333",
      }),
    ).resolves.toEqual({});

    expect(rpc).toHaveBeenCalledOnce();
  });

  it("allows the original creator even if not an organiser", async () => {
    const { client, rpc, from } = createMockClient({
      link: { id: "link-1", created_by: actorId },
      isOrganiser: false,
    });

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        token,
      }),
    ).resolves.toEqual({});

    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each([
    { field: "granted_at", value: "", roleGrantedAt: "", memberJoinedAt: "2026-01-01T00:00:00Z" },
    { field: "granted_at", value: "unparseable", roleGrantedAt: "not-a-date", memberJoinedAt: "2026-01-01T00:00:00Z" },
    { field: "joined_at", value: "", roleGrantedAt: "2026-01-02T00:00:00Z", memberJoinedAt: "" },
    { field: "joined_at", value: "unparseable", roleGrantedAt: "2026-01-02T00:00:00Z", memberJoinedAt: "not-a-date" },
  ])("rejects an organiser when $field is $value", async ({ roleGrantedAt, memberJoinedAt }) => {
    const { client, rpc } = createMockClient({
      link: { id: "link-1", created_by: null },
      isOrganiser: true,
      roleGrantedAt,
      memberJoinedAt,
    });

    await expect(
      teachingServiceMutation(client, actorId, serviceId, {
        action: "display.revoke",
        token,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: { code: "teaching_role_denied" },
    } satisfies Partial<PublicApiError>);

    expect(rpc).not.toHaveBeenCalled();
  });
});
