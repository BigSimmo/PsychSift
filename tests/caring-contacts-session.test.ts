import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CARING_CONTACTS_ROLE_COOKIE,
  CaringContactsDemoUnavailableError,
  DEMO_ROLES,
  demoActorForRole,
  isCaringContactsDemoEnabled,
  resolveDemoActor,
} from "@/lib/caring-contacts-server/session";
import { logger } from "@/lib/logger";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name], set: () => undefined })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mockCookies: Record<string, { value: string } | undefined> = {};
afterEach(() => {
  // `process.env.NODE_ENV` is read-only under TypeScript 6, so the production gate is
  // exercised through Vitest env stubbing rather than by assigning to it directly. This
  // restores what the assignment did and changes nothing about what is asserted.
  vi.unstubAllEnvs();
});

describe("demo role switcher", () => {
  it("offers all five roles and no credential field", () => {
    expect(DEMO_ROLES).toEqual([
      "coordinator",
      "teamLead",
      "auditor",
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
    ]);
  });

  it("defaults to the coordinator when no cookie is set", async () => {
    mockCookies = {};
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  it("falls back to the coordinator on an unreadable cookie rather than failing", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "administrator" } };
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  // Review round 1, Minor 4: only an unrecognised cookie VALUE fell back before this test. A
  // throw from cookies() itself (or from .get()) used to propagate straight out of
  // resolveDemoActor -- exactly the locked-out-of-a-demonstration outcome the fallback rule
  // exists to prevent.
  it("falls back to the coordinator when the cookie read itself fails, not only on an unrecognised value", async () => {
    vi.mocked(cookies).mockRejectedValueOnce(new Error("cookies() unavailable in this context"));
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  it("names the acting role in the actor id so the audit trail can show it", () => {
    expect(demoActorForRole("auditor").id).toBe("demo-auditor");
  });

  it("never resolves a role-only demo actor in production", async () => {
    // Explicit empty/false runtime so this assertion cannot pass because the ambient process
    // env (e.g. the repository's Cloud environment, which exports both Playwright-offline
    // flags) happens to satisfy the production lock's own exception -- see "the production
    // lock" below.
    expect(isCaringContactsDemoEnabled("production", {})).toBe(false);
    expect(isCaringContactsDemoEnabled("test")).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    await expect(resolveDemoActor()).rejects.toBeInstanceOf(CaringContactsDemoUnavailableError);
  });

  // The production lock. The gate has exactly one exception -- the repository-owned
  // isolated Playwright server -- and these pin its shape so it cannot be widened by
  // accident. Each case names the whole runtime rather than relying on ambient
  // process.env, so a stray flag in the test environment cannot make one pass.
  describe("the production lock", () => {
    const playwright = { PLAYWRIGHT_OFFLINE_MODE: "true", NEXT_PUBLIC_DEMO_MODE: "true" } as const;

    it("opens for the isolated Playwright server, which is the only exception", () => {
      expect(isCaringContactsDemoEnabled("production", playwright)).toBe(true);
    });

    it("stays shut when either half of the exception is missing", () => {
      // Neither flag alone opens it. A real deployment that happened to carry one --
      // a demo-flagged deploy, or a stray runner variable -- must still fail closed.
      expect(isCaringContactsDemoEnabled("production", { NEXT_PUBLIC_DEMO_MODE: "true" })).toBe(false);
      expect(isCaringContactsDemoEnabled("production", { PLAYWRIGHT_OFFLINE_MODE: "true" })).toBe(false);
      expect(isCaringContactsDemoEnabled("production", {})).toBe(false);
    });

    it("requires the exact string true, not merely a set variable", () => {
      // Env vars are strings; "false", "1" and "" are all truthy-looking mistakes.
      for (const value of ["false", "1", "", "TRUE", "yes"]) {
        expect(
          isCaringContactsDemoEnabled("production", {
            PLAYWRIGHT_OFFLINE_MODE: value,
            NEXT_PUBLIC_DEMO_MODE: value,
          }),
        ).toBe(false);
      }
    });

    it("does not need the exception outside production", () => {
      // Development and test are open on NODE_ENV alone; the flags are irrelevant
      // there, so removing them must not close a developer's workspace.
      expect(isCaringContactsDemoEnabled("development", {})).toBe(true);
      expect(isCaringContactsDemoEnabled("test", {})).toBe(true);
    });
  });
});

/**
 * The switcher's POST decides, in one `catch`, whether the failure it caught was the caller's or
 * the server's. Both used to be logged the same way -- not at all -- so the ONE genuine server
 * fault this route can produce was the one fault that never reached the logs.
 */
describe("the demo role switcher's POST", () => {
  function switchRole(role: unknown): Request {
    return new Request("http://localhost/api/caring-contacts/session", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  }

  beforeEach(() => {
    mockCookies = {};
    vi.mocked(logger.error).mockClear();
  });

  it("does not log an error for a role the demo does not offer -- that is the caller's mistake", async () => {
    const { POST } = await import("@/app/api/caring-contacts/session/route");

    const response = await POST(switchRole("administrator"));

    expect(response.status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs an error when the cookie write itself fails, because that one IS a server fault", async () => {
    vi.mocked(cookies).mockResolvedValueOnce({
      get: (name: string) => mockCookies[name],
      set: () => {
        throw new Error("the cookie jar is read-only in this context");
      },
    } as unknown as Awaited<ReturnType<typeof cookies>>);
    const { POST } = await import("@/app/api/caring-contacts/session/route");

    const response = await POST(switchRole("auditor"));

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns 404 in production before reading or writing a demo role cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // The route handler resolves the production lock the same ambient way `resolveDemoActor`
    // does, with no way to inject a runtime override -- stub both flags so this stays fail-closed
    // regardless of what the ambient process env happens to carry.
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.mocked(cookies).mockClear();
    const { GET, POST } = await import("@/app/api/caring-contacts/session/route");

    await expect(GET()).resolves.toMatchObject({ status: 404 });
    await expect(POST(switchRole("auditor"))).resolves.toMatchObject({ status: 404 });
    expect(cookies).not.toHaveBeenCalled();
  });
});
