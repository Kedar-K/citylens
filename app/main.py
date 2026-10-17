"""CityLens API. Serves the operator UI and the Detect / Investigate / Measure endpoints."""
import concurrent.futures as cf
import os
import sys
import time
import urllib.request

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.vss import VSS  # noqa: E402
from app.store import Store  # noqa: E402
from app.rules import RULES, FIXED_CAMERAS  # noqa: E402
from app.detect import run_rules  # noqa: E402
from app.verify import verify_incident  # noqa: E402
from app.agent import Agent, traced  # noqa: E402
from app.thumbs import thumbnail  # noqa: E402
import threading, uuid  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.environ.get("STATIC_DIR") or os.path.join(HERE, "static")
app = FastAPI(title="CityLens")
vss = VSS()
store = Store()
agent = traced(Agent(vss, store))
_detect_jobs = {}


@app.get("/health")
def health():
    return {"ok": True, "service": "citylens", "time": time.time()}


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/{fname}.{ext}")
def static_file(fname: str, ext: str):
    """Serve the UI's own files (css/js/images) from the static dir."""
    if ext not in ("css", "js", "png", "svg", "ico", "woff2", "webmanifest") or "/" in fname or ".." in fname:
        raise HTTPException(404)
    path = os.path.join(STATIC_DIR, f"{fname}.{ext}")
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


@app.get("/api/rules")
def rules():
    return RULES


@app.get("/api/cameras")
def cameras():
    return store.cameras()


class DetectReq(BaseModel):
    cameras: list[str] | None = None
    rules: list[str] | None = None
    verify: bool = True
    max_verify: int = 10
    top_k: int = 8


def _run_detect_job(job, req: DetectReq):
    """Run the rules, verify the strongest candidates with Cosmos, store the results. Updates job in place."""
    t0 = time.time()
    try:
        chosen = [r for r in RULES if not req.rules or r["id"] in req.rules]
        job.update(phase="searching", detail=f"{len(chosen)} rules × {len(req.cameras or FIXED_CAMERAS)} cameras")
        cands = run_rules(vss, cameras=req.cameras, rules=chosen, top_k=req.top_k)
        known = {i["id"]: i for i in store.incidents()}
        fresh = [c for c in cands if c["id"] not in known]
        for c in cands:
            if c["id"] in known:
                c.update({k: known[c["id"]].get(k) for k in ("verdict", "confidence", "reason", "status")})
        job.update(candidates=len(cands), incidents=cands, phase="verifying", verify_total=min(len(fresh), req.max_verify) if req.verify else 0, verify_done=0)
        verified = []
        if req.verify and fresh:
            with cf.ThreadPoolExecutor(max_workers=3) as ex:
                for inc in ex.map(_safe_verify, fresh[: req.max_verify]):
                    verified.append(inc)
                    job["verify_done"] = len(verified)
                    job["confirmed"] = sum(1 for c in cands if c.get("status") == "confirmed")
                    job["dismissed"] = sum(1 for c in cands if c.get("status") == "dismissed")
        saved = store.save_incidents([v for v in verified if v.get("verdict")])
        cands.sort(key=lambda c: (c["status"] != "confirmed", -(c.get("confidence") or 0), -c["similarity"]))
        job.update(phase="done", saved=saved, verified=len(verified), seconds=round(time.time() - t0, 1),
                   confirmed=sum(1 for c in cands if c.get("status") == "confirmed"),
                   dismissed=sum(1 for c in cands if c.get("status") == "dismissed"), incidents=cands)
    except Exception as e:  # surface the error to the UI instead of a hung job
        job.update(phase="error", error=str(e), seconds=round(time.time() - t0, 1))


@app.post("/api/detect")
def detect(req: DetectReq):
    """Start a detection run in the background; poll /api/detect/{id} for progress."""
    job_id = uuid.uuid4().hex[:10]
    job = {"id": job_id, "phase": "queued", "candidates": 0, "verify_total": 0, "verify_done": 0,
           "confirmed": 0, "dismissed": 0, "saved": 0, "incidents": [], "started": time.time()}
    _detect_jobs[job_id] = job
    threading.Thread(target=_run_detect_job, args=(job, req), daemon=True).start()
    return {"id": job_id}


@app.get("/api/detect/{job_id}")
def detect_status(job_id: str):
    job = _detect_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return job


@app.get("/api/overview")
def overview():
    return store.overview(store.incidents())


@app.get("/api/thumb")
def thumb(source: str):
    data = thumbnail(vss, source)
    if not data:
        raise HTTPException(404, "no frame")
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/system")
def system():
    """The stack behind CityLens: data layer, models, pipeline. For the System screen."""
    out = {"checked_at": time.strftime("%H:%M:%S UTC", time.gmtime())}
    try:
        d = vss.dashboard()
        out["index"] = {"segments": d["overview"]["segment_rows"], "videos": d["overview"]["unique_videos"],
                        "reingested": store.reingested(), "healthy": d["pipeline_alignment"]["healthy"],
                        "pending": d["pipeline_alignment"]["pending_index"], "quality": d["quality"],
                        "s3": d["s3_inventory"], "objects": d["objects"][:12]}
    except Exception as e:
        out["index"] = {"error": str(e)}
    try:
        out["incidents_table"] = {"rows": len(store.incidents()), "schema": "citylens.incidents", "bucket": store.bucket}
    except Exception as e:
        out["incidents_table"] = {"error": str(e)}
    models = {"cosmos_reason": ("http://166.19.38.112:8001/v1/health/ready", "nvidia/cosmos3-nano-reasoner"),
              "cosmos_embed1": ("http://166.19.38.112:8003/v1/health/ready", "nvidia/cosmos-embed1"),
              "yolo11": ("http://166.19.38.112:8002/healthz", "yolo11s")}
    out["models"] = {}
    for name, (url, model) in models.items():
        try:
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ.get("GPU_BEARER_TOKEN", "")})
            with urllib.request.urlopen(req, timeout=6) as r:
                out["models"][name] = {"ok": r.status == 200, "model": model}
        except Exception as e:
            out["models"][name] = {"ok": False, "model": model, "error": str(e)[:80]}
    out["agent"] = {"model": os.environ.get("AGENT_MODEL", "openai/gpt-oss-120b"), "provider": "Weights & Biases Inference",
                    "weave": f"https://wandb.ai/{os.environ.get('WANDB_TEAM','')}/{os.environ.get('WANDB_PROJECT','')}/weave"}
    return out


def _safe_verify(inc):
    try:
        return verify_incident(vss, inc)
    except Exception as e:
        inc.update({"verdict": None, "reason": f"verify failed: {e}", "status": "candidate"})
        return inc


@app.get("/api/incidents")
def incidents(status: str | None = None, camera_id: str | None = None, rule_id: str | None = None):
    return store.incidents(status=status, camera_id=camera_id, rule_id=rule_id)


@app.post("/api/verify/{incident_id}")
def verify_one(incident_id: str):
    for inc in store.incidents():
        if inc["id"] == incident_id:
            return verify_incident(vss, dict(inc))
    raise HTTPException(404, "unknown incident")


@app.get("/api/search")
def search(q: str, camera_id: str | None = None, location: str | None = None, top_k: int = 10):
    f = {k: v for k, v in (("camera_id", camera_id), ("location", location)) if v}
    res = vss.search(q, top_k=top_k, min_similarity=0.25, metadata_filters=f, llm_top_n=3)
    return {"results": [{k: r.get(k) for k in ("source", "camera_id", "location", "segment_start_sec",
                                                "segment_end_sec", "similarity_score", "reasoning_content",
                                                "object_counts", "original_video")}
                        for r in res.get("results", [])],
            "synthesis": (res.get("llm_synthesis") or {}).get("response")}


@app.get("/api/measure")
def measure(camera_id: str = Query(...), window: int = 12):
    m = store.measure(camera_id, window=window)
    if not m:
        raise HTTPException(404, "unknown camera")
    return m


class AskReq(BaseModel):
    question: str
    history: list[dict] | None = None


@app.post("/api/ask")
def ask(req: AskReq):
    return agent.run(req.question, history=req.history)


@app.get("/api/clip")
def clip(source: str, request_range: str | None = None):
    """Proxy a segment clip from the video backend so the browser never needs the backend token."""
    req = urllib.request.Request(vss.stream_url(source))
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    return Response(content=data, media_type="video/mp4",
                    headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
