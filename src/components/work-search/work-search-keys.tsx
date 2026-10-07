"use client";

import type { RefObject } from "react";

import { Sheet } from "@/components/ui/sheet";

/**
 * The keyboard list for Search my work, opened with "?" on any work page
 * (work-mode redesign, ideas list #3). Loaded only when first asked for.
 */

function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

const keyCap =
  "inline-flex min-w-7 items-center justify-center rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-1.5 font-sans text-xs font-semibold leading-6 text-[color:var(--text-heading)]";

export function WorkSearchKeys({
  open,
  onClose,
  returnFocusRef,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const command = isApple() ? "⌘" : "Ctrl";
  const rows: { keys: string[][]; label: string }[] = [
    { keys: [["/"], [command, "K"]], label: "Search my work" },
    { keys: [["Up"], ["Down"]], label: "Move between results" },
    { keys: [["Enter"]], label: "Open the top result" },
    { keys: [["Esc"]], label: "Close" },
    { keys: [["?"]], label: "Show this list" },
  ];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="On any work page."
      closeLabel="Close keyboard shortcuts"
      returnFocusRef={returnFocusRef}
      portal
      testId="work-search-keys"
    >
      <dl className="m-0 grid gap-0 divide-y divide-[color:var(--border)]">
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-12 items-center justify-between gap-4 py-2">
            <dt className="text-sm text-[color:var(--text-heading)]">{row.label}</dt>
            <dd className="m-0 flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              {row.keys.map((combo, index) => (
                <span key={combo.join("+")} className="inline-flex items-center gap-1">
                  {index > 0 ? <span className="px-0.5">or</span> : null}
                  {combo.map((key) => (
                    <kbd key={key} className={keyCap}>
                      {key}
                    </kbd>
                  ))}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
