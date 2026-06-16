import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
import asyncio
import websockets
import json
import time
import urllib.request
import os

WS_URL = "ws://localhost:8000/ws/tracking"
TARGET_FPS = 25
FRAME_INTERVAL = 1.0 / TARGET_FPS

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]


def download_model():
    if not os.path.exists(MODEL_PATH):
        print("Downloading hand landmark model (~35 MB)...")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("Model downloaded.")


def draw_landmarks(frame, landmarks):
    h, w = frame.shape[:2]
    points = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
    for start, end in HAND_CONNECTIONS:
        cv2.line(frame, points[start], points[end], (0, 255, 0), 2)
    for pt in points:
        cv2.circle(frame, pt, 5, (0, 0, 255), -1)


async def stream(ws):
    download_model()

    options = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(0)
    last_sent = 0.0
    frame_ts_ms = 0

    with vision.HandLandmarker.create_from_options(options) as landmarker:
        print("Streaming to server. Press 'q' to quit.")

        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                continue

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            frame_ts_ms += 33  # ~30 fps timestamp increment
            results = landmarker.detect_for_video(mp_image, frame_ts_ms)

            if results.hand_landmarks and results.handedness:
                landmarks = results.hand_landmarks[0]
                handedness = results.handedness[0][0].display_name

                draw_landmarks(frame, landmarks)

                now = time.monotonic()
                if now - last_sent >= FRAME_INTERVAL:
                    lm_list = [[lm.x, lm.y, lm.z] for lm in landmarks]
                    payload = json.dumps({"hand": handedness, "landmarks": lm_list})
                    await ws.send(payload)
                    last_sent = now

            cv2.imshow("Hand Tracking", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


async def main():
    print(f"Connecting to {WS_URL} ...")
    async with websockets.connect(WS_URL) as ws:
        print("Connected.")
        await stream(ws)


if __name__ == "__main__":
    asyncio.run(main())
