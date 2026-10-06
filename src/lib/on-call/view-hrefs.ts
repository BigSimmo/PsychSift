import type { OnCallSection } from "@/lib/on-call/entry-model";
import type { OnCallPageView } from "@/lib/on-call/view";

/* Icon-free: a reader that only needs a link does not load the section glyphs. */

/**
 * The routes this mode's pages live at, as literal strings.
 *
 * `modeSecondaryNavigationRegistry` is the canonical destination list and the
 * reachability guard reads it directly, so these are not a second source of
 * truth for navigation — they exist so the home's tile grid and the section
 * pages can name a route without interpolating one.
 */
export const ON_CALL_SECTION_HREFS: Record<OnCallSection, string> = {
  contacts: "/on-call/contacts",
  playbook: "/on-call/playbook",
  referrals: "/on-call/referrals",
  orientation: "/on-call/orientation",
  // The section id stays `education`, but its page now lives in Teaching Week;
  // `/on-call/education` redirects there. Teaching owns the programme; On Call
  // never auto-creates CPD from attendance.
  education: "/teaching/week",
  // The section id stays `logistics`, but its page now lives in Admin: On Call's
  // admin rows moved to Admin > Help on 2026-09-26 (Admin update 1), and
  // `/on-call/logistics` redirects there. Every On Call link to those rows reads
  // this entry, so they all land on Help (spec review 19).
  logistics: "/admin/help",
};

/**
 * The route each VIEW lives at — `ON_CALL_SECTION_HREFS` widened by the two
 * pages that are views rather than stored sections.
 *
 * A separate table rather than pouring the two view routes into
 * `ON_CALL_SECTION_HREFS`, for the same reason the titles and icons above come
 * in pairs: that map is keyed by `OnCallSection` and is read all over the mode
 * with a section in hand, and a map whose name says "section" must not answer
 * to `compliance`. Keeping the pair means the section-keyed map stays honest
 * and this one is exhaustive over the views — a new view with no route is a
 * compile error here rather than a tile that has to hardcode its own string.
 *
 * That hardcoding is what this replaces. The home's tile grid carried
 * `/on-call/compliance` and `/on-call/who-is-who` as literals while the search
 * box and the Recent list interpolated neither, so the same route was written
 * in three places and only one of them could be wrong at a time.
 */
export const ON_CALL_VIEW_HREFS: Record<OnCallPageView, string> = {
  ...ON_CALL_SECTION_HREFS,
  "who-is-who": "/on-call/who-is-who",
  // The view id stays `compliance`, but its page now lives in Admin > Renewals
  // (Admin update 1, 2026-09-26); `/on-call/compliance` redirects there.
  compliance: "/admin/renewals",
};
