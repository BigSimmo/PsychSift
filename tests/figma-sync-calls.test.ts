import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AREAS,
  CALL_CHAR_LIMIT,
  CHROME_MODE,
  buildIconRegistry,
  codePointLength,
  compactCapture,
  componentsCallText,
  figmaCallText,
  iconCalls,
  jsonAscii,
  planPageCalls,
  pyFloatString,
  pyRound,
  pyRoundDigits,
  shrinkSvg,
  swapCallText,
} from "../scripts/figma-sync/calls-lib.mjs";
import buildScreens from "../scripts/figma-sync/figma/builder.mjs";
import buildComponents from "../scripts/figma-sync/figma/components.mjs";
import swapScreens from "../scripts/figma-sync/figma/swap.mjs";

const jobsFile = path.resolve(__dirname, "../scripts/figma-sync/jobs.json");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => unknown;

const lucideMenu =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-icon="menu" aria-hidden="true"><path d="M4.1234 6h16" stroke-linecap="round"></path><path d="M4 12h16"></path></svg>';

function capture(overrides: Record<string, unknown> = {}) {
  return {
    w: 390,
    h: 844,
    bg: "#F8FAFC",
    svgs: { "menu-20": { m: lucideMenu } },
    tree: [
      {
        t: "f",
        n: "header",
        x: 0,
        y: 0,
        w: 390,
        h: 72.04,
        bg: "#EFECF8",
        br: 14,
        sh: [{ c: "#00000019", x: 0, y: 1, b: 3, s: 0, i: 0 }],
        ch: [
          { t: "s", k: "menu-20", c: "#55627A", x: 16, y: 26, w: 20, h: 20 },
          { t: "x", s: "My Day", x: 48, y: 27, w: 54.3, h: 17, c: "#0A1220", f: 16, wt: 600, lh: null, ls: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

const builderFn = buildScreens as (figma: unknown, data: unknown) => Promise<unknown>;

function plan(extra: Record<string, unknown> = {}) {
  return planPageCalls({
    jobs: [
      { id: "my-day--today--390", name: "Today" },
      { id: "my-day--today--1280", name: "Today" },
      { id: "chrome--side-menu--390", name: "Side menu" },
      { id: "admin--pay--390", name: "Pay" },
    ],
    current: [
      { file: "my-day--today--390.json", data: capture() },
      { file: "my-day--today--1280.json", data: capture({ w: 1280, h: 800 }) },
      { file: "chrome--side-menu--390.json", data: capture() },
    ],
    builderFn,
    ...extra,
  });
}

describe("Python-compatible number helpers", () => {
  it("rounds halves to the even integer like Python", () => {
    expect([0.5, 1.5, 2.5, 3.4, 3.6, -0.5].map(pyRound)).toEqual([0, 2, 2, 3, 4, 0]);
  });

  it("rounds exact ties to the even digit and everything else normally", () => {
    expect(pyRoundDigits(0.125, 2)).toBe(0.12);
    expect(pyRoundDigits(0.375, 2)).toBe(0.38);
    expect(pyRoundDigits(2.25, 1)).toBe(2.2);
    expect(pyRoundDigits(0.0625, 3)).toBe(0.062);
    expect(pyRoundDigits(1.2345, 2)).toBe(1.23);
    expect(pyRoundDigits(0.6667, 3)).toBe(0.667);
  });

  it("prints whole floats with one decimal like Python and leaves other numbers alone", () => {
    expect(pyFloatString(3)).toBe("3.0");
    expect(pyFloatString(3.5)).toBe("3.5");
  });

  it("counts code points and escapes non-ASCII like Python's json.dumps", () => {
    expect(codePointLength("a\u{1F600}b")).toBe(3);
    expect(jsonAscii(["Today · Phone", "\u{1F600}"])).toBe('["Today \\u00b7 Phone","\\ud83d\\ude00"]');
  });
});

describe("icons", () => {
  it("shrinks a captured SVG to the smallest form the builder still reads the same", () => {
    const shrunk = shrinkSvg(lucideMenu);
    expect(shrunk).toContain('stroke="#000000"');
    expect(shrunk).not.toContain("currentColor");
    expect(shrunk).not.toContain("data-icon");
    expect(shrunk).not.toContain("aria-hidden");
    expect(shrunk).not.toContain("></path>");
    expect(shrunk).toContain('d="M4.12 6h16"');
  });

  it("names icons once across captures and keeps old names stable when earlier captures are given", () => {
    const first = { file: "a--b--390.json", data: capture() };
    const second = {
      file: "a--c--390.json",
      data: capture({
        svgs: { "menu-20": { m: lucideMenu }, "x-16": { m: lucideMenu.replace('d="M4 12h16"', 'd="M1 1h2"') } },
      }),
    };
    const fresh = buildIconRegistry([first, second]);
    expect(fresh.icons.map(([name]: [string, string]) => name)).toEqual(["menu-20", "x-20"]);

    const incremental = buildIconRegistry([second], [first]);
    expect(incremental.icons.map(([name]: [string, string]) => name)).toEqual(["x-20"]);
    expect(Object.values(incremental.perFile.get(second))).toEqual(["menu-20", "x-20"]);
  });

  it("splits icons into numbered calls and escapes them as ASCII", () => {
    const calls = iconCalls(
      [
        ["a-20", "<svg>" + "x".repeat(30) + "</svg>"],
        ["b-20", "<svg>·" + "x".repeat(30) + "</svg>"],
      ],
      40,
    );
    expect(calls.map((call: { name: string }) => call.name)).toEqual(["icons-01.js", "icons-02.js"]);
    expect(calls[1].text.startsWith('const I=[["b-20","<svg>\\u00b7')).toBe(true);
    expect(calls[0].text).toContain("icon/");
  });
});

describe("compactCapture", () => {
  it("builds shared colour, box and text tables and points the nodes at them", () => {
    const compact = compactCapture(capture(), { "menu-20": 0 }, 844);
    expect(compact.c).toEqual(["#efecf8", "#55627a", "#0a1220"]);
    expect(compact.s).toEqual([{ b: 0, r: 14, s: 1 }]);
    expect(compact.t).toEqual([[16, 600, 0, null, 0, 0, 0]]);
    expect(compact.n).toEqual([
      [
        1,
        "header",
        0,
        0,
        390,
        72,
        0,
        [
          [0, 16, 26, 20, 20, 1],
          ["My Day", 48, 27, 54.3, 17, 0, 2, 0],
        ],
      ],
    ]);
  });

  it("drops icons it has no name for, nodes below the page, and empty groups", () => {
    const compact = compactCapture(
      capture({
        tree: [
          { t: "s", k: "unknown", c: "#000000", x: 0, y: 0, w: 4, h: 4 },
          { t: "g", n: "empty", ch: [{ t: "s", k: "unknown", c: null, x: 0, y: 0, w: 4, h: 4 }] },
          { t: "x", s: "below", x: 0, y: 900, w: 10, h: 10, c: "#111111", f: 12, wt: 400, lh: 16, ls: 0 },
        ],
      }),
      {},
      844,
    );
    expect(compact.n).toEqual([]);
  });

  it("sets text flags for wrapping, alignment, ellipsis and input values", () => {
    const text = (extra: Record<string, unknown>) => ({
      t: "x",
      s: "a",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      c: "#111111",
      f: 12,
      wt: 400,
      lh: 16,
      ls: 0,
      ...extra,
    });
    const compact = compactCapture(
      capture({ tree: [text({ wrap: 1, al: "c" }), text({ al: "r", el: 1 }), text({ vc: 1 })] }),
      {},
      844,
    );
    expect(compact.n.map((node: unknown[]) => node[7])).toEqual([3, 12, 16]);
  });
});

describe("planPageCalls", () => {
  it("groups screens into one call per page and mode, in the order of the jobs file", () => {
    const result = plan();
    expect(result.pageCalls.map((call: { name: string }) => call.name)).toEqual(["page-7_5-1.js", "page-7_4-1.js"]);
    expect(result.pageCalls[0].sections).toEqual(["Today"]);
    expect(result.missing).toEqual(["admin--pay"]);
    const data = JSON.parse(/^const D=(.*);\n/.exec(result.pageCalls[0].text)![1]);
    expect(data).toMatchObject({ page: "7:5", mode: "My Day", y0: 0 });
    expect(data.sections[0].frames.map((frame: { label: string }) => frame.label)).toEqual([
      "Today · Phone 390",
      "Today · Desktop 1280",
    ]);
  });

  it("starts new sections below what is already on a page and reports where each page now ends", () => {
    const result = plan({ yStart: { "7:5": 6463 } });
    const data = JSON.parse(/^const D=(.*);\n/.exec(result.pageCalls[0].text)![1]);
    expect(data.y0).toBe(6463 + 160);
    expect(data.sections[0].y).toBe(6463 + 160);
    expect(result.yEnd["7:5"]).toBe(6463 + 160 + 844 + 200);
    expect(result.yEnd["7:4"]).toBe(844 + 200);
  });

  it("carries forward the bottom edge of pages this run does not draw", () => {
    const result = plan({ yStart: { "7:5": 6463, "7:14": 9000 } });
    expect(result.yEnd["7:14"]).toBe(9000);
  });

  it("splits a section that is too big into one frame per call that continues the same section", () => {
    const result = plan({ chunkChars: 400 });
    const pageCalls = result.pageCalls.filter((call: { name: string }) => call.name.startsWith("page-7_5"));
    expect(pageCalls.length).toBe(2);
    const second = JSON.parse(/^const D=(.*);\n/.exec(pageCalls[1].text)![1]);
    expect(second.sections[0]).toMatchObject({ name: "Today", cont: 1 });
  });

  it("prepends the data to the minified builder, which is valid inside an async function", () => {
    const text = plan().pageCalls[0].text as string;
    expect(text.length).toBeLessThan(CALL_CHAR_LIMIT);
    expect(() => new AsyncFunction("figma", text)).not.toThrow();
    expect(text).not.toContain("export default");
  });

  it("fails clearly for an area or chrome overlay it has no Figma page for", () => {
    const build = (id: string) =>
      planPageCalls({ jobs: [{ id, name: "X" }], current: [{ file: `${id}.json`, data: capture() }], builderFn });
    expect(() => build("mystery--x--390")).toThrow(/No Figma page is set for the area "mystery"/);
    expect(() => build("chrome--x--390")).toThrow(/No Figma mode is set for the chrome overlay "x"/);
  });
});

describe("Figma-runtime scripts", () => {
  it("serialise to call text that parses inside an async function and keeps figma as a free global", () => {
    for (const text of [
      componentsCallText(buildComponents),
      swapCallText(swapScreens, "7:14"),
      figmaCallText(builderFn, "{}"),
    ]) {
      expect(text.length).toBeLessThan(CALL_CHAR_LIMIT);
      expect(() => new AsyncFunction("figma", text)).not.toThrow();
      expect(text).toContain("figma.");
    }
    expect(swapCallText(swapScreens, "7:14").startsWith('const PAGE_ID="7:14";\n')).toBe(true);
  });

  it("refuses a page id that is not a Figma page id, so nothing odd is put into the call", () => {
    expect(() => swapCallText(swapScreens, '7:14"; evil()')).toThrow(/Not a Figma page id/);
  });

  it("refuses a script that does not have the expected shape", () => {
    expect(() =>
      figmaCallText(async function other(a: unknown) {
        return a;
      } as never),
    ).toThrow(/must be/);
    expect(() => figmaCallText(buildScreens)).toThrow(/needs a value for D/);
  });

  it("keep the Node-only and module-only features out of the Figma runtime", () => {
    for (const file of ["builder.mjs", "components.mjs", "swap.mjs"]) {
      const source = fs.readFileSync(path.resolve(__dirname, "../scripts/figma-sync/figma", file), "utf8");
      expect(source).not.toMatch(/^import\s/m);
      expect(source).not.toMatch(/\brequire\(|\bprocess\.|node:/);
    }
  });
});

describe("jobs.json", () => {
  const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as Array<{
    id: string;
    area: string;
    name: string;
    url: string;
    w: number;
  }>;

  it("lists each screen once, with an id that matches its area and width", () => {
    expect(new Set(jobs.map((job) => job.id)).size).toBe(jobs.length);
    for (const job of jobs) {
      const [area, slug, width] = job.id.split("--");
      expect(slug, job.id).toBeTruthy();
      expect(area, job.id).toBe(job.area);
      expect(Number(width), job.id).toBe(job.w);
      expect(job.url.startsWith("/"), job.id).toBe(true);
    }
  });

  it("maps every area to a Figma page and every chrome overlay to a mode", () => {
    for (const job of jobs) {
      if (job.area === "chrome") expect(CHROME_MODE, job.id).toHaveProperty(job.id.split("--")[1]);
      else expect(AREAS, job.id).toHaveProperty(job.area);
    }
  });
});
