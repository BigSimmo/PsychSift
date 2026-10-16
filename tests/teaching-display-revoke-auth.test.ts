import { describe, expect, it, vi } from "vitest";

import { PublicApiError } from "@/lib/http";
import { hashTeachingSecret, teachingServiceMutation } from "@/lib/teaching/repository";

type MockDisplayLink = { id: string; created_by: string | null } | null;

function createMockClient({
  link,
  isOrganiser,
}: {
  link: MockDisplayLink;
  isOrganiser: boolean;
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
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: isOrganiser ? { role: "organiser" } : null, error: null }),
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
});
