#!/usr/bin/env node
/**
 * Validate the dispatch-only live Web Vitals matrix before it can spend time on
 * the public origin. Keeping this outside YAML makes the same rules unit-testable.
 */
import { appendFileSync } from "node:fs";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { collidingRouteSlugs, WEB_VITALS_STRATEGIES, WEB_VITALS_MIN_SAMPLES } from "./summarise-web-vitals.mjs";

export const MAX_LIVE_LIGHTHOUSE_INVOCATIONS = 30;
/** Per-run cap; matches the GNU timeout wrapper in live-web-vitals.yml. */
export const LIVE_WEB_VITALS_PROCESS_TIMEOUT_SEC = 80;
/**
 * The live job allows 45 minutes. Reserve ~13 minutes for checkout, validation,
 * reachability, summarising, and artifact upload so measurement cannot consume
 * the whole job before upload.
 */
export const LIVE_WEB_VITALS_MEASUREMENT_SUITE_TIMEOUT_MS = 32 * 60_000;

function parseOrigin(value) {
  let origin;
  try {
    origin = new URL(String(value ?? ""));
  } catch {
    throw new Error(`LIVE_DOMAIN_URL must be an absolute HTTP(S) origin, got ${JSON.stringify(value)}.`);
  }

  if (!["http:", "https:"].includes(origin.protocol) || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error(
      `LIVE_DOMAIN_URL must be an absolute HTTP(S) origin without a path, query, or hash, got ${origin}.`,
    );
  }

  return origin.origin;
}

function parseRoutes(value, origin) {
  const routes = String(value ?? "")
    .split(",")
    .map((route) => route.trim());

  if (routes.length === 0 || routes.some((route) => !route)) {
    throw new Error("routes must be a non-empty comma-separated list without blank entries.");
  }

  const normalized = routes.map((route) => {
    if (
      !route.startsWith("/") ||
      route.startsWith("//") ||
      route.includes("@") ||
      (route.length > 1 && route.endsWith("/"))
    ) {
      throw new Error(`route must be a canonical root-relative path, got ${JSON.stringify(route)}.`);
    }

    const resolved = new URL(route, origin);
    if (
      resolved.origin !== origin ||
      resolved.search ||
      resolved.hash ||
      resolved.pathname !== route ||
      route.includes("//")
    ) {
      throw new Error(`route must stay on ${origin} as a canonical root-relative path, got ${JSON.stringify(route)}.`);
    }

    return route;
  });

  const duplicate = normalized.find((route, index) => normalized.indexOf(route) !== index);
  if (duplicate) throw new Error(`routes contains duplicate path ${JSON.stringify(duplicate)}.`);

  const collisions = collidingRouteSlugs(normalized);
  if (collisions.length > 0) {
    throw new Error(`routes cannot share Lighthouse filename slugs: ${collisions.join(", ")}.`);
  }

  return normalized;
}

function parseSamples(value) {
  const raw = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`samples must be a positive integer, got ${JSON.stringify(value)}.`);

  const samples = Number(raw);
  if (!Number.isSafeInteger(samples) || samples < WEB_VITALS_MIN_SAMPLES) {
    throw new Error(`samples must be at least ${WEB_VITALS_MIN_SAMPLES}, got ${raw}.`);
  }

  return samples;
}

export function parseLiveWebVitalsInputs({ origin, routes, samples }) {
  const normalizedOrigin = parseOrigin(origin);
  const normalizedRoutes = parseRoutes(routes, normalizedOrigin);
  const normalizedSamples = parseSamples(samples);
  const invocations = normalizedRoutes.length * WEB_VITALS_STRATEGIES.length * normalizedSamples;

  if (invocations > MAX_LIVE_LIGHTHOUSE_INVOCATIONS) {
    throw new Error(
      `requested ${invocations} Lighthouse runs; maximum is ${MAX_LIVE_LIGHTHOUSE_INVOCATIONS} ` +
        "(routes × mobile/desktop × samples).",
    );
  }

  return { origin: normalizedOrigin, routes: normalizedRoutes, samples: normalizedSamples, invocations };
}

if (isDirectEntrypoint(import.meta.url)) {
  const result = parseLiveWebVitalsInputs({
    origin: process.argv[2],
    routes: process.argv[3],
    samples: process.argv[4],
  });
  console.log(
    `live Lighthouse matrix -> ${result.invocations} runs (${result.routes.length} routes × 2 strategies × ${result.samples} samples)`,
  );
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `ROUTES=${result.routes.join(",")}\n`);
    appendFileSync(process.env.GITHUB_ENV, `SAMPLES=${result.samples}\n`);
    appendFileSync(
      process.env.GITHUB_ENV,
      `LIVE_WEB_VITALS_PROCESS_TIMEOUT_SEC=${LIVE_WEB_VITALS_PROCESS_TIMEOUT_SEC}\n`,
    );
    appendFileSync(
      process.env.GITHUB_ENV,
      `LIVE_WEB_VITALS_MEASUREMENT_SUITE_SECONDS=${LIVE_WEB_VITALS_MEASUREMENT_SUITE_TIMEOUT_MS / 1000}\n`,
    );
  }
}
