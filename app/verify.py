"""Verify: ask Cosmos Reason a pointed yes/no question about one candidate clip."""
import base64
import json
import os
import re
import urllib.request

from .rules import RULE_BY_ID

GPU_HOST = os.environ.get("GPU_HOST", "166.19.38.112")
COSMOS_URL = os.environ.get("COSMOS3_REASON_URL") or f"http://{GPU_HOST}:8001"
COSMOS_MODEL = os.environ.get("COSMOS3_REASON_MODEL", "nvidia/cosmos3-nano-reasoner")

_FMT = ("Watch the clip and answer the question. Reply in exactly this form:\n"
        "VERDICT: yes or no\nCONFIDENCE: a number from 0 to 1\nREASON: one short sentence naming what you see\n"
        "Question: ")


def ask_cosmos(clip_bytes, question, max_tokens=200):
    body = {"model": COSMOS_MODEL, "max_tokens": max_tokens, "temperature": 0,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": _FMT + question},
                {"type": "video_url", "video_url": {"url": "data:video/mp4;base64,"
                                                           + base64.b64encode(clip_bytes).decode()}}]}]}
    req = urllib.request.Request(COSMOS_URL + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + os.environ["GPU_BEARER_TOKEN"])
    with urllib.request.urlopen(req, timeout=240) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    def grab(key, default=""):
        m = re.search(rf"{key}\s*:\s*(.+)", text, re.I)
        return m.group(1).strip() if m else default
    verdict = grab("verdict").lower()
    if not verdict.startswith(("yes", "no")):
        first = text.strip().split()[0].lower() if text.strip() else "no"
        verdict = "yes" if first.startswith("yes") else "no"
    verdict = "yes" if verdict.startswith("yes") else "no"
    try:
        conf = float(re.findall(r"[0-9.]+", grab("confidence", "0.5"))[0])
    except (IndexError, ValueError):
        conf = 0.5
    reason = grab("reason") or text.strip()[:240]
    return {"verdict": verdict, "confidence": max(0.0, min(1.0, conf)), "reason": reason, "raw": text.strip()[:400]}


def verify_incident(vss, inc):
    rule = RULE_BY_ID[inc["rule_id"]]
    clip = vss.fetch_clip(inc["source"])
    v = ask_cosmos(clip, rule["verify"])
    inc.update(v)
    inc["status"] = "confirmed" if v["verdict"] == "yes" else "dismissed"
    return inc
