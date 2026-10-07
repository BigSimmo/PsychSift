import { describe, expect, it } from "vitest";

import { appModeIds } from "@/lib/app-modes";
import { modePickerHint, modePickerHintMaxLength, modePickerHints } from "@/lib/mode-picker-hints";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { modePickerRowClass } from "@/components/mode-picker/mode-picker-row";

describe("mode picker hints", () => {
  it("gives every mode a hint, and nothing else", () => {
    expect(Object.keys(modePickerHints).sort()).toEqual([...appModeIds].sort());
  });

  it("keeps every hint to one short line in sentence case, with no copy-rule characters", () => {
    for (const id of appModeIds) {
      const hint = modePickerHint(id);
      expect(hint.length, id).toBeGreaterThan(0);
      expect(hint.length, id).toBeLessThanOrEqual(modePickerHintMaxLength);
      expect(hint[0], id).toBe(hint[0]?.toUpperCase());
      expect(hint, id).not.toMatch(/[;→←↑↓·…]|\.$/);
    }
  });

  it("never repeats a group's own hint on the row beneath it", () => {
    for (const group of phoneModeGroups) {
      for (const id of group.modeIds) expect(modePickerHint(id), id).not.toBe(group.hint);
    }
  });
});

describe("mode picker row", () => {
  it("keeps the pinned sizes and stays flat", () => {
    expect(modePickerRowClass(false, true)).toMatch(/\bmin-h-14\b/);
    expect(modePickerRowClass(false, false)).toMatch(/\bmin-h-12\b/);
    for (const recipe of [modePickerRowClass(true, true), modePickerRowClass(true, false)]) {
      expect(recipe).not.toMatch(/shadow-/);
    }
  });

  it("restates the product accent so a clinical row never inherits a work area's colour", () => {
    expect(modePickerRowClass(false, true)).toContain("[--clinical-accent:var(--primary-500)]");
  });
});
