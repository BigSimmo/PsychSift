import {
  Briefcase,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  Inbox,
  ListChecks,
  Plus,
  Repeat,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";

import type { HospitalLinkIcon, HospitalSectionId } from "@/lib/work-roles/hospital-hub";

/** The Hospital screens' icons, kept apart so My Day's card loads nothing else from them. */
export const HOSPITAL_LINK_ICON: Readonly<Record<HospitalLinkIcon, LucideIcon>> = {
  sick: UserX,
  starters: UserPlus,
  people: Users,
  overview: ListChecks,
  assign: UserCheck,
  inbox: Inbox,
  times: CalendarClock,
  team: ClipboardList,
  cover: ShieldCheck,
  rotation: Repeat,
  course: GraduationCap,
  post: Plus,
};

export const HOSPITAL_SECTION_ICON: Readonly<Record<HospitalSectionId, LucideIcon>> = {
  workforce: Briefcase,
  dct: GraduationCap,
  supervisor: UserCheck,
  manager: Users,
};
