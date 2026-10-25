"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

type NavigationCapability = {
  canGoBack?: boolean;
};

type WindowWithNavigation = Window & {
  navigation?: NavigationCapability;
};

/**
 * The history length when this document first ran this module. Entries past it
 * were added by this document's own client-side navigations, so stepping back
 * from one stays in the app.
 */
const historyLengthAtLoad = typeof window === "undefined" ? null : window.history.length;

function hasSameOriginReferrer(): boolean {
  if (!document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function canNavigateBack(): boolean {
  if (typeof window === "undefined") return false;
  const canGoBack = (window as WindowWithNavigation).navigation?.canGoBack;
  if (typeof canGoBack === "boolean") return canGoBack;
  // Without the Navigation API, history.length also counts entries from other
  // sites: a deep link opened from an email has a length above 1, and
  // router.back() would leave the app. Only trust it when the previous entry is
  // known to be ours — this document was opened from this origin, or it has
  // navigated client-side since it loaded.
  if (window.history.length <= 1) return false;
  return hasSameOriginReferrer() || (historyLengthAtLoad !== null && window.history.length > historyLengthAtLoad);
}

export function navigateContextuallyBack(
  router: Pick<ReturnType<typeof useRouter>, "back" | "replace">,
  fallbackHref: string,
) {
  if (canNavigateBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref);
}

function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!event.currentTarget.target || event.currentTarget.target === "_self")
  );
}

export type ContextualBackLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onClick"> & {
  fallbackHref: string;
  /** Return false to keep the user on the current page. */
  onBeforeNavigate?: () => boolean;
  onClick?: ComponentProps<typeof Link>["onClick"];
};

/**
 * A real fallback link for deep links/new tabs that otherwise follows the
 * current tab's browser history. Modified clicks keep normal link semantics.
 */
export function ContextualBackLink({
  fallbackHref,
  onBeforeNavigate,
  onClick,
  children,
  ...props
}: ContextualBackLinkProps) {
  const router = useRouter();

  return (
    <Link
      {...props}
      href={fallbackHref}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (onBeforeNavigate && !onBeforeNavigate()) {
          event.preventDefault();
          return;
        }
        if (!isUnmodifiedPrimaryClick(event)) return;
        event.preventDefault();
        navigateContextuallyBack(router, fallbackHref);
      }}
    >
      {children}
    </Link>
  );
}
