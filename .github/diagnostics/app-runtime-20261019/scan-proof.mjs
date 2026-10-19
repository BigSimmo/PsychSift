import assert from "node:assert/strict";
import fs from "node:fs";
import { validateTrivyReportJson } from "../../../scripts/trivy-image-scan.mjs";
const validated = validateTrivyReportJson(fs.readFileSync("/tmp/psychsift-runtime-proof/trivy-all.json", "utf8"));
assert.equal(validated.ok, true);
const { report, counts } = validated;
const inspected = JSON.parse(fs.readFileSync("/tmp/psychsift-runtime-proof/image-inspect.json", "utf8"))[0];
assert.equal(report.Metadata.ImageID, inspected.Id, "scan must describe the exact built image");
const sbom = JSON.parse(fs.readFileSync("/tmp/psychsift-runtime-proof/sbom.cdx.json", "utf8"));
assert.equal(sbom.bomFormat, "CycloneDX");
assert.ok(Array.isArray(sbom.components) && sbom.components.length >= 10, "SBOM must contain actual components");
assert.equal(report.Metadata.OS.Family, "debian");
assert.match(report.Metadata.OS.Name, /^13(?:\.|$)/);
const results = report.Results.filter((r) => r.Class === "os-pkgs");
assert.ok(results.length);
const packages = results.flatMap((r) => r.Packages ?? []);
assert.ok(packages.length >= 10);
assert.ok(packages.every((p) => p.Name && p.Version));
const sourceHolds = ["util-linux", "acl", "systemd", "perl", "ncurses"];
const fallback =
  /^(bsdutils|fdisk|libblkid1|libfdisk1|liblastlog2-2|libmount1|libsmartcols1|libuuid1|login|mount|util-linux|util-linux-extra|uuid-runtime|acl|libacl1|systemd|libsystemd0|libudev1|perl|perl-base|libperl.*|ncurses-base|ncurses-bin|libtinfo6|libncurses6|libncursesw6)$/;
const remaining = packages.filter((p) => sourceHolds.includes(p.SrcName) || fallback.test(p.Name));
const dash = packages.filter((p) => p.Name === "dash");
assert.equal(dash.length, 1);
assert.ok(dash[0].Version);
const summary = {
  scope: "native-only app image; no production node_modules/build output in image",
  os: report.Metadata.OS,
  packageCount: packages.length,
  counts,
  dash,
  remainingHeldComponents: remaining,
  independentComponentAbsencePass: remaining.length === 0,
  workerAndNpmHoldsUnchanged: true,
};
console.log(JSON.stringify(summary));
fs.writeFileSync("/tmp/psychsift-runtime-proof/scan-summary.json", JSON.stringify(summary, null, 2) + "\n");
assert.equal(remaining.length, 0, "historical held source components still installed");
assert.equal(counts.HIGH, 0);
assert.equal(counts.CRITICAL, 0);
