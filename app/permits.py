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
        out.append({"id": r.get("permit_number"), "kind": r.get("permit_type"), "road": r.get("streetname"),
                    "where": f"{r.get('streetname')} between {r.get('cross_street_1')} and {r.get('cross_street_2')}",
                    "description": f"{r.get('permit_type')} permit, {r.get('status')}", "holder": r.get("agent"),
                    "permit_type": r.get("permit_type"), "lat": lat, "lon": lon,
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


def triage(incident, camera_pos, items, radius=300):
    """Camera saw street work: is there a permit on file for that spot right now?"""
    if not camera_pos:
        return {"status": "no_location", "note": "camera has no registered position"}
    matches = near(items, camera_pos[1], camera_pos[2], radius)
    if matches:
        m = matches[0]
        return {"status": "permitted", "match": m, "candidates": len(matches),
                "note": f"{m['permit_type'] or m['kind']} on file {m['distance_m']} m away: {m['where']}"}
    return {"status": "no_permit", "candidates": 0,
            "note": f"no active permit or restriction within {radius} m of the camera. Possible unpermitted work."}
