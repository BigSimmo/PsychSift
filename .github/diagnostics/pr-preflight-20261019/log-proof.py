"""Transport bounded raw proof in free workflow logs, with hashes for later decoding."""
import base64
import gzip
import hashlib
from pathlib import Path

root = Path('/tmp/psychsift-pr-proof')
names = ['changed-paths.txt', 'quality-plan.json', 'image-inspect.json', 'ssr.json', 'stopped-state.json', 'worker-runtime.json', 'python-runtime.json', 'model-identities.txt', 'trivy-all.json', 'sbom.cdx.json', 'scan-summary.json', 'cache/db/metadata.json', 'browser-ensure.json', 'browser-results.json']
for name in names:
    path = root / name
    if not path.is_file():
        print('PROOF_MISSING', name)
        continue
    raw = path.read_bytes()
    if len(raw) > 24 * 1024 * 1024:
        raise RuntimeError('Raw proof exceeds 24 MiB per-file bound: ' + name)
    payload = gzip.compress(raw, mtime=0)
    if len(payload) > 3 * 1024 * 1024:
        raise RuntimeError('Encoded proof exceeds 3 MiB compressed per-file bound: ' + name)
    print('PROOF_BEGIN_GZIP', name, len(raw), hashlib.sha256(raw).hexdigest(), len(payload))
    encoded = base64.b64encode(payload).decode('ascii')
    for offset in range(0, len(encoded), 2048):
        print(encoded[offset:offset + 2048])
    print('PROOF_END', name)
