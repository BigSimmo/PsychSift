import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ANSWER_PROVIDER_NOTICE_TEXT,
  AnswerProviderNotice,
} from "@/components/clinical-dashboard/answer-provider-notice";

/** The overseas-processing line under an answer (audit S3, 2026-10-13). */
describe("AnswerProviderNotice", () => {
  it("says where a question goes and asks for no patient details, as one quiet note", () => {
    render(<AnswerProviderNotice />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Sent to OpenAI overseas. Don't include patient details.");
    expect(note).toHaveTextContent(ANSWER_PROVIDER_NOTICE_TEXT);
    expect(note).toHaveAttribute("data-testid", "answer-provider-notice");
  });

  it("is mounted under the latest answer only, never on the home and never in demo mode", () => {
    // Source check as a stopgap: mounting the full ClinicalDashboard in each mode is too heavy for a unit
    // test. Cost: harmless reformatting can break it, and it cannot tell live code from dead code; the
    // Production UI tests cover the rendered notice.
    const source = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    expect(source.match(/<AnswerProviderNotice\b/g)).toHaveLength(1);
    // The owner removed it from the home pages on 17 Oct 2026, so nothing else in src may mount it,
    // including the shared home components.
    const mounts = readdirSync(resolve(process.cwd(), "src"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => readFileSync(resolve(process.cwd(), "src", file), "utf8").includes("<AnswerProviderNotice"))
      .map((file) => file.split(sep).join("/"));
    expect(mounts).toEqual(["components/ClinicalDashboard.tsx"]);
    expect(source).toMatch(
      /explicitDemoMode \|\|\s*answer\.demoMode === true[^?]*\? null : \(\s*<AnswerProviderNotice/,
    );
  });
});
