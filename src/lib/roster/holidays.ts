import { WA_PUBLIC_HOLIDAYS as BASE_WA_PUBLIC_HOLIDAYS } from "@/lib/on-call/wa-public-holidays";

/**
 * Array of Western Australian public holidays (including official 2028 dates).
 */
export const WA_PUBLIC_HOLIDAYS: readonly string[] = Object.freeze(Array.from(BASE_WA_PUBLIC_HOLIDAYS));

/**
 * Official Western Australian public holidays for 2028, as published by the WA
 * Government and the WA Public and Bank Holidays Act 1972, including King's
 * Birthday (set by proclamation, observed on the last Monday of September).
 */
export const WA_PUBLIC_HOLIDAYS_2028: readonly string[] = Object.freeze(
  WA_PUBLIC_HOLIDAYS.filter((date) => date.startsWith("2028-")),
);

export const holidays = WA_PUBLIC_HOLIDAYS;

export function isWaPublicHoliday2028(dateStr: string): boolean {
  return WA_PUBLIC_HOLIDAYS_2028.includes(dateStr);
}
