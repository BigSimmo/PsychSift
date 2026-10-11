"use client";

import { ModeLabelledActionButton, type ModeLabelledActionButtonProps } from "@/components/mode-kit/action-button";

export type FnButtonProps = ModeLabelledActionButtonProps;

/**
 * First Nations' labelled button. Outlined buttons pass straight through. A
 * filled (primary) button takes the area's olive rather than the shared
 * near-black command fill, because primary buttons always wear the area colour
 * in both modes (design pass, October 2026). Sheets such as "About First
 * Nations" render outside the module scopes that carry the olive, so the
 * button brings its own scope: a `contents` wrapper adds no box to the layout,
 * and custom properties still inherit through it.
 */
export function FnButton(props: FnButtonProps) {
  if (!props.filled) return <ModeLabelledActionButton {...props} />;
  return (
    <span
      data-mode-identity="first-nations"
      className="contents [--command-contrast:var(--mode-identity-contrast)] [--command:var(--mode-identity)]"
    >
      <ModeLabelledActionButton {...props} />
    </span>
  );
}
