import { afterEach, beforeEach } from "vitest";

/**
 * Mounts the top bar's round left slot (`#universal-header-leading`) for DOM
 * tests. Back on records and inner pages is drawn there (header standard,
 * 13 Oct 2026), so a page rendered without the shared header needs the slot to
 * show its Back at all.
 */
export function withTopBarLeadingSlot(): void {
  beforeEach(() => {
    if (document.getElementById("universal-header-leading")) return;
    const slot = document.createElement("div");
    slot.id = "universal-header-leading";
    document.body.append(slot);
  });
  afterEach(() => {
    document.getElementById("universal-header-leading")?.remove();
  });
}
