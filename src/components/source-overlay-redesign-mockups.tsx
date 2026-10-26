import type { ReactNode } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  FolderOpen,
  Layers3,
  ListFilter,
  PanelRight,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/components/ui-primitives";

type Device = "desktop" | "phone";
type VariantTone = "scope" | "library" | "graphite";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const scopeFilters = [
  "Medication",
  "Topic",
  "Site",
  "Type",
  "Service",
  "Setting",
  "Population",
  "Risk",
  "Workflow",
  "Action",
];

const libraryFilters = ["Type", "Site", "Topic", "Population"];

const compactFilterValues = [
  "Lithium, clozapine",
  "ECT, safety plan",
  "FSH, RPBG",
  "Guideline, policy",
  "Mental health",
  "Inpatient, ED",
];

const sourceRows = [
  {
    title: "Lithium monitoring protocol",
    meta: "Therapeutic Guidelines - p.18 - table",
    status: "Current",
    tone: "success" as const,
    icon: Table2,
  },
  {
    title: "Clozapine prescribing guide",
    meta: "Local policy set - p.12 - monitoring",
    status: "Indexed",
    tone: "accent" as const,
    icon: FileText,
  },
  {
    title: "Safety planning pathway",
    meta: "Clinical repository - p.4 - checklist",
    status: "Review",
    tone: "warning" as const,
    icon: ShieldCheck,
  },
];

const designNotes = [
  "Reduce phone height to content plus scroll, not a full blank sheet.",
  "Move filters into compact groups so search stays visible.",
  "Keep desktop balanced with equal columns and clear empty states.",
];

function toneClass(tone: VariantTone) {
  if (tone === "library") {
    return {
      icon: "border-sky-200 bg-sky-50 text-sky-700",
      soft: "bg-sky-50 text-sky-800 border-sky-200",
      line: "border-sky-200",
    };
  }
  if (tone === "graphite") {
    return {
      icon: "border-slate-300 bg-slate-100 text-slate-800",
      soft: "bg-slate-100 text-slate-800 border-slate-300",
      line: "border-slate-300",
    };
  }
  return {
    icon: "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
    soft: "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
    line: "border-[color:var(--clinical-accent-border)]",
  };
}

function IconTile({
  icon: Icon,
  tone = "scope",
  compact = false,
}: {
  icon: LucideIcon;
  tone?: VariantTone;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg border shadow-[var(--shadow-inset)]",
        compact ? "h-8 w-8" : "h-10 w-10",
        toneClass(tone).icon,
      )}
    >
      <Icon className={cn(compact ? "h-4 w-4" : "h-5 w-5")} aria-hidden="true" />
    </span>
  );
}

function Pill({
  children,
  icon: Icon,
  active = false,
  tone = "scope",
  small = false,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  active?: boolean;
  tone?: VariantTone;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border font-bold leading-none shadow-[var(--shadow-inset)]",
        small ? "min-h-6 px-2 text-3xs" : "min-h-8 px-2.5 text-xs",
        active
          ? toneClass(tone).soft
          : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
      )}
    >
      {Icon ? <Icon className={cn("shrink-0", small ? "h-3 w-3" : "h-3.5 w-3.5")} aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function MockButton({
  children,
  icon: Icon,
  primary = false,
  tone = "scope",
}: {
  children: ReactNode;
  icon?: LucideIcon;
  primary?: boolean;
  tone?: VariantTone;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-extrabold transition",
        focusRing,
        primary
          ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_24px_rgb(15_23_42_/_18%)]"
          : activeToneButton(tone),
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function activeToneButton(tone: VariantTone) {
  if (tone === "library") return "border-sky-200 bg-sky-50 text-sky-800";
  if (tone === "graphite") return "border-slate-300 bg-slate-100 text-slate-800";
  return "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
}

function SearchField({ placeholder, compact = false }: { placeholder: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]",
        compact ? "min-h-9 px-2.5" : "min-h-11 px-3",
      )}
    >
      <Search className="h-4 w-4 text-[color:var(--text-soft)]" aria-hidden="true" />
      <span className={cn("truncate font-semibold text-[color:var(--text-soft)]", compact ? "text-xs" : "text-sm")}>
        {placeholder}
      </span>
    </div>
  );
}

function SelectField({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <label className="grid gap-1">
      <span className="truncate text-3xs font-extrabold uppercase text-[color:var(--text-muted)]">{label}</span>
      <span
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)] shadow-[var(--shadow-inset)]",
          compact ? "min-h-8 px-2 text-xs" : "min-h-10 px-3 text-sm",
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[color:var(--text-soft)]" aria-hidden="true" />
      </span>
    </label>
  );
}

function MiniFilterGrid({ device }: { device: Device }) {
  return (
    <div className={cn("grid gap-2", device === "desktop" ? "grid-cols-4" : "grid-cols-2")}>
      {compactFilterValues.slice(0, device === "desktop" ? 4 : 6).map((value, index) => (
        <SelectField key={value} label={scopeFilters[index]} value={value} compact={device === "phone"} />
      ))}
    </div>
  );
}

function EmptyState({
  title = "No indexed documents",
  body = "Upload a guideline to start indexing.",
  compact = false,
}: {
  title?: string;
  body?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)]",
        compact ? "p-3" : "p-4",
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
        <FileText className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">{title}</span>
        <span className="mt-0.5 block text-sm font-medium text-[color:var(--text-muted)]">{body}</span>
      </span>
    </div>
  );
}

function SourceRow({ row, compact = false }: { row: (typeof sourceRows)[number]; compact?: boolean }) {
  const Icon = row.icon;
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-extrabold text-[color:var(--text-heading)]",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {row.title}
        </span>
        <span className="mt-0.5 block truncate text-2xs font-semibold text-[color:var(--text-muted)]">{row.meta}</span>
      </span>
      <Pill small tone={row.tone === "accent" ? "scope" : row.tone === "warning" ? "graphite" : "library"} active>
        {row.status}
      </Pill>
    </div>
  );
}

function PanelHeader({
  title,
  description,
  icon,
  tone,
  device,
  count = "0 indexed",
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: VariantTone;
  device: Device;
  count?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", device === "phone" && "items-center")}>
      <div className="flex min-w-0 items-start gap-3">
        <IconTile icon={icon} tone={tone} compact={device === "phone"} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3
              className={cn(
                "truncate font-extrabold text-[color:var(--text-heading)]",
                device === "phone" ? "text-base" : "text-xl",
              )}
            >
              {title}
            </h3>
            {device === "desktop" ? <Pill small>{count}</Pill> : null}
          </div>
          <p
            className={cn(
              "mt-1 font-medium text-[color:var(--text-muted)]",
              device === "phone" ? "text-xs" : "text-sm",
            )}
          >
            {description}
          </p>
        </div>
      </div>
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function DesktopFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-[0_18px_44px_rgb(15_23_42_/_12%)]">
      <div className="mx-auto flex min-h-[26rem] w-full max-w-[45rem] flex-col overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--shadow-elevated)]">
        {children}
      </div>
    </div>
  );
}

function PhoneFrame({ children, shorter = true }: { children: ReactNode; shorter?: boolean }) {
  return (
    <div className="mx-auto w-[18rem] rounded-[1.75rem] border border-slate-300 bg-slate-950 p-2 shadow-[0_18px_44px_rgb(15_23_42_/_22%)]">
      <div
        className={cn(
          "overflow-hidden rounded-[1.35rem] border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
          shorter ? "h-[35rem]" : "h-[39rem]",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-[color:var(--border-strong)]" />
        {children}
      </div>
    </div>
  );
}

function MockupPair({
  label,
  intent,
  children,
}: {
  label: string;
  intent: string;
  children: (device: Device) => ReactNode;
}) {
  return (
    <article className="grid gap-4 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface)] p-4 shadow-[var(--e1)]">
      <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <h2 className="text-xl font-extrabold text-[color:var(--text-heading)]">{label}</h2>
          <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">{intent}</p>
        </div>
        <span className="w-fit rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-1 text-2xs font-extrabold uppercase text-[color:var(--text-muted)]">
          Desktop + phone
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <DesktopFrame>{children("desktop")}</DesktopFrame>
        <PhoneFrame>{children("phone")}</PhoneFrame>
      </div>
    </article>
  );
}

function ScopeControlStrip({ device }: { device: Device }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[color:var(--border)] p-4">
        <PanelHeader
          title="Document scope"
          description="Choose source boundaries before search."
          icon={Filter}
          tone="scope"
          device={device}
          count="0 available"
        />
      </div>
      <div className={cn("grid flex-1 gap-3 bg-[color:var(--surface-subtle)]", device === "desktop" ? "p-4" : "p-3")}>
        <section className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase text-[color:var(--text-muted)]">Scope</p>
            <Pill small active tone="scope">
              All documents
            </Pill>
          </div>
          <SearchField placeholder="Filter documents by title or file" compact={device === "phone"} />
          <div className="flex flex-wrap gap-2">
            <Pill active tone="scope">
              All documents
            </Pill>
            <Pill icon={Clock3}>Recently updated</Pill>
            <Pill icon={CheckCircle2}>Pinned first</Pill>
          </div>
        </section>
        <section className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase text-[color:var(--text-muted)]">Refine</p>
            <Pill small icon={ListFilter}>
              10 filters
            </Pill>
          </div>
          <MiniFilterGrid device={device} />
          {device === "desktop" ? (
            <div className="flex justify-end">
              <MockButton icon={X}>Clear refine filters</MockButton>
            </div>
          ) : null}
        </section>
        <EmptyState
          title="No documents in this scope"
          body="Clear a filter or search by file name."
          compact={device === "phone"}
        />
      </div>
    </div>
  );
}

function ScopeSplitWorkbench({ device }: { device: Device }) {
  const isDesktop = device === "desktop";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[color:var(--border)] p-4">
        <PanelHeader
          title="Document scope"
          description="Search first, refine only when needed."
          icon={PanelRight}
          tone="graphite"
          device={device}
          count="2 selected"
        />
      </div>
      <div
        className={cn(
          "grid flex-1 gap-3 bg-[color:var(--surface-subtle)] p-3",
          isDesktop && "grid-cols-[1.25fr_.85fr] p-4",
        )}
      >
        <section className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <SearchField placeholder="Search loaded documents" compact={device === "phone"} />
          <div className="grid gap-2">
            {sourceRows.slice(0, isDesktop ? 3 : 2).map((row) => (
              <SourceRow key={row.title} row={row} compact={device === "phone"} />
            ))}
          </div>
        </section>
        <section className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase text-[color:var(--text-muted)]">Filter set</p>
            <Pill small active tone="graphite">
              Compact
            </Pill>
          </div>
          <div className="grid gap-2">
            <SelectField label="Mode" value="Auto" compact={device === "phone"} />
            <SelectField label="Status" value="Any status" compact={device === "phone"} />
            <SelectField label="Locality" value="Any locality" compact={device === "phone"} />
          </div>
          <div className="flex flex-wrap gap-2">
            {scopeFilters.slice(0, isDesktop ? 7 : 4).map((filter) => (
              <Pill key={filter} small>
                {filter}
              </Pill>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScopeFacetRail({ device }: { device: Device }) {
  const isDesktop = device === "desktop";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[color:var(--border)] p-4">
        <PanelHeader
          title="Document scope"
          description="Facet rail keeps dense controls symmetrical."
          icon={SlidersHorizontal}
          tone="library"
          device={device}
          count="0 available"
        />
      </div>
      <div
        className={cn(
          "grid flex-1 gap-3 bg-[color:var(--surface-subtle)] p-3",
          isDesktop && "grid-cols-[12rem_minmax(0,1fr)] p-4",
        )}
      >
        <section
          className={cn(
            "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2.5",
            isDesktop ? "grid content-start gap-2" : "flex gap-2 overflow-hidden",
          )}
        >
          {scopeFilters.slice(0, isDesktop ? 8 : 5).map((filter, index) => (
            <button
              key={filter}
              type="button"
              className={cn(
                "grid min-h-9 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2 text-left text-xs font-extrabold",
                index === 0
                  ? toneClass("library").soft
                  : "border-transparent bg-transparent text-[color:var(--text-muted)]",
                !isDesktop && "min-w-[7.5rem]",
              )}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              <span className="truncate">{filter}</span>
            </button>
          ))}
        </section>
        <section className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <SearchField placeholder="Filter documents by title or file" compact={device === "phone"} />
          <div className={cn("grid gap-2", isDesktop ? "grid-cols-3" : "grid-cols-2")}>
            <SelectField label="Medication" value="Lithium" compact={device === "phone"} />
            <SelectField label="Topic" value="Monitoring" compact={device === "phone"} />
            {isDesktop ? <SelectField label="Risk" value="High-risk" compact={false} /> : null}
          </div>
          <EmptyState
            title="No documents match"
            body="The scope can stay short until matching files exist."
            compact={device === "phone"}
          />
        </section>
      </div>
    </div>
  );
}

function LibraryCompactSheet({ device }: { device: Device }) {
  const isDesktop = device === "desktop";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[color:var(--border)] p-4">
        <PanelHeader
          title="Source library"
          description="Browse indexed sources without a tall blank panel."
          icon={FolderOpen}
          tone="library"
          device={device}
          count="0 indexed"
        />
      </div>
      <div className={cn("grid flex-1 content-start gap-3 bg-[color:var(--surface-subtle)] p-3", isDesktop && "p-4")}>
        <section
          className={cn(
            "grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3",
            isDesktop && "grid-cols-[minmax(0,1fr)_auto] items-center",
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-[color:var(--text-heading)]">Source library</p>
            <p className="mt-0.5 text-xs font-semibold text-[color:var(--text-muted)]">0 matching documents.</p>
          </div>
          <Pill small active tone="library">
            0 shown
          </Pill>
        </section>
        <SearchField placeholder="Find a document" compact={device === "phone"} />
        <div className={cn("grid gap-2", isDesktop ? "grid-cols-4" : "grid-cols-2")}>
          {libraryFilters.map((filter) => (
            <SelectField key={filter} label={filter} value={`All ${filter}s`} compact={device === "phone"} />
          ))}
        </div>
        <EmptyState compact={device === "phone"} />
      </div>
    </div>
  );
}

function LibraryStatusSplit({ device }: { device: Device }) {
  const isDesktop = device === "desktop";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[color:var(--border)] p-4">
        <PanelHeader
          title="Source library"
          description="Separate source status from file browsing."
          icon={Layers3}
          tone="graphite"
          device={device}
          count="2,065 indexed"
        />
      </div>
      <div
        className={cn(
          "grid flex-1 gap-3 bg-[color:var(--surface-subtle)] p-3",
          isDesktop && "grid-cols-[13rem_minmax(0,1fr)] p-4",
        )}
      >
        <section className="grid content-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <p className="text-xs font-extrabold uppercase text-[color:var(--text-muted)]">Status</p>
          <Pill active tone="graphite" icon={CheckCircle2}>
            Indexed
          </Pill>
          <Pill icon={Clock3}>Recent</Pill>
          <Pill icon={UploadCloud}>Needs indexing</Pill>
          <Pill icon={ShieldCheck}>Review due</Pill>
        </section>
        <section className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
          <SearchField placeholder="Find source, PDF, or page" compact={device === "phone"} />
          <div className="grid gap-2">
            {sourceRows.slice(0, isDesktop ? 3 : 2).map((row) => (
              <SourceRow key={row.title} row={row} compact={device === "phone"} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function LibraryCommandPalette({ device }: { device: Device }) {
  const isDesktop = device === "desktop";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[color:var(--border)] p-4">
        <PanelHeader
          title="Source library"
          description="Fast command palette for opening exact files."
          icon={BookOpen}
          tone="scope"
          device={device}
          count="Quick open"
        />
      </div>
      <div className={cn("grid flex-1 content-start gap-3 bg-[color:var(--surface-subtle)] p-3", isDesktop && "p-5")}>
        <section className="mx-auto grid w-full max-w-2xl gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[var(--e1)]">
          <SearchField placeholder="Type document title, file name, or tag" compact={device === "phone"} />
          <div className="flex flex-wrap gap-2">
            <Pill active tone="scope" icon={ExternalLink}>
              Open PDF
            </Pill>
            <Pill icon={Table2}>Tables</Pill>
            <Pill icon={ShieldCheck}>Current</Pill>
          </div>
          <div className="grid gap-2">
            {sourceRows.slice(0, isDesktop ? 3 : 2).map((row) => (
              <SourceRow key={row.title} row={row} compact={device === "phone"} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function SourceOverlayRedesignMockups() {
  return (
    <main className="min-h-dvh bg-[color:var(--surface-subtle)] px-4 py-6 text-[color:var(--text)] sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[92rem] gap-6">
        <header className="grid gap-4 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface)] p-4 shadow-[var(--e1)] lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase text-[color:var(--clinical-accent)]">
              Source overlay review
            </p>
            <h1 className="mt-2 text-3xl font-black text-[color:var(--text-heading)]">
              Compact source and scope mockups
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">
              Six redesign options for the two oversized popups. Every option keeps the desktop and phone treatment in
              one comparison so proportion, symmetry, and sheet height can be judged together.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3">
            {designNotes.map((note) => (
              <div
                key={note}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-xs font-bold text-[color:var(--text-muted)]"
              >
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-[color:var(--clinical-accent)]" aria-hidden="true" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </header>

        <section data-testid="document-scope-redesign-mockups" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase text-[color:var(--text-soft)]">Set 1</p>
              <h2 className="text-2xl font-black text-[color:var(--text-heading)]">Document scope</h2>
            </div>
            <Pill icon={Filter} active tone="scope">
              3 alternatives
            </Pill>
          </div>
          <MockupPair
            label="A. Control strip"
            intent="Best default: search stays visible, filters are grouped, and the phone sheet stops below the full viewport."
          >
            {(device) => <ScopeControlStrip device={device} />}
          </MockupPair>
          <MockupPair
            label="B. Split workbench"
            intent="Best for heavier source sets: results and filters are balanced into two clear work areas."
          >
            {(device) => <ScopeSplitWorkbench device={device} />}
          </MockupPair>
          <MockupPair
            label="C. Facet rail"
            intent="Best for dense metadata: categories move into a compact rail instead of a long vertical form."
          >
            {(device) => <ScopeFacetRail device={device} />}
          </MockupPair>
        </section>

        <section data-testid="source-library-redesign-mockups" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase text-[color:var(--text-soft)]">Set 2</p>
              <h2 className="text-2xl font-black text-[color:var(--text-heading)]">Source library</h2>
            </div>
            <Pill icon={FolderOpen} active tone="library">
              3 alternatives
            </Pill>
          </div>
          <MockupPair
            label="A. Compact sheet"
            intent="Best default: removes the huge blank lower half and keeps search, filters, and empty state in one balanced stack."
          >
            {(device) => <LibraryCompactSheet device={device} />}
          </MockupPair>
          <MockupPair
            label="B. Status split"
            intent="Best for operational review: source health and browse actions are separate, scan-friendly zones."
          >
            {(device) => <LibraryStatusSplit device={device} />}
          </MockupPair>
          <MockupPair
            label="C. Command palette"
            intent="Best for fast opening: a focused search-first layout with source rows as the primary decision surface."
          >
            {(device) => <LibraryCommandPalette device={device} />}
          </MockupPair>
        </section>
      </div>
    </main>
  );
}
