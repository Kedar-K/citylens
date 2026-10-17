"""Store: CityLens tables in the team's VastDB, next to the video index.

- reads the pipeline's own `vss-schema.vss-collection` for per-segment detections (Measure)
- writes verified incidents to `citylens.incidents`
"""
import json
import os
import statistics
import threading
import time
import warnings

import pyarrow as pa

warnings.filterwarnings("ignore", message="Unverified HTTPS request")

VEHICLE = ("car", "truck", "bus", "motorcycle")
INCIDENT_SCHEMA = pa.schema([
    ("id", pa.utf8()), ("detected_at", pa.utf8()), ("rule_id", pa.utf8()), ("rule", pa.utf8()),
    ("severity", pa.utf8()), ("camera_id", pa.utf8()), ("location", pa.utf8()),
    ("source", pa.utf8()), ("original_video", pa.utf8()), ("segment_start_sec", pa.float32()),
    ("similarity", pa.float32()), ("verdict", pa.utf8()), ("confidence", pa.float32()),
    ("reason", pa.utf8()), ("caption", pa.utf8()), ("status", pa.utf8()),
])
INCIDENT_COLS = [f.name for f in INCIDENT_SCHEMA]


class Store:
    def __init__(self):
        self.endpoint = os.environ.get("VDB_ENDPOINT") or os.environ["S3_ENDPOINT"]
        self.access = os.environ["ACCESS_KEY"]
        self.secret = os.environ["SECRET_KEY"]
        self.bucket = os.environ["VASTDB_BUCKET"]
        self.schema = os.environ.get("VDB_SCHEMA", "vss-schema")
        self.collection = os.environ.get("VDB_COLLECTION", "vss-collection")
        self._session = None
        self._rows_cache = (0, None)
        self._lock = threading.Lock()

    def session(self):
        if self._session is None:
            import vastdb
            self._session = vastdb.connect(endpoint=self.endpoint, access=self.access,
                                           secret=self.secret, ssl_verify=False)
        return self._session

    # -- pipeline index -----------------------------------------------------
    def rows(self, max_age=60):
        """All indexed segments (no vectors), cached."""
        with self._lock:
            ts, data = self._rows_cache
            if data is not None and time.time() - ts < max_age:
                return data
            cols = ["camera_id", "location", "capture_type", "segment_number", "segment_start_sec",
                    "upload_timestamp", "object_counts", "object_classes", "original_video",
                    "source", "duration", "reasoning_content"]
            out = []
            with self.session().transaction() as tx:
                t = tx.bucket(self.bucket).schema(self.schema).table(self.collection)
                for batch in t.select(columns=cols):
                    out.extend(batch.to_pylist())
            for r in out:
                try:
                    r["counts"] = json.loads(r.get("object_counts") or "{}")
                except json.JSONDecodeError:
                    r["counts"] = {}
                r["vehicles"] = sum(r["counts"].get(k, 0) for k in VEHICLE)
                r["people"] = r["counts"].get("person", 0)
                r["bikes"] = r["counts"].get("bicycle", 0)
                ut = r.get("upload_timestamp")
                r["upload_timestamp"] = ut.isoformat() if hasattr(ut, "isoformat") else ut
            out.sort(key=lambda r: (r.get("original_video") or "", r.get("segment_number") or 0))
            self._rows_cache = (time.time(), out)
            return out

    def cameras(self):
        cams = {}
        for r in self.rows():
            c = cams.setdefault(r["camera_id"], {"camera_id": r["camera_id"], "location": r["location"],
                                                  "capture_type": r["capture_type"], "segments": 0,
                                                  "seconds": 0.0, "vehicles": [], "people": []})
            c["segments"] += 1
            c["seconds"] += r.get("duration") or 5.0
            c["vehicles"].append(r["vehicles"])
            c["people"].append(r["people"])
        out = []
        for c in cams.values():
            v, p = c.pop("vehicles"), c.pop("people")
            c["minutes"] = round(c.pop("seconds") / 60, 1)
            c["vehicles_median"] = statistics.median(v) if v else 0
            c["vehicles_max"] = max(v) if v else 0
            c["people_median"] = statistics.median(p) if p else 0
            out.append(c)
        return sorted(out, key=lambda c: (c["capture_type"] != "streets", c["location"], c["camera_id"]))

    def measure(self, camera_id, window=12):
        """Per-segment vehicle/people series for one camera, with that camera's own baseline."""
        rows = [r for r in self.rows() if r["camera_id"] == camera_id]
        if not rows:
            return None
        v = [r["vehicles"] for r in rows]
        base = statistics.median(v)
        series = []
        for i, r in enumerate(rows):
            recent = v[max(0, i - window + 1): i + 1]
            cur = sum(recent) / len(recent)
            series.append({"i": i, "t": r.get("upload_timestamp"), "seg": r["segment_number"],
                           "source": r["source"], "original_video": r["original_video"],
                           "vehicles": r["vehicles"], "people": r["people"], "bikes": r["bikes"],
                           "rolling": round(cur, 1),
                           "ratio": round(cur / base, 2) if base else None})
        peak = max(series, key=lambda s: s["rolling"])
        quiet = min(series, key=lambda s: s["rolling"])
        return {"camera_id": camera_id, "location": rows[0]["location"], "segments": len(rows),
                "baseline_vehicles": base, "people_median": statistics.median(r["people"] for r in rows),
                "current_ratio": series[-1]["ratio"], "peak": peak, "quiet": quiet,
                "series": series}

    # -- incidents ----------------------------------------------------------
    def _incidents_table(self, tx):
        b = tx.bucket(self.bucket)
        sch = b.schema("citylens", fail_if_missing=False) or b.create_schema("citylens")
        return (sch.table("incidents", fail_if_missing=False)
                or sch.create_table("incidents", columns=INCIDENT_SCHEMA))

    def save_incidents(self, incidents):
        if not incidents:
            return 0
        existing = {i["id"] for i in self.incidents()}
        new = [i for i in incidents if i["id"] not in existing]
        if not new:
            return 0
        cols = {}
        for f in INCIDENT_SCHEMA:
            vals = []
            for i in new:
                v = i.get(f.name)
                if pa.types.is_floating(f.type):
                    v = float(v) if v is not None else None
                elif v is not None:
                    v = str(v)
                vals.append(v)
            cols[f.name] = vals
        with self.session().transaction() as tx:
            self._incidents_table(tx).insert(pa.table(cols, schema=INCIDENT_SCHEMA))
        return len(new)

    def incidents(self, status=None, camera_id=None, rule_id=None):
        out = []
        with self.session().transaction() as tx:
            t = self._incidents_table(tx)
            for batch in t.select(columns=INCIDENT_COLS):
                out.extend(batch.to_pylist())
        if status:
            out = [i for i in out if i.get("status") == status]
        if camera_id:
            out = [i for i in out if i.get("camera_id") == camera_id]
        if rule_id:
            out = [i for i in out if i.get("rule_id") == rule_id]
        out.sort(key=lambda i: (i.get("detected_at") or "", -(i.get("confidence") or 0)), reverse=True)
        return out
