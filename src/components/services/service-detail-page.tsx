"use client";

import { useRouter } from "next/navigation";
import {
  TriangleAlert,
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  CircleCheck,
  Clipboard,
  DollarSign,
  Globe2,
  Info,
  LayoutGrid,
  Mail,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Tag,
  Users,
  X,
  CircleX,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  cn,
  metadataPillDensity,
  textMuted,
  toneDanger,
  toneInfo,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "@/components/ui-primitives";
import { RecordGlance, RecordIntro, RecordSection, type RecordGlanceFact } from "@/components/clinical-record-panels";
import { InformationPageShell } from "@/components/information-page-shell";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import { inPageActionRowClass, inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import { ServiceReferralFlow } from "@/components/services/service-referral-flow";
import { appModeHomeHref } from "@/lib/app-modes";
import { compactCatalogField } from "@/lib/compact-best-use-title";
import { extractFirstDialablePhone } from "@/lib/service-call";
import { serviceTagDisplayLabel } from "@/lib/service-facets";
import { serviceCoreGroupIds, serviceCoreGroups } from "@/lib/service-core-groups";
import {
  serviceNavigatorQuery,
  type ServiceContact,
  type ServiceCriterion,
  type ServiceInfoRow,
  type ServiceRecord,
  type ServiceStatusChip,
  type ServiceSummaryCard,
  type ServiceVerification,
} from "@/lib/service-ranker";
import { useAccountData } from "@/components/account-data-provider";

const missingText = "Not listed";

function hasText(value: string | null | undefined): value is string {
  if (!value?.trim()) return false;
  return !/^(?:none|none listed|not listed|n\/a|na|unknown|not publicly stated|confirm locally)$/i.test(value.trim());
}

function displayText(value: string | null | undefined, fallback = missingText) {
  return hasText(value) ? value.trim() : fallback;
}

function bestUseCardTitle(bestUse: string | null | undefined) {
  if (!hasText(bestUse)) return "Assess service fit";
  return compactCatalogField(bestUse, 120);
}

/** Short label for website contacts so long URLs do not dominate the contact band. */
function contactDisplayValue(contact: ServiceContact | null | undefined) {
  const value = contact?.value?.trim();
  if (!value) return undefined;
  if (contact?.kind === "web" || /^https?:\/\//i.test(value)) {
    try {
      const host = new URL(value).hostname.replace(/^www\./i, "");
      return host || "Website";
    } catch {
      return "Website";
    }
  }
  return value.includes("|") ? compactCatalogField(value, 160) : value;
}

function summaryCardIsRenderable(card: ServiceSummaryCard) {
  return hasText(card.title) && !/\|/.test(card.title ?? "");
}

function dedupeSummaryCardDetails(cards: ServiceSummaryCard[]) {
  const seenDetails = new Set<string>();

  return cards.map((card) => {
    if (!hasText(card.detail)) return card;
    const detailKey = normalizeTagForList(card.detail);
    const titleKey = hasText(card.title) ? normalizeTagForList(card.title) : undefined;
    if (detailKey === titleKey || seenDetails.has(detailKey)) return { ...card, detail: undefined };
    seenDetails.add(detailKey);
    return card;
  });
}

function chipToneClass(tone: ServiceStatusChip["tone"] | undefined | null) {
  if (tone === "danger") return toneDanger;
  if (tone === "info") return toneInfo;
  if (tone === "warning") return toneWarning;
  if (tone === "success") return toneSuccess;
  return toneNeutral;
}

function confidenceToneClass(confidence: ServiceVerification["confidence"]) {
  if (confidence === "High") return toneSuccess;
  if (confidence === "Medium") return toneWarning;
  if (confidence === "Low") return toneDanger;
  return toneNeutral;
}

function renderRowIcon(label: string) {
  const normalized = label.toLowerCase();
  const className = "h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]";
  if (normalized.includes("phone") || normalized.includes("route") || normalized.includes("contact")) {
    return <Phone className={className} aria-hidden />;
  }
  if (normalized.includes("email")) return <Mail className={className} aria-hidden />;
  if (normalized.includes("website") || normalized.includes("web")) return <Globe2 className={className} aria-hidden />;
  if (normalized.includes("region") || normalized.includes("catchment") || normalized.includes("location")) {
    return <MapPin className={className} aria-hidden />;
  }
  if (normalized.includes("patient") || normalized.includes("eligib")) {
    return <Users className={className} aria-hidden />;
  }
  if (normalized.includes("cost") || normalized.includes("funding")) {
    return <DollarSign className={className} aria-hidden />;
  }
  return <Info className={className} aria-hidden />;
}

function renderCriterionIcon(tone: ServiceCriterion["tone"]) {
  const className = cn(
    "mt-0.5 h-4 w-4 shrink-0",
    tone === "meet"
      ? "text-[color:var(--success)]"
      : tone === "reject"
        ? "text-[color:var(--danger)]"
        : "text-[color:var(--warning)]",
  );
  if (tone === "meet") return <CircleCheck className={className} aria-hidden />;
  if (tone === "reject") return <CircleX className={className} aria-hidden />;
  return <TriangleAlert className={className} aria-hidden />;
}

function criterionPill(tone: ServiceCriterion["tone"]) {
  if (tone === "meet") return { label: "Meets", className: toneSuccess };
  if (tone === "reject") return { label: "Reject", className: toneDanger };
  return { label: "Caution", className: toneWarning };
}

function contactHref(contact: ServiceContact | null | undefined) {
  const value = contact?.value?.trim();
  if (!contact || !hasText(value)) return undefined;
  if (contact.kind === "phone") {
    const compact = extractFirstDialablePhone(value);
    return compact ? `tel:${compact}` : undefined;
  }
  if (contact.kind === "email") return `mailto:${value}`;
  if (contact.kind === "web") return /^https?:\/\//i.test(value) ? value : undefined;
  return undefined;
}

function hrefIsExternal(href: string | undefined) {
  return Boolean(href && /^https?:\/\//i.test(href));
}

function actionDestinationIdentity(href: string | undefined) {
  if (!href) return undefined;
  if (!hrefIsExternal(href)) return href;

  try {
    const url = new URL(href);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return href;
  }
}

function summaryCardsFor(service: ServiceRecord): ServiceSummaryCard[] {
  if (Array.isArray(service.summaryCards)) {
    const cards = service.summaryCards
      .map((card) => ({
        ...card,
        title: hasText(card.title) ? compactCatalogField(card.title, 120) : card.title,
        detail: hasText(card.detail) ? compactCatalogField(card.detail, 120) : undefined,
      }))
      .filter(summaryCardIsRenderable);

    if (cards.length > 0 || !hasText(service.bestUse)) return cards;
    return [{ id: "best-use", label: "Best use", title: bestUseCardTitle(service.bestUse) }];
  }

  const cards: ServiceSummaryCard[] = [];
  if (hasText(service.route)) {
    cards.push({
      id: "route",
      label: "Route",
      title: compactCatalogField(service.route, 120),
      detail: hasText(service.referral) ? compactCatalogField(service.referral, 120) : undefined,
    });
  }
  if (hasText(service.eligibility)) {
    cards.push({
      id: "eligibility",
      label: "Eligibility",
      title: compactCatalogField(service.eligibility, 120),
    });
  }
  if (hasText(service.cost)) {
    cards.push({
      id: "cost",
      label: "Cost",
      title: compactCatalogField(service.cost, 120),
    });
  }
  if (hasText(service.bestUse)) {
    cards.push({
      id: "best-use",
      label: "Best use",
      title: bestUseCardTitle(service.bestUse),
    });
  }
  return cards.filter(summaryCardIsRenderable);
}

function referralRowsFor(service: ServiceRecord, primaryContact: ServiceContact | null): ServiceInfoRow[] {
  // Explicit arrays (including empty) mean the mapper already decided which rows exist.
  const sourceRows = Array.isArray(service.referralInfo)
    ? service.referralInfo
    : [
        { label: "Primary route", value: service.referral ?? primaryContact?.detail ?? "" },
        { label: "Phone", value: primaryContact?.kind === "phone" ? (primaryContact.value ?? "") : "" },
        { label: "Eligibility", value: service.eligibility ?? "" },
        { label: "Cost / funding", value: service.cost ?? "" },
        { label: "Region", value: service.location ?? service.catchments?.join(", ") ?? "" },
      ];

  return sourceRows
    .map((row) => ({
      ...row,
      value: hasText(row.value)
        ? row.label.toLowerCase().includes("phone")
          ? row.value.trim()
          : compactCatalogField(row.value, 160)
        : undefined,
    }))
    .filter((row) => hasText(row.value));
}

function normalizeTagForList(tag: string) {
  return tag.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Identity for "is this the same value shown again". A phone number compares by its
 * digits so "13 92 76" and "139276" count as one; anything else compares as trimmed,
 * case-folded text. Only exact repeats match: a row holding two numbers, or a number
 * plus words, stays distinct.
 */
function repeatedValueKey(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^[\d\s()+\-.]+$/.test(text) && /\d/.test(text)) return `tel:${text.replace(/\D/g, "")}`;
  return `text:${normalizeTagForList(text)}`;
}

function dedupeTagItems(items: string[]) {
  const seen = new Set<string>();
  return items
    .map((tag) => tag.trim())
    .filter((tag) => hasText(tag))
    .filter((tag) => {
      const key = normalizeTagForList(tag);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Ids and labels carried over verbatim from `serviceSections` in the pill rail
 * this page's header replaces. Exported so the per-route section contract test
 * can assert every one of them against the rendered DOM.
 */
export const serviceNavSections: readonly PageSection[] = [
  { id: "service-overview", label: "Overview", icon: Info },
  { id: "service-priority-facts", label: "Priority facts", icon: LayoutGrid },
  { id: "service-referral", label: "Referral", icon: Clipboard },
  { id: "service-criteria", label: "Criteria", icon: ShieldCheck },
  { id: "service-verification", label: "Verification", icon: BadgeCheck },
];

function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RecordSection id={id} title={title} action={action}>
      {description ? <p className={cn("m-0 mb-2 text-sm leading-6", textMuted)}>{description}</p> : null}
      {children}
    </RecordSection>
  );
}

/** A priority-fact card as one At a glance pair: the title, then its supporting line. */
function summaryCardFact(card: ServiceSummaryCard): RecordGlanceFact {
  const title = displayText(card.title);
  return {
    key: card.id,
    label: displayText(card.label, "Detail"),
    wide: title.length > 40 || (hasText(card.detail) && card.detail.trim().length > 40),
    value: (
      <>
        <span className="block">{title}</span>
        {hasText(card.detail) ? (
          <span className={cn("mt-0.5 block text-xs font-medium leading-5", textMuted)}>{card.detail.trim()}</span>
        ) : null}
      </>
    ),
  };
}

function renderPhoneLines(value: string) {
  const parts = value
    .split(/(?:[;\n]+|\s+\/\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return displayText(value);
  return (
    <span className="flex flex-col gap-1">
      {parts.map((part, idx) => {
        const compact = extractFirstDialablePhone(part);
        if (compact) {
          return (
            <a
              key={idx}
              href={`tel:${compact}`}
              className="underline decoration-[color:var(--border-strong)] underline-offset-2 hover:text-[color:var(--clinical-accent)] hover:decoration-current"
            >
              {part}
            </a>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}

/** Compact scan-first referral facts. Direct actions live in the referral band above. */
function ReferralTable({ rows, firstIsPrimary = true }: { rows: ServiceInfoRow[]; firstIsPrimary?: boolean }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] p-4 text-sm">
        <p className="font-semibold text-[color:var(--text-heading)]">No referral information</p>
        <p className={cn("mt-1 leading-6", textMuted)}>This service record has no referral rows yet.</p>
      </div>
    );
  }

  return (
    <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
      {rows.map((row, index) => {
        const isPrimary = firstIsPrimary && index === 0;
        const isCost = row.label.toLowerCase().includes("cost");

        return (
          <div
            key={`${row.label}-${index}`}
            className={cn(
              "relative grid min-h-13 grid-cols-[2rem_minmax(0,1fr)] gap-x-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2.5 shadow-[var(--shadow-inset)]",
              isPrimary && "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/35",
              isCost && "bg-[color:var(--success-soft)]/25",
            )}
          >
            {/* A `dl > div` may hold only dt and dd (#Q80S8B), so the decorative row
                icon lives inside the dt and is positioned into the reserved first
                column (the p-2.5 inset) rather than sitting beside the pair. */}
            <dt className="col-start-2 min-w-0 text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
              <span
                aria-hidden="true"
                className="absolute left-2.5 top-2.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[color:var(--clinical-accent-soft)] shadow-[var(--shadow-inset)]"
              >
                {renderRowIcon(row.label)}
              </span>
              {row.label}
              {isPrimary ? <span className="sr-only">, primary access route</span> : null}
            </dt>
            <dd className="col-start-2 mt-0.5 min-w-0 whitespace-pre-line break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">
              {row.label.toLowerCase().includes("phone") && hasText(row.value)
                ? renderPhoneLines(row.value)
                : displayText(row.value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function CriteriaBoard({ criteria }: { criteria: ServiceCriterion[] }) {
  if (!criteria.length) {
    return (
      <div className="rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] p-4 text-sm">
        <p className="font-semibold text-[color:var(--text-heading)]">No criteria recorded</p>
        <p className={cn("mt-1 leading-6", textMuted)}>Eligibility and exclusion criteria have not been added yet.</p>
      </div>
    );
  }

  const meets = criteria.filter((item) => item.tone === "meet");
  const cautionReject = criteria.filter((item) => item.tone !== "meet");

  return (
    <div className="space-y-3">
      <CriteriaGroup title="MEETS" titleClassName="text-[color:var(--success)]" items={meets} />
      <CriteriaGroup title="CAUTION / REJECT" titleClassName="text-[color:var(--danger)]" items={cautionReject} />
    </div>
  );
}

function CriteriaGroup({
  title,
  titleClassName,
  items,
}: {
  title: string;
  titleClassName: string;
  items: ServiceCriterion[];
}) {
  return (
    <div>
      <h3 className={cn("mb-1.5 text-sm font-bold tracking-normal", titleClassName)}>{title}</h3>
      {items.length ? (
        <div className="divide-y divide-[color:var(--border)]">
          {items.map((item) => {
            const pill = criterionPill(item.tone);
            return (
              <div key={item.label} className="flex min-h-10 items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {renderCriterionIcon(item.tone)}
                  <p className="min-w-0 text-sm font-medium leading-5 text-[color:var(--text-heading)]">{item.label}</p>
                </div>
                <span
                  className={cn(
                    "inline-flex min-h-6 shrink-0 items-center rounded-full border px-2.5 text-2xs font-bold lowercase",
                    pill.className,
                  )}
                >
                  {pill.label}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className={cn(
            "rounded-lg border border-dashed border-[color:var(--border)] p-3 text-sm leading-6",
            textMuted,
          )}
        >
          No items in this group.
        </p>
      )}
    </div>
  );
}

function TagList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  const uniqueItems = dedupeTagItems(items);

  if (!uniqueItems.length) return <p className={cn("text-sm leading-6", textMuted)}>{emptyLabel}</p>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {uniqueItems.map((item) => (
        <span key={normalizeTagForList(item)} className={cn(metadataPillDensity.dense, "rounded-full")}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function ServiceDetailPage({ service }: { service: ServiceRecord }) {
  const router = useRouter();
  const accountData = useAccountData();
  const saved = accountData.isSaved("service", service.slug);
  const [notice, setNotice] = useState<string | null>(null);
  const { sections, activeId, selectSection } = useInPageSectionNav(serviceNavSections);
  const primaryContact = hasText(service.primaryContact?.value)
    ? service.primaryContact
    : (service.contacts?.find((contact) => hasText(contact.value)) ?? null);
  const callHref = contactHref(primaryContact);
  const bandRouteValue = hasText(service.referral) ? service.referral : hasText(service.route) ? service.route : "";
  const contactLabel = contactDisplayValue(primaryContact);
  // The referral band shows the route and, for a phone contact, the number on its Call
  // button. The same number then reappeared as the "Contact" line, the Route fact card and
  // the Primary route and Phone rows. Exact repeats of a value the band already shows are
  // dropped below; every distinct value stays.
  const bandValueKeys = new Set(
    [
      repeatedValueKey(bandRouteValue),
      callHref && primaryContact?.kind === "phone" ? repeatedValueKey(contactLabel) : undefined,
    ].filter((key): key is string => Boolean(key)),
  );
  const repeatsBand = (value: string | null | undefined) => {
    const key = repeatedValueKey(value);
    return Boolean(key && bandValueKeys.has(key));
  };
  const summaryCards = summaryCardsFor(service);
  const allReferralRows = referralRowsFor(service, primaryContact);
  const referralRows = allReferralRows.filter(
    (row) => !(/route|phone|contact/i.test(row.label) && repeatsBand(row.value)),
  );
  // The first row is styled and announced as the primary access route; once that row is
  // dropped as a repeat of the band above, the next row is not a route and must not inherit it.
  const firstReferralRowIsPrimary = referralRows.length > 0 && referralRows[0] === allReferralRows[0];
  const actionableContact = Boolean(
    primaryContact && ["phone", "email", "web"].includes(primaryContact.kind) && callHref,
  );
  const sourceHref =
    hasText(service.source?.url) && /^https?:\/\//i.test(service.source.url) ? service.source.url : undefined;
  const ContactActionIcon = primaryContact?.kind === "email" ? Mail : primaryContact?.kind === "web" ? Globe2 : Phone;
  const contactActionLabel =
    primaryContact?.kind === "email" ? "Email" : primaryContact?.kind === "web" ? "Open website" : "Call";
  const verified = service.verification?.locallyVerified === true;
  const readinessActionHref = callHref ?? sourceHref;
  const readinessActionLabel = callHref
    ? primaryContact?.kind === "phone" && contactLabel
      ? `Call ${contactLabel}`
      : contactActionLabel
    : "Confirm at source";
  const ReadinessActionIcon = callHref ? ContactActionIcon : Globe2;
  // "Contact: 13 92 76" under a "13 92 76" heading, above a "Call 13 92 76" button.
  const contactLineRepeats = Boolean(
    actionableContact &&
    contactLabel &&
    (repeatsBand(contactLabel) || (primaryContact?.kind === "phone" && readinessActionLabel.includes(contactLabel))),
  );
  const ReadinessStatusIcon = verified ? BadgeCheck : TriangleAlert;
  const showSourceAction = Boolean(
    sourceHref && actionDestinationIdentity(sourceHref) !== actionDestinationIdentity(callHref),
  );
  const preferredCardOrder = ["best-use", "eligibility", "route", "cost"] as const;
  const summaryCardById = new Map(summaryCards.map((card) => [card.id, card]));
  const compactSummaryCards = preferredCardOrder
    .map((id) => summaryCardById.get(id))
    .filter((card): card is ServiceSummaryCard => Boolean(card && summaryCardIsRenderable(card)));
  const leftoverCards = summaryCards.filter(
    (card) => !preferredCardOrder.includes(card.id as (typeof preferredCardOrder)[number]),
  );
  const visibleSummaryCards = dedupeSummaryCardDetails([
    ...compactSummaryCards,
    ...leftoverCards.filter(summaryCardIsRenderable),
  ]).filter(
    (card) => !(card.id === "route" && repeatsBand(card.title) && (!hasText(card.detail) || repeatsBand(card.detail))),
  );
  const compactedSubtitle = hasText(service.subtitle) ? compactCatalogField(service.subtitle, 160) : "";
  // Raw catalogue tokens ("digital_phone", "crisis_high") are shown in plain words only where
  // the existing facet label map already names them; any other machine token is hidden.
  const tagItems = dedupeTagItems([
    ...(service.catchments ?? []),
    ...(service.tags ?? []).map(serviceTagDisplayLabel).filter((tag): tag is string => Boolean(tag)),
  ]);
  const criteria = service.criteria ?? [];
  const showReferralSection = referralRows.length > 0;
  const showCriteriaSection = criteria.length > 0;
  const showTagsSection = tagItems.length > 0;
  const showPriorityFacts = visibleSummaryCards.length > 0;
  const meetCount = criteria.filter((item) => item.tone === "meet").length;
  const cautionCount = criteria.filter((item) => item.tone !== "meet").length;
  const recordGroups = serviceCoreGroupIds(service);
  const localConfirmationDetail =
    service.verification?.notes?.find((note) => /hour/i.test(note)) ??
    service.verification?.notes?.find((note) => /local|confirm/i.test(note)) ??
    "Hours not public";

  async function toggleSaved() {
    try {
      const nowSaved = !saved;
      if (!(await accountData.setFavourite("service", service.slug, nowSaved))) {
        setNotice(
          accountData.isAuthenticated ? "Save failed. Try again." : "Sign in or create an account to save services",
        );
        return;
      }
      setNotice(nowSaved ? "Service saved" : "Service removed from saved items");
    } catch {
      setNotice("Save failed");
    }
  }

  function openInNavigator() {
    router.push(appModeHomeHref("services", { query: serviceNavigatorQuery(service), run: true, focus: true }));
  }

  // The mode home the back control returns to is the destination the removed
  // "Close service" icon button used, `focus: true` included, so the header
  // replaces that control rather than adding a second way out.
  const servicesHomeHref = appModeHomeHref("services", { focus: true });

  return (
    <>
      <InPageNavHeader
        back={{ href: servicesHomeHref, label: "Services" }}
        title={service.title}
        sections={sections}
        activeId={activeId}
        onSelectSection={selectSection}
        actionsNoun="service"
        actionsDescription="Choose how to use this service."
        testIdPrefix="service"
        actions={(close) => (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                close();
                void toggleSaved();
              }}
              aria-pressed={saved}
              className={inPageActionRowClass}
            >
              {saved ? (
                <BookmarkCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              ) : (
                <Bookmark className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              )}
              {saved ? "Remove saved service" : "Save service"}
            </button>
            {callHref ? (
              <a
                href={callHref}
                target={hrefIsExternal(callHref) ? "_blank" : undefined}
                rel={hrefIsExternal(callHref) ? "noopener noreferrer" : undefined}
                onClick={close}
                className={inPageActionRowClass}
              >
                <ContactActionIcon className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                {contactActionLabel}
              </a>
            ) : null}
            {showSourceAction && sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className={inPageActionRowClass}
              >
                <Globe2 className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                Open source
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                close();
                openInNavigator();
              }}
              className={inPageActionRowClass}
            >
              <Navigation className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              Use in navigator
            </button>
          </div>
        )}
      />
      <InformationPageShell testId="service-detail-page" gap={false}>
        {notice ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mb-3 flex min-h-tap items-center justify-between gap-3 rounded-lg border p-3 text-sm font-semibold shadow-[var(--shadow-inset)]",
              notice.includes("failed") || notice.includes("Nothing") ? toneWarning : toneSuccess,
            )}
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss service notification"
              className="grid size-tap place-items-center rounded-md transition hover:bg-[color:var(--surface)]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}

        <div className="mt-3">
          <div className="flex min-w-0 flex-col gap-7">
            <section id="service-overview" className={inPageAnchor}>
              <RecordIntro
                title={service.title}
                line={compactedSubtitle || undefined}
                tags={
                  <>
                    {service.statusChips?.map((chip, index) => (
                      <span
                        key={chip.label ?? `status-chip-${index}`}
                        className={cn(
                          "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-bold",
                          chipToneClass(chip.tone),
                        )}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                        {displayText(chip.label, "Status")}
                      </span>
                    ))}
                    <span className="contents" aria-label="Service groups">
                      {recordGroups.map((groupId) => {
                        const group = serviceCoreGroups.find((item) => item.id === groupId);
                        return group ? (
                          <span
                            key={group.id}
                            className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-1 text-2xs font-semibold text-[color:var(--text-muted)]"
                          >
                            {group.label}
                          </span>
                        ) : null;
                      })}
                    </span>
                  </>
                }
              />
            </section>

            {showPriorityFacts ? (
              <RecordGlance
                id="service-priority-facts"
                ariaLabel="Priority facts"
                facts={visibleSummaryCards.map(summaryCardFact)}
              />
            ) : null}

            <section
              id="service-referral-readiness"
              aria-label="Referral readiness"
              className="grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)_minmax(0,0.7fr)]"
            >
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
                    <Navigation className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
                      Referral route
                    </p>
                    <h2 className="mt-1 break-words text-base font-semibold leading-5 text-[color:var(--text-heading)]">
                      {hasText(service.referral) || hasText(service.route)
                        ? compactCatalogField(hasText(service.referral) ? service.referral : (service.route ?? ""), 150)
                        : "Confirm referral route"}
                    </h2>
                    {contactLineRepeats ? null : (
                      <p className={cn("mt-1 text-xs leading-5", textMuted)}>
                        {actionableContact && contactLabel
                          ? `${primaryContact?.label ?? "Contact"}: ${contactLabel}`
                          : sourceHref
                            ? "Confirm the current contact at the source."
                            : "Service-specific contact details require local confirmation."}
                      </p>
                    )}
                  </div>
                </div>
                {readinessActionHref ? (
                  <a
                    href={readinessActionHref}
                    target={hrefIsExternal(readinessActionHref) ? "_blank" : undefined}
                    rel={hrefIsExternal(readinessActionHref) ? "noopener noreferrer" : undefined}
                    className="inline-flex min-h-tap shrink-0 items-center justify-center gap-2 rounded-lg bg-[color:var(--clinical-accent)] px-3 text-sm font-bold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] transition hover:bg-[color:var(--clinical-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  >
                    <ReadinessActionIcon className="h-4 w-4" aria-hidden />
                    {readinessActionLabel}
                  </a>
                ) : null}
              </div>
              <div className="border-t border-[color:var(--border)] pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <div className="flex gap-2.5">
                  <ReadinessStatusIcon
                    className={cn(
                      "mt-0.5 h-5 w-5 shrink-0",
                      verified ? "text-[color:var(--success)]" : "text-[color:var(--warning)]",
                    )}
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                      {verified ? "Verified for local use" : "Verify locally before use"}
                    </p>
                    <p className={cn("mt-0.5 text-xs leading-5", textMuted)}>{localConfirmationDetail}</p>
                  </div>
                </div>
              </div>
              <div className="border-t border-[color:var(--border)] pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <p className="text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">Confidence</p>
                <span
                  className={cn(
                    metadataPillDensity.standard,
                    "mt-2 inline-flex rounded-full",
                    confidenceToneClass(service.verification?.confidence),
                  )}
                >
                  {service.verification?.confidence ?? "Unknown"}
                </span>
                <p className="mt-1 text-2xs leading-4 text-[color:var(--text-muted)]">
                  {service.source?.status ?? "Source status pending"}
                </p>
              </div>
            </section>

            <ServiceReferralFlow active="refer" />

            <div
              className={cn(
                "grid gap-7",
                showReferralSection && showCriteriaSection
                  ? "xl:grid-cols-[minmax(28rem,0.86fr)_minmax(0,1fr)]"
                  : undefined,
              )}
            >
              {showReferralSection ? (
                <Section id="service-referral" title="Referral information">
                  <ReferralTable rows={referralRows} firstIsPrimary={firstReferralRowIsPrimary} />
                </Section>
              ) : null}

              <div className="flex min-w-0 flex-col gap-7">
                {showCriteriaSection ? (
                  <Section
                    id="service-criteria"
                    title="Referral criteria"
                    action={
                      <div className="flex flex-wrap gap-2">
                        <span className={cn(metadataPillDensity.roomy, "rounded-full", toneSuccess)}>
                          {meetCount} meet
                        </span>
                        <span className={cn(metadataPillDensity.roomy, "rounded-full", toneWarning)}>
                          {cautionCount} caution
                        </span>
                      </div>
                    }
                  >
                    <CriteriaBoard criteria={criteria} />
                  </Section>
                ) : null}

                <section
                  id="service-verification"
                  className={cn(
                    inPageAnchor,
                    "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
                      <ShieldCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Verification</h2>
                    <span
                      className="hidden h-1 w-1 rounded-full bg-[color:var(--decoration-soft)] sm:block"
                      aria-hidden
                    />
                    <span className="text-sm font-medium text-[color:var(--text-muted)]">
                      {verified ? "Locally verified" : "Verify locally before use"}
                    </span>
                    <span
                      className="hidden h-1 w-1 rounded-full bg-[color:var(--decoration-soft)] sm:block"
                      aria-hidden
                    />
                    <span className="text-sm font-medium text-[color:var(--text-muted)]">
                      {service.verification?.confidence ?? "Unknown"} confidence
                    </span>
                    {service.source?.status ? (
                      <>
                        <span
                          className="hidden h-1 w-1 rounded-full bg-[color:var(--decoration-soft)] sm:block"
                          aria-hidden
                        />
                        <span className="text-sm font-medium text-[color:var(--text-muted)]">
                          {service.source.status}
                        </span>
                      </>
                    ) : null}
                    {sourceHref ? (
                      <a
                        href={sourceHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View service source"
                        className="ml-auto inline-flex min-h-tap items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                      >
                        View source
                        <Globe2 className="h-4 w-4" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </section>

                {showTagsSection ? (
                  <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
                        <Tag className="h-5 w-5" aria-hidden />
                      </span>
                      <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Tags & catchments</h2>
                      <TagList items={tagItems} emptyLabel="No tags listed." />
                    </div>
                  </section>
                ) : null}
              </div>
            </div>

            <p className="flex flex-wrap items-center justify-center gap-3 border-t border-[color:var(--border)] pt-4 text-center text-xs font-medium text-[color:var(--text-muted)]">
              <Info className="h-4 w-4" aria-hidden />
              Information accuracy may vary. Confirm locally before use.
              <span aria-hidden>·</span>
              <Bookmark className="h-4 w-4" aria-hidden />
              {service.catalogueLabel ?? "Catalogue service"}
            </p>
          </div>
        </div>
      </InformationPageShell>
    </>
  );
}
