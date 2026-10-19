#!/usr/bin/env bash
set -euo pipefail
proof=/tmp/psychsift-runtime-proof/ocr
src=.github/diagnostics/ocr-runtime-20261019
mkdir -p "$proof/build" "$proof/output/ownedtmp"
sudo chown -R 1000:1000 "$proof/output"
cleanup() {
  docker rm -f psychsift-ocr-bookworm-proof >/dev/null 2>&1 || true
  sudo rm -rf -- "$proof/output/ownedtmp"
}
trap cleanup EXIT
cp "$src/Dockerfile" "$proof/build/Dockerfile"
cp "$src/requirements.txt" "$proof/build/requirements.txt"
cp worker/python/ocr-model-LICENSE.txt "$proof/build/ocr-model-LICENSE.txt"
# Public immutable open-source model weights only; no inference API, credentials or paid service.
curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 75 --retry 0 https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/script/Latin.traineddata --output "$proof/build/Latin.traineddata"
test "$(stat -c %s "$proof/build/Latin.traineddata")" = 89384811
printf '%s  %s\n' 6dbdaf8ecc6c40f025c2648bf3b3f3fbffe073e1fd2df2047fde2e2b2f020d53 "$proof/build/Latin.traineddata" | sha256sum --check
sha256sum "$proof/build/Latin.traineddata" "$proof/build/requirements.txt" "$proof/build/ocr-model-LICENSE.txt" > "$proof/locked-inputs.txt"
timeout --kill-after=10s 180s docker build --progress=plain -t psychsift-ocr-bookworm-proof:20261019 "$proof/build"
docker image inspect psychsift-ocr-bookworm-proof:20261019 > "$proof/image-inspect.json"
# Exact four lock packages and Tesseract5.3 are asserted before source tests.
timeout 15s docker run --rm --network=none --entrypoint=python psychsift-ocr-bookworm-proof:20261019 -c 'import fitz,PIL,pytesseract,packaging,subprocess,json,os;assert os.getuid()==1000;assert os.getgid()==1000;assert os.environ.get("HOME")=="/home/node"; t=subprocess.check_output(["tesseract","--version"],text=True).splitlines()[0];assert fitz.VersionBind=="1.28.2";assert PIL.__version__=="12.3.0";assert pytesseract.__version__=="0.3.13";assert packaging.__version__=="26.2";assert t.startswith("tesseract 5.3.");print(json.dumps({"uid":os.getuid(),"gid":os.getgid(),"HOME":os.environ.get("HOME"),"PyMuPDF":fitz.VersionBind,"Pillow":PIL.__version__,"pytesseract":pytesseract.__version__,"packaging":packaging.__version__,"tesseract":t}))' > "$proof/versions.json"
set +e
timeout --kill-after=5s 360s docker run --rm --name psychsift-ocr-bookworm-proof --network=none -e TMPDIR=/out/ownedtmp --cap-drop=ALL --security-opt=no-new-privileges:true --memory=2g --cpus=2 --pids-limit=96 -v "$PWD/worker/python:/candidate/worker/python:ro" -v "$PWD/$src:/proof:ro" -v "$proof/output:/out" psychsift-ocr-bookworm-proof:20261019
status=$?
set -e
# Partial quality and event records remain honest if a deadline terminates the phase.
if [ -f "$proof/output/result/result.json" ]; then cat "$proof/output/result/result.json"; else echo OCR_QUALITY_RESULT_MISSING; fi
if [ -f "$proof/output/result/test-events.jsonl" ]; then tail -n 20 "$proof/output/result/test-events.jsonl"; fi
exit "$status"
