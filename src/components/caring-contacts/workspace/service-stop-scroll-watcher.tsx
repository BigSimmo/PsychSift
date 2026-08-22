"use client";

import { useEffect } from "react";

import {
  CONDENSED_SERVICE_STOP_BAR_ID,
  FULL_BANNER_OUT_OF_VIEW_ATTRIBUTE,
  SERVICE_STOP_BANNER_ID,
  WORKSPACE_HEADER_ID,
} from "./service-stop-bar-anchors";

/**
 * The workspace's one scroll-aware Client Component: it decides WHEN the condensed stop bar
 * is shown, and never what it says.
 *
 * It takes no props and renders nothing. That is the whole design, and it is the same
 * technique `workspace-overlays.tsx` uses: a client boundary serialises its props into the
 * payload the browser can read, so the only way to be certain a responder's free-text
 * incident note can never arrive here is for nothing to arrive here at all. The bar's
 * wording is rendered on the server from a type that omits the note by construction; this
 * module only toggles one attribute on the already-rendered element.
 *
 * Why measure rather than use a fixed offset: the bar hangs off the header's bottom edge,
 * and the header is NOT the height of the `--header-h` token. Measured on this route before
 * this was written -- 87.5px at 320 and 390 (the header's contents wrap there), 65px at 430
 * and above, against a 64px token. Every one of those would have left the bar sitting partly
 * behind the header. So the predicate is read off the two live rectangles: the full banner
 * has gone exactly when its bottom edge has passed the header's bottom edge, which is where
 * the bar begins. The two can therefore never both be on screen.
 *
 * Reads only; the layout stays where CSS put it. The bar is absolutely positioned inside the
 * header, so showing it moves no content and changes no scroll position -- which is what
 * keeps this from oscillating at the threshold it is measuring.
 */
export function ServiceStopScrollWatcher() {
  useEffect(() => {
    let frame = 0;

    /**
     * The three nodes are looked up on EVERY read, not captured once when the effect ran.
     *
     * Fix round 1, finding 4. Resolving them once at mount is the obvious spelling and it
     * holds a reference to nodes React may replace: a client-side navigation back into this
     * route re-renders the server tree, and the banner the watcher was measuring is then a
     * detached node whose rectangle is all zeros -- which reads as "the banner has gone" and
     * would pin the bar permanently. No route navigates into this page softly today, so
     * nothing could observe it; that made it a latent trap rather than a bug, and re-reading
     * three ids per frame costs nothing measurable next to the two `getBoundingClientRect`
     * calls beside them. A missing node is simply a frame with nothing to decide.
     */
    const update = () => {
      frame = 0;
      const bar = document.getElementById(CONDENSED_SERVICE_STOP_BAR_ID);
      const banner = document.getElementById(SERVICE_STOP_BANNER_ID);
      const header = document.getElementById(WORKSPACE_HEADER_ID);
      // Nothing to decide, and nothing to guess at: leave the server's `"false"` in place.
      if (!bar || !banner || !header) return;

      const outOfView = banner.getBoundingClientRect().bottom <= header.getBoundingClientRect().bottom;
      bar.setAttribute(FULL_BANNER_OUT_OF_VIEW_ATTRIBUTE, outOfView ? "true" : "false");
    };

    // One read per frame at most. A scroll handler that measures on every event samples the
    // same two rectangles many times per frame and can only ever reach the same answer.
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    // The header wraps to a second row below 430px, so its bottom edge -- the whole
    // measurement -- moves when the viewport does.
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
