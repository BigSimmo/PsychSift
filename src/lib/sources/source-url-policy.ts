export const GOVERNED_SOURCE_HOSTS = [
  "aci.health.nsw.gov.au",
  "alcoholtreatmentguidelines.com.au",
  "admhss.mhc.wa.gov.au",
  "australianprescriber.tg.org.au",
  "cahs.health.wa.gov.au",
  "emhs.health.wa.gov.au",
  "headspace.org.au",
  "helpingminds.org.au",
  "icd.who.int",
  "mensline.org.au",
  "meteor.aihw.gov.au",
  "pmc.ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "qlife.org.au",
  "royalperthhospital.health.wa.gov.au",
  "rph.health.wa.gov.au",
  "ruah.org.au",
  "smhs.health.wa.gov.au",
  "www.abs.gov.au",
  "www.amhocn.org",
  "www.aihw.gov.au",
  "www.beyondblue.org.au",
  "www.cci.health.wa.gov.au",
  "www.chiefpsychiatrist.wa.gov.au",
  "www.columbiapsychiatry.org",
  "www.ebs.tga.gov.au",
  "www.entrypointperth.com.au",
  "www.gamblinghelponline.org.au",
  "www.health.gov.au",
  "www.health.wa.gov.au",
  "www.healthdirect.gov.au",
  "www.healthtranslations.vic.gov.au",
  "www.healthywa.wa.gov.au",
  "www.ihacpa.gov.au",
  "www.kemh.health.wa.gov.au",
  "www.legalaid.wa.gov.au",
  "www.legislation.wa.gov.au",
  "www.livingproud.org.au",
  "www.mayoclinic.org",
  "www.medicarementalhealth.gov.au",
  "www.mhas.wa.gov.au",
  "www.mhc.wa.gov.au",
  "www.mht.wa.gov.au",
  "www.ncbi.nlm.nih.gov",
  "www.ndis.gov.au",
  "www.nice.org.uk",
  "www.nimh.nih.gov",
  "www.nmhs.health.wa.gov.au",
  "www.openarms.gov.au",
  "www.psychiatry.org",
  "www.ranzcp.org",
  "www.rch.org.au",
  "www.tisnational.gov.au",
  "www.wa.gov.au",
  "www.wacountry.health.wa.gov.au",
  "www.who.int",
  "www.vinnies.org.au",
  "www.wungening.com.au",
  "www1.health.gov.au",
  "www1.health.nsw.gov.au",
  "youthfocus.com.au",
] as const;

const governedSourceHosts = new Set<string>(GOVERNED_SOURCE_HOSTS);

/**
 * The TGA's Product Information search, the only form of the eBS host the
 * register links to: `PICMI?OpenForm&q=<name>&t=pi`. Individual PI documents are
 * served from the same host under ids that could not be read for capture, so a
 * record links the search for its generic name instead.
 */
function isTgaProductInformationSearch(url: URL, entries: [string, string][]) {
  if (url.pathname !== "/ebs/picmi/picmirepository.nsf/PICMI") return false;
  const params = new Map(entries);
  return (
    entries.length === 3 &&
    params.size === 3 &&
    params.get("OpenForm") === "" &&
    params.get("t") === "pi" &&
    /^[a-z]+(?: [a-z]+)*$/.test(params.get("q") ?? "")
  );
}

function hasGovernedQuery(url: URL) {
  // The TGA host is governed for the PI search form only, so a query-less URL
  // there (an individual PI document path) must not slip through the shortcut below.
  const entries = [...url.searchParams.entries()];
  if (url.hostname === "www.ebs.tga.gov.au") return isTgaProductInformationSearch(url, entries);
  if (!url.search) return true;

  if (entries.length !== 1) return false;

  const [[key, value]] = entries;
  if (url.hostname === "www.health.gov.au") {
    return key === "language" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value);
  }
  if (url.hostname === "www.legislation.wa.gov.au") {
    return key === "OpenElement" && value === "";
  }
  return false;
}

export function safeCanonicalSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!governedSourceHosts.has(url.hostname)) return null;
    if (!hasGovernedQuery(url)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
