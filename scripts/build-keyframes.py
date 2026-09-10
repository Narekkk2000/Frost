"""Build native-resolution WebP keyframes (requires cwebp on PATH)."""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest_path = root / 'public/frames/manifest.json'
manifest = json.loads(manifest_path.read_text())
jobs = []
for tier in manifest['meltdown'].values():
    tier.pop('preview', None)
    tier['keyframes'] = {'step': 12, 'directory': 'keyframes'}
    directory = root / 'public/frames' / tier['dir']
    (directory / 'keyframes').mkdir(exist_ok=True)
    indices = sorted(set(range(12, tier['count'], 12)) | {tier['count'] - 1})
    jobs.extend((directory / f'f{i:03}.jpg', directory / 'keyframes' / f'f{i:03}.webp') for i in indices)

def encode(job):
    source, output = job
    subprocess.run(['cwebp', '-quiet', '-q', '82', '-m', '6', str(source), '-o', str(output)], check=True)

with ThreadPoolExecutor(max_workers=4) as workers:
    list(workers.map(encode, jobs))
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Built {len(jobs)} full-resolution keyframes: {sum(p.stat().st_size for _, p in jobs):,} bytes')
