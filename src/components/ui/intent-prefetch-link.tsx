"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PrefetchOptions } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { forwardRef, useCallback, useRef, type ComponentProps, type FocusEvent, type PointerEvent } from "react";

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, "prefetch" | "href"> & {
  href: string;
  /** `true` keeps Next's eager viewport prefetch for a deliberately pre-warmed destination. */
  prefetch?: true;
};

/**
 * The app router, or null where none is mounted (isolated component renders). Intent
 * prefetch is an optimisation, so a link must never fail to render without a router.
 * The hook is still called unconditionally on every render.
 */
function useOptionalRouter(): ReturnType<typeof useRouter> | null {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

/**
 * A `next/link` that prefetches on intent (pointer enter, touch, focus) instead of on
 * viewport entry. The home page renders ~10 always-visible nav links; eager viewport
 * prefetch fired ~13 RSC requests while the page was still hydrating, and processing
 * their responses produced most of desktop `/`'s long tasks (Total Blocking Time).
 * Intent prefetch still warms the route before the click lands.
 */
export const IntentPrefetchLink = forwardRef<HTMLAnchorElement, IntentPrefetchLinkProps>(function IntentPrefetchLink(
  { href, prefetch, onPointerEnter, onFocus, ...rest },
  ref,
) {
  const router = useOptionalRouter();
  const prefetchedHref = useRef<string | null>(null);
  const warm = useCallback(() => {
    // Track the href, not a boolean: one link instance can outlive a destination change.
    if (prefetchedHref.current === href) return;
    if (!router) return;
    prefetchedHref.current = href;
    router.prefetch(href, {
      // "auto" is what a bare router.prefetch(href) uses.
      kind: "auto" as PrefetchOptions["kind"],
      // Once the prefetched data goes stale, let the next intent warm it again.
      onInvalidate: () => {
        if (prefetchedHref.current === href) prefetchedHref.current = null;
      },
    });
  }, [router, href]);
  return (
    <Link
      ref={ref}
      href={href}
      prefetch={prefetch ? true : false}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        warm();
        onPointerEnter?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        warm();
        onFocus?.(event);
      }}
      {...rest}
    />
  );
});
