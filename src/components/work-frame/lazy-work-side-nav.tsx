"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentProps } from "react";

const loadWorkSideMenu = () => import("@/components/work-frame/work-side-menu").then((module) => module.WorkSideMenu);
const LazyMenu = dynamic(loadWorkSideMenu, { ssr: false });

const loadTwoPaneSideMenu = () =>
  import("@/components/work-frame/two-pane-side-menu").then((module) => module.TwoPaneSideMenu);
const LazyTwoPane = dynamic(loadTwoPaneSideMenu, { ssr: false });

const LazyCounts = dynamic(
  () => import("@/components/work-frame/work-side-counts-reader").then((module) => module.WorkSideCountsReader),
  { ssr: false },
);

/** Warms the side menu's chunk when the menu button is about to be pressed. */
export function prefetchWorkSideMenu() {
  void loadWorkSideMenu();
}

/**
 * The work side menu as a lazy chunk: nothing loads until it first opens, and
 * it stays mounted after that so closing it returns focus to the menu button.
 */
export function LazyWorkSideMenu(props: ComponentProps<typeof LazyMenu>) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  return opened ? <LazyMenu {...props} /> : null;
}

/** Warms the two-pane side menu's chunk (Live version switch). */
export function prefetchTwoPaneSideMenu() {
  void loadTwoPaneSideMenu();
}

/** The two-pane side menu as a lazy chunk, kept mounted after its first opening like the work menu. */
export function LazyTwoPaneSideMenu(props: ComponentProps<typeof LazyTwoPane>) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  return opened ? <LazyTwoPane {...props} /> : null;
}

/** The side menu and rail's counts, read only while one of them is on screen. */
export function LazyWorkSideCounts({ active }: { readonly active: boolean }) {
  return active ? <LazyCounts /> : null;
}

/**
 * The two-pane side menu with its own counts reader, for a page that has no
 * work side nav of its own (the clinical dashboard). The reader starts at the
 * first opening and stays mounted after it, so reopening never fetches the feed
 * again, and a clinical page never loads the work feed until the menu is used.
 */
export function TwoPaneSideMenuHost(props: ComponentProps<typeof LazyTwoPane>) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  return (
    <>
      <LazyWorkSideCounts active={opened && props.workAvailable} />
      <LazyTwoPaneSideMenu {...props} />
    </>
  );
}
