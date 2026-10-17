# CityLens — 3 minute demo

Record at 1440×900, App open on Overview, Incidents filter set to "Confirmed only", one Investigate question pre-typed. Speak at a normal pace; the timings below have slack.

**0:00 – 0:20 · The problem (Overview on screen)**
A city has hundreds of traffic cameras and three people watching them. Nobody sees the lane that gets blocked, the pedestrian who steps into traffic, the lane closure nobody permitted. The video is the richest sensor the city owns and it goes unwatched. CityLens watches every camera and surfaces only what matters.

**0:20 – 0:50 · Overview**
Point at the KPI strip: 8 street cameras, 295 minutes indexed, 3,500 clips described by Cosmos, 66,000 objects detected by YOLO. Then the two numbers that matter: incidents confirmed, and false alarms suppressed. Scroll the camera wall: every camera has a live load line against its own normal, because "busy" means something different on every street.

**0:50 – 1:35 · Incidents (the core)**
Click Incidents. "Every rule is a question we ask the archive: a vehicle standing in a live lane, a pedestrian outside the crosswalk, a cyclist squeezed by a bus. Search gives us candidates. Then Cosmos Reason watches each clip and gives a verdict with a reason." Play one confirmed card: read the Cosmos sentence aloud. Then show one dismissed card: "it dismissed this one because the pedestrian was in the crosswalk with the right of way. That is the difference between a detector and something a city can run: the false alarms don't reach the operator." Press Watch now on one camera so the judges see the progress bar and Cosmos verifying live. Mention every verdict lands in our own VastDB table next to the index.

**1:35 – 2:10 · Investigate**
Click Investigate. Ask: "Anything blocking a lane in San Francisco?" Point at the trace panel while it runs: "the agent never opens a video; it queries VAST: incidents, captions, detections. Every call is traced in Weave." Click the clip reference in the answer; it plays. Ask one more: "How busy is NYC Street 1 compared to its normal?"

**2:10 – 2:35 · Measure**
Click Measure. "Counts come from the YOLO detections already stored with every clip. This line is the rolling minute, the dashed line is this camera's own normal, and this bar chart ranks every camera against its normal right now." Click the busiest-minute clip.

**2:35 – 2:55 · System and the stack**
Click System. One sentence per box: VAST holds everything, video, vectors, captions, detections and our incidents, in one place. Cosmos describes and verifies. YOLO counts. The agent runs on W&B Inference and is traced in Weave. GPUs on CoreWeave.

**2:55 – 3:00 · Close**
"Cameras the city already owns. Incidents it can trust. Questions it can ask. CityLens."

## If asked

- *Why both YOLO and Cosmos?* YOLO is fast and cheap and runs on every clip; Cosmos is slow and smart and only looks at candidates. Each does what it's good at.
- *False positives?* That is exactly what the verification step is for. In the first sweep, 15 confirmed and 89 dismissed, each with a reason.
- *Is this live?* The pipeline accepts streams; today the rules run on demand over the archive. Running them per chunk is the next step and needs no new models.
- *Where is Toronto in this?* The dashcam rules flag work zones and lane closures from the road, the input to permit matching: unpermitted closure becomes an incident.
- *Camera positions on the map?* The dataset has no coordinates; the map places cities. Real deployments register camera locations at install.
