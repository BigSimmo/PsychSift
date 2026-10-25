const secretFlagNames = [
  "api[-_]?key",
  "auth[-_]?token",
  "access[-_]?token",
  "refresh[-_]?token",
  "service[-_]?key",
  "client[-_]?secret",
  "private[-_]?key",
  "password",
  "secret",
  "token",
].join("|");

const secretFlagPattern = new RegExp(
  `(\\-\\-(?:${secretFlagNames})(?:=|\\s+))(?:(?:"[^"]*")|(?:'[^']*')|(?:[^\\s]+))`,
  "gi",
);
const secretEnvironmentPattern =
  /\b([A-Z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|SERVICE_ROLE_KEY|SERVICE_KEY|CLIENT_SECRET|PRIVATE_KEY|PASSWORD|SECRET|TOKEN))\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|(?:[^\s]+))/g;
const authorizationPattern = /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const knownTokenPattern =
  /\b(?:crsr_|sk-|sb_secret_|ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|rk_live_|pk_live_)[A-Za-z0-9._-]{8,}\b/gi;
// Any scheme, so postgresql://, redis:// and similar connection strings lose their password too.
const urlCredentialPattern = /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi;

/**
 * Redact common credential forms before command, process, or failure text is
 * persisted or printed. This is a safety net, not permission to collect secret
 * values when metadata-only inspection is sufficient.
 */
export function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(secretFlagPattern, "$1[REDACTED]")
    .replace(secretEnvironmentPattern, "$1=[REDACTED]")
    .replace(authorizationPattern, "$1 [REDACTED]")
    .replace(jwtPattern, "[REDACTED]")
    .replace(knownTokenPattern, "[REDACTED]")
    .replace(urlCredentialPattern, "$1[REDACTED]@");
}
