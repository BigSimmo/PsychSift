import type { ReactNode } from "react";

/**
 * The urgent marker on Open shifts: the shared amber dot, the Work mode shape for "needs attention
 * soon" (Ward Flow review, 12 Oct 2026). A red triangle means a date has passed, which an urgent shift
 * has not. The dot leads the text it sits beside (the word "Urgent", or the day's count), and every
 * place without visible text carries a spoken label, so the meaning never rests on the colour.
 */
export function UrgentDot({ children }: { children?: ReactNode }) {
  return (
    <>
      <i
        aria-hidden="true"
        data-mark="dot"
        className="inline-block size-1.5 shrink-0 rounded-full bg-[color:var(--warning)] forced-colors:bg-[CanvasText]"
      />
      {children}
    </>
  );
}
