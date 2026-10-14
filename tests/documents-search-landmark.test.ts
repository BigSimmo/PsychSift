import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../src/app/(search-app)/documents/search/page.tsx", import.meta.url), "utf8");
const dsmLayout = readFileSync(new URL("../src/app/(search-app)/dsm/layout.tsx", import.meta.url), "utf8");
const firstNationsLayout = readFileSync(
  new URL("../src/app/(search-app)/first-nations/layout.tsx", import.meta.url),
  "utf8",
);

describe("Documents and search app landing semantics", () => {
  it("owns one main landmark inside the shared shell container", () => {
    expect(route.match(/<main\b/g)).toHaveLength(1);
    expect(route.match(/<\/main>/g)).toHaveLength(1);
    expect(route).not.toMatch(/<section\b/);
  });

  it("owns main landmark in dsm layout (#568M42)", () => {
    // The shell already owns #main-content; the landmark must not duplicate that id.
    expect(dsmLayout.match(/<main[\s>]/g)).toHaveLength(1);
    expect(dsmLayout).not.toContain('id="main-content"');
    expect(dsmLayout.match(/<\/main>/g)).toHaveLength(1);
  });

  it("owns main landmark in first-nations layout (#568M42)", () => {
    // The shell already owns #main-content; the landmark must not duplicate that id.
    expect(firstNationsLayout.match(/<main[\s>]/g)).toHaveLength(1);
    expect(firstNationsLayout).not.toContain('id="main-content"');
    expect(firstNationsLayout.match(/<\/main>/g)).toHaveLength(1);
  });
});
