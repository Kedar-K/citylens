"""Client for the team's video search backend (the pre-built VSS stack)."""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class VSSError(RuntimeError):
    pass


class VSS:
    def __init__(self, url=None, username=None, password=None):
        self.url = (url or os.environ.get("VSS_URL") or os.environ["INGRESS_URL"]).rstrip("/")
        self.username = username or os.environ.get("VSS_USERNAME") or os.environ["USERNAME"]
        self.password = password or os.environ.get("VSS_PASSWORD") or os.environ["PASSWORD"]
        self._token = None
        self._lock = threading.Lock()

    # -- auth ---------------------------------------------------------------
    def login(self):
        body = {"username": self.username, "password": self.password}
        data = self._raw("POST", "/api/v1/auth/login", body, auth=False)
        self._token = data["access_token"]
        return self._token

    @property
    def token(self):
        with self._lock:
            if not self._token:
                self.login()
            return self._token

    def _raw(self, method, path, body=None, auth=True, timeout=120):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 401 and auth:
                with self._lock:
                    self._token = None
                req.remove_header("Authorization")
                req.add_header("Authorization", "Bearer " + self.token)
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.load(r)
            raise VSSError(f"{method} {path} -> {e.code}: {e.read()[:300].decode(errors='replace')}")

    def get(self, path, **params):
        if params:
            path += ("&" if "?" in path else "?") + urllib.parse.urlencode(params)
        return self._raw("GET", path)

    def post(self, path, body):
        return self._raw("POST", path, body)

    # -- retrieval ----------------------------------------------------------
    def search(self, query, top_k=15, min_similarity=0.25, metadata_filters=None,
               llm_top_n=1, time_filter="all", tags=None):
        body = {"query": query, "top_k": top_k, "llm_top_n": llm_top_n,
                "min_similarity": min_similarity, "time_filter": time_filter,
                "metadata_filters": metadata_filters or {}, "tags": tags or [],
                "include_public": True}
        return self.post("/api/v1/search", body)

    def ask(self, question, original_video=None, top_k=10):
        body = {"question": question, "top_k": top_k}
        if original_video:
            body["original_video"] = original_video
        return self.post("/api/v1/agent/ask", body)

    def search_and_answer(self, query, **kw):
        body = {"query": query, "top_k": kw.get("top_k", 10),
                "metadata_filters": kw.get("metadata_filters") or {},
                "min_similarity": kw.get("min_similarity", 0.25)}
        return self.post("/api/v1/agent/search-and-answer", body)

    def segments(self, original_video):
        return self.get("/api/v1/tools/segments", original_video=original_video)

    def segment(self, source):
        return self.get("/api/v1/videos/metadata", source=source)

    def detections(self, source):
        return self.get("/api/v1/videos/detections", source=source)

    def synthesize(self, original_video, question, max_segments=40):
        return self.post("/api/v1/videos/synthesize",
                         {"original_video": original_video, "question": question,
                          "max_segments": max_segments})

    def explore(self, limit=100, offset=0, scope="all"):
        return self.get("/api/v1/videos/explore", scope=scope, limit=limit, offset=offset)

    def explore_all(self):
        items, off = [], 0
        while True:
            d = self.explore(limit=100, offset=off)
            items += d.get("chunks", [])
            if not d.get("chunks") or len(items) >= d.get("total", 0):
                return items
            off += 100

    def dashboard(self, scope="all"):
        return self.get("/api/v1/dashboard/stats", scope=scope)

    def schema(self):
        return self.get("/api/v1/metadata/schema")

    def stream_url(self, source):
        return (f"{self.url}/api/v1/videos/stream?"
                + urllib.parse.urlencode({"source": source, "token": self.token}))

    def fetch_clip(self, source):
        """Download a segment mp4 (bytes) through the backend proxy."""
        req = urllib.request.Request(self.stream_url(source))
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()

    # -- ingest -------------------------------------------------------------
    def reingest(self, stream_id=None, original_video=None, chunk_count=1,
                 custom_prompt=None, scenario=None, **meta):
        body = {"chunk_count": chunk_count}
        if stream_id:
            body["stream_id"] = stream_id
        else:
            body["original_video"] = original_video
        if custom_prompt:
            body["custom_prompt"] = custom_prompt
        elif scenario:
            body["scenario"] = scenario
        body.update({k: v for k, v in meta.items() if v})
        return self.post("/api/v1/dashboard/reingest", body)

    def reingest_status(self, job_id):
        return self.get(f"/api/v1/dashboard/reingest/{job_id}")
