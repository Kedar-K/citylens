# Narration for citylens-demo.mp4 (2:17)

Timings match the screen recording. Read at a normal pace; each beat has slack.

**0:00 – 0:08 · Overview**
A city has hundreds of traffic cameras and three people watching them. CityLens watches every camera and surfaces only what matters. Eight street cameras, nearly 300 minutes of video, 3,500 clips described, 66,000 objects detected. And the two numbers that count: incidents confirmed, and false alarms suppressed.

**0:08 – 0:14 · 311 layer**
We join what residents report. These are live 311 requests from DataSF, on the same map as the cameras.

**0:14 – 0:22 · Camera wall**
Every camera has a load line against its own normal, because busy means something different on every street.

**0:22 – 0:38 · Toronto city view**
Click a city and you get the whole city. Cameras, confirmed incidents, residents' reports, and the permit register, 1,700 active road restrictions, live from Toronto's RoDARS. The dashcam confirmed twelve work zones. Each one is checked against permits: on file, possible match, or no permit. That is how a city finds unpermitted work.

**0:38 – 0:47 · Confirmed incidents**
Every rule is a question we ask the archive. Search finds candidates. Then Cosmos Reason watches each clip and gives a verdict with a reason. A pedestrian crossing mid-block with vehicles moving. Confirmed, with the sentence that says why.

**0:47 – 0:53 · Boxes**
YOLO's detections are stored with every clip, so we can draw them straight onto the moment.

**0:53 – 1:00 · 30 second context**
And step out to the thirty seconds around it.

**1:00 – 1:05 · Dismissed**
These are the ones Cosmos threw out. A car waiting at a red light is not a blocked lane. The false alarms never reach the operator.

**1:05 – 1:13 · Watch now**
Running a rule live on one camera: search, verify, write to VastDB. Done in seconds.

**1:13 – 1:49 · Assistant**
Ask the cameras. The agent never opens a video. It queries the data layer, incidents, captions, detections, and shows every tool call. Each call is traced in Weave. Where did the Toronto dashcam see street work? Here are the clips, and here is how it got there.

**1:49 – 2:01 · Camera page**
One camera. Vehicles and people against its own normal, the object mix, and a storyboard of the whole recording with the incidents pinned on the timeline.

**2:01 – 2:07 · Storyboard**
Click a pin and it plays.

**2:07 – 2:14 · How it's built**
Grey is the shared stack. It runs on every clip. Crimson is what we built today. It runs on what matters. Everything we add is a new table or a new question, never a new pipeline.

**2:14 – 2:17 · Close**
Cameras the city already owns. Incidents it can trust. Questions it can ask. CityLens.
