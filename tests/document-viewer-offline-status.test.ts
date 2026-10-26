import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewer = readFileSync(new URL("../src/components/DocumentViewer.tsx", import.meta.url), "utf8");

describe("document viewer offline badge", () => {
  it("announces connection loss through a persistent polite status region", () => {
    expect(viewer).toMatch(/<span role="status" className="sr-only">\s*\{!isOnline \? "Offline" : null\}\s*<\/span>/);
    // SPEC 9.2: visible nodes must not carry aria-live; the visible badge stays decorative.
    expect(viewer).toMatch(
      /<span aria-hidden="true" className=\{cn\("text-xs font-semibold", textMuted\)\}>\s*Offline\s*<\/span>/,
    );
  });
});
