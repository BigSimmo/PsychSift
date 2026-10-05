import { isDocumentViewerOwnedRoute } from "@/components/clinical-dashboard/mobile-composer-reserve";
import { isSlugDetail } from "@/lib/information-pages";

/**
 * Routes whose page already portals a header into the header's single addon
 * slot, which holds ONE page-owned header.
 *
 * This exists because nothing states that invariant. What has always enforced
 * it is a coincidence: `documents` and `differentials`, the only modes with a
 * claimant, had fewer than `MODE_NAV_MIN_ITEMS` destinations, so `ModeNav`
 * rendered nothing. Differentials now has three, and the protection that
 * replaced it is a second coincidence — every claimant route is also
 * `hasLocalInformationPageNavigation`, which returns null in
 * `PageSecondaryNavigation` before the mode branch is reached.
 *
 * Both are properties of separate lists that happen to agree, not rules. This
 * predicate makes the claimant set explicit so the agreement is checkable:
 * `tests/mode-nav-addon-slot.dom.test.tsx` asserts every route here is covered
 * by that early return, and fails when a future claimant is not — which is the
 * point at which the mode branch needs a guard of its own.
 *
 * Claimants are named individually rather than derived, because the only
 * evidence that a route claims the slot is that its component renders
 * `PhoneHeaderCollapsePortal`, `InPageNavHeader`, or `RegistryModeNav`.
 */
export function isHeaderAddonSlotOwnedRoute(pathname: string): boolean {
  // DocumentViewer.tsx
  if (isDocumentViewerOwnedRoute(pathname)) return true;
  // Differentials detail and presentation workflows both provide their own
  // header navigation. Presentation workflows use the shared RegistryModeNav
  // with the workflow-resolved selection.
  if (pathname.startsWith("/differentials/diagnoses/") || pathname.startsWith("/differentials/presentations/"))
    return true;
  // factsheets/factsheet-nav-header.tsx, mounted by the detail page.
  if (isSlugDetail(pathname, "/factsheets", ["search", "topics"])) return true;
  if (isSlugDetail(pathname, "/dictionary", ["search", "browse", "topics", "compare", "sources"])) return true;
  if (pathname.startsWith("/dictionary/topics/") && !pathname.slice("/dictionary/topics/".length).includes("/"))
    return true;
  // clinical-dashboard/medication-nav-header.tsx, mounted by
  // `MedicationRecordPage`. The header drives the panel swap that
  // `SectionTabs` used to own, so the record page now claims the slot too.
  if (isSlugDetail(pathname, "/medications")) return true;
  // The six information routes converted onto the shared `InPageNavHeader`,
  // which portals through `PhoneHeaderCollapsePortal` exactly as the two above
  // do. Each is a slug detail page, never the mode home or a
  // builder/compare/map/search surface.
  if (isSlugDetail(pathname, "/services", ["search"])) return true;
  if (isSlugDetail(pathname, "/forms", ["search"])) return true;
  if (isSlugDetail(pathname, "/specifiers", ["search"])) return true;
  if (isSlugDetail(pathname, "/formulation", ["search"])) return true;
  // dsm/dsm-diagnosis-page.tsx and dsm/dsm-differential-considerations-page.tsx
  // — the record and its `/differentials` child, but not /dsm/search or
  // /dsm/compare.
  if (pathname.startsWith("/dsm/diagnoses/")) return true;
  // developer-area/developer-hub-nav-header.tsx, mounted by the hub index page
  // only. Its `/ledger` child route owns no header of its own — a plain
  // back-link `<Link>` — so an exact match is correct here, not a prefix: a
  // `startsWith` would wrongly claim the slot for that child route too.
  if (pathname === "/mockups/development") return true;
  // On Call's section pages, which mount `RegistryModeNav` themselves rather
  // than letting the shell draw it — every route in this mode is an information
  // page, so `PageSecondaryNavigation` returns null before the mode branch and
  // the shell never could. `/on-call/card` claims the slot too, with the mode's
  // one remaining `InPageNavHeader` (`OnCallCardNavHeader`); it is a print
  // output rather than a peer section and needs a back control and an actions
  // sheet, which a rail has no place for.
  //
  // `isSlugDetail` covers every single-segment child of `/on-call` and nothing
  // deeper, which is exactly the set of pages this mode has. The mode home
  // `/on-call` is NOT covered by it and claims the slot separately below — it is
  // the bare path, not a slug detail.
  if (isSlugDetail(pathname, "/on-call")) return true;
  if (pathname === "/on-call") return true;
  // CPD's read views mount CmeNavHeader. CmePageTabs renders in the page now,
  // under the mode header band, and no longer uses the collapse portal. Detail,
  // form and secondary routes do not claim the slot.
  if (pathname === "/cme/programme" || pathname === "/cme/setup") return true;
  if (
    [
      "/cme",
      "/cme/check",
      "/cme/log",
      "/cme/routines",
      "/cme/plan",
      "/cme/calendar",
      "/cme/training",
      "/cme/learning",
    ].includes(pathname)
  )
    return true;
  // One activity and Customise mount `CmeDetailNavHeader` (the breadcrumb
  // shape, also in `cme/cme-nav-header.tsx`). Both are information pages, so
  // the shell never drew a bar into the slot on them. `/cme/log/[id]` is
  // matched as exactly one segment under `/cme/log/`, so nothing deeper and
  // not `/cme/log` itself (which claims it above, through its tab row).
  if (pathname === "/cme/customise") return true;
  if (/^\/cme\/log\/[^/]+$/.test(pathname)) return true;
  // Every First Nations route mounts `FirstNationsNavHeader`
  // (`first-nations/first-nations-nav-header.tsx`), an `InPageNavHeader`, for
  // the mode's own reason: it is an information page on every route (see
  // `isInformationPage`), so `PageSecondaryNavigation` returns null before the
  // mode branch and the shell could never draw a bar for it.
  if (pathname === "/first-nations" || isSlugDetail(pathname, "/first-nations")) return true;
  // Teaching's session page and the presenter's check-in screen mount
  // `TeachingNavHeader` (`teaching/teaching-nav-header.tsx`, the document-viewer
  // shape). Named exactly: the four top pages use the pages sheet, and the scan
  // landing mounts no header. Every Teaching route is `isInformationPage`.
  if (/^\/teaching\/session\/[^/]+(?:\/check-in)?$/.test(pathname)) return true;
  // Admin subpages mount AdminNavHeader; Admin Today has no page-owned header.
  if (pathname.startsWith("/admin/")) return true;
  return false;
}
