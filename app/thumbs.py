"""Poster frames for clips: extracted once with a bundled ffmpeg, cached on disk and in memory.
A semaphore keeps a burst of requests (a 24-frame storyboard) from overwhelming a small pod."""
import collections
import hashlib
import os
import subprocess
import threading

_cache = collections.OrderedDict()
_lock = threading.Lock()
_gate = threading.BoundedSemaphore(int(os.environ.get("THUMB_CONCURRENCY", "3")))
_MAX = 600
_DIR = os.path.join(os.environ.get("CLIP_CACHE", "/tmp"), "citylens-thumbs")
os.makedirs(_DIR, exist_ok=True)


def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def thumbnail(vss, source, at=1.0, width=640):
    key = f"{source}|{width}"
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    path = os.path.join(_DIR, hashlib.sha1(key.encode()).hexdigest() + ".jpg")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as f:
            out = f.read()
    else:
        with _gate:
            if os.path.exists(path) and os.path.getsize(path) > 0:
                with open(path, "rb") as f:
                    out = f.read()
            else:
                clip = vss.fetch_clip(source)
                # output-side seek: piped mp4 input can't be seeked before demuxing
                cmd = [_ffmpeg(), "-loglevel", "error", "-i", "pipe:0", "-ss", str(at), "-frames:v", "1",
                       "-vf", f"scale={width}:-2", "-f", "image2", "-c:v", "mjpeg", "-q:v", "5", "pipe:1"]
                out = subprocess.run(cmd, input=clip, capture_output=True, timeout=90).stdout
                if not out:  # clip shorter than `at`
                    cmd[cmd.index("-ss") + 1] = "0"
                    out = subprocess.run(cmd, input=clip, capture_output=True, timeout=90).stdout
                if out:
                    with open(path, "wb") as f:
                        f.write(out)
    with _lock:
        _cache[key] = out
        while len(_cache) > _MAX:
            _cache.popitem(last=False)
    return out
