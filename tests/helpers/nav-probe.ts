// TEMPORARY diagnostic probe (#3270 follow-up). Never merge to main.
// Records every history mutation, Next RSC request and frame navigation so a
// rare "link tap never navigated" failure prints its own evidence to the CI log.
import type { Page } from "playwright/test";

type Entry = { t: number; kind: string; detail: string };

export async function installNavProbe(page: Page) {
  const started = Date.now();
  const log: Entry[] = [];
  const add = (kind: string, detail: string) => log.push({ t: Date.now() - started, kind, detail });
  await page.addInitScript(() => {
    const w = window as unknown as { __navlog: string[] };
    w.__navlog = [];
    const t0 = Date.now();
    for (const name of ["pushState", "replaceState"] as const) {
      const original = history[name];
      history[name] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
        const stack = (new Error().stack ?? "")
          .split("\n")
          .slice(2, 7)
          .map((l) => l.trim())
          .join(" | ");
        const tag = data && typeof data === "object" && "__NA" in (data as object) ? "next" : "external";
        w.__navlog.push(`${Date.now() - t0}ms ${name}[${tag}] ${String(url ?? "")} :: ${stack}`);
        return original.call(this, data, unused, url);
      } as History[typeof name];
    }
    addEventListener("popstate", () => w.__navlog.push(`${Date.now() - t0}ms popstate ${location.href}`));
    addEventListener("pagehide", () => w.__navlog.push(`${Date.now() - t0}ms pagehide ${location.href}`));
    addEventListener(
      "click",
      (e) => {
        const a = (e.target as Element | null)?.closest?.("a");
        w.__navlog.push(
          `${Date.now() - t0}ms click ${a ? `a[href=${a.getAttribute("href")}] defaultPrevented=${e.defaultPrevented}` : (e.target as Element)?.tagName}`,
        );
      },
      true,
    );
    addEventListener("click", (e) => {
      w.__navlog.push(`${Date.now() - t0}ms click-bubbled defaultPrevented=${e.defaultPrevented}`);
    });
  });
  const isRsc = (headers: Record<string, string>) => headers["rsc"] === "1";
  page.on("request", (r) => {
    if (isRsc(r.headers()) || r.isNavigationRequest())
      add(
        "req",
        `${r.method()} ${r.url()} rsc=${isRsc(r.headers())} prefetch=${r.headers()["next-router-prefetch"] ?? ""}`,
      );
  });
  page.on("requestfinished", async (r) => {
    if (!isRsc(r.headers()) && !r.isNavigationRequest()) return;
    const res = await r.response().catch(() => null);
    add("done", `${res?.status() ?? "?"} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (isRsc(r.headers()) || r.isNavigationRequest()) add("FAIL", `${r.url()} ${r.failure()?.errorText ?? ""}`);
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) add("framenav", f.url());
  });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") add(`console.${m.type()}`, m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => add("pageerror", String(e).slice(0, 300)));
  return {
    mark: (label: string) => add("mark", label),
    reset: () => log.splice(0, log.length),
    async dump(label: string) {
      const inPage = await page
        .evaluate(() => (window as unknown as { __navlog?: string[] }).__navlog ?? [])
        .catch(() => ["<page log unavailable>"]);
      console.log(
        `\n===NAVPROBE ${label}===\nurl=${page.url()}\n-- node --\n${log.map((e) => `${e.t}ms ${e.kind} ${e.detail}`).join("\n")}\n-- page --\n${inPage.join("\n")}\n===END NAVPROBE===\n`,
      );
    },
  };
}
