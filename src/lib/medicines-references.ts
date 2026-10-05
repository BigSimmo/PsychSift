/**
 * Outside references the Medicines pages point at. PsychSift links to these
 * publishers and never copies their content (several are licensed through the
 * hospital library). Every entry is a pointer, not a clinical statement: no
 * formulary status, PBS listing or chart content is written here.
 *
 * Sources for the names and addresses: the Medicines research notes of
 * 5 Oct 2026 (WA Statewide Medicines Formulary and Formulary One, the WA
 * statewide mental health medication charts, the WA Health library medication
 * resources, HealthPathways WA, the PBS Schedule's monthly update). The list
 * and its wording await the owner's check before it goes live.
 */

export interface MedicinesReference {
  readonly id: string;
  /** Short mark shown in the round chip. */
  readonly mark: string;
  readonly title: string;
  readonly publisher: string;
  readonly href: string;
}

/** WA Health's page for the Statewide Medicines Formulary, which is read through Formulary One. */
export const WA_FORMULARY_HREF = "https://www.health.wa.gov.au/Articles/U_Z/WA-Statewide-Medicines-Formulary";

/** WA Health's page for the statewide clozapine and mental health medication charts. */
const WA_MENTAL_HEALTH_CHARTS_HREF =
  "https://www.health.wa.gov.au/Articles/U_Z/WA-Clozapine-initiation-and-titration-chart";

/** The PBS Schedule. It is updated on the first day of every month (pbs.gov.au FAQ). */
export const PBS_HOME_HREF = "https://www.pbs.gov.au/";

/** A PBS Schedule search for one medicine by name. */
export function pbsSearchHref(medicineName: string): string {
  const url = new URL("https://www.pbs.gov.au/pbs/search");
  url.searchParams.set("term", medicineName);
  return url.toString();
}

/** The reference shelf: the medication resources WA Health libraries give staff, plus the local pathway site. */
export const MEDICINES_REFERENCES: readonly MedicinesReference[] = [
  { id: "formulary-one", mark: "F1", title: "Formulary One", publisher: "WA Health", href: WA_FORMULARY_HREF },
  {
    id: "amh",
    mark: "AMH",
    title: "Medicines Handbook",
    publisher: "Australian Medicines Handbook",
    href: "https://amhonline.amh.net.au/",
  },
  {
    id: "etg",
    mark: "TG",
    title: "Therapeutic Guidelines",
    publisher: "Therapeutic Guidelines",
    href: "https://www.tg.org.au/",
  },
  {
    id: "healthpathways-wa",
    mark: "HP",
    title: "Health\u00adPathways WA",
    publisher: "HealthPathways",
    href: "https://wa.communityhealthpathways.org/",
  },
];

/** The WA mandatory statewide mental health medication charts, each opening WA Health's charts page. */
export const WA_STATEWIDE_CHARTS: readonly MedicinesReference[] = [
  {
    id: "clozapine-initiation",
    mark: "PDF",
    title: "WA Adult Clozapine Initiation and Titration Chart",
    publisher: "WA Health",
    href: WA_MENTAL_HEALTH_CHARTS_HREF,
  },
  {
    id: "agitation-arousal-prn",
    mark: "PDF",
    title: "Agitation and Arousal PRN Chart",
    publisher: "WA Health",
    href: WA_MENTAL_HEALTH_CHARTS_HREF,
  },
  {
    id: "im-long-acting-injection",
    mark: "PDF",
    title: "Intramuscular Long-Acting Injection Chart",
    publisher: "WA Health",
    href: WA_MENTAL_HEALTH_CHARTS_HREF,
  },
];
