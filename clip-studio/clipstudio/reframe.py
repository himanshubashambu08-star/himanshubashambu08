"""Step 4: decide how to turn a 16:9 clip into 9:16.

If a face is on screen most of the time (talking, reactions) we crop around it.
Otherwise (gameplay, trailers, wide shots) we keep the full frame over a
blurred background so nothing important is cut off.
"""
from pathlib import Path

import cv2
import numpy as np


def plan_reframe(video: Path, start: float, end: float, samples: int = 16) -> dict:
    cap = cv2.VideoCapture(str(video))
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1
    if height >= width:  # already vertical
        cap.release()
        return {"mode": "vertical", "cx": 0.5}

    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    centers = []
    for t in np.linspace(start, end, samples, endpoint=False):
        cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(cv2.resize(frame, (640, int(640 * height / width))), cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=6, minSize=(48, 48))
        if len(faces):
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            # small facecam boxes in a corner don't count as "the subject"
            if w * h >= 0.02 * gray.shape[0] * gray.shape[1]:
                centers.append((x + w / 2) / gray.shape[1])
    cap.release()

    if len(centers) >= samples * 0.5:
        return {"mode": "crop", "cx": float(np.median(centers))}
    return {"mode": "fit", "cx": 0.5}
