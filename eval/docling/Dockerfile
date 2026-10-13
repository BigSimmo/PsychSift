# Docling lab sandbox image (docs/rag-improvement/README.md §B3).
#
# Build stage has network (hash-verified installs + model prefetch); the benchmark
# itself runs with `--network=none` (see eval/docling/run-lab.sh), so everything the
# run needs — both venvs, tesseract, and the docling models — is baked in here.
# The repository is NOT baked in: run-lab.sh bind-mounts it read-only at /repo.
#
# Same digest-pinned base as Dockerfile / Dockerfile.worker (Debian bookworm:
# python3 is 3.11, matching both hashed locks consumed below).
FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

# libgl1 + libglib2.0-0: OpenCV's runtime shared libraries. docling's rapidocr
# stage imports cv2 during `docling-tools models download` (and again at run
# time), and the slim base ships neither — run 32165911181 failed the prefetch
# with `ImportError: libGL.so.1: cannot open shared object file`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    tesseract-ocr \
    fonts-dejavu-core \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

# Legacy comparator venv: read-only consumption of the worker's production hashed
# lock (the file is never modified — hard boundary in HANDOVER S6).
COPY worker/python/requirements.txt /tmp/legacy-requirements.txt
RUN python3 -m venv /opt/legacy-venv \
  && /opt/legacy-venv/bin/pip install --no-cache-dir --require-hashes -r /tmp/legacy-requirements.txt \
  && /opt/legacy-venv/bin/pip check \
  && rm /tmp/legacy-requirements.txt

# Docling venv from the lab's own hashed lock (CPU-only torch).
COPY eval/docling/requirements.txt /tmp/docling-requirements.txt
RUN python3 -m venv /opt/docling-venv \
  && /opt/docling-venv/bin/pip install --no-cache-dir --require-hashes -r /tmp/docling-requirements.txt \
  && /opt/docling-venv/bin/pip check \
  && rm /tmp/docling-requirements.txt

# Prefetch docling's models now: the egress-blocked run cannot reach HuggingFace,
# so a missing model at run time would fail every docling conversion.
#
# The model weights are NOT pinned by the hash-locked Docling requirement —
# that lock pins the Python client only. `docling-tools models download` takes no
# version argument of any kind (there is no --revision flag), so it fetches whatever
# the HuggingFace repositories hold on build day. This comment previously claimed the
# opposite, which mattered: it is exactly the belief that would let an upstream weight
# change pass unexamined, and it contradicted the accurate note in Dockerfile.worker.
#
# What does pin them is the digest check below, in this same layer: it fails the build
# when the download differs from eval/docling/model-artifacts.json. While that manifest
# records no digest yet it reports the one the download produced instead of failing.
COPY eval/docling/verify-model-artifacts.mjs eval/docling/model-artifacts.json /tmp/docling-verify/
RUN /opt/docling-venv/bin/docling-tools models download --output-dir /opt/docling-models \
  && node /tmp/docling-verify/verify-model-artifacts.mjs \
    --models-dir /opt/docling-models \
    --manifest /tmp/docling-verify/model-artifacts.json \
  && chmod -R a+rX /opt/docling-models \
  && rm -rf /tmp/docling-verify

RUN useradd --create-home --shell /usr/sbin/nologin lab
USER lab
WORKDIR /repo
