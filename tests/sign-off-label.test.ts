import { describe, expect, it } from "vitest";

import { NOT_SIGNED_OFF_LABEL, signOffDisplay } from "@/lib/sign-off-label";

describe("signOffDisplay", () => {
  it("names a real person and the Perth sign-off day", () => {
    expect(signOffDisplay(" Dr Alex  Example ", "2026-10-05T18:30:00.000Z")).toEqual({
      signedOff: true,
      text: "Signed off by Dr Alex Example, 6 Oct 2026",
    });
  });

  it("never treats a product or system attribution as a sign-off", () => {
    for (const reviewer of ["PsychSift", "System", "Codex", "the owner", "Dr Smith"]) {
      expect(signOffDisplay(reviewer, "2026-10-06T09:19:28.139Z")).toEqual({
        signedOff: false,
        text: NOT_SIGNED_OFF_LABEL,
      });
    }
  });

  it("fails closed without a real UTC sign-off time", () => {
    for (const reviewedAt of [null, undefined, "", "2026-10-06", "2026-10-06T09:19:28+08:00", "not a date"]) {
      expect(signOffDisplay("Dr Alex Example", reviewedAt).signedOff).toBe(false);
    }
    expect(signOffDisplay(null, "2026-10-06T09:19:28.139Z").text).toBe("Not signed off yet");
  });
});
