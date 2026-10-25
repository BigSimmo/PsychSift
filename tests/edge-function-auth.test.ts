import { describe, expect, it } from "vitest";

import {
  authorizeIndexingAgentRequest,
  decodeJwtPayload,
  isValidJwt,
  timingSafeSecretEqual,
} from "../supabase/functions/indexing-v3-agent/auth";

const mockAgentKey = "unit-test-fixture-agent-key";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = "dummy-signature";
  return `${header}.${body}.${signature}`;
}

const validJwt = makeJwt({
  sub: "user-test-id",
  role: "service_role",
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const expiredJwt = makeJwt({
  sub: "user-test-id",
  role: "service_role",
  exp: Math.floor(Date.now() / 1000) - 60,
});

describe("indexing-v3-agent timingSafeSecretEqual", () => {
  it("returns true only for exact secret match", async () => {
    expect(await timingSafeSecretEqual("secret", "secret")).toBe(true);
    expect(await timingSafeSecretEqual("secret", "wrong")).toBe(false);
    expect(await timingSafeSecretEqual("", "secret")).toBe(false);
  });

  it("handles multi-byte and variable-length strings without throwing", async () => {
    expect(await timingSafeSecretEqual("é", "ab")).toBe(false);
    expect(await timingSafeSecretEqual("short", "much-longer-secret-value")).toBe(false);
  });
});

describe("indexing-v3-agent decodeJwtPayload & isValidJwt", () => {
  it("decodes a valid JWT payload", () => {
    const decoded = decodeJwtPayload(validJwt);
    expect(decoded?.role).toBe("service_role");
    expect(decoded?.sub).toBe("user-test-id");
  });

  it("returns null for non-JWT strings or malformed payload", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("a.b")).toBeNull();
    expect(decodeJwtPayload("a.not-valid-base64.c")).toBeNull();
  });

  it("validates unexpired tokens and rejects expired tokens", () => {
    expect(isValidJwt(validJwt)).toBe(true);
    expect(isValidJwt(expiredJwt)).toBe(false);
    expect(isValidJwt("invalid.token.signature")).toBe(false);
  });

  it("rejects token without expiration claim", () => {
    const noExpJwt = makeJwt({ sub: "user-1", role: "service_role" });
    expect(isValidJwt(noExpJwt)).toBe(false);
  });
});

describe("indexing-v3-agent dual-gate authorization (Task #P6BSQ3)", () => {
  it("fails with 500 when INDEXING_V3_AGENT_SECRET is unset", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-indexing-agent-secret": mockAgentKey,
        authorization: `Bearer ${validJwt}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, "");
    expect(res).not.toBeNull();
    expect(res?.status).toBe(500);
    const body = await res?.json();
    expect(body.error).toContain("INDEXING_V3_AGENT_SECRET is required");
  });

  it("rejects request missing the secret header (401)", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validJwt}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("rejects request with wrong secret header (401)", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-indexing-agent-secret": "wrong-secret",
        authorization: `Bearer ${validJwt}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("rejects request where secret is passed in Bearer without secret header (prevents single-token bypass)", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        authorization: `Bearer ${mockAgentKey}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("rejects request with valid secret header but missing Authorization header (401)", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-indexing-agent-secret": mockAgentKey,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("rejects request with valid secret header but malformed Authorization header (401)", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-indexing-agent-secret": mockAgentKey,
        authorization: "Basic 12345",
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("rejects request with valid secret header but expired JWT (401)", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-indexing-agent-secret": mockAgentKey,
        authorization: `Bearer ${expiredJwt}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("authorizes request with BOTH valid secret header and valid JWT", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-indexing-agent-secret": mockAgentKey,
        authorization: `Bearer ${validJwt}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).toBeNull();
  });

  it("accepts x-cron-secret as alternative secret header with valid JWT", async () => {
    const req = new Request("http://localhost/indexing-v3-agent", {
      method: "POST",
      headers: {
        "x-cron-secret": mockAgentKey,
        authorization: `Bearer ${validJwt}`,
      },
    });
    const res = await authorizeIndexingAgentRequest(req, mockAgentKey);
    expect(res).toBeNull();
  });
});
