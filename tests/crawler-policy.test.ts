import { expect, it } from "vitest";

import robots from "../src/app/robots";
import { PRIVATE_APP_ROBOTS_METADATA, PUBLIC_APP_ROBOTS_METADATA } from "../src/lib/crawler-policy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("allows indexing on public app routes while robots.txt stays crawlable", () => {
  const result = robots();
  expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
  // The public-only sitemap is advertised only from a trusted canonical origin
  // (NEXT_PUBLIC_SITE_URL or RAILWAY_PUBLIC_DOMAIN); without one the line is
  // omitted rather than fabricated from an arbitrary or attacker-controlled host.
  const sitemap = result.sitemap;
  if (typeof sitemap === "string") {
    expect(sitemap).toMatch(/^https?:\/\/[^/]+\/sitemap\.xml$/);
  }
  expect(PUBLIC_APP_ROBOTS_METADATA).toMatchObject({
    index: true,
    follow: true,
  });
  const rootLayout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
  expect(rootLayout).toContain("PUBLIC_APP_ROBOTS_METADATA");
  expect(rootLayout).not.toContain("PRIVATE_APP_ROBOTS_METADATA");
});

it("keeps mockups on the private noindex robots object", () => {
  expect(PRIVATE_APP_ROBOTS_METADATA).toMatchObject({
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      nosnippet: true,
    },
  });
  const mockupsLayout = readFileSync(join(process.cwd(), "src/app/mockups/layout.tsx"), "utf8");
  expect(mockupsLayout).toContain("PRIVATE_APP_ROBOTS_METADATA");
});

it("keeps offline.html noindexed independently of app metadata", () => {
  const offlineHtml = readFileSync(join(process.cwd(), "public/offline.html"), "utf8");
  expect(offlineHtml).toMatch(/name=["']robots["'][^>]*content=["']noindex/i);
});

it("re-reads NEXT_PUBLIC_SITE_URL per call instead of freezing it at module load", () => {
  // Undeclared Docker build ARGs never reach `npm run build` on Railway, so the
  // canonical origin can be empty at build time even when the running
  // container's env has it set. A module-level constant computed once at
  // import time would freeze that empty value for the process lifetime;
  // `buildPrivateAppRobotsTxt()`/`robots()` must instead read `process.env`
  // fresh on every call so a runtime-supplied value still takes effect.
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalRailwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    expect(robots().sitemap).toBeUndefined();

    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    expect(robots().sitemap).toBe("https://example.com/sitemap.xml");
  } finally {
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    if (originalRailwayDomain === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
    else process.env.RAILWAY_PUBLIC_DOMAIN = originalRailwayDomain;
  }
});

it("keeps personal work areas out of search results (audit F-30)", () => {
  for (const area of ["roster", "my-day", "admin", "on-call", "cme", "teaching", "open-shifts"]) {
    const layout = readFileSync(join(process.cwd(), `src/app/(search-app)/${area}/layout.tsx`), "utf8");
    expect(layout, area).toMatch(/robots:\s*PRIVATE_APP_ROBOTS_METADATA/);
  }
});
