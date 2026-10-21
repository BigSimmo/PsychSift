// TEMPORARY (draft profiling PR, removed before ready): sample a JS CPU profile of desktop "/" load.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const [baseUrl, outDir, runs = "3"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
const variants = [
  { name: "desktop-root", route: "/", mobile: false },
  { name: "mobile-root", route: "/", mobile: true },
  { name: "mobile-documents-search", route: "/documents/search", mobile: true },
];
for (const variant of variants)
  for (let i = 0; i < Number(runs); i += 1) {
    const context = await browser.newContext(
      variant.mobile
        ? {
            viewport: { width: 412, height: 823 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 1.75,
            userAgent:
              "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36",
          }
        : { viewport: { width: 1350, height: 940 } },
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (variant.mobile) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
    const t0 = Date.now();
    await page.goto(`${baseUrl}${variant.route}?pwa-dev=0`, { waitUntil: "load" });
    await page.waitForTimeout(variant.mobile ? 12000 : 5000);
    const { profile } = await cdp.send("Profiler.stop");
    const longTasks = await page.evaluate(() =>
      performance.getEntriesByType("longtask").map((e) => [e.startTime, e.duration]),
    );
    writeFileSync(path.join(outDir, `${variant.name}-${i}.cpuprofile`), JSON.stringify(profile));
    writeFileSync(path.join(outDir, `${variant.name}-${i}.meta.json`), JSON.stringify({ t0, longTasks }));
    await context.close();
  }
await browser.close();
