# CityLens

**Street cameras, watched.** A traffic operations workspace that turns a city's camera archive into verified incidents, answers and numbers, built on the VAST Builders Challenge stack.

A city has hundreds of traffic cameras and a handful of people watching them. CityLens watches every camera, surfaces only what matters, explains each call, and lets an operator ask the cameras questions in plain language.

## What it does

| Screen | What an operator gets | How |
|---|---|---|
| **Overview** | Network map, incident feed, camera wall with load vs each camera's own normal | VastDB index + CityLens incidents |
| **Incidents** | Rules run across every street camera; each candidate is **verified by Cosmos Reason** with a yes/no verdict and a reason; confirmed incidents are stored | hybrid search → Cosmos Reason → VastDB |
| **Investigate** | Ask questions, get answers with playable clip evidence and a visible tool trace | GPT-OSS 120B on W&B Inference, traced in Weave |
| **Measure** | Vehicles and people per clip against the camera's normal, object mix, camera comparison, busiest and quietest minute | YOLO11 counts stored with every clip |
| **System** | The pipeline, data-layer health, model endpoints, agent | live checks |

### Rules

Each rule is a saved natural-language query over the clip captions plus a pointed verification question for Cosmos Reason:

- Vehicle blocking a travel lane
- Pedestrian in conflict with moving traffic
- Cyclist or scooter close to moving vehicles
- Congestion or stopped traffic
- Work zone, cones or barriers (also watched from the Toronto dashcam drives)
- Lane closed by street work (also from the dashcam)

Semantic search alone gives "probably". The verification step is what turns a similarity score into an incident an operator can act on. In the first sweep across 8 cameras, 15 incidents were confirmed and 89 lookalikes were dismissed with reasons such as *"the pedestrian is using the marked crosswalk and has the right of way"*.

### The prompt is the product

The archive's default captions describe scenes. CityLens re-captions street cameras with a traffic-operations prompt (flow state, vehicles standing in a lane vs parked, pedestrians outside crosswalks, cyclists near vehicles, work zones, signal state), so the same video answers operator questions.

## Architecture

```
Street cameras ─► VAST S3 ─► Segmenter ─► YOLO11 ─► Cosmos Reason ─► Cosmos Embed1 ─► VastDB (vss-collection)
                                                                                           │
                       CityLens rules ◄────────── hybrid search over captions + visual vectors ┘
                             │ candidates
                       Cosmos Reason verdict (yes / no + reason)
                             │ confirmed
                       VastDB (citylens.incidents) ◄──── Agent on W&B Inference, traced in Weave
                                                          └── tools: search_clips · list_incidents · camera_stats · summarize_video
```

Everything CityLens produces lands next to the index in the same VAST database. The agent never opens a video file; it only queries data.

### Sponsor stack

| | Used for |
|---|---|
| **VAST AI OS** | S3 for clips, DataEngine ingest pipeline, VastDB for vectors, captions, detections and CityLens's own incident table |
| **NVIDIA Cosmos Reason** | operator captions at ingest, and the yes/no verdict on every candidate clip |
| **NVIDIA Cosmos Embed1** | 256-d text and visual vectors behind hybrid search |
| **YOLO11** | objects and counts on every clip, the basis of Measure |
| **Weights & Biases** | GPT-OSS 120B via W&B Inference for the agent; every tool call traced in Weave |
| **CoreWeave** | the GPUs the models run on |

## Repository

```
app/
  main.py      FastAPI API + UI server
  vss.py       client for the video search backend
  rules.py     operator rules (query + verification question)
  detect.py    run rules across cameras → candidates
  verify.py    Cosmos Reason verdict on a clip
  store.py     VastDB: index reads, measurement, incident table
  agent.py     tool-using agent on W&B Inference with Weave tracing
  thumbs.py    poster frames for clips
  static/      the operator UI (no build step)
deploy/
  k8s-deploy.sh   on-cluster deployment without a registry (ConfigMaps + Secret + Ingress at /app)
```

## Run

Locally against the team environment (credentials come from the environment, nothing is hardcoded):

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
PORT=8080 .venv/bin/python app/main.py
```

On the cluster:

```bash
./deploy/k8s-deploy.sh
```

Then open the workshop page and click **App**.

## Next

- **Permit matching.** Work zones seen by cameras and dashcams matched against the city's permit register, so an unpermitted closure becomes an incident. The dashcam work-zone and lane-closure rules are the input for this.
- **Live streams.** The pipeline already accepts streams; CityLens rules would run on each new chunk instead of on demand.
- **Audio.** Canary ASR on dashcam audio for sirens and horns.
