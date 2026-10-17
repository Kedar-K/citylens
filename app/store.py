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
FIXED = {"sf_streets_cam-1", "sf_streets_cam-2", "sf_streets_cam-3", "sf_streets_cam-4", "sf_streets_cam-5",
         "nyc_streets_cam-1", "nyc_streets_cam-2", "neighborhood_cam-1"}
INCIDENT_SCHEMA = pa.schema([
    ("id", pa.utf8()), ("detected_at", pa.utf8()), ("rule_id", pa.utf8()), ("rule", pa.utf8()),
    ("severity", pa.utf8()), ("camera_id", pa.utf8()), ("location", pa.utf8()),
    ("source", pa.utf8()), ("original_video", pa.utf8()), ("segment_start_sec", pa.float32()),
    ("similarity", pa.float32()), ("verdict", pa.utf8()), ("confidence", pa.float32()),
    ("reason", pa.utf8()), ("caption", pa.utf8()), ("status", pa.utf8()),
])
INCIDENT_COLS = [f.name for f in INCIDENT_SCHEMA]
ACTION_SCHEMA = pa.schema([
    ("id", pa.utf8()), ("created_at", pa.utf8()), ("kind", pa.utf8()), ("reference", pa.utf8()),
    ("incident_id", pa.utf8()), ("rule", pa.utf8()), ("camera_id", pa.utf8()), ("location", pa.utf8()),
    ("source", pa.utf8()), ("summary", pa.utf8()), ("note", pa.utf8()), ("status", pa.utf8()),
])
ACTION_COLS = [f.name for f in ACTION_SCHEMA]
CASE_CATEGORY = {"lane_blocked": "Blocked travel lane", "pedestrian_conflict": "Pedestrian safety",
                 "cyclist_squeeze": "Cyclist safety", "congestion": "Traffic congestion",
                 "work_zone": "Street work / permit check", "lane_closure": "Lane closure / permit check",
                 "garbage_dumping": "Illegal dumping / street cleaning", "person_down": "Person down / medical"}


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

    def reingested(self):
        return sum(1 for r in self.rows() if "/reingest/" in (r.get("source") or ""))

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

    CITIES = {"san_francisco": ("San Francisco", 37.7749, -122.4194),
              "new_york": ("New York", 40.7128, -74.0060),
              "toronto": ("Toronto", 43.6532, -79.3832),
              "nashville": ("Nashville", 36.1627, -86.7816)}

    def overview(self, incidents, spark_points=40):
        """Everything the Overview screen needs in one call."""
        rows = self.rows()
        cams = {}
        for r in rows:
            cams.setdefault(r["camera_id"], []).append(r)
        conf = [i for i in incidents if i.get("status") == "confirmed"]
        dis = [i for i in incidents if i.get("status") == "dismissed"]
        by_cam = {}
        for i in conf:
            by_cam.setdefault(i["camera_id"], []).append(i)
        cameras = []
        for cam, rs in cams.items():
            v = [x["vehicles"] for x in rs]
            base = statistics.median(v) if v else 0
            step = max(1, len(v) // spark_points)
            spark = [round(sum(v[i:i + step]) / len(v[i:i + step]), 1) for i in range(0, len(v), step)]
            recent = v[-12:]
            ratio = (sum(recent) / len(recent) / base) if base and recent else None
            n_inc = len(by_cam.get(cam, []))
            status = "incident" if n_inc else ("busy" if ratio and ratio > 1.3 else ("quiet" if ratio and ratio < 0.6 else "normal"))
            cameras.append({"camera_id": cam, "location": rs[0]["location"], "capture_type": rs[0]["capture_type"],
                            "segments": len(rs), "minutes": round(sum((x.get("duration") or 5) for x in rs) / 60, 1),
                            "baseline": base, "ratio": round(ratio, 2) if ratio else None, "status": status,
                            "incidents": n_inc, "spark": spark, "latest_source": rs[-1]["source"],
                            "people_median": statistics.median(x["people"] for x in rs),
                            "fixed": cam in FIXED})
        cameras.sort(key=lambda c: (not c["fixed"], {"incident": 0, "busy": 1, "normal": 2, "quiet": 3}[c["status"]], c["camera_id"]))
        cities = []
        for loc, (name, lat, lon) in self.CITIES.items():
            cs = [c for c in cameras if c["location"] == loc]
            if cs:
                cities.append({"location": loc, "name": name, "lat": lat, "lon": lon, "cameras": len(cs),
                               "minutes": round(sum(c["minutes"] for c in cs), 1),
                               "incidents": sum(c["incidents"] for c in cs),
                               "status": "incident" if any(c["status"] == "incident" for c in cs) else "normal"})
        objects = {}
        for r in rows:
            for k, n in r["counts"].items():
                objects[k] = objects.get(k, 0) + n
        top_objects = sorted(objects.items(), key=lambda kv: -kv[1])[:8]
        return {"kpis": {"cameras": len(cameras), "fixed_cameras": sum(c["fixed"] for c in cameras),
                         "clips": len(rows), "minutes": round(sum(c["minutes"] for c in cameras)),
                         "detections": sum(sum(r["counts"].values()) for r in rows),
                         "incidents_confirmed": len(conf), "false_alarms_suppressed": len(dis),
                         "cities": len(cities)},
                "cities": cities, "cameras": cameras, "top_objects": top_objects,
                "feed": conf[:12]}

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
        full = series[window - 1:] or series  # only judge peaks on a full rolling window
        peak = max(full, key=lambda s: s["rolling"])
        quiet = min(full, key=lambda s: s["rolling"])
        mix = {}
        for r in rows:
            for k, n in r["counts"].items():
                mix[k] = mix.get(k, 0) + n
        mix = sorted(mix.items(), key=lambda kv: -kv[1])[:7]
        return {"object_mix": mix,"camera_id": camera_id, "location": rows[0]["location"], "segments": len(rows),
                "baseline_vehicles": base, "people_median": statistics.median(r["people"] for r in rows),
                "current_ratio": series[-1]["ratio"], "peak": peak, "quiet": quiet,
                "series": series}

    # -- incidents ----------------------------------------------------------
    def _incidents_table(self, tx):
        b = tx.bucket(self.bucket)
        sch = b.schema("citylens", fail_if_missing=False) or b.create_schema("citylens")
        t = sch.table("incidents", fail_if_missing=False)
        if t is not None:
            cols = t.columns() if callable(t.columns) else t.columns
            if {c.name for c in cols} != set(INCIDENT_COLS):  # stale layout from an earlier build
                t.drop()
                t = None
        return t or sch.create_table("incidents", columns=INCIDENT_SCHEMA)

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
        rank = {"confirmed": 0, "candidate": 1, "dismissed": 2}
        out.sort(key=lambda i: (rank.get(i.get("status"), 3), -(i.get("confidence") or 0), i.get("detected_at") or ""))
        return out

    # -- actions ------------------------------------------------------------
    def _table(self, tx, name, schema, cols):
        b = tx.bucket(self.bucket)
        sch = b.schema("citylens", fail_if_missing=False) or b.create_schema("citylens")
        t = sch.table(name, fail_if_missing=False)
        if t is not None:
            have = t.columns() if callable(t.columns) else t.columns
            if {c.name for c in have} != set(cols):
                t.drop()
                t = None
        return t or sch.create_table(name, columns=schema)

    def actions(self):
        out = []
        with self.session().transaction() as tx:
            for batch in self._table(tx, "actions", ACTION_SCHEMA, ACTION_COLS).select(columns=ACTION_COLS):
                out.extend(batch.to_pylist())
        out.sort(key=lambda a: a.get("created_at") or "", reverse=True)
        return out

    def create_action(self, inc, kind="311_case", note=None):
        import hashlib
        existing = [a for a in self.actions() if a["incident_id"] == inc["id"] and a["kind"] == kind]
        if existing:
            return existing[0]
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        ref = ("CL-" if kind == "311_case" else "DX-") + hashlib.sha1(f"{inc['id']}{kind}".encode()).hexdigest()[:6].upper()
        row = {"id": hashlib.sha256(f"{inc['id']}|{kind}".encode()).hexdigest()[:16], "created_at": ts, "kind": kind,
               "reference": ref, "incident_id": inc["id"], "rule": inc.get("rule"), "camera_id": inc.get("camera_id"),
               "location": inc.get("location"), "source": inc.get("source"),
               "summary": f"{CASE_CATEGORY.get(inc.get('rule_id'), inc.get('rule'))}: {inc.get('reason') or ''}".strip(),
               "note": note or "", "status": "recorded (demo: not transmitted to the city)"}
        with self.session().transaction() as tx:
            self._table(tx, "actions", ACTION_SCHEMA, ACTION_COLS).insert(
                pa.table({k: [row[k]] for k in ACTION_COLS}, schema=ACTION_SCHEMA))
        return row
