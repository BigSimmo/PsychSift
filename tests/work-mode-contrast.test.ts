import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// work-mode redesign, owner request 6 Oct 2026: white hero text and the kit's
// muted text keep WCAG AA (4.5:1) in every work area's light palette.
const root = process.cwd();
const globals = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const work = readFileSync(path.join(root, "src/app/work-mode.css"), "utf8");
const v2 = readFileSync(path.join(root, "src/app/ckb-v2-tokens.css"), "utf8");

type Rgb = readonly [number, number, number];
const hex = (value: string): Rgb => {
  const h = value.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
};
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: Rgb, b: Rgb, p: number): Rgb => a.map((v, i) => Math.round(v * p + b[i] * (1 - p))) as unknown as Rgb;

function identityToken(mode: string, token: string): Rgb {
  const block = globals.match(new RegExp(`\\n\\[data-mode-identity="${mode}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  const value = block.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6});`))?.[1];
  if (!value) throw new Error(`${mode} --${token} not found`);
  return hex(value);
}

const WHITE: Rgb = [255, 255, 255];
const AREAS = ["my-day", "roster", "teaching", "cme", "my-work", "on-call"];

describe("work-mode text contrast", () => {
  it("keeps white hero text at 4.5:1 or better at the gradient's palest stop", () => {
    const share = Number(work.match(/--work-hero-from: color-mix\(in srgb, var\(--mode-identity-2\) (\d+)%/)?.[1]);
    expect(share).toBeGreaterThan(0);
    for (const mode of AREAS) {
      const from = mix(identityToken(mode, "mode-identity-2"), identityToken(mode, "mode-identity"), share / 100);
      expect(ratio(WHITE, from), mode).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("draws hero, ring and chip-count text at full strength, never faded by opacity", () => {
    for (const selector of [".work-hero__eyebrow", ".work-hero__sub", ".work-ring__label", ".work-chip__count"]) {
      const body = work.match(new RegExp(`\\n${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`))?.[1];
      expect(body, selector).toBeDefined();
      expect(body, selector).not.toMatch(/opacity/);
    }
  });

  it("keeps muted text at 4.5:1 on every area's band and tint", () => {
    const muted = hex(v2.match(/\n {2}--text-muted: (#[0-9a-f]{6});/)?.[1] ?? "");
    for (const mode of AREAS) {
      for (const token of ["mode-identity-band", "mode-identity-soft"]) {
        expect(ratio(muted, identityToken(mode, token)), `${mode} ${token}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        ratio(identityToken(mode, "mode-identity"), identityToken(mode, "mode-identity-soft")),
        mode,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
