export type JwtPayload = {
  role?: unknown;
  exp?: unknown;
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
  [key: string]: unknown;
};

export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;

  try {
    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const jsonStr = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("utf-8");
    const payload = JSON.parse(jsonStr) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

export function isValidJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  if (typeof payload.exp !== "number") return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSeconds) return false;
  return true;
}

export async function timingSafeSecretEqual(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [candidateDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const candidateBytes = new Uint8Array(candidateDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < candidateBytes.length; index += 1) {
    difference |= candidateBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

/**
 * Dual-gate authentication for indexing-v3-agent:
 * Requires BOTH a valid internal service secret (via x-indexing-agent-secret or x-cron-secret)
 * AND a valid JWT (via Authorization: Bearer <token>).
 */
export async function authorizeIndexingAgentRequest(req: Request, agentSecret: string): Promise<Response | null> {
  if (!agentSecret) {
    return Response.json({ ok: false, error: "INDEXING_V3_AGENT_SECRET is required" }, { status: 500 });
  }

  // Dual-gate 1: Internal service secret via dedicated header
  const headerSecret = req.headers.get("x-indexing-agent-secret") ?? req.headers.get("x-cron-secret") ?? "";
  if (!headerSecret || !(await timingSafeSecretEqual(headerSecret, agentSecret))) {
    return Response.json({ ok: false, error: "Unauthorized: invalid service secret" }, { status: 401 });
  }

  // Dual-gate 2: Valid JWT via Authorization: Bearer <jwt>
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer || !isValidJwt(bearer)) {
    return Response.json({ ok: false, error: "Unauthorized: valid JWT required" }, { status: 401 });
  }

  return null;
}
