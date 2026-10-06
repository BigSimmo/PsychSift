import type { AppModeId } from "@/lib/app-modes";
import type { UniversalSearchDomain } from "@/lib/universal-search-domains";

const preferredDomainsByMode: Record<AppModeId, readonly UniversalSearchDomain[]> = {
  answer: ["documents"],
  documents: ["documents"],
  services: ["services"],
  forms: ["forms"],
  favourites: [],
  differentials: ["differentials", "presentations"],
  dsm: ["dsm"],
  specifiers: ["specifiers"],
  formulation: ["formulation"],
  prescribing: ["medications", "documents"],
  tools: ["tools"],
  // Calculators searches its local, session-aware catalogue rather than the
  // cross-entity index, so it has no universal-search domain preference.
  calculators: [],
  // Therapy Compass leads with its own therapy library, exposed to cross-entity
  // search as the "therapies" domain.
  "therapy-compass": ["therapies"],
  // Factsheets searches its own local patient-information library, not a
  // cross-entity search domain, so it declares no preferred universal domains.
  factsheets: [],
  dictionary: ["dictionary"],
  sources: [],
  // On Call searches the owner's own operational entries, already in the
  // browser, so it contributes no cross-entity universal-search domain.
  "on-call": [],
  // CME reads the owner's own continuing-education entries, already in the
  // browser, so it contributes no cross-entity universal-search domain.
  cme: [],
  // Teaching holds each service's programme and each doctor's own attendance. It
  // contributes no cross-entity domain, so no Teaching record is ever searched
  // from the universal tray.
  teaching: [],
  // Psychiatry is a landing page for the modes it gathers; each of those keeps
  // its own domains, so the hub contributes none of its own.
  psychiatry: [],
  // Medicines & tools, like Psychiatry, is a landing page for the modes it
  // gathers, each of which keeps its own domains.
  medicines: [],
  // Admin (formerly My Work) keeps the owner's own records and sends nothing to
  // search; it contributes no search domains either.
  "my-work": [],
  // Roster reads the owner's own shifts, already in the browser, so it
  // contributes no cross-entity universal-search domain.
  roster: [],
  // First Nations owns its own in-page search box on every page (standard
  // §13), not the cross-entity universal search, so it contributes no domains.
  "first-nations": [],
  // My Day searches nothing; it only gathers the owner's own items.
  "my-day": [],
  // Open shifts lists adverts from the reader's own Roster teams; it
  // contributes no cross-entity universal-search domain.
  "open-shifts": [],
};

const modeByDomain: Record<UniversalSearchDomain, AppModeId> = {
  documents: "documents",
  medications: "prescribing",
  services: "services",
  forms: "forms",
  differentials: "differentials",
  presentations: "differentials",
  specifiers: "specifiers",
  formulation: "formulation",
  dsm: "dsm",
  therapies: "therapy-compass",
  dictionary: "dictionary",
  tools: "tools",
};

export function universalSearchPreferredDomains(mode: AppModeId | undefined): UniversalSearchDomain[] {
  return mode ? [...preferredDomainsByMode[mode]] : [];
}

export function universalSearchModeForDomain(domain: UniversalSearchDomain): AppModeId {
  return modeByDomain[domain];
}
