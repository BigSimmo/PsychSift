import { describe, expect, it } from "vitest";

import { actorId } from "@/lib/caring-contacts/ids";
import {
  ALERT_CLASSES,
  alertBodyFor,
  defaultNotificationPreferences,
  setAlertOptIn,
  type AlertClass,
} from "@/lib/caring-contacts/notification-preferences";

describe("notification preferences", () => {
  it("opts a new user in to nothing", () => {
    expect(defaultNotificationPreferences(actorId("A")).optedIn).toEqual([]);
  });

  it("adds and removes a single alert class without touching the others", () => {
    let preferences = defaultNotificationPreferences(actorId("A"));
    preferences = setAlertOptIn(preferences, "serviceSafetyStop", true);
    preferences = setAlertOptIn(preferences, "exceptionBacklog", true);
    preferences = setAlertOptIn(preferences, "serviceSafetyStop", false);
    expect(preferences.optedIn).toEqual(["exceptionBacklog"]);
  });

  it("writes an alert body carrying no identifier of any kind", () => {
    for (const alertClass of ALERT_CLASSES) {
      const body = alertBodyFor(alertClass, 3);
      expect(body).toContain("3");
      expect(body).not.toMatch(/SYN-|\+61|Rowan|Mira/);
    }
  });

  // Ruling 61, applied to this lookup. ALERT_CLASS_LABELS is a frozen object literal keyed by a
  // closed union, so `ALERT_CLASS_LABELS["constructor"]` is a FUNCTION and the preview body would
  // have read "… affected by function Object() { [native code] }". An unwritten class is a
  // programming error, not a runtime condition -- so it throws, naming the key, rather than
  // producing a plausible sentence for a value nobody defined.
  it.each(["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty", "notAnAlertClass"])(
    "throws rather than labelling the unknown alert class %s from an inherited property",
    (alertClass) => {
      expect(() => alertBodyFor(alertClass as AlertClass, 3)).toThrow(alertClass);
    },
  );
});
