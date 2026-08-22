// src/components/caring-contacts/workspace/service-stop-bar-anchors.ts
//
// The three DOM handles the condensed stop bar needs, in one place.
//
// They live in a module of their own, holding nothing but strings, for a reason that is
// structural rather than tidy: the watcher that reads them is the workspace's only
// scroll-aware Client Component, and the standing condition on this tree is that no client
// module may name the service-wide stop record or its type. A shared constants module lets
// the watcher and the server-rendered bar agree on the same three handles without the
// watcher importing anything that could carry the responder's incident note into the client
// module graph -- and without two copies of a magic string drifting apart.

/** The full banner. The watcher asks where its bottom edge is, and nothing else about it. */
export const SERVICE_STOP_BANNER_ID = "caring-contacts-service-stop-banner";

/** The workspace header. The bar hangs off its bottom edge; the watcher measures that edge. */
export const WORKSPACE_HEADER_ID = "caring-contacts-workspace-header";

/** The condensed bar itself. */
export const CONDENSED_SERVICE_STOP_BAR_ID = "caring-contacts-condensed-service-stop";

/**
 * The one thing the watcher writes: `"true"` once the full banner has left the region below
 * the header, `"false"` while any of it is still on screen.
 *
 * It is an attribute rather than React state because the bar is server-rendered, and keeping
 * it that way is what stops the stop's wording from ever crossing a client boundary. The
 * server renders `"false"`, so a browser that never runs the script shows no bar at all --
 * the conservative direction: the workspace degrades to the behaviour it had before this bar
 * existed, and can never show two statements of the same stop at once.
 */
export const FULL_BANNER_OUT_OF_VIEW_ATTRIBUTE = "data-full-banner-out-of-view";
