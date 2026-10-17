# CityLens — 3 minute demo

Record at 1440×900, App open on Overview, Incidents filter set to "Confirmed only", one Investigate question pre-typed. Speak at a normal pace; the timings below have slack.

**0:00 – 0:20 · The problem (Overview on screen)**
A city has hundreds of traffic cameras and three people watching them. Nobody sees the lane that gets blocked, the pedestrian who steps into traffic, the lane closure nobody permitted. The video is the richest sensor the city owns and it goes unwatched. CityLens watches every camera and surfaces only what matters.

**0:20 – 0:50 · Overview**
Point at the KPI strip: 8 street cameras, 295 minutes indexed, 3,500 clips described by Cosmos, 66,000 objects detected by YOLO. Then the two numbers that matter: incidents confirmed, and false alarms suppressed. Scroll the camera wall: every camera has a live load line against its own normal, because "busy" means something different on every street.

**0:50 – 1:35 · Incidents (the core)**
Click Incidents. "Every rule is a question we ask the archive: a vehicle standing in a live lane, a pedestrian outside the crosswalk, a cyclist squeezed by a bus. Search gives us candidates. Then Cosmos Reason watches each clip and gives a verdict with a reason." Play one confirmed card: read the Cosmos sentence aloud. Then show one dismissed card: "it dismissed this one because the pedestrian was in the crosswalk with the right of way. That is the difference between a detector and something a city can run: the false alarms don't reach the operator." Press Watch now on one camera so the judges see the progress bar and Cosmos verifying live. Mention every verdict lands in our own VastDB table next to the index.

**1:35 – 2:10 · City view and permit triage**
On the Overview map click "Toronto →". "Click a city and you get the whole city: cameras, what residents report, and the permit register, 1,700 active restrictions live from Toronto's RoDARS. The dashcam confirmed 12 work zones. Each one is checked against permits: on file, possible match, or no permit. That's how a city finds unpermitted work." Press Boxes on one card so the judges see YOLO's boxes on the clip.

**2:10 – 2:35 · Assistant**
Click "Ask the cameras". Ask: "Where did the Toronto dashcam see street work?" Open the tool-call line: "the agent never opens a video; it queries VAST. Every call is traced in Weave." The clips play inline.

**2:35 – 2:55 · How it's built**
Click System. Point at the two bands of the diagram: "Grey is the shared stack, it runs on every clip. Crimson is what we built today, it runs on what matters. Everything we add is a new table or a new question, never a new pipeline."

**2:55 – 3:00 · Close**
"Cameras the city already owns. Incidents it can trust. Questions it can ask. CityLens."

## If asked

- *Why both YOLO and Cosmos?* YOLO is fast and cheap and runs on every clip; Cosmos is slow and smart and only looks at candidates. Each does what it's good at.
- *False positives?* That is exactly what the verification step is for. In the first sweep, 15 confirmed and 89 dismissed, each with a reason.
- *Is this live?* The pipeline accepts streams; today the rules run on demand over the archive. Running them per chunk is the next step and needs no new models.
- *Where is Toronto in this?* The dashcam rules flag work zones and lane closures from the road, the input to permit matching: unpermitted closure becomes an incident.
- *Camera positions on the map?* The dataset has no coordinates; the map places cities. Real deployments register camera locations at install.
