/**
 * The "back to My Day" marker. Links that leave My Day carry `?from=my-day`,
 * and the shared search-app shell shows a small "‹ My Day" link at the top of
 * the page they open (`src/components/my-day/my-day-return-link.tsx`).
 *
 * The marker is a fixed word: it never carries an item title, an id of the
 * reader's own or any patient detail.
 */

export const MY_DAY_PATH = "/my-day";
const MY_DAY_FROM_PARAM = "from";
const MY_DAY_FROM_VALUE = "my-day";

/** The full list ("All N") has its own address, so the phone Back button returns to the dashboard. */
export const MY_DAY_ALL_VIEW_HREF = `${MY_DAY_PATH}?view=all`;

function isMyDayPath(path: string): boolean {
  return path === MY_DAY_PATH || path.startsWith(`${MY_DAY_PATH}/`);
}

/**
 * `href` with the marker added. Only same-site paths are marked; an external
 * link, a protocol-relative link and My Day's own pages are returned unchanged,
 * as is a link that already carries a `from`.
 */
export function withMyDayReturn(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  if (isMyDayPath(path)) return href;
  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
  if (params.has(MY_DAY_FROM_PARAM)) return href;
  params.append(MY_DAY_FROM_PARAM, MY_DAY_FROM_VALUE);
  return `${path}?${params.toString()}${hash}`;
}

/** True when the address says the reader came from My Day. */
export function arrivedFromMyDay(params: { get(name: string): string | null } | null): boolean {
  return params?.get(MY_DAY_FROM_PARAM) === MY_DAY_FROM_VALUE;
}

/**
 * The first path segment: the mode a page belongs to. The return link stays
 * while the reader moves around inside that mode (e.g. after saving a CPD
 * entry) and goes once they leave it.
 */
export function myDayReturnScope(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

export function isMyDayPathname(pathname: string): boolean {
  return isMyDayPath(pathname);
}
