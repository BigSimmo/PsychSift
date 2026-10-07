import { useId } from "react";

import { cn } from "@/components/ui-primitives";

/** One four-point star with concave curved sides, centred on (x, y), radius r, curve factor f. */
function starPath(x: number, y: number, r: number, f: number): string {
  const k = r * f;
  return [
    `M ${x} ${y - r}`,
    `Q ${x + k} ${y - k} ${x + r} ${y}`,
    `Q ${x + k} ${y + k} ${x} ${y + r}`,
    `Q ${x - k} ${y + k} ${x - r} ${y}`,
    `Q ${x - k} ${y - k} ${x} ${y - r}`,
    "Z",
  ].join(" ");
}

const LENS = { cx: 10.7, cy: 14.2, r: 5.1 } as const;
// The handle leaves the ring at 45 degrees, down and to the right.
const HANDLE_FROM = { x: LENS.cx + LENS.r * Math.SQRT1_2, y: LENS.cy + LENS.r * Math.SQRT1_2 } as const;
const HANDLE_TO = { x: 17.706, y: 21.206 } as const;
const BIG_STAR = starPath(14.6, 6.6, 4.3, 0.18);
const SMALL_STAR = starPath(9, 4, 2.3, 0.2);

/**
 * The AI Search mark (Josh's pick "P5", 7 Oct 2026): a lens with two curved
 * four-point stars rising above it. It is the mark for AI Search (the reader's
 * own work records), never the clinical search.
 *
 * The lens takes the button's text colour. The stars are plum: the design
 * system's plum tone (`--tone-rose`, which has dark and high-contrast values),
 * falling back to the text colour. Where the big star crosses the ring, a mask
 * cuts a clean gap so the two never touch. The drawn shape (stroke included)
 * runs x 4.65 to 18.9 and y 1.7 to 22.4, so the whole mark is nudged to sit
 * optically centred in its 24 box.
 */
export function WorkSearchGlyph({ className }: { className?: string }) {
  // Several marks can share a page (header and sheet), so each mask gets its own id.
  const maskId = `work-search-glyph-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" className={cn("shrink-0", className)}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <g fill="black" stroke="black" strokeWidth={2} strokeLinejoin="round">
            <path d={BIG_STAR} />
            <path d={SMALL_STAR} />
          </g>
        </mask>
      </defs>
      <g transform="translate(0.22 -0.04)">
        <g mask={`url(#${maskId})`} stroke="currentColor">
          <circle cx={LENS.cx} cy={LENS.cy} r={LENS.r} strokeWidth={1.9} />
          <line
            x1={HANDLE_FROM.x}
            y1={HANDLE_FROM.y}
            x2={HANDLE_TO.x}
            y2={HANDLE_TO.y}
            strokeWidth={2.35}
            strokeLinecap="round"
          />
        </g>
        <g className="fill-[color:var(--tone-rose,currentColor)]">
          <path d={BIG_STAR} />
          <path d={SMALL_STAR} />
        </g>
      </g>
    </svg>
  );
}
