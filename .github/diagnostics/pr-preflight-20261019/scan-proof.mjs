import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { validateTrivyReportJson } = await import(pathToFileURL(`${process.cwd()}/scripts/trivy-image-scan.mjs`));
const root = "/tmp/psychsift-pr-proof";
const raw = readFileSync(`${root}/trivy-all.json`, "utf8");
const report = JSON.parse(raw);
const sbom = JSON.parse(readFileSync(`${root}/sbom.cdx.json`, "utf8"));
const image = JSON.parse(readFileSync(`${root}/image-inspect.json`, "utf8"))[0];
const valid = validateTrivyReportJson(raw);
assert.equal(valid.ok, true, JSON.stringify(valid));
assert.equal(report.Metadata.ImageID, image.Id, "scan must describe the assembled image");
assert.equal(report.Metadata.OS.Family, "debian");
assert.ok(!report.Metadata.OS.EOSL, "unsupported OS is unassessed");
assert.ok(Array.isArray(report.Results) && report.Results.length > 0);
const os = report.Results.filter((r) => r.Class === "os-pkgs");
assert.ok(os.length > 0, "OS analysis is required");
const packages = os.flatMap((r) => r.Packages ?? []);
assert.ok(packages.length > 0, "raw OS package inventory is required");
assert.ok(packages.every((p) => p.Name && p.Version));
const libraries = report.Results.filter((r) => r.Class === "lang-pkgs").flatMap((r) => r.Packages ?? []);
assert.ok(libraries.length > 0, "installed production-language package inventory is required");
assert.ok(libraries.every((p) => p.Name && p.Version));
assert.equal(sbom.bomFormat, "CycloneDX");
assert.ok(sbom.components?.length > 0);
const counts = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
for (const result of report.Results)
  for (const vulnerability of result.Vulnerabilities ?? []) counts[vulnerability.Severity]++;
const summary = {
  image: process.argv[2],
  imageId: image.Id,
  source: process.env.SOURCE_SHA,
  os: report.Metadata.OS,
  osPackages: packages.length,
  languagePackages: libraries.length,
  sbomComponents: sbom.components.length,
  severities: counts,
  scope: "full actual production image; OS and installed-language inventories; offline raw scan",
};
writeFileSync(`${root}/scan-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
assert.equal(counts.HIGH + counts.CRITICAL, 0, "HIGH/CRITICAL remain blocking; no waiver");
