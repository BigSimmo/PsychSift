import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { THERAPY_CATALOGUE_ASSETS } from "@/components/therapy-compass/data/generated-assets";
import type { Therapy } from "@/components/therapy-compass/data/types";
import { TherapyKeyFacts } from "@/components/therapy-compass/record/key-facts";
import { OverlayRoot } from "@/components/ui/overlay-root";

const catalogue = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/therapy-compass-data", THERAPY_CATALOGUE_ASSETS.full), "utf8"),
) as Therapy[];

function bySlug(slug: string): Therapy {
  const record = catalogue.find((therapy) => therapy.slug === slug);
  if (!record) throw new Error(`Expected the catalogue to carry ${slug}`);
  return record;
}

afterEach(cleanup);

function renderFacts(therapy: Therapy) {
  return render(
    <>
      <OverlayRoot />
      <TherapyKeyFacts therapy={therapy} />
    </>,
  );
}

describe("TherapyKeyFacts", () => {
  it("renders one At a glance card with Format, Setting and Suits in full", () => {
    const therapy = bySlug("cognitive-behavioural-therapy-for-insomnia");
    renderFacts(therapy);

    const facts = screen.getByRole("region", { name: "At a glance" });
    expect(within(facts).queryByText("Evidence")).not.toBeInTheDocument();
    // Cautions is the full block directly after this card, not a tile in it.
    expect(within(facts).queryByText("Cautions")).not.toBeInTheDocument();
    expect(within(facts).getByText("Format")).toBeInTheDocument();
    expect(within(facts).getByText("Setting")).toBeInTheDocument();
    expect(within(facts).getByText("Suits")).toBeInTheDocument();
    expect(within(facts).queryByText("Tap for detail")).not.toBeInTheDocument();
    expect(within(facts).queryByRole("button")).not.toBeInTheDocument();
    expect(within(facts).getByText(therapy.patientPopulation!.trim())).toBeInTheDocument();
    expect(facts).toHaveTextContent(/sleep diaries/i);
    expect(facts).toHaveTextContent(/4–8 sessions/);
    expect(facts).toHaveTextContent(/between-session behavioural practice/);
  });

  it("shows the whole Setting list rather than a first-item-plus-count glance", () => {
    const therapy = bySlug("cognitive-behavioural-therapy-for-insomnia");
    renderFacts(therapy);

    const facts = screen.getByRole("region", { name: "At a glance" });
    expect(within(facts).queryByText("Emergency/acute +2")).not.toBeInTheDocument();
    expect(within(facts).getByText(therapy.setting!.trim())).toBeInTheDocument();
  });

  it("shows short fields as they are, with nothing to open", () => {
    renderFacts({
      ...bySlug("cognitive-behavioural-therapy-for-insomnia"),
      contraindicationsOrCautions: "Avoid in acute mania.",
      limitations: null,
      sessionLength: "Single session",
      timeRequired: "Single session",
      setting: "Outpatient",
      patientPopulation: "Adults.",
    });

    const facts = screen.getByRole("region", { name: "At a glance" });
    expect(within(facts).queryByRole("button")).not.toBeInTheDocument();
    expect(within(facts).queryByText("Avoid in acute mania.")).not.toBeInTheDocument();
    expect(within(facts).getByText("Single session")).toBeInTheDocument();
    expect(within(facts).getByText("Outpatient")).toBeInTheDocument();
    expect(within(facts).getByText("Adults.")).toBeInTheDocument();
  });
});
