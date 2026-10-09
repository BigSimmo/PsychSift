import {
  Bell,
  CircleHelp,
  CircleUserRound,
  FlaskConical,
  Keyboard,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

/**
 * The settings surface's section list and its search index.
 *
 * Both live here rather than inside `settings-dialog.tsx` so the dialog,
 * desktop rail and desktop search field all read one source of truth.
 * `tests/settings-search.dom.test.tsx` pins the index against the rows the
 * dialog actually renders, so an added row cannot silently become
 * unsearchable — the index is declarative on purpose, and that test is what
 * stops it drifting from the JSX.
 */

export type SettingsSectionId =
  | "account"
  | "clinical-defaults"
  | "app-preferences"
  | "personalisation"
  | "notifications"
  | "privacy"
  | "keyboard"
  | "help"
  | "development";

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  navLabel: string;
  /** Shown as the section heading; the rail uses the shorter `navLabel`. */
  title: string;
  icon: LucideIcon;
}> = [
  { id: "account", navLabel: "Account", title: "Account", icon: CircleUserRound },
  { id: "clinical-defaults", navLabel: "Clinical defaults", title: "Clinical defaults", icon: Stethoscope },
  { id: "app-preferences", navLabel: "App preferences", title: "App preferences", icon: SlidersHorizontal },
  { id: "personalisation", navLabel: "Personalisation", title: "Personalisation", icon: Sparkles },
  { id: "notifications", navLabel: "Notifications", title: "Notifications", icon: Bell },
  { id: "privacy", navLabel: "Privacy", title: "Privacy & security", icon: ShieldCheck },
  { id: "keyboard", navLabel: "Shortcuts", title: "Keyboard shortcuts", icon: Keyboard },
  { id: "help", navLabel: "Help & About", title: "Help & About", icon: CircleHelp },
  { id: "development", navLabel: "Owner panel", title: "Owner panel", icon: FlaskConical },
];

export function sectionDomId(id: SettingsSectionId) {
  return `settings-section-${id}`;
}

/** Stable per-row test id, derived from the visible label. */
export function settingsRowTestId(label: string) {
  return `settings-row-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

export type SettingsSearchEntry = {
  /** Matches the row's `data-testid`. */
  id: string;
  section: SettingsSectionId;
  label: string;
  /**
   * Words a reader might type that do not appear in the row's own label.
   * "Interface density" is the app's text-size control (it scales the rem
   * baseline), so "text size" and "font" have to reach it or nobody looking for
   * larger text will ever find it.
   */
  keywords: string;
};

export const SETTINGS_SEARCH_ENTRIES: ReadonlyArray<SettingsSearchEntry> = [
  {
    id: "settings-account-card",
    section: "account",
    label: "Account",
    keywords: "sign in sign out log in log out create account email magic link apple google microsoft sso profile",
  },
  {
    id: "settings-row-preference-sync",
    section: "account",
    label: "Settings sync",
    keywords: "sync synchronise backup devices cloud saved to account retry",
  },
  {
    id: "settings-row-jurisdiction",
    section: "clinical-defaults",
    label: "Jurisdiction",
    keywords: "state territory region western australia wa nsw victoria queensland national location",
  },
  {
    id: "settings-row-default-population",
    section: "clinical-defaults",
    label: "Default population",
    keywords: "age group adults older adults elderly adolescents youth paediatric cohort",
  },
  {
    id: "settings-row-answer-style",
    section: "clinical-defaults",
    label: "Answer style",
    keywords: "tone detail conservative balanced comprehensive verbosity length",
  },
  {
    id: "settings-row-appearance",
    section: "app-preferences",
    label: "Appearance",
    keywords: "theme dark mode light mode night colour color system contrast",
  },
  {
    id: "settings-row-interface-density",
    section: "app-preferences",
    label: "Interface density",
    keywords: "text size font size larger smaller bigger zoom scale spacing compact spacious comfortable readability",
  },
  {
    id: "settings-row-default-landing-view",
    section: "app-preferences",
    label: "Default landing view",
    keywords: "start page home screen opening view ask search browse first screen",
  },
  {
    id: "settings-row-motion",
    section: "app-preferences",
    label: "Motion",
    keywords: "animation reduce motion vestibular transitions accessibility",
  },
  {
    id: "settings-row-time-zone",
    section: "app-preferences",
    label: "Time zone",
    keywords:
      "timezone clock perth awst aest sydney melbourne brisbane adelaide darwin hobart roster shift times daylight saving",
  },
  {
    id: "settings-row-example-data",
    section: "app-preferences",
    label: "Example data",
    keywords: "sample demo made up fake test data look around explore tour work mode",
  },
  {
    id: "settings-row-live-version",
    section: "app-preferences",
    label: "Live version",
    keywords: "newest everyone preview test tester beta new features early access release version",
  },
  {
    id: "settings-row-hide-new-work-screens",
    section: "app-preferences",
    label: "Hide new work screens",
    keywords: "classic work mode new features roll back undo turn off preview contract leave sick cpd home",
  },
  {
    id: "settings-row-recent-searches-on-home",
    section: "personalisation",
    label: "Recent searches on home",
    keywords: "history recents home screen show hide",
  },
  {
    id: "settings-row-saved-protocols-on-home",
    section: "personalisation",
    label: "Saved protocols on home",
    keywords: "favourites protocols home screen show hide",
  },
  {
    id: "settings-row-compact-citations",
    section: "personalisation",
    label: "Compact citations",
    keywords: "sources references footnotes citation length short",
  },
  {
    id: "settings-row-guideline-updates",
    section: "notifications",
    label: "Guideline updates",
    keywords: "alerts notify email new guidance",
  },
  {
    id: "settings-row-product-news",
    section: "notifications",
    label: "Product news",
    keywords: "alerts notify email announcements releases",
  },
  {
    id: "settings-row-saved-item-changes",
    section: "notifications",
    label: "Saved item changes",
    keywords: "alerts notify email favourites updated",
  },
  {
    id: "settings-row-reminders",
    section: "notifications",
    label: "Reminders",
    keywords:
      "snooze quiet hours calendar alarm phone alert cpd routines year-end claim on call checks compliance dates teaching daily limit show in the app",
  },
  {
    id: "settings-row-save-recent-searches",
    section: "privacy",
    label: "Save recent searches",
    keywords: "history private incognito shared computer stop recording remember questions",
  },
  {
    id: "settings-row-clear-recent-searches",
    section: "privacy",
    label: "Clear recent searches",
    keywords: "delete history erase wipe remove questions",
  },
  {
    id: "settings-row-clear-saved-items",
    section: "privacy",
    label: "Clear saved items",
    keywords: "delete favourites bookmarks erase wipe remove",
  },
  {
    id: "settings-row-reset-preferences",
    section: "privacy",
    label: "Reset preferences",
    keywords: "defaults restore factory start over undo settings",
  },
  {
    id: "settings-row-reset-app-preferences-only",
    section: "privacy",
    label: "Reset app preferences only",
    keywords: "defaults restore appearance density motion landing keep clinical partial reset",
  },
  {
    id: "settings-keyboard-shortcuts",
    section: "keyboard",
    label: "Keyboard shortcuts",
    keywords: "hotkeys keys command palette slash escape shortcut cheatsheet",
  },
  {
    id: "settings-row-guide-help",
    section: "help",
    label: "Guide & help",
    keywords: "about support documentation how to onboarding tour version",
  },
  {
    id: "settings-row-development-page",
    section: "development",
    label: "Owner panel",
    keywords: "developer admin owner settings uploads sign-off prototype mockups experimental in progress",
  },
];

/** Lowercased, whitespace-collapsed search terms. Empty query means no filter. */
export function settingsSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function entryHaystack(entry: SettingsSearchEntry): string {
  const section = SETTINGS_SECTIONS.find((item) => item.id === entry.section);
  return `${entry.label} ${entry.keywords} ${section?.title ?? ""} ${section?.navLabel ?? ""}`.toLowerCase();
}

/**
 * Row ids matching every term (AND, so "dark theme" narrows rather than
 * widens). Returns `null` for an empty query, which callers read as "no filter
 * — render everything" rather than "nothing matched".
 */
export function matchingSettingsRowIds(query: string): Set<string> | null {
  const terms = settingsSearchTerms(query);
  if (terms.length === 0) return null;
  const matches = new Set<string>();
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    const haystack = entryHaystack(entry);
    if (terms.every((term) => haystack.includes(term))) matches.add(entry.id);
  }
  return matches;
}

/** Sections keeping at least one matching row, in rail order. */
export function matchingSettingsSectionIds(matches: Set<string> | null): SettingsSectionId[] {
  if (!matches) return SETTINGS_SECTIONS.map((section) => section.id);
  const sections = new Set<SettingsSectionId>();
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    if (matches.has(entry.id)) sections.add(entry.section);
  }
  return SETTINGS_SECTIONS.map((section) => section.id).filter((id) => sections.has(id));
}
