#!/usr/bin/env bash
set -euo pipefail
image="$1"
proof=/tmp/psychsift-pr-worker-proof
cache="$proof/cache"
mkdir -p "$cache"
scanner="$(node --input-type=module -e 'import {TRIVY_IMAGE} from "./scripts/trivy-image-scan.mjs";console.log(TRIVY_IMAGE)')"
docker pull "$scanner"
# A single public advisory-database download per job; no target runtime or scan egress.
docker run --rm --mount "type=bind,src=$cache,dst=/cache" "$scanner" image --cache-dir /cache --download-db-only
docker image inspect "$image" > "$proof/image-inspect.json"
# BuildKit cache is disposable local runner state, never exported/uploaded.
docker builder prune -af
docker save --output "$proof/image.tar" "$image"
common=(--rm --network=none --cap-drop=ALL --security-opt no-new-privileges:true --mount "type=bind,src=$cache,dst=/cache" --mount "type=bind,src=$proof,dst=/proof")
docker run "${common[@]}" "$scanner" image --cache-dir /cache --skip-db-update --skip-java-db-update --offline-scan --input /proof/image.tar --scanners vuln --list-all-pkgs --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json --output /proof/trivy-all.json --exit-code 0
docker run "${common[@]}" "$scanner" image --cache-dir /cache --skip-db-update --skip-java-db-update --offline-scan --input /proof/image.tar --format cyclonedx --output /proof/sbom.cdx.json
rm "$proof/image.tar"
node /tmp/psychsift-pr-worker-helpers/scan-proof.mjs "$image"
