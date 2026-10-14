/**
 * Lightweight constants and metadata for Forms mode client components so that
 * rendering priority facts and Act section chips does not bundle
 * `data/forms-catalog.json` or `data/mha-2014-sections.json` into the browser.
 */

export const PRIORITY_FACT_CARD_LABELS = {
  clock: "Clock / review",
  authority: "Made by / authority",
  criteria: "Criteria / threshold",
} as const;

export const ACT_SECTION_CHIP_LIMIT = 6;

export const mhaActMetadata = {
  actVersion: "02-b0-02",
  actAsAt: "2025-09-25",
  sourceUrl:
    "https://www.legislation.wa.gov.au/legislation/prod/filestore.nsf/FileURL/mrdoc_48919.htm/$FILE/Mental%20Health%20Act%202014%20-%20%5B02-b0-02%5D.html?OpenElement",
} as const;
