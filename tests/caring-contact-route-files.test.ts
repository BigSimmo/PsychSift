import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const routeFiles = [
  "src/app/mockups/caring-contacts/page.tsx",
  "src/app/mockups/caring-contacts/patients/page.tsx",
  "src/app/mockups/caring-contacts/patients/[patientId]/page.tsx",
  "src/app/mockups/caring-contacts/plans/new/page.tsx",
  "src/app/mockups/caring-contacts/plans/[planId]/page.tsx",
  "src/app/mockups/caring-contacts/schedule/page.tsx",
  "src/app/mockups/caring-contacts/contacts/[contactId]/page.tsx",
  "src/app/mockups/caring-contacts/templates/page.tsx",
  "src/app/mockups/caring-contacts/templates/[pathwayId]/page.tsx",
  "src/app/mockups/caring-contacts/team/page.tsx",
  "src/app/mockups/caring-contacts/guidance/page.tsx",
  "src/app/mockups/caring-contacts/reports/page.tsx",
  "src/app/mockups/caring-contacts/system-states/page.tsx",
] as const;

const MOCKUP_ROOTS = ["src/app/mockups/caring-contacts", "src/components/caring-contacts/mockups"] as const;

/** Every `.ts`/`.tsx` file under the given repo-relative roots, keyed by repo-relative path. */
function collectSources(roots: readonly string[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const root of roots) {
    const absoluteRoot = resolve(process.cwd(), root);
    for (const entry of readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
      const absolute = resolve(entry.parentPath, entry.name);
      sources.set(relative(process.cwd(), absolute).split(sep).join("/"), readFileSync(absolute, "utf8"));
    }
  }
  return sources;
}

describe("Caring Contact mockup route registration", () => {
  it("registers every approved page inside the synthetic mockup namespace", () => {
    for (const file of routeFiles) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} is missing`).toBe(true);
    }
    expect(existsSync(resolve(process.cwd(), "src/app/mockups/caring-contacts/layout.tsx"))).toBe(true);
  });

  it("keeps the Caring Contact shell independent from shared mockup search chrome", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/mockups/mockups-layout-client.tsx"), "utf8");
    expect(source).toContain('pathname.startsWith("/mockups/caring-contacts/")');
    expect(source).toContain("!isCaringContactMockup");
  });

  it("keeps the prototype memory-only and provider-free inside its mockup namespace", () => {
    const source = [...collectSources(MOCKUP_ROOTS).values()].join("\n");

    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:openai|supabase|twilio|analytics)[^"']*["']/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(existsSync(resolve(process.cwd(), "src/app/plans"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/app/contacts"))).toBe(false);
  });

  // Replaces the former `src/app/caring-contacts` non-existence assertion. That
  // assertion was reserving the production namespace *for* production, and
  // production has now arrived (Task 15). The separation it protected is kept,
  // and strengthened: it is now enforced in both directions instead of by the
  // absence of one side. The prototype's storage and `fetch(` bans above stay
  // scoped to the mockup roots they were written for — the production tree
  // legitimately fetches, the prototype still may not.
  it("keeps the prototype and the production workspace from reaching into each other", () => {
    const mockupSources = collectSources(MOCKUP_ROOTS);
    expect(mockupSources.size).toBeGreaterThan(0);
    for (const [file, source] of mockupSources) {
      expect(source, `${file} imports production workspace code`).not.toMatch(
        /from\s+["']@\/components\/caring-contacts\/workspace/,
      );
      expect(source, `${file} imports a production caring-contacts route`).not.toMatch(
        /from\s+["']@\/lib\/caring-contacts-server/,
      );
    }

    const productionSources = collectSources(["src/app/caring-contacts", "src/components/caring-contacts/workspace"]);
    expect(productionSources.size).toBeGreaterThan(0);
    for (const [file, source] of productionSources) {
      expect(source, `${file} imports mockup code`).not.toMatch(/caring-contacts\/mockups/);
    }
  });
});
