/**
 * On Call defaults that one line flips. Import-free, because the header's pages
 * sheet reads it on every page.
 *
 * Each constant records an owner decision that is still open or a later mode's
 * move, so flipping it is the whole change: nothing else needs editing.
 */

/**
 * Who's on reads reviewed role-only cover windows. Local editor, permission and
 * changeover tests cover this Stage C path; named staff remain outside this mode.
 */
export const ON_CALL_WHOS_ON_ENABLED = true;

/**
 * The muted "You called 02:14" line on a row called this shift (idea 3; owner
 * card pending, default on). Device only, kept 12 hours, cleared at sign-out.
 */
export const ON_CALL_YOU_CALLED_ENABLED = true;

/**
 * Where on-site help lives: access, food, taxi and the other Admin-section rows.
 * The "On site: access, food, taxi" link, search results that point at Admin
 * rows, and More › Admin all use this one constant. Points straight at Admin ›
 * Help; `/on-call/logistics` remains a bookmark redirect to the same place.
 */
export const ON_CALL_ADMIN_ROWS_HREF = "/admin/help";

/**
 * Handover "Share to another app" (mock-up v10). Off until the owner decides:
 * the handover's recorded rule is that it leaves the phone only by Copy or
 * Print, and sharing sends bed, legal status and plan to any app on the phone.
 */
export const ON_CALL_HANDOVER_SHARE_ENABLED = false;

/**
 * The two plain legal statuses ("Voluntary", "Not under the Act") offered above
 * the forms register in the handover's Legal sheet. Off until their wording has
 * clinical sign-off; the sheet still takes any status typed as written.
 */
export const ON_CALL_HANDOVER_LEGAL_STATUSES_ENABLED = false;
