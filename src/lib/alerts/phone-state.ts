/**
 * What "Phone alerts" on the Alerts page says about THIS device. Pure, so the
 * order of the checks is pinned by tests: an iPhone that is not on the Home
 * Screen is told how to fix that before anything else, because Apple refuses
 * every other step until it is; a blocked permission comes next, because only
 * the phone's own Settings can undo it.
 */
export type PhoneAlertState =
  /** Still asking the server and the browser. */
  | "checking"
  /** The server has no push keys, so no device can get phone alerts yet. */
  | "unconfigured"
  /** This browser has no notifications or service worker at all. */
  | "unsupported"
  /** iPhone or iPad, opened in Safari rather than from the Home Screen icon. */
  | "needs-home-screen"
  /** The reader, or someone, tapped Don't Allow; only the phone's Settings can undo it. */
  | "blocked"
  /** A shared computer: phone alerts are kept off on it by the reader's choice. */
  | "shared"
  | "off"
  | "on"
  /** The check itself failed (offline, server error). Never shown as "off". */
  | "error";

export type PhoneAlertInputs = {
  /** Null while the server has not answered. */
  readonly configured: boolean | null;
  readonly supported: boolean;
  readonly iosNotInstalled: boolean;
  readonly permission: "default" | "granted" | "denied" | "unsupported";
  /** Null while the subscription check has not finished. */
  readonly subscribed: boolean | null;
  readonly failed: boolean;
  readonly sharedDevice: boolean;
};

export function derivePhoneAlertState(input: PhoneAlertInputs): PhoneAlertState {
  if (input.failed) return "error";
  if (input.configured === null) return "checking";
  if (!input.configured) return "unconfigured";
  if (input.sharedDevice) return "shared";
  if (input.iosNotInstalled) return "needs-home-screen";
  if (!input.supported || input.permission === "unsupported") return "unsupported";
  if (input.permission === "denied") return "blocked";
  if (input.subscribed === null) return "checking";
  return input.subscribed ? "on" : "off";
}

export type DeviceKind = "iphone" | "phone" | "computer";

/** "iPhone", "phone" or "computer", from the browser's own description of itself. */
export function deviceKindOf(userAgent: string): DeviceKind {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iphone";
  if (/Android|Mobile/i.test(userAgent)) return "phone";
  return "computer";
}

export const DEVICE_NAMES: Readonly<Record<DeviceKind, string>> = {
  iphone: "iPhone",
  phone: "phone",
  computer: "computer",
};
