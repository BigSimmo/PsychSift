import { Pencil, Phone } from "lucide-react";

import { AdminPinButton } from "@/components/admin/admin-pin-button";
import { adminStyles } from "@/components/admin/admin-kit";
import { focusRing } from "@/components/card-recipes";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { spokenModeNumber } from "@/components/mode-kit/dates";
import { modeCallDiscShape, modePressable, modeTapArea } from "@/components/mode-kit/recipes";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { ExternalTextLink } from "@/components/ui/link";
import { cn, toolbarButton } from "@/components/ui-primitives";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { formatUpdatedMonth } from "@/lib/admin/renewal-dates";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import { isOnCallPlaceholderNumber } from "@/lib/on-call/number-resolver";

/** "Yours", "Shared by another doctor" or "Statewide", each with its own date or "No date recorded". */
function provenanceLine(source: AdminHelpItem["source"], updatedOn: string | null): string {
  const who = source === "you" ? "Yours" : source === "shared" ? "Shared by another doctor" : "Statewide";
  return `${who} · ${updatedOn ? `Updated ${formatUpdatedMonth(updatedOn)}` : "No date recorded"}`;
}

/**
 * One Help row (a support service, an own or shared logistics entry, or a
 * workforce contact). Own rows (`source: "you"`) get an Edit control; shared
 * and statewide rows have none. A row backed by a stored entry carries
 * `onCallEntryAnchorId`, so a redirected bookmark still lands on it.
 */
export function AdminHelpItemRow({ item, onEdit }: { item: AdminHelpItem; onEdit?: (item: AdminHelpItem) => void }) {
  const telHref = onCallTelHref(item.phone ?? undefined);
  return (
    <li
      id={item.entry ? onCallEntryAnchorId(item.entry.id) : undefined}
      tabIndex={item.entry ? -1 : undefined}
      className={cn(inPageAnchor, adminStyles.rowItem)}
      data-testid={`admin-help-item-${item.key}`}
    >
      <div className="work-row">
        <span className="work-row__text">
          <span className="work-row__title">{item.title}</span>
          {item.detail ? <span className="work-row__sub whitespace-pre-line">{item.detail}</span> : null}
          {item.phone && isOnCallPlaceholderNumber(item.phone) ? (
            <span className="work-row__sub tabular-nums">{displayPhoneNumber(item.phone, "own-list")}</span>
          ) : item.phone ? (
            <a
              href={telHref ?? `tel:${item.phone}`}
              className={cn(focusRing, "work-row__sub tabular-nums w-fit rounded-sm")}
            >
              {displayPhoneNumber(item.phone, "own-list")}
            </a>
          ) : null}
          {/* The source link rides the provenance line ("Yours · Updated Sep 2026 · More info"), keeping its 48px tap height. */}
          <span className="work-row__sub flex min-w-0 flex-wrap items-center gap-x-1">
            <span>{provenanceLine(item.source, item.updatedOn)}</span>
            {item.url ? (
              <>
                <span aria-hidden="true">·</span>
                <ExternalTextLink href={item.url} className="inline-flex min-h-tap items-center gap-0.5 text-xs">
                  More info
                </ExternalTextLink>
              </>
            ) : null}
          </span>
        </span>
      </div>
      {item.entry || (item.source === "you" && onEdit) ? (
        <div className={adminStyles.rowAction}>
          {item.entry ? (
            <AdminPinButton entryId={item.entry.id} title={item.title} testId={`admin-help-item-${item.key}-pin`} />
          ) : null}
          {item.source === "you" && onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(item)}
              aria-label={`Edit ${item.title}`}
              data-testid={`admin-help-item-${item.key}-edit`}
              className={cn(toolbarButton, "shrink-0")}
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The anchor a Help row carries, so a glance tile (or a bookmark) can land on it. */
export function adminHelpItemAnchorId(item: AdminHelpItem): string | null {
  return item.entry ? onCallEntryAnchorId(item.entry.id) : null;
}

/**
 * "On site at a glance": the On site rows already on the page, as a compact
 * two-column grid above their full list. Each tile shows the title and either
 * the number (with its own call disc) or the first line of the row's detail.
 * Tapping the tile's text jumps to that row's full entry below. Nothing here
 * is new data: no row, no category is invented, and with no rows there is no
 * grid.
 */
export function AdminHelpOnSiteGlance({ items }: { items: readonly AdminHelpItem[] }) {
  const tiles = items.flatMap((item) => {
    const anchor = adminHelpItemAnchorId(item);
    return anchor ? [{ item, anchor }] : [];
  });
  if (tiles.length === 0) return null;
  return (
    <ul className={adminStyles.grid2} aria-label="On site at a glance" data-testid="admin-help-on-site-glance">
      {tiles.map(({ item, anchor }) => {
        const telHref = onCallTelHref(item.phone ?? undefined);
        const phoneDisplay = item.phone ? displayPhoneNumber(item.phone, "own-list") : null;
        const firstDetailLine =
          item.detail
            ?.split("\n")
            .map((line) => line.trim())
            .find(Boolean) ?? null;
        const secondLine = phoneDisplay ?? firstDetailLine;
        return (
          <li
            key={item.key}
            className={cn("work-card", "flex min-w-0 items-stretch")}
            data-testid={`admin-help-glance-${item.key}`}
          >
            <a
              href={`#${anchor}`}
              className={cn(
                focusRing,
                modePressable,
                "grid min-h-12 min-w-0 flex-1 content-center gap-0.5 rounded-lg px-2.5 py-2 no-underline",
              )}
              data-testid={`admin-help-glance-${item.key}-jump`}
            >
              <span className="work-row__title">{item.title}</span>
              {secondLine ? (
                <span className={cn("work-row__sub", phoneDisplay ? "tabular-nums" : "line-clamp-2")}>
                  {secondLine}
                </span>
              ) : null}
            </a>
            {telHref && phoneDisplay ? (
              <a
                href={telHref}
                aria-label={`Call ${item.title}, ${spokenModeNumber(phoneDisplay)}`}
                className={cn(modeTapArea, focusRing, "self-center rounded-full")}
                data-testid={`admin-help-glance-${item.key}-call`}
              >
                <span aria-hidden="true" className={modeCallDiscShape.neutral}>
                  <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
                </span>
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
