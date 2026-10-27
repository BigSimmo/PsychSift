/**
 * True inside another app's built-in browser (Facebook, Instagram, LinkedIn, Gmail,
 * Outlook and the like), where a site cannot be installed to the Home Screen. Install
 * prompts are pointless there and only cover the page.
 *
 * Two signals: the app's own user-agent token, and, on iPhone and iPad, a browser
 * view without Safari's "Safari/" token, which is how a WebKit view embedded in an
 * app identifies itself. Chrome, Firefox and Edge on iOS keep the Safari token.
 * iPadOS can report a macOS user agent, so callers pass `ipadOs` from the
 * MacIntel-with-touch check when the user agent alone cannot say.
 */
const IN_APP_TOKENS =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|Line\/|MicroMessenger|Snapchat|Twitter|TikTok|musical_ly|BytedanceWebview|Pinterest|GSA\/|Outlook-iOS|Teams\//i;

export function isInAppBrowser(userAgent: string, { ipadOs = false }: { ipadOs?: boolean } = {}): boolean {
  if (IN_APP_TOKENS.test(userAgent)) return true;
  const ios = ipadOs || /iPhone|iPad|iPod/.test(userAgent);
  return ios && !/Safari\//.test(userAgent);
}
