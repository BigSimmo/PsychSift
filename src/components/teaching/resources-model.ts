import { ApiClientError } from "@/lib/api-client-error";
import { teachingErrorMessage } from "@/lib/teaching/client";
import type { ResourceKind, ResourceRow } from "@/lib/teaching/model";
import { daysBetween, studyPlanWeek, studyStreak, type ExamPrepState } from "@/lib/teaching/term-tracker";

export type ResourceType = "all" | "recordings" | "reading";

/** The type is always in words (spec §5a), never an icon alone. */
export const RESOURCE_KIND_WORDS: Record<ResourceKind, string> = {
  slides: "Slides",
  recording: "Recording",
  reading: "Reading",
  link: "Link",
  library: "Library document",
};

/** What the add sheet offers. A library document is chosen from the library, never typed, so it is not here. */
export const ADD_KINDS = ["slides", "reading", "link"] as const;
export type AddKind = (typeof ADD_KINDS)[number];

/**
 * The same shape the server insists on (`^https://host`, no user name, at most 2000 characters), so the
 * sheet can say what is wrong before anything is sent. The server still checks it again.
 */
export function isHttpsLink(value: string): boolean {
  const url = value.trim();
  return url.length <= 2000 && /^https:\/\/[^/@\s]+(\/\S*)?$/i.test(url);
}

/** A library document opens inside the app; anything else opens where it lives, and only over https. */
export function resourceHref(item: Pick<ResourceRow, "libraryDocumentId" | "url">): string | null {
  if (item.libraryDocumentId) return `/documents/${item.libraryDocumentId}`;
  return item.url && isHttpsLink(item.url) ? item.url.trim() : null;
}

/** The in-page filter: this list only, on this device. It never calls search or any AI service. */
export function filterResources<T extends ResourceRow>(items: readonly T[], type: ResourceType, query: string): T[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (type === "recordings" && item.kind !== "recording") return false;
    if (type === "reading" && item.kind !== "reading" && item.kind !== "library") return false;
    return !needle || item.title.toLowerCase().includes(needle);
  });
}

export function resourceSections(
  sections: readonly { sectionId: string; name: string; sortOrder: number }[],
  items: readonly ResourceRow[],
): { id: string; label: string; items: ResourceRow[] }[] {
  const known = new Set(sections.map((section) => section.sectionId));
  const grouped = [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((section) => ({
      id: section.sectionId,
      label: section.name,
      items: items.filter((item) => item.sectionId === section.sectionId),
    }));
  const rest = items.filter((item) => !item.sectionId || !known.has(item.sectionId));
  const other = rest.length ? [{ id: "other", label: sections.length ? "Other" : "Items", items: rest }] : [];
  return [...grouped, ...other].filter((group) => group.items.length > 0);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A collection page's address: an organiser-made collection's id, or one of the two built-in ones. */
export function isCollectionParam(value: string): boolean {
  return value === "recordings" || value === "saved" || UUID.test(value);
}

/** Demo mode refuses every write (S9); say so plainly instead of "That didn't go through". */
export function resourceWriteError(cause: unknown): string {
  if (cause instanceof ApiClientError && cause.code === "demo_mode_unavailable")
    return "The demo doesn't save changes.";
  return teachingErrorMessage(cause);
}

/**
 * The My exam prep row on Resources: "Written exam in 111 days" over "Study plan week 6 of 22 · 9 days in
 * a row". Reads only what the doctor typed on this device; with no exam set it simply says what the page is.
 */
export function examPrepRow(state: ExamPrepState | null, today: string): { title: string; meta: string } {
  const exam = state?.exam;
  if (!state || !exam) return { title: "My exam prep", meta: "Countdown, study days and topics" };
  const days = daysBetween(today, exam.on);
  if (days < 0) return { title: "My exam prep", meta: `${exam.name} has passed · set your next exam` };
  const plan = studyPlanWeek(exam, today);
  const streak = studyStreak(state.study, today);
  return {
    title: days === 0 ? `${exam.name} today` : `${exam.name} in ${days} ${days === 1 ? "day" : "days"}`,
    meta: [
      `Study plan week ${plan.week} of ${plan.total}`,
      streak > 0 ? `${streak} ${streak === 1 ? "day" : "days"} in a row` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
