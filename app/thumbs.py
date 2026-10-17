"""Poster frames for clips, extracted with a bundled ffmpeg and cached in memory."""
import collections
import subprocess
import threading

_cache = collections.OrderedDict()
_lock = threading.Lock()
_MAX = 400


def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def thumbnail(vss, source, at=1.0, width=640):
    with _lock:
        if source in _cache:
            _cache.move_to_end(source)
            return _cache[source]
    clip = vss.fetch_clip(source)
    # output-side seek: piped mp4 input can't be seeked before demuxing
    cmd = [_ffmpeg(), "-loglevel", "error", "-i", "pipe:0", "-ss", str(at), "-frames:v", "1",
           "-vf", f"scale={width}:-2", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"]
    out = subprocess.run(cmd, input=clip, capture_output=True, timeout=60).stdout
    if not out:  # some clips are shorter than `at`
        cmd[cmd.index("-ss") + 1] = "0"
        out = subprocess.run(cmd, input=clip, capture_output=True, timeout=60).stdout
    with _lock:
        _cache[source] = out
        while len(_cache) > _MAX:
            _cache.popitem(last=False)
    return out
