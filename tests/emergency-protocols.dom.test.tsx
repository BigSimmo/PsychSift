import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmergencyProtocolBanner } from "@/components/clinical-dashboard/emergency-protocol-banner";
import {
  EMERGENCY_CLINICAL_PROTOCOLS,
  matchEmergencyClinicalProtocol,
  matchEmergencyClinicalProtocols,
  selectEmergencyProtocolsForSurface,
} from "@/lib/emergency-protocols";

describe("matchEmergencyClinicalProtocol", () => {
  describe("Neuroleptic Malignant Syndrome", () => {
    it.each([
      "nms",
      "NMS",
      "treatment of nms in ED",
      "neuroleptic malignant syndrome",
      "suspected Neuroleptic Malignant Syndrome",
      "patient has lead-pipe rigidity",
      "hyperthermia and rigidity",
    ])("matches %j", (query) => {
      const match = matchEmergencyClinicalProtocol(query);
      expect(match).not.toBeNull();
      expect(match?.id).toBe("EMERG-NMS");
      expect(match?.name).toContain("Neuroleptic Malignant Syndrome");
    });
  });

  describe("Serotonin Syndrome", () => {
    it.each([
      "serotonin syndrome",
      "serotonin toxicity",
      "Hunter criteria for serotonin syndrome",
      "ssri toxicity",
      "snri overdose",
      "maoi toxicity",
    ])("matches %j", (query) => {
      const match = matchEmergencyClinicalProtocol(query);
      expect(match).not.toBeNull();
      expect(match?.id).toBe("EMERG-SEROTONIN-SYNDROME");
    });
  });

  describe("Acute Dystonic Reaction", () => {
    it.each([
      "acute dystonia",
      "acute dystonic reaction",
      "oculogyric crisis",
      "laryngeal dystonia",
      "torticollis antipsychotic",
    ])("matches %j", (query) => {
      const match = matchEmergencyClinicalProtocol(query);
      expect(match).not.toBeNull();
      expect(match?.id).toBe("EMERG-ACUTE-DYSTONIA");
    });
  });

  describe("Lithium Toxicity", () => {
    it.each([
      "lithium toxicity",
      "acute lithium poisoning",
      "lithium overdose management",
      "high lithium level",
      "coarse tremor with lithium",
      "ataxia and lithium",
    ])("matches %j", (query) => {
      const match = matchEmergencyClinicalProtocol(query);
      expect(match).not.toBeNull();
      expect(match?.id).toBe("EMERG-LITHIUM-TOXICITY");
    });
  });

  describe("Clozapine Myocarditis", () => {
    it.each([
      "clozapine myocarditis",
      "clozapine troponin rise",
      "tachycardia and fever on clozapine",
      "chest pain with clozapine",
      "clozapine cardiac monitoring",
    ])("matches %j", (query) => {
      const match = matchEmergencyClinicalProtocol(query);
      expect(match).not.toBeNull();
      expect(match?.id).toBe("EMERG-CLOZAPINE-MYOCARDITIS");
    });
  });

  describe("Malignant Catatonia", () => {
    it.each([
      "malignant catatonia",
      "lethal catatonia",
      "catatonic excitement",
      "catatonia with hyperthermia",
      "catatonia with fever",
    ])("matches %j", (query) => {
      const match = matchEmergencyClinicalProtocol(query);
      expect(match).not.toBeNull();
      expect(match?.id).toBe("EMERG-MALIGNANT-CATATONIA");
    });
  });

  describe("Negative matches (avoiding false positives)", () => {
    it.each([
      "synonyms for depression", // "nms" substring inside "synonyms"
      "dreams in sleep disorder", // "nms" substring inside "dreams"
      "ssri starting dose for depression",
      "lithium regular monitoring schedule",
      "clozapine routine blood test ANC",
      "catatonia rating scale Bush-Francis",
      "acute psychosis without fever or rigidity",
      "hypertension in elderly",
      "",
    ])("does not falsely match %j", (query) => {
      expect(matchEmergencyClinicalProtocol(query)).toBeNull();
    });

    it("safely handles null and undefined", () => {
      expect(matchEmergencyClinicalProtocol(null)).toBeNull();
      expect(matchEmergencyClinicalProtocol(undefined)).toBeNull();
    });
  });
});

describe("matchEmergencyClinicalProtocols (comparison queries)", () => {
  it("returns both protocols for a two-syndrome comparison, in catalogue order", () => {
    const ids = matchEmergencyClinicalProtocols("NMS vs serotonin syndrome").map((p) => p.id);
    expect(ids).toEqual(["EMERG-NMS", "EMERG-SEROTONIN-SYNDROME"]);
  });

  it("returns a single protocol for a single-condition query and none for no match", () => {
    expect(matchEmergencyClinicalProtocols("lithium toxicity").map((p) => p.id)).toEqual(["EMERG-LITHIUM-TOXICITY"]);
    expect(matchEmergencyClinicalProtocols("depression")).toEqual([]);
  });
});

describe("EMERGENCY_CLINICAL_PROTOCOLS structural integrity", () => {
  it("defines at least 6 core acute emergency protocols", () => {
    expect(EMERGENCY_CLINICAL_PROTOCOLS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(EMERGENCY_CLINICAL_PROTOCOLS)("validates structure for $id ($name)", (protocol) => {
    expect(protocol.id).toBeTruthy();
    expect(protocol.name).toBeTruthy();
    expect(protocol.firstLineAction.length).toBeGreaterThan(10);
    expect(protocol.warningNotice.length).toBeGreaterThan(20);
    expect(protocol.diagnosticFeatures.length).toBeGreaterThanOrEqual(2);
    expect(protocol.urgentInvestigations.length).toBeGreaterThanOrEqual(2);
    expect(protocol.immediateManagement.length).toBeGreaterThanOrEqual(2);
    expect(protocol.specialistContacts.length).toBeGreaterThanOrEqual(1);
    expect(protocol.evidenceSource.length).toBeGreaterThan(5);

    // Immediate management must have at least one high-priority step
    const hasPriority = protocol.immediateManagement.some((m) => m.isHighPriority);
    expect(hasPriority).toBe(true);
  });
});

describe("threshold contract: doses and thresholds defer to local protocol", () => {
  // docs/clinical-governance.md "Named instruments: name them, never score them": a dose,
  // temperature, serum level, rate or duration stated on a card is a rule the reader will act on.
  const allowedNumerals = [
    /13 11 26/g,
    /24 hours Australia-wide/g,
    /12-lead/g,
    /5-HT2A/g,
    /\(Version 8\)/g,
    /\b14th ed\b/g,
    /QJM 2003/g,
    /\bJ Psychopharmacol 2023\b/g,
    /\(Version 2, June 2024;/g,
  ];
  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === "object" && !(value instanceof RegExp)) return Object.values(value).flatMap(strings);
    return [];
  }

  it.each(EMERGENCY_CLINICAL_PROTOCOLS)("$id carries no numeric decision point", (protocol) => {
    for (const text of strings(protocol)) {
      const stripped = allowedNumerals.reduce((acc, pattern) => acc.replace(pattern, ""), text);
      expect(stripped, `numeric value on card: ${text}`).not.toMatch(/\d/);
    }
  });
});

describe("sourced wording (owner decision)", () => {
  const byId = (id: string) => EMERGENCY_CLINICAL_PROTOCOLS.find((p) => p.id === id)!;

  it("clozapine card requires specialist review for re-challenge and never states an absolute ban", () => {
    const text = JSON.stringify(byId("EMERG-CLOZAPINE-MYOCARDITIS"));
    expect(text).toContain("Any re-challenge requires specialist review (cardiology).");
    expect(text).toContain("Re-challenge Requires Specialist Review");
    expect(text).not.toMatch(/absolute contraindication|Permanent contraindication/i);
  });

  it("catatonia card investigations say only what the BAP guideline supports", () => {
    const investigations = byId("EMERG-MALIGNANT-CATATONIA").urgentInvestigations.join(" | ");
    expect(investigations).toContain("should be considered based on history and examination findings");
    expect(investigations).toContain("consider a CT or MRI scan of the brain");
    expect(investigations).toContain("NMDA receptor antibodies and other relevant autoantibodies in serum and CSF");
    expect(investigations).toContain("consider an EEG");
    expect(investigations).toContain("lumbar puncture");
    // Owner decision: unsourced phrases removed.
    expect(investigations).not.toMatch(/does not exclude|septic screen|neurology guidance/i);
    expect(investigations).not.toMatch(/to exclude intracranial/i);
  });

  it("cards cite their sources", () => {
    expect(byId("EMERG-MALIGNANT-CATATONIA").evidenceSource).toContain("British Association for Psychopharmacology");
    expect(byId("EMERG-CLOZAPINE-MYOCARDITIS").evidenceSource).toContain(
      "Guidelines for the Safe and Quality Use of Clozapine Therapy in the WA health system",
    );
  });
});

describe("Poisons call action routing", () => {
  const byId = (id: string) => EMERGENCY_CLINICAL_PROTOCOLS.find((p) => p.id === id)!;

  it.each(["EMERG-CLOZAPINE-MYOCARDITIS", "EMERG-MALIGNANT-CATATONIA"])(
    "%s does not expose the Poisons number anywhere",
    (id) => {
      const html = renderToStaticMarkup(<EmergencyProtocolBanner protocol={byId(id)} defaultExpanded />);
      expect(html).not.toContain("tel:131126");
      expect(html).not.toContain("13 11 26");
    },
  );

  it("still exposes the Poisons call on a toxicity card", () => {
    const html = renderToStaticMarkup(<EmergencyProtocolBanner protocol={byId("EMERG-LITHIUM-TOXICITY")} />);
    expect(html).toContain('href="tel:131126"');
  });
});

describe("selectEmergencyProtocolsForSurface (degraded setup)", () => {
  it("shows the card for a submitted query when answer setup is not ready", () => {
    const ids = selectEmergencyProtocolsForSurface({
      isAnswerSurface: true,
      hasResultSurface: false,
      resultQuery: null,
      setupBlockedQuery: "neuroleptic malignant syndrome",
    }).map((p) => p.id);
    expect(ids).toEqual(["EMERG-NMS"]);
  });

  it("shows nothing when no query was submitted, or off the answer surface", () => {
    expect(
      selectEmergencyProtocolsForSurface({
        isAnswerSurface: true,
        hasResultSurface: false,
        resultQuery: "nms",
        setupBlockedQuery: null,
      }),
    ).toEqual([]);
    expect(
      selectEmergencyProtocolsForSurface({
        isAnswerSurface: false,
        hasResultSurface: true,
        resultQuery: "nms",
        setupBlockedQuery: "nms",
      }),
    ).toEqual([]);
  });

  it("uses the result query when a result surface is present", () => {
    const ids = selectEmergencyProtocolsForSurface({
      isAnswerSurface: true,
      hasResultSurface: true,
      resultQuery: "lithium toxicity",
      setupBlockedQuery: "nms",
    }).map((p) => p.id);
    expect(ids).toEqual(["EMERG-LITHIUM-TOXICITY"]);
  });

  it("is wired into the dashboard", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    expect(source).toContain("selectEmergencyProtocolsForSurface({");
    expect(source).toContain("setSetupBlockedQuery(trimmedQuery)");
  });
});

describe("EmergencyProtocolBanner DOM rendering", () => {
  const nmsProtocol = EMERGENCY_CLINICAL_PROTOCOLS.find((p) => p.id === "EMERG-NMS")!;

  it("renders with an alert role (implicitly assertive)", () => {
    const html = renderToStaticMarkup(<EmergencyProtocolBanner protocol={nmsProtocol} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="emergency-protocol-banner"');
  });

  it("renders first-line action and poisons phone link in collapsed view", () => {
    const html = renderToStaticMarkup(<EmergencyProtocolBanner protocol={nmsProtocol} />);
    expect(html).toContain("Cease all dopamine antagonists and antipsychotics immediately.");
    expect(html).toContain('href="tel:131126"');
    expect(html).toContain("Poisons: 13 11 26");
  });

  it("renders detailed management and investigations when defaultExpanded is true", () => {
    const html = renderToStaticMarkup(<EmergencyProtocolBanner protocol={nmsProtocol} defaultExpanded={true} />);
    expect(html).toContain("Urgent Investigations");
    expect(html).toContain("Serum Creatine Kinase (CK)");
    expect(html).toContain("Immediate Antipsychotic Cessation");
    expect(html).toContain("Aggressive IV Hydration");
    expect(html).toContain("Maudsley Prescribing Guidelines");
  });
});
