#!/usr/bin/env bash
# run-lab.sh — build the sandbox image and run the Docling lab benchmark in it.
#
# Manual-only (HANDOVER S6): run directly by an operator locally. There is no
# dedicated CI workflow for it. Never wired into pr-required or any automatic gate.
#
# Sandbox contract (README §B3): non-root, no egress (--network=none), read-only
# root filesystem and repository mount, CPU/memory/pids/tmpfs limits from
# eval/docling/report/lab-config.json (mirrored literally below — change both
# together), whole-run wall clock enforced by `timeout`, per-document limits and
# output caps enforced inside by harness/run_corpus.py.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/eval/docling/out"
IMAGE_TAG=docling-lab

cd "$REPO_ROOT"

command -v docker >/dev/null || { echo "run-lab: docker is required" >&2; exit 1; }
if ! docker buildx inspect >/dev/null 2>&1; then
  echo "run-lab: a working Docker BuildKit builder (docker buildx) is required to build the lab image" >&2
  exit 1
fi
# The lab Dockerfile uses BuildKit cache mounts.
export DOCKER_BUILDKIT=1
if [ ! -d node_modules ]; then
  echo "run-lab: node_modules missing — run 'npm ci --include=dev' first (the legacy runner needs tsx)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "== docker build (network allowed: hash-verified installs + model prefetch) =="
docker build -f eval/docling/Dockerfile -t "$IMAGE_TAG" .

echo "== sandboxed run (egress blocked) =="
timeout -k 30 3600 docker run --rm \
  --network=none \
  --read-only \
  --user lab \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --memory=6g --memory-swap=6g \
  --cpus=2 \
  --pids-limit=256 \
  --tmpfs /tmp:rw,size=1g \
  -v "$REPO_ROOT":/repo:ro \
  -v "$OUT_DIR":/out:rw \
  "$IMAGE_TAG" bash /repo/eval/docling/harness/entry.sh

echo "== report assembly (host: needs git for the commit SHA) =="
mkdir -p "$OUT_DIR/report"
node eval/docling/report/build-report.mjs \
  --raw "$OUT_DIR/raw/measurements.json" \
  --out "$OUT_DIR/report/docling-lab-report.json"

echo "run-lab: done — aggregate report at eval/docling/out/report/docling-lab-report.json"
