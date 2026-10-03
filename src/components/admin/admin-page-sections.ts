import {
  BookOpen,
  CircleDashed,
  ClipboardList,
  FileDown,
  FolderOpen,
  LifeBuoy,
  LogOut,
  MapPinned,
  Phone,
  RefreshCw,
} from "lucide-react";

import type { PageSection } from "@/components/in-page-nav/page-section-index";

export const ADMIN_PAGE_HREFS = {
  today: "/admin",
  renewals: "/admin/renewals",
  newJob: "/admin/new-job",
  help: "/admin/help",
} as const;

/** One word per tab (spec), drawn by the `wordmark-five` rail. The ids are the DOM anchors. */
export const ADMIN_NEW_JOB_SECTIONS: readonly PageSection[] = [
  { id: "admin-new-job-before", label: "Before", icon: ClipboardList },
  { id: "admin-new-job-credential-pack", label: "Pack", icon: FileDown },
  { id: "admin-new-job-leaving", label: "Leaving", icon: LogOut },
];

export const ADMIN_HELP_SECTIONS: readonly PageSection[] = [
  { id: "admin-help-support", label: "Support", icon: LifeBuoy },
  { id: "admin-help-guides", label: "Guides", icon: BookOpen },
  { id: "admin-help-contacts", label: "Contacts", icon: Phone },
  { id: "admin-help-on-site", label: "On site", icon: MapPinned },
];

/**
 * Your Admin records' rail (`/admin/new-job/records`): one tab per group the
 * page can show, in the page's order. "Not for this job" has no tab of its own
 * (the rail draws five); it sits between Not recorded and New job. A group
 * with no rows renders no anchor, so its tab is dropped.
 */
export const ADMIN_RECORDS_SECTIONS: readonly PageSection[] = [
  { id: "admin-records-renewals", label: "Renewals", icon: RefreshCw },
  { id: "admin-records-not-recorded", label: "Not recorded", icon: CircleDashed },
  { id: "admin-records-new-job", label: "New job", icon: ClipboardList },
  { id: "admin-records-admin", label: "Admin", icon: FolderOpen },
  { id: "admin-records-contacts", label: "Contacts", icon: Phone },
];

export const ADMIN_HELP_ON_SITE_HREF = `${ADMIN_PAGE_HREFS.help}#admin-help-on-site`;
