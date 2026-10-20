// Single source of truth for PsychSift's *written* identity — the name, the
// catchphrase, and the descriptive lines that carry it. The drawn identity
// lives in `@/lib/brand-mark` (geometry) and `@/components/clinical-dashboard/
// brand` (the React mark); this module is its verbal half.
//
// Before this existed the product described itself four different ways in four
// files — the install prompt, the web manifest, the page metadata and the OG
// image each carried their own hand-typed sentence, and two of them disagreed
// about whether the product is a "RAG knowledge base" or a "knowledge base".
// A brand line is not prose to be re-improvised per surface, so every surface
// now reads from here and `tests/brand-copy.test.ts` fails if one drifts back
// to a literal.
//
// Pure strings, no imports, so both the server (metadata, manifest, the next/og
// routes) and client components can consume it without pulling anything into
// the client bundle graph.

/** Product name. Used verbatim — never lower-cased or split across a line. */
export const BRAND_NAME = "PsychSift";

/**
 * The catchphrase.
 *
 * It deliberately promises a *path*, not a verdict. "From question to source"
 * describes what the product actually does — take a clinical question and land
 * the reader on the passage in the original document — and claims nothing about
 * correctness, currency or sufficiency of the guidance found. That restraint is
 * the point: this is a clinical reference prototype, not validated decision
 * support (see CLAUDE.md), and a line like "the answers you can trust" would
 * assert exactly the thing the whole citation architecture exists to let a
 * clinician check for themselves.
 *
 * The wording is not new to the product — `guide-content.ts` already teaches the
 * "evidence-first workflow from question to source". This promotes the phrase
 * the app was already using to say what it is for.
 */
export const BRAND_CATCHPHRASE = "From question to source.";

/**
 * The catchphrase without its full stop, for chrome that supplies its own
 * punctuation or sets the line as a label rather than a sentence (the sidebar
 * identity line, the OG image sub-line). Kept as its own export so no caller
 * has to slice the string and quietly disagree about where it ends.
 */
export const BRAND_CATCHPHRASE_BARE = "From question to source";

/**
 * One-line description for page metadata and the web manifest — the text a
 * platform shows beside the name in an install prompt or a share card.
 *
 * "RAG" was removed here on purpose. It is accurate internally and meaningless
 * to the person reading an install sheet on their phone; the retrieval
 * architecture is described in the docs, not in the shop window.
 */
export const BRAND_DESCRIPTION = `Psychiatry guideline reference for health professionals, ${BRAND_CATCHPHRASE_BARE.toLowerCase()}.`;

/**
 * The install prompt's own line. It stays contextual rather than reusing the
 * catchphrase, because at that moment the user is being asked to do one
 * specific thing and the sheet should name the benefit of doing it.
 */
export const BRAND_INSTALL_TAGLINE = "Clinical guidelines on your home screen.";

/**
 * What the PsychSift navigation drawer *is*, for assistive technology.
 *
 * The phone drawer shows the catchphrase where this sentence used to sit, but a
 * screen-reader user arriving in the dialog needs to know what the dialog
 * contains, not what the product stands for — so this remains the accessible
 * description and the catchphrase is decorative there. Keeping both means
 * neither audience is served the other's line.
 */
export const BRAND_MENU_DESCRIPTION = "Recent chats, navigation, and settings.";

/** Alt text for the share/OG card. A colon rather than a dash, because
 *  BRAND_DESCRIPTION already carries one and two in a sentence read as a stutter. */
export const BRAND_OG_ALT = `${BRAND_NAME}: ${BRAND_DESCRIPTION}`;
