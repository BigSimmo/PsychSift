import {
  DEFAULT_REMINDER_SETTINGS,
  mergeReminderSettings,
  normalizeReminderSettings,
  type ReminderSettings,
  type ReminderSettingsPatch,
} from "@/lib/reminders/settings-model";

export type DensityPreference = "comfortable" | "compact" | "spacious";
/**
 * "system" follows prefers-reduced-motion. "reduced" and "full" are explicit
 * overrides in either direction — "full" exists because iOS Reduce Motion is
 * often switched on for app-launch zoom rather than vestibular sensitivity, and
 * without an opt-in it silently freezes this app's answer-progress feedback.
 */
export type MotionPreference = "system" | "reduced" | "full";
export type PopulationPreference = "adults" | "older-adults" | "adolescents" | "all";
export type AnswerStylePreference = "conservative" | "balanced" | "comprehensive";
export type LandingPreference = "ask" | "search" | "browse";
/**
 * The doctor's own description of where they are in their career, chosen on
 * Work profile. It is self-reported and never checked: a roster team's grade
 * is set by its manager and stays separate (`src/lib/roster/team/model.ts`).
 * Null until the doctor chooses.
 */
export type WorkStagePreference = "intern" | "resident" | "registrar" | "consultant" | "other";
export type RanzcpStagePreference = 1 | 2 | 3;

export type AppPreferences = {
  density: DensityPreference;
  motion: MotionPreference;
  jurisdiction: string;
  population: PopulationPreference;
  answerStyle: AnswerStylePreference;
  landing: LandingPreference;
  showRecentOnHome: boolean;
  showProtocolsOnHome: boolean;
  compactCitations: boolean;
  /**
   * Off means the app stops writing recent questions to session storage at all,
   * rather than writing them and offering a clear button. Consumed by
   * `rememberRecentQuery` in ClinicalDashboard, so it is a real privacy control
   * on a shared machine — not a display toggle like `showRecentOnHome`.
   */
  saveRecentSearches: boolean;
  notifyGuidelineUpdates: boolean;
  notifyProductNews: boolean;
  notifySavedChanges: boolean;
  workStage: WorkStagePreference | null;
  /** Only meaningful when `workStage` is "registrar"; kept otherwise so a mistaken tap loses nothing. */
  ranzcpStage: RanzcpStagePreference | null;
  /**
   * Reminder controls: in-app visibility, snooze, calendar alerts, quiet hours
   * and the daily alert cap. See `@/lib/reminders/settings-model`. The defaults
   * reproduce the app as it was before these existed.
   */
  reminders: ReminderSettings;
};

/**
 * What a PUT may carry. `reminders` may be partial: fields and reminder types
 * a client omits keep their stored value, so an older tab that knows fewer
 * types cannot reset the ones it does not know about.
 */
export type AccountPreferencesPatch = Partial<Omit<AppPreferences, "reminders">> & {
  reminders?: ReminderSettingsPatch;
};

export const JURISDICTION_OPTIONS = [
  { value: "wa", label: "Western Australia" },
  { value: "nsw", label: "New South Wales" },
  { value: "vic", label: "Victoria" },
  { value: "qld", label: "Queensland" },
  { value: "sa", label: "South Australia" },
  { value: "tas", label: "Tasmania" },
  { value: "act", label: "Australian Capital Territory" },
  { value: "nt", label: "Northern Territory" },
  { value: "national", label: "National (Australia)" },
] as const;

export const POPULATION_OPTIONS: ReadonlyArray<{ value: PopulationPreference; label: string }> = [
  { value: "adults", label: "Adults" },
  { value: "older-adults", label: "Older adults" },
  { value: "adolescents", label: "Adolescents" },
  { value: "all", label: "All ages" },
];

export const ANSWER_STYLE_OPTIONS: ReadonlyArray<{
  value: AnswerStylePreference;
  label: string;
  description: string;
}> = [
  { value: "conservative", label: "Conservative", description: "Guideline-first, cautious phrasing" },
  { value: "balanced", label: "Balanced", description: "Guidelines with practical context" },
  { value: "comprehensive", label: "Comprehensive", description: "Fuller detail and alternatives" },
];

export const WORK_STAGE_OPTIONS: ReadonlyArray<{ value: WorkStagePreference; label: string; description: string }> = [
  { value: "intern", label: "Intern", description: "PGY1" },
  { value: "resident", label: "Resident", description: "PGY2 and beyond, not in training" },
  { value: "registrar", label: "Psychiatry registrar", description: "Choose your RANZCP stage next" },
  { value: "consultant", label: "Consultant psychiatrist", description: "" },
  { value: "other", label: "Other", description: "" },
];

export const RANZCP_STAGE_OPTIONS: ReadonlyArray<RanzcpStagePreference> = [1, 2, 3];

export const DENSITY_OPTIONS: ReadonlyArray<{ value: DensityPreference; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
  { value: "spacious", label: "Spacious" },
];

export const MOTION_OPTIONS: ReadonlyArray<{ value: MotionPreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "reduced", label: "Reduced" },
  { value: "full", label: "Full" },
];

export const LANDING_OPTIONS: ReadonlyArray<{ value: LandingPreference; label: string }> = [
  { value: "ask", label: "Ask" },
  { value: "search", label: "Search" },
  { value: "browse", label: "Browse" },
];

export const DEFAULT_PREFERENCES: AppPreferences = {
  density: "comfortable",
  motion: "system",
  jurisdiction: "wa",
  population: "adults",
  answerStyle: "conservative",
  landing: "ask",
  showRecentOnHome: true,
  showProtocolsOnHome: true,
  compactCitations: false,
  saveRecentSearches: true,
  notifyGuidelineUpdates: true,
  notifyProductNews: false,
  notifySavedChanges: true,
  workStage: null,
  ranzcpStage: null,
  reminders: DEFAULT_REMINDER_SETTINGS,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceEnum<T extends string>(value: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  return typeof value === "string" && (allowed as ReadonlyArray<string>).includes(value) ? (value as T) : fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export const PREFERENCE_FIELD_KEYS = [
  "density",
  "motion",
  "jurisdiction",
  "population",
  "answerStyle",
  "landing",
  "showRecentOnHome",
  "showProtocolsOnHome",
  "compactCitations",
  "saveRecentSearches",
  "notifyGuidelineUpdates",
  "notifyProductNews",
  "notifySavedChanges",
  "workStage",
  "ranzcpStage",
  "reminders",
] as const satisfies ReadonlyArray<keyof AppPreferences>;

/**
 * Apply a partial preference update without overwriting fields omitted from the
 * request body. Pre-change clients that PUT an older shape must not re-enable
 * privacy opt-outs stored on the account.
 */
export function mergeAccountPreferences(stored: unknown, patch: AccountPreferencesPatch): AppPreferences {
  const base = stored === null || stored === undefined ? DEFAULT_PREFERENCES : normalizePreferences(stored);
  const { reminders, ...rest } = patch;
  return normalizePreferences({
    ...base,
    ...rest,
    reminders: reminders ? mergeReminderSettings(base.reminders, reminders) : base.reminders,
  });
}

export function normalizePreferences(input: unknown): AppPreferences {
  if (!isPlainObject(input)) return DEFAULT_PREFERENCES;
  const jurisdiction =
    typeof input.jurisdiction === "string" && JURISDICTION_OPTIONS.some((option) => option.value === input.jurisdiction)
      ? input.jurisdiction
      : DEFAULT_PREFERENCES.jurisdiction;
  return {
    density: coerceEnum(input.density, ["comfortable", "compact", "spacious"], DEFAULT_PREFERENCES.density),
    motion: coerceEnum(input.motion, ["system", "reduced", "full"], DEFAULT_PREFERENCES.motion),
    jurisdiction,
    population: coerceEnum(
      input.population,
      ["adults", "older-adults", "adolescents", "all"],
      DEFAULT_PREFERENCES.population,
    ),
    answerStyle: coerceEnum(
      input.answerStyle,
      ["conservative", "balanced", "comprehensive"],
      DEFAULT_PREFERENCES.answerStyle,
    ),
    landing: coerceEnum(input.landing, ["ask", "search", "browse"], DEFAULT_PREFERENCES.landing),
    showRecentOnHome: coerceBoolean(input.showRecentOnHome, DEFAULT_PREFERENCES.showRecentOnHome),
    showProtocolsOnHome: coerceBoolean(input.showProtocolsOnHome, DEFAULT_PREFERENCES.showProtocolsOnHome),
    compactCitations: coerceBoolean(input.compactCitations, DEFAULT_PREFERENCES.compactCitations),
    saveRecentSearches: coerceBoolean(input.saveRecentSearches, DEFAULT_PREFERENCES.saveRecentSearches),
    notifyGuidelineUpdates: coerceBoolean(input.notifyGuidelineUpdates, DEFAULT_PREFERENCES.notifyGuidelineUpdates),
    notifyProductNews: coerceBoolean(input.notifyProductNews, DEFAULT_PREFERENCES.notifyProductNews),
    notifySavedChanges: coerceBoolean(input.notifySavedChanges, DEFAULT_PREFERENCES.notifySavedChanges),
    workStage: WORK_STAGE_OPTIONS.some((option) => option.value === input.workStage)
      ? (input.workStage as WorkStagePreference)
      : null,
    ranzcpStage: (RANZCP_STAGE_OPTIONS as ReadonlyArray<unknown>).includes(input.ranzcpStage)
      ? (input.ranzcpStage as RanzcpStagePreference)
      : null,
    reminders: normalizeReminderSettings(input.reminders),
  };
}

/** "Psychiatry registrar · Stage 2", or null when the doctor has not said. Self-reported. */
export function workStageLabel(stage: WorkStagePreference | null, ranzcp: RanzcpStagePreference | null): string | null {
  if (!stage) return null;
  const label = WORK_STAGE_OPTIONS.find((option) => option.value === stage)?.label ?? null;
  if (stage === "registrar" && ranzcp) return `${label} · Stage ${ranzcp}`;
  return label;
}
