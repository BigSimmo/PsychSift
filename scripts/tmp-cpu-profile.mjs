// TEMPORARY (draft profiling PR, removed before ready): sample a JS CPU profile of desktop "/" load.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const [baseUrl, outDir, runs = "3"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
for (let i = 0; i < Number(runs); i += 1) {
  const context = await browser.newContext({ viewport: { width: 1350, height: 940 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  await page.goto(`${baseUrl}/?pwa-dev=0`, { waitUntil: "load" });
  await page.waitForTimeout(5000);
  const { profile } = await cdp.send("Profiler.stop");
  const longTasks = await page.evaluate(() =>
    performance.getEntriesByType("longtask").map((e) => [e.startTime, e.duration]),
  );
  writeFileSync(path.join(outDir, `cpu-${i}.cpuprofile`), JSON.stringify(profile));
  writeFileSync(path.join(outDir, `cpu-${i}.meta.json`), JSON.stringify({ t0, longTasks }));
  await context.close();
}
await browser.close();
