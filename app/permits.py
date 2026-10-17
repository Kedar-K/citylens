"""Permit registers: active road restrictions and street-use permits from city open data, and the
triage that checks a camera-confirmed work zone against them."""
import json
import math
import re
import threading
import time
import urllib.parse
import urllib.request

_cache, _lock, TTL = {}, threading.Lock(), 600
CONSTRUCTION_RULES = ("work_zone", "lane_closure")


def _fetch(url, params=None, sanitize=False):
    u = url + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(u, headers={"User-Agent": "citylens/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        txt = r.read().decode("utf-8", errors="replace")
    if sanitize:  # the Toronto feed ships unescaped backslashes
        txt = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', txt)
    return json.loads(txt)


def _toronto():
    now = time.time() * 1000
    rows = _fetch("https://secure.toronto.ca/opendata/cart/road_restrictions/v3", {"format": "json"}, sanitize=True)["Closure"]
    out = []
    for r in rows:
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (TypeError, ValueError, KeyError):
            continue
        start, end = float(r.get("startTime") or 0), float(r.get("endTime") or 0)
        if r.get("expired") or (start and start > now) or (end and end < now):
            continue
        src = r.get("workEventType") or r.get("source") or ""
        if src.startswith("{"):
            m = re.search(r'"Option":"([^"]+)"', src)
            src = m.group(1) if m else "City"
        out.append({"id": r.get("id"), "kind": r.get("type"), "road": r.get("road"), "where": r.get("name"),
                    "description": r.get("description"), "holder": r.get("contractor") or src,
                    "permit_type": r.get("permitType") or src, "lat": lat, "lon": lon,
                    "start": time.strftime("%Y-%m-%d", time.gmtime(start / 1000)) if start else None,
                    "end": time.strftime("%Y-%m-%d", time.gmtime(end / 1000)) if end else None,
                    "url": r.get("URL")})
    return {"name": "Toronto RoDARS road restrictions", "attribution": "City of Toronto Open Data", "items": out}


SF_TYPES = {"TempOccup": "Temporary street occupancy", "Excavation": "Excavation", "ExcStreet": "Street excavation",
            "StrtImprov": "Street improvement", "Emergency": "Emergency work", "Sidewalk": "Sidewalk work",
            "StorCont": "Storage container", "DebrisBox": "Debris box", "MinorEnc": "Minor encroachment"}


def _san_francisco():
    types = "('Excavation','ExcStreet','StrtImprov','TempOccup','Emergency','Sidewalk','StorCont','DebrisBox')"
    rows = _fetch("https://data.sfgov.org/resource/b6tj-gt35.json",
                  {"$where": f"status in ('APPROVED','RENEWED') AND permit_type in {types} AND latitude IS NOT NULL",
                   "$order": "approved_date DESC", "$limit": 1500,
                   "$select": "permit_number,permit_type,streetname,cross_street_1,cross_street_2,status,approved_date,latitude,longitude,agent"})
    out = []
    for r in rows:
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (TypeError, ValueError, KeyError):
            continue
        kind = SF_TYPES.get(r.get("permit_type"), r.get("permit_type"))
        where = " ".join(w.capitalize() for w in f"{r.get('streetname') or ''}".split())
        c1 = " ".join(w.capitalize() for w in (r.get("cross_street_1") or "").split())
        c2 = " ".join(w.capitalize() for w in (r.get("cross_street_2") or "").split())
        out.append({"id": r.get("permit_number"), "kind": kind, "road": where,
                    "where": f"{where} between {c1} and {c2}" if c1 and c2 else where,
                    "description": f"{kind} permit, {(r.get('status') or '').lower()}", "holder": r.get("agent"),
                    "permit_type": kind, "lat": lat, "lon": lon,
                    "start": (r.get("approved_date") or "")[:10] or None, "end": None, "url": None})
    return {"name": "San Francisco street-use permits", "attribution": "DataSF", "items": out}


SOURCES = {"toronto": _toronto, "san_francisco": _san_francisco}


def permits(location):
    fn = SOURCES.get(location)
    if not fn:
        return None
    with _lock:
        hit = _cache.get(location)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
    try:
        data = fn()
    except Exception as e:
        return {"name": location, "error": str(e)[:140], "items": []}
    data["location"] = location
    data["fetched_at"] = time.strftime("%H:%M UTC", time.gmtime())
    with _lock:
        _cache[location] = (time.time(), data)
    return data


def distance_m(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def near(items, lat, lon, radius=300):
    out = []
    for p in items:
        d = distance_m(lat, lon, p["lat"], p["lon"])
        if d <= radius:
            out.append({**p, "distance_m": round(d)})
    return sorted(out, key=lambda p: p["distance_m"])


def _streets(intersection):
    return [w.strip().lower() for w in re.split(r"&|/| and ", intersection or "") if w.strip()]


def _mentions(p, streets):
    text = " ".join(str(p.get(k) or "") for k in ("road", "where", "description")).lower()
    return any(st and st in text for st in streets)


def triage(incident, camera_pos, items, radius=120, wide=300):
    """Camera saw street work: is there a permit on file for that spot right now?

    Grades, strict to loose. A permit "on file" must be close AND name one of the camera's own streets;
    anything merely nearby is a possible match for the operator to confirm. Dense downtowns have permits
    on every block, so proximity alone proves nothing."""
    if not camera_pos:
        return {"status": "no_location", "note": "camera has no registered position"}
    streets = _streets(camera_pos[0])
    close = near(items, camera_pos[1], camera_pos[2], radius)
    strong = [p for p in close if _mentions(p, streets)]
    nearby = near(items, camera_pos[1], camera_pos[2], wide)
    if strong:
        m = strong[0]
        return {"status": "permitted", "match": m, "candidates": len(nearby), "nearest": nearby[:3],
                "note": f"{m['permit_type'] or m['kind']} on {m['road']} {m['distance_m']} m away, active {m['start'] or ''}{(' to ' + m['end']) if m['end'] else ''}: {m['description'] or m['where']}"}
    if nearby:
        m = nearby[0]
        return {"status": "possible", "match": m, "candidates": len(nearby), "nearest": nearby[:3],
                "note": f"{len(nearby)} active within {wide} m but none on {' or '.join(streets) or 'this street'}; nearest is {m['permit_type'] or m['kind']} on {m['road']} {m['distance_m']} m away. Operator to confirm."}
    return {"status": "no_permit", "candidates": 0, "nearest": [],
            "note": f"no active permit or restriction within {wide} m of the camera. Possible unpermitted work."}
