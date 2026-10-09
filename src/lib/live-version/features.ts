/**
 * Work that is live on the site for testers only (see `live-version.ts`).
 *
 * To land new work behind the switch: add an entry here, then gate it with
 * `useLivePreview(id)` or `<LivePreview feature={id}>` in a component, or
 * `isLivePreviewOn(id)` / `requireLivePreview(id)` on the server. The id type comes
 * from this list, so a gate cannot name a feature that is not registered.
 *
 * To launch it to everyone: delete the gate and the entry in the same change.
 * Settings lists these entries under the switch, so the tester can see what
 * "Newest" adds.
 */

export type LivePreviewFeature = {
  readonly id: string;
  /** Short name shown in Settings under the switch. */
  readonly label: string;
  /** Who owns it, for the next person reading the list. */
  readonly owner: string;
  /** When it went behind the switch (YYYY-MM-DD), so stale entries are easy to spot. */
  readonly since: string;
};

export const LIVE_PREVIEW_FEATURES = [
  {
    id: "work-mode-new-screens",
    label: "New work screens",
    owner: "work-mode-launch",
    since: "2026-10-07",
  },
  {
    id: "course-bookings",
    label: "Course bookings in Admin",
    owner: "course-bookings",
    since: "2026-10-09",
  },
  {
    id: "two-pane-side-menu",
    label: "New side menu",
    owner: "mode-picker",
    since: "2026-10-08",
  },
] as const satisfies readonly LivePreviewFeature[];

export type LivePreviewFeatureId = (typeof LIVE_PREVIEW_FEATURES)[number]["id"];
