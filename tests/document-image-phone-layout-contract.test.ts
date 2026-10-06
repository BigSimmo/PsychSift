import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Phone layout contract for the document viewer's image cards.
 *
 * The defect this locks: the rail `<aside>` declared `grid` with `md:grid-cols-2`
 * and `lg:grid-cols-1` but no base track. Below `md` that is an implicit
 * `grid-auto-columns: auto` column whose minimum is the min-content of its items,
 * so one wide descendant stretched the single track and every card in the rail
 * inherited the blown-out width. The wide descendant was the `SignedImage` frame:
 * CSS `aspect-ratio` transfers size constraints across axes, so `min-h-40` (160px)
 * on a 3:1 table crop became a *minimum width* of 480px.
 *
 * Measured in Chromium at a 393px viewport: the card rendered 560px wide, and
 * `html { overflow-x: clip }` (globals.css) amputated the remainder rather than
 * making it scrollable — the missing table columns were unreachable by any
 * gesture. Each of the three guards below independently prevents it; they are all
 * asserted because the failure is invisible in jsdom, silent in review, and only
 * reproduces on a narrow viewport with a wide crop.
 *
 * jsdom performs no layout, so this is a source contract. The behavioural proof
 * lives in the phone Chromium journey in `tests/ui-smoke.spec.ts`.
 */

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const railSource = read("src/components/document-viewer/document-rail-panels.tsx");
const visualsSource = read("src/components/document-viewer/document-visuals-panel.tsx");
const viewerSource = read("src/components/DocumentViewer.tsx");
const contentPanelsSource = read("src/components/document-viewer/document-viewer-content-panels.tsx");
const sourcePanelsSource = read("src/components/document-viewer/source-panels.tsx");
const demoDataSource = read("src/lib/demo-data.ts");

describe("document viewer phone layout", () => {
  it("caps the rail grid track at every breakpoint, including the base one", () => {
    const railClass = railSource.match(/"min-w-0 grid[^"]*"/)?.[0];
    expect(railClass, "rail <aside> class list not found — update this contract").toBeTruthy();
    // `grid-cols-1` compiles to repeat(1, minmax(0,1fr)); an implicit auto track does not.
    expect(railClass).toMatch(/\bgrid-cols-1\b/);
    expect(railClass).toMatch(/\bmd:grid-cols-2\b/);
  });

  it("keeps every direct rail grid item unable to widen its track", () => {
    // A grid item defaults to `min-width: auto` (its own min-content), which is
    // the escape hatch the base track fix closes from the other side. Every
    // direct child of the rail grid is marked by `md:col-span-2`, so that token
    // identifies the items without this contract having to name each component —
    // a new rail section is caught the moment it is added.
    const itemClassLists = railSource.match(/"[^"]*\bmd:col-span-2\b[^"]*"/g) ?? [];
    expect(itemClassLists.length).toBeGreaterThanOrEqual(4);
    for (const classList of itemClassLists) {
      expect(classList, `rail grid item is missing min-w-0: ${classList}`).toMatch(/\bmin-w-0\b/);
    }
  });

  it("caps the main reading column's grid, which now carries the wide table crops", () => {
    // "Tables and diagrams" moved out of the rail and under the indexed source
    // text, so the blowout hazard moved with it: this inner column is a grid, and
    // without an explicit base track it is the same implicit min-content column.
    const columnClass = contentPanelsSource.match(/"grid min-w-0 grid-cols-1 gap-4[^"]*"/)?.[0];
    expect(columnClass, "main reading column grid class list not found — update this contract").toBeTruthy();
    expect(columnClass).toMatch(/\bgrid-cols-1\b/);
    expect(columnClass).toMatch(/\bmin-w-0\b/);
    // ...and the panel itself must not widen that track from the item side.
    const visualsClass = visualsSource.match(/"group min-w-0 scroll-mt-[^"]*"/)?.[0];
    expect(visualsClass, "visuals panel class list not found — update this contract").toBeTruthy();
    expect(visualsClass).toMatch(/\bmin-w-0\b/);
  });

  it("caps the outer document body grid at the base breakpoint too", () => {
    const bodyClass = viewerSource.match(/"mx-auto grid max-w-\[1440px\][^"]*"/)?.[0];
    expect(bodyClass, "document body <section> class list not found — update this contract").toBeTruthy();
    expect(bodyClass).toMatch(/\bgrid-cols-1\b/);
    expect(bodyClass).toMatch(/\blg:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,22rem\)\]/);
  });

  it("never pairs a min-height with an explicit aspect ratio on a document image frame", () => {
    // The transferred minimum is the whole bug: min-height x ratio becomes an
    // intrinsic minimum width. The frame's height is already definite from the
    // ratio, so the floor buys nothing and costs the layout.
    const imageBlock = sourcePanelsSource.match(/<SignedImage[\s\S]*?\/>/)?.[0];
    expect(imageBlock, "DocumentImage SignedImage call not found — update this contract").toBeTruthy();
    // The crop's own ratio still drives the frame...
    expect(imageBlock).toMatch(/aspectRatio=\{ratio\}/);
    expect(sourcePanelsSource).toMatch(/const ratio = imageAspectRatio\(image\);/);
    // ...but no min-height may accompany it.
    expect(imageBlock).not.toMatch(/\bmin-h-\d/);
    expect(imageBlock).toMatch(/className="max-h-\[70dvh\] w-full"/);
  });

  it("ships demo crops with real intrinsic sizes so a browser gate can reproduce wide-crop layout", () => {
    // Without width/height the demo corpus renders every crop at the 4:3
    // fallback, which fits any phone — so no Chromium journey could ever have
    // caught the wide-crop blowout.
    expect(demoDataSource).toMatch(/storage_path: "\/demo-documents\/clozapine-table\.png"/);
    expect(demoDataSource).toMatch(/width: 1520,\n\s*height: 720,/);
    expect(demoDataSource).toMatch(/width: 1520,\n\s*height: 840,/);
  });

  it("labels the full-screen route for the real clozapine demo crop ratio", () => {
    // Production UI failed when the threshold was 2.2 and the demo was 2.11:1 —
    // the expand control never rendered, so the phone journey timed out.
    expect(sourcePanelsSource).toMatch(/ratio >= 2\.1/);
    expect(sourcePanelsSource).not.toMatch(/ratio >= 2\.2/);
  });
});
