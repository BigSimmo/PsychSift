import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  REPORT_HEADING,
  classify,
  fingerprintOf,
  jurisdictionRank,
  normaliseHtml,
  parseState,
  renderReport,
  watchedSources,
  type FetchOutcome,
  type WatchedSource,
} from "../scripts/watch-source-changes";
import { yamlBlock } from "../scripts/yaml-contract.mjs";
import register from "../src/data/source-acquisitions.json";

const workflow = fs.readFileSync(new URL("../.github/workflows/source-watch.yml", import.meta.url), "utf8");
const ciWorkflow = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
const reportJob = code(yamlBlock(workflow, "report:", 2));
const publishJob = code(yamlBlock(workflow, "publish:", 2));

const source: WatchedSource = {
  id: "wa-example",
  title: "Example guideline",
  publisher: "WA Health",
  jurisdiction: "Australia/WA",
  url: "https://www.health.wa.gov.au/example",
};
const html = (text: string): Extract<FetchOutcome, { kind: "ok" }> => ({
  kind: "ok",
  finalUrl: source.url,
  status: 200,
  contentType: "text/html; charset=utf-8",
  lastModified: null,
  body: new TextEncoder().encode(text),
});

describe("source watch: which sources", () => {
  it("watches Western Australian sources first, then the rest of Australia, then the UK, and nothing else", () => {
    expect(jurisdictionRank("Australia/WA")).toBe(0);
    expect(jurisdictionRank("Western Australia")).toBe(0);
    expect(jurisdictionRank("Australia")).toBe(1);
    expect(jurisdictionRank("Australia/NSW")).toBe(1);
    expect(jurisdictionRank("United Kingdom")).toBe(2);
    expect(jurisdictionRank("United States")).toBeNull();
    expect(jurisdictionRank("International")).toBeNull();

    const watched = watchedSources(register);
    expect(watched.length).toBeGreaterThan(40);
    const ranks = watched.map((item) => jurisdictionRank(item.jurisdiction));
    expect(ranks).toEqual([...ranks].sort());
    const rejected = new Set(register.filter((record) => record.disposition === "rejected").map((record) => record.id));
    for (const item of watched) {
      expect(rejected.has(item.id), item.id).toBe(false);
      expect(item.url).toMatch(/^https:\/\//);
    }
    expect(new Set(watched.map((item) => item.id)).size).toBe(watched.length);
  });

  it("never fetches the TGA PI search, whose host disallows automated retrieval", () => {
    const live = register.filter((record) => record.dateModel === "live_product_information");
    expect(live.length).toBeGreaterThan(0);
    const watchedIds = new Set(watchedSources(register).map((item) => item.id));
    for (const record of live) expect(watchedIds.has(record.id), record.id).toBe(false);
    expect(watchedSources(register).some((item) => item.url.includes("www.ebs.tga.gov.au"))).toBe(false);
  });
});

describe("source watch: what counts as a change", () => {
  it("ignores scripts, navigation, comments and dates, but not the guidance text", () => {
    const before = normaliseHtml(
      "<html><head><title>x</title></head><body><nav>Menu</nav><script>var v=1</script><!-- build 1 --><p>Give 5 mg.</p><footer>Last updated 3 March 2026</footer></body></html>",
    );
    const reskinned = normaliseHtml(
      "<html><head><title>y</title></head><body><nav>Other</nav><script>var v=2</script><!-- build 2 --><p>Give 5 mg.</p><footer>Last updated 21 October 2026</footer></body></html>",
    );
    expect(reskinned).toBe(before);
    expect(normaliseHtml("<p>Give 10 mg.</p>")).not.toBe(normaliseHtml("<p>Give 5 mg.</p>"));
    // An encoded comparator is clinical meaning, not markup.
    expect(normaliseHtml("<p>Stop if eGFR &lt;30.</p>")).not.toBe(normaliseHtml("<p>Stop if eGFR &gt;30.</p>"));
    expect(normaliseHtml("<p>Level &#8805;0.8</p>")).not.toBe(normaliseHtml("<p>Level &#8804;0.8</p>"));
    expect(normaliseHtml("<p>Give&nbsp;5&#160;mg &amp; review</p>")).toBe("Give 5 mg & review");
    expect(normaliseHtml("<p>Reviewed 2026-03-03 at 10:15 am</p>")).toBe(
      normaliseHtml("<p>Reviewed 2026-10-21 at 9:00 pm</p>"),
    );
    expect(normaliseHtml("<p>Page generated 14:32</p>")).toBe(normaliseHtml("<p>Page generated 09:05</p>"));
    expect(normaliseHtml("<p>Reviewed 2026-03-03 10:15</p>")).toBe(normaliseHtml("<p>Reviewed 2026-10-21 9:00</p>"));
    expect(normaliseHtml("<p>Clock 10:15:02</p>")).toBe(normaliseHtml("<p>Clock 9:00:59</p>"));
    // A ratio or dilution is guidance, not a clock.
    expect(normaliseHtml("<p>Dilute adrenaline 1:10</p>")).not.toBe(normaliseHtml("<p>Dilute adrenaline 1:20</p>"));
  });

  it("reports first sight, unchanged, changed, moved, gone and unreachable", () => {
    const first = classify(source, html("<p>Give 5 mg.</p>"), undefined);
    expect(first.disposition).toBe("new");
    expect(classify(source, html("<p>Give 5 mg.</p>"), first.fingerprint ?? undefined).disposition).toBe("unchanged");
    expect(classify(source, html("<p>Give 10 mg.</p>"), first.fingerprint ?? undefined).disposition).toBe("changed");
    expect(
      classify(source, { ...html("<p>Give 5 mg.</p>"), finalUrl: "https://www.health.wa.gov.au/new-home" }, undefined)
        .disposition,
    ).toBe("moved");
    expect(
      classify(source, { ...html("x"), finalUrl: "http://WWW.health.wa.gov.au/example/" }, undefined).disposition,
    ).toBe("new");
    expect(classify(source, { kind: "http", status: 404, finalUrl: source.url }, undefined).disposition).toBe("gone");
    const blocked = classify(
      source,
      { kind: "http", status: 403, finalUrl: source.url },
      first.fingerprint ?? undefined,
    );
    expect(blocked.disposition).toBe("unreachable");
    // A source that could not be checked keeps last week's fingerprint, so next week still compares.
    expect(blocked.fingerprint).toEqual(first.fingerprint);
    expect(classify(source, { kind: "error", message: "timed out" }, undefined).disposition).toBe("unreachable");
  });

  it("compares a PDF byte for byte", () => {
    const pdf = (bytes: number[]) =>
      fingerprintOf({
        url: source.url,
        contentType: "application/pdf",
        lastModified: null,
        body: Uint8Array.from(bytes),
      });
    expect(pdf([1, 2, 3]).hash).toBe(pdf([1, 2, 3]).hash);
    expect(pdf([1, 2, 3]).hash).not.toBe(pdf([1, 2, 4]).hash);
  });
});

describe("source watch: the report", () => {
  it("starts with the heading the publisher checks and carries the state for next week", () => {
    const changed = classify(source, html("<p>Give 10 mg.</p>"), {
      url: source.url,
      hash: "0".repeat(64),
      bytes: 10,
      contentType: "text/html",
      lastModified: null,
    });
    const report = renderReport([changed], "2026-10-26");
    expect(report.split("\n", 1)[0]).toBe(REPORT_HEADING);
    expect(report).toContain("## Changed since last week (1)");
    expect(report).toContain("src/data/source-change-events.json");
    expect(report).toContain("<!-- source-watch-attention:1 -->");
    expect(parseState(report)).toEqual({ [source.id]: changed.fingerprint });
    expect(parseState("no state here")).toEqual({});
    expect(parseState("<!-- source-watch-state:v1 bm90IGpzb24= -->")).toEqual({});
  });
});

describe("source watch workflow", () => {
  it("runs weekly and on demand on main only, never on a push or pull request", () => {
    const on = code(yamlBlock(workflow, "on:", 0));
    expect(on).toMatch(/schedule:\n\s+- cron: "\d+ \d+ \* \* \d"/);
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(/\b(push|pull_request|pull_request_target|merge_group):/);
    for (const job of [reportJob, publishJob]) {
      expect(job).toMatch(/if: \$\{\{[^}]*github\.ref == 'refs\/heads\/main'[^}]*\}\}/);
    }
  });

  it("can only read where it runs repository code, and writes issues only where it runs none", () => {
    expect(code(yamlBlock(workflow, "permissions:", 0)).trim()).toBe("permissions:\n  contents: read");
    expect(reportJob).toMatch(/permissions:\n\s+contents: read\n\s+issues: read\n/);
    expect(reportJob).not.toMatch(/: write/);
    expect(publishJob).toMatch(/permissions:\n\s+contents: read\n\s+issues: write\n/);
    expect(publishJob).not.toContain("actions/checkout");
    expect(publishJob).not.toMatch(/^\s+run:/m);
    expect(code(workflow)).not.toMatch(/contents: write|pull-requests: write|actions: write|write-all/);
  });

  it("uses no provider secret: no database, OpenAI, Railway or ingestion", () => {
    // Comments say what the watch does not do, so only the executable lines are checked.
    expect(code(workflow)).not.toMatch(/secrets\.|SUPABASE|OPENAI|RAILWAY/);
    expect(code(workflow)).not.toMatch(/check-public-source-changes|ingest|reindex/i);
  });

  it("pins every action by full SHA, exactly as ci.yml pins it", () => {
    for (const [, ref, rest] of workflow.matchAll(/uses: (\S+)(.*)$/gm)) {
      if (ref.startsWith("./")) continue;
      const [action, sha] = ref.split("@");
      expect(sha, ref).toMatch(/^[0-9a-f]{40}$/);
      const ciPin = new RegExp(`uses: ${action.replace("/", "\\/")}@([0-9a-f]{40})(.*)$`, "m").exec(ciWorkflow);
      expect(ciPin, `${action} is not used in ci.yml`).not.toBeNull();
      expect(`${sha}${rest}`, action).toBe(`${ciPin?.[1]}${ciPin?.[2]}`);
    }
  });

  it("reads the same marker it writes", () => {
    const markers = [...workflow.matchAll(/<!-- source-watch-report:v1 -->/g)];
    expect(markers.length).toBe(2);
  });
});
