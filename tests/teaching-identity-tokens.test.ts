import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";

/*
 * Teaching's plum, pinned as `tests/design-token-contract.test.ts` pins On
 * Call's teal: as a fill under its partner (the pill's disc) and as text on
 * the surfaces the pill sits on, in both themes, and flattened under forced
 * colours. The hero's colours are the kit's `--surface-summary*`, not Teaching's.
 */
const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function declarations(block: string) {
  const map = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/^ {2,4}(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) map.set(name, value.trim());
  return map;
}

function luminance(hex: string) {
  const value = hex.trim().toLowerCase();
  expect(value, `${hex} is not a 6-digit hex colour`).toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [darker, lighter] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (lighter + 0.05) / (darker + 0.05);
}

const light = declarations(sourceSegment(globals, '\n[data-mode-identity="teaching"] {', "\n}"));
const dark = declarations(sourceSegment(globals, '\n.dark [data-mode-identity="teaching"] {', "\n}"));

describe("Teaching identity tokens", () => {
  it("uses the work-mode green in light and a calmer green in dark", () => {
    // Work-mode redesign, owner request 6 Oct 2026: Teaching moved from plum to green.
    expect(light.get("--mode-identity")).toBe("#2f6e4a");
    expect(light.get("--mode-identity-soft")).toBe("#ebf4ee");
    expect(light.get("--mode-identity-border")).toBe("#c5dfcf");
    expect(light.get("--mode-identity-contrast")).toBe("#ffffff");
    expect(dark.get("--mode-identity")).toBe("#93cba8");
    expect(dark.get("--mode-identity-soft")).toBe("#142a1d");
    expect(dark.get("--mode-identity-border")).toBe("#24412f");
    expect(dark.get("--mode-identity-contrast")).toBe("#0d2a19");
  });

  it("clears 4.5:1 as a fill and as text in both themes, and 7:1 for heading ink on the dark tint", () => {
    expect(contrast(light.get("--mode-identity")!, light.get("--mode-identity-contrast")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.get("--mode-identity")!, dark.get("--mode-identity-contrast")!)).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["#fcfdfe", "#ffffff"]) {
      expect(contrast(light.get("--mode-identity")!, surface), `light on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of ["#0b0e11", "#1c2126", "#262c32"]) {
      expect(contrast(dark.get("--mode-identity")!, surface), `dark on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("#fbfcfd", dark.get("--mode-identity-soft")!)).toBeGreaterThanOrEqual(7);
    expect(contrast(dark.get("--mode-identity")!, dark.get("--mode-identity-soft")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the selected segment neutral and the QR dark on light in every theme", () => {
    expect(light.get("--teaching-segment-on")).toBe("var(--surface-lux)");
    expect(light.get("--teaching-segment-line")).toBe("var(--border)");
    expect(dark.get("--teaching-segment-line")).toBe("#3a434c");
    expect(light.get("--teaching-qr-light")).toBe("#ffffff");
    expect(light.get("--teaching-qr-dark")).toBe("#000000");
    expect(dark.has("--teaching-qr-light")).toBe(false);
  });

  it("remaps the accent locally, leaves the hero to the kit, and pulses the live dot in --success only", () => {
    expect(light.get("--clinical-accent")).toBe("var(--mode-identity)");
    expect(light.get("--clinical-accent-contrast")).toBe("var(--mode-identity-contrast)");
    expect([...light.keys(), ...dark.keys()].some((name) => name.startsWith("--teaching-hero"))).toBe(false);
    const pulse = sourceSegment(globals, "@keyframes teaching-live-pulse {", "\n}");
    expect(pulse).toContain("var(--success)");
    expect(pulse).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("flattens to system colours under forced colours", () => {
    const forced = sourceSegment(globals, '  [data-mode-identity="teaching"] {', "\n  }");
    for (const line of [
      "--mode-identity: LinkText;",
      "--mode-identity-soft: Canvas;",
      "--mode-identity-border: ButtonBorder;",
      "--mode-identity-contrast: ButtonText;",
      "--teaching-segment-on: Canvas;",
      "--teaching-segment-line: CanvasText;",
    ]) {
      expect(forced).toContain(line);
    }
  });
});
