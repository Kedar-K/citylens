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
from app.rules import RULES  # noqa: E402
from app.detect import run_rules  # noqa: E402
from app.verify import verify_incident  # noqa: E402
from app.agent import Agent, traced  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
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
    return FileResponse(os.path.join(HERE, "static", "index.html"))


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


@app.post("/api/detect")
def detect(req: DetectReq):
    """Run the rules, verify the strongest candidates with Cosmos, store the results."""
    t0 = time.time()
    chosen = [r for r in RULES if not req.rules or r["id"] in req.rules]
    cands = run_rules(vss, cameras=req.cameras, rules=chosen, top_k=req.top_k)
    known = {i["id"]: i for i in store.incidents()}
    fresh = [c for c in cands if c["id"] not in known]
    for c in cands:
        if c["id"] in known:
            c.update({k: known[c["id"]].get(k) for k in ("verdict", "confidence", "reason", "status")})
    verified = []
    if req.verify and fresh:
        with cf.ThreadPoolExecutor(max_workers=3) as ex:
            for inc in ex.map(_safe_verify, fresh[: req.max_verify]):
                verified.append(inc)
    saved = store.save_incidents([v for v in verified if v.get("verdict")])
    return {"candidates": len(cands), "verified": len(verified), "saved": saved,
            "seconds": round(time.time() - t0, 1),
            "incidents": sorted(cands, key=lambda c: (c["status"] != "confirmed", -(c.get("confidence") or 0), -c["similarity"]))}


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
