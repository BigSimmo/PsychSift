/** The non-breaking space the v5.2 detail pass puts between every number and its unit. */
export const NBSP = " ";

/** "14 h", "68 of 86", "40 min": the one way Teaching writes a number with its unit. */
export function withUnit(value: string | number, unit: string): string {
  return `${value}${NBSP}${unit}`;
}

/** "40 min", "1 h", "1 h 25 min": a length of time in whole minutes. */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return withUnit(rest, "min");
  return rest ? `${withUnit(hours, "h")} ${withUnit(rest, "min")}` : withUnit(hours, "h");
}
