// tests/route-redirects.test.ts
//
// `/login`, `/signin`, `/settings` and `/about` returned 404 (2026-09-17 audit, finding L3).
// Each of them already HAS a home in the app -- the account wall on Favourites, the settings
// dialog, the privacy page -- so they are redirects rather than new pages: a real route would be
// a second surface to keep in step with the first, plus an orphan-route entry for a page that
// only forwards.
//
// Pinned here because a redirect is exactly the kind of configuration that is deleted in a
// refactor without anyone noticing, and the symptom is a 404 nobody reports.
import { describe, expect, it } from "vitest";

import loadNextConfig from "../next.config";

type Redirect = { source: string; destination: string; permanent: boolean };

async function redirects(): Promise<Redirect[]> {
  const config = await loadNextConfig();
  expect(typeof config.redirects).toBe("function");
  return (await config.redirects!()) as Redirect[];
}

describe("routes people type that would otherwise 404", () => {
  it.each([
    ["/login", "/favourites"],
    ["/signin", "/favourites"],
    ["/sign-in", "/favourites"],
    ["/settings", "/?settings=open"],
    ["/about", "/privacy"],
  ])("sends %s to %s", async (source, destination) => {
    const found = (await redirects()).find((entry) => entry.source === source);
    expect(found, `no redirect configured for ${source}`).toBeDefined();
    expect(found!.destination).toBe(destination);
  });

  it("marks them permanent, because each destination is where the feature lives", async () => {
    for (const entry of await redirects()) expect(entry.permanent).toBe(true);
  });

  it("points every destination at something that exists", async () => {
    // The failure this catches is a redirect to a second 404, which is worse than the first one:
    // it looks handled. Checked against the route tree rather than a hand-kept list.
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const entry of await redirects()) {
      // A catch-all (`/x/:path*`) forwards to whatever lives under `/x`, so its base page has to exist.
      const path = entry.destination.split("?")[0]!.replace(/\/:[^/]+\*$/, "");
      const segment = path === "/" ? "" : path.replace(/^\//, "");
      const candidates = segment
        ? [
            `src/app/${segment}/page.tsx`,
            `src/app/(search-app)/${segment}/page.tsx`,
            `src/app/(admin)/${segment}/page.tsx`,
          ]
        : ["src/app/(search-app)/page.tsx"];
      expect(
        candidates.some((candidate) => existsSync(resolve(process.cwd(), candidate))),
        `${entry.source} -> ${entry.destination}, but no page exists at any of ${candidates.join(", ")}`,
      ).toBe(true);
    }
  });
});
