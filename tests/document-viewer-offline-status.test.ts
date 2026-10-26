import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewer = readFileSync(new URL("../src/components/DocumentViewer.tsx", import.meta.url), "utf8");

describe("document viewer offline badge", () => {
  it("announces connection loss through a persistent polite status region", () => {
    expect(viewer).toMatch(
      /<span role="status" aria-live="polite"[^>]*>\s*\{!isOnline \? "Offline" : null\}\s*<\/span>/,
    );
  });
});
