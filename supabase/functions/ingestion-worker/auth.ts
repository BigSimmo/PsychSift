type JwtPayload = {
  role?: unknown;
};

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as JwtPayload) : null;
  } catch {
    return null;
  }
}

/**
 * The Edge gateway verifies the JWT before the request reaches this function
 * (`verify_jwt = true`). This second authorization gate restricts the
 * privileged direct-Postgres worker to the service-role cron token.
 */
export function hasServiceRoleAuthorization(authorization: string | null): boolean {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return false;
  return decodeJwtPayload(token)?.role === "service_role";
}
