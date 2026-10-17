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
- If the tools return nothing relevant, say so plainly.
Cameras are fixed street cameras (capture_type "streets") in san_francisco and new_york, plus toronto dashcam,
nashville highway and a residential neighborhood camera."""

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
        if camera_id:
            f["camera_id"] = camera_id
        if location:
            f["location"] = location
        res = self.vss.search(query, top_k=min(int(top_k or 8), 15), min_similarity=0.25,
                              metadata_filters=f, llm_top_n=1)
        return [{"source": r["source"], "camera_id": r.get("camera_id"), "location": r.get("location"),
                 "start_sec": r.get("segment_start_sec"), "similarity": round(r.get("similarity_score", 0), 3),
                 "caption": (r.get("reasoning_content") or "")[:400], "objects": r.get("object_counts")}
                for r in res.get("results", [])]

    def list_incidents(self, status="confirmed", camera_id=None, rule_id=None):
        rows = self.store.incidents(status=status, camera_id=camera_id, rule_id=rule_id)
        return [{k: r.get(k) for k in ("id", "rule", "severity", "camera_id", "location", "source",
                                       "segment_start_sec", "confidence", "reason", "detected_at")}
                for r in rows[:20]]

    def camera_stats(self, camera_id=None):
        if not camera_id:
            return self.store.cameras()
        m = self.store.measure(camera_id)
        if not m:
            return {"error": f"unknown camera {camera_id}"}
        return {k: m[k] for k in ("camera_id", "location", "segments", "baseline_vehicles",
                                  "people_median", "current_ratio", "peak", "quiet")}

    def summarize_video(self, original_video, question=None):
        r = self.vss.synthesize(original_video, question or "Summarize what happens in this video for a traffic operator")
        return {"answer": r.get("answer"), "segments_used": r.get("segments_used")}

    # -- loop -------------------------------------------------------------
    def run(self, question, history=None, max_steps=5):
        client = self._setup()
        messages = [{"role": "system", "content": SYSTEM}] + (history or []) + [{"role": "user", "content": question}]
        trace, t0 = [], time.time()
        for _ in range(max_steps):
            r = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS,
                                               temperature=0, max_tokens=700)
            m = r.choices[0].message
            if not m.tool_calls:
                return {"answer": m.content or "", "trace": trace, "model": MODEL,
                        "seconds": round(time.time() - t0, 1),
                        "weave_url": f"https://wandb.ai/{WEAVE_PROJECT}/weave" if self._weave_ready else None}
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
