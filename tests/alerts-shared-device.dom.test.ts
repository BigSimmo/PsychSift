// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { REMIND_ME_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { isSharedDevice, setSharedDevice } from "@/lib/alerts/shared-device";

describe("marking a device as shared", () => {
  afterEach(() => window.localStorage.clear());

  it("removes Remind me notes saved before the switch", () => {
    window.localStorage.setItem(REMIND_ME_STORAGE_KEY, JSON.stringify([{ id: "a", text: "Chase the ECG report" }]));
    setSharedDevice(true);
    expect(isSharedDevice()).toBe(true);
    expect(window.localStorage.getItem(REMIND_ME_STORAGE_KEY)).toBeNull();
  });

  it("keeps notes when the switch is turned off", () => {
    setSharedDevice(true);
    window.localStorage.setItem(REMIND_ME_STORAGE_KEY, "[]");
    setSharedDevice(false);
    expect(isSharedDevice()).toBe(false);
    expect(window.localStorage.getItem(REMIND_ME_STORAGE_KEY)).toBe("[]");
  });
});
