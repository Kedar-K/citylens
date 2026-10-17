"""City context: live 311 service requests from open data, cached. City level only (the camera
archive has no coordinates), so this is the resident-reported side of the same streets."""
import json
import threading
import time
import urllib.parse
import urllib.request

_cache = {}
_lock = threading.Lock()
TTL = 300

SOURCES = {
    "san_francisco": {
        "name": "San Francisco 311", "attribution": "DataSF", "url": "https://data.sfgov.org/resource/vw6y-z8j6.json",
        "params": {"$limit": 400, "$order": "requested_datetime DESC", "$select": "service_name,service_subtype,requested_datetime,status_description,lat,long,address,analysis_neighborhood"},
        "map": lambda r: {"category": r.get("service_name"), "detail": r.get("service_subtype"), "when": r.get("requested_datetime"),
                          "status": r.get("status_description"), "lat": _f(r.get("lat")), "lon": _f(r.get("long")),
                          "where": r.get("analysis_neighborhood") or r.get("address")},
    },
    "new_york": {
        "name": "New York City 311", "attribution": "NYC Open Data", "url": "https://data.cityofnewyork.us/resource/erm2-nwe9.json",
        "params": {"$limit": 400, "$order": "created_date DESC", "$select": "complaint_type,descriptor,created_date,status,latitude,longitude,borough,incident_address"},
        "map": lambda r: {"category": r.get("complaint_type"), "detail": r.get("descriptor"), "when": r.get("created_date"),
                          "status": r.get("status"), "lat": _f(r.get("latitude")), "lon": _f(r.get("longitude")),
                          "where": r.get("borough") or r.get("incident_address")},
    },
}
# categories a street camera could corroborate
STREET_WORDS = ("street", "sidewalk", "traffic", "parking", "vehicle", "encampment", "graffiti", "dumping", "cleaning",
                "blocked", "driveway", "pothole", "sign", "tree", "curb", "lane", "noise - street", "homeless", "garbage", "litter")


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def city(location):
    src = SOURCES.get(location)
    if not src:
        return None
    with _lock:
        hit = _cache.get(location)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
    url = src["url"] + "?" + urllib.parse.urlencode(src["params"])
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            rows = [src["map"](x) for x in json.load(r)]
    except Exception as e:
        return {"location": location, "name": src["name"], "error": str(e)[:120], "cases": [], "categories": []}
    cats = {}
    for x in rows:
        if x["category"]:
            cats[x["category"]] = cats.get(x["category"], 0) + 1
    top = sorted(cats.items(), key=lambda kv: -kv[1])[:8]
    street = sum(n for c, n in cats.items() if any(w in c.lower() for w in STREET_WORDS))
    out = {"location": location, "name": src["name"], "attribution": src["attribution"], "fetched_at": time.strftime("%H:%M UTC", time.gmtime()),
           "total": len(rows), "street_related": street, "categories": top,
           "latest": rows[0]["when"] if rows else None,
           "cases": [x for x in rows if x["lat"] and x["lon"]][:400]}
    with _lock:
        _cache[location] = (time.time(), out)
    return out
