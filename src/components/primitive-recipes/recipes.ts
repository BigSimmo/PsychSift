import type { MouseEvent } from "react";

export { cn } from "@/lib/cn";

/**
 * The click handler for an `aria-disabled` placeholder — a control whose feature
 * is not built yet, or whose action needs data this record does not have.
 *
 * Those controls carry `aria-disabled="true"` rather than the native `disabled`
 * attribute, because `disabled` takes a button out of the tab order: a keyboard
 * user (and a screen-reader user moving by Tab rather than by virtual cursor)
 * can never land on it, so the `title` and the `aria-describedby` reason we went
 * to the trouble of writing are never reached. `aria-disabled` keeps the tab
 * stop and the announcement — "dimmed"/"unavailable" plus the description — and
 * moves the job of doing nothing to this handler.
 *
 * It stops propagation as well as preventing the default, because that is what
 * the native attribute did: a disabled button fires no click at all, so nothing
 * bubbled to a clickable ancestor. Without `stopPropagation` a placeholder
 * inside a clickable row would start activating the row.
 */
export function ignoreUnavailableActivation(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

export const transitionSurface = "transition-colors transition-shadow motion-reduce:transition-none";
export const transitionTransform = "transition-transform motion-reduce:transform-none";

export const textMuted = "text-[color:var(--text-muted)]";
export const raisedCard = "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]";
export const appBackdrop = "app-edge-backdrop";
export const glassOverlaySurface =
  "border border-[color:var(--border-lux)] ring-1 ring-[color:var(--surface-highlight)] backdrop-blur-xl";
export const toggleThumbSurface = "bg-[color:var(--surface-raised)]";
export const panelSubtle =
  "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)] forced-colors:border";
export const answerSurface = "rounded-lg bg-transparent";
export const panel =
  "rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--e2)] ring-1 ring-[color:var(--ring-highlight)]";
// Disabled is ENCODED, not faded. `opacity-50` dims the label and the fill
// together, so a disabled primary stayed a large saturated block that still read
// as available, and a disabled secondary's label dropped below 4.5:1. Instead:
// flatten the fill to --surface-subtle, put the label on --disabled, drop the
// shadow, and remove the press affordance. `!` is required because the variant
// classes that follow this base would otherwise win on source order.
// The `aria-disabled:` half is not belt-and-braces: an unavailable placeholder
// carries `aria-disabled="true"` and no native attribute (see
// `ignoreUnavailableActivation`), so without these the control would lose the
// whole encoding and render as available. The `!` also does a second job here —
// it outranks the un-suffixed `hover:` colours these recipes ship, which a
// native `disabled` control never reaches but an `aria-disabled` one does.
export const controlDisabled =
  "disabled:cursor-not-allowed disabled:border-[color:var(--border)] disabled:bg-[color:var(--surface-subtle)]! disabled:text-[color:var(--disabled)]! disabled:shadow-none! disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:border-[color:var(--border)] aria-disabled:bg-[color:var(--surface-subtle)]! aria-disabled:text-[color:var(--disabled)]! aria-disabled:shadow-none! aria-disabled:active:translate-y-0";
export const controlBase = `inline-flex min-h-tap items-center justify-center gap-2 rounded-lg text-sm font-semibold transition active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border ${controlDisabled}`;
export const primaryControl = `${controlBase} bg-[color:var(--command)] px-5 text-[color:var(--command-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--command-hover)] hover:shadow-[var(--shadow-hover)]`;
export const floatingControl = `inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] px-3 text-sm font-semibold text-[color:var(--text)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border ${controlDisabled}`;
export const toolbarButton = `grid h-tap w-tap shrink-0 place-items-center rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border ${controlDisabled}`;
// Eyebrows are text (section kickers), so they sit on `--text-muted` (≥4.5:1),
// never the decoration tier. Uppercase + tracking keep the kicker role.
export const eyebrowText = "text-2xs font-semibold uppercase leading-4 tracking-label text-[color:var(--text-muted)]";
// A field label is a text node, so it cannot use `--text-soft` (3.07:1) or the
// uppercase eyebrow treatment: weight said "important" while colour said
// "secondary", and the label was quieter than the value it described. Sentence
// case, label weight, full-strength ink.
export const fieldLabel = "mb-1.5 block text-sm font-medium leading-5 text-[color:var(--text)]";
export const fieldControl =
  "field-control h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-sm text-[color:var(--text)] shadow-[var(--shadow-inset)] outline-none transition placeholder:text-[color:var(--text-placeholder)] forced-colors:border aria-[invalid=true]:border-[color:var(--danger)] aria-[invalid=true]:bg-[color:var(--danger-soft)] aria-[invalid=true]:text-[color:var(--danger)] disabled:cursor-not-allowed disabled:border-[color:var(--border)] disabled:bg-[color:var(--surface-inset)] disabled:text-[color:var(--disabled)] disabled:shadow-none read-only:cursor-default read-only:bg-[color:var(--surface-subtle)] read-only:text-[color:var(--text-muted)] read-only:shadow-none";
export const fieldControlWithIcon = `${fieldControl} pl-9 pr-3`;
export const fieldControlPlain = `${fieldControl} px-3`;
export const fieldIcon =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--decoration-soft)]";
export const shellChip =
  "inline-flex min-h-tap items-center gap-2 rounded-lg border px-3 text-xs font-semibold shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)]";
export const navPill = `inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] px-3 text-xs font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border ${controlDisabled}`;
const metadataPillBase =
  "inline-flex items-center rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]";
export const metadataPillDensity = {
  compact: `${metadataPillBase} min-h-6 px-2 text-2xs`,
  dense: `${metadataPillBase} min-h-7 px-2 text-2xs`,
  standard: `${metadataPillBase} min-h-7 px-2 text-xs`,
  roomyCompact: `${metadataPillBase} min-h-8 px-2.5 text-2xs`,
  comfortable: `${metadataPillBase} min-h-8 px-2.5 text-xs`,
  roomy: `${metadataPillBase} min-h-8 px-3 text-xs`,
  tap: `${metadataPillBase} min-h-tap px-3 text-xs`,
  // DS-P2-24: metadata/disclosure only — 48px phone, 40px compact-meta from `sm`. Not a primary CTA.
  interactiveCompact: `${metadataPillBase} min-h-tap px-2.5 text-2xs sm:min-h-compact-meta sm:px-3`,
} as const;
/** Standard metadata density. Use `metadataPillDensity` when a different named density is intentional. */
export const metadataPill = metadataPillDensity.standard;
export const subtleStatusPill =
  "inline-flex min-h-7 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-wash)] px-2 text-xs font-semibold text-[color:var(--text-muted)]";
export const clinicalDivider = "border-t border-[color:var(--border)]/80";
export const iconTilePremium =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
// Comfortable reading measure for long-form prose (answers, source passages, document text).
export const proseMeasure = "max-w-[68ch]";
// Geist Mono for clinical codes and identifiers: citation/source indices, page and
// chunk numbers, guideline versions, document IDs. Pairs with tabular figures.
export const codeText = "font-mono tabular-nums tracking-tight";

export const tableCard =
  "overflow-hidden rounded-lg border border-[color:var(--border)]/80 bg-[color:var(--surface)] shadow-[var(--e1)]";
export const tableCardHeader =
  "border-b border-[color:var(--border)] bg-[color:var(--clinical-chat-table-header)] px-3 py-2.5 text-sm font-semibold text-[color:var(--text-heading)]";
// DS-P2-24: table micro-actions — compact-meta from `sm`, never `--row-compact` (36px) as tap.
export const tableMicroActionRow =
  "flex min-h-tap flex-wrap items-center gap-1 border-t border-[color:var(--border)] px-2 py-1.5 text-xs font-semibold text-[color:var(--text-muted)] sm:min-h-compact-meta";
export const sidebarItem = `flex min-h-tap min-w-0 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 text-sm font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] ${controlDisabled}`;

export const toneSuccess =
  "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]";
export const toneDanger =
  "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
export const toneInfo = "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]";
export const toneWarning =
  "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
export const toneNeutral =
  "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]";

// Canonical content-page width. Detail pages (service / form / differential),
// medication record + prescribing workspace, and the forms results view converge
// on this so the reading measure is one source of truth instead of a scatter of
// `mx-auto max-w-7xl` literals. Width only — call sites keep their own padding and
// vertical rhythm via cn(). Intentionally-wider surfaces (the document viewer's
// 1440px viewer+rail, the differentials tables) keep their bespoke widths.
// From 1024px the column narrows to Work's 64rem (`--clinical-col`,
// clinical-mode.css) so the page lines up with the title and tabs above it; the
// extra 4rem is the `lg:px-8` gutter the call sites draw inside it.
export const pageContainer = "mx-auto w-full max-w-7xl lg:max-w-[calc(var(--clinical-col)+4rem)]";

export type SemanticChipTone = "danger" | "info" | "warning" | "success" | "neutral";

export function semanticChipTone(tone: SemanticChipTone | undefined | null) {
  if (tone === "danger") return toneDanger;
  if (tone === "info") return toneInfo;
  if (tone === "warning") return toneWarning;
  if (tone === "success") return toneSuccess;
  return toneNeutral;
}
