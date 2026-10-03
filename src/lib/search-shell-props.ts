import type { AppModeId } from "@/lib/app-modes";
import { modeSecondaryNavigationRegistry } from "@/lib/mode-secondary-navigation";

const reservedSourcesSubroutes = new Set(
  modeSecondaryNavigationRegistry.sources
    .map((item) => (item.href?.startsWith("/sources/") ? item.href.slice("/sources/".length) : undefined))
    .filter((subpath): subpath is string => Boolean(subpath)),
);

export type SearchShellPathProps = {
  initialMode: AppModeId;
  availableModeIds?: AppModeId[];
  desktopSearchPlacement?: "default" | "hero";
  mobileHomeComposerPlacement?: "hero" | "footer";
  searchComposerVisible?: boolean;
  mobileChromeVisible?: boolean;
};

/**
 * Derive GlobalSearchShell props from the current pathname so a single shared
 * layout can own the shell across mode homes (avoids remounting the composer
 * when navigating between namespaced modes).
 */
export function searchShellPropsForPathname(pathname: string): SearchShellPathProps {
  if (pathname === "/documents/search" || pathname.startsWith("/documents/")) {
    const isDocumentSearchRoute = pathname === "/documents/search";
    const documentFlowOwnsMobileChrome = pathname.startsWith("/documents/source");
    return {
      initialMode: "documents",
      searchComposerVisible: isDocumentSearchRoute,
      mobileChromeVisible: !documentFlowOwnsMobileChrome,
    };
  }

  if (pathname.startsWith("/medications")) {
    return { initialMode: "prescribing", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/services")) {
    return { initialMode: "services", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/forms")) {
    return { initialMode: "forms", availableModeIds: ["forms"], desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/favourites")) {
    return { initialMode: "favourites", availableModeIds: ["favourites"], desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/differentials")) {
    return { initialMode: "differentials", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/dsm")) {
    return { initialMode: "dsm", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/specifiers")) {
    return { initialMode: "specifiers", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/formulation")) {
    return { initialMode: "formulation", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/tools")) {
    return {
      initialMode: "tools",
      desktopSearchPlacement: "hero",
      mobileHomeComposerPlacement: "footer",
    };
  }

  if (pathname.startsWith("/calculators")) {
    return { initialMode: "calculators", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/therapy-compass")) {
    // Recommend owns an in-flow clinical-situation composer. The shared phone
    // dock would be a second search on the same page, so this exact route
    // hides the shell composer the same way `/dictionary/sources` does.
    return {
      initialMode: "therapy-compass",
      desktopSearchPlacement: "hero",
      ...(pathname === "/therapy-compass/recommend" ? { searchComposerVisible: false } : {}),
    };
  }

  if (pathname.startsWith("/factsheets")) {
    return { initialMode: "factsheets", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/sources")) {
    const rest = pathname.slice("/sources/".length);
    const isDetail = pathname.startsWith("/sources/") && !reservedSourcesSubroutes.has(rest);
    return {
      initialMode: "sources",
      desktopSearchPlacement: "hero",
      ...(pathname === "/sources/method" || isDetail ? { searchComposerVisible: false } : {}),
    };
  }

  if (pathname.startsWith("/on-call")) {
    return { initialMode: "on-call", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/cme")) {
    return { initialMode: "cme", desktopSearchPlacement: "hero" };
  }

  if (pathname === "/psychiatry") {
    return { initialMode: "psychiatry", desktopSearchPlacement: "hero" };
  }

  // Admin has no search surface, and its pages never wear the shared composer or its
  // microphone (spec review 18). Help's "Find in Help" is an in-page filter, not a composer.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return { initialMode: "my-work", desktopSearchPlacement: "hero", searchComposerVisible: false };
  }

  if (pathname.startsWith("/roster")) {
    return { initialMode: "roster", desktopSearchPlacement: "hero" };
  }

  // My Day searches nothing, so like Admin it never wears the shared composer.
  if (pathname === "/my-day" || pathname.startsWith("/my-day/")) {
    return { initialMode: "my-day", desktopSearchPlacement: "hero", searchComposerVisible: false };
  }

  if (pathname === "/first-nations" || pathname.startsWith("/first-nations/")) {
    return { initialMode: "first-nations", desktopSearchPlacement: "hero" };
  }

  if (pathname === "/teaching" || pathname.startsWith("/teaching/")) {
    return { initialMode: "teaching", desktopSearchPlacement: "hero" };
  }

  if (pathname.startsWith("/dictionary")) {
    // `/dictionary/sources` is a read-only governance page — the source method,
    // the authority hierarchy, the index and the review cadence. Nothing on it
    // is searched, so it carries no composer (the mode nav still reaches every
    // other dictionary surface). Every other dictionary route keeps one.
    return {
      initialMode: "dictionary",
      desktopSearchPlacement: "hero",
      ...(pathname === "/dictionary/sources" ? { searchComposerVisible: false } : {}),
    };
  }

  return { initialMode: "answer" };
}
