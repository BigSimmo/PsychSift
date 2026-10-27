import { describe, expect, it } from "vitest";

import { isInAppBrowser } from "@/lib/in-app-browser";

const safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const chromeIos =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const iosWebView =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const facebook = `${iosWebView} [FBAN/FBIOS;FBAV/480.0.0.0]`;
const instagramAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0";
const androidChrome =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("in-app browser detection", () => {
  it("treats ordinary browsers as installable", () => {
    expect(isInAppBrowser(safari)).toBe(false);
    expect(isInAppBrowser(chromeIos)).toBe(false);
    expect(isInAppBrowser(androidChrome)).toBe(false);
  });

  it("recognises app browsers by token and bare iOS web views", () => {
    expect(isInAppBrowser(facebook)).toBe(true);
    expect(isInAppBrowser(instagramAndroid)).toBe(true);
    expect(isInAppBrowser(iosWebView)).toBe(true);
  });

  it("treats an iPadOS web view with a macOS user agent as an app browser", () => {
    const ipadDesktopView = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    const ipadSafari = `${ipadDesktopView} Version/18.0 Safari/605.1.15`;
    expect(isInAppBrowser(ipadDesktopView)).toBe(false);
    expect(isInAppBrowser(ipadDesktopView, { ipadOs: true })).toBe(true);
    expect(isInAppBrowser(ipadSafari, { ipadOs: true })).toBe(false);
  });
});
