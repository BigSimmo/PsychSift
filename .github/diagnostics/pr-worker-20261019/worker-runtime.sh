#!/usr/bin/env bash
set -euo pipefail
image=clinical-kb-worker:ci
isolated=(--rm --network=none --cap-drop=ALL --security-opt no-new-privileges:true)
docker run "${isolated[@]}" -e WORKER_MEDSPACY_ASSERTION=true --entrypoint node "$image" dist/worker/validate-runtime.mjs | tee /tmp/psychsift-pr-worker-proof/worker-runtime.json
docker run "${isolated[@]}" --entrypoint node "$image" scripts/deploy/await-migrations.mjs --self-test
docker run "${isolated[@]}" --entrypoint node "$image" --check dist/worker/index.mjs
# -i is needed for stdin, and this runs the installed production Python, never host dependencies.
docker run -i "${isolated[@]}" --entrypoint python "$image" - <<'PY' | tee /tmp/psychsift-pr-worker-proof/python-runtime.json
import hashlib, importlib, importlib.metadata, json, os
from pathlib import Path
assert os.getuid() == 1000 and os.getgid() == 1000
modules = ['fitz', 'PIL', 'pytesseract', 'medspacy', 'spacy', 'nltk', 'extract_pdf_assets', 'analyze_assertions']
import sys
sys.path.insert(0, '/app/worker/python')
for name in modules:
    importlib.import_module(name)
from analyze_assertions import build_nlp, analyze_chunk
result = analyze_chunk(build_nlp(['fever']), {'id': 'synthetic', 'text': 'No fever.'})
assert 'fever' in result['negated_terms'], result
model = Path('/opt/psychsift-ocr-models/Latin.traineddata')
assert model.stat().st_size == 89_384_811
digest = hashlib.sha256(model.read_bytes()).hexdigest()
assert digest == '6dbdaf8ecc6c40f025c2648bf3b3f3fbffe073e1fd2df2047fde2e2b2f020d53'
assert os.environ['HF_HUB_OFFLINE'] == '1'
print(json.dumps({'python': sys.version, 'versions': {n: importlib.metadata.version(n) for n in ['PyMuPDF', 'Pillow', 'pytesseract', 'medspacy', 'spacy', 'nltk']}, 'model_sha256': digest, 'assertion': result}, sort_keys=True))
PY
docker run "${isolated[@]}" --mount "type=bind,src=$PWD/eval/docling,dst=/proof-docling,readonly" --entrypoint node "$image" /proof-docling/verify-model-artifacts.mjs --models-dir /opt/docling-models --manifest /proof-docling/model-artifacts.json | tee /tmp/psychsift-pr-worker-proof/model-identities.txt
docker run "${isolated[@]}" --entrypoint /opt/docling-venv/bin/python "$image" -c 'import cv2, torch, docling, docling_core; from docling.document_converter import DocumentConverter; print("Installed Docling/OpenCV/CPU Torch imports passed", torch.__version__)'
# Complete owner unittest/compileall already execute in the unchanged Dockerfile before tests are removed.
# Preserve their build-log counts; no duplicate full Python test execution here.
