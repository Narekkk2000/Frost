"""Compress a supplied master, then generate landscape frames and its soundtrack.

Usage: python3 scripts/build-hero.py /path/to/master.mov
Requires ffmpeg, ffprobe and cwebp. The large original stays outside the repo.
"""
import json
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / 'media/hero-v3.mp4'
AUDIO = ROOT / 'public/audio/hero-v3.m4a'

def run(*args):
    subprocess.run(args, check=True)

if len(sys.argv) != 2:
    raise SystemExit(__doc__)
source = Path(sys.argv[1]).expanduser().resolve()
if not source.is_file():
    raise SystemExit(f'Missing source: {source}')
MASTER.parent.mkdir(exist_ok=True)
AUDIO.parent.mkdir(parents=True, exist_ok=True)
run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source),
    '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '-1',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-threads', '4', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(MASTER))
run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(MASTER),
    '-vn', '-c:a', 'copy', '-movflags', '+faststart', str(AUDIO))
metadata = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(MASTER)]))
manifest = {'hero': {'duration': float(metadata['format']['duration']), 'audio': '/audio/hero-v3.m4a'}}
for tier_name, width in [('desktop', 1600), ('mobile', 1280)]:
    directory = ROOT / 'public/frames/hero-v3' / ('d' if tier_name == 'desktop' else 'm')
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='frost-hero-') as temporary:
        temp = Path(temporary)
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(MASTER),
            '-map', '0:v:0', '-vf', f'scale={width}:-2:flags=lanczos', '-fps_mode', 'passthrough',
            '-start_number', '0', '-compression_level', '1', str(temp / 'f%03d.png'))
        images = sorted(temp.glob('f*.png'))
        def encode(image):
            run('cwebp', '-quiet', '-q', '82', '-m', '4', str(image), '-o', str(directory / (image.stem + '.webp')))
            image.unlink()
        with ThreadPoolExecutor(max_workers=4) as workers:
            list(workers.map(encode, images))
    manifest['hero'][tier_name] = {
        'count': len(images), 'dir': f'hero-v3/{directory.name}', 'width': width, 'height': width * 9 // 16,
        'extension': 'webp', 'keyframes': {'step': 12},
    }
    print(f'{tier_name}: {len(images)} frames at {width}×{width*9//16}', flush=True)
(ROOT / 'public/frames/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Master: {source.stat().st_size:,} → {MASTER.stat().st_size:,} bytes; audio: {AUDIO.stat().st_size:,} bytes')
