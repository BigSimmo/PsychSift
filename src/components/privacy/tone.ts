import type { PrivacyTone } from "@/lib/privacy-page-content";

/**
 * The privacy surface's three tones, kept in one place so the processing map,
 * the fact grid, and the section rail cannot drift apart. Tokens only — the
 * page is inside `no-hardcoded-hex`.
 */

export const privacyToneText: Record<PrivacyTone, string> = {
  accent: "text-[color:var(--clinical-accent)]",
  neutral: "text-[color:var(--text-muted)]",
  warn: "text-[color:var(--warning-text)]",
};

export const privacyToneSurface: Record<PrivacyTone, string> = {
  accent: "bg-[color:var(--clinical-accent-soft)]/55",
  neutral: "bg-[color:var(--surface-subtle)]/80",
  warn: "bg-[color:var(--warning-bg)]/80",
};
