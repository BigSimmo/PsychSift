"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentProps } from "react";

const loadWorkSideMenu = () => import("@/components/work-frame/work-side-menu").then((module) => module.WorkSideMenu);
const LazyMenu = dynamic(loadWorkSideMenu, { ssr: false });

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

/** The side menu and rail's counts, read only while one of them is on screen. */
export function LazyWorkSideCounts({ active }: { readonly active: boolean }) {
  return active ? <LazyCounts /> : null;
}
