"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useRef, type ComponentProps, type FocusEvent, type PointerEvent } from "react";

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, "prefetch" | "href"> & {
  href: string;
  /** `true` keeps Next's eager viewport prefetch for a deliberately pre-warmed destination. */
  prefetch?: true;
};

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
  const router = useRouter();
  const prefetched = useRef(false);
  const warm = useCallback(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href);
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
