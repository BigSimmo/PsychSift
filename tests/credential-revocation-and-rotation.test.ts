import { describe, expect, it, vi } from "vitest";

import { allowDeepHealthProbe } from "@/lib/deep-probe-auth";
import {
  developerAccessKeyMatches,
  developerAccessTokenValid,
  issueDeveloperAccessToken,
} from "@/lib/developer-area/link-access";
import { logger } from "@/lib/logger";
import {
  createEpaMagicLinkRequest,
  getEpaMagicLinkByToken,
  revokeEpaMagicLinkById,
  revokeEpaMagicLinkToken,
  submitEpaMagicLinkResponse,
} from "@/lib/teaching/assessments/magic-link";
import { teachingServiceActionSchema } from "@/lib/teaching/model";
import { hashTeachingSecret, teachingServiceMutation } from "@/lib/teaching/repository";

describe("R33 credential revocation, audit logging, and rotation overlap", () => {
  describe("EPA magic-link revocation by record id and structured audit logging", () => {
    it("revokes a pending magic link by record id when the raw token is no longer held", () => {
      const infoSpy = vi.spyOn(logger, "info");
      const created = createEpaMagicLinkRequest({
        epaCode: "EPA 1",
        traineeName: "Dr Taylor",
        supervisorName: "Dr Morgan",
      });

      expect(infoSpy).toHaveBeenCalledWith(
        "epa_magic_link_created",
        expect.objectContaining({
          id: created.request.id,
          epaNumber: 1,
        }),
      );
      // Never log the raw secret token.
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(created.token);

      // Mismatched supervisor name refuses revocation.
      expect(revokeEpaMagicLinkById(created.request.id, { supervisorName: "Dr Someone Else" })).toBe(false);
      expect(getEpaMagicLinkByToken(created.token).ok).toBe(true);

      // Matching supervisor (or no actor filter) revokes by record id.
      expect(revokeEpaMagicLinkById(created.request.id, { supervisorName: "Dr Morgan" })).toBe(true);
      expect(getEpaMagicLinkByToken(created.token)).toMatchObject({
        ok: false,
        status: "not_found",
        code: "magic_link_not_found",
      });
      expect(infoSpy).toHaveBeenCalledWith(
        "epa_magic_link_revoked",
        expect.objectContaining({
          id: created.request.id,
          method: "id",
        }),
      );

      infoSpy.mockRestore();
    });

    it("logs revocation by token and completion without exposing raw tokens or feedback text", () => {
      const infoSpy = vi.spyOn(logger, "info");
      const first = createEpaMagicLinkRequest({
        epaCode: "EPA 2",
        traineeName: "Dr Casey",
        supervisorName: "Dr Patel",
      });
      expect(revokeEpaMagicLinkToken(first.token)).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(
        "epa_magic_link_revoked",
        expect.objectContaining({
          id: first.request.id,
          method: "token",
        }),
      );

      const second = createEpaMagicLinkRequest({
        epaCode: "EPA 3",
        traineeName: "Dr Casey",
        supervisorName: "Dr Patel",
      });
      const submitted = submitEpaMagicLinkResponse(second.token, {
        level: "proximal",
        complexity: "medium",
        observed: "direct",
        strengths: "Clear clinical reasoning.",
        improvements: "Continue structured handovers.",
      });
      expect(submitted.ok).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(
        "epa_magic_link_completed",
        expect.objectContaining({
          id: second.request.id,
          epaNumber: 3,
        }),
      );
      const serializedLogs = JSON.stringify(infoSpy.mock.calls);
      expect(serializedLogs).not.toContain(first.token);
      expect(serializedLogs).not.toContain(second.token);
      expect(serializedLogs).not.toContain("Clear clinical reasoning.");

      infoSpy.mockRestore();
    });
  });

  describe("teaching display.revoke by occurrenceId and auto-revocation on display.create", () => {
    const serviceId = "11111111-1111-4111-8111-111111111111";
    const occurrenceId = "22222222-2222-4222-8222-222222222222";
    const actorId = "33333333-3333-4333-8333-333333333333";

    it("validates display.revoke with either token or occurrenceId and rejects empty payload", () => {
      expect(
        teachingServiceActionSchema.safeParse({
          action: "display.revoke",
          occurrenceId,
        }).success,
      ).toBe(true);

      expect(
        teachingServiceActionSchema.safeParse({
          action: "display.revoke",
          token: "a".repeat(64),
        }).success,
      ).toBe(true);

      expect(
        teachingServiceActionSchema.safeParse({
          action: "display.revoke",
        }).success,
      ).toBe(false);
    });

    it("revokes all active display links for an occurrenceId when the plaintext token was lost", async () => {
      const hashA = hashTeachingSecret("a".repeat(64));
      const hashB = hashTeachingSecret("b".repeat(64));
      const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
      const from = vi.fn((table: string) => {
        if (table === "teaching_display_links") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "link-a",
                        link_hash: hashA,
                        created_by: actorId,
                        teaching_occurrences: { presenter_id: actorId },
                      },
                      {
                        id: "link-b",
                        link_hash: hashB,
                        created_by: actorId,
                        teaching_occurrences: { presenter_id: actorId },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const client = { from, rpc } as unknown as Parameters<typeof teachingServiceMutation>[0];
      await expect(
        teachingServiceMutation(client, actorId, serviceId, {
          action: "display.revoke",
          occurrenceId,
        }),
      ).resolves.toEqual({});

      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenNthCalledWith(1, "teaching_command", {
        p_actor_id: actorId,
        p_service_id: serviceId,
        p_action: "display.revoke",
        p_payload: { linkHash: hashA },
      });
      expect(rpc).toHaveBeenNthCalledWith(2, "teaching_command", {
        p_actor_id: actorId,
        p_service_id: serviceId,
        p_action: "display.revoke",
        p_payload: { linkHash: hashB },
      });
    });

    it("automatically revokes prior unrevoked display links for the same occurrence on display.create", async () => {
      const priorHash = hashTeachingSecret("c".repeat(64));
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ data: { expiresAt: "2026-10-16T12:00:00Z" }, error: null })
        .mockResolvedValueOnce({ data: {}, error: null });
      const from = vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({
                data: [{ id: "prior-link", link_hash: priorHash }],
                error: null,
              }),
            }),
          }),
        }),
      }));

      const client = { from, rpc } as unknown as Parameters<typeof teachingServiceMutation>[0];
      const created = (await teachingServiceMutation(client, actorId, serviceId, {
        action: "display.create",
        occurrenceId,
        stream: "room",
      })) as { token: string; expiresAt: string };

      expect(created.token).toMatch(/^[0-9a-f]{64}$/);
      expect(rpc).toHaveBeenNthCalledWith(1, "teaching_command", {
        p_actor_id: actorId,
        p_service_id: serviceId,
        p_action: "display.create",
        p_payload: {
          occurrenceId,
          stream: "room",
          linkHash: hashTeachingSecret(created.token),
        },
      });
      expect(rpc).toHaveBeenNthCalledWith(2, "teaching_command", {
        p_actor_id: actorId,
        p_service_id: serviceId,
        p_action: "display.revoke",
        p_payload: { linkHash: priorHash },
      });
    });
  });

  describe("secondary key rotation overlap for developer-area and deep-health probe secrets", () => {
    const primaryDevKey = "1111111111111111111111111111111111111111111111111111111111111111";
    const previousDevKey = "2222222222222222222222222222222222222222222222222222222222222222";
    const unrelatedDevKey = "3333333333333333333333333333333333333333333333333333333333333333";

    it("honours cookies and URL keys signed or matching DEVELOPER_AREA_ACCESS_KEY_PREVIOUS during rotation", () => {
      const nowMs = 1_760_000_000_000;
      const tokenFromOldKey = issueDeveloperAccessToken({ DEVELOPER_AREA_ACCESS_KEY: previousDevKey }, nowMs);
      expect(tokenFromOldKey).toBeTruthy();

      const rotatedEnv = {
        DEVELOPER_AREA_ACCESS_KEY: primaryDevKey,
        DEVELOPER_AREA_ACCESS_KEY_PREVIOUS: previousDevKey,
      };

      expect(developerAccessTokenValid(tokenFromOldKey, rotatedEnv, nowMs + 5_000)).toBe(true);
      expect(developerAccessKeyMatches(primaryDevKey, rotatedEnv)).toBe(true);
      expect(developerAccessKeyMatches(previousDevKey, rotatedEnv)).toBe(true);
      expect(developerAccessKeyMatches(unrelatedDevKey, rotatedEnv)).toBe(false);
    });

    it("honours HEALTH_DEEP_PROBE_SECRET_PREVIOUS in allowDeepHealthProbe during secret rotation", () => {
      const envOverlap = {
        HEALTH_DEEP_PROBE_SECRET: "current-deep-probe-secret-value",
        HEALTH_DEEP_PROBE_SECRET_PREVIOUS: "previous-deep-probe-secret-value",
      };

      const reqCurrent = new Request("https://psychsift.test/api/health", {
        headers: { "x-health-deep-token": "current-deep-probe-secret-value" },
      });
      const reqPrevious = new Request("https://psychsift.test/api/health", {
        headers: { "x-health-deep-token": "previous-deep-probe-secret-value" },
      });
      const reqWrong = new Request("https://psychsift.test/api/health", {
        headers: { "x-health-deep-token": "wrong-deep-probe-secret-value" },
      });

      expect(allowDeepHealthProbe(reqCurrent, envOverlap)).toBe(true);
      expect(allowDeepHealthProbe(reqPrevious, envOverlap)).toBe(true);
      expect(allowDeepHealthProbe(reqWrong, envOverlap)).toBe(false);
    });
  });
});
