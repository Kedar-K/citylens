"""Detect: run every operator rule over the street cameras and produce incident candidates."""
import concurrent.futures as cf
import hashlib
import time

from .rules import RULES, STREET_CAMERA_FILTER


def _incident_id(rule_id, source):
    return hashlib.sha256(f"{rule_id}|{source}".encode()).hexdigest()[:16]


def run_rules(vss, cameras=None, rules=None, top_k=12, extra_filters=None):
    """Return candidate incidents: one per (rule, segment) above the rule's similarity floor."""
    rules = rules or RULES
    filters = dict(STREET_CAMERA_FILTER)
    if extra_filters:
        filters.update(extra_filters)
    cams = cameras or [None]
    jobs = [(r, c) for r in rules for c in cams]

    def one(job):
        rule, cam = job
        f = dict(filters)
        if cam:
            f["camera_id"] = cam
        res = vss.search(rule["query"], top_k=top_k, min_similarity=rule["min_similarity"],
                         metadata_filters=f, llm_top_n=1)
        out = []
        for hit in res.get("results", []):
            out.append({
                "id": _incident_id(rule["id"], hit["source"]),
                "rule_id": rule["id"], "rule": rule["name"], "severity": rule["severity"],
                "camera_id": hit.get("camera_id"), "location": hit.get("location"),
                "source": hit["source"], "original_video": hit.get("original_video"),
                "segment_start_sec": hit.get("segment_start_sec"),
                "segment_end_sec": hit.get("segment_end_sec"),
                "upload_timestamp": hit.get("upload_timestamp"),
                "similarity": round(hit.get("similarity_score", 0), 3),
                "caption": hit.get("reasoning_content") or "",
                "object_counts": hit.get("object_counts"),
                "verdict": None, "confidence": None, "reason": None,
                "status": "candidate", "detected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        return out

    found = {}
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for batch in ex.map(one, jobs):
            for inc in batch:
                found.setdefault(inc["id"], inc)
    return sorted(found.values(), key=lambda x: -x["similarity"])
