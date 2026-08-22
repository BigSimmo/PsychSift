import {
  Activity,
  Brain,
  Calculator,
  ClipboardList,
  FileCheck2,
  FileText,
  HeartHandshake,
  Pill,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";
import { appModeIcons } from "@/lib/app-mode-icons";
import { toolCatalogRecordById } from "@/lib/tools-catalog";

export type ToolStatus = "ready" | "review_due" | "recent";
export type ToolArea = "reference" | "assessment" | "care" | "coordination" | "personal";

export type ToolFixture = {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  area: ToolArea;
  sourceBacked: boolean;
  status: ToolStatus;
  lastUsed: string;
  primaryAction: string;
  secondary: string;
};

// Identity (title/description/href/sourceBacked) comes from the shared tools catalog
// (src/lib/tools-catalog.ts); only mockup-specific presentation extras live here.
type ToolFixtureExtras = {
  id: string;
  icon: LucideIcon;
  area: ToolArea;
  status: ToolStatus;
  lastUsed: string;
  primaryAction: string;
  secondary: string;
  title?: string;
  description?: string;
};

const fixtureExtras: ToolFixtureExtras[] = [
  {
    id: "clinical-kb-search",
    icon: Search,
    area: "reference",
    status: "ready",
    lastUsed: "Today, 7:30 AM",
    primaryAction: "Ask",
    secondary: "Guidance, answers, source checks",
  },
  {
    id: "documents",
    icon: FileText,
    area: "reference",
    status: "ready",
    lastUsed: "May 10, 2025",
    primaryAction: "Search",
    secondary: "Library, source PDF, index health",
  },
  {
    id: "differentials",
    icon: Brain,
    area: "assessment",
    status: "recent",
    lastUsed: "Today, 8:40 AM",
    primaryAction: "Compare",
    secondary: "Assessment, risks, presentation view",
  },
  {
    id: "medication-prescribing",
    icon: Pill,
    area: "care",
    status: "review_due",
    lastUsed: "May 12, 2025",
    primaryAction: "Prescribe",
    secondary: "Monitoring, interactions, templates",
  },
  {
    id: "services",
    icon: appModeIcons.services,
    area: "coordination",
    status: "review_due",
    lastUsed: "Today, 8:15 AM",
    primaryAction: "Refer",
    secondary: "Access pathways, criteria, contacts",
  },
  {
    id: "ward-management",
    icon: Activity,
    area: "coordination",
    status: "ready",
    lastUsed: "Not yet opened",
    primaryAction: "Coordinate",
    secondary: "Patient flow, bed capacity, destination matching",
  },
  {
    id: "forms",
    icon: FileCheck2,
    area: "coordination",
    status: "ready",
    lastUsed: "Today, 8:05 AM",
    primaryAction: "Open",
    secondary: "Forms, tasks, pathway checks",
  },
  {
    id: "safety-plan",
    icon: ClipboardList,
    area: "care",
    status: "ready",
    lastUsed: "Today, 9:10 AM",
    primaryAction: "Open",
    secondary: "Warning signs, coping, supports, means safety",
  },
  {
    id: "calculators",
    icon: Calculator,
    area: "assessment",
    status: "ready",
    lastUsed: "Today, 9:20 AM",
    primaryAction: "Open",
    secondary: "Rating scales, severity bands, bedside scoring",
  },
  {
    // Identity comes from the shared catalogue; this entry exists so the mockup grid and
    // `route-reachability.test.ts` (which reads the exported `tools` array as a nav-builder
    // source) both see the workspace's front door.
    id: "caring-contacts",
    icon: HeartHandshake,
    area: "coordination",
    status: "ready",
    lastUsed: "Today, 7:55 AM",
    primaryAction: "Open",
    secondary: "Synthetic workspace, invented patients, nothing sent",
  },
  {
    id: "favourites",
    icon: Star,
    area: "personal",
    status: "recent",
    lastUsed: "Today, 8:45 AM",
    primaryAction: "Resume",
    secondary: "Saved items, recent work, pins",
    // The mockups keep the shorter historical framing for this entry.
    title: "Favourites",
    description: "Return to saved clinical work, sources, and repeated workflows.",
  },
];

export const tools: ToolFixture[] = fixtureExtras.map((extras) => {
  const record = toolCatalogRecordById(extras.id);
  return {
    id: record.id,
    title: extras.title ?? record.title,
    description: extras.description ?? record.description,
    href: record.href,
    sourceBacked: record.sourceBacked,
    icon: extras.icon,
    area: extras.area,
    status: extras.status,
    lastUsed: extras.lastUsed,
    primaryAction: extras.primaryAction,
    secondary: extras.secondary,
  };
});

export const pinnedToolIds = ["clinical-kb-search", "documents", "medication-prescribing", "services"] as const;

export const areaLabels: Record<ToolArea, string> = {
  assessment: "Assessment",
  care: "Treatment",
  coordination: "Coordination",
  personal: "Saved",
  reference: "Reference",
};

export const statusLabels: Record<ToolStatus, string> = {
  ready: "Ready",
  recent: "Recent",
  review_due: "Review due",
};

export const statusStyles: Record<ToolStatus, string> = {
  ready: "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
  recent: "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]",
  review_due: "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
};

export function toolById(id: string) {
  return tools.find((tool) => tool.id === id) ?? tools[0];
}
