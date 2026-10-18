import { Ban, Landmark, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  extractionQualityLabel,
  formatClinicalDate,
  normalizeSourceMetadata,
  sourceDesignationDescription,
  sourceDesignationLabel,
  sourceStatusLabel,
  validationStatusLabel,
} from "@/lib/source-metadata";
import { classifySourceAuthority } from "@/lib/source-authority-registry";
import type { ClinicalSourceMetadata } from "@/lib/types";
import { cn, panelSubtle, toneDanger, toneInfo, toneSuccess, toneWarning } from "./recipes";

/**
 * What the source badges accept. Previously `unknown`, which meant the `.d.ts`
 * published to the design system promised a typed shape TypeScript refused to
 * enforce — so `{ validation_status: … }` (the wrong key; the real one is
 * `clinical_validation_status`) compiled cleanly and silently fell back, and an
 * off-vocabulary value reached the normalizer at runtime instead of at build
 * time. `Partial` because every field is genuinely optional on legacy rows;
 * `null` because that is what a missing join returns.
 */
export type SourceMetadataInput = Partial<ClinicalSourceMetadata> | null;

export const sourceCard = `${panelSubtle} transition hover:border-[color:var(--border-strong)] hover:shadow-[var(--e3)]`;
// Answer "Sources" capsule. `sourceCapsuleHit` is an invisible tap-sized WCAG touch
// target that wraps the compact visible pill `sourceCapsule` (`.source-capsule-face`),
// so the control reads smaller and lighter without shrinking the tap area. Hover,
// expanded, and focus chrome are driven from the hit target's :hover /
// [aria-expanded] / :focus-visible in globals.css (@layer components).
export const sourceCapsuleHit =
  "source-capsule-hit inline-flex min-h-tap w-fit items-center justify-center rounded-full outline-none";
export const sourceCapsule =
  "source-capsule-face inline-flex items-center gap-1.5 rounded-full border bg-[color-mix(in_srgb,var(--clinical-accent-soft)_55%,var(--surface))] px-2.5 py-1 text-2xs font-medium text-[color:var(--clinical-accent)]";
export const sourceCapsuleCountBadge =
  "nums inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--surface-raised)] px-1 text-3xs font-semibold leading-none text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]";

const compactMetadataRow =
  "mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold tabular-nums text-[color:var(--text-muted)]";
const statusMarkerBase = "inline-block h-2 w-2 shrink-0";
export const statusDotReady = `${statusMarkerBase} rounded-full border-2 border-[color:var(--text-heading)] bg-transparent`;
export const statusDotReview = `${statusMarkerBase} rotate-45 rounded-sm bg-[color:var(--warning)]`;
export const statusDotMuted = `${statusMarkerBase} rounded-full bg-[color:var(--decoration-soft)]`;
export type StatusDotTone = "ready" | "review" | "muted";
const STATUS_DOT_CLASS = {
  ready: statusDotReady,
  review: statusDotReview,
  muted: statusDotMuted,
} as const;

export function StatusDotMarker({
  tone,
  label,
  labelClassName,
}: {
  tone: StatusDotTone;
  label: string;
  labelClassName?: string;
}) {
  return (
    <>
      <span className={STATUS_DOT_CLASS[tone]} aria-hidden="true" />
      <span className={labelClassName}>{label}</span>
    </>
  );
}

const toneWarningQuiet =
  "border-[color:var(--warning-border)]/60 bg-[color:var(--warning-soft)]/45 text-[color:var(--warning)]";

export type SourceDesignationBadgeProps = {
  metadata?: SourceMetadataInput;
  className?: string;
};

export function SourceDesignationBadge({ metadata, className }: SourceDesignationBadgeProps) {
  const source = normalizeSourceMetadata(metadata);
  const classification = classifySourceAuthority(source);
  const toneClassName =
    classification.designation === "official"
      ? toneSuccess
      : classification.designation === "trusted"
        ? toneInfo
        : toneWarningQuiet;
  const Icon =
    classification.designation === "official"
      ? Landmark
      : classification.designation === "trusted"
        ? ShieldCheck
        : TriangleAlert;

  return (
    <span
      title={sourceDesignationDescription(source)}
      aria-label={`Source designation: ${sourceDesignationLabel(classification.designation)}. ${sourceDesignationDescription(source)}`}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold",
        toneClassName,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {sourceDesignationLabel(classification.designation)}
    </span>
  );
}

export type SourceStatusBadgeProps = {
  metadata?: SourceMetadataInput;
  className?: string;
  showTitle?: boolean;
};

export function SourceStatusBadge({ metadata, className, showTitle = true }: SourceStatusBadgeProps) {
  const source = normalizeSourceMetadata(metadata);
  const status = source.document_status;
  const toneClassName =
    status === "current"
      ? toneSuccess
      : status === "outdated"
        ? toneDanger
        : status === "review_due"
          ? toneWarning
          : toneWarningQuiet;
  // Danger/warning states carry an icon so they stay distinguishable without
  // colour (forced-colors, fast scanning). "Current" stays quiet and iconless.
  const Icon = status === "outdated" ? Ban : status === "current" ? null : TriangleAlert;

  return (
    <span
      title={showTitle ? sourceStatusLabel(source) : undefined}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold",
        toneClassName,
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {sourceStatusLabel(source)}
    </span>
  );
}

export type SourceProvenanceProps = { metadata?: SourceMetadataInput };

export function SourceProvenance({ metadata }: SourceProvenanceProps) {
  const source = normalizeSourceMetadata(metadata);
  const reviewDate = formatClinicalDate(source.review_date);
  // Unknown review date / jurisdiction segments are dropped as filler; the
  // validation and extraction-quality labels always stay — they are clinical
  // governance signals, not noise.
  const items = [
    sourceDesignationLabel(classifySourceAuthority(source).designation),
    validationStatusLabel(source),
    reviewDate === "Unknown" ? null : `Review ${reviewDate}`,
    source.jurisdiction,
    extractionQualityLabel(source),
  ].filter((item): item is string => Boolean(item));

  return (
    <div className={compactMetadataRow}>
      {items.map((item, index) => (
        <span key={`${item}:${index}`} className="inline-flex items-center gap-2">
          {index > 0 && <span className="h-1 w-1 rounded-full bg-[color:var(--border-strong)]" aria-hidden />}
          {item}
        </span>
      ))}
    </div>
  );
}
