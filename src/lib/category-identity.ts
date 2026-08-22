// Canonical category identity: which glyph and which accent a card wears.
//
// Before this module the answer was spread across at least ten independent maps
// and two of them disagreed. `launcherIconById` (applications-launcher-page.tsx)
// carried 13 tool ids; `iconByToolId` (tools-search-results-page.tsx) carried 8
// with a different fallback, so `guidelines`, `care-plans`, `safety-plan`,
// `calculators` and `monitoring` showed a real glyph on the launcher and a
// generic grid glyph on the results page. Colour diverged the same way: the
// launcher tinted by tool area, the results page painted every tile
// `--type-source`. One tool, two identities, depending on which screen you
// reached it from.
//
// Framework-free on purpose — no `lucide-react`, no JSX — so server code and
// data modules can name a glyph without pulling in the render layer. This is the
// same split `semantic-tone.ts` uses for `SEMANTIC_ICON_KEYS`, and the string
// key is also what lets the render boundary resolve icons through
// `createElement` rather than binding a capitalised component to a render-body
// local (which `react-hooks/static-components` forbids). Resolution lives in
// `src/components/category-identity-icons.ts`.

import type { AppModeId } from "@/lib/app-modes";
import type { ToolCatalogArea, ToolCatalogId } from "@/lib/tools-catalog";

/**
 * Category accents, named for the token triad each one resolves to.
 *
 * Every value here is deliberately drawn from the two NON-semantic identity
 * families — `--type-*` (globals.css) and `--tone-*` — plus the product accent.
 * None of them may ever resolve to `--danger`, `--warning`, `--success` or
 * `--info`: those six tones belong to `semantic-tone.ts`, where meaning drives
 * the colour. A category is not a status, and painting one in warning-amber
 * asserts caution about a whole family of content that nothing has reviewed.
 * `tests/design-token-contract.test.ts` holds that separation.
 */
export type CategoryAccent =
  // --type-* identity triads
  | "document"
  | "table"
  | "search"
  | "source"
  | "service"
  | "form"
  // --tone-* triads
  | "purple"
  | "indigo"
  | "rose"
  | "slate"
  // the product accent
  | "clinical";

export const CATEGORY_ACCENTS: readonly CategoryAccent[] = [
  "document",
  "table",
  "search",
  "source",
  "service",
  "form",
  "purple",
  "indigo",
  "rose",
  "slate",
  "clinical",
] as const;

/**
 * Glyph keys, resolved to Lucide components at the render boundary.
 *
 * Keys are shared across axes on purpose: the `documents` app mode and the
 * `documents` tool are the same thing reached two ways, and they should not
 * drift apart again.
 */
export const CATEGORY_ICON_KEYS = [
  "sparkles",
  "fileText",
  "route",
  "fileSignature",
  "heart",
  "heartHandshake",
  "brainCircuit",
  "bookOpenCheck",
  "tags",
  "network",
  "pill",
  "wrench",
  "calculator",
  "compass",
  "bookOpenText",
  "bookMarked",
  "search",
  "scrollText",
  "shieldCheck",
  "users",
  "fileCheck2",
  "clipboardCheck",
  "clipboardList",
  "waves",
  "star",
  "chat",
  "activity",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

/**
 * App modes. Exhaustive by type, so a new mode cannot ship without a glyph.
 * `src/lib/app-mode-icons.ts` resolves this to Lucide components and keeps its
 * own export name, so nav, universal search and favourites are untouched.
 */
export const APP_MODE_ICON: Record<AppModeId, CategoryIconKey> = {
  answer: "sparkles",
  documents: "fileText",
  services: "route",
  forms: "fileSignature",
  favourites: "heart",
  differentials: "brainCircuit",
  dsm: "bookOpenCheck",
  specifiers: "tags",
  formulation: "network",
  prescribing: "pill",
  tools: "wrench",
  calculators: "calculator",
  "therapy-compass": "compass",
  factsheets: "bookOpenText",
  dictionary: "bookMarked",
};

/**
 * Tools. Keyed by the catalogue's own id union, so the record cannot be
 * under-filled: adding a tool without choosing a glyph is a type error rather
 * than a silent `?? Grid2X2`. `registry-mode-nav.tsx` already argues for this
 * shape; the tools surfaces are where it was missing.
 *
 * `guidelines` moved off `shieldCheck` — it shared the glyph with `risk-safety`,
 * so one screen showed the same shield for "clinical guidance" and "risk and
 * safety". The shield now means safety and nothing else.
 */
export const TOOL_ICON: Record<ToolCatalogId, CategoryIconKey> = {
  "clinical-kb-search": "search",
  differentials: "brainCircuit",
  documents: "fileText",
  "clinical-dictionary": "bookMarked",
  guidelines: "scrollText",
  "risk-safety": "shieldCheck",
  "medication-prescribing": "pill",
  services: "users",
  forms: "fileCheck2",
  "care-plans": "clipboardCheck",
  "safety-plan": "clipboardList",
  calculators: "calculator",
  monitoring: "waves",
  "caring-contacts": "heartHandshake",
  favourites: "star",
  "ward-management": "activity",
};

/**
 * Tool accents follow the catalogue's `area` — the axis the user can actually
 * filter by, so the five colours on screen match the five filter chips.
 *
 * The launcher previously overrode this per id (`appIconTone`), routing
 * `differentials` and `forms` to a tone key literally named `differentials` and
 * `medication-prescribing` to one named `medication`. That made the "category
 * colour" not a category colour. Identity now comes from the glyph, which is
 * already unique per tool; colour groups the family.
 *
 * `coordination` takes `--tone-indigo` rather than the product accent, so
 * `--clinical-accent` is left to mean selection, focus and evidence rather than
 * doubling as one category among five.
 */
export const TOOL_AREA_ACCENT: Record<ToolCatalogArea, CategoryAccent> = {
  assessment: "service",
  reference: "table",
  care: "document",
  coordination: "indigo",
  saved: "search",
};

/** Human-facing names for the tool areas, used by filters and group headings. */
export const TOOL_AREA_LABEL: Record<ToolCatalogArea, string> = {
  assessment: "Assess",
  reference: "Evidence",
  care: "Treat",
  coordination: "Coordinate",
  saved: "Saved",
};

/**
 * Factsheet categories.
 *
 * The union is declared here rather than imported from the factsheets module so
 * `lib` never depends on `components`; `factsheets-data.ts` re-exports it, so
 * there is still only one definition.
 *
 * These four were the only per-category accents in the product, and two of them
 * were built from SEMANTIC tokens: Therapies on `--success-text` and Tests &
 * procedures on `--warning-text`. A category is a family of content; a semantic
 * tone is a claim about safety. Painting an entire factsheet category in
 * warning-amber asserts caution about content nothing has reviewed, and it spends
 * a colour the badge system needs to mean "pause, check, adjust". All four now
 * sit on non-semantic identity triads, which also makes them mutually distinct —
 * Medications previously used the product accent, so it was the same blue as
 * every selection and focus ring on the page.
 */
export type FactsheetCategoryKey = "Medications" | "Conditions" | "Therapies" | "Tests & procedures";

export const FACTSHEET_CATEGORY_IDENTITY: Record<FactsheetCategoryKey, CategoryIdentity> = {
  Medications: { icon: "pill", accent: "form" },
  Conditions: { icon: "brainCircuit", accent: "source" },
  Therapies: { icon: "chat", accent: "service" },
  "Tests & procedures": { icon: "clipboardList", accent: "table" },
};

export type CategoryIdentity = {
  icon: CategoryIconKey;
  accent: CategoryAccent;
};

/**
 * Calculator domains.
 *
 * Accent only — the glyphs stay in `calculator-fixtures.ts`, which already keys
 * them by domain and is the one axis whose icon map never forked.
 *
 * `risk` (suicide risk) deliberately takes an identity accent rather than
 * `--danger`. The domain label already says "Suicide risk", and an instrument is
 * not itself a warning; a red tile on a directory row would claim urgency about
 * a tool rather than about a patient. Danger stays available for what an
 * instrument actually scores.
 */
export type CalculatorDomainKey = "mood" | "anxiety" | "substance" | "risk" | "distress";

export const CALCULATOR_DOMAIN_ACCENT: Record<CalculatorDomainKey, CategoryAccent> = {
  mood: "indigo",
  anxiety: "purple",
  substance: "form",
  risk: "rose",
  distress: "service",
};

/**
 * The CSS custom properties a category accent resolves to.
 *
 * Prefer `data-category-accent` on the element and plain `var(--cat-accent)` in
 * the class string. This exists for the call sites that must pass a colour as a
 * value — a `linear-gradient` stop, a `color-mix` argument — where an attribute
 * cannot reach.
 */
const TYPE_ACCENTS: readonly CategoryAccent[] = ["document", "table", "search", "source", "service", "form"];

export function categoryAccentVars(accent: CategoryAccent): {
  accent: string;
  soft: string;
  border: string;
} {
  if (accent === "clinical") {
    return {
      accent: "var(--clinical-accent)",
      soft: "var(--clinical-accent-soft)",
      border: "var(--clinical-accent-border)",
    };
  }
  const family = TYPE_ACCENTS.includes(accent) ? "type" : "tone";
  return {
    accent: `var(--${family}-${accent})`,
    soft: `var(--${family}-${accent}-soft)`,
    border: `var(--${family}-${accent}-border)`,
  };
}

/** Resolve a tool's full identity in one call. */
export function toolIdentity(id: ToolCatalogId, area: ToolCatalogArea): CategoryIdentity {
  return { icon: TOOL_ICON[id], accent: TOOL_AREA_ACCENT[area] };
}
