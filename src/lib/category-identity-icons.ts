import {
  Activity,
  BookMarked,
  BookOpenCheck,
  BookOpenText,
  BrainCircuit,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileCheck2,
  FileSignature,
  FileText,
  Heart,
  HeartHandshake,
  MessagesSquare,
  Network,
  Pill,
  Route,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  Users,
  Waves,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";

import type { CategoryIconKey } from "@/lib/category-identity";

/**
 * The single string-key → Lucide resolution for category identity.
 *
 * The keys live in `src/lib/category-identity.ts` so data and server modules can
 * name a glyph without importing `lucide-react`; this file is the only place
 * that binds them to components. `factsheets-icons.ts` established the pattern.
 */
const categoryIcons: Record<CategoryIconKey, LucideIcon> = {
  activity: Activity,
  sparkles: Sparkles,
  fileText: FileText,
  route: Route,
  fileSignature: FileSignature,
  heart: Heart,
  heartHandshake: HeartHandshake,
  brainCircuit: BrainCircuit,
  bookOpenCheck: BookOpenCheck,
  tags: Tags,
  network: Network,
  pill: Pill,
  wrench: Wrench,
  calculator: Calculator,
  compass: Compass,
  bookOpenText: BookOpenText,
  bookMarked: BookMarked,
  search: Search,
  scrollText: ScrollText,
  shieldCheck: ShieldCheck,
  users: Users,
  fileCheck2: FileCheck2,
  clipboardCheck: ClipboardCheck,
  clipboardList: ClipboardList,
  waves: Waves,
  star: Star,
  chat: MessagesSquare,
};

/** Component form, for the call sites that still take a `LucideIcon` prop. */
export function categoryIconComponent(icon: CategoryIconKey): LucideIcon {
  return categoryIcons[icon];
}

/**
 * Render a glyph without binding a capitalised component to a render-body local,
 * which `react-hooks/static-components` forbids.
 */
export function categoryGlyph(icon: CategoryIconKey, className: string) {
  return createElement(categoryIcons[icon], { className, "aria-hidden": "true" });
}
