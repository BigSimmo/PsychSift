import { myDaySourceModes, type MyDayItem, type MyDaySourceMode } from "@/lib/my-day/model";

export const needsYouModeLabels: Readonly<Record<MyDaySourceMode, string>> = {
  "on-call": "On Call",
  roster: "Roster",
  cme: "CPD",
  teaching: "Teaching",
  "my-work": "Admin",
};

export type NeedsYouModeGroup = {
  readonly mode: MyDaySourceMode;
  readonly label: string;
  readonly items: readonly MyDayItem[];
};

/** One group per mode that has something waiting, in the My Day source order. */
export function groupNeedsYouItems(items: readonly MyDayItem[]): NeedsYouModeGroup[] {
  return myDaySourceModes
    .map((mode) => ({
      mode,
      label: needsYouModeLabels[mode],
      items: items.filter((item) => item.mode === mode),
    }))
    .filter((group) => group.items.length > 0);
}

export function needsYouWaitingCopy(count: number): string {
  if (count <= 0) return "Nothing needs you right now.";
  if (count === 1) return "Something needs attention.";
  return `${count} things need attention.`;
}
