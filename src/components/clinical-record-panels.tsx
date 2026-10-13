import { ChevronDown, TriangleAlert, Waypoints, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { cn, eyebrowText } from "@/components/ui-primitives";

/**
 * Presentation blocks shared by the clinical record families (formulation
 * mechanisms, specifiers). The families own their own data, copy, and shells,
 * but their record facts, guidance accordions, pathway strips, and compare links
 * are the same design-system surface, so they live here rather than being
 * re-typed per family and drifting apart.
 */
export function RecordFact({ icon: Icon, label, body }: { icon: LucideIcon; label: string; body: string }) {
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-4 py-3.5">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span>
        <span className="block text-xs font-bold text-[color:var(--text-heading)]">{label}</span>
        <span className="mt-0.5 block text-xs font-medium leading-5 text-[color:var(--text-muted)]">{body}</span>
      </span>
    </div>
  );
}

export function GuidanceSection({
  icon: Icon,
  title,
  items,
  tone = "default",
  open = false,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
  tone?: "default" | "success" | "warning";
  open?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-[color:var(--success)] bg-[color:var(--success-soft)]"
      : tone === "warning"
        ? "text-[color:var(--warning)] bg-[color:var(--warning-soft)]"
        : "text-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]";

  return (
    <details open={open} className="group border-b border-[color:var(--border)] last:border-b-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", toneClass)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm font-extrabold text-[color:var(--text-heading)]">{title}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] transition group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="px-4 pb-4 pl-[4.25rem] sm:px-5 sm:pb-5 sm:pl-[4.75rem]">
        <ul className="grid gap-2.5 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
          {items.map((item) => (
            <li key={item} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[color:var(--clinical-accent)]" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** Numbered "work through it in this order" strip on a mode home page. */
export function ClinicalPathwayStrip({
  id,
  eyebrow,
  title,
  steps,
}: {
  id: string;
  eyebrow: string;
  title: string;
  steps: Array<{ label: string; body: string }>;
}) {
  const titleId = `${id}-title`;
  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-left shadow-[var(--shadow-inset)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-2.5">
        <div>
          <p className={eyebrowText}>{eyebrow}</p>
          <h2 id={titleId} className="mt-0.5 text-sm font-extrabold text-[color:var(--text-heading)]">
            {title}
          </h2>
        </div>
        <Waypoints className="h-5 w-5 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
      </div>
      <ol className="grid sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={cn(
              "relative grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 px-4 py-3",
              index > 0 && "border-t border-[color:var(--border)] sm:border-t-0",
              index % 2 === 1 && "sm:border-l sm:border-[color:var(--border)]",
              index === 2 && "lg:border-l lg:border-[color:var(--border)]",
            )}
          >
            <span className="nums grid h-8 w-8 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-xs font-extrabold text-[color:var(--clinical-accent)]">
              {index + 1}
            </span>
            <span>
              <span className="block text-sm font-bold text-[color:var(--text-heading)]">{step.label}</span>
              <span className="mt-0.5 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Link into a family's side-by-side compare view, optionally pre-picking the right-hand record. */
export function compareRecordsHref(basePath: string, left: string, right?: string) {
  const params = new URLSearchParams({ a: left });
  if (right) params.set("b", right);
  return `${basePath}?${params.toString()}`;
}

/*
 * Record body primitives: the one layout every Clinical record body shares.
 *
 * Modelled on the Factsheet record (the cleanest page in Clinical): the name,
 * one plain line and key tags; one row of the record's own actions; one calm
 * "At a glance" card with every value in full; cautions straight after, in
 * full; then sections as plain headings with the content below; sources,
 * related and compare-next at the end. Record families keep their own data,
 * copy and behaviour and only compose these blocks, so the record types stop
 * drifting into separate page designs.
 *
 * None of these own the record top bar, record nav bar, tabs or Back button.
 */

/** The record body column: one even rhythm between every block. */
export function RecordBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-7", className)}>{children}</div>;
}

/**
 * Name, one plain line, key tags, then the record's action row.
 *
 * `eyebrow` is the record family or category, in the record's own words.
 * `meta` carries anything the record already showed beside its tags (aliases,
 * review status). `actions` is the record's existing Favourite / Compare / Copy
 * controls, in one row under the title — never new actions.
 */
export function RecordIntro({
  eyebrow,
  title,
  line,
  meta,
  tags,
  actions,
  titleId,
  testId,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  line?: ReactNode;
  meta?: ReactNode;
  tags?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <header data-testid={testId} className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="m-0 text-xs font-semibold text-[color:var(--text-muted)]">{eyebrow}</p> : null}
        <h1
          id={titleId}
          className="m-0 mt-1 text-balance break-words text-2xl font-bold tracking-tight text-[color:var(--text-heading)]"
        >
          {title}
        </h1>
        {line ? (
          <p className="m-0 mt-2 max-w-[66ch] text-pretty text-base leading-7 text-[color:var(--text-muted)]">{line}</p>
        ) : null}
      </div>
      {meta ? <div className="min-w-0">{meta}</div> : null}
      {tags ? <div className="flex min-w-0 flex-wrap items-center gap-2">{tags}</div> : null}
      {children}
      {actions ? <RecordActions>{actions}</RecordActions> : null}
    </header>
  );
}

/** One row for the record's Favourite / Compare / Copy actions. */
export function RecordActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-record-actions="" className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

export type RecordGlanceFact = {
  key?: string;
  label: string;
  value: ReactNode;
  /** Span the full card width. Long string values do this automatically. */
  wide?: boolean;
};

const GLANCE_WIDE_CHARS = 40;

/**
 * The one "At a glance" card: a calm tinted hairline card of label/value
 * pairs. Values are always shown in full — no "Tap for detail" truncation.
 * Two columns from 22rem, so the large-text setting falls back to one.
 */
export function RecordGlance({
  facts,
  title = "At a glance",
  id,
  testId,
  footer,
}: {
  facts: RecordGlanceFact[];
  title?: string;
  id?: string;
  testId?: string;
  footer?: ReactNode;
}) {
  const shown = facts.filter((fact) => fact.value !== null && fact.value !== undefined && fact.value !== "");
  if (!shown.length && !footer) return null;
  return (
    <section
      id={id}
      data-testid={testId}
      aria-label={title}
      className={cn(
        inPageAnchor,
        "rounded-2xl border border-[color:var(--clinical-accent-border)] bg-[color:color-mix(in_srgb,var(--clinical-accent-soft)_55%,var(--surface))] p-5",
      )}
    >
      <h2 className="m-0 text-xs font-bold text-[color:var(--clinical-accent)]">{title}</h2>
      {shown.length ? (
        <dl className="m-0 mt-3.5 grid grid-cols-1 gap-x-5 gap-y-4 min-[22rem]:grid-cols-2">
          {shown.map((fact) => {
            const wide = fact.wide ?? (typeof fact.value === "string" && fact.value.length > GLANCE_WIDE_CHARS);
            return (
              <div
                key={fact.key ?? fact.label}
                className={cn("flex min-w-0 flex-col gap-0.5", wide && "min-[22rem]:col-span-2")}
              >
                <dt className="text-xs text-[color:var(--text-muted)]">{fact.label}</dt>
                <dd className="m-0 break-words text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
                  {fact.value}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}

/**
 * Cautions, directly after At a glance, in full. A flat warning-tinted hairline
 * card — no coloured side bar — carrying the record's existing caution content.
 */
export function RecordCautions({
  title = "Cautions",
  id,
  testId,
  children,
}: {
  title?: ReactNode;
  id?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={cn(
        inPageAnchor,
        "rounded-2xl border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] p-5 text-[color:var(--warning-text)]",
      )}
    >
      <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[color:var(--warning-text)]">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        {title}
      </h2>
      <div className="mt-2 min-w-0 text-sm leading-6">{children}</div>
    </section>
  );
}

/**
 * One record section: a plain heading with the content below, the Factsheet
 * style. Longer sections fold with the record's existing expand pattern inside
 * `children`; this owns only the heading and the spacing.
 */
export function RecordSection({
  title,
  id,
  testId,
  action,
  className,
  children,
  headingLevel = "h2",
  headingId,
}: {
  title: ReactNode;
  id?: string;
  testId?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  headingLevel?: "h2" | "h3";
  headingId?: string;
}) {
  const Heading = headingLevel;
  return (
    <section
      id={id}
      data-testid={testId}
      aria-labelledby={headingId}
      className={cn(inPageAnchor, "min-w-0", className)}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading id={headingId} className="m-0 text-lg font-bold tracking-tight text-[color:var(--text-heading)]">
          {title}
        </Heading>
        {action}
      </div>
      <div className="mt-2 min-w-0">{children}</div>
    </section>
  );
}
