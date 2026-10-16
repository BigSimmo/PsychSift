import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect } from "react";

import { ownsVerticalScroll, scrollSurface } from "@/components/clinical-dashboard/scroll-surface";

export interface UseDashboardScrollSyncOptions {
  mainRef: MutableRefObject<HTMLElement | null>;
  navSyncLockRef: MutableRefObject<number | null>;
  scrollFrameRef: MutableRefObject<number | null>;
  setActiveHash: Dispatch<SetStateAction<string>>;
}

export function useDashboardScrollSync({
  mainRef,
  navSyncLockRef,
  scrollFrameRef,
  setActiveHash,
}: UseDashboardScrollSyncOptions) {
  const syncActiveSectionFromScroll = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    if (main.scrollLeft !== 0) main.scrollLeft = 0;
    if (navSyncLockRef.current !== null) return;

    const innerScrollOwner = ownsVerticalScroll(main);
    const offset = innerScrollOwner ? main.scrollTop : window.scrollY;
    if (offset < 120) {
      setActiveHash((current) => (current === "#search" ? current : "#search"));
      return;
    }

    const marker = (innerScrollOwner ? main.getBoundingClientRect().top : 0) + 96;
    const sections = ["#quotes", "#images", "#sources"];
    const current =
      sections
        .map((section) => {
          const target = document.querySelector<HTMLElement>(section);
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          if (rect.top > marker + 220) return null;
          return { section, distance: Math.abs(rect.top - marker) };
        })
        .filter((item): item is { section: string; distance: number } => Boolean(item))
        .sort((a, b) => a.distance - b.distance)[0]?.section ?? "#search";
    setActiveHash((active) => (active === current ? active : current));
  }, [mainRef, navSyncLockRef, setActiveHash]);

  const scheduleActiveSectionSync = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncActiveSectionFromScroll();
    });
  }, [scrollFrameRef, syncActiveSectionFromScroll]);

  function handleMainScroll() {
    scheduleActiveSectionSync();
  }

  useEffect(() => {
    window.addEventListener("scroll", scheduleActiveSectionSync, { passive: true });
    return () => {
      window.removeEventListener("scroll", scheduleActiveSectionSync);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [scheduleActiveSectionSync, scrollFrameRef]);

  return {
    handleMainScroll,
    scheduleActiveSectionSync,
    syncActiveSectionFromScroll,
  };
}

export interface UseDashboardSectionNavigationOptions {
  mainRef: MutableRefObject<HTMLElement | null>;
  navSyncLockRef: MutableRefObject<number | null>;
  setActiveHash: Dispatch<SetStateAction<string>>;
}

export function useDashboardSectionNavigation({
  mainRef,
  navSyncLockRef,
  setActiveHash,
}: UseDashboardSectionNavigationOptions) {
  useEffect(() => {
    return () => {
      if (navSyncLockRef.current !== null) {
        window.clearTimeout(navSyncLockRef.current);
      }
    };
  }, [navSyncLockRef]);

  const navigateMobileSection = useCallback(
    (href: string, options: { updateHistory?: boolean } = {}) => {
      const shouldUpdateHistory = options.updateHistory ?? true;
      const main = mainRef.current;
      if (!main) return;

      if (navSyncLockRef.current !== null) {
        window.clearTimeout(navSyncLockRef.current);
      }

      if (href === "#search") {
        setActiveHash(href);
        scrollSurface(main, 0);
        if (shouldUpdateHistory) window.history.replaceState(null, "", href);
        navSyncLockRef.current = window.setTimeout(() => {
          navSyncLockRef.current = null;
        }, 350);
        return;
      }

      const target = document.querySelector<HTMLElement>(href);
      if (!target) return;
      setActiveHash(href);
      const targetTop = target.getBoundingClientRect().top;
      const unclamped = ownsVerticalScroll(main)
        ? main.scrollTop + targetTop - main.getBoundingClientRect().top - 8
        : window.scrollY + targetTop - 8;
      // Clamp like settings-dialog: short #quotes|#images|#sources sections can
      // compute a top past the runway. scrollSurface also clamps; keep the
      // local clamp so this hash path does not fight use-hide-on-scroll.
      const scroller = ownsVerticalScroll(main) ? main : (document.scrollingElement ?? document.documentElement);
      const maxOffset = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const top = Math.min(Math.max(0, unclamped), maxOffset);
      scrollSurface(main, top);
      if (shouldUpdateHistory) window.history.replaceState(null, "", href);
      navSyncLockRef.current = window.setTimeout(() => {
        navSyncLockRef.current = null;
      }, 350);
    },
    [mainRef, navSyncLockRef, setActiveHash],
  );

  return { navigateMobileSection };
}
