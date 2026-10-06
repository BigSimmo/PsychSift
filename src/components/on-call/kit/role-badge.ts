/**
 * The short role badge the mock-up draws before a row (REG, CON, NIC), read
 * from words the row's title already says. Null when the title names none of
 * these roles, so nothing is invented: the row then has no badge.
 */
const ROLE_BADGES: readonly (readonly [RegExp, string])[] = [
  [/\bnurse in charge\b|\bNIC\b/i, "NIC"],
  [/\bconsultant\b/i, "CON"],
  [/\bregistrar\b/i, "REG"],
  [/\bliaison\b/i, "LIA"],
  [/\bresident\b|\bRMO\b/i, "RMO"],
  [/\bintern\b/i, "INT"],
  [/\bpharmac(y|ist)\b/i, "PHA"],
  [/\bswitchboard\b/i, "SWB"],
];

export function onCallRoleBadge(title: string): string | null {
  const ward = /\bward\s+([0-9][0-9a-z]{0,2}|[a-z][0-9]{1,2})\b/i.exec(title);
  if (ward) return `W${ward[1]!.toUpperCase()}`.slice(0, 3);
  for (const [pattern, badge] of ROLE_BADGES) if (pattern.test(title)) return badge;
  return null;
}
