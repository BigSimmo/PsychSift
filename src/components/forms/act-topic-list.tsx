"use client";

import { useEffect, useState } from "react";

import {
  DesktopSplitCurrentBar,
  desktopSplitHeadingClass,
  desktopSplitRowClass,
  desktopSplitRowCurrentClass,
  desktopSplitRowIdleClass,
} from "@/components/work-frame/desktop-split-list";
import { cn } from "@/components/ui-primitives";

export type ActTopic = {
  /** The id of the element on the page the topic jumps to. */
  readonly targetId: string;
  readonly title: string;
  /** How many sections the topic holds, when it is a group of sections. */
  readonly count?: number;
};

const DESKTOP_QUERY = "(min-width: 1024px)";
/** A topic is "where you are" once its heading has passed this line below the top. */
const READING_LINE_PX = 160;

/**
 * Tracks which topic the reader is in, for `aria-current="location"`. Desktop
 * only: below 1024px the list is not drawn, so it does no work there.
 */
function useCurrentTopic(targetIds: readonly string[]) {
  const [current, setCurrent] = useState<string | null>(null);
  const key = targetIds.join("|");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(DESKTOP_QUERY);
    const ids = key ? key.split("|") : [];
    let frame = 0;

    const measure = () => {
      frame = 0;
      let next: string | null = ids[0] ?? null;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= READING_LINE_PX) next = id;
        else break;
      }
      setCurrent(next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const start = () => {
      window.addEventListener("scroll", schedule, { passive: true, capture: true });
      window.addEventListener("resize", schedule);
      schedule();
    };
    const stop = () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onMediaChange = () => (media.matches ? start() : stop());

    if (media.matches) start();
    media.addEventListener("change", onMediaChange);
    return () => {
      stop();
      media.removeEventListener("change", onMediaChange);
    };
  }, [key]);

  return current;
}

function TopicRows({ topics, current }: { topics: readonly ActTopic[]; current: string | null }) {
  return (
    <ul className="grid gap-0.5">
      {topics.map((topic) => {
        const isCurrent = topic.targetId === current;
        return (
          <li key={topic.targetId}>
            <a
              href={`#${topic.targetId}`}
              aria-current={isCurrent ? "location" : undefined}
              className={cn(desktopSplitRowClass, isCurrent ? desktopSplitRowCurrentClass : desktopSplitRowIdleClass)}
            >
              {isCurrent ? <DesktopSplitCurrentBar /> : null}
              <span className="min-w-0 flex-1">{topic.title}</span>
              {topic.count !== undefined ? (
                <span className="shrink-0 text-2xs font-bold tabular-nums text-[color:var(--text-muted)]">
                  <span className="sr-only">, </span>
                  {topic.count}
                  <span className="sr-only"> {topic.count === 1 ? "section" : "sections"}</span>
                </span>
              ) : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Act page's topic list, the column beside the text from 1024px (in a
 * `ClinicalSplit`). Each row jumps to its group of sections or its standard on
 * the page; the one being read is marked `aria-current="location"`.
 */
export function ActTopicList({
  actTopics,
  standardTopics,
}: {
  actTopics: readonly ActTopic[];
  standardTopics: readonly ActTopic[];
}) {
  const current = useCurrentTopic([...actTopics, ...standardTopics].map((topic) => topic.targetId));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 p-2" data-testid="act-topic-list">
      <p className={desktopSplitHeadingClass}>Mental Health Act 2014 (WA)</p>
      <TopicRows topics={actTopics} current={current} />
      {standardTopics.length ? (
        <>
          <p className={cn(desktopSplitHeadingClass, "mt-2 border-t border-[color:var(--border)] pt-3")}>
            Chief Psychiatrist&apos;s Standards
          </p>
          <TopicRows topics={standardTopics} current={current} />
        </>
      ) : null}
    </div>
  );
}
