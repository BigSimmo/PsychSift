import type { AppModeId } from "@/lib/app-modes";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * Work-mode help: the content model behind the help centre (`/my-day/help`) and
 * the contextual help sheet each work area opens from More.
 *
 * Content is static and lives in `topics/*.ts`, one file per topic. Every claim
 * describes behaviour the app actually has, and every link is a real route, so
 * help can never send a doctor to a page that does not exist.
 */

export type WorkHelpTopicId =
  | "day"
  | "rost"
  | "open-shifts"
  | "teach"
  | "assess"
  | "cpd"
  | "admin"
  | "call"
  | "search"
  | "getting-started"
  | "privacy"
  | "alerts"
  | "favourites"
  | "offline";

export type WorkHelpLink = {
  readonly label: string;
  /** A real in-app route (checked by tests against the work frame registry and the app routes). */
  readonly href: string;
};

export type WorkHelpQuestion = {
  /** Stable, kebab-case, unique within the topic. Used for deep links (`#q-<id>`). */
  readonly id: string;
  /** The question as a doctor would ask it, sentence case, ending in "?". */
  readonly q: string;
  /** One to three short plain sentences. */
  readonly a: string;
  readonly link?: WorkHelpLink;
};

export type WorkHelpTab = {
  /** The tab's label exactly as the frame shows it. */
  readonly label: string;
  /** One short sentence: what the tab is for. */
  readonly body: string;
};

export type WorkHelpTopic = {
  readonly id: WorkHelpTopicId;
  /** "area" topics belong to a work area. "guide" topics cover the app as a whole. */
  readonly kind: "area" | "guide";
  readonly title: string;
  /** The work area whose More sheet opens this topic, when it has one. */
  readonly areaId?: WorkAreaId;
  /** The palette used for the topic's colour dot (`data-mode-identity`). */
  readonly identity: AppModeId;
  /** One short line: what it is for. Shown under the title in lists. */
  readonly summary: string;
  /** The three pinned tabs, for area topics. */
  readonly tabs?: readonly WorkHelpTab[];
  /** Three to six common questions, most useful first. */
  readonly questions: readonly WorkHelpQuestion[];
  /** Where to set this part up, most important first. */
  readonly setUp?: readonly WorkHelpLink[];
  /** Extra words people might search with that do not appear in the text. */
  readonly keywords: string;
};
