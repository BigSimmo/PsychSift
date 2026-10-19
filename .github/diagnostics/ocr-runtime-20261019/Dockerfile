# Exact current worker Bookworm base; diagnostic parser subset only.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv tesseract-ocr ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/ocr-requirements.txt
RUN python3 -m venv /opt/ocr-proof \
 && PIP_DISABLE_PIP_VERSION_CHECK=1 /opt/ocr-proof/bin/pip install --no-cache-dir --no-deps --require-hashes --only-binary=:all: --retries=0 -r /tmp/ocr-requirements.txt
COPY Latin.traineddata /opt/psychsift-ocr-models/Latin.traineddata
COPY ocr-model-LICENSE.txt /opt/psychsift-ocr-models/LICENSE
ENV HOME=/home/node PYTHONDONTWRITEBYTECODE=1 PATH=/opt/ocr-proof/bin:$PATH PDF_RASTER_TABLE_MODEL_PATH=/opt/psychsift-ocr-models/Latin.traineddata PDF_RASTER_TABLE_OCR=0
USER node
CMD ["python", "/proof/verify.py", "--candidate-root", "/candidate", "--baseline-source", "/proof/baseline.py", "--fixtures-root", "/proof/fixtures", "--out", "/out/result", "--scope", "owner"]
