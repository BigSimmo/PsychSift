"use client";

import { Sheet } from "@/components/ui/sheet";
import { shortcutRows } from "@/lib/keyboard-shortcuts";

function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

const keyCap =
  "inline-flex min-w-7 items-center justify-center rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-1.5 font-sans text-xs font-semibold leading-6 text-[color:var(--text-heading)]";

/**
 * The short "Keyboard shortcuts" list for the whole app, opened with "?" on a
 * Clinical page or from the Help page. Work pages keep their AI Search list,
 * which adds the keys that work inside AI Search. Loaded only when first asked for.
 */
export function KeyboardShortcutsSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="On a computer, when you are not typing in a box."
      closeLabel="Close keyboard shortcuts"
      portal
      testId="keyboard-shortcuts"
    >
      <dl className="m-0 grid gap-0 divide-y divide-[color:var(--border)]">
        {shortcutRows(isApple()).map((row) => (
          <div key={row.label} className="flex min-h-12 items-center justify-between gap-4 py-2">
            <dt className="text-sm text-[color:var(--text-heading)]">{row.label}</dt>
            <dd className="m-0 flex shrink-0 items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
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
