// CodSpeed benchmarks for the CPU-bound clinical text pipeline: chunking at ingest,
// query classification, medication entity extraction, evidence ranking and catalog
// search. Every fixture is synthetic and built once outside the measured callbacks,
// so the benchmarks never touch the network, Supabase or a provider.
//
// Run locally with `npm run bench`; CI runs them under the CodSpeed CPU simulation
// instrument (.github/workflows/codspeed.yml).
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { Bench } from "tinybench";
import { rankAnswerEvidence } from "@/lib/answer-ranking";
import { compactSearchText, normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";
import { buildChunks, chunkTextWithOverlap } from "@/lib/chunking";
import { analyzeClinicalQuery, classifyRagQuery } from "@/lib/clinical-search";
import { medicationEntityMatchesInText } from "@/lib/medication-entities";
import type { ChunkInput, SearchResult } from "@/lib/types";

const SENTENCES = [
  "Clozapine requires baseline FBC and ANC monitoring before initiation and weekly for the first 18 weeks.",
  "Withhold clozapine when the ANC falls below 1.5 x 10^9/L and arrange urgent haematology review.",
  "Lithium serum levels should be checked 12 hours post-dose, targeting 0.6-0.8 mmol/L for maintenance.",
  "Olanzapine 5-10 mg orally may be offered for acute agitation, maximum 20 mg in 24 hours.",
  "Monitor QTc on ECG when combining haloperidol with other QT-prolonging medicines.",
  "Sodium valproate is contraindicated in people of child-bearing potential without a pregnancy prevention plan.",
  "Assess metabolic parameters including weight, waist circumference, HbA1c and lipids every three months.",
  "Sertraline 50 mg daily is a reasonable first-line option for moderate depression in adults.",
  "Escalate to the consultant psychiatrist if the patient remains at high risk after de-escalation.",
  "Document capacity assessment, consent and the rationale for any involuntary treatment order.",
];

function clinicalParagraphs(count: number) {
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index % 6 === 0) lines.push(`\n${index / 6 + 1}. Section ${index / 6 + 1} Medication Monitoring\n`);
    lines.push(SENTENCES[index % SENTENCES.length]);
  }
  return lines.join(" ");
}

const LONG_DOCUMENT_TEXT = clinicalParagraphs(240);

const CHUNK_INPUTS: ChunkInput[] = Array.from({ length: 12 }, (_, page) => ({
  documentId: "bench-doc",
  pageNumber: page + 1,
  pageText: clinicalParagraphs(30 + (page % 4) * 5),
  images:
    page % 3 === 0
      ? [
          {
            id: `img-${page}`,
            caption: "Table: clozapine ANC thresholds and actions for monitoring frequency.",
            pageNumber: page + 1,
          },
        ]
      : [],
}));

const QUERIES = [
  "What ANC threshold should withhold clozapine?",
  "lithium level target maintenance dose",
  "Which table covers agitation and arousal pharmacological management?",
  "olanzapine maximum dose in 24 hours for acute agitation",
  "compare sertraline and escitalopram for depression",
  "QTc monitoring haloperidol ECG",
  "valproate pregnancy prevention plan",
  "metabolic monitoring antipsychotic schedule",
];

function searchResult(index: number): SearchResult {
  return {
    id: `chunk-${index}`,
    document_id: `doc-${index % 7}`,
    title: index % 2 === 0 ? "Clozapine Prescribing Guideline" : "Psychotropic Monitoring Handbook",
    file_name: `guideline-${index % 7}.pdf`,
    page_number: (index % 40) + 1,
    chunk_index: index,
    section_heading: index % 3 === 0 ? "FBC and ANC monitoring" : "Dosing and titration",
    content: `${SENTENCES[index % SENTENCES.length]} ${SENTENCES[(index + 3) % SENTENCES.length]} ${
      SENTENCES[(index + 7) % SENTENCES.length]
    }`,
    image_ids: [],
    similarity: 0.5 + (index % 10) / 25,
    hybrid_score: 0.45 + (index % 13) / 30,
    images: [],
  };
}

const SEARCH_RESULTS = Array.from({ length: 40 }, (_, index) => searchResult(index));

type CatalogItem = { title: string; slug: string; tags: string[]; body: string };

const CATALOG_TOPICS = [
  "Clozapine Monitoring",
  "Lithium Levels",
  "Transfer Checklist",
  "Agitation Management",
  "Metabolic Screening",
  "Valproate Safety",
  "Depression Pathway",
  "Capacity Assessment",
];

const CATALOG: CatalogItem[] = Array.from({ length: 400 }, (_, index) => {
  const topic = CATALOG_TOPICS[index % CATALOG_TOPICS.length];
  return {
    title: `${topic} ${index}`,
    slug: `${topic.toLowerCase().replace(/\s+/g, "-")}-${index}`,
    tags: ["psychiatry", topic.split(" ")[0].toLowerCase(), index % 2 === 0 ? "adult" : "youth"],
    body: SENTENCES[index % SENTENCES.length],
  };
});

const CATALOG_OPTIONS: Parameters<typeof rankCatalogRecords<CatalogItem>>[2] = {
  fields: [
    { id: "title", weight: 6, text: (item) => normalizeSearchText(`${item.title} ${item.slug}`) },
    { id: "tags", weight: 3, text: (item) => normalizeSearchText(item.tags.join(" ")) },
  ],
  fullText: (item) => normalizeSearchText(`${item.title} ${item.tags.join(" ")} ${item.body}`),
};

const bench = withCodSpeed(new Bench());

bench
  .add("chunking: chunkTextWithOverlap long document", () => {
    chunkTextWithOverlap(LONG_DOCUMENT_TEXT, 2000, 200);
  })
  .add("chunking: buildChunks 12 pages", () => {
    buildChunks(CHUNK_INPUTS);
  })
  .add("clinical-search: classifyRagQuery", () => {
    for (const query of QUERIES) classifyRagQuery(query);
  })
  .add("clinical-search: analyzeClinicalQuery", () => {
    for (const query of QUERIES) analyzeClinicalQuery(query);
  })
  .add("medication-entities: medicationEntityMatchesInText", () => {
    medicationEntityMatchesInText(LONG_DOCUMENT_TEXT);
  })
  .add("answer-ranking: rankAnswerEvidence 40 results", () => {
    rankAnswerEvidence(QUERIES[0], SEARCH_RESULTS);
  })
  .add("catalog-search: rankCatalogRecords 400 records", () => {
    rankCatalogRecords(CATALOG, "clozapine monitoring", CATALOG_OPTIONS);
  })
  .add("catalog-search: normalize and compact text", () => {
    compactSearchText(normalizeSearchText(LONG_DOCUMENT_TEXT));
  });

async function main() {
  await bench.run();
  console.table(bench.table());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
