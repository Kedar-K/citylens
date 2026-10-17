"""Operator rules: what CityLens watches for on every camera.

Each rule is a saved natural-language query over the indexed captions, a similarity floor,
and a yes/no question the verifier asks Cosmos Reason about each candidate clip.
"""

RULES = [
    {
        "id": "lane_blocked",
        "name": "Vehicle blocking a travel lane",
        "severity": "high",
        "query": "a vehicle stopped or standing in a travel lane, bus stop or bike lane while other traffic moves around it",
        "min_similarity": 0.27,
        "verify": ("Is there a vehicle stopped or standing in a travel lane, bike lane, crosswalk or bus stop, "
                   "obstructing the flow of other traffic? Vehicles parked at the curb, or vehicles stopped at a "
                   "red light or in a queue, do NOT count."),
    },
    {
        "id": "pedestrian_conflict",
        "name": "Pedestrian in conflict with moving traffic",
        "severity": "high",
        "query": "a pedestrian in the roadway outside the crosswalk or crossing while vehicles are moving toward them",
        "min_similarity": 0.30,
        "verify": ("Is a pedestrian in the roadway outside a marked crosswalk, or crossing while a vehicle is moving "
                   "toward or close to them? People waiting on the sidewalk or crossing with a clear signal do NOT count."),
    },
    {
        "id": "cyclist_squeeze",
        "name": "Cyclist or scooter close to moving vehicles",
        "severity": "medium",
        "query": "a cyclist or scooter rider very close to a moving car, bus or truck",
        "min_similarity": 0.30,
        "verify": "Is a cyclist or scooter rider within roughly one metre of a moving motor vehicle?",
    },
    {
        "id": "congestion",
        "name": "Congestion or stopped traffic",
        "severity": "medium",
        "query": "heavy congestion with vehicles queued and barely moving through the intersection",
        "min_similarity": 0.33,
        "verify": "Is traffic congested or stopped, with vehicles queued and barely moving, rather than flowing freely?",
    },
    {
        "id": "work_zone",
        "name": "Work zone, cones or barriers",
        "severity": "low",
        "query": "construction work zone with traffic cones, barriers or a crew on the road",
        "min_similarity": 0.30,
        "verify": "Are there traffic cones, barriers, a work crew or construction equipment occupying part of the road?",
    },
]

RULE_BY_ID = {r["id"]: r for r in RULES}

# Cameras CityLens treats as city street cameras (fixed, roadside).
STREET_CAMERA_FILTER = {"capture_type": "streets"}
