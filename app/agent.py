"""Investigate: a tool-using agent on W&B Inference, traced with Weave.

The agent never touches video. Every tool is a query against the VAST data layer:
the caption index, the detections, and CityLens's own incident table.
"""
import json
import os
import threading
import time

from .rules import RULES

MODEL = os.environ.get("AGENT_MODEL", "openai/gpt-oss-120b")
WEAVE_PROJECT = f"{os.environ.get('WANDB_TEAM', '')}/{os.environ.get('WANDB_PROJECT', '')}".strip("/")

SYSTEM = """You are CityLens, a traffic operations assistant for a city traffic management centre.
You answer operator questions about what the street cameras saw, using tools. Rules:
- Always call a tool before answering; never guess. Prefer list_incidents for "anything wrong / blocked /
  incidents" questions, search_clips for "find / show me / was there", camera_stats for "how busy / compare /
  normal", and summarize_video for "what happened in this video".
- Answer in 2 to 5 short sentences for an operator. Name cameras by id and give times as segment offsets.
- Cite evidence as clip references in the form [clip:<source>] so the UI can play them. Include at most 4.
- If list_incidents returns an empty list, do not call it again: call search_clips once with a descriptive query
  and answer from the clips, saying no verified incident is on file.
- Times: the index has no wall-clock time. Describe moments as "minute M of the recording" using the minute fields.
- If the tools return nothing relevant, say so plainly.
Use camera ids exactly as listed in the camera catalogue below; never invent an id. If the user names a city,
filter by location instead of guessing a camera.
{catalogue}"""

NAMES = {"sf_streets_cam-1": "SF Street 1", "sf_streets_cam-2": "SF Street 2", "sf_streets_cam-3": "SF Street 3",
         "sf_streets_cam-4": "SF Street 4", "sf_streets_cam-5": "SF Street 5", "nyc_streets_cam-1": "NYC Street 1",
         "nyc_streets_cam-2": "NYC Street 2", "neighborhood_cam-1": "Residential 1", "pie_cam-3": "Toronto dashcam",
         "nyc_bike_gopro-1": "NYC bike cam", "i24_cam-1": "I-24 corridor", "smartspace_cam-1": "Indoor facility",
         "sdg_warehouse_cam-2": "Warehouse"}
LOCATIONS = {"san_francisco": ["san francisco", "sf"], "new_york": ["new york", "nyc", "manhattan"],
             "toronto": ["toronto"], "nashville": ["nashville", "i-24", "highway"], "neighborhood": ["residential", "neighborhood", "neighbourhood"]}

TOOLS = [
    {"type": "function", "function": {
        "name": "search_clips",
        "description": "Semantic search over the camera clip captions. Returns the best matching 5 second clips.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "What to look for, in plain words"},
            "camera_id": {"type": "string", "description": "Optional camera id filter, e.g. sf_streets_cam-5"},
            "location": {"type": "string", "description": "Optional location filter, e.g. san_francisco"},
            "top_k": {"type": "integer", "default": 8}},
            "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "list_incidents",
        "description": "CityLens incidents already detected and verified by the rules engine.",
        "parameters": {"type": "object", "properties": {
            "status": {"type": "string", "enum": ["confirmed", "dismissed", "candidate"], "default": "confirmed"},
            "camera_id": {"type": "string"},
            "rule_id": {"type": "string", "enum": [r["id"] for r in RULES]}}}}},
    {"type": "function", "function": {
        "name": "camera_stats",
        "description": "Vehicle and pedestrian counts for a camera from YOLO detections, with that camera's own baseline.",
        "parameters": {"type": "object", "properties": {
            "camera_id": {"type": "string", "description": "Omit to get a summary of every camera"}}}}},
    {"type": "function", "function": {
        "name": "summarize_video",
        "description": "Ask the video index to summarize one parent video (an original_video s3 uri) or answer a question about it.",
        "parameters": {"type": "object", "properties": {
            "original_video": {"type": "string"}, "question": {"type": "string"}},
            "required": ["original_video"]}}},
]


class Agent:
    def __init__(self, vss, store):
        self.vss, self.store = vss, store
        self._client = None
        self._weave_ready = False
        self._lock = threading.Lock()

    def _catalogue(self):
        try:
            cams = self.store.cameras()
        except Exception:
            return "Camera catalogue unavailable."
        lines = [f"- {c['camera_id']} ({NAMES.get(c['camera_id'], c['camera_id'])}), location={c['location']}, "
                 f"{c['capture_type']}, {c['minutes']} min indexed" for c in cams]
        return "Camera catalogue (id, name, location):\n" + "\n".join(lines)

    def resolve_camera(self, text):
        """Map whatever the model passed (id, friendly name, city) to a real camera id or a location filter."""
        if not text:
            return None, None
        t = str(text).strip().lower()
        ids = [c["camera_id"] for c in self.store.cameras()]
        if t in ids:
            return t, None
        for cid in ids:
            if t == NAMES.get(cid, "").lower() or t.replace("_", " ").replace("-", " ") == cid.replace("_", " ").replace("-", " "):
                return cid, None
        for cid in ids:
            name = NAMES.get(cid, "").lower()
            if name and (name in t or t in name):
                return cid, None
        for loc, words in LOCATIONS.items():
            if loc in t or any(w in t for w in words):
                return None, loc
        for cid in ids:  # last resort: shared token like "pie", "sf", "nyc"
            if any(tok and tok in cid for tok in t.replace("-", " ").replace("_", " ").split()):
                return cid, None
        return None, None

    def _setup(self):
        with self._lock:
            if self._client is None:
                from openai import OpenAI
                if WEAVE_PROJECT and os.environ.get("WANDB_API_KEY") and not self._weave_ready:
                    try:
                        import weave
                        weave.init(WEAVE_PROJECT)
                        self._weave_ready = True
                    except Exception as e:  # tracing is optional
                        print("weave init failed:", e)
                self._client = OpenAI(base_url="https://api.inference.wandb.ai/v1",
                                      api_key=os.environ["WANDB_API_KEY"], project=WEAVE_PROJECT or None)
        return self._client

    # -- tools ------------------------------------------------------------
    def search_clips(self, query, camera_id=None, location=None, top_k=8):
        f = {}
        cid, loc = self.resolve_camera(camera_id)
        if cid:
            f["camera_id"] = cid
        elif loc or location:
            _, loc2 = self.resolve_camera(location) if location else (None, None)
            f["location"] = loc or loc2 or location
        res = self.vss.search(query, top_k=min(int(top_k or 8), 15), min_similarity=0.25,
                              metadata_filters=f, llm_top_n=1)
        return [{"source": r["source"], "camera_id": r.get("camera_id"), "location": r.get("location"),
                 "start_sec": r.get("segment_start_sec"), "similarity": round(r.get("similarity_score", 0), 3),
                 "caption": (r.get("reasoning_content") or "")[:400], "objects": r.get("object_counts")}
                for r in res.get("results", [])]

    def list_incidents(self, status="confirmed", camera_id=None, rule_id=None):
        cid, loc = self.resolve_camera(camera_id)
        rows = self.store.incidents(status=status, camera_id=cid, rule_id=rule_id)
        if loc and not cid:
            rows = [r for r in rows if r.get("location") == loc]
        if not rows:
            return {"incidents": [], "note": "No stored incidents match. Use search_clips to look at the footage directly."}
        return [{k: r.get(k) for k in ("id", "rule", "severity", "camera_id", "location", "source",
                                       "segment_start_sec", "confidence", "reason", "detected_at")}
                for r in rows[:20]]

    def camera_stats(self, camera_id=None):
        if not camera_id:
            return self.store.cameras()
        cid, _ = self.resolve_camera(camera_id)
        m = self.store.measure(cid or camera_id)
        if not m:
            return {"error": f"unknown camera {camera_id}; use an id from the catalogue"}
        out = {k: m[k] for k in ("camera_id", "location", "segments", "baseline_vehicles",
                                 "people_median", "current_ratio")}
        out["recording_minutes"] = round(m["segments"] * 5 / 60, 1)
        for k in ("peak", "quiet"):
            p = m[k]
            out[k] = {"minute_of_recording": round(p["i"] * 5 / 60, 1), "vehicles_per_clip_rolling": p["rolling"],
                      "ratio_to_normal": p["ratio"], "source": p["source"]}
        return out

    def summarize_video(self, original_video, question=None):
        r = self.vss.synthesize(original_video, question or "Summarize what happens in this video for a traffic operator")
        return {"answer": r.get("answer"), "segments_used": r.get("segments_used")}

    # -- loop -------------------------------------------------------------
    def run(self, question, history=None, max_steps=7):
        client = self._setup()
        messages = [{"role": "system", "content": SYSTEM.format(catalogue=self._catalogue())}] + (history or []) + [{"role": "user", "content": question}]
        trace, t0 = [], time.time()
        for _ in range(max_steps):
            r = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS,
                                               temperature=0, max_tokens=700)
            m = r.choices[0].message
            if not m.tool_calls:
                return {"answer": m.content or "", "trace": trace, "model": MODEL,
                        "seconds": round(time.time() - t0, 1),
                        "weave_url": f"https://wandb.ai/{WEAVE_PROJECT}/weave" if WEAVE_PROJECT else None}
            messages.append({"role": "assistant", "content": m.content or "",
                             "tool_calls": [tc.model_dump() for tc in m.tool_calls]})
            for tc in m.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                t1 = time.time()
                try:
                    result = getattr(self, name)(**args)
                except Exception as e:
                    result = {"error": str(e)}
                trace.append({"tool": name, "args": args, "seconds": round(time.time() - t1, 2),
                              "result_preview": json.dumps(result)[:300]})
                messages.append({"role": "tool", "tool_call_id": tc.id, "name": name,
                                 "content": json.dumps(result)[:12000]})
        return {"answer": "I ran out of steps before reaching an answer.", "trace": trace, "model": MODEL,
                "seconds": round(time.time() - t0, 1)}


def traced(agent):
    """Wrap the agent's public methods as Weave ops when weave is available."""
    try:
        import weave
    except ImportError:
        return agent
    for name in ("run", "search_clips", "list_incidents", "camera_stats", "summarize_video"):
        setattr(agent, name, weave.op(name=f"citylens.{name}")(getattr(agent, name)))
    return agent
