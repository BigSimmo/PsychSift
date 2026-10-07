#!/usr/bin/env node
/**
 * measure-work-mode-speed — phone-profile timings for the work-mode pages.
 *
 * Opens each route in Chromium on a mid-range phone profile (4x CPU slowdown,
 * 150 ms round trip, 1.6 Mbit/s down, 412 px wide) against an ALREADY RUNNING
 * local production server, and reports per route:
 *   - cold: first visit with an empty cache (LCP, JS bytes over the wire,
 *     long-task blocking time, request count)
 *   - warm: the same page again with the cache kept
 *   - tap:  the slowest tap-to-next-paint while opening and closing More,
 *     an INP-style figure
 * Each figure is the median of --runs (default 3).
 *
 * It never starts a server, never touches a provider, and writes only to the
 * file given by --out. Start the app first (offline demo profile), e.g.
 *   NEXT_PUBLIC_DEMO_MODE=true RAG_PROVIDER_MODE=offline npx next start -p 4310
 *   node scripts/measure-work-mode-speed.mjs --base http://127.0.0.1:4310 --out speed.json
 *
 * Used by the work-mode speed review to set and re-check its phone budgets.
 * The enforced half of that budget is the per-route JS in bundle-budget.json
 * (npm run check:bundle-budget). This script is not part of CI.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = arg("base", "http://127.0.0.1:4310");
const runs = Number(arg("runs", "3"));
const out = arg("out", null);
const routes = (arg("routes", null) ?? "/my-day,/my-day/week,/roster,/roster/shifts,/open-shifts,/on-call,/on-call/handover,/teaching,/teaching/assessments,/cme,/admin").split(",");

const PHONE = { width: 412, height: 860 };
const NETWORK = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_SLOWDOWN = 4;

const median = (values) => {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

const OBSERVERS = `(() => {
  window.__speed = { lcp: 0, blocking: 0, events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__speed.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__speed.blocking += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__speed.events.push(e.duration); }).observe({ type: "event", durationThreshold: 16, buffered: true });
})();`;

async function visit(page, cdp, url) {
  // encodedDataLength is what crossed the wire; a warm visit served from the
  // HTTP cache counts close to zero, which is the point of the warm figure.
  const scripts = new Set();
  const sizes = new Map();
  let requests = 0;
  const onReceived = (event) => {
    requests += 1;
    if (event.type === "Script") scripts.add(event.requestId);
  };
  const onFinished = (event) => sizes.set(event.requestId, event.encodedDataLength);
  cdp.on("Network.responseReceived", onReceived);
  cdp.on("Network.loadingFinished", onFinished);
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(2500);
  cdp.off("Network.responseReceived", onReceived);
  cdp.off("Network.loadingFinished", onFinished);
  let jsBytes = 0;
  for (const id of scripts) jsBytes += sizes.get(id) ?? 0;
  const s = await page.evaluate(() => window.__speed);
  return { lcpMs: Math.round(s.lcp), blockingMs: Math.round(s.blocking), jsKB: Math.round(jsBytes / 1024), requests };
}

async function tapMore(page) {
  const more = page.getByRole("button", { name: /^More$/ }).first();
  if (!(await more.count())) return null;
  await page.evaluate(() => (window.__speed.events = []));
  await more.click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const events = await page.evaluate(() => window.__speed.events);
  return events.length ? Math.round(Math.max(...events)) : 0;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = {};
for (const route of routes) {
  const cold = [];
  const warm = [];
  const taps = [];
  for (let i = 0; i < runs; i += 1) {
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(OBSERVERS);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", NETWORK);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
    cold.push(await visit(page, cdp, base + route));
    taps.push(await tapMore(page));
    warm.push(await visit(page, cdp, base + route));
    await context.close();
  }
  const pick = (list, key) => median(list.map((r) => r[key]));
  results[route] = {
    coldLcpMs: pick(cold, "lcpMs"),
    coldJsKB: pick(cold, "jsKB"),
    coldBlockingMs: pick(cold, "blockingMs"),
    coldRequests: pick(cold, "requests"),
    warmLcpMs: pick(warm, "lcpMs"),
    warmJsKB: pick(warm, "jsKB"),
    tapMs: median(taps),
  };
  console.log(route.padEnd(24), JSON.stringify(results[route]));
}
await browser.close();
if (out) writeFileSync(out, `${JSON.stringify({ measuredAt: new Date().toISOString(), base, runs, results }, null, 2)}\n`);
