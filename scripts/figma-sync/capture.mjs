#!/usr/bin/env node
/**
 * Capture live PsychSift work-mode screens as a compact layer tree, ready for `build-calls.mjs`.
 *
 * For each screen in the jobs file it opens the route in a real browser at the stated width, lets the page
 * settle, then walks the page and records every visible box, piece of text, icon and image with its position,
 * colours and type. One JSON file per screen (and a PNG when the job asks for one) goes to the output folder.
 *
 * Usage:
 *   npm run ensure                                         # start/verify THIS project's server
 *   node scripts/figma-sync/capture.mjs [jobs.json] [outDir] [options]
 *
 * Options:
 *   --base-url URL    server to capture (else the BASE environment variable, else the URL `npm run ensure` prints)
 *   --skip-existing   skip screens whose JSON is already in outDir, so a stopped run can be resumed
 *   --limit N         capture at most N screens this run (about 12 is gentle on the dev server)
 *   --only a,b,c      capture only these job ids
 *
 * A job may set `waitUntil` (default "networkidle") and `wait` (extra milliseconds to settle, default 800). A page that
 * never goes network-idle, such as /roster/today, uses `"waitUntil": "load", "wait": 4000`.
 *
 * Defaults: jobs file scripts/figma-sync/jobs.json, outDir .tmp-visual/figma-sync/captures (git-ignored).
 * The dev server compiles each route the first time it is opened and can run out of memory after many routes,
 * so capture in chunks of about 12 and run `npm run ensure` again if the server has stopped.
 *
 * Reads only the local development server. Never assumes localhost:3000: it refuses to capture unless
 * /api/local-project-id confirms this project (AGENTS.md local server safety). Set CHROMIUM_PATH to use a
 * browser other than the one Playwright installed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { localProjectId } from "../../src/lib/local-server-utils.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const expectedProjectId = localProjectId(projectRoot);

const { values, positionals } = parseArgs({
  options: {
    "base-url": { type: "string" },
    "skip-existing": { type: "boolean", default: false },
    limit: { type: "string" },
    only: { type: "string" },
  },
  allowPositionals: true,
  strict: true,
});
const jobsFile = path.resolve(positionals[0] ?? path.join(here, "jobs.json"));
const outDir = path.resolve(positionals[1] ?? path.join(projectRoot, ".tmp-visual", "figma-sync", "captures"));

function fail(message) {
  console.error(`[figma-sync:capture] ${message}`);
  process.exit(1);
}

function requestText(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "" });
    });
  });
}

function baseUrlFromEnsure() {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "ensure-local-server.mjs"), "--print-url"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
    },
  );
  if (result.status !== 0) fail(result.stderr || result.stdout || "npm run ensure could not print a URL");
  const line = (result.stdout || "")
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => /^https?:\/\//.test(text));
  if (!line) fail("npm run ensure did not print a URL");
  return line.replace(/\/$/, "");
}

/** AGENTS.md local server safety: never attach to another project's server. */
async function assertProjectIdentity(baseUrl) {
  const { status, body } = await requestText(`${baseUrl}/api/local-project-id`);
  if (status !== 200) {
    fail(
      `Refusing to capture: ${baseUrl}/api/local-project-id answered HTTP ${status}. Run \`npm run ensure\` and pass its URL.`,
    );
  }
  let projectId;
  try {
    projectId = String(JSON.parse(body)?.projectId ?? "").trim();
  } catch {
    fail("Refusing to capture: /api/local-project-id did not answer with JSON.");
  }
  if (projectId !== expectedProjectId)
    fail(`Refusing to capture: ${baseUrl} belongs to project "${projectId}", not this one.`);
}

const BASE = (values["base-url"] ?? process.env.BASE ?? baseUrlFromEnsure()).replace(/\/$/, "");
await assertProjectIdentity(BASE);

let jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
if (values.only) {
  const wanted = new Set(values.only.split(",").map((id) => id.trim()));
  jobs = jobs.filter((job) => wanted.has(job.id));
}
fs.mkdirSync(outDir, { recursive: true });
if (values["skip-existing"]) jobs = jobs.filter((job) => !fs.existsSync(path.join(outDir, `${job.id}.json`)));
if (values.limit !== undefined) {
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) fail("--limit must be a whole number of at least 1.");
  jobs = jobs.slice(0, limit);
}
if (!jobs.length) {
  console.log("[figma-sync:capture] Nothing to capture.");
  process.exit(0);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function prep(page) {
  // Turn pseudo-elements into real spans so the walk sees them.
  await page.evaluate(() => {
    const st = document.createElement("style");
    st.textContent = ".__nb::before{content:none!important}.__na::after{content:none!important}";
    document.head.appendChild(st);
    const els = Array.from(document.body.querySelectorAll("*"));
    for (const el of els) {
      if (el.closest("svg")) continue;
      for (const pseudo of ["::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo);
        const c = cs.content;
        if (!c || c === "none" || c === "normal" || cs.display === "none") continue;
        const span = document.createElement("span");
        let css = "";
        for (let i = 0; i < cs.length; i++) {
          const p = cs[i];
          if (p.startsWith("transition") || p.startsWith("animation")) continue;
          css += `${p}:${cs.getPropertyValue(p)};`;
        }
        span.style.cssText = css;
        span.setAttribute("data-pseudo", pseudo);
        const m = c.match(/^"(.*)"$/s);
        span.textContent = m
          ? m[1].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          : "";
        if (pseudo === "::before") {
          el.insertBefore(span, el.firstChild);
          el.classList.add("__nb");
        } else {
          el.appendChild(span);
          el.classList.add("__na");
        }
      }
    }
  });
}

async function walk(page, rootSel) {
  return page.evaluate((rootSel) => {
    const root = rootSel ? document.querySelector(rootSel) : document.body;
    const W = document.documentElement.clientWidth;
    const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const svgs = {};
    const parseColor = (c) => {
      if (!c) return null;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        const m2 = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
        if (!m2) return null;
        const a = m2[4] === undefined ? 1 : +m2[4];
        if (a === 0) return null;
        return [Math.round(m2[1] * 255), Math.round(m2[2] * 255), Math.round(m2[3] * 255), +a.toFixed(3)];
      }
      const p = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      const a = p.length > 3 ? p[3] : 1;
      if (a === 0) return null;
      return [p[0], p[1], p[2], +a.toFixed(3)];
    };
    const hex = (c) =>
      c &&
      "#" +
        c
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("") +
        (c[3] < 1
          ? Math.round(c[3] * 255)
              .toString(16)
              .padStart(2, "0")
          : "");
    const R = (v) => Math.round(v * 10) / 10;
    const visibleBox = (r) => r.width > 0.5 && r.height > 0.5 && r.right > 0 && r.left < W && r.bottom > 0;
    const shadows = (s) => {
      if (!s || s === "none") return null;
      const out = [];
      for (const part of s.split(/,(?![^(]*\))/)) {
        const col = part.match(/(rgba?\([^)]+\)|color\([^)]+\))/);
        const nums = part
          .replace(/(rgba?\([^)]+\)|color\([^)]+\))/, "")
          .trim()
          .split(/\s+/)
          .filter((x) => x && x !== "inset");
        const c = parseColor(col?.[1]);
        if (!c) continue;
        const [x, y, b, sp] = nums.map((n) => parseFloat(n) || 0);
        out.push({ c: hex(c), x, y, b, s: sp || 0, i: /inset/.test(part) ? 1 : 0 });
      }
      return out.length ? out : null;
    };
    const gradient = (bi) => {
      if (!bi || bi === "none" || !bi.includes("gradient")) return null;
      const m = bi.match(/linear-gradient\((.*)\)$/s);
      if (!m) return { raw: bi.slice(0, 200) };
      const parts = m[1].split(/,(?![^(]*\))/).map((s) => s.trim());
      let angle = 180;
      if (/deg$/.test(parts[0])) angle = parseFloat(parts.shift());
      else if (/^to /.test(parts[0])) {
        const d = parts.shift();
        angle = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 }[d] ?? 180;
      }
      const stops = parts.map((p, i, arr) => {
        const col = p.match(/(rgba?\([^)]+\)|color\([^)]+\))/);
        const pos = p.replace(col?.[0] ?? "", "").trim();
        return {
          c: hex(parseColor(col?.[1]) || [0, 0, 0, 0]) || "#00000000",
          p: pos.endsWith("%") ? parseFloat(pos) / 100 : i / Math.max(1, arr.length - 1),
        };
      });
      return { a: angle, st: stops };
    };
    let iconSeq = 0;
    const iconKey = (svg, r) => {
      const clone = svg.cloneNode(true);
      const col = getComputedStyle(svg).color;
      // Resolve currentColor and computed fills/strokes into black placeholders.
      const all = [clone, ...clone.querySelectorAll("*")];
      const orig = [svg, ...svg.querySelectorAll("*")];
      all.forEach((n, i) => {
        const cs = getComputedStyle(orig[i]);
        if (["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"].includes(n.tagName)) {
          const f = parseColor(cs.fill);
          const s = parseColor(cs.stroke);
          const same = (a) => a && hex(a) === hex(parseColor(col));
          n.setAttribute("fill", f ? (same(f) ? "#000000" : hex(f)) : "none");
          n.setAttribute("stroke", s ? (same(s) ? "#000000" : hex(s)) : "none");
          if (s) n.setAttribute("stroke-width", cs.strokeWidth);
          if (cs.strokeLinecap) n.setAttribute("stroke-linecap", cs.strokeLinecap);
          if (cs.strokeLinejoin) n.setAttribute("stroke-linejoin", cs.strokeLinejoin);
          if (+cs.opacity < 1) n.setAttribute("opacity", cs.opacity);
        }
        n.removeAttribute("class");
        n.removeAttribute("style");
      });
      clone.setAttribute("width", R(r.width));
      clone.setAttribute("height", R(r.height));
      clone.removeAttribute("aria-hidden");
      clone.removeAttribute("focusable");
      for (const a of Array.from(clone.attributes)) if (a.name.startsWith("data-")) clone.removeAttribute(a.name);
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const markup = clone.outerHTML.replace(/\s+/g, " ");
      let key = Object.keys(svgs).find((k) => svgs[k].m === markup);
      if (!key) {
        const cls = svg.getAttribute("class") || "";
        const lm = cls.match(/lucide-([a-z0-9-]+)/);
        let base = lm
          ? lm[1]
          : svg.getAttribute("data-icon") || svg.closest("[data-icon]")?.getAttribute("data-icon") || "glyph";
        key = `${base}-${Math.round(r.width)}`;
        while (svgs[key]) key = `${base}-${Math.round(r.width)}-${++iconSeq}`;
        svgs[key] = { m: markup };
      }
      return { key, c: hex(parseColor(col)) };
    };
    const textOf = (s, tt) => {
      s = s.replace(/\s+/g, " ");
      if (tt === "uppercase") return s.toUpperCase();
      if (tt === "lowercase") return s.toLowerCase();
      if (tt === "capitalize") return s.replace(/\b\w/g, (c) => c.toUpperCase());
      return s;
    };
    const fontOf = (cs) => ({
      f: R(parseFloat(cs.fontSize)),
      wt: +cs.fontWeight || 400,
      mono: /mono/i.test(cs.fontFamily) ? 1 : 0,
      lh: cs.lineHeight === "normal" ? null : R(parseFloat(cs.lineHeight)),
      ls: cs.letterSpacing === "normal" ? 0 : R(parseFloat(cs.letterSpacing)),
      it: cs.fontStyle === "italic" ? 1 : 0,
      ul: cs.textDecorationLine.includes("underline") ? 1 : 0,
    });

    function visualOf(el, cs, r) {
      const bg = parseColor(cs.backgroundColor);
      const gr = gradient(cs.backgroundImage);
      const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
      const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(parseColor);
      const bstyle = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
      const hasB = bw.some((w, i) => w > 0 && bc[i] && bstyle[i] !== "none" && bstyle[i] !== "hidden");
      const sh = shadows(cs.boxShadow);
      const blur = /blur\(([\d.]+)px\)/.exec(cs.backdropFilter || cs.webkitBackdropFilter || "");
      const clip = (cs.overflowX !== "visible" || cs.overflowY !== "visible") && el !== document.body;
      const radii = [
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomRightRadius,
        cs.borderBottomLeftRadius,
      ].map((v) => Math.min(parseFloat(v) || 0, Math.min(r.width, r.height) / 2));
      const op = +cs.opacity;
      if (!bg && !gr && !hasB && !sh && !blur && !clip && op >= 1) return null;
      const v = {};
      if (bg) v.bg = hex(bg);
      if (gr) v.gr = gr;
      if (hasB) {
        const i = bw.findIndex((w, i) => w > 0 && bc[i]);
        const uniform = bw.every((w) => w === bw[0]) && bc.every((c) => hex(c) === hex(bc[0]));
        v.bd = { c: hex(bc[i]), w: uniform ? bw[0] : bw.map((w, j) => (bc[j] && bstyle[j] !== "none" ? w : 0)) };
        if (bstyle[i] === "dashed") v.bd.d = 1;
      }
      if (radii.some((x) => x > 0)) v.br = radii.every((x) => x === radii[0]) ? R(radii[0]) : radii.map(R);
      if (sh) v.sh = sh;
      if (blur) v.bl = +blur[1];
      if (clip) v.clip = 1;
      if (op < 1) v.op = op;
      return v;
    }

    function build(el, ox, oy, depth) {
      // returns list of nodes positioned relative to (ox, oy)
      const out = [];
      for (const child of el.childNodes) {
        if (child.nodeType === 3) {
          const s = child.data;
          if (!s.trim()) continue;
          const pe = child.parentElement;
          const cs = getComputedStyle(pe);
          if (cs.visibility === "hidden") continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0);
          if (!rects.length) continue;
          const b = range.getBoundingClientRect();
          if (!visibleBox(b)) continue;
          const c = parseColor(cs.color);
          if (!c) continue;
          const lines = new Set(rects.map((q) => Math.round(q.top))).size;
          const n = {
            t: "x",
            s: textOf(s.trim() === s ? s : s.replace(/^\s+|\s+$/g, (m) => (m ? " " : "")), cs.textTransform).trim(),
            x: R(b.left + scrollX - ox),
            y: R(b.top + scrollY - oy),
            w: R(b.width),
            h: R(b.height),
            c: hex(c),
            ...fontOf(cs),
          };
          if (lines > 1) {
            n.wrap = 1;
            n.al = cs.textAlign === "center" ? "c" : cs.textAlign === "right" || cs.textAlign === "end" ? "r" : "l";
          }
          if (cs.textOverflow === "ellipsis") n.el = 1;
          out.push(n);
          continue;
        }
        if (child.nodeType !== 1) continue;
        const cel = child;
        const tag = cel.tagName.toLowerCase();
        if (["script", "style", "noscript", "template", "link", "meta"].includes(tag)) continue;
        const cs = getComputedStyle(cel);
        if (cs.display === "none" || (cs.visibility === "hidden" && tag !== "div")) {
          if (cs.display === "none") continue;
        }
        if (+cs.opacity === 0) continue;
        const r = cel.getBoundingClientRect();
        if (tag === "svg") {
          if (!visibleBox(r) || cs.visibility === "hidden") continue;
          const { key, c } = iconKey(cel, r);
          out.push({
            t: "s",
            k: key,
            c,
            x: R(r.left + scrollX - ox),
            y: R(r.top + scrollY - oy),
            w: R(r.width),
            h: R(r.height),
            ...(+cs.opacity < 1 ? { op: +cs.opacity } : {}),
          });
          continue;
        }
        if (tag === "img" || tag === "canvas" || tag === "video") {
          if (!visibleBox(r)) continue;
          out.push({
            t: "i",
            src: cel.currentSrc || cel.src || "",
            x: R(r.left + scrollX - ox),
            y: R(r.top + scrollY - oy),
            w: R(r.width),
            h: R(r.height),
            br: R(parseFloat(cs.borderTopLeftRadius) || 0),
          });
          continue;
        }
        const mi = cs.maskImage || cs.webkitMaskImage || "";
        if (mi.startsWith('url("data:image/svg+xml') && visibleBox(r)) {
          let raw = mi.slice(5, -2).replace(/^data:image\/svg\+xml(;utf8|;charset=utf-8)?,/, "");
          try {
            raw = decodeURIComponent(raw);
          } catch {}
          raw = raw
            .replace(/\\"/g, '"')
            .replace(/'black'/g, "'#000000'")
            .replace(/"black"/g, '"#000000"')
            .replace(/currentColor/g, "#000000");
          const ms = cs.maskSize.split(" ").map(parseFloat);
          const mw = ms[0] || r.width,
            mh = ms[1] || ms[0] || r.height;
          raw = raw.replace(/<svg /, `<svg width="${mw}" height="${mh}" `);
          let key = Object.keys(svgs).find((k) => svgs[k].m === raw);
          if (!key) {
            key = `mark-${Math.round(mw)}-${Object.keys(svgs).length}`;
            svgs[key] = { m: raw };
          }
          const fillc = parseColor(cs.backgroundColor);
          out.push({
            t: "f",
            n: "mode mark",
            x: R(r.left + scrollX - ox),
            y: R(r.top + scrollY - oy),
            w: R(r.width),
            h: R(r.height),
            clip: 1,
            ...(+cs.opacity < 1 ? { op: +cs.opacity } : {}),
            ch: [{ t: "s", k: key, c: hex(fillc), x: 0, y: 0, w: R(mw), h: R(mh) }],
          });
          continue;
        }
        // sr-only and collapsed boxes
        const tiny = r.width <= 1.5 || r.height <= 1.5;
        if (tiny && cs.position === "absolute" && cs.overflow === "hidden") continue;
        const v = cs.visibility === "hidden" ? null : visualOf(cel, cs, r);
        const name =
          cel.getAttribute("aria-label") ||
          cel.getAttribute("data-slot") ||
          cel.getAttribute("data-testid") ||
          (typeof cel.className === "string" &&
            cel.className
              .split(/\s+/)
              .find(
                (c) =>
                  /^[a-z]+(-[a-z]+)+$/.test(c) &&
                  !/^(min|max|flex|grid|items|justify|text|font|bg|border|rounded|gap|px|py|pt|pb|pl|pr|mt|mb|ml|mr|mx|my|w|h|inline|leading|tracking|shrink|grow|self|place|overflow|truncate|line|whitespace|sm|md|lg|xl|z|top|left|right|bottom|inset|ring|shadow|transition|duration|ease|opacity|col|row|order|space|divide|outline|focus|hover|motion|aspect|object|pointer|select|sr|not|group|peer|data|aria)-/.test(
                    c,
                  ),
              )) ||
          tag;
        if (v && visibleBox(r)) {
          const kids = cs.visibility === "hidden" ? [] : build(cel, r.left + scrollX, r.top + scrollY, depth + 1);
          if ((tag === "input" || tag === "textarea") && cel.type !== "checkbox" && cel.type !== "radio") {
            const val = cel.value || cel.placeholder;
            if (val) {
              const pc = cel.value ? parseColor(cs.color) : parseColor(getComputedStyle(cel, "::placeholder").color);
              kids.push({
                t: "x",
                s: val,
                x: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
                y: 0,
                w: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
                h: r.height,
                c: hex(pc),
                vc: 1,
                ...fontOf(cs),
              });
            }
          }
          out.push({
            t: "f",
            n: name.slice(0, 40),
            x: R(r.left + scrollX - ox),
            y: R(r.top + scrollY - oy),
            w: R(r.width),
            h: R(r.height),
            ...v,
            ch: kids,
          });
        } else {
          // transparent wrapper: flatten, but keep a group name if it holds several things
          const kids = build(cel, ox, oy, depth + 1);
          if (
            (kids.length > 1 && /^(header|nav|main|footer|section|aside|ul|ol|form|dialog)$/.test(tag)) ||
            (kids.length > 1 && cel.getAttribute("aria-label"))
          ) {
            out.push({ t: "g", n: name.slice(0, 40), ch: kids });
          } else out.push(...kids);
        }
      }
      return out;
    }
    const sx = 0,
      sy = 0;
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor) ||
      parseColor(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1];
    const tree = build(root, sx, sy, 0);
    return { w: W, h: H, bg: hex(bodyBg), tree, svgs };
  }, rootSel);
}

let failed = 0;
for (const job of jobs) {
  const ctx = await browser.newContext({
    viewport: { width: job.w, height: job.vh ?? 844 },
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    hasTouch: job.w < 700,
    isMobile: false,
  });
  if (job.cookies) await ctx.addCookies(job.cookies.map((c) => ({ ...c, url: BASE })));
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("psychsift:work-search-coach-seen", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + job.url, { waitUntil: job.waitUntil ?? "networkidle", timeout: 120000 });
    await page
      .waitForFunction(
        () => !document.querySelector('[class*="skeleton" i],[class*="animate-pulse"],[aria-busy="true"]'),
        null,
        { timeout: 15000 },
      )
      .catch(() => console.log("  (still loading)", job.id));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(job.wait ?? 800);
    if (job.actions)
      for (const a of job.actions) {
        if (a.click) await page.locator(a.click).first().click({ timeout: 8000 });
        if (a.press) await page.keyboard.press(a.press);
        await page.waitForTimeout(a.wait ?? 700);
      }
    if (!job.fixedHeight) {
      const H = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      await page.setViewportSize({ width: job.w, height: Math.min(Math.max(H, job.vh ?? 844), job.maxH ?? 3200) });
      await page.waitForTimeout(600);
    }
    await prep(page);
    const data = await walk(page, job.root);
    data.url = job.url;
    data.name = job.name;
    data.final = new URL(page.url()).pathname + new URL(page.url()).search;
    data.h1 = await page.evaluate(() => (document.querySelector("main h1, h1")?.textContent || "").trim().slice(0, 60));
    if (job.fixedHeight) data.h = job.vh;
    fs.writeFileSync(path.join(outDir, job.id + ".json"), JSON.stringify(data));
    if (job.png) await page.screenshot({ path: path.join(outDir, job.id + ".png"), fullPage: false });
    console.log("ok", job.id, data.h, JSON.stringify(data).length, Object.keys(data.svgs).length);
  } catch (e) {
    failed += 1;
    console.log("FAIL", job.id, e.message.split("\n")[0]);
  }
  await ctx.close();
}
await browser.close();
console.log(`[figma-sync:capture] ${jobs.length - failed} captured, ${failed} failed. Output: ${outDir}`);
if (failed) {
  console.log("Run the same command again with --skip-existing to retry only the failed screens.");
  process.exitCode = 1;
}
