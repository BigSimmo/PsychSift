/** "Dr Tran Nguyen" to "TN", "Sam" to "S". Initials only, drawn from the roster's own name. */
export function rosterInitials(name: string | null): string {
  if (!name) return "";
  const words = name
    .replace(/^(dr|prof|professor|mr|mrs|ms|mx)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
