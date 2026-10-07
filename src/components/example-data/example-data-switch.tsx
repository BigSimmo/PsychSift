"use client";

import { Layers } from "lucide-react";
import { useId } from "react";

import { WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import { FIRST_USE } from "@/lib/example-data/first-use-copy";
import { exampleAreasLine } from "@/lib/example-data/labels";
import { useExampleData } from "@/lib/example-data/store";
import { WORK_AREAS } from "@/lib/work-frame/areas";

/**
 * The one example data switch, as a settings row (setup mockup, Settings
 * frames): a work row with an icon circle, in its own card (`work`) or bare
 * for a page that places it itself (`inline`, the setup walkthrough). While it
 * is on, a line under it says how many areas show examples, with each area's
 * icon.
 */
export function ExampleDataSwitch({ variant = "work" }: { readonly variant?: "work" | "inline" }) {
  const { on, activeAreas, turnOn, turnOff } = useExampleData();
  const noteId = useId();

  const row = (
    <>
      <div className="work-row">
        <WorkIconCircle icon={Layers} />
        <span className="grid min-w-0 flex-1">
          <span className="work-row__title">Example data</span>
          <span className="work-row__sub">Made-up data in every area</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Example data"
          aria-describedby={on ? noteId : undefined}
          onClick={on ? turnOff : turnOn}
          data-testid="example-data-switch"
          className="group -mr-1.5 inline-grid size-12 flex-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-6 w-10 items-center rounded-full border transition-colors duration-[var(--duration-instant)] motion-reduce:transition-none forced-colors:border-[CanvasText] ${
              on
                ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]"
                : "border-[color:var(--border-strong)] bg-[color:var(--surface-inset)]"
            }`}
          >
            <span
              className={`absolute size-5 rounded-full bg-[color:var(--surface-raised)] transition-[left] duration-[var(--duration-instant)] motion-reduce:transition-none forced-colors:bg-[CanvasText] ${
                on ? "left-[1.0625rem]" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </div>
      {on ? (
        <div className="px-3 pb-3 pl-[3.25rem]">
          <p id={noteId} className="m-0 text-xs leading-snug font-medium text-[color:var(--work-ink-muted)]">
            {exampleAreasLine(activeAreas.length)}
          </p>
          {activeAreas.length > 0 ? (
            <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0" aria-label="Areas showing example data">
              {activeAreas.map((area) => (
                <li key={area} className="flex">
                  <WorkIconCircle
                    icon={workFrameIcons[FIRST_USE[area].icon]}
                    leadsTo={WORK_AREAS[area].identity}
                    size="sm"
                  />
                  <span className="sr-only">{WORK_AREAS[area].name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return variant === "work" ? (
    <WorkCard testId="example-data-setting">{row}</WorkCard>
  ) : (
    <div data-testid="example-data-setting">{row}</div>
  );
}
