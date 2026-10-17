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
        # also watched from the Toronto dashcam drives: street work seen from the road, the input for permit matching
        "extra_cameras": ["pie_cam-3"],
    },
    {
        "id": "lane_closure",
        "name": "Lane closed by street work",
        "severity": "medium",
        "query": "a lane closed off by cones or barriers with traffic merging around construction or utility work",
        "min_similarity": 0.32,
        "verify": ("Is a traffic lane closed or blocked by cones, barriers, a work truck or a road crew, forcing "
                   "vehicles to merge or go around? Cones on the sidewalk or a parked truck alone do NOT count."),
        "extra_cameras": ["pie_cam-3"],
    },
    {
        "id": "garbage_dumping",
        "name": "Dumped garbage or debris on the street",
        "severity": "low",
        "query": "piles of garbage bags, dumped furniture or debris left on the sidewalk or curb",
        "min_similarity": 0.30,
        "verify": ("Is there dumped garbage, a pile of trash bags, discarded furniture or debris on the sidewalk, "
                   "curb or road? A single public bin or a parked vehicle does NOT count."),
    },
    {
        "id": "person_down",
        "name": "Person lying on the ground",
        "severity": "high",
        "query": "a person lying on the ground on the sidewalk or in the road",
        "min_similarity": 0.32,
        "verify": "Is a person lying or collapsed on the ground on the sidewalk or in the road? Sitting on a bench or steps does NOT count.",
    },
]

RULE_BY_ID = {r["id"]: r for r in RULES}

# Fixed roadside cameras CityLens watches by default (dashcams and bike cams are searchable but not watched).
FIXED_CAMERAS = ["sf_streets_cam-1", "sf_streets_cam-2", "sf_streets_cam-3", "sf_streets_cam-4",
                 "sf_streets_cam-5", "nyc_streets_cam-1", "nyc_streets_cam-2", "neighborhood_cam-1"]
